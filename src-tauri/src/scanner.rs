use crate::{db, parser, probe, tmdb::Tmdb};
use anyhow::Result;
use regex::Regex;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub stage: String,
    pub message: String,
    pub current: i64,
    pub total: i64,
}

fn emit(app: &AppHandle, stage: &str, message: String, current: i64, total: i64) {
    let _ = app.emit(
        "scan://progress",
        ScanProgress { stage: stage.into(), message, current, total },
    );
}

fn file_stem(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((s, _)) => s.to_string(),
        None => name.to_string(),
    }
}

/// Scene releases ship tiny "sample"/"trailer" clips next to the real file —
/// indexing them creates phantom duplicate entries, so we skip them.
fn is_junk_clip(stem: &str) -> bool {
    stem.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .any(|t| t == "sample" || t == "trailer")
}

/// Full scan: index files, prune deleted, then match metadata. Runs on a worker thread.
pub fn run_scan(db_path: PathBuf, http: reqwest::Client, app: AppHandle) -> Result<()> {
    let conn = db::open(&db_path)?;
    emit(&app, "start", "Scan gestartet …".into(), 0, 0);

    let libs = db::list_libraries(&conn)?;
    // Make sure shows indexed before stable keys existed get one before we scan,
    // so identified/renamed shows are re-found by key, not duplicated.
    backfill_show_keys(&conn, &libs)?;
    for lib in &libs {
        let p = Path::new(&lib.path);
        if !p.exists() {
            continue;
        }
        emit(&app, "index", format!("Durchsuche {}", lib.path), 0, 0);
        if lib.kind == "movie" {
            scan_movies(&conn, p)?;
        } else if lib.kind == "mixed" {
            // Erst Folgen einsammeln (klare SxxEyy-Muster), danach alles, was
            // dabei nicht als Folge erkannt wurde, als Film — so darf ein
            // Ordner Serien UND Filme gleichzeitig enthalten.
            scan_tv(&conn, p)?;
            scan_movies(&conn, p)?;
        } else {
            scan_tv(&conn, p)?;
        }
    }

    prune_missing(&conn)?;
    emit(&app, "index", "Dateien indexiert".into(), 0, 0);
    let _ = app.emit("library://updated", ());

    let key = db::get_setting(&conn, "tmdb_key")?.unwrap_or_default();
    if key.trim().is_empty() {
        emit(&app, "warn", "Kein TMDb-Key – Metadaten übersprungen".into(), 0, 0);
    } else {
        let lang = db::get_setting(&conn, "tmdb_lang")?.unwrap_or_else(|| "de-DE".into());
        let tmdb = Tmdb::new(http, key, lang);
        // When auto-match is off the user only wants manual identification — we
        // still refresh already-matched items, just don't auto-search new ones.
        let auto_match = db::get_setting(&conn, "auto_match")?.map(|v| v != "off").unwrap_or(true);
        tauri::async_runtime::block_on(match_all(&conn, &tmdb, &app, auto_match))?;
    }

    // Read the real resolution of any newly-added files for accurate quality labels.
    let _ = probe::run_probe_pass(&conn, &app, false);

    // Re-link watched-progress + favorites to the fresh rows (via TMDb ids) so the
    // "Gesehen"-Stand survives even a full "Bibliothek neu aufbauen".
    let _ = db::remap_stale_refs(&conn);

    emit(&app, "done", "Fertig".into(), 0, 0);
    let _ = app.emit("library://updated", ());
    Ok(())
}

/// Ordner, deren Inhalt Zusatzmaterial zu einem Titel ist — Ausschnitte,
/// Interviews, gelöschte Szenen. So etwas ist NIE ein eigenständiger Film.
fn is_bonus_dir(name: &str) -> bool {
    let t = name.trim().to_lowercase();
    if matches!(
        t.as_str(),
        "extras" | "extra" | "featurettes" | "featurette" | "bonus" | "bonusmaterial"
            | "deleted scenes" | "deleted scene" | "geloeschte szenen" | "gelöschte szenen"
            | "inside the episode" | "behind the scenes" | "making of" | "interviews"
            | "interview" | "webisodes" | "webisode" | "trailers" | "featurettes and deleted scenes"
    ) {
        return true;
    }
    /* Zusammengesetzte Namen wie „Special Extras Season 1", „Bonus Disc 2",
       „Season 3 Extras" (gemessen 23.09.2026 in Z:\SM-MOONDOOM\Series\The
       Newsroom). Verlangt wird ein Bonuswort PLUS ein Staffel-/Disk-Hinweis
       oder ein zweites Bonuswort — ein Ordner, der NUR „Extras (2005)" heißt,
       ist die gleichnamige Serie und bleibt eine Serie. */
    let woerter: Vec<&str> = t.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    let anzahl_bonus = woerter
        .iter()
        .filter(|w| {
            matches!(**w, "extras" | "extra" | "featurettes" | "featurette" | "bonus" | "bloopers" | "outtakes")
        })
        .count();
    let staffel_hinweis = woerter
        .iter()
        .any(|w| matches!(*w, "season" | "staffel" | "saison" | "disc" | "disk" | "special" | "specials"));
    anzahl_bonus >= 2 || (anzahl_bonus == 1 && staffel_hinweis)
        || t.contains("deleted scene") || t.contains("behind the scenes") || t.contains("inside the episode")
}

/// True, wenn die Datei innerhalb einer Serien-Ordnerstruktur liegt —
/// unterhalb eines Staffel-Ordners („Season 2") oder eines Bonus-Ordners
/// („Extras", „Featurettes", „Deleted Scenes").
///
/// WARUM (gemessen am 19.08.2026): In den Serienordnern lagen 83 Schnipsel wie
/// `The Newsroom …\Featurettes\Season 1\Inside the Episode\Amen.mkv` und
/// `Suits …\Extras\Season 02\Gag Reel.mkv`. Ohne Episodennummer wurden sie zu
/// „Filmen" — und die automatische TMDb-Suche hängte ihnen dann irgendeinen
/// echten gleichnamigen Kinofilm an („Amen." von 2002, „Gag" von 2006,
/// „Sucker Punch"). Die Bibliothek war dadurch voller Geisterfilme.
fn is_series_side_content(root: &Path, path: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    let comps: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    // letzte Komponente ist die Datei selbst — nur die Ordner darüber zählen
    comps
        .iter()
        .take(comps.len().saturating_sub(1))
        .any(|c| is_pure_season_dir(c) || is_bonus_dir(c))
}

/// Zusatzmaterial der Serie zuordnen, zu der der Ordner gehört.
///
/// Die Serie wird über denselben Gruppierungsschlüssel gefunden, den auch
/// `scan_tv` benutzt — dadurch landet `Suits …\Extras\Season 02\Gag Reel.mkv`
/// zuverlässig bei der Serie „Suits" und nicht bei einer neu erfundenen.
fn merke_extra(conn: &Connection, root: &Path, path: &Path) -> Result<bool> {
    let pfad = path.to_string_lossy().to_string();
    let name = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let stem = file_stem(&name);

    /* Den Serienordner von der DATEI AUS nach oben suchen und dabei alle
       Staffel- und Bonusordner überspringen. show_source_name() taugt hier
       nicht: bei
         Avengers\The Newsroom …\Featurettes\Season 1\Inside the Episode\Amen.mkv
       hält es „Featurettes" für den Serienordner (es nimmt den Ordner ÜBER dem
       ersten Staffelordner) — die Serie wurde dadurch nie gefunden und alle 33
       Newsroom-Extras fielen still unter den Tisch (gemessen 19.08.2026). */
    let rel_zum_ordner = path.strip_prefix(root).unwrap_or(path);
    let alle: Vec<String> = rel_zum_ordner
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    let ohne_datei = &alle[..alle.len().saturating_sub(1)];
    let serien_ordner = ohne_datei
        .iter()
        .rev()
        .find(|c| !is_pure_season_dir(c) && !is_bonus_dir(c) && !parser::is_generic_dir(c));

    let quelle = match serien_ordner {
        Some(o) => parser::strip_domain_suffix(o),
        // Die Datei liegt direkt in der Bibliothek unter einem Bonusordner —
        // dann ist der Bibliotheksordner selbst die Serie.
        None => root
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default(),
    };
    let key = parser::show_key(&quelle);
    let show_id = match db::show_id_for_key(conn, &key)? {
        Some(id) => id,
        // Noch keine Serie zu diesem Ordner (z.B. nur Bonusmaterial vorhanden):
        // dann gibt es nichts, woran es hängen könnte — beim nächsten Scan,
        // wenn auch Folgen da sind, wird es nachgeholt.
        None => return Ok(false),
    };

    // Ordner ZWISCHEN Bibliothek und Datei bestimmen Art und Staffel.
    let rel = path.strip_prefix(root).unwrap_or(path);
    let mut ordner: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    ordner.pop(); // Dateiname weg
    let (art, staffel) = crate::extras::art_und_staffel(&ordner, &stem);
    crate::extras::merken(conn, show_id, &pfad, &stem, &art, staffel)?;
    Ok(true)
}

fn scan_movies(conn: &Connection, root: &Path) -> Result<()> {
    // Im Auswahl-Fenster abgelehnte Dateien bleiben draußen. Ohne diese Prüfung
    // wäre jede Ablehnung beim nächsten Scan wieder rückgängig gemacht.
    let mut ignored = crate::ordnerwahl::ignored(conn);
    // von Hand ausgeblendete Dateien gehoeren ebenso dauerhaft draussen
    ignored.extend(crate::zuordnung::ignorierte(conn));
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !parser::is_video(&name) {
            continue;
        }
        let stem = file_stem(&name);
        if is_junk_clip(&stem) {
            continue;
        }
        let path = entry.path().to_string_lossy().to_string();
        if ignored.contains(&crate::ordnerwahl::norm(&path)) {
            continue;
        }
        // Handentscheidung schlägt alles: Was der Nutzer als Folge, Bonus oder
        // ausgeblendet festgelegt hat, wird hier NICHT zum Film gemacht.
        if let Some(z) = crate::zuordnung::fuer(conn, &path)? {
            if z.ziel != "film" {
                db::delete_movie_by_path(conn, &path)?;
                continue;
            }
        }
        // In einer "mixed"-Bibliothek hat scan_tv() diese Datei schon als Folge
        // beansprucht (SxxEyy erkannt) — dann NICHT zusätzlich als Film eintragen.
        if db::show_id_of_episode_file(conn, &path)?.is_some() {
            continue;
        }
        // Bonusmaterial/Staffel-Inhalt einer Serie ist kein Film (siehe oben) —
        // es wird stattdessen als Zusatzmaterial der Serie festgehalten.
        /* Bonusmaterial wird NIE zum Film — auch dann nicht, wenn (noch) keine
           Serie dazu existiert. Versucht am 23.09.2026 und verworfen: ohne
           Serie landete „Gag Reel.mkv" wieder als Film und die TMDb-Bewertung
           hängte ihm den Kinofilm „Gag" (2006) an — genau die Geisterfilme
           vom August. Lieber fehlt so eine Datei (sichtbar in BEKANNTE_FEHLER). */
        if is_series_side_content(root, entry.path()) {
            // Wurde so etwas früher schon fälschlich als Film aufgenommen,
            // muss der alte Eintrag jetzt verschwinden.
            db::delete_movie_by_path(conn, &path)?;
            merke_extra(conn, root, entry.path())?;
            continue;
        }
        let (title, year) = parser::parse_title_year(&stem);
        db::insert_movie_if_absent(conn, &path, &title, year)?;
    }
    Ok(())
}

/// True if a folder name is PURELY a season marker ("Season 2", "Staffel 02",
/// "S03", "Specials") — i.e. it names a season, not a show. Kept strict so real
/// show folders like "Stranger Things S01-S04" or "Marvel's …" don't match.
fn is_pure_season_dir(name: &str) -> bool {
    let t = name.trim().to_lowercase();
    if t == "specials" || t == "special" || t == "extras" {
        return true;
    }
    static RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^(?:season|staffel|saison|s)\s*0*\d{1,3}$").unwrap()
    });
    RE.is_match(&t)
}

/// The folder name a show is grouped by. Normally the first path component under
/// the library root (`root/Show/Season N/file` → "Show"). BUT if that first
/// component is itself just a season folder — which happens when the user adds
/// the SHOW folder directly as a library (`root/Season N/file`) — the show name
/// is the library root's own folder name instead. Without this, every season of
/// such a show became a separate "Season N" group and got mis-matched on TMDb.
fn show_source_name(root: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    let comps: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    if comps.len() >= 2 {
        let first = comps[0].clone();

        /* Nichtssagender Ordnername („Downloads", „Videos", „Neuer Ordner")?
           Dann steht der echte Titel eine Ebene HÖHER.

           Gemessen am 01.08.2026:
             Websites Download\miraculous to\Downloads\Staffel 1\101 - ….mp4
           Als Bibliothek war „…\miraculous to" eingetragen, damit hieß die
           Serie „Downloads" — 90 Folgen, von TMDb nie zu finden. */
        if parser::is_generic_dir(&first) {
            let mut hoch = root;
            let mut kandidat = hoch.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            // Auch der Bibliotheksname kann nichtssagend sein — dann weiter
            // hoch, aber höchstens drei Ebenen (sonst landet man bei „Users").
            let mut i = 0;
            while i < 3 && (kandidat.is_empty() || parser::is_generic_dir(&kandidat)) {
                match hoch.parent() {
                    Some(p) if p != hoch => {
                        hoch = p;
                        kandidat = hoch.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                    }
                    _ => break,
                }
                i += 1;
            }
            if !kandidat.is_empty() && !parser::is_generic_dir(&kandidat) {
                return parser::strip_domain_suffix(&kandidat);
            }
            // Nichts Brauchbares gefunden: lieber der Dateiname als „Downloads".
            let name = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            return file_stem(&name);
        }

        if is_pure_season_dir(&first) {
            // root itself is the show folder → use its name
            if let Some(rn) = root.file_name().map(|s| s.to_string_lossy().to_string()) {
                if !rn.is_empty() && !parser::is_generic_dir(&rn) {
                    return parser::strip_domain_suffix(&rn);
                }
            }
        }

        /* Sitzt ZWISCHEN dem ersten Ordner und der Datei ein echter
           Staffelordner ("Season 01" o.ä.), gehört die Serie zu DESSEN
           Elternordner — nicht pauschal zum ersten Ordner unter der
           Bibliothek. Sonst wirft eine Sammelablage wie "Avengers", die
           mehrere Serien als Unterordner enthält
           (Avengers\Suits\Season 1, Avengers\Daredevil\Season 1, …),
           alles in EINE Serie namens "Avengers".

           Gemessen am 18.08.2026: C:\Movies\Avengers enthielt Suits,
           Marvel's Daredevil, The Newsroom, The Legend of Korra und
           Transformers Prime als Unterordner — vorher wurden alle fünf zu
           einer einzigen Serie zusammengefasst (TMDb fand zum falschen
           Sammelordner-Namen irgendeinen zufälligen Treffer). VORWÄRTS
           gesucht (erster Treffer gewinnt): "Extras"/"Specials" zählt
           selbst als staffelartiger Ordner (siehe is_pure_season_dir) — ein
           rückwärts gesuchter LETZTER Treffer würde bei
           "Suits/Season 05/Extras/datei" fälschlich bei "Season 05" statt
           bei "Suits" landen. */
        if comps.len() >= 3 {
            if let Some(idx) = (1..comps.len() - 1).find(|&i| is_pure_season_dir(&comps[i])) {
                return parser::strip_domain_suffix(&comps[idx - 1]);
            }
            /* Kein Staffelordner gefunden, aber die Datei liegt trotzdem
               mindestens zwei Ebenen unter der Bibliothek. Das ist so gut
               wie nie "eine Serie mit einem zufälligen Unterordner",
               sondern fast immer entweder:
                 - Sammelordner/Serie-mit-Staffel-im-NAMEN/Datei (keine
                   eigene "Season N"-Ebene, z.B. "Marvels Daredevil 2015
                   Season 3 Complete ...\datei.mkv"), oder
                 - Sammelordner/Serie/Buch-oder-Volume-Ordner/Datei (z.B.
                   Avatar/Korra: "The Legend of Korra ...\Book One - Air\
                   datei.mkv" — "Book" ist keine erkannte Staffel-Schreibweise).
               In beiden Fällen ist der ZWEITE Ordner die Serie, nicht der
               erste (die Sammelablage). */
            return parser::strip_domain_suffix(&comps[1]);
        }

        parser::strip_domain_suffix(&first)
    } else {
        // a file sitting directly in the root: if the root looks like a show
        // folder (has a real name), prefer it over the bare file stem
        let name = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        file_stem(&name)
    }
}

/// Give every already-indexed show a stable grouping key (idempotent). Run once
/// before a scan so shows created before keys existed — including ones the user
/// already identified — are re-found by key instead of being duplicated.
fn backfill_show_keys(conn: &Connection, libs: &[crate::models::Library]) -> Result<()> {
    let tv_roots: Vec<PathBuf> = libs
        .iter()
        .filter(|l| l.kind != "movie")
        .map(|l| PathBuf::from(&l.path))
        .collect();
    if tv_roots.is_empty() {
        return Ok(());
    }
    for (show_id, path) in db::all_show_file_paths(conn)? {
        let p = Path::new(&path);
        if let Some(root) = tv_roots.iter().find(|r| p.starts_with(r)) {
            let key = parser::show_key(&show_source_name(root, p));
            if !key.is_empty() {
                db::set_show_key_if_absent(conn, &key, show_id)?;
            }
        }
    }
    Ok(())
}

fn scan_tv(conn: &Connection, root: &Path) -> Result<()> {
    /* Bonusmaterial ohne Folgennummer — erst NACH der Schleife zuordnen, wenn
       alle Serien dieses Ordners sicher angelegt sind (die Reihenfolge, in der
       Ordner durchlaufen werden, ist nicht garantiert). */
    let mut bonus: Vec<PathBuf> = Vec::new();
    // siehe scan_movies: Ablehnungen aus dem Auswahl-Fenster müssen halten.
    let mut ignored = crate::ordnerwahl::ignored(conn);
    ignored.extend(crate::zuordnung::ignorierte(conn));
    // Dateien, die per "Ist ein Film" aus einer Serie herausgelöst wurden —
    // sie stehen schon in movies, sonst würde der nächste Scan sie erneut
    // als Folge aufnehmen.
    let film_ueberschreibungen: std::collections::HashSet<String> = db::get_setting(conn, "movie_override_files")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|p| crate::ordnerwahl::norm(&p))
        .collect();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !parser::is_video(&name) {
            continue;
        }
        let path_buf = entry.path();
        let path = path_buf.to_string_lossy().to_string();
        if ignored.contains(&crate::ordnerwahl::norm(&path)) {
            continue;
        }
        if film_ueberschreibungen.contains(&crate::ordnerwahl::norm(&path)) {
            continue;
        }

        /* Handentscheidung zuerst — sie kann eine Datei zur Folge einer ganz
           anderen Serie machen, zum Bonusmaterial erklären, zum Film erklären
           oder ganz ausblenden. Ohne diesen Block ließ sich eine falsch
           zugeordnete Sprach-/Qualitätsfassung nicht wieder loswerden. */
        if let Some(z) = crate::zuordnung::fuer(conn, &path)? {
            // In jedem Fall zuerst aus der bisherigen Rolle lösen.
            if z.ziel != "folge" {
                db::delete_episode_file_by_path(conn, &path)?;
            }
            match z.ziel.as_str() {
                "ignorieren" | "film" => continue,
                "extra" => {
                    if let (Some(tmdb), Some(art)) = (z.show_tmdb, z.extra_art.as_deref()) {
                        if let Some(sid) = db::find_show_by_tmdb(conn, tmdb)? {
                            let stem = file_stem(&name);
                            crate::extras::merken(conn, sid, &path, &stem, art, z.staffel)?;
                            conn.execute("UPDATE extras SET von_hand=1 WHERE path=?1", [&path])?;
                        }
                    }
                    continue;
                }
                "folge" => {
                    if let (Some(tmdb), Some(st), Some(ep)) = (z.show_tmdb, z.staffel, z.episode) {
                        let quelle = show_source_name(root, path_buf);
                        let ziel_show = db::find_or_create_show_for_tmdb(
                            conn,
                            tmdb,
                            &parser::clean_show_title(&quelle),
                        )?;
                        match db::episode_id_of_file(conn, &path)? {
                            Some(eid) => {
                                let _ = db::move_episode(conn, eid, ziel_show, st, ep);
                            }
                            None => {
                                db::delete_movie_by_path(conn, &path)?;
                                let ep_id =
                                    db::find_or_create_episode(conn, ziel_show, st, ep, &path)?;
                                db::add_episode_file(conn, ep_id, &path)?;
                            }
                        }
                    }
                    continue;
                }
                _ => {}
            }
        }

        // Group ALL seasons of a show under one entry by cleaning the season/junk
        // off the folder (or file) name. "Marvel's Daredevil Season 2" and
        // "Marvel's Daredevil Season 3" both collapse to "Marvel's Daredevil".
        let source_name = show_source_name(root, path_buf);
        let key = parser::show_key(&source_name);

        // A per-file placement override ("this file belongs to show TMDb X as
        // SxxEyy", set by the user moving a season/episode) ALWAYS wins and is
        // re-applied on every scan — even for already-indexed files.
        if let Some((show_tmdb, ov_season, ov_episode)) = db::placement_for(conn, &path)? {
            let target_show = db::find_or_create_show_for_tmdb(conn, show_tmdb, &parser::clean_show_title(&source_name))?;
            match db::show_id_of_episode_file(conn, &path)? {
                Some(cur_ep_show) => {
                    // already indexed → move it if it's not already correct
                    if let Some(eid) = db::episode_id_of_file(conn, &path)? {
                        let _ = db::move_episode(conn, eid, target_show, ov_season, ov_episode);
                    }
                    let _ = cur_ep_show;
                }
                None => {
                    // Falls diese Datei vorher (z.B. in einer reinen Film-Bibliothek
                    // oder vor der Umstellung auf "mixed") schon als Film eingetragen
                    // wurde, muss dieser alte Eintrag jetzt raus — sonst taucht die
                    // Datei doppelt auf (als Film UND als Folge).
                    db::delete_movie_by_path(conn, &path)?;
                    let ep_id = db::find_or_create_episode(conn, target_show, ov_season, ov_episode, &path)?;
                    db::add_episode_file(conn, ep_id, &path)?;
                }
            }
            continue;
        }

        // Already indexed? Leave its show/season/episode exactly as they are so
        // manual matches (Identifizieren) and episode renumbering survive the
        // rescan. We only (re)affirm the grouping key of its current show.
        if let Some(sid) = db::show_id_of_episode_file(conn, &path)? {
            if !key.is_empty() {
                db::set_show_key_if_absent(conn, &key, sid)?;
            }
            continue;
        }

        // New file → detect its position and place it.
        let stem = file_stem(&name);
        if is_junk_clip(&stem) {
            continue;
        }
        let parent_dir = path_buf
            .parent()
            .and_then(|p| p.file_name())
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let (season, episode) = match parser::parse_episode(&stem, &parent_dir) {
            Some(se) => se,
            None => {
                /* Keine Folgennummer. Liegt die Datei in einem Staffel- oder
                   Bonusordner, ist es Zusatzmaterial der Serie.
                   Gemessen am 23.09.2026: bis hierher wurde Bonusmaterial NUR in
                   „Serien & Filme"-Bibliotheken erfasst — in reinen
                   Serien-Bibliotheken fiel es stillschweigend weg (33 Dateien
                   in Z:\SM-MOONDOOM\Series\The Newsroom\Special Extras …). */
                if is_series_side_content(root, path_buf) {
                    bonus.push(path_buf.to_path_buf());
                }
                continue;
            }
        };

        let show_title = parser::clean_show_title(&source_name);
        let (_, show_year) = parser::parse_title_year(&source_name);
        let show_id = if key.is_empty() {
            db::find_or_create_show(conn, None, &show_title, show_year)?
        } else {
            db::find_or_create_show_by_key(conn, &key, &show_title, show_year)?
        };
        // siehe oben: alten Film-Eintrag für dieselbe Datei entfernen, falls vorhanden.
        db::delete_movie_by_path(conn, &path)?;
        let ep_id = db::find_or_create_episode(conn, show_id, season, episode, &path)?;
        db::add_episode_file(conn, ep_id, &path)?;
    }
    for p in &bonus {
        merke_extra(conn, root, p)?;
    }
    Ok(())
}

fn prune_missing(conn: &Connection) -> Result<()> {
    // NEVER prune files that live on a currently unreachable library root (e.g. an
    // unplugged external drive) — otherwise one offline scan would wipe the index.
    let offline_roots: Vec<PathBuf> = db::list_libraries(conn)?
        .into_iter()
        .map(|l| PathBuf::from(l.path))
        .filter(|p| !p.exists())
        .collect();
    let on_offline_root = |p: &str| offline_roots.iter().any(|r| Path::new(p).starts_with(r));

    for p in db::all_movie_paths(conn)? {
        if !Path::new(&p).exists() && !on_offline_root(&p) {
            db::delete_movie_by_path(conn, &p)?;
        }
    }
    // drop files that no longer exist, then episodes/shows that lost all their files
    for p in db::all_episode_file_paths(conn)? {
        if !Path::new(&p).exists() && !on_offline_root(&p) {
            db::delete_episode_file_by_path(conn, &p)?;
        }
    }
    conn.execute(
        "DELETE FROM episodes WHERE id NOT IN (SELECT DISTINCT episode_id FROM episode_files)",
        [],
    )?;
    db::set_all_episode_primaries(conn)?;
    // Bonusmaterial, dessen Datei weg ist, ebenfalls entfernen.
    let _ = crate::extras::aufraeumen(conn, &on_offline_root);
    conn.execute(
        "DELETE FROM shows WHERE id NOT IN (SELECT DISTINCT show_id FROM episodes)",
        [],
    )?;
    Ok(())
}

/// Search term for TMDb auto-detection: LETTERS ONLY (no digits, no punctuation,
/// no scene junk) — that's what rescues messy release names most reliably. Falls
/// back to the forgiving digit-keeping cleaner (for titles like "9-1-1"), then
/// the raw title, so there's always something to search for.
fn search_query(title: &str) -> String {
    let q = parser::letters_only(title);
    if !q.trim().is_empty() {
        return q;
    }
    let q = parser::clean_search_query(title);
    if q.trim().is_empty() {
        title.to_string()
    } else {
        q
    }
}

/// Search, retrying with the year dropped and with progressively shorter titles —
/// rescues messy names ("Miraculouse - Tales of …" → "Miraculouse Tales …" → "Miraculouse").
async fn search_with_fallback(
    tmdb: &Tmdb,
    query: &str,
    kind: &str,
    year: Option<i64>,
) -> Vec<crate::models::TmdbResult> {
    let words: Vec<&str> = query.split_whitespace().collect();
    if words.is_empty() {
        return Vec::new();
    }
    let mut n = words.len();
    while n >= 1 {
        let q = words[..n].join(" ");
        if let Ok(res) = tmdb.search(&q, kind, year).await {
            if !res.is_empty() {
                return res;
            }
        }
        if n == words.len() && year.is_some() {
            if let Ok(res) = tmdb.search(&q, kind, None).await {
                if !res.is_empty() {
                    return res;
                }
            }
        }
        if n == 1 {
            break;
        }
        n -= 1;
    }
    Vec::new()
}

/// A title reduced to lowercase letter-tokens for fuzzy comparison.
fn title_tokens(s: &str) -> Vec<String> {
    parser::letters_only(s)
        .to_lowercase()
        .split_whitespace()
        .map(|t| t.to_string())
        .collect()
}

/// Wie `title_tokens`, aber ZIFFERN BLEIBEN — nur für die Prüfung „ist das
/// wirklich derselbe Titel?".
///
/// WARUM (gemessen am 19.08.2026): `title_tokens` wirft Ziffern weg, damit
/// Release-Namen sauber vergleichbar sind. Dadurch war die thailändische Serie
/// „Miraculous 5" (TMDb 196104, 18 Folgen) ein *exakter* Treffer für den Ordner
/// „Miraculous" — und schlug mit dem Exakt-Bonus die echte Serie „Miraculous:
/// Tales of Ladybug & Cat Noir" (TMDb 65334, 155 Folgen). Für den Exakt-Bonus
/// müssen die Ziffern deshalb mitzählen.
fn title_tokens_exact(s: &str) -> Vec<String> {
    // Wie letters_only (Satzzeichen weg, Seiten-Tokens weg), aber mit Ziffern.
    // WICHTIG: Satzzeichen MÜSSEN wegfallen — sonst gilt "Shazam!" nicht als
    // "Shazam" und der unbekannte Namensvetter "Shazam" (2026) gewinnt den
    // Exakt-Bonus. Genau so kam es zu den drei Fehlgriffen vom 19.08.2026
    // (Shazam, Spider-Man: No Way Home, What If...?).
    parser::letters_and_digits(s)
        .to_lowercase()
        .split_whitespace()
        .map(|t| zahlwort(t).unwrap_or(t).to_string())
        .collect()
}

/// Ausgeschriebene Zahlen als Ziffer — „Fantastic Four" und „Fantastic 4"
/// sind derselbe Titel.
///
/// WARUM (gemessen 23.09.2026): Die Fortsetzungsnummer-Prüfung zog „The
/// Fantastic Four First Steps" (Dateiname) gegen „The Fantastic 4: First Steps"
/// (TMDb) Punkte ab — „four" ist keine Ziffer, „4" schon. Dadurch gewann der
/// TMDb-Eintrag „Marvel Studios' The Fantastic Four: First Steps - World
/// Premiere" (die Premierenfeier), der „Four" ausgeschrieben hat.
fn zahlwort(t: &str) -> Option<&'static str> {
    Some(match t {
        "one" | "eins" => "1",
        "two" | "zwei" => "2",
        "three" | "drei" => "3",
        "four" | "vier" => "4",
        "five" | "fuenf" | "fünf" => "5",
        "six" | "sechs" => "6",
        "seven" | "sieben" => "7",
        "eight" | "acht" => "8",
        "nine" | "neun" => "9",
        "ten" | "zehn" => "10",
        "eleven" | "elf" => "11",
        "twelve" | "zwoelf" | "zwölf" => "12",
        _ => return None,
    })
}

/// True, wenn beide Namen denselben Titel meinen (Ziffern zählen mit).
fn same_title(a: &str, b: &str) -> bool {
    let ta = title_tokens_exact(a);
    !ta.is_empty() && ta == title_tokens_exact(b)
}

/// Nur die reinen Zahl-Bestandteile eines Titels ("Iron Man 2" → ["2"]).
///
/// Fortsetzungsnummern gingen bisher komplett verloren, weil der Vergleich
/// Ziffern wegwirft — „Five Nights at Freddy's 2" und „Five Nights at Freddy's"
/// sahen identisch aus. Weicht die Nummer ab, gibt es deshalb Punktabzug.
fn number_tokens(name: &str) -> Vec<String> {
    title_tokens_exact(name)
        .into_iter()
        .filter(|t| !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()))
        .collect()
}

/// Fraction of the query's tokens that appear in the candidate (0.0–1.0).
fn token_overlap(want: &[String], cand: &[String]) -> f64 {
    if want.is_empty() {
        return 0.0;
    }
    let hit = want.iter().filter(|w| cand.contains(w)).count();
    hit as f64 / want.len() as f64
}

/// Pick the TV result that best matches what we actually have locally.
///
/// TITLE + YEAR come first; the TMDb total-episode count is only a tiebreaker
/// between otherwise near-equal candidates (e.g. the 2005 vs 2024 "Avatar").
///
/// The old version scored purely by |tmdb_total_eps − local_eps|, which broke
/// badly for a folder holding just ONE season of a multi-season show: a 13-file
/// "Daredevil" season would match "Daredevil: Born Again" (≈13 total) instead of
/// the 39-episode original. Episode count is now a weak signal, and a local count
/// that merely FITS inside a bigger show is not penalised.
async fn best_tv_match(tmdb: &Tmdb, raw_title: &str, year: Option<i64>, local_eps: i64) -> Option<i64> {
    let query = search_query(raw_title);
    let results = search_with_fallback(tmdb, &query, "tv", year).await;
    if results.is_empty() {
        return None;
    }

    let want = title_tokens(&query);
    // 1) score each candidate on title + year alone (no extra network calls)
    let mut scored: Vec<(f64, usize, i64)> = results
        .iter()
        .take(8)
        .enumerate()
        .map(|(i, r)| {
            let cand = title_tokens(&r.title);
            let mut s = 0.0f64;
            // Exakt-Bonus nur, wenn die Titel auch MIT Ziffern gleich sind
            // (sonst gewinnt "Miraculous 5" gegen die echte Miraculous-Serie).
            if cand == want && !want.is_empty() && same_title(raw_title, &r.title) {
                s += 100.0;
            }
            let joined_want = want.join(" ");
            let joined_cand = cand.join(" ");
            if joined_cand.starts_with(&joined_want) || joined_want.starts_with(&joined_cand) {
                s += 55.0;
            } else if joined_cand.contains(&joined_want) || joined_want.contains(&joined_cand) {
                s += 30.0;
            }
            s += token_overlap(&want, &cand) * 25.0;
            if let (Some(y), Some(cy)) = (year, r.year) {
                let d = (y - cy).abs();
                s += if d == 0 {
                    28.0
                } else if d <= 1 {
                    14.0
                } else if d <= 3 {
                    4.0
                } else {
                    -(d.min(25) as f64)
                };
            }
            s -= i as f64 * 0.5; // gentle nudge toward TMDb's own ranking
            (s, i, r.tmdb_id)
        })
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    // 2) collect the near-top contenders (already sorted best-first). A clear
    //    title/year winner ends it here — just like Plex, which trusts the folder
    //    name + year and the agent's own relevance ranking.
    let top = scored[0].0;
    let mut contenders: Vec<(f64, usize, i64)> =
        scored.iter().filter(|(s, _, _)| top - s < 12.0).copied().collect();
    // among ties, TMDb's own ranking (order index) wins — its #1 hit for a plain
    // "Daredevil" is the popular original, not a niche same-named show
    contenders.sort_by(|a, b| a.1.cmp(&b.1));
    if contenders.len() == 1 || local_eps < 3 {
        return Some(contenders[0].2);
    }

    // 3) LAST resort only: if the top-ranked contender's episode total is clearly
    //    too small to contain what we have locally (local ≫ total), it's the wrong
    //    show — step to the next contender that can actually hold our episodes.
    //    (Never the reverse: a big show is fine for a single local season.)
    let mut chosen = contenders[0].2;
    for (_, _, id) in &contenders {
        if let Ok(meta) = tmdb.tv_details(*id).await {
            let total = meta.episode_count.unwrap_or(0);
            if local_eps <= total + 2 {
                chosen = *id;
                break;
            }
        }
    }
    Some(chosen)
}

/// Pick the movie result that really matches what we have — or nothing at all.
///
/// WARUM ES DAS GIBT (gemessen am 19.08.2026): Vorher wurde stumpf
/// `results.first()` der ersten nicht-leeren Suche übernommen — ohne jede
/// Prüfung, ob der Treffer überhaupt zum Dateinamen passt. Ergebnis waren
/// Zuordnungen wie „Watch Five Nights at Freddy's 2" → *Yo-kai Watch: Friends
/// Forever* oder „MLP_FiM - Rainbow Roadtrip" → *ROH x MLP Global Wars Canada*.
///
/// Jetzt wird jeder Kandidat bewertet (Titel-Überschneidung in BEIDE
/// Richtungen + Jahresnähe) und ein Mindestwert verlangt. Lieber gar kein
/// Treffer als ein falscher: ohne Zuordnung sieht man das Problem sofort und
/// kann „Identifizieren" benutzen — ein falscher Treffer sieht dagegen aus
/// wie ein echter Film und fällt erst spät auf.
async fn best_movie_match(tmdb: &Tmdb, raw_title: &str, year: Option<i64>) -> Option<i64> {
    let query = search_query(raw_title);
    let words: Vec<&str> = query.split_whitespace().collect();
    if words.is_empty() {
        return None;
    }
    let want = title_tokens(&query);
    // Fortsetzungsnummer aus dem ROHEN Namen (search_query wirft Ziffern weg).
    let want_nums = number_tokens(raw_title);
    let mut best: Option<(f64, i64)> = None;

    // Wie bisher: Titel schrittweise von hinten kürzen (rettet unsaubere Namen).
    // Neu: ALLE Durchgänge werden bewertet, nicht nur der erste mit Treffern.
    let mut n = words.len();
    loop {
        let q = words[..n].join(" ");
        let mut jahre: Vec<Option<i64>> = vec![year];
        if year.is_some() {
            jahre.push(None); // Jahr im Dateinamen kann falsch sein
        }
        for j in jahre {
            let results = match tmdb.search(&q, "movie", j).await {
                Ok(r) => r,
                Err(_) => continue,
            };
            for (i, r) in results.iter().take(8).enumerate() {
                let cand = title_tokens(&r.title);
                if cand.is_empty() {
                    continue;
                }
                // vorwaerts: wieviel vom Dateinamen steckt im Treffer?
                // rueckwaerts: wieviel vom Treffer steckt im Dateinamen?
                let vorwaerts = token_overlap(&want, &cand);
                let rueckwaerts = token_overlap(&cand, &want);
                // Ein Treffer, der in KEINE Richtung halbwegs passt, ist geraten.
                if vorwaerts < 0.5 && rueckwaerts < 0.5 {
                    continue;
                }
                let mut s = 0.0f64;
                if cand == want && same_title(raw_title, &r.title) {
                    s += 100.0;
                }
                s += vorwaerts * 45.0 + rueckwaerts * 35.0;
                // Teil 1 vs Teil 2: milder Abzug, damit die richtige Fortsetzung
                // gewinnt — aber nicht so hart, dass "The Fantastic Four" gegen
                // "The Fantastic 4: First Steps" durchfaellt.
                if number_tokens(&r.title) != want_nums {
                    s -= 12.0;
                }
                if let (Some(y), Some(cy)) = (year, r.year) {
                    let d = (y - cy).abs();
                    s += if d == 0 {
                        30.0
                    } else if d <= 1 {
                        12.0
                    } else {
                        -((d.min(25) * 2) as f64)
                    };
                }
                s -= i as f64 * 0.5; // leichter Vorzug für TMDbs eigene Reihung
                if best.map_or(true, |(bs, _)| s > bs) {
                    best = Some((s, r.tmdb_id));
                }
            }
        }
        // Klar guter Treffer? Dann nicht weiter kürzen.
        if let Some((s, id)) = best {
            if s >= 80.0 {
                return Some(id);
            }
        }
        if n == 1 {
            break;
        }
        n -= 1;
    }
    best.filter(|(s, _)| *s >= 55.0).map(|(_, id)| id)
}

/// The user's remembered identification for a movie file, if any.
fn movie_override(conn: &Connection, path: &str) -> Option<i64> {
    // Eine Handentscheidung „das ist Film X" gilt vor allem anderen.
    if let Ok(Some(z)) = crate::zuordnung::fuer(conn, path) {
        if z.ziel == "film" {
            if let Some(t) = z.tmdb_id {
                return Some(t);
            }
        }
    }
    let name = Path::new(path).file_name()?.to_string_lossy().to_string();
    let key = parser::movie_key(&file_stem(&name));
    db::identity_override(conn, "movie", &key).ok().flatten()
}

/// The user's remembered identification for a show (via any of its grouping keys).
fn show_override(conn: &Connection, show_id: i64) -> Option<i64> {
    for key in db::keys_for_show(conn, show_id).ok()? {
        if let Ok(Some(t)) = db::identity_override(conn, "tv", &key) {
            return Some(t);
        }
    }
    None
}

async fn match_all(conn: &Connection, tmdb: &Tmdb, app: &AppHandle, auto_match: bool) -> Result<()> {
    // Remembered identifications ("Merken" beim Identifizieren) apply FIRST and
    // always — even with auto-match off, and again after a full library rebuild.
    let movies = db::movies_to_match(conn)?;
    let total = movies.len() as i64;
    for (i, m) in movies.iter().enumerate() {
        emit(app, "match", format!("Film: {}", m.title), i as i64 + 1, total);
        if let Some(tmdb_id) = movie_override(conn, &m.path) {
            let _ = apply_movie_match(conn, tmdb, m.id, tmdb_id, true).await;
        } else if auto_match {
            if let Some(tmdb_id) = best_movie_match(tmdb, &m.title, m.year).await {
                let _ = apply_movie_match(conn, tmdb, m.id, tmdb_id, false).await;
            }
        }
    }

    let shows = db::shows_to_match(conn)?;
    let total = shows.len() as i64;
    for (i, s) in shows.iter().enumerate() {
        emit(app, "match", format!("Serie: {}", s.title), i as i64 + 1, total);
        if let Some(tmdb_id) = show_override(conn, s.id) {
            let _ = apply_show_match(conn, tmdb, s.id, tmdb_id, true).await;
        } else if auto_match {
            let local = db::count_episodes(conn, s.id).unwrap_or(0);
            if let Some(tmdb_id) = best_tv_match(tmdb, &s.title, s.year, local).await {
                let _ = apply_show_match(conn, tmdb, s.id, tmdb_id, false).await;
            }
        }
    }

    // Shows matched but still without a poster (e.g. a bare row created by a
    // placement override during rebuild) → pull their full metadata now.
    for s in db::matched_shows(conn)? {
        if s.poster_path.is_some() {
            continue;
        }
        if let Some(t) = s.tmdb_id {
            emit(app, "match", format!("Aktualisiere: {}", s.title), 0, 0);
            let _ = apply_show_match(conn, tmdb, s.id, t, s.identified).await;
        }
    }

    // Incremental refresh: already-matched shows that gained new seasons/episodes.
    for s in db::matched_shows(conn)? {
        let tmdb_id = match s.tmdb_id {
            Some(t) => t,
            None => continue,
        };
        let missing = db::seasons_missing_meta(conn, s.id)?;
        if missing.is_empty() {
            continue;
        }
        emit(app, "match", format!("Neue Folgen: {}", s.title), 0, 0);
        for season in missing {
            if let Ok(eps) = tmdb.season_episodes(tmdb_id, season).await {
                for e in eps {
                    db::update_episode_meta(
                        conn, s.id, season, e.episode, e.title.as_deref(), e.overview.as_deref(),
                        e.still_path.as_deref(), e.air_date.as_deref(), e.runtime,
                    )?;
                }
            }
        }
    }

    // Refresh movies that are matched but still have no poster (e.g. earlier offline scan).
    for m in db::movies_missing_poster(conn)? {
        if let Some(t) = m.tmdb_id {
            emit(app, "match", format!("Aktualisiere: {}", m.title), 0, 0);
            let _ = apply_movie_match(conn, tmdb, m.id, t, m.identified).await;
        }
    }

    // Fold separate folders of the same show (e.g. different qualities/seasons) into one.
    db::merge_shows_by_tmdb(conn)?;
    Ok(())
}

/// Full metadata refresh: re-pull TMDb details + episode data for every matched item.
/// Keeps the existing match (and the `identified` flag) but reloads posters, overviews, etc.
pub fn run_refresh(db_path: PathBuf, http: reqwest::Client, app: AppHandle) -> Result<()> {
    let conn = db::open(&db_path)?;
    let key = db::get_setting(&conn, "tmdb_key")?.unwrap_or_default();
    if key.trim().is_empty() {
        emit(&app, "error", "Kein TMDb-Key gesetzt".into(), 0, 0);
        return Ok(());
    }
    let lang = db::get_setting(&conn, "tmdb_lang")?.unwrap_or_else(|| "de-DE".into());
    let tmdb = Tmdb::new(http, key, lang);
    emit(&app, "start", "Metadaten werden neu geladen …".into(), 0, 0);

    tauri::async_runtime::block_on(async {
        let movies = db::matched_movies(&conn).unwrap_or_default();
        let total = movies.len() as i64;
        for (i, m) in movies.iter().enumerate() {
            if let Some(t) = m.tmdb_id {
                emit(&app, "match", format!("Film: {}", m.title), i as i64 + 1, total);
                let _ = apply_movie_match(&conn, &tmdb, m.id, t, m.identified).await;
            }
        }
        let shows = db::matched_shows(&conn).unwrap_or_default();
        let total = shows.len() as i64;
        for (i, s) in shows.iter().enumerate() {
            if let Some(t) = s.tmdb_id {
                emit(&app, "match", format!("Serie: {}", s.title), i as i64 + 1, total);
                let _ = apply_show_match(&conn, &tmdb, s.id, t, s.identified).await;
            }
        }
        let _ = db::merge_shows_by_tmdb(&conn);
    });

    emit(&app, "done", "Metadaten aktualisiert".into(), 0, 0);
    let _ = app.emit("library://updated", ());
    Ok(())
}

/// Fetch full movie metadata for a chosen TMDb id and write it to the movie row.
pub async fn apply_movie_match(
    conn: &Connection,
    tmdb: &Tmdb,
    movie_id: i64,
    tmdb_id: i64,
    identified: bool,
) -> Result<()> {
    let meta = tmdb.movie_details(tmdb_id).await?;
    let genres = serde_json::to_string(&meta.genres).ok();
    db::update_movie_match(
        conn,
        movie_id,
        meta.tmdb_id,
        &meta.title,
        meta.year,
        meta.overview.as_deref(),
        meta.poster_path.as_deref(),
        meta.backdrop_path.as_deref(),
        genres.as_deref(),
        meta.runtime,
        meta.rating,
        identified,
        meta.cert.as_deref(),
    )?;
    Ok(())
}

/// Fetch full show metadata + all season/episode metadata for a chosen TMDb id.
pub async fn apply_show_match(
    conn: &Connection,
    tmdb: &Tmdb,
    show_id: i64,
    tmdb_id: i64,
    identified: bool,
) -> Result<()> {
    let meta = tmdb.tv_details(tmdb_id).await?;
    let genres = serde_json::to_string(&meta.genres).ok();
    db::update_show_match(
        conn,
        show_id,
        meta.tmdb_id,
        &meta.title,
        meta.year,
        meta.overview.as_deref(),
        meta.poster_path.as_deref(),
        meta.backdrop_path.as_deref(),
        genres.as_deref(),
        meta.rating,
        identified,
        meta.cert.as_deref(),
        meta.status.as_deref(),
        meta.last_year,
        meta.runtime,
    )?;
    fetch_show_episodes(conn, tmdb, show_id, meta.tmdb_id).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn touch(path: &Path) {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).unwrap();
        }
        let mut f = fs::File::create(path).unwrap();
        f.write_all(b"x").unwrap();
    }

    #[test]
    fn pure_season_dir_detection() {
        assert!(is_pure_season_dir("Season 1"));
        assert!(is_pure_season_dir("Staffel 02"));
        assert!(is_pure_season_dir("S03"));
        assert!(is_pure_season_dir("Specials"));
        // real show folders must NOT be treated as season folders
        assert!(!is_pure_season_dir("Marvel's Daredevil"));
        assert!(!is_pure_season_dir("Stranger Things S01-S04"));
        assert!(!is_pure_season_dir("Daredevil Born Again"));
    }

    #[test]
    fn show_source_name_handles_show_folder_as_library() {
        let root = Path::new("/lib/Marvel's Daredevil");
        // root IS the show folder, seasons directly inside → show name = root name
        let p = Path::new("/lib/Marvel's Daredevil/Season 1/ep.mkv");
        assert_eq!(show_source_name(root, p), "Marvel's Daredevil");
        let p2 = Path::new("/lib/Marvel's Daredevil/Season 3/ep.mkv");
        assert_eq!(show_source_name(root, p2), "Marvel's Daredevil");
        // normal case: parent folder contains show folders
        let root2 = Path::new("/lib");
        let p3 = Path::new("/lib/Breaking Bad/Season 1/ep.mkv");
        assert_eq!(show_source_name(root2, p3), "Breaking Bad");
    }

    #[test]
    fn show_source_name_looks_past_a_collection_dumping_folder() {
        // "Avengers" is a junk-drawer folder holding several UNRELATED shows —
        // each must group under its OWN name, not under "Avengers".
        let root = Path::new("/lib");
        let daredevil = Path::new("/lib/Avengers/Marvel's Daredevil/Season 01/ep.mkv");
        assert_eq!(show_source_name(root, daredevil), "Marvel's Daredevil");
        // (season-range suffixes like "Season 1-9" are cleaned off later by
        // clean_show_title() — show_source_name only has to find the right
        // FOLDER, not produce the final display title.)
        let suits = Path::new("/lib/Avengers/Suits (2011) Season 1-9/Season 05/ep.mkv");
        assert_eq!(show_source_name(root, suits), "Suits (2011) Season 1-9");
        // a season folder nested even deeper (an "Extras" subfolder) must still
        // resolve to the show, not to "Extras" or to "Avengers"
        let extra = Path::new("/lib/Avengers/Suits (2011) Season 1-9/Season 05/Extras/webisode.mkv");
        assert_eq!(show_source_name(root, extra), "Suits (2011) Season 1-9");
        // a loose file sitting directly in the dumping folder (no season dir
        // anywhere) has nothing better to group by — falls back to "Avengers"
        // as before (parse_episode's own junk-tag fix keeps such files from
        // being misdetected as episodes in the first place).
        let loose = Path::new("/lib/Avengers/Some.Random.Movie.2024.mkv");
        assert_eq!(show_source_name(root, loose), "Avengers");
    }

    #[test]
    fn show_source_name_handles_season_baked_into_folder_name_or_named_volumes() {
        let root = Path::new("/lib");
        // no separate "Season 3" folder at all — the season is baked into the
        // release folder's own name. Still two levels under the dumping folder.
        let baked = Path::new(
            "/lib/Avengers/Marvels Daredevil 2015 Season 3 Complete 720p BluRay x264 [i_c]/Marvel's Daredevil S03E01 Resurrection.mkv",
        );
        assert_eq!(
            show_source_name(root, baked),
            "Marvels Daredevil 2015 Season 3 Complete 720p BluRay x264 [i_c]"
        );
        // Avatar/Korra-style "Book One - Air" instead of "Season 1" — not
        // recognized by is_pure_season_dir, but still one level too deep to
        // be mistaken for the dumping folder itself.
        let book = Path::new("/lib/Avengers/The Legend of Korra (2012 - 2014) [1080p]/Book One - Air/ep.mkv");
        assert_eq!(show_source_name(root, book), "The Legend of Korra (2012 - 2014) [1080p]");
    }

    #[test]
    fn sequel_numbers_and_exact_titles_are_compared_with_digits() {
        // "Miraculous 5" (thail. Serie) darf NICHT als exakter Treffer fuer
        // den Ordner "Miraculous" gelten — genau daran scheiterte die Zuordnung.
        assert!(!same_title("Miraculous", "Miraculous 5"));
        assert!(same_title("Miraculous", "Miraculous"));
        /* Fortsetzungsnummern muessen sichtbar bleiben. Geprueft wird der
           VERGLEICH, nicht die Rohliste: „Five" wird seit den Zahlwoertern zu
           „5" — das ist harmlos, weil Dateiname und TMDb-Titel gleich
           behandelt werden. Entscheidend ist nur: Teil 2 ≠ Teil 1. */
        assert_eq!(
            number_tokens("Five Nights at Freddy's 2 - GGFlix"),
            number_tokens("Five Nights at Freddy's 2")
        );
        assert_ne!(
            number_tokens("Five Nights at Freddy's 2 - GGFlix"),
            number_tokens("Five Nights at Freddy's")
        );
        assert_eq!(number_tokens("Iron Man 2"), vec!["2".to_string()]);
        assert!(!same_title("Iron Man 2", "Iron Man"));
        // Seitennamen duerfen den Titelvergleich nicht verfaelschen. So sieht der
        // Titel aus, wie parse_title_year ihn ablegt (das fuehrende "Watch" ist
        // dort schon weg, siehe parser::tests).
        assert!(same_title("Five Nights at Freddy's 2 - GGFlix", "Five Nights at Freddy's 2"));

        /* Satzzeichen duerfen KEINEN Unterschied machen — sonst gewinnt der
           unbekannte Namensvetter den Exakt-Bonus. Alle drei Faelle wurden
           am 19.08.2026 genau so falsch zugeordnet. */
        assert!(same_title("Shazam", "Shazam!"), "Shazam! muss als Shazam gelten");
        assert!(same_title("What If", "What If...?"), "What If...? muss als What If gelten");
        assert!(
            same_title("Spider-Man No Way Home", "Spider-Man: No Way Home"),
            "Doppelpunkt darf den Vergleich nicht sprengen"
        );
        // ... aber der laengere Doku-Titel bleibt verschieden
        assert!(!same_title("Spider-Man No Way Home", "Spider-Man: All Roads Lead to No Way Home"));

        // Ausgeschriebene Zahl = Ziffer (Fehlgriff „World Premiere" vom 23.09.2026)
        assert!(same_title("The Fantastic Four First Steps", "The Fantastic 4: First Steps"));
        assert_eq!(number_tokens("The Fantastic Four First Steps"), number_tokens("The Fantastic 4: First Steps"));
        assert!(!same_title(
            "The Fantastic Four First Steps",
            "Marvel Studios' The Fantastic Four: First Steps - World Premiere"
        ));
        assert!(same_title("Ocean's Eleven", "Ocean's 11"));
    }

    #[test]
    fn title_token_overlap_scoring() {
        let want = title_tokens("Marvel's Daredevil");
        let cand = title_tokens("Marvel's Daredevil");
        assert!((token_overlap(&want, &cand) - 1.0).abs() < 1e-9);
        let partial = title_tokens("Daredevil Born Again");
        assert!(token_overlap(&want, &partial) < 1.0 && token_overlap(&want, &partial) > 0.0);
    }

    #[test]
    fn scans_movies_and_groups_episodes() {
        let base = std::env::temp_dir().join(format!("ghgflix_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let movies = base.join("Movies");
        let tv = base.join("TV");

        touch(&movies.join("The Matrix (1999) 1080p BluRay.mkv"));
        touch(&movies.join("Inception.2010.x264.mkv"));
        touch(&tv.join("Breaking Bad (2008)").join("Season 01").join("Breaking Bad S01E01.mkv"));
        touch(&tv.join("Breaking Bad (2008)").join("Season 01").join("Breaking Bad S01E01 2160p.mkv"));
        touch(&tv.join("Breaking Bad (2008)").join("Season 01").join("Breaking Bad S01E02.mkv"));
        touch(&tv.join("Breaking Bad (2008)").join("Season 02").join("Breaking Bad S02E01.mkv"));

        let conn = db::open(&base.join("test.db")).unwrap();
        scan_movies(&conn, &movies).unwrap();
        scan_tv(&conn, &tv).unwrap();

        let movies_list = db::list_movies(&conn).unwrap();
        assert_eq!(movies_list.len(), 2, "should find 2 movies");
        assert!(movies_list.iter().any(|m| m.title == "The Matrix" && m.year == Some(1999)));
        assert!(movies_list.iter().any(|m| m.title == "Inception" && m.year == Some(2010)));

        let shows = db::list_shows(&conn).unwrap();
        assert_eq!(shows.len(), 1, "should find 1 show");
        assert_eq!(shows[0].title, "Breaking Bad");
        assert_eq!(shows[0].episode_count, 3, "two qualities of S01E01 must stay ONE episode");
        assert_eq!(shows[0].season_count, 2, "should group 2 seasons");
        // 3 episodes but 4 physical files (S01E01 exists in two qualities)
        assert_eq!(db::all_episode_file_paths(&conn).unwrap().len(), 4, "should track 4 files");

        drop(conn);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn bonus_material_finds_its_show_through_nested_bonus_folders() {
        let base = std::env::temp_dir().join(format!("ghgflix_test_extras_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);

        // Echte Struktur von der Platte: Sammelordner → Serie → Featurettes →
        // Season → Inside the Episode → Datei. Genau hier wurde vorher
        // „Featurettes" für die Serie gehalten.
        let serie = base.join("Avengers").join("The Newsroom (2012) Season 1-3");
        touch(&serie.join("Season 01").join("The Newsroom - S01E01 - We Just Decided To.mkv"));
        touch(&serie.join("Featurettes").join("Season 1").join("Inside the Episode").join("Amen.mkv"));
        touch(&serie.join("Featurettes").join("Season 1").join("Deleted Scenes").join("The Greater Fool.mkv"));

        let conn = db::open(&base.join("test.db")).unwrap();
        scan_tv(&conn, &base).unwrap();
        scan_movies(&conn, &base).unwrap();

        // Der Schnipsel darf KEIN Film sein …
        assert_eq!(db::list_movies(&conn).unwrap().len(), 0, "Bonusmaterial ist kein Film");
        // … sondern muss an der Serie hängen.
        let shows = db::list_shows(&conn).unwrap();
        assert_eq!(shows.len(), 1, "eine Serie");
        let ex = crate::extras::fuer_serie(&conn, shows[0].id).unwrap();
        assert_eq!(ex.len(), 2, "beide Extras gefunden");
        let arten: Vec<&str> = ex.iter().map(|e| e.art.as_str()).collect();
        assert!(arten.contains(&"featurette"), "Inside the Episode → Featurette");
        assert!(arten.contains(&"deleted"), "Deleted Scenes → geloeschte Szene");
        assert!(ex.iter().all(|e| e.staffel == Some(1)), "Staffel 1 erkannt");

        drop(conn);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn pure_tv_library_keeps_bonus_material() {
        let base = std::env::temp_dir().join(format!("ghgflix_test_tvbonus_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        // Reine SERIEN-Bibliothek (kind = tv): nur scan_tv läuft.
        let serie = base.join("The Newsroom");
        touch(&serie.join("Season 01").join("The Newsroom - S01E01 - We Just Decided To.mkv"));
        touch(&serie.join("Special Extras Season 1").join("Mission Control.mkv"));
        touch(&serie.join("Special Extras Season 1").join("Inside the Episode").join("Amen.mkv"));

        let conn = db::open(&base.join("test.db")).unwrap();
        scan_tv(&conn, &base).unwrap();

        let shows = db::list_shows(&conn).unwrap();
        assert_eq!(shows.len(), 1);
        let ex = crate::extras::fuer_serie(&conn, shows[0].id).unwrap();
        assert_eq!(ex.len(), 2, "Bonusmaterial darf in reinen Serien-Bibliotheken nicht wegfallen");
        assert!(ex.iter().all(|e| e.staffel == Some(1)));
        assert_eq!(db::list_movies(&conn).unwrap().len(), 0);

        drop(conn);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn series_bonus_material_is_not_a_movie() {
        assert!(is_bonus_dir("Featurettes"));
        assert!(is_bonus_dir("Extras"));
        assert!(is_bonus_dir("Inside the Episode"));
        assert!(is_bonus_dir("Deleted Scenes"));
        // echte Filmordner duerfen NICHT als Bonus gelten
        assert!(!is_bonus_dir("Marvel's Daredevil"));
        assert!(!is_bonus_dir("Now You See Me"));
        // zusammengesetzte Namen (Newsroom auf Z:, gemessen 23.09.2026)
        assert!(is_bonus_dir("Special Extras Season 1"));
        assert!(is_bonus_dir("Season 3 Extras"));
        assert!(is_bonus_dir("Bonus Disc 2"));
        // … aber die gleichnamige SERIE „Extras" (2005) bleibt eine Serie
        assert!(!is_bonus_dir("Extras (2005)"));
        assert!(!is_bonus_dir("Extraction (2020)"));

        let root = Path::new("/lib");
        // die echten Faelle von der Platte
        assert!(is_series_side_content(
            root,
            Path::new("/lib/The Newsroom (2012) Season 1-3/Featurettes/Season 1/Inside the Episode/Amen.mkv")
        ));
        assert!(is_series_side_content(
            root,
            Path::new("/lib/Suits (2011) Season 1-9/Extras/Season 02/Gag Reel.mkv")
        ));
        assert!(is_series_side_content(
            root,
            Path::new("/lib/My little Pony Friendship is Magic/Specials/MLP_FiM - Rainbow Roadtrip.mkv")
        ));
        // ein normaler Film bleibt ein Film
        assert!(!is_series_side_content(
            root,
            Path::new("/lib/Now You See Me/Now.You.See.Me.2013.1080p.mkv")
        ));
        assert!(!is_series_side_content(root, Path::new("/lib/Interstellar.2014.mkv")));
    }

    #[test]
    fn bonus_material_already_indexed_as_movie_gets_removed() {
        let base = std::env::temp_dir().join(format!("ghgflix_test_bonus_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let bonus = base.join("Suits").join("Extras").join("Season 02").join("Gag Reel.mkv");
        let film = base.join("Interstellar.2014.1080p.mkv");
        touch(&bonus);
        touch(&film);

        let conn = db::open(&base.join("test.db")).unwrap();
        scan_movies(&conn, &base).unwrap();
        let titles: Vec<String> = db::list_movies(&conn).unwrap().into_iter().map(|m| m.title).collect();
        assert_eq!(titles, vec!["Interstellar".to_string()], "nur der echte Film darf uebrig bleiben");

        drop(conn);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn mixed_library_finds_movies_and_shows_without_duplicates() {
        let base = std::env::temp_dir().join(format!("ghgflix_test_mixed_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);

        touch(&base.join("Inception.2010.x264.mkv"));
        touch(&base.join("Breaking Bad (2008)").join("Season 01").join("Breaking Bad S01E01.mkv"));
        touch(&base.join("Breaking Bad (2008)").join("Season 01").join("Breaking Bad S01E02.mkv"));

        let conn = db::open(&base.join("test.db")).unwrap();
        // gleiche Reihenfolge wie run_scan() im "mixed"-Zweig: erst Folgen, dann Filme.
        scan_tv(&conn, &base).unwrap();
        scan_movies(&conn, &base).unwrap();

        let movies_list = db::list_movies(&conn).unwrap();
        assert_eq!(movies_list.len(), 1, "sollte genau 1 Film finden");
        assert_eq!(movies_list[0].title, "Inception");

        let shows = db::list_shows(&conn).unwrap();
        assert_eq!(shows.len(), 1, "sollte 1 Serie finden");
        assert_eq!(shows[0].episode_count, 2);

        drop(conn);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn mixed_library_removes_stale_movie_row_when_reclassified_as_episode() {
        let base = std::env::temp_dir().join(format!("ghgflix_test_reclass_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        /* Echter Fall von der Platte: die Folge liegt OHNE Staffelordner direkt
           im Serienordner, und ihre Nummer steht in der Schreibweise der
           Mitschnitt-Seiten ("S6-Ep-1"). Vor der Regel-Erweiterung landete so
           etwas als "Film" in der Bibliothek. */
        let ep = base
            .join("Miraculous Tales of Ladybug & Cat Noir")
            .join("M-S6-Ep-1-Climatiqueen-.mp4");
        touch(&ep);

        let conn = db::open(&base.join("test.db")).unwrap();
        // Alten Zustand nachstellen: Datei steht (noch) als Film in der Bibliothek.
        db::insert_movie_if_absent(&conn, &ep.to_string_lossy(), "M S6 Ep 1 Climatiqueen", None).unwrap();
        assert_eq!(db::list_movies(&conn).unwrap().len(), 1, "Ausgangslage: steht als Film drin");

        // Nach Umstellung auf "mixed": erst scan_tv, dann scan_movies.
        scan_tv(&conn, &base).unwrap();
        scan_movies(&conn, &base).unwrap();

        assert_eq!(db::list_movies(&conn).unwrap().len(), 0, "alter Film-Eintrag muss verschwinden");
        let shows = db::list_shows(&conn).unwrap();
        assert_eq!(shows.len(), 1);
        assert_eq!(shows[0].episode_count, 1);

        drop(conn);
        let _ = fs::remove_dir_all(&base);
    }
}

/// Pull episode metadata for every season we have files for.
pub async fn fetch_show_episodes(
    conn: &Connection,
    tmdb: &Tmdb,
    show_id: i64,
    tmdb_id: i64,
) -> Result<()> {
    for season in db::distinct_seasons(conn, show_id)? {
        if let Ok(eps) = tmdb.season_episodes(tmdb_id, season).await {
            for e in eps {
                db::update_episode_meta(
                    conn,
                    show_id,
                    season,
                    e.episode,
                    e.title.as_deref(),
                    e.overview.as_deref(),
                    e.still_path.as_deref(),
                    e.air_date.as_deref(),
                    e.runtime,
                )?;
            }
        }
    }
    Ok(())
}
