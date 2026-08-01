// ============================================================================
// GHGFlix Server — Dateinamen-Erkennung
//
// 1:1-Port der Desktop-Logik aus `src-tauri/src/parser.rs` (Rust), erweitert um
// die Ordner-/Namenskonventionen von Plex und Jellyfin. Beide Seiten MÜSSEN
// identisch erkennen, sonst zeigt der Server andere Titel/Folgen als die
// Windows-App und der TMDb-gestützte Sync findet die Medien nicht wieder.
//
// Referenz Desktop:  src-tauri/src/parser.rs
// Referenz Plex:     "Show/Season 01/Show - s01e02 - Title.mkv"
// Referenz Jellyfin: zusätzlich "Show (2019) [tmdbid-1399]/…", Mehrteiler
//                    "s01e01-e02", Specials = Season 00.
//
// Die Selbsttests am Ende der Datei laufen mit  `node src/parser.js --test`.
// ============================================================================

/** Videoendungen — identisch zu VIDEO_EXTS in parser.rs. */
export const VIDEO_EXT = new Set([
  "mkv", "mp4", "avi", "mov", "m4v", "wmv", "flv", "webm", "ts", "m2ts", "mts",
  "mpg", "mpeg", "vob", "ogv", "3gp", "divx",
]);

/** Bild-Endungen für lokale Artwork-Dateien (poster.jpg & Co). */
export const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "bmp", "tbn"]);

/** Untertitel-Dateien, die neben dem Video liegen dürfen. */
export const SUBTITLE_EXT = new Set(["srt", "ass", "ssa", "vtt", "sub", "idx", "sup"]);

// ── Reguläre Ausdrücke (Spiegel der LazyLock-Regexe in parser.rs) ────────────

const RE_SXXEXX = /s(\d{1,2})\s*[._\- ]?\s*e(\d{1,3})/i;
// Mehrteiler: "S01E01-E02", "S01E01E02", "S01E01-02"  (Plex/Jellyfin)
const RE_SXXEXX_RANGE = /s(\d{1,2})\s*[._\- ]?\s*e(\d{1,3})(?:\s*[-_ ]\s*e?(\d{1,3})|\s*e(\d{1,3}))?/i;
const RE_NXNN = /(?:^|[^\d])(\d{1,2})\s*x\s*(\d{1,3})(?:[^\d]|$)/i;
const RE_SEASON_EP_WORDS = /(?:season|staffel|saison)\s*(\d{1,2}).*?(?:episode|folge|ep)\s*(\d{1,3})/i;
const RE_YEAR = /(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/;
const RE_SEASON_DIR = /(?:season|staffel|saison|series|s)\s*0*(\d{1,3})/i;
const RE_EP_ONLY = /\b(?:episode|folge|ep|e)\s*\.?\s*0*(\d{1,3})\b/i;
const RE_STANDALONE_NUM = /(?:^|[ ._\-])0*(\d{1,3})(?:[ ._\-]|$)/;
const RE_JUNK_CUT =
  /\b(1080p|720p|2160p|1440p|480p|576p|4k|8k|uhd|hdr10?\+?|dolby ?vision|dovi|x264|x265|h\.?264|h\.?265|hevc|avc|av1|xvid|divx|bluray|blu-ray|brrip|bdrip|bdremux|web-?rip|web-?dl|webhd|hdrip|dvdrip|dvdscr|hdtv|pdtv|telesync|aac|ac3|eac3|ddp?5|dts(?:-?hd)?(?:-?ma)?|truehd|atmos|flac|opus|mp3|remux|proper|repack|extended|unrated|uncut|directors?.?cut|theatrical|imax|10bit|8bit|hi10p|multi|dual|complete|internal|limited|retail|subbed|dubbed|german|deutsch|english)\b/i;
// "Season 2", "Staffel 02", "S03" — schneidet ein Staffel-Suffix vom Serienordner.
// Die Wortform BRAUCHT Ziffern: mit \d{0,3} matchte auch ein blankes "Series"
// und verstümmelte "A Series of Unfortunate Events" zu "A".
const RE_SEASON_CUT = /\b(?:season|staffel|saison|series)\b\s*\d{1,3}|\bs\d{1,2}(?:e\d{1,3})?\b/i;
// Führende Szene-/URL-Präfixe wie "www.UIndex.org - " (Punkte sind durch
// normalize() schon Leerzeichen, deshalb space-tolerant).
const RE_URL_PREFIX = /^\s*www\b.*?\b(?:org|com|net|info|me|cc|tv|io|to|se|nu|xyz)\b[\s\-_.:|]*/i;
// Streunende Szene-/Seiten-Tokens irgendwo im Namen.
const RE_SITE_TOKEN =
  /\b(?:www|uindex|rarbg|yts|yify|eztv|ettv|phdteam|psa|galaxytv|ethel|mkvcage|sparks|ntb|torrentgalaxy|anoxmous)\b/gi;
// Jellyfin/Plex-Provider-Tags: "[tmdbid-1399]", "{tmdb-1399}", "[imdbid-tt0903747]"
const RE_PROVIDER_TAG = /[[{](tmdbid|tmdb|imdbid|imdb|tvdbid|tvdb)[-=]?\s*((?:tt)?\d+)[\]}]/i;

// ── kleine Helfer (Spiegel der Rust-Funktionen) ─────────────────────────────

const collapseWs = (s) => String(s).split(/\s+/).filter(Boolean).join(" ");

/** Entfernt [...] und {...} (Release-Tags), behält (...) für die Jahreszahl. */
function stripBrackets(s) {
  let out = "";
  let depth = 0;
  for (const c of String(s)) {
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      if (depth > 0) depth--;
    } else if (depth === 0) out += c;
  }
  return out;
}

function normalize(raw) {
  const replaced = String(raw).replace(/[._]/g, " ");
  return collapseWs(stripBrackets(replaced));
}

const cleanPiece = (s) => collapseWs(s).replace(/^[-\s(),]+|[-\s(),]+$/g, "");

/** Dateiname ohne Endung. */
export function fileStem(name) {
  const s = String(name);
  const i = s.lastIndexOf(".");
  return i > 0 ? s.slice(0, i) : s;
}

export function isVideo(name) {
  const ext = String(name).split(".").pop()?.toLowerCase();
  return ext != null && VIDEO_EXT.has(ext);
}

export function isImage(name) {
  const ext = String(name).split(".").pop()?.toLowerCase();
  return ext != null && IMAGE_EXT.has(ext);
}

/**
 * Szene-Releases legen winzige "sample"/"trailer"-Clips neben die echte Datei —
 * werden die indiziert, entstehen Geister-Duplikate. Identisch zu is_junk_clip().
 */
export function isJunkClip(stem) {
  return String(stem)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((t) => t === "sample" || t === "trailer" || t === "proof");
}

// Wörter, die für sich allein NIE ein Serientitel sein können.
const SITE_WORDS = new Set([
  "www", "org", "com", "net", "info", "me", "cc", "tv", "io", "to", "se", "nu",
  "xyz", "eu", "de", "us", "co", "uk", "uindex", "rarbg", "yts", "yify", "eztv",
  "ettv", "phdteam", "psa", "galaxytv", "ethel", "mkvcage", "sparks", "ntb",
  "torrentgalaxy", "anoxmous", "tgx", "index", "torrent", "torrents", "dl",
  "downloads", "download", "release", "releases", "scene", "pack", "packs",
]);

/**
 * Ist das ein wertloser „Titel"? Genau hier ist die Fehlerkennung entstanden,
 * die aus dem Sammelordner „www.UIndex.org" die Serie „OrG! (Come & Play)"
 * gemacht hat: Nach dem Entfernen von „www" und „uindex" blieb „org" übrig —
 * und TMDb findet zu „org" tatsächlich eine Serie.
 *
 * Solche Titel dürfen nie in eine TMDb-Suche gehen; der Aufrufer weicht dann
 * auf den DATEINAMEN aus, in dem der echte Titel steht.
 */
export function isJunkTitle(t) {
  const s = String(t ?? "").trim();
  if (s.length < 2) return true;
  const tokens = s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((w) => SITE_WORDS.has(w) || /^\d{1,4}$/.test(w));
}

/**
 * Ordnernamen, die NICHTS über den Inhalt aussagen.
 *
 * Echtes Beispiel (gemessen am 01.08.2026):
 *   Websites Download\miraculous to\Downloads\Staffel 1\101 - Stormy Weather.mp4
 * Der Serienordner heißt „Downloads" — daraus wurde in der Bibliothek eine
 * Serie namens „Downloads" mit 90 Folgen, die TMDb natürlich nicht kennt.
 * Der bedeutungsvolle Name steht eine Ebene HÖHER („miraculous to").
 *
 * Solche Namen kommen von Download-Programmen, Browsern und Aufräumaktionen.
 * Trifft einer zu, geht showSourceName eine Ebene nach oben.
 */
const GENERISCHE_ORDNER = new Set([
  "downloads", "download", "downloaded", "dl",
  "video", "videos", "media", "medien", "movie", "movies", "film", "filme",
  "serie", "serien", "series", "show", "shows", "tv", "tvshows", "anime",
  "neuer ordner", "new folder", "ordner", "folder", "temp", "tmp",
  "complete", "completed", "fertig", "sonstiges", "misc", "diverses",
  "web ui", "output", "ausgabe", "export", "unsortiert", "unsorted",
]);

export function isGenericDir(name) {
  const t = String(name ?? "").trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
  if (!t) return true;
  if (GENERISCHE_ORDNER.has(t)) return true;
  // „Downloads (2)", „Neuer Ordner 3", „Video 1" — dieselbe Sorte mit Zusatz
  const ohneZahl = t.replace(/\s*\(?\d+\)?$/, "").trim();
  return ohneZahl !== t && GENERISCHE_ORDNER.has(ohneZahl);
}

/* Ein als Ordnername gespeicherter Domainname: „miraculous to" kommt von
   „miraculous.to" (Windows mag keinen Punkt am Ordnerende, bzw. das
   Kopierprogramm hat ihn ersetzt). Das angehängte Länderkürzel gehört NICHT
   zum Serientitel — ohne diese Zeile sucht TMDb nach „miraculous to". */
const TLDS = new Set([
  "to", "com", "net", "org", "tv", "cc", "me", "io", "co", "de", "at", "ch",
  "ru", "se", "sx", "is", "li", "la", "ws", "info", "biz", "xyz", "site",
  "online", "stream", "watch", "pw", "cx", "gs", "nu",
]);

export function stripDomainSuffix(name) {
  const roh = String(name ?? "").trim();
  const teile = roh.split(/\s+/);
  if (teile.length < 2) return roh;
  const letztes = teile[teile.length - 1].toLowerCase().replace(/[^a-z]/g, "");
  if (!TLDS.has(letztes)) return roh;
  const rest = teile.slice(0, -1).join(" ").trim();
  // Nur kürzen, wenn wirklich noch ein Titel übrig bleibt.
  return rest.length >= 3 ? rest : roh;
}

/**
 * Ordner, der nur eine Release-Seite/Sammlung benennt („www.UIndex.org",
 * „[TGx] Torrents"). Solche Ordner sind KEINE Serie — die echte Serie steht
 * eine Ebene tiefer.
 */
export function isSiteDir(name) {
  const raw = String(name ?? "").trim();
  if (!raw) return false;
  // NICHT einfach auf "www" prüfen: "www.UIndex.org - Loki" ist ein völlig
  // normaler Serienordner, aus dem cleanShowTitle sauber "Loki" macht.
  // Entscheidend ist allein, ob nach dem Bereinigen noch ein Titel übrig bleibt.
  return isJunkTitle(cleanShowTitle(raw));
}

/** Plex/Jellyfin-Extras-Ordner, die NICHT als Folgen zählen. */
export function isExtrasDir(name) {
  return /^(?:extras?|featurettes?|behind the scenes|deleted scenes|interviews?|scenes|shorts?|trailers?|other|bonus)$/i.test(
    String(name).trim(),
  );
}

// ── öffentliche API (identische Namen wie parser.rs, camelCase) ─────────────

/** Titel + optionales Jahr aus einem Film-Dateinamen oder Serienordner. */
export function parseTitleYear(raw) {
  const norm = normalize(raw);
  let cut = norm.length;
  let year = null;

  const my = RE_YEAR.exec(norm);
  if (my && my[1]) {
    year = parseInt(my[1], 10);
    cut = Math.min(cut, my.index);
  }
  const mj = RE_JUNK_CUT.exec(norm);
  if (mj) cut = Math.min(cut, mj.index);
  const ms = RE_SXXEXX.exec(norm);
  if (ms) cut = Math.min(cut, ms.index);

  let title = cleanPiece(norm.slice(0, cut));
  if (!title) title = cleanPiece(norm);
  if (!title) title = String(raw);
  return { title, year };
}

/**
 * Titel auf Buchstaben + Leerzeichen (plus Apostroph) reduziert — genau das
 * rettet unsaubere Release-Namen bei der TMDb-Suche am zuverlässigsten.
 */
export function lettersOnly(s) {
  return String(s)
    .replace(RE_SITE_TOKEN, " ")
    .replace(/[^\p{L} ']/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/**
 * Titel zum GRUPPIEREN aller Staffeln einer Serie: schneidet Staffel-Suffix
 * ("Season 2"), Jahr, Szene-Müll und Release-Tags weg.
 * "Marvel's Daredevil Season 2 1080p" → "Marvel's Daredevil".
 */
export function cleanShowTitle(raw) {
  let norm = normalize(raw);
  norm = norm.replace(RE_URL_PREFIX, "");
  let cut = norm.length;
  for (const re of [RE_YEAR, RE_JUNK_CUT, RE_SXXEXX, RE_NXNN, RE_SEASON_CUT]) {
    const m = re.exec(norm);
    if (m) cut = Math.min(cut, m.index);
  }
  let t = cleanPiece(norm.slice(0, cut));
  if (!t) t = cleanPiece(norm.replace(RE_SITE_TOKEN, " "));
  if (!t) t = cleanPiece(norm);
  return t;
}

/** Stabiler, kleingeschriebener Gruppierungs-Key für einen Serienordner. */
export function showKey(raw) {
  return cleanShowTitle(raw).toLowerCase();
}

/**
 * Stabiler Identitäts-Key für eine FILM-Datei (aus dem Namen, nicht aus der
 * DB-Zeile). So wird eine manuelle Zuordnung auch nach "Bibliothek neu
 * aufbauen" automatisch wieder angewendet.
 */
export function movieKey(stem) {
  const { title, year } = parseTitleYear(stem);
  let base = lettersOnly(title).toLowerCase();
  if (!base) base = title.toLowerCase();
  return year ? `${base}|${year}` : base;
}

/**
 * Nachsichtige TMDb-Suchanfrage: Trenner (. _ -) werden Leerzeichen, Klammer-
 * Tags/Szene-Präfixe/Qualitätsmüll fliegen raus. Buchstaben, Ziffern und
 * Apostrophe bleiben, damit "Spider-Man" → "Spider Man" und "9-1-1" → "9 1 1".
 */
export function cleanSearchQuery(raw) {
  const replaced = String(raw).replace(/[._\-]/g, " ");
  let base = collapseWs(stripBrackets(replaced));
  base = base.replace(RE_URL_PREFIX, "").replace(RE_SITE_TOKEN, " ");
  let cut = base.length;
  const mj = RE_JUNK_CUT.exec(base);
  if (mj) cut = Math.min(cut, mj.index);
  const t = cleanPiece(base.slice(0, cut));
  return t || collapseWs(base);
}

/** Staffelnummer aus einem Ordnernamen, sonst null. */
export function parseSeasonFromDir(dir) {
  const d = String(dir).toLowerCase();
  if (d.includes("special")) return 0;
  const m = RE_SEASON_DIR.exec(String(dir));
  return m ? parseInt(m[1], 10) : null;
}

/**
 * True, wenn ein Ordnername NUR ein Staffel-Marker ist ("Season 2", "S03",
 * "Specials") — er benennt also eine Staffel, keine Serie. Bewusst streng, damit
 * echte Serienordner ("Stranger Things S01-S04") nicht hineinfallen.
 */
export function isPureSeasonDir(name) {
  const t = String(name).trim().toLowerCase();
  if (t === "specials" || t === "special" || t === "extras") return true;
  return /^(?:season|staffel|saison|s)\s*0*\d{1,3}$/i.test(t);
}

/**
 * (Staffel, Folge) aus einem Dateinamen erkennen, mit dem Elternordner als
 * Hinweis. Zusätzlich zu parser.rs: Mehrteiler geben `episodeEnd` zurück.
 */
export function parseEpisode(stem, parentDir = "") {
  const norm = normalize(stem);

  const mr = RE_SXXEXX_RANGE.exec(norm);
  if (mr) {
    const season = parseInt(mr[1], 10);
    const episode = parseInt(mr[2], 10);
    const raw = mr[3] ?? mr[4];
    const end = raw != null ? parseInt(raw, 10) : null;
    return { season, episode, episodeEnd: end != null && end > episode && end - episode < 20 ? end : null };
  }
  const mn = RE_NXNN.exec(norm);
  if (mn) return { season: parseInt(mn[1], 10), episode: parseInt(mn[2], 10), episodeEnd: null };
  const mw = RE_SEASON_EP_WORDS.exec(norm);
  if (mw) return { season: parseInt(mw[1], 10), episode: parseInt(mw[2], 10), episodeEnd: null };

  const season = parseSeasonFromDir(parentDir);
  if (season != null) {
    const me = RE_EP_ONLY.exec(norm);
    if (me) return { season, episode: parseInt(me[1], 10), episodeEnd: null };
    const ms = RE_STANDALONE_NUM.exec(norm);
    if (ms) {
      const zahl = parseInt(ms[1], 10);
      /* Zusammengezogene Nummer wie "101" in "Staffel 1" = 1x01, also Folge 1.
         Diese Schreibweise benutzen Download-Seiten und alte Rips.

         Gemessen am 01.08.2026 an
           …\miraculous to\Downloads\Staffel 1\101 - Stormy Weather.mp4
         Vorher wurde daraus S01E101 — die Bibliothek zeigte dadurch wilde
         Folgennummern und TMDb fand zu "Folge 101" nie einen Titel.

         Bewusst nur, wenn die FÜHRENDE Ziffernfolge exakt die Staffel aus dem
         Ordnernamen ist. Sonst würde aus "Staffel 1\250 - Titel" fälschlich
         S02E50, obwohl dort schlicht Folge 250 gemeint sein kann. */
      const rest = zahl % 100;
      if (zahl >= 100 && Math.floor(zahl / 100) === season && rest >= 1) {
        return { season, episode: rest, episodeEnd: null };
      }
      return { season, episode: zahl, episodeEnd: null };
    }
  }
  return null;
}

/** Folgentitel: alles NACH dem SxxEyy-Marker (für Anzeige ohne TMDb). */
export function episodeTitleFromFile(stem) {
  const norm = normalize(stem);
  const m = RE_SXXEXX_RANGE.exec(norm) || RE_NXNN.exec(norm);
  if (!m) return null;
  const after = norm.slice(m.index + m[0].length);
  const mj = RE_JUNK_CUT.exec(after);
  const cut = mj ? mj.index : after.length;
  const t = cleanPiece(after.slice(0, cut));
  return t || null;
}

/** Jellyfin/Plex-Provider-Tag im Ordner-/Dateinamen ("[tmdbid-1399]"). */
export function providerId(raw) {
  const m = RE_PROVIDER_TAG.exec(String(raw));
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const value = m[2];
  const kind = tag.startsWith("imdb") ? "imdb" : tag.startsWith("tvdb") ? "tvdb" : "tmdb";
  if (kind === "tmdb") {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? { kind, id: n } : null;
  }
  return { kind, id: value };
}

// ── Alt-API (Kompatibilität mit dem bisherigen Server-Code) ─────────────────

export const cleanTitle = (raw) => parseTitleYear(fileStem(raw)).title;
export const extractYear = (raw) => parseTitleYear(raw).year;
export const parseSeasonFolder = (name) => parseSeasonFromDir(name);
export const showTitleFromFile = (fileName) => cleanShowTitle(fileStem(fileName));
export function parseMovie(fileName) {
  const { title, year } = parseTitleYear(fileStem(fileName));
  return { title: title || fileName, year };
}

// ── Selbsttests: `node src/parser.js --test` ────────────────────────────────
// Bewusst dieselben Fälle wie in parser.rs, damit Abweichungen sofort auffallen.

if (process.argv[1]?.endsWith("parser.js") && process.argv.includes("--test")) {
  let fails = 0;
  const eq = (got, want, label) => {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g !== w) {
      fails++;
      console.error(`✗ ${label}\n   erwartet: ${w}\n   bekommen: ${g}`);
    } else console.log(`✓ ${label}`);
  };

  eq(parseTitleYear("The.Matrix.1999.1080p.BluRay.x264"), { title: "The Matrix", year: 1999 }, "Film: The Matrix");
  eq(parseTitleYear("Inception (2010)"), { title: "Inception", year: 2010 }, "Film: Inception");

  eq(parseEpisode("Show.S01E02.1080p", ""), { season: 1, episode: 2, episodeEnd: null }, "Folge: S01E02");
  eq(parseEpisode("Show 1x05", ""), { season: 1, episode: 5, episodeEnd: null }, "Folge: 1x05");
  eq(parseEpisode("Folge 7", "Staffel 3"), { season: 3, episode: 7, episodeEnd: null }, "Folge: Ordner-Hinweis");
  eq(parseEpisode("Show - s01e01-e02 - Pilot", ""), { season: 1, episode: 1, episodeEnd: 2 }, "Folge: Mehrteiler");
  eq(parseEpisode("Show S00E01 Special", ""), { season: 0, episode: 1, episodeEnd: null }, "Folge: Special");

  eq(cleanShowTitle("Marvel's Daredevil Season 1"), "Marvel's Daredevil", "Serie: Season-Suffix weg");
  eq(cleanShowTitle("Marvel's Daredevil Season 2 1080p BluRay"), "Marvel's Daredevil", "Serie: Season+Qualität weg");
  eq(cleanShowTitle("Daredevil S03"), "Daredevil", "Serie: S03 weg");
  eq(cleanShowTitle("Daredevil.Born.Again.2025.S01.2160p"), "Daredevil Born Again", "Serie: Jahr+Staffel weg");
  eq(cleanShowTitle("www.UIndex.org - Daredevil Born Again"), "Daredevil Born Again", "Serie: URL-Präfix weg");
  eq(cleanShowTitle("A Series of Unfortunate Events"), "A Series of Unfortunate Events", "Serie: Titel bleibt heil");
  eq(cleanShowTitle("Series of Unfortunate Events Series 2"), "Series of Unfortunate Events", "Serie: 'Series 2' weg");

  eq(lettersOnly("Daredevil Born Again"), "Daredevil Born Again", "Buchstaben: unverändert");
  eq(lettersOnly("Marvel's Daredevil (2015)"), "Marvel's Daredevil", "Buchstaben: Jahr weg");
  eq(lettersOnly("Loki"), "Loki", "Buchstaben: kurz");

  eq(cleanSearchQuery("Spider-Man"), "Spider Man", "Suche: Bindestrich");
  eq(cleanSearchQuery("Miraculous - Tales of Ladybug"), "Miraculous Tales of Ladybug", "Suche: Trenner");
  eq(cleanSearchQuery("9-1-1"), "9 1 1", "Suche: Ziffern bleiben");
  eq(cleanSearchQuery("The.Matrix.1999.1080p.BluRay"), "The Matrix 1999", "Suche: Qualität abgeschnitten");
  eq(cleanSearchQuery("www.UIndex.org - Daredevil"), "Daredevil", "Suche: URL-Präfix weg");

  eq(movieKey("The.Matrix.1999.1080p.BluRay.x264"), "the matrix|1999", "Key: Film stabil");
  eq(movieKey("The Matrix (1999) 2160p REMUX"), "the matrix|1999", "Key: Film stabil (andere Quelle)");
  eq(movieKey("Inception"), "inception", "Key: Film ohne Jahr");
  eq(showKey("Miraculouse"), "miraculouse", "Key: Serie einfach");
  eq(showKey("Marvel's Daredevil Season 2 1080p") === showKey("Marvel's Daredevil Season 3"), true, "Key: Staffeln gleich");
  eq(showKey("Daredevil S03"), "daredevil", "Key: Serie mit S03");

  eq(isPureSeasonDir("Season 2"), true, "Ordner: Season 2 ist Staffelordner");
  eq(isPureSeasonDir("Specials"), true, "Ordner: Specials");
  eq(isPureSeasonDir("Stranger Things S01-S04"), false, "Ordner: Serienordner bleibt Serienordner");
  eq(parseSeasonFromDir("Staffel 02"), 2, "Ordner: Staffel 02 → 2");
  eq(parseSeasonFromDir("Specials"), 0, "Ordner: Specials → 0");

  eq(providerId("Firefly (2002) [tmdbid-1437]"), { kind: "tmdb", id: 1437 }, "Provider: tmdbid");
  eq(providerId("Firefly"), null, "Provider: keiner");

  // Regression: aus dem Sammelordner "www.UIndex.org" wurde die Serie "OrG!"
  eq(isJunkTitle(cleanShowTitle("www.UIndex.org")), true, "Müll-Titel: www.UIndex.org");
  eq(isJunkTitle("org"), true, "Müll-Titel: org");
  eq(isJunkTitle("OrG"), true, "Müll-Titel: OrG");
  eq(isJunkTitle("TGx"), true, "Müll-Titel: TGx");
  eq(isJunkTitle("2019"), true, "Müll-Titel: nur Jahr");
  eq(isJunkTitle("Loki"), false, "Müll-Titel: echter Titel bleibt");
  eq(isJunkTitle("Daredevil Born Again"), false, "Müll-Titel: echter Titel bleibt (lang)");
  eq(isSiteDir("www.UIndex.org"), true, "Seiten-Ordner erkannt");
  eq(isSiteDir("[TGx]"), true, "Seiten-Ordner erkannt (TGx)");
  eq(isSiteDir("Daredevil Born Again"), false, "Serienordner ist kein Seiten-Ordner");
  eq(isSiteDir("Stranger Things"), false, "Serienordner ist kein Seiten-Ordner (2)");
  // aus dem Dateinamen muss der echte Titel kommen
  eq(
    cleanShowTitle("Daredevil.Born.Again.S02E06.Requiem.DSNP.DDP5.1.HDR.2160p.WEB-DL"),
    "Daredevil Born Again",
    "Dateiname liefert echten Serientitel",
  );

  eq(isJunkClip("Movie-sample"), true, "Müll: sample");
  eq(isJunkClip("The Sample Room S01E01"), true, "Müll: Wort 'Sample'");
  eq(isJunkClip("Movie 2019"), false, "Müll: normal");

  console.log(fails === 0 ? "\nAlle Parser-Tests bestanden." : `\n${fails} Test(s) fehlgeschlagen.`);
  process.exit(fails === 0 ? 0 : 1);
}
