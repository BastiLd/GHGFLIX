//! Jellyfin-style intro detection via audio-energy fingerprints.
//! Decodes the first minutes of each episode with ffmpeg, builds a per-window
//! 2D energy envelope (broadband + high-pass RMS), then finds the earliest long
//! contiguous matching run between consecutive episodes of a season = the intro.

use crate::db;
use anyhow::Result;
use rusqlite::Connection;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Emitter};

/// Build a Command that never pops up a console window on Windows.
/// ffmpeg is a console app, so a bare spawn would flash an (empty) terminal
/// for every episode it decodes — looks like an endless loop of windows.
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

const SR: u32 = 8000;
const WIN: usize = 800; // 0.1s window
const WIN_PER_SEC: f64 = SR as f64 / WIN as f64; // 10
const MAX_SHIFT: i64 = 1500; // +/- 150s alignment search
const THR: f32 = 0.5; // per-window distance threshold (summed log units)
// defaults; both are user-tunable via settings (intro_scan_min / intro_min_sec)
const DEFAULT_SCAN_MIN: u64 = 12;
const DEFAULT_MIN_SEC: u64 = 12;

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

fn ffmpeg_bin(conn: &Connection) -> String {
    db::get_setting(conn, "ffmpeg_path")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "ffmpeg".into())
}

fn decode_features(ffmpeg: &str, path: &str, max_seconds: u64) -> Vec<[f32; 2]> {
    let out = quiet_command(ffmpeg)
        .args([
            "-v", "quiet", "-nostdin",
            "-t", &max_seconds.to_string(),
            "-i", path,
            "-ac", "1",
            "-ar", &SR.to_string(),
            "-f", "f32le", "-",
        ])
        .output();
    let bytes = match out {
        Ok(o) => o.stdout,
        Err(_) => return Vec::new(),
    };
    let n = bytes.len() / 4;
    let mut feats: Vec<[f32; 2]> = Vec::with_capacity(n / WIN + 1);
    let mut i = 0usize;
    while i + WIN <= n {
        let mut sum = 0f32;
        let mut hp = 0f32;
        let mut prev = 0f32;
        for j in 0..WIN {
            let b = i + j;
            let s = f32::from_le_bytes([bytes[b * 4], bytes[b * 4 + 1], bytes[b * 4 + 2], bytes[b * 4 + 3]]);
            sum += s * s;
            let d = s - prev;
            hp += d * d;
            prev = s;
        }
        let rms = (sum / WIN as f32).sqrt();
        let hrms = (hp / WIN as f32).sqrt();
        feats.push([(rms + 1e-6).ln(), (hrms + 1e-6).ln()]);
        i += WIN;
    }
    if !feats.is_empty() {
        let (mut m0, mut m1) = (0f32, 0f32);
        for f in &feats {
            m0 += f[0];
            m1 += f[1];
        }
        m0 /= feats.len() as f32;
        m1 /= feats.len() as f32;
        for f in &mut feats {
            f[0] -= m0;
            f[1] -= m1;
        }
    }
    feats
}

#[inline]
fn dist(a: &[f32; 2], b: &[f32; 2]) -> f32 {
    (a[0] - b[0]).abs() + (a[1] - b[1]).abs()
}

/// Returns (startWinA, endWinA, shift) for the earliest common run >= min_run.
/// B index = A index + shift.
fn find_intro(a: &[[f32; 2]], b: &[[f32; 2]], min_run: usize) -> Option<(usize, usize, i64)> {
    let la = a.len() as i64;
    let lb = b.len() as i64;
    let mut best: Option<(usize, usize, i64)> = None;
    let mut best_start = usize::MAX;
    let mut best_len = min_run;

    let mut d = -MAX_SHIFT;
    while d <= MAX_SHIFT {
        let i_lo = 0i64.max(-d);
        let i_hi = la.min(lb - d);
        let mut ii = i_lo;
        let mut cur = 0usize;
        let mut cur_start = 0usize;
        while ii < i_hi {
            let j = ii + d;
            if dist(&a[ii as usize], &b[j as usize]) < THR {
                if cur == 0 {
                    cur_start = ii as usize;
                }
                cur += 1;
                if cur >= min_run && (cur_start < best_start || (cur_start == best_start && cur > best_len)) {
                    best_start = cur_start;
                    best_len = cur;
                    best = Some((cur_start, ii as usize, d));
                }
            } else {
                cur = 0;
            }
            ii += 1;
        }
        d += 1;
    }
    best
}

/// A consecutive same-season run of >= 2 episodes = one analysable unit.
struct SeasonGroup {
    title: String,
    season: i64,
    eps: Vec<crate::models::Episode>,
}

pub fn run_detect(db_path: PathBuf, app: AppHandle, only_show: Option<i64>) -> Result<()> {
    let conn = db::open(&db_path)?;
    // self-heal a moved/broken ffmpeg path before giving up
    crate::paths::ensure_player_paths(&conn);
    let ffmpeg = ffmpeg_bin(&conn);
    if quiet_command(&ffmpeg).arg("-version").output().is_err() {
        emit(&app, "error", "ffmpeg nicht gefunden – Pfad in den Einstellungen setzen".into(), 0, 0);
        return Ok(());
    }
    // user-tunable analysis window + minimum intro length
    let get_u64 = |key: &str, def: u64| -> u64 {
        db::get_setting(&conn, key)
            .ok()
            .flatten()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(def)
    };
    let max_seconds = get_u64("intro_scan_min", DEFAULT_SCAN_MIN).min(30) * 60;
    let min_run = (get_u64("intro_min_sec", DEFAULT_MIN_SEC).clamp(4, 120) as f64 * WIN_PER_SEC) as usize;

    let show_ids: Vec<i64> = match only_show {
        Some(id) => vec![id],
        None => db::list_shows(&conn)?.into_iter().map(|s| s.id).collect(),
    };

    // Build the work list up front so we know the exact number of episodes that
    // will be decoded — that's what drives the progress bar + ETA on the client.
    let mut groups: Vec<SeasonGroup> = Vec::new();
    for show_id in &show_ids {
        let eps = db::list_episodes(&conn, *show_id)?;
        if eps.is_empty() {
            continue;
        }
        let title = eps[0].show_title.clone().unwrap_or_default();
        // episodes come back ordered by (season, episode)
        let mut start = 0usize;
        while start < eps.len() {
            let season = eps[start].season;
            let mut end = start;
            while end < eps.len() && eps[end].season == season {
                end += 1;
            }
            if end - start >= 2 {
                groups.push(SeasonGroup { title: title.clone(), season, eps: eps[start..end].to_vec() });
            }
            start = end;
        }
    }

    // `total` = episodes to decode; `done` increments per decoded episode.
    let total: i64 = groups.iter().map(|g| g.eps.len() as i64).sum();
    if total == 0 {
        emit(&app, "done", "Keine Serien mit genügend Folgen für die Intro-Erkennung".into(), 0, 0);
        let _ = app.emit("library://updated", ());
        return Ok(());
    }

    emit(&app, "start", "Intro-Erkennung läuft …".into(), 0, total);

    let mut done = 0i64;
    for g in &groups {
        // 1) decode every episode of this season, one progress tick each
        let mut feats: Vec<Vec<[f32; 2]>> = Vec::with_capacity(g.eps.len());
        for e in &g.eps {
            emit(
                &app,
                "match",
                format!("Intro: {} · S{:02}E{:02}", g.title, g.season, e.episode),
                done,
                total,
            );
            feats.push(decode_features(&ffmpeg, &e.path, max_seconds));
            done += 1;
            emit(&app, "match", format!("Intro: {} · S{:02}", g.title, g.season), done, total);
        }

        // 2) match consecutive episodes and store the detected intro windows
        for w in 0..g.eps.len() - 1 {
            let fa = &feats[w];
            let fb = &feats[w + 1];
            if fa.is_empty() || fb.is_empty() {
                continue;
            }
            if let Some((s, e, d)) = find_intro(fa, fb, min_run) {
                let a_start = s as f64 / WIN_PER_SEC;
                let a_end = e as f64 / WIN_PER_SEC;
                let _ = db::update_episode_intro(&conn, g.eps[w].id, a_start, a_end);
                let bs = ((s as i64 + d).max(0)) as f64 / WIN_PER_SEC;
                let be = ((e as i64 + d).max(0)) as f64 / WIN_PER_SEC;
                let _ = db::update_episode_intro(&conn, g.eps[w + 1].id, bs, be);
            }
        }
    }

    emit(&app, "done", "Intro-Erkennung fertig".into(), total, total);
    let _ = app.emit("library://updated", ());
    Ok(())
}
