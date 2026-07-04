use regex::Regex;
use std::sync::LazyLock;

const VIDEO_EXTS: &[&str] = &[
    "mkv", "mp4", "avi", "mov", "m4v", "wmv", "flv", "webm", "ts", "m2ts", "mts", "mpg", "mpeg",
    "vob", "ogv", "3gp", "divx",
];

pub fn is_video(name: &str) -> bool {
    name.rsplit('.')
        .next()
        .map(|e| VIDEO_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

static RE_SXXEXX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)s(\d{1,2})\s*[._\- ]?\s*e(\d{1,3})").unwrap());
static RE_NXNN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:^|[^\d])(\d{1,2})\s*x\s*(\d{1,3})(?:[^\d]|$)").unwrap());
static RE_SEASON_EP_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:season|staffel)\s*(\d{1,2}).*?(?:episode|folge)\s*(\d{1,3})").unwrap()
});
static RE_YEAR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)").unwrap());
static RE_SEASON_DIR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:season|staffel|s)\s*0*(\d{1,3})").unwrap());
static RE_EP_ONLY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:episode|folge|ep|e)\s*\.?\s*0*(\d{1,3})").unwrap());
static RE_STANDALONE_NUM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|[ ._\-])0*(\d{1,3})(?:[ ._\-]|$)").unwrap());
static RE_JUNK_CUT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(1080p|720p|2160p|480p|4k|uhd|x264|x265|h\.?264|h\.?265|hevc|xvid|divx|bluray|blu-ray|brrip|bdrip|web-?rip|web-?dl|hdrip|dvdrip|hdtv|aac|ac3|dts(?:-hd)?|truehd|atmos|ddp?5|remux|proper|repack|extended|unrated|imax|hdr10?|10bit|multi|dual|complete)\b",
    )
    .unwrap()
});
// "Season 2", "Staffel 02", "S03" — used to cut a season suffix off a show folder.
static RE_SEASON_CUT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:season|staffel|saison|series)\b\s*\d{0,3}|\bs\d{1,2}(?:e\d{1,3})?\b").unwrap());
// Leading scene/URL prefixes like "www.UIndex.org - " (dots already turned to
// spaces by `normalize`, so this is space-tolerant: "www UIndex org - ").
static RE_URL_PREFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^\s*www\b.*?\b(?:org|com|net|info|me|cc|tv|io|to|se|nu)\b[\s\-_.:|]*").unwrap());
// Stray site/scene tokens anywhere in the name.
static RE_SITE_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:www|uindex|rarbg|yts|yify|eztv|ettv|phdteam|psa|galaxytv|ethel|mkvcage|sparks|ntb)\b").unwrap());

fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_brackets(s: &str) -> String {
    // remove [...] and {...} (release-group tags), keep (...) so we can read the year
    let mut out = String::with_capacity(s.len());
    let mut depth = 0i32;
    for c in s.chars() {
        match c {
            '[' | '{' => depth += 1,
            ']' | '}' => {
                if depth > 0 {
                    depth -= 1
                }
            }
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

fn normalize(raw: &str) -> String {
    let replaced: String = raw
        .chars()
        .map(|c| if c == '.' || c == '_' { ' ' } else { c })
        .collect();
    collapse_ws(&strip_brackets(&replaced))
}

fn snap_boundary(s: &str, mut idx: usize) -> usize {
    if idx > s.len() {
        idx = s.len();
    }
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

fn clean_piece(s: &str) -> String {
    let t = collapse_ws(s);
    t.trim_matches(|c: char| c == '-' || c == ' ' || c == '(' || c == ')' || c == ',')
        .to_string()
}

fn cap_i64(c: &regex::Captures, i: usize) -> i64 {
    c.get(i).and_then(|m| m.as_str().parse().ok()).unwrap_or(0)
}

/// Extract a clean title + optional year from a movie filename stem or a show folder name.
pub fn parse_title_year(raw: &str) -> (String, Option<i64>) {
    let norm = normalize(raw);
    let mut cut = norm.len();
    let mut year = None;

    if let Some(c) = RE_YEAR.captures(&norm) {
        if let Some(m) = c.get(1) {
            year = m.as_str().parse::<i64>().ok();
            // cut right before the leading delimiter of the year group
            cut = cut.min(c.get(0).map(|g| g.start()).unwrap_or(cut));
        }
    }
    if let Some(m) = RE_JUNK_CUT.find(&norm) {
        cut = cut.min(m.start());
    }
    if let Some(m) = RE_SXXEXX.find(&norm) {
        cut = cut.min(m.start());
    }

    let cut = snap_boundary(&norm, cut);
    let mut title = clean_piece(&norm[..cut]);
    if title.is_empty() {
        title = clean_piece(&norm);
    }
    if title.is_empty() {
        title = raw.to_string();
    }
    (title, year)
}

/// A title cleaned down to letters + spaces (plus apostrophes) for TMDb search —
/// no digits, no punctuation, no scene/site tokens. Empty result falls back to
/// the original (callers handle that).
pub fn letters_only(s: &str) -> String {
    let cleaned = RE_SITE_TOKEN.replace_all(s, " ");
    cleaned
        .chars()
        .map(|c| if c.is_alphabetic() || c == ' ' || c == '\'' { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Title used to *group* all seasons of a show into one entry: strips the season
/// suffix ("Season 2"), year, scene/site junk and release tags from a folder/file
/// name. e.g. "Marvel's Daredevil Season 2 1080p" → "Marvel's Daredevil".
pub fn clean_show_title(raw: &str) -> String {
    let norm = normalize(raw);
    let norm = RE_URL_PREFIX.replace(&norm, "").into_owned();
    let mut cut = norm.len();
    for m in [
        RE_YEAR.find(&norm),
        RE_JUNK_CUT.find(&norm),
        RE_SXXEXX.find(&norm),
        RE_NXNN.find(&norm),
        RE_SEASON_CUT.find(&norm),
    ]
    .into_iter()
    .flatten()
    {
        cut = cut.min(m.start());
    }
    let cut = snap_boundary(&norm, cut);
    let mut t = clean_piece(&norm[..cut]);
    if t.is_empty() {
        t = clean_piece(&RE_SITE_TOKEN.replace_all(&norm, " "));
    }
    if t.is_empty() {
        t = clean_piece(&norm);
    }
    t
}

/// Stable lower-cased grouping key for a show folder. Used to re-find the same
/// show on every rescan even after the user renames it via "Identifizieren".
pub fn show_key(raw: &str) -> String {
    clean_show_title(raw).to_lowercase()
}

/// Stable identity key for a movie FILE, derived from its name (not its DB row,
/// whose title changes on identify). Used by the persistent identity map so a
/// manual match is re-applied automatically even after "Bibliothek neu aufbauen".
pub fn movie_key(stem: &str) -> String {
    let (title, year) = parse_title_year(stem);
    let base = letters_only(&title).to_lowercase();
    let base = if base.is_empty() { title.to_lowercase() } else { base };
    match year {
        Some(y) => format!("{base}|{y}"),
        None => base,
    }
}

/// A forgiving query for TMDb search: turns separators (`. _ -`) into spaces,
/// drops bracket tags, site/scene prefixes and quality/codec junk. Keeps letters,
/// digits and apostrophes so e.g. "Spider-Man" → "Spider Man", "9-1-1" → "9 1 1".
pub fn clean_search_query(raw: &str) -> String {
    let replaced: String = raw
        .chars()
        .map(|c| if c == '.' || c == '_' || c == '-' { ' ' } else { c })
        .collect();
    let base = collapse_ws(&strip_brackets(&replaced));
    let base = RE_URL_PREFIX.replace(&base, "").into_owned();
    let base = RE_SITE_TOKEN.replace_all(&base, " ").into_owned();
    let mut cut = base.len();
    if let Some(m) = RE_JUNK_CUT.find(&base) {
        cut = cut.min(m.start());
    }
    let cut = snap_boundary(&base, cut);
    let t = clean_piece(&base[..cut]);
    if t.is_empty() {
        collapse_ws(&base)
    } else {
        t
    }
}

pub fn parse_season_from_dir(dir: &str) -> Option<i64> {
    let d = dir.to_lowercase();
    if d.contains("special") {
        return Some(0);
    }
    RE_SEASON_DIR
        .captures(dir)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse().ok())
}

/// Detect (season, episode) from a filename stem, using the parent dir as a hint.
pub fn parse_episode(stem: &str, parent_dir: &str) -> Option<(i64, i64)> {
    let norm = normalize(stem);

    if let Some(c) = RE_SXXEXX.captures(&norm) {
        return Some((cap_i64(&c, 1), cap_i64(&c, 2)));
    }
    if let Some(c) = RE_NXNN.captures(&norm) {
        return Some((cap_i64(&c, 1), cap_i64(&c, 2)));
    }
    if let Some(c) = RE_SEASON_EP_WORDS.captures(&norm) {
        return Some((cap_i64(&c, 1), cap_i64(&c, 2)));
    }

    if let Some(season) = parse_season_from_dir(parent_dir) {
        if let Some(c) = RE_EP_ONLY.captures(&norm) {
            return Some((season, cap_i64(&c, 1)));
        }
        if let Some(c) = RE_STANDALONE_NUM.captures(&norm) {
            return Some((season, cap_i64(&c, 1)));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn movie_titles() {
        assert_eq!(parse_title_year("The.Matrix.1999.1080p.BluRay.x264"), ("The Matrix".into(), Some(1999)));
        assert_eq!(parse_title_year("Inception (2010)"), ("Inception".into(), Some(2010)));
    }

    #[test]
    fn episodes() {
        assert_eq!(parse_episode("Show.S01E02.1080p", ""), Some((1, 2)));
        assert_eq!(parse_episode("Show 1x05", ""), Some((1, 5)));
        assert_eq!(parse_episode("Folge 7", "Staffel 3"), Some((3, 7)));
    }

    #[test]
    fn show_grouping_titles() {
        // all of these must collapse to the same group title
        assert_eq!(clean_show_title("Marvel's Daredevil Season 1"), "Marvel's Daredevil");
        assert_eq!(clean_show_title("Marvel's Daredevil Season 2 1080p BluRay"), "Marvel's Daredevil");
        assert_eq!(clean_show_title("Daredevil S03"), "Daredevil");
        assert_eq!(clean_show_title("Daredevil.Born.Again.2025.S01.2160p"), "Daredevil Born Again");
        assert_eq!(clean_show_title("www.UIndex.org - Daredevil Born Again"), "Daredevil Born Again");
    }

    #[test]
    fn letters_only_search() {
        // applied to an already-parsed title in practice
        assert_eq!(letters_only("Daredevil Born Again"), "Daredevil Born Again");
        assert_eq!(letters_only("Marvel's Daredevil (2015)"), "Marvel's Daredevil");
        assert_eq!(letters_only("Loki"), "Loki");
    }

    #[test]
    fn search_query_handles_separators() {
        // hyphens/dots/underscores become spaces (TMDb finds these), digits kept
        assert_eq!(clean_search_query("Spider-Man"), "Spider Man");
        assert_eq!(clean_search_query("Miraculous - Tales of Ladybug"), "Miraculous Tales of Ladybug");
        assert_eq!(clean_search_query("9-1-1"), "9 1 1");
        assert_eq!(clean_search_query("The.Matrix.1999.1080p.BluRay"), "The Matrix 1999");
        assert_eq!(clean_search_query("www.UIndex.org - Daredevil"), "Daredevil");
    }

    #[test]
    fn movie_key_is_stable() {
        // must be identical for every rip of the same movie file name family
        assert_eq!(movie_key("The.Matrix.1999.1080p.BluRay.x264"), "the matrix|1999");
        assert_eq!(movie_key("The Matrix (1999) 2160p REMUX"), "the matrix|1999");
        assert_eq!(movie_key("Inception"), "inception");
    }

    #[test]
    fn show_key_is_stable_and_lowercased() {
        // the grouping key must be identical across season/quality variants so a
        // rescan re-finds the same (possibly renamed) show
        assert_eq!(show_key("Miraculouse"), "miraculouse");
        assert_eq!(show_key("Marvel's Daredevil Season 2 1080p"), show_key("Marvel's Daredevil Season 3"));
        assert_eq!(show_key("Daredevil S03"), "daredevil");
    }
}
