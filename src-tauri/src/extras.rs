//! Bonusmaterial einer Serie — und kurze Notizen an einzelnen Einträgen.
//!
//! WARUM ES DAS GIBT (gemessen am 19.08.2026): In den Serienordnern lagen 83
//! Dateien wie `The Newsroom …\Featurettes\Season 1\Inside the Episode\Amen.mkv`
//! und `Suits …\Extras\Season 02\Gag Reel.mkv`. Sie haben keine Folgennummer,
//! landeten deshalb in `movies` — und die automatische TMDb-Suche hängte ihnen
//! irgendeinen echten Kinofilm an („Amen." von 2002, „Gag" von 2006, „Sucker
//! Punch"). Die Filmübersicht war voller Geisterfilme.
//!
//! Jetzt bleibt das Material erhalten, aber als das, was es ist: Zusatzmaterial
//! der Serie, nach Art getrennt und der Staffel zugeordnet, aus der es stammt.

use crate::db;
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Die Arten von Zusatzmaterial. `sonstiges` ist der Auffangwert — dort landet,
/// was zwar erkennbar Bonusmaterial ist, sich aber nicht sicher einordnen lässt.
pub const ARTEN: &[&str] = &[
    "special",
    "blooper",
    "behind",
    "deleted",
    "featurette",
    "interview",
    "trailer",
    "sonstiges",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extra {
    pub id: i64,
    pub show_id: i64,
    pub path: String,
    pub titel: String,
    pub art: String,
    pub staffel: Option<i64>,
    pub von_hand: bool,
    /// Kurze Notiz des Nutzers, falls vorhanden.
    pub notiz: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

/// Ordnernamen, die eine Art KONKRET benennen („Deleted Scenes", „Interviews").
/// Sie schlagen den Dateinamen — der Ordner ist die bewusstere Einordnung.
fn art_aus_ordner_konkret(name: &str) -> Option<&'static str> {
    let t = name.trim().to_lowercase();
    let hat = |w: &str| t.contains(w);
    if hat("gag") || hat("blooper") || hat("outtake") || hat("panne") {
        return Some("blooper");
    }
    if hat("deleted") || hat("geloescht") || hat("gelöscht") || hat("entfernte szene") {
        return Some("deleted");
    }
    if hat("behind the scenes") || hat("hinter den kulissen") || hat("making of") || hat("making-of") {
        return Some("behind");
    }
    if hat("interview") {
        return Some("interview");
    }
    if hat("trailer") || hat("teaser") {
        return Some("trailer");
    }
    if hat("inside the episode") {
        return Some("featurette");
    }
    // „Special Extras Season 1" ist ein SAMMELordner für Bonusmaterial, kein
    // Specials-Ordner — sonst würde jedes Featurette darin zum „Special".
    if hat("special") && !hat("extra") && !hat("bonus") && !hat("featurette") {
        return Some("special");
    }
    None
}

/// SAMMELordner („Extras", „Bonus", „Featurettes") sagen nur „hier ist
/// irgendwas Zusätzliches" — sie dürfen den Dateinamen NICHT überstimmen.
///
/// Gemessen am 19.08.2026: `Suits …\Extras\Season 02\Gag Reel.mkv` wurde sonst
/// zur „Featurette", obwohl der Dateiname eindeutig ein Gag Reel benennt.
fn art_aus_sammelordner(name: &str) -> Option<&'static str> {
    let t = name.trim().to_lowercase();
    if t.contains("featurette") || t.contains("bonus") || t.contains("extra") {
        return Some("featurette");
    }
    None
}

/// Dateinamen → Art, wenn der Ordner nichts verrät („Gag Reel.mkv" direkt in
/// „Extras"). Der Dateiname ist das schwächere Signal, deshalb erst danach.
fn art_aus_datei(stem: &str) -> Option<&'static str> {
    let t = stem.to_lowercase();
    let hat = |w: &str| t.contains(w);
    if hat("gag reel") || hat("blooper") || hat("outtake") {
        return Some("blooper");
    }
    if hat("deleted scene") || hat("deleted-scene") {
        return Some("deleted");
    }
    if hat("behind the scenes") || hat("making of") {
        return Some("behind");
    }
    if hat("interview") {
        return Some("interview");
    }
    if hat("trailer") || hat("teaser") {
        return Some("trailer");
    }
    None
}

/// Art + Staffel eines Bonus-Fundes aus seinem Pfad unterhalb der Bibliothek.
///
/// Es gewinnt der SPEZIFISCHSTE Ordner, also der am tiefsten liegende:
/// `Featurettes\Season 1\Deleted Scenes\x.mkv` → „deleted", Staffel 1 —
/// nicht „featurette", nur weil das weiter oben steht.
pub fn art_und_staffel(rel_ordner: &[String], dateiname: &str) -> (String, Option<i64>) {
    let mut konkret: Option<&str> = None;
    let mut sammel: Option<&str> = None;
    let mut staffel: Option<i64> = None;
    for teil in rel_ordner {
        if let Some(s) = staffel_aus_ordner(teil) {
            staffel = Some(s);
        }
        // tieferer Ordner überschreibt den flacheren
        if let Some(a) = art_aus_ordner_konkret(teil) {
            konkret = Some(a);
        }
        if let Some(a) = art_aus_sammelordner(teil) {
            sammel = Some(a);
        }
    }
    // Reihenfolge: konkreter Ordner → Dateiname → Sammelordner → unbekannt.
    let art = konkret
        .or_else(|| art_aus_datei(dateiname))
        .or(sammel)
        .unwrap_or("sonstiges");
    (art.to_string(), staffel)
}

/// Staffelnummer eines Ordners. Eine AUSGESCHRIEBENE Angabe („Season 1",
/// „Staffel 2") hat Vorrang — sonst wird „Special Extras Season 1" wegen des
/// Worts „Special" zu Staffel 0 (gemessen 23.09.2026).
fn staffel_aus_ordner(name: &str) -> Option<i64> {
    static RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?i)\b(?:season|staffel|saison)\s*0*(\d{1,3})\b").unwrap()
    });
    if let Some(c) = RE.captures(name) {
        return c.get(1).and_then(|m| m.as_str().parse().ok());
    }
    crate::parser::parse_season_from_dir(name)
}

/// Einen Fund eintragen. Von Hand gesetzte Einträge werden NICHT überschrieben.
pub fn merken(
    conn: &Connection,
    show_id: i64,
    path: &str,
    titel: &str,
    art: &str,
    staffel: Option<i64>,
) -> Result<()> {
    let von_hand: Option<i64> = conn
        .query_row("SELECT von_hand FROM extras WHERE path = ?1", [path], |r| r.get(0))
        .optional()?;
    if von_hand == Some(1) {
        // Handentscheidung schlägt die Automatik — nur die Serie nachziehen.
        conn.execute("UPDATE extras SET show_id=?1 WHERE path=?2", params![show_id, path])?;
        return Ok(());
    }
    conn.execute(
        "INSERT INTO extras(show_id, path, titel, art, staffel, von_hand, added_at)
         VALUES(?1,?2,?3,?4,?5,0,?6)
         ON CONFLICT(path) DO UPDATE SET
            show_id = excluded.show_id,
            titel   = excluded.titel,
            art     = excluded.art,
            staffel = excluded.staffel",
        params![show_id, path, titel, art, staffel, db::now()],
    )?;
    Ok(())
}

fn map_extra(r: &rusqlite::Row) -> rusqlite::Result<Extra> {
    Ok(Extra {
        id: r.get(0)?,
        show_id: r.get(1)?,
        path: r.get(2)?,
        titel: r.get(3)?,
        art: r.get(4)?,
        staffel: r.get(5)?,
        von_hand: r.get::<_, i64>(6)? == 1,
        notiz: r.get(7)?,
        width: None,
        height: None,
    })
}

const COLS: &str = "e.id, e.show_id, e.path, e.titel, e.art, e.staffel, e.von_hand, \
                    (SELECT n.text FROM notizen n WHERE n.path = e.path)";

pub fn fuer_serie(conn: &Connection, show_id: i64) -> Result<Vec<Extra>> {
    let sql = format!(
        "SELECT {COLS} FROM extras e WHERE e.show_id = ?1
         ORDER BY COALESCE(e.staffel, 9999), e.titel COLLATE NOCASE"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([show_id], map_extra)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> Result<Option<Extra>> {
    let sql = format!("SELECT {COLS} FROM extras e WHERE e.id = ?1");
    Ok(conn.query_row(&sql, [id], map_extra).optional()?)
}

/// Art und/oder Staffel von Hand setzen (Zuordnungs-Fenster).
pub fn von_hand_setzen(
    conn: &Connection,
    id: i64,
    art: &str,
    staffel: Option<i64>,
) -> Result<()> {
    conn.execute(
        "UPDATE extras SET art=?1, staffel=?2, von_hand=1 WHERE id=?3",
        params![art, staffel, id],
    )?;
    Ok(())
}

/// Dateien wegräumen, die es nicht mehr gibt (analog prune_missing).
pub fn aufraeumen(conn: &Connection, ist_offline: &dyn Fn(&str) -> bool) -> Result<()> {
    let mut stmt = conn.prepare("SELECT path FROM extras")?;
    let pfade: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for p in pfade {
        if !Path::new(&p).exists() && !ist_offline(&p) {
            conn.execute("DELETE FROM extras WHERE path = ?1", [&p])?;
        }
    }
    Ok(())
}

// ── Notizen ────────────────────────────────────────────────────────────────

/// Notiz setzen (leerer Text löscht sie).
pub fn notiz_setzen(conn: &Connection, path: &str, text: &str) -> Result<()> {
    if text.trim().is_empty() {
        conn.execute("DELETE FROM notizen WHERE path = ?1", [path])?;
    } else {
        conn.execute(
            "INSERT INTO notizen(path, text) VALUES(?1, ?2)
             ON CONFLICT(path) DO UPDATE SET text = excluded.text",
            params![path, text.trim()],
        )?;
    }
    Ok(())
}

pub fn notiz(conn: &Connection, path: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT text FROM notizen WHERE path = ?1", [path], |r| r.get(0))
        .optional()?)
}

/// Alle Notizen auf einmal — die Serienansicht braucht sie für jede Folge.
pub fn alle_notizen(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT path, text FROM notizen")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ordner(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn art_und_staffel_aus_echten_pfaden() {
        // The Newsroom: Featurettes\Season 1\Inside the Episode\Amen.mkv
        let (a, s) = art_und_staffel(&ordner(&["Featurettes", "Season 1", "Inside the Episode"]), "Amen");
        assert_eq!(a, "featurette");
        assert_eq!(s, Some(1));

        // der TIEFERE Ordner gewinnt: Deleted Scenes schlägt Featurettes
        let (a, s) = art_und_staffel(&ordner(&["Featurettes", "Season 1", "Deleted Scenes"]), "The Greater Fool");
        assert_eq!(a, "deleted");
        assert_eq!(s, Some(1));

        // Suits: Extras\Season 02\Gag Reel.mkv — Art steckt im DATEInamen
        let (a, s) = art_und_staffel(&ordner(&["Extras", "Season 02"]), "Gag Reel");
        assert_eq!(a, "blooper");
        assert_eq!(s, Some(2));

        // My Little Pony: Specials\MLP_FiM - Rainbow Roadtrip.mkv
        // Staffel 0 ist hier richtig — „Specials" IST die Staffel 0.
        let (a, s) = art_und_staffel(&ordner(&["Specials"]), "MLP_FiM - Rainbow Roadtrip");
        assert_eq!(a, "special");
        assert_eq!(s, Some(0));

        // Suits: Extras\Season 05\Deleted Scene - Denial.mkv
        let (a, s) = art_und_staffel(&ordner(&["Extras", "Season 05"]), "Deleted Scene - Denial");
        assert_eq!(a, "deleted");
        assert_eq!(s, Some(5));
    }

    #[test]
    fn special_extras_sammelordner() {
        // Z:\SM-MOONDOOM\Series\The Newsroom\Special Extras Season 1\Mission Control.mkv
        let (a, s) = art_und_staffel(&ordner(&["The Newsroom", "Special Extras Season 1"]), "Mission Control");
        assert_eq!(a, "featurette", "Sammelordner, kein Special");
        assert_eq!(s, Some(1));
        // … \Special Extras Season 2\Deleted Scene\Election Night, Part II.mkv
        let (a, s) = art_und_staffel(
            &ordner(&["The Newsroom", "Special Extras Season 2", "Deleted Scene"]),
            "Election Night, Part II",
        );
        assert_eq!(a, "deleted");
        assert_eq!(s, Some(2));
    }

    #[test]
    fn unbekanntes_wird_sonstiges() {
        let (a, s) = art_und_staffel(&ordner(&["Extras"]), "Suits Series Montage");
        assert_eq!(a, "featurette", "Extras-Ordner zaehlt als Featurette");
        assert_eq!(s, None);
        let (a, _) = art_und_staffel(&ordner(&[]), "Irgendwas");
        assert_eq!(a, "sonstiges");
    }
}
