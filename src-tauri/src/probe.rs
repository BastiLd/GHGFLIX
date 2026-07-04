//! Reads each file's *real* video resolution with ffprobe (so quality labels are
//! accurate for every file regardless of how it's named) and extracts on-the-fly
//! JPEG thumbnails for the seek-bar preview with ffmpeg.

use crate::db;
use anyhow::Result;
use rusqlite::Connection;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Emitter};

/// Build a Command that never pops up a console window on Windows.
fn quiet_command(bin: &str) -> Command {
    let cmd = Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = cmd;
        cmd.creation_flags(CREATE_NO_WINDOW);
        return cmd;
    }
    #[cfg(not(windows))]
    cmd
}

fn ffprobe_bin(conn: &Connection) -> String {
    db::get_setting(conn, "ffprobe_path")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "ffprobe".into())
}

fn ffmpeg_bin(conn: &Connection) -> String {
    db::get_setting(conn, "ffmpeg_path")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "ffmpeg".into())
}

fn parse_wxh(s: &str) -> Option<(i64, i64)> {
    let (w, h) = s.trim().split_once('x')?;
    Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
}

/// Read the resolution of the first video stream. Tries ffprobe, falls back to
/// parsing ffmpeg's stderr (so it still works if only ffmpeg is present).
pub fn read_resolution(ffprobe: &str, ffmpeg: &str, path: &str) -> Option<(i64, i64)> {
    // 1) ffprobe → "1920x1080"
    if let Ok(out) = quiet_command(ffprobe)
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=s=x:p=0",
            path,
        ])
        .output()
    {
        if out.status.success() {
            if let Some(dims) = parse_wxh(&String::from_utf8_lossy(&out.stdout)) {
                if dims.0 > 0 && dims.1 > 0 {
                    return Some(dims);
                }
            }
        }
    }

    // 2) ffmpeg fallback: scrape the "Video:" line for the first WxH token.
    if let Ok(out) = quiet_command(ffmpeg).args(["-hide_banner", "-i", path]).output() {
        let err = String::from_utf8_lossy(&out.stderr);
        for line in err.lines().filter(|l| l.contains(": Video:")) {
            if let Some(dims) = scrape_wxh(line) {
                return Some(dims);
            }
        }
    }
    None
}

/// First `WIDTHxHEIGHT` token (2–5 digits each) in a string.
fn scrape_wxh(line: &str) -> Option<(i64, i64)> {
    let bytes: Vec<char> = line.chars().collect();
    let n = bytes.len();
    let is_d = |c: char| c.is_ascii_digit();
    let mut i = 0;
    while i < n {
        if is_d(bytes[i]) {
            let start = i;
            while i < n && is_d(bytes[i]) {
                i += 1;
            }
            let wlen = i - start;
            if (2..=5).contains(&wlen) && i < n && bytes[i] == 'x' {
                let xpos = i;
                i += 1;
                let hstart = i;
                while i < n && is_d(bytes[i]) {
                    i += 1;
                }
                let hlen = i - hstart;
                if (2..=5).contains(&hlen) {
                    let w: i64 = bytes[start..xpos].iter().collect::<String>().parse().ok()?;
                    let h: i64 = bytes[hstart..i].iter().collect::<String>().parse().ok()?;
                    if w > 0 && h > 0 {
                        return Some((w, h));
                    }
                }
            }
        } else {
            i += 1;
        }
    }
    None
}

/// Extract a single JPEG frame at `time_sec` (fast keyframe seek). Returns raw bytes.
pub fn thumbnail(ffmpeg: &str, path: &str, time_sec: f64) -> Result<Vec<u8>> {
    let t = if time_sec < 0.0 { 0.0 } else { time_sec };
    let out = quiet_command(ffmpeg)
        .args([
            "-nostdin", "-v", "error",
            "-ss", &format!("{t:.3}"),
            "-i", path,
            "-frames:v", "1",
            "-vf", "scale=320:-2",
            "-q:v", "5",
            "-f", "mjpeg",
            "-",
        ])
        .output()?;
    if out.stdout.is_empty() {
        anyhow::bail!("kein Bild extrahiert");
    }
    Ok(out.stdout)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    stage: String,
    message: String,
    current: i64,
    total: i64,
}

fn emit(app: &AppHandle, stage: &str, message: String, current: i64, total: i64) {
    let _ = app.emit("scan://progress", Progress { stage: stage.into(), message, current, total });
}

/// Backfill width/height for every movie & episode that doesn't have it yet.
/// Shared by the scan pass and the standalone "Qualität neu erkennen" command.
pub fn run_probe_pass(conn: &Connection, app: &AppHandle, announce: bool) -> Result<()> {
    // re-validate tool paths first — a moved ffprobe would otherwise mark every
    // file 0×0 ("keine Qualität") until the user notices
    crate::paths::ensure_player_paths(conn);
    let ffprobe = ffprobe_bin(conn);
    let ffmpeg = ffmpeg_bin(conn);

    let mut work: Vec<(&str, i64, String)> = Vec::new();
    for (id, p) in db::movies_missing_dims(conn)? {
        work.push(("movie", id, p));
    }
    // episodes are probed per physical file (each quality reads its own resolution)
    for (id, p) in db::episode_files_missing_dims(conn)? {
        work.push(("epfile", id, p));
    }
    let total = work.len() as i64;
    if total == 0 {
        if announce {
            emit(app, "done", "Qualität bereits für alle Dateien erkannt".into(), 0, 0);
        }
        return Ok(());
    }
    if announce {
        emit(app, "start", "Auflösung wird gelesen …".into(), 0, total);
    }

    // Probe with a small worker pool — ffprobe is I/O bound, so 4 parallel readers
    // cut a full-library pass to roughly a quarter of the time.
    const WORKERS: usize = 4;
    let (tx, rx) = std::sync::mpsc::channel::<(String, i64, i64, i64)>();
    let chunk_size = work.len().div_ceil(WORKERS);
    let mut handles = Vec::new();
    for chunk in work.chunks(chunk_size.max(1)) {
        let chunk: Vec<(String, i64, String)> =
            chunk.iter().map(|(k, i, p)| (k.to_string(), *i, p.clone())).collect();
        let tx = tx.clone();
        let (fp, fm) = (ffprobe.clone(), ffmpeg.clone());
        handles.push(std::thread::spawn(move || {
            for (kind, id, path) in chunk {
                // 0×0 marks a failed read; it is retried on the next pass (self-heal)
                let (w, h) = read_resolution(&fp, &fm, &path).unwrap_or((0, 0));
                if tx.send((kind, id, w, h)).is_err() {
                    return;
                }
            }
        }));
    }
    drop(tx);
    let mut i = 0i64;
    for (kind, id, w, h) in rx {
        emit(app, "probe", "Auflösung wird gelesen …".into(), i, total);
        if kind == "movie" {
            let _ = db::set_movie_dims(conn, id, w, h);
        } else {
            let _ = db::set_episode_file_dims(conn, id, w, h);
        }
        i += 1;
    }
    for h in handles {
        let _ = h.join();
    }
    // pick each episode's best file as its primary (path + displayed quality)
    let _ = db::set_all_episode_primaries(conn);
    if announce {
        emit(app, "done", "Qualität aktualisiert".into(), total, total);
        let _ = app.emit("library://updated", ());
    }
    Ok(())
}

/// Standalone entry point for the "Qualität neu erkennen" command.
pub fn run_probe_all(db_path: PathBuf, app: AppHandle) -> Result<()> {
    let conn = db::open(&db_path)?;
    run_probe_pass(&conn, &app, true)
}
