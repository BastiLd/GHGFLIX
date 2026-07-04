//! Auto-detection AND validation of mpv/ffmpeg/ffprobe executables.
//!
//! On Windows the `mpv` entry on PATH is usually `mpv.com` — the *console*
//! wrapper, which pops up an (empty) terminal window every time it is launched.
//! The GUI executable `mpv.exe` lives next to it and does NOT show a console.
//!
//! IMPORTANT lesson from the field: winget upgrades MOVE package folders, so a
//! stored absolute path (e.g. `…\WinGet\Links\ffmpeg.exe`) can silently die.
//! That broke thumbnails, quality detection and intro detection all at once.
//! Therefore stored paths are now VALIDATED on every start and re-detected
//! whenever they no longer resolve to an existing file.

use crate::db;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// Search a list of explicit directories, then every directory in PATH, for the
/// first file matching one of `names`. Returns the absolute path as a String.
fn find_exe(names: &[&str], extra_dirs: &[PathBuf]) -> Option<String> {
    let mut dirs: Vec<PathBuf> = extra_dirs.to_vec();
    if let Ok(path) = std::env::var("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    for dir in dirs {
        for name in names {
            let p = dir.join(name);
            if p.is_file() {
                return Some(p.to_string_lossy().into_owned());
            }
        }
    }
    None
}

/// Directories where winget installs ffmpeg-style packages (the package folder
/// name changes on every update, so we glob instead of hardcoding).
#[cfg(windows)]
fn winget_bin_dirs(hint: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(local) = std::env::var("LOCALAPPDATA") else { return out };
    let links = Path::new(&local).join("Microsoft").join("WinGet").join("Links");
    if links.is_dir() {
        out.push(links);
    }
    let pkgs = Path::new(&local).join("Microsoft").join("WinGet").join("Packages");
    if let Ok(rd) = std::fs::read_dir(&pkgs) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if !name.contains(hint) {
                continue;
            }
            // package dir → usually <pkg>/<ffmpeg-…>/bin
            let p = entry.path();
            if let Ok(rd2) = std::fs::read_dir(&p) {
                for e2 in rd2.flatten() {
                    let bin = e2.path().join("bin");
                    if bin.is_dir() {
                        out.push(bin);
                    }
                    if e2.path().is_dir() {
                        out.push(e2.path());
                    }
                }
            }
            out.push(p);
        }
    }
    out
}

#[cfg(not(windows))]
fn winget_bin_dirs(_hint: &str) -> Vec<PathBuf> {
    Vec::new()
}

fn common_dirs() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        vec![
            PathBuf::from("C:\\Program Files\\MPV Player"),
            PathBuf::from("C:\\Program Files (x86)\\MPV Player"),
            PathBuf::from("C:\\Program Files\\mpv"),
            PathBuf::from("C:\\ffmpeg\\bin"),
            PathBuf::from("C:\\Program Files\\ffmpeg\\bin"),
        ]
    }
    #[cfg(not(windows))]
    {
        vec![
            PathBuf::from("/usr/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/homebrew/bin"),
        ]
    }
}

/// Locate the GUI mpv executable (mpv.exe on Windows, mpv elsewhere).
fn detect_mpv() -> Option<String> {
    let mut dirs = common_dirs();
    dirs.extend(winget_bin_dirs("mpv"));
    #[cfg(windows)]
    let names: &[&str] = &["mpv.exe"];
    #[cfg(not(windows))]
    let names: &[&str] = &["mpv"];
    find_exe(names, &dirs)
}

fn detect_ffmpeg() -> Option<String> {
    let mut dirs = common_dirs();
    dirs.extend(winget_bin_dirs("ffmpeg"));
    #[cfg(windows)]
    let names: &[&str] = &["ffmpeg.exe"];
    #[cfg(not(windows))]
    let names: &[&str] = &["ffmpeg"];
    find_exe(names, &dirs)
}

fn detect_ffprobe() -> Option<String> {
    let mut dirs = common_dirs();
    dirs.extend(winget_bin_dirs("ffmpeg"));
    #[cfg(windows)]
    let names: &[&str] = &["ffprobe.exe"];
    #[cfg(not(windows))]
    let names: &[&str] = &["ffprobe"];
    find_exe(names, &dirs)
}

fn blank(v: &Option<String>) -> bool {
    v.as_deref().map(|s| s.trim().is_empty()).unwrap_or(true)
}

/// A stored path is usable when it is a bare command name (resolved via PATH —
/// verify that too) or an absolute path to an existing file.
fn resolves(stored: &str) -> bool {
    let s = stored.trim();
    if s.is_empty() {
        return false;
    }
    let p = Path::new(s);
    if p.components().count() > 1 {
        return p.is_file();
    }
    // bare name → must exist somewhere on PATH
    find_exe(&[s], &[]).is_some()
}

/// True if the stored value would resolve to the console wrapper mpv.com (the
/// cause of the flashing terminal window) — either a full path ending in mpv.com
/// with a sibling mpv.exe, or a bare "mpv"/"mpv.com" that PATH maps to mpv.com.
fn is_console_mpv(p: &str) -> bool {
    let low = p.trim().to_lowercase();
    if low == "mpv" || low == "mpv.com" {
        return true;
    }
    low.ends_with("mpv.com") && Path::new(p).with_extension("exe").is_file()
}

fn heal(conn: &Connection, key: &str, detect: fn() -> Option<String>, extra_bad: bool) {
    let cur = db::get_setting(conn, key).ok().flatten();
    let broken = blank(&cur) || extra_bad || cur.as_deref().map(|p| !resolves(p)).unwrap_or(true);
    if broken {
        if let Some(p) = detect() {
            let _ = db::set_setting(conn, key, &p);
        }
    }
}

/// Fill in mpv_path / ffmpeg_path / ffprobe_path with WORKING paths: unset paths
/// are detected, stored paths that no longer exist are re-detected (self-healing
/// after winget/package moves). Never overrides a deliberate choice that works.
pub fn ensure_player_paths(conn: &Connection) {
    let cur_mpv = db::get_setting(conn, "mpv_path").ok().flatten();
    let console = cur_mpv.as_deref().map(is_console_mpv).unwrap_or(false);
    heal(conn, "mpv_path", detect_mpv, console);
    heal(conn, "ffmpeg_path", detect_ffmpeg, false);
    heal(conn, "ffprobe_path", detect_ffprobe, false);
}

/// Resolve a working ffmpeg path RIGHT NOW (validate stored → heal → return).
/// Used by on-demand features (thumbnails) so they survive a mid-session break.
pub fn working_ffmpeg(conn: &Connection) -> Option<String> {
    let cur = db::get_setting(conn, "ffmpeg_path").ok().flatten();
    if let Some(p) = cur {
        if resolves(&p) {
            return Some(p);
        }
    }
    let found = detect_ffmpeg();
    if let Some(ref p) = found {
        let _ = db::set_setting(conn, "ffmpeg_path", p);
    }
    found
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub path: Option<String>,
    pub ok: bool,
    pub version: Option<String>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolsReport {
    pub mpv: ToolStatus,
    pub ffmpeg: ToolStatus,
    pub ffprobe: ToolStatus,
}

fn first_line_version(bin: &str) -> Option<String> {
    let mut cmd = std::process::Command::new(bin);
    cmd.arg("--version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().ok()?;
    let text = if out.stdout.is_empty() { out.stderr } else { out.stdout };
    let line = String::from_utf8_lossy(&text).lines().next()?.trim().to_string();
    if line.is_empty() { None } else { Some(line.chars().take(80).collect()) }
}

fn status_of(conn: &Connection, key: &str) -> ToolStatus {
    let path = db::get_setting(conn, key).ok().flatten().filter(|s| !s.trim().is_empty());
    let ok = path.as_deref().map(resolves).unwrap_or(false);
    let version = if ok { path.as_deref().and_then(first_line_version) } else { None };
    ToolStatus { path, ok, version }
}

/// Live status of all external tools (Settings → Werkzeuge). Re-heals first so
/// the report reflects the best the app can do right now.
pub fn tools_report(conn: &Connection) -> ToolsReport {
    ensure_player_paths(conn);
    ToolsReport {
        mpv: status_of(conn, "mpv_path"),
        ffmpeg: status_of(conn, "ffmpeg_path"),
        ffprobe: status_of(conn, "ffprobe_path"),
    }
}
