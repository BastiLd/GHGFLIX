//! Auswahl-Fenster für Ordner (Punkt 1 der Übergabe).
//!
//! Der Nutzer gibt einen Ordner an, wir durchsuchen ihn rekursiv nach Videos
//! und liefern jeden Fund einzeln zurück — mit erratenem Titel, Staffel/Folge
//! und Dateigröße. Die Oberfläche zeigt dazu ein Vorschaubild und lässt mehrere
//! Funde auf einmal bestätigen oder ablehnen.
//!
//! WARUM das nicht im Scanner steckt: `scanner.rs` arbeitet immer auf ganzen
//! Bibliotheken und entscheidet selbst, was aufgenommen wird. Hier soll der
//! Mensch VORHER entscheiden. Abgelehnte Dateien landen deshalb in einer
//! Ignorierliste (Einstellung `ignored_files`), die der Scanner bei jedem Lauf
//! beachtet — sonst wären sie beim nächsten Scan sofort wieder da. Genau diese
//! Falle ist der Grund, warum „ablehnen" mehr sein muss als „nicht anhaken".

use crate::{db, parser};
use anyhow::Result;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use walkdir::WalkDir;

/// Einstellungsschlüssel der Ignorierliste (JSON-Array normalisierter Pfade).
pub const IGNORE_KEY: &str = "ignored_files";

/// Dateien unter 1 MB sind fast immer Reste oder Werbeschnipsel. Bewusst so
/// niedrig, damit kurze Zeichentrickfolgen nicht verschwinden — dieselbe Grenze
/// wie im Server-Scanner.
const MIN_VIDEO_BYTES: u64 = 1024 * 1024;

/// Obergrenze, damit ein versehentlich gewähltes Laufwerk die Oberfläche nicht
/// mit 50.000 Zeilen erschlägt. Wird sie erreicht, sagt das Fenster das auch.
const MAX_HITS: usize = 2000;

/// Ordner, die weder Medien enthalten noch je enthalten sollten.
const SKIP_DIRS: &[&str] = &[
    "node_modules", "@eaDir", "$RECYCLE.BIN", "System Volume Information",
    "AppData", "#recycle", "lost+found", "BDMV", "CERTIFICATE", "VIDEO_TS", "AUDIO_TS",
];

fn skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.iter().any(|s| s.eq_ignore_ascii_case(name))
}

fn file_stem(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((s, _)) => s.to_string(),
        None => name.to_string(),
    }
}

/// Scene-Releases legen winzige „sample"/„trailer"-Schnipsel neben die echte
/// Datei — die will hier niemand sehen.
fn is_junk_clip(stem: &str) -> bool {
    stem.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .any(|t| t == "sample" || t == "trailer")
}

/// Pfade werden zum Vergleichen vereinheitlicht: Schrägstriche statt
/// Backslashes, kein Schlussstrich, klein geschrieben.
///
/// Klein geschrieben WARUM: unter Windows sind `Z:\Serien` und `z:\serien`
/// dieselbe Datei, und genau dort läuft die Desktop-App. Unter Linux wäre das
/// theoretisch zu grob — praktisch gibt es in echten Sammlungen keine zwei
/// Videos, die sich nur in der Groß-/Kleinschreibung unterscheiden.
pub fn norm(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Die Ignorierliste als Menge normalisierter Pfade.
pub fn ignored(conn: &Connection) -> HashSet<String> {
    let raw = db::get_setting(conn, IGNORE_KEY).ok().flatten().unwrap_or_default();
    serde_json::from_str::<Vec<String>>(&raw)
        .unwrap_or_default()
        .into_iter()
        .map(|p| norm(&p))
        .collect()
}

/// Ignorierliste ersetzen (die Pfade werden normalisiert abgelegt).
pub fn set_ignored(conn: &Connection, paths: &HashSet<String>) -> Result<()> {
    let mut v: Vec<&String> = paths.iter().collect();
    v.sort();
    db::set_setting(conn, IGNORE_KEY, &serde_json::to_string(&v)?)?;
    Ok(())
}

/// Ein gefundenes Video mit allem, was die Oberfläche zum Anzeigen braucht.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderHit {
    pub path: String,
    pub name: String,
    /// Ordner, in dem die Datei liegt — die Oberfläche gruppiert danach.
    pub dir: String,
    pub size_bytes: u64,
    /// „movie" oder „episode" — geraten, der Nutzer kann es beim Bestätigen
    /// noch umstellen.
    pub kind: String,
    pub title: String,
    pub year: Option<i64>,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    /// Steht die Datei schon in der Bibliothek? Dann ist nichts zu tun.
    pub in_library: bool,
    /// Wurde sie früher schon abgelehnt?
    pub ignored: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPreview {
    pub path: String,
    pub hits: Vec<FolderHit>,
    /// Übersprungene Dateien (Schnipsel, zu klein) — nur als Zahl, damit klar
    /// ist, dass da noch etwas war.
    pub skipped: i64,
    /// Wurde bei MAX_HITS abgeschnitten?
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub accepted: i64,
    pub rejected: i64,
    pub library_id: Option<i64>,
    pub library_created: bool,
    /// Wie viele abgelehnte Dateien aus der Bibliothek entfernt wurden.
    pub removed: i64,
}

/// Ist die Datei schon indexiert (Film, Folge oder Qualitätsvariante)?
fn in_library(conn: &Connection, path: &str) -> bool {
    let q = |sql: &str| -> bool {
        conn.query_row(sql, [path], |r| r.get::<_, i64>(0))
            .optional()
            .ok()
            .flatten()
            .is_some()
    };
    q("SELECT 1 FROM movies WHERE path=?1")
        || q("SELECT 1 FROM episodes WHERE path=?1")
        || q("SELECT 1 FROM episode_files WHERE path=?1")
}

/// Einen Ordner rekursiv nach Videos durchsuchen.
pub fn preview(conn: &Connection, root: &str) -> Result<FolderPreview> {
    let rootp = Path::new(root);
    if !rootp.is_dir() {
        anyhow::bail!("Das ist kein Ordner: {root}");
    }
    let ign = ignored(conn);
    let mut hits = Vec::new();
    let mut skipped: i64 = 0;
    let mut truncated = false;

    let walk = WalkDir::new(rootp)
        .max_depth(8)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_type().is_dir() || !skip_dir(&e.file_name().to_string_lossy()));

    for entry in walk.filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !parser::is_video(&name) {
            continue;
        }
        let stem = file_stem(&name);
        if is_junk_clip(&stem) {
            skipped += 1;
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if size < MIN_VIDEO_BYTES {
            skipped += 1;
            continue;
        }
        if hits.len() >= MAX_HITS {
            truncated = true;
            break;
        }
        let path = entry.path().to_string_lossy().to_string();
        let dir = entry
            .path()
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let parent_name = entry
            .path()
            .parent()
            .and_then(|p| p.file_name())
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        // Erst Staffel/Folge probieren. Trifft das, ist es eine Serienfolge —
        // der Serientitel steckt dann meist im Ordnernamen, nicht im Dateinamen.
        let se = parser::parse_episode(&stem, &parent_name);
        let (kind, title, year, season, episode) = match se {
            Some((s, e)) => {
                let from_dir = parser::clean_show_title(&parent_name);
                let title = if from_dir.trim().is_empty() || parser::parse_season_from_dir(&parent_name).is_some() {
                    // Der Ordner heißt nur „Season 3" — dann eine Ebene höher.
                    entry
                        .path()
                        .parent()
                        .and_then(|p| p.parent())
                        .and_then(|p| p.file_name())
                        .map(|s| parser::clean_show_title(&s.to_string_lossy()))
                        .filter(|s| !s.trim().is_empty())
                        .unwrap_or_else(|| parser::clean_show_title(&stem))
                } else {
                    from_dir
                };
                ("episode".to_string(), title, None, Some(s), Some(e))
            }
            None => {
                let (t, y) = parser::parse_title_year(&stem);
                ("movie".to_string(), t, y, None, None)
            }
        };

        hits.push(FolderHit {
            in_library: in_library(conn, &path),
            ignored: ign.contains(&norm(&path)),
            path,
            name,
            dir,
            size_bytes: size,
            kind,
            title,
            year,
            season,
            episode,
        });
    }

    hits.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(FolderPreview { path: root.to_string(), hits, skipped, truncated })
}

/// Auswahl übernehmen: Bestätigtes kommt in die Bibliothek, Abgelehntes in die
/// Ignorierliste (und wird, falls schon indexiert, wieder entfernt).
///
/// `root` ist der Ordner, den der Nutzer im Fenster durchsucht hat. Ist er
/// noch von keiner Bibliothek abgedeckt, wird er als neue Bibliothek angelegt —
/// sonst hätten die bestätigten Dateien keinen Weg in den Index.
pub fn apply(
    conn: &Connection,
    root: &str,
    kind: &str,
    accept: &[String],
    reject: &[String],
) -> Result<ImportSummary> {
    // ── Abgelehntes merken ──────────────────────────────────────────────────
    let mut ign = ignored(conn);
    for p in reject {
        ign.insert(norm(p));
    }
    // Bestätigtes darf NICHT ignoriert bleiben — sonst wäre ein früher
    // abgelehnter Fund für immer verloren, auch wenn der Nutzer es sich
    // anders überlegt.
    for p in accept {
        ign.remove(&norm(p));
    }
    set_ignored(conn, &ign)?;

    // Abgelehnte Dateien, die schon im Index stehen, wieder herauswerfen.
    let mut removed = 0i64;
    for p in reject {
        removed += conn.execute("DELETE FROM movies WHERE path=?1", [p]).unwrap_or(0) as i64;
        removed += conn.execute("DELETE FROM episode_files WHERE path=?1", [p]).unwrap_or(0) as i64;
        removed += conn.execute("DELETE FROM episodes WHERE path=?1", [p]).unwrap_or(0) as i64;
    }

    // ── Bibliothek sicherstellen ────────────────────────────────────────────
    let mut library_id = None;
    let mut library_created = false;
    if !accept.is_empty() {
        let rn = norm(root);
        let libs = db::list_libraries(conn)?;
        let covering = libs.iter().find(|l| {
            let ln = norm(&l.path);
            rn == ln || rn.starts_with(&format!("{ln}/"))
        });
        match covering {
            Some(l) => library_id = Some(l.id),
            None => {
                let k = if kind == "movie" { "movie" } else { "tv" };
                let id = db::add_library(conn, root, k)?;
                library_id = Some(id);
                library_created = true;
            }
        }
    }

    Ok(ImportSummary {
        accepted: accept.len() as i64,
        rejected: reject.len() as i64,
        library_id,
        library_created,
        removed,
    })
}
