use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub id: i64,
    pub path: String,
    /// "movie" | "tv"
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Movie {
    pub id: i64,
    pub path: String,
    pub title: String,
    pub year: Option<i64>,
    pub tmdb_id: Option<i64>,
    pub overview: Option<String>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub genres: Option<String>,
    pub runtime: Option<i64>,
    pub rating: Option<f64>,
    pub added_at: i64,
    pub identified: bool,
    #[serde(default)]
    pub width: Option<i64>,
    #[serde(default)]
    pub height: Option<i64>,
    #[serde(default)]
    pub cert: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Show {
    pub id: i64,
    pub folder: Option<String>,
    pub title: String,
    pub year: Option<i64>,
    pub tmdb_id: Option<i64>,
    pub overview: Option<String>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub genres: Option<String>,
    pub rating: Option<f64>,
    pub added_at: i64,
    pub identified: bool,
    #[serde(default)]
    pub episode_count: i64,
    #[serde(default)]
    pub season_count: i64,
    #[serde(default)]
    pub width: Option<i64>,
    #[serde(default)]
    pub height: Option<i64>,
    #[serde(default)]
    pub cert: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub last_year: Option<i64>,
    /// typical episode runtime (minutes)
    #[serde(default)]
    pub runtime: Option<i64>,
    /// manual per-show intro window (fallback for episodes without their own)
    #[serde(default)]
    pub intro_start: Option<f64>,
    #[serde(default)]
    pub intro_end: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Episode {
    pub id: i64,
    pub show_id: i64,
    pub season: i64,
    pub episode: i64,
    pub path: String,
    pub title: Option<String>,
    pub overview: Option<String>,
    pub still_path: Option<String>,
    pub air_date: Option<String>,
    pub runtime: Option<i64>,
    pub added_at: i64,
    pub intro_start: Option<f64>,
    pub intro_end: Option<f64>,
    #[serde(default)]
    pub show_title: Option<String>,
    #[serde(default)]
    pub width: Option<i64>,
    #[serde(default)]
    pub height: Option<i64>,
    #[serde(default)]
    pub file_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub profile_id: String,
    /// "movie" | "episode"
    pub media_type: String,
    pub ref_id: i64,
    pub tmdb_id: Option<i64>,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub watched: bool,
    pub updated_at: i64,
}

/// Continue-watching entry joined with display info for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinueItem {
    pub media_type: String,
    pub ref_id: i64,
    pub title: String,
    pub subtitle: Option<String>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub progress: f64,
    pub updated_at: i64,
    pub show_id: Option<i64>,
    pub season: Option<i64>,
    pub episode: Option<i64>,
}

/// A search hit from TMDb (used by the manual identify dialog).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmdbResult {
    pub tmdb_id: i64,
    /// "movie" | "tv"
    pub media_type: String,
    pub title: String,
    pub year: Option<i64>,
    pub overview: Option<String>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub rating: Option<f64>,
}

/// One physical file of an episode (a quality/version of it).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeFile {
    pub id: i64,
    pub episode_id: i64,
    pub path: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub added_at: i64,
}

/// A single artwork option from TMDb (poster / backdrop / still / season poster).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmdbImage {
    pub file_path: String,
    /// "poster" | "backdrop" | "still"
    pub kind: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub vote_average: Option<f64>,
    pub lang: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub media_type: String, // "movie" | "show"
    pub ref_id: i64,
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CastMember {
    pub name: String,
    pub character: Option<String>,
    pub profile_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extras {
    pub trailer_key: Option<String>,
    pub cast: Vec<CastMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub watched_seconds: f64,
    pub movies_watched: i64,
    pub episodes_watched: i64,
    pub in_progress: i64,
}

/// Aggregated payload for the show detail page.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonGroup {
    pub season: i64,
    pub episodes: Vec<Episode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowDetail {
    pub show: Show,
    pub seasons: Vec<SeasonGroup>,
}
