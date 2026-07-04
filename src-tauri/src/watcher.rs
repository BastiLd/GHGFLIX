use crate::{db, scanner, AppState};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Rebuild the filesystem watcher for the current set of libraries.
/// Called at startup and whenever libraries change.
pub fn rewatch(app: &AppHandle) {
    match build_watcher(app.clone()) {
        Ok(w) => {
            let state = app.state::<AppState>();
            *state.watcher.lock().unwrap() = Some(w);
        }
        Err(e) => eprintln!("[watcher] failed to start: {e}"),
    }
}

fn build_watcher(app: AppHandle) -> notify::Result<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<()>();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    })?;

    let paths: Vec<String> = {
        let state = app.state::<AppState>();
        let conn = state.conn.lock().unwrap();
        // user can turn live folder-watching off (Settings → Bibliothek)
        let enabled = db::get_setting(&conn, "watch_fs").ok().flatten().map(|v| v != "off").unwrap_or(true);
        if !enabled {
            Vec::new()
        } else {
            db::list_libraries(&conn).map(|l| l.into_iter().map(|x| x.path).collect()).unwrap_or_default()
        }
    };
    for p in &paths {
        let path = Path::new(p);
        if path.exists() {
            let _ = watcher.watch(path, RecursiveMode::Recursive);
        }
    }

    // Debounce thread: after a burst of FS events settles for 2s, trigger one rescan.
    let app2 = app.clone();
    std::thread::spawn(move || {
        loop {
            // block until the first event of a burst
            if rx.recv().is_err() {
                break; // watcher dropped -> exit
            }
            // drain follow-up events until 2s of quiet
            loop {
                match rx.recv_timeout(Duration::from_secs(2)) {
                    Ok(_) => continue,
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            trigger_scan(&app2);
        }
    });

    Ok(watcher)
}

fn trigger_scan(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.scanning.swap(true, Ordering::SeqCst) {
        return; // a scan is already running
    }
    let db_path = state.db_path.clone();
    let http = state.http.clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let _ = scanner::run_scan(db_path, http, app2.clone());
        app2.state::<AppState>().scanning.store(false, Ordering::SeqCst);
    });
}
