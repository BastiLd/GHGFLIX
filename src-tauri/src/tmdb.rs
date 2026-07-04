use crate::models::{TmdbImage, TmdbResult};
use anyhow::Result;
use serde::Deserialize;

const BASE: &str = "https://api.themoviedb.org/3";

pub struct Tmdb {
    client: reqwest::Client,
    key: String,
    lang: String,
}

#[derive(Debug, Clone)]
pub struct MovieMeta {
    pub tmdb_id: i64,
    pub title: String,
    pub year: Option<i64>,
    pub overview: Option<String>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub genres: Vec<String>,
    pub runtime: Option<i64>,
    pub rating: Option<f64>,
    /// age certification, e.g. "FSK 16" / "PG-13"
    pub cert: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ShowMeta {
    pub tmdb_id: i64,
    pub title: String,
    pub year: Option<i64>,
    pub overview: Option<String>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub genres: Vec<String>,
    pub rating: Option<f64>,
    pub episode_count: Option<i64>,
    pub cert: Option<String>,
    /// "Returning Series" | "Ended" | "Canceled" | …
    pub status: Option<String>,
    pub last_year: Option<i64>,
    /// typical episode runtime in minutes
    pub runtime: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct EpisodeMeta {
    pub episode: i64,
    pub title: Option<String>,
    pub overview: Option<String>,
    pub still_path: Option<String>,
    pub air_date: Option<String>,
    pub runtime: Option<i64>,
}

fn year_from_date(date: &Option<String>) -> Option<i64> {
    date.as_ref()
        .filter(|d| d.len() >= 4)
        .and_then(|d| d[..4].parse::<i64>().ok())
}

fn empty_to_none(s: Option<String>) -> Option<String> {
    s.filter(|v| !v.trim().is_empty())
}

// ===== Response shapes =====

#[derive(Deserialize)]
struct SearchResp {
    #[serde(default)]
    results: Vec<Hit>,
}

#[derive(Deserialize, Default)]
struct Hit {
    id: i64,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    release_date: Option<String>,
    #[serde(default)]
    first_air_date: Option<String>,
    #[serde(default)]
    overview: Option<String>,
    #[serde(default)]
    poster_path: Option<String>,
    #[serde(default)]
    backdrop_path: Option<String>,
    #[serde(default)]
    vote_average: Option<f64>,
    #[serde(default)]
    media_type: Option<String>,
}

impl Hit {
    fn into_result(self, default_kind: &str) -> Option<TmdbResult> {
        let kind = self.media_type.clone().unwrap_or_else(|| default_kind.to_string());
        if kind != "movie" && kind != "tv" {
            return None;
        }
        let title = self.title.clone().or_else(|| self.name.clone())?;
        let year = if kind == "movie" {
            year_from_date(&self.release_date)
        } else {
            year_from_date(&self.first_air_date)
        };
        Some(TmdbResult {
            tmdb_id: self.id,
            media_type: kind,
            title,
            year,
            overview: empty_to_none(self.overview),
            poster_path: self.poster_path,
            backdrop_path: self.backdrop_path,
            rating: self.vote_average,
        })
    }
}

#[derive(Deserialize)]
struct Genre {
    name: String,
}

#[derive(Deserialize)]
struct MovieDetailsResp {
    id: i64,
    title: Option<String>,
    release_date: Option<String>,
    overview: Option<String>,
    poster_path: Option<String>,
    backdrop_path: Option<String>,
    vote_average: Option<f64>,
    runtime: Option<i64>,
    #[serde(default)]
    genres: Vec<Genre>,
    #[serde(default)]
    release_dates: Option<ReleaseDatesResp>,
}

#[derive(Deserialize, Default)]
struct ReleaseDatesResp {
    #[serde(default)]
    results: Vec<CountryReleases>,
}

#[derive(Deserialize)]
struct CountryReleases {
    iso_3166_1: String,
    #[serde(default)]
    release_dates: Vec<ReleaseEntry>,
}

#[derive(Deserialize)]
struct ReleaseEntry {
    #[serde(default)]
    certification: String,
}

#[derive(Deserialize, Default)]
struct ContentRatingsResp {
    #[serde(default)]
    results: Vec<ContentRating>,
}

#[derive(Deserialize)]
struct ContentRating {
    iso_3166_1: String,
    #[serde(default)]
    rating: String,
}

/// Pick the German certification, else US, else the first non-empty one.
fn pick_cert<'a>(mut entries: impl Iterator<Item = (&'a str, String)>) -> Option<String> {
    let all: Vec<(String, String)> = entries
        .by_ref()
        .filter(|(_, c)| !c.trim().is_empty())
        .map(|(l, c)| (l.to_string(), c))
        .collect();
    let by = |code: &str| all.iter().find(|(l, _)| l == code).map(|(_, c)| c.clone());
    by("DE")
        .map(|c| if c.chars().all(|ch| ch.is_ascii_digit()) { format!("FSK {c}") } else { c })
        .or_else(|| by("US"))
        .or_else(|| all.first().map(|(_, c)| c.clone()))
}

#[derive(Deserialize)]
struct TvDetailsResp {
    id: i64,
    name: Option<String>,
    first_air_date: Option<String>,
    overview: Option<String>,
    poster_path: Option<String>,
    backdrop_path: Option<String>,
    vote_average: Option<f64>,
    #[serde(default)]
    genres: Vec<Genre>,
    #[serde(default)]
    number_of_episodes: Option<i64>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    last_air_date: Option<String>,
    #[serde(default)]
    episode_run_time: Vec<i64>,
    #[serde(default)]
    content_ratings: Option<ContentRatingsResp>,
    #[serde(default)]
    seasons: Vec<SeasonStub>,
}

#[derive(Deserialize)]
struct SeasonStub {
    season_number: i64,
}

#[derive(Deserialize)]
struct VideosResp {
    #[serde(default)]
    results: Vec<Video>,
}

#[derive(Deserialize)]
struct Video {
    key: String,
    site: String,
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    official: bool,
}

#[derive(Deserialize)]
struct CreditsResp {
    #[serde(default)]
    cast: Vec<CastEntry>,
}

#[derive(Deserialize)]
struct CastEntry {
    name: String,
    #[serde(default)]
    character: Option<String>,
    #[serde(default)]
    profile_path: Option<String>,
    #[serde(default)]
    order: i64,
}

#[derive(Deserialize, Default)]
struct ImagesResp {
    #[serde(default)]
    posters: Vec<ImgHit>,
    #[serde(default)]
    backdrops: Vec<ImgHit>,
    #[serde(default)]
    stills: Vec<ImgHit>,
}

#[derive(Deserialize, Default)]
struct ImgHit {
    file_path: Option<String>,
    #[serde(default)]
    width: Option<i64>,
    #[serde(default)]
    height: Option<i64>,
    #[serde(default)]
    vote_average: Option<f64>,
    #[serde(default)]
    iso_639_1: Option<String>,
}

impl ImgHit {
    fn into_image(self, kind: &str) -> Option<TmdbImage> {
        Some(TmdbImage {
            file_path: self.file_path?,
            kind: kind.to_string(),
            width: self.width,
            height: self.height,
            vote_average: self.vote_average,
            lang: self.iso_639_1,
        })
    }
}

#[derive(Deserialize)]
struct SeasonResp {
    #[serde(default)]
    episodes: Vec<EpHit>,
}

#[derive(Deserialize)]
struct EpHit {
    episode_number: i64,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    overview: Option<String>,
    #[serde(default)]
    still_path: Option<String>,
    #[serde(default)]
    air_date: Option<String>,
    #[serde(default)]
    runtime: Option<i64>,
}

impl Tmdb {
    pub fn new(client: reqwest::Client, key: String, lang: String) -> Self {
        let lang = if lang.trim().is_empty() { "de-DE".to_string() } else { lang };
        Tmdb { client, key, lang }
    }

    /// kind: "movie" | "tv" | "multi"
    pub async fn search(&self, query: &str, kind: &str, year: Option<i64>) -> Result<Vec<TmdbResult>> {
        let endpoint = match kind {
            "movie" => "/search/movie",
            "tv" => "/search/tv",
            _ => "/search/multi",
        };
        let mut params: Vec<(&str, String)> = vec![
            ("api_key", self.key.clone()),
            ("language", self.lang.clone()),
            ("query", query.to_string()),
            ("include_adult", "false".to_string()),
        ];
        if let Some(y) = year {
            match kind {
                "movie" => params.push(("year", y.to_string())),
                "tv" => params.push(("first_air_date_year", y.to_string())),
                _ => {}
            }
        }
        let url = format!("{BASE}{endpoint}");
        let resp: SearchResp = self.client.get(url).query(&params).send().await?.json().await?;
        let default_kind = if kind == "tv" { "tv" } else { "movie" };
        let out = resp
            .results
            .into_iter()
            .filter_map(|h| h.into_result(default_kind))
            .collect();
        Ok(out)
    }

    pub async fn movie_details(&self, id: i64) -> Result<MovieMeta> {
        let url = format!("{BASE}/movie/{id}");
        let r: MovieDetailsResp = self
            .client
            .get(url)
            .query(&[
                ("api_key", self.key.as_str()),
                ("language", self.lang.as_str()),
                ("append_to_response", "release_dates"),
            ])
            .send()
            .await?
            .json()
            .await?;
        let cert = r.release_dates.as_ref().and_then(|rd| {
            pick_cert(rd.results.iter().flat_map(|c| {
                c.release_dates
                    .iter()
                    .map(move |e| (c.iso_3166_1.as_str(), e.certification.clone()))
            }))
        });
        Ok(MovieMeta {
            tmdb_id: r.id,
            title: r.title.unwrap_or_default(),
            year: year_from_date(&r.release_date),
            overview: empty_to_none(r.overview),
            poster_path: r.poster_path,
            backdrop_path: r.backdrop_path,
            genres: r.genres.into_iter().map(|g| g.name).collect(),
            runtime: r.runtime,
            rating: r.vote_average,
            cert,
        })
    }

    pub async fn tv_details(&self, id: i64) -> Result<ShowMeta> {
        let url = format!("{BASE}/tv/{id}");
        let r: TvDetailsResp = self
            .client
            .get(url)
            .query(&[
                ("api_key", self.key.as_str()),
                ("language", self.lang.as_str()),
                ("append_to_response", "content_ratings"),
            ])
            .send()
            .await?
            .json()
            .await?;
        let cert = r.content_ratings.as_ref().and_then(|cr| {
            pick_cert(cr.results.iter().map(|c| (c.iso_3166_1.as_str(), c.rating.clone())))
        });
        Ok(ShowMeta {
            tmdb_id: r.id,
            title: r.name.unwrap_or_default(),
            year: year_from_date(&r.first_air_date),
            overview: empty_to_none(r.overview),
            poster_path: r.poster_path,
            backdrop_path: r.backdrop_path,
            genres: r.genres.into_iter().map(|g| g.name).collect(),
            rating: r.vote_average,
            episode_count: r.number_of_episodes,
            cert,
            status: r.status,
            last_year: year_from_date(&r.last_air_date),
            runtime: r.episode_run_time.into_iter().next(),
        })
    }

    /// Real season numbers of a show (skips season 0 / "Specials" unless it is
    /// the only one), so the identify dialog offers a proper dropdown.
    pub async fn season_numbers(&self, id: i64) -> Result<Vec<i64>> {
        let url = format!("{BASE}/tv/{id}");
        let r: TvDetailsResp = self
            .client
            .get(url)
            .query(&[("api_key", self.key.as_str()), ("language", self.lang.as_str())])
            .send()
            .await?
            .json()
            .await?;
        let mut nums: Vec<i64> = r.seasons.into_iter().map(|s| s.season_number).collect();
        nums.sort_unstable();
        nums.dedup();
        let non_special: Vec<i64> = nums.iter().copied().filter(|n| *n > 0).collect();
        Ok(if non_special.is_empty() { nums } else { non_special })
    }

    pub async fn extras(&self, media_type: &str, id: i64) -> Result<crate::models::Extras> {
        let mt = if media_type == "tv" { "tv" } else { "movie" };

        let vids: VideosResp = self
            .client
            .get(format!("{BASE}/{mt}/{id}/videos"))
            .query(&[("api_key", self.key.as_str()), ("language", "en-US")])
            .send()
            .await?
            .json()
            .await?;
        let trailer_key = vids
            .results
            .iter()
            .filter(|v| v.site == "YouTube" && v.kind == "Trailer")
            .max_by_key(|v| v.official as i32)
            .or_else(|| vids.results.iter().find(|v| v.site == "YouTube"))
            .map(|v| v.key.clone());

        let credits: CreditsResp = self
            .client
            .get(format!("{BASE}/{mt}/{id}/credits"))
            .query(&[("api_key", self.key.as_str()), ("language", self.lang.as_str())])
            .send()
            .await?
            .json()
            .await?;
        let mut cast = credits.cast;
        cast.sort_by_key(|c| c.order);
        let cast = cast
            .into_iter()
            .take(15)
            .map(|c| crate::models::CastMember {
                name: c.name,
                character: c.character,
                profile_path: c.profile_path,
            })
            .collect();

        Ok(crate::models::Extras { trailer_key, cast })
    }

    /// Available artwork for an item. `media_type` = "movie" | "tv" | "season" | "episode".
    /// `season`/`episode` are required for the season/episode variants.
    pub async fn images(
        &self,
        media_type: &str,
        id: i64,
        season: Option<i64>,
        episode: Option<i64>,
    ) -> Result<Vec<TmdbImage>> {
        let endpoint = match media_type {
            "movie" => format!("/movie/{id}/images"),
            "season" => format!("/tv/{id}/season/{}/images", season.unwrap_or(1)),
            "episode" => format!(
                "/tv/{id}/season/{}/episode/{}/images",
                season.unwrap_or(1),
                episode.unwrap_or(1)
            ),
            _ => format!("/tv/{id}/images"),
        };
        let url = format!("{BASE}{endpoint}");
        // No `language` filter + a broad include list = localized + textless options.
        let resp: ImagesResp = self
            .client
            .get(url)
            .query(&[
                ("api_key", self.key.as_str()),
                ("include_image_language", "de,en,null"),
            ])
            .send()
            .await?
            .json()
            .await?;

        let mut out: Vec<TmdbImage> = Vec::new();
        out.extend(resp.posters.into_iter().filter_map(|h| h.into_image("poster")));
        out.extend(resp.backdrops.into_iter().filter_map(|h| h.into_image("backdrop")));
        out.extend(resp.stills.into_iter().filter_map(|h| h.into_image("still")));
        // Best-rated first within each kind (stable sort keeps kind grouping).
        out.sort_by(|a, b| {
            b.vote_average
                .unwrap_or(0.0)
                .partial_cmp(&a.vote_average.unwrap_or(0.0))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(out)
    }

    pub async fn season_episodes(&self, tv_id: i64, season: i64) -> Result<Vec<EpisodeMeta>> {
        let url = format!("{BASE}/tv/{tv_id}/season/{season}");
        let r: SeasonResp = self
            .client
            .get(url)
            .query(&[("api_key", self.key.as_str()), ("language", self.lang.as_str())])
            .send()
            .await?
            .json()
            .await?;
        Ok(r
            .episodes
            .into_iter()
            .map(|e| EpisodeMeta {
                episode: e.episode_number,
                title: empty_to_none(e.name),
                overview: empty_to_none(e.overview),
                still_path: e.still_path,
                air_date: empty_to_none(e.air_date),
                runtime: e.runtime,
            })
            .collect())
    }
}
