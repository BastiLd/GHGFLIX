//! Handentscheidungen: „Diese Datei ist in Wirklichkeit …"
//!
//! WARUM (Rückmeldung vom 19.08.2026): Bisher ließ sich an einer Datei nur
//! Staffel und Folge ändern. Es gab keinen Weg zu sagen „das ist gar keine
//! Folge, sondern ein Film", „das gehört zu einer anderen Serie", „das ist ein
//! Blooper" — oder eine versehentlich zugeordnete Sprach-/Qualitätsfassung
//! wieder loszuwerden. Genau das kann diese Tabelle.
//!
//! Sie hängt am DATEIPFAD und schlägt jede Automatik. Der Scanner fragt sie für
//! jede Datei als ERSTES; steht dort etwas, wird nichts geraten.

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ziel {
    /// "folge" | "film" | "extra" | "ignorieren"
    pub ziel: String,
    pub show_tmdb: Option<i64>,
    pub staffel: Option<i64>,
    pub episode: Option<i64>,
    pub extra_art: Option<String>,
    pub tmdb_id: Option<i64>,
}

pub fn setzen(conn: &Connection, path: &str, z: &Ziel) -> Result<()> {
    conn.execute(
        "INSERT INTO zuordnung(path, ziel, show_tmdb, staffel, episode, extra_art, tmdb_id)
         VALUES(?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(path) DO UPDATE SET
            ziel=excluded.ziel, show_tmdb=excluded.show_tmdb, staffel=excluded.staffel,
            episode=excluded.episode, extra_art=excluded.extra_art, tmdb_id=excluded.tmdb_id",
        params![path, z.ziel, z.show_tmdb, z.staffel, z.episode, z.extra_art, z.tmdb_id],
    )?;
    Ok(())
}

/// Handentscheidung aufheben — die Automatik übernimmt wieder.
pub fn loeschen(conn: &Connection, path: &str) -> Result<()> {
    conn.execute("DELETE FROM zuordnung WHERE path = ?1", [path])?;
    Ok(())
}

pub fn fuer(conn: &Connection, path: &str) -> Result<Option<Ziel>> {
    Ok(conn
        .query_row(
            "SELECT ziel, show_tmdb, staffel, episode, extra_art, tmdb_id
             FROM zuordnung WHERE path = ?1",
            [path],
            |r| {
                Ok(Ziel {
                    ziel: r.get(0)?,
                    show_tmdb: r.get(1)?,
                    staffel: r.get(2)?,
                    episode: r.get(3)?,
                    extra_art: r.get(4)?,
                    tmdb_id: r.get(5)?,
                })
            },
        )
        .optional()?)
}

/// Alle Pfade, die auf „ignorieren" stehen — der Scanner überspringt sie.
pub fn ignorierte(conn: &Connection) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    if let Ok(mut stmt) = conn.prepare("SELECT path FROM zuordnung WHERE ziel = 'ignorieren'") {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            for p in rows.flatten() {
                out.insert(crate::ordnerwahl::norm(&p));
            }
        }
    }
    out
}

/// Ein Eintrag für das Zuordnungs-Fenster.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Eintrag {
    pub path: String,
    pub dateiname: String,
    /// Wo die Datei aktuell steckt: "film" | "folge" | "extra" | "nirgends"
    pub aktuell: String,
    /// Klartext, z.B. „Suits · S02E05" oder „Blooper · Staffel 2"
    pub beschreibung: String,
    /// Warum es unsicher ist (leer = sicher)
    pub unsicher: Option<String>,
    pub von_hand: bool,
    pub notiz: Option<String>,
}

/// Alles, was die Bibliothek kennt — plus die Begründung, warum etwas unsicher ist.
///
/// „Unsicher" heißt hier bewusst NICHT „falsch": es sind die Fälle, in denen die
/// Automatik geraten hat und ein Blick lohnt (kein TMDb-Treffer, Art
/// „sonstiges", Folge ohne Titel …).
pub fn liste(conn: &Connection, nur_unsichere: bool) -> Result<Vec<Eintrag>> {
    let mut out: Vec<Eintrag> = Vec::new();
    let von_hand: std::collections::HashSet<String> = {
        let mut s = std::collections::HashSet::new();
        let mut stmt = conn.prepare("SELECT path FROM zuordnung")?;
        for p in stmt.query_map([], |r| r.get::<_, String>(0))?.flatten() {
            s.insert(p);
        }
        s
    };
    let notiz_von = |p: &str| crate::extras::notiz(conn, p).ok().flatten();
    let datei = |p: &str| {
        std::path::Path::new(p)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| p.to_string())
    };

    // Filme
    let mut stmt = conn.prepare("SELECT path, title, year, tmdb_id FROM movies")?;
    let filme: Vec<(String, String, Option<i64>, Option<i64>)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (p, t, j, tmdb) in filme {
        let unsicher = if tmdb.is_none() {
            Some("Kein TMDb-Treffer — Titel konnte nicht sicher zugeordnet werden".into())
        } else {
            None
        };
        out.push(Eintrag {
            dateiname: datei(&p),
            aktuell: "film".into(),
            beschreibung: match j {
                Some(y) => format!("Film · {t} ({y})"),
                None => format!("Film · {t}"),
            },
            unsicher,
            von_hand: von_hand.contains(&p),
            notiz: notiz_von(&p),
            path: p,
        });
    }

    // Folgen (jede physische Datei einzeln — auch die zweite Sprachfassung)
    let mut stmt = conn.prepare(
        "SELECT ef.path, s.title, e.season, e.episode, e.title, s.tmdb_id
         FROM episode_files ef
         JOIN episodes e ON ef.episode_id = e.id
         JOIN shows s    ON e.show_id = s.id",
    )?;
    let folgen: Vec<(String, String, i64, i64, Option<String>, Option<i64>)> = stmt
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (p, serie, st, ep, eptitel, tmdb) in folgen {
        let unsicher = if tmdb.is_none() {
            Some("Serie hat keinen TMDb-Treffer".into())
        } else if eptitel.is_none() {
            Some("Folge gibt es bei TMDb nicht — Nummer könnte falsch sein".into())
        } else {
            None
        };
        out.push(Eintrag {
            dateiname: datei(&p),
            aktuell: "folge".into(),
            beschreibung: format!(
                "{serie} · S{st:02}E{ep:02}{}",
                eptitel.map(|t| format!(" · {t}")).unwrap_or_default()
            ),
            unsicher,
            von_hand: von_hand.contains(&p),
            notiz: notiz_von(&p),
            path: p,
        });
    }

    // Bonusmaterial
    let mut stmt = conn.prepare(
        "SELECT x.path, x.titel, x.art, x.staffel, s.title, x.von_hand
         FROM extras x JOIN shows s ON x.show_id = s.id",
    )?;
    let ex: Vec<(String, String, String, Option<i64>, String, i64)> = stmt
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (p, titel, art, staffel, serie, hand) in ex {
        let unsicher = if art == "sonstiges" && hand == 0 {
            Some("Art nicht erkannt — bitte einordnen".into())
        } else {
            None
        };
        out.push(Eintrag {
            dateiname: datei(&p),
            aktuell: "extra".into(),
            beschreibung: format!(
                "{serie} · {}{} · {titel}",
                art_klartext(&art),
                staffel.map(|s| format!(" · Staffel {s}")).unwrap_or_default()
            ),
            unsicher,
            von_hand: hand == 1 || von_hand.contains(&p),
            notiz: notiz_von(&p),
            path: p,
        });
    }

    // Bewusst Ignoriertes — damit man es auch wiederfindet
    let mut stmt = conn.prepare("SELECT path FROM zuordnung WHERE ziel = 'ignorieren'")?;
    for p in stmt.query_map([], |r| r.get::<_, String>(0))?.flatten() {
        out.push(Eintrag {
            dateiname: datei(&p),
            aktuell: "nirgends".into(),
            beschreibung: "Ausgeblendet (von Hand)".into(),
            unsicher: None,
            von_hand: true,
            notiz: notiz_von(&p),
            path: p,
        });
    }

    if nur_unsichere {
        out.retain(|e| e.unsicher.is_some());
    }
    out.sort_by(|a, b| {
        b.unsicher
            .is_some()
            .cmp(&a.unsicher.is_some())
            .then_with(|| a.dateiname.to_lowercase().cmp(&b.dateiname.to_lowercase()))
    });
    Ok(out)
}

pub fn art_klartext(art: &str) -> &'static str {
    match art {
        "special" => "Special",
        "blooper" => "Bloopers",
        "behind" => "Hinter den Kulissen",
        "deleted" => "Gelöschte Szene",
        "featurette" => "Featurette",
        "interview" => "Interview",
        "trailer" => "Trailer",
        _ => "Sonstiges",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setzen_lesen_loeschen() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        let z = Ziel {
            ziel: "folge".into(),
            show_tmdb: Some(65334),
            staffel: Some(6),
            episode: Some(8),
            extra_art: None,
            tmdb_id: None,
        };
        setzen(&conn, r"D:\Movie\Miraculous\vampigami-mhub.mp4", &z).unwrap();
        let gelesen = fuer(&conn, r"D:\Movie\Miraculous\vampigami-mhub.mp4").unwrap().unwrap();
        assert_eq!(gelesen.ziel, "folge");
        assert_eq!(gelesen.show_tmdb, Some(65334));
        assert_eq!(gelesen.episode, Some(8));

        // Umbiegen auf Blooper muss gehen — genau das fehlte vorher
        let z2 = Ziel {
            ziel: "extra".into(),
            show_tmdb: Some(65334),
            staffel: Some(6),
            episode: None,
            extra_art: Some("blooper".into()),
            tmdb_id: None,
        };
        setzen(&conn, r"D:\Movie\Miraculous\vampigami-mhub.mp4", &z2).unwrap();
        let gelesen = fuer(&conn, r"D:\Movie\Miraculous\vampigami-mhub.mp4").unwrap().unwrap();
        assert_eq!(gelesen.ziel, "extra");
        assert_eq!(gelesen.extra_art.as_deref(), Some("blooper"));

        loeschen(&conn, r"D:\Movie\Miraculous\vampigami-mhub.mp4").unwrap();
        assert!(fuer(&conn, r"D:\Movie\Miraculous\vampigami-mhub.mp4").unwrap().is_none());
    }

    #[test]
    fn ignorierte_werden_normalisiert_geliefert() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        let z = Ziel {
            ziel: "ignorieren".into(),
            show_tmdb: None,
            staffel: None,
            episode: None,
            extra_art: None,
            tmdb_id: None,
        };
        setzen(&conn, r"C:\Movies\Doppel.mkv", &z).unwrap();
        let ign = ignorierte(&conn);
        assert!(ign.contains(&crate::ordnerwahl::norm(r"C:\Movies\Doppel.mkv")));
    }
}
