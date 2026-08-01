//! Welche Filme gehören zu einer Serie? (Punkt 3 der Übergabe)
//!
//! In echten Sammlungen liegen Kinofilme einer Serie mal im Serienordner
//! („Miraculous/Awakening (2023).mkv"), mal in der Filmbibliothek unter einem
//! Namen, der mit dem Serientitel beginnt. Beides wird hier erkannt, damit die
//! Serienansicht einen eigenen Reiter „Filme" zeigen kann.
//!
//! Zwei automatische Wege plus eine Handentscheidung:
//!
//!   1. ORDNER — der Film liegt unterhalb des Serienordners. Das ist das
//!      stärkste Signal, weil der Nutzer die Datei selbst dorthin gelegt hat.
//!   2. TITEL — der Filmtitel beginnt mit dem Serientitel und geht darüber
//!      hinaus („Miraculous Ladybug Awakening"). Reine Gleichheit reicht NICHT:
//!      ein Film, der exakt so heißt wie die Serie, ist meistens die Vorlage
//!      und nicht ein Zusatzfilm — der taucht sonst bei jeder Serie auf.
//!   3. HAND — der Nutzer kann jeden Film zuordnen oder ausschließen. Das
//!      liegt in der Einstellung `show_movie_links` und schlägt beides oben.
//!
//! Die Handentscheidungen hängen an TMDb-ID und Titel der Serie, nicht an der
//! Datenbank-ID: die ändert sich bei „Bibliothek neu aufbauen", die Zuordnung
//! soll das überleben.

use crate::db;
use crate::models::{Episode, Movie, Show};
use crate::parser;
use anyhow::Result;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const LINK_KEY: &str = "show_movie_links";

/// Handentscheidungen einer Serie: bewusst zugeordnet bzw. ausgeschlossen.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Verknuepfung {
    #[serde(default)]
    pub dazu: Vec<String>,
    #[serde(default)]
    pub weg: Vec<String>,
}

/// Stabiler Schlüssel einer Serie für die Einstellungen.
pub fn show_schluessel(show: &Show) -> String {
    match show.tmdb_id {
        Some(id) => format!("tmdb:{id}"),
        None => format!("titel:{}", parser::show_key(&show.title)),
    }
}

/// Stabiler Schlüssel eines Films — Titel plus Jahr, nicht die Datenbank-ID.
pub fn film_schluessel(m: &Movie) -> String {
    let basis = parser::letters_only(&m.title).to_lowercase();
    let basis = if basis.is_empty() { m.title.to_lowercase() } else { basis };
    match m.year {
        Some(y) => format!("{basis}|{y}"),
        None => basis,
    }
}

fn alle_links(conn: &Connection) -> HashMap<String, Verknuepfung> {
    let raw = db::get_setting(conn, LINK_KEY).ok().flatten().unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

fn links_speichern(conn: &Connection, map: &HashMap<String, Verknuepfung>) -> Result<()> {
    db::set_setting(conn, LINK_KEY, &serde_json::to_string(map)?)?;
    Ok(())
}

/// Pfad vereinheitlichen (siehe ordnerwahl::norm — gleiche Begründung).
fn norm(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Der Ordner, in dem die Serie liegt — aus dem Pfad einer Folge abgeleitet.
///
/// „…/Serie/Season 1/folge.mkv" → „…/Serie". Liegen die Folgen flach im
/// Serienordner, ist es dessen Ordner selbst.
fn serien_ordner(episodes: &[Episode]) -> Option<String> {
    let ep = episodes.first()?;
    let pfad = norm(&ep.path);
    let mut teile: Vec<&str> = pfad.split('/').collect();
    teile.pop()?; // Dateiname weg
    let ordner = teile.join("/");
    let letzter = teile.last().copied().unwrap_or("");
    if parser::parse_season_from_dir(letzter).is_some() {
        teile.pop();
        Some(teile.join("/"))
    } else {
        Some(ordner)
    }
}

/// Gehört dieser Film automatisch zu der Serie?
fn passt_automatisch(m: &Movie, serien_titel_norm: &str, ordner: Option<&str>) -> bool {
    if let Some(o) = ordner {
        if !o.is_empty() && norm(&m.path).starts_with(&format!("{o}/")) {
            return true;
        }
    }
    if serien_titel_norm.is_empty() {
        return false;
    }
    let film = parser::letters_only(&m.title).to_lowercase();
    // Länger als der Serientitel UND mit ihm beginnend: „Miraculous Awakening"
    // ja, „Miraculous" allein nein (das ist die Serie selbst).
    film.len() > serien_titel_norm.len() && film.starts_with(&format!("{serien_titel_norm} "))
}

/// Die Filme, die zu dieser Serie gehören.
pub fn fuer_serie(conn: &Connection, show: &Show, episodes: &[Episode]) -> Result<Vec<Movie>> {
    let links = alle_links(conn);
    let eigene = links.get(&show_schluessel(show)).cloned().unwrap_or_default();
    let dazu: Vec<String> = eigene.dazu.iter().map(|s| s.to_lowercase()).collect();
    let weg: Vec<String> = eigene.weg.iter().map(|s| s.to_lowercase()).collect();

    let ordner = serien_ordner(episodes);
    let titel_norm = parser::letters_only(&show.title).to_lowercase();

    let alle = db::list_movies(conn)?;
    let mut treffer: Vec<Movie> = alle
        .into_iter()
        .filter(|m| {
            let k = film_schluessel(m).to_lowercase();
            if weg.contains(&k) {
                return false;
            }
            if dazu.contains(&k) {
                return true;
            }
            passt_automatisch(m, &titel_norm, ordner.as_deref())
        })
        .collect();
    treffer.sort_by(|a, b| {
        a.year
            .unwrap_or(9999)
            .cmp(&b.year.unwrap_or(9999))
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    Ok(treffer)
}

/// Einen Film von Hand zuordnen (`dazu = true`) oder ausschließen.
pub fn verknuepfen(conn: &Connection, show: &Show, film: &Movie, dazu: bool) -> Result<()> {
    let mut map = alle_links(conn);
    let key = show_schluessel(show);
    let fk = film_schluessel(film);
    let e = map.entry(key).or_default();
    e.dazu.retain(|x| x.to_lowercase() != fk);
    e.weg.retain(|x| x.to_lowercase() != fk);
    if dazu {
        e.dazu.push(fk);
    } else {
        e.weg.push(fk);
    }
    links_speichern(conn, &map)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn film(title: &str, year: Option<i64>, path: &str) -> Movie {
        Movie {
            id: 1,
            path: path.into(),
            title: title.into(),
            year,
            tmdb_id: None,
            overview: None,
            poster_path: None,
            backdrop_path: None,
            genres: None,
            runtime: None,
            rating: None,
            added_at: 0,
            identified: false,
            width: None,
            height: None,
            cert: None,
        }
    }

    #[test]
    fn film_im_serienordner_zaehlt() {
        let m = film("Awakening", Some(2023), "Z:/Serien/Miraculous/Awakening (2023).mkv");
        assert!(passt_automatisch(&m, "miraculous", Some("z:/serien/miraculous")));
    }

    #[test]
    fn titel_mit_serienpraefix_zaehlt() {
        let m = film("Miraculous Ladybug Awakening", Some(2023), "Y:/Filme/x.mkv");
        assert!(passt_automatisch(&m, "miraculous ladybug", None));
    }

    #[test]
    fn gleicher_titel_zaehlt_nicht() {
        // Sonst tauchte bei jeder Serie der gleichnamige Film als "Zusatzfilm" auf.
        let m = film("Miraculous", Some(2015), "Y:/Filme/x.mkv");
        assert!(!passt_automatisch(&m, "miraculous", None));
    }

    #[test]
    fn fremder_film_zaehlt_nicht() {
        let m = film("Inception", Some(2010), "Y:/Filme/Inception.mkv");
        assert!(!passt_automatisch(&m, "miraculous", Some("z:/serien/miraculous")));
    }
}
