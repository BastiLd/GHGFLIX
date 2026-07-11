// Filename → media info. Ported from the desktop app's Rust parser: handles
// "Show S01E02", "1x02", season folders ("Staffel 2" / "Season 2" / "S02"),
// movie "Title (2019)" and scene-release noise.

export const VIDEO_EXT = new Set(["mkv", "mp4", "m4v", "avi", "mov", "webm", "wmv", "ts", "m2ts", "flv", "mpg", "mpeg"]);

const NOISE =
  /\b(1080p|2160p|720p|480p|4k|uhd|hdr10?\+?|dv|dolby ?vision|x26[45]|h ?26[45]|hevc|avc|av1|web-?dl|webrip|bluray|blu-ray|bdrip|brrip|dvdrip|hdtv|remux|proper|repack|extended|unrated|german|english|deutsch|multi|dl|dts(-?hd)?|dd[p+]?5\.?1|ac3|eac3|aac|atmos|truehd|10bit|8bit|hi10p)\b/gi;

export function isVideo(name) {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext != null && VIDEO_EXT.has(ext);
}

export function cleanTitle(raw) {
  let t = raw.replace(/\.[^.]+$/, ""); // extension
  t = t.replace(/[._]/g, " ");
  t = t.replace(NOISE, " ");
  t = t.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ");
  t = t.replace(/-\s*\w+$/g, " "); // trailing release group "-GROUP"
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

export function extractYear(raw) {
  const m = [...raw.matchAll(/[(. _[]((19|20)\d{2})[). _\]]/g)].pop();
  return m ? parseInt(m[1], 10) : null;
}

/** SxxEyy / 1x02 / "Season 2 Episode 3" → {season, episode, title} or null. */
export function parseEpisode(fileName) {
  const base = fileName.replace(/\.[^.]+$/, "");
  let m =
    base.match(/[Ss](\d{1,2})[ ._-]?[Ee](\d{1,3})(?:-?[Ee]?\d{1,3})?/) ||
    base.match(/\b(\d{1,2})x(\d{1,3})\b/) ||
    base.match(/\b[Ss]taffel[ ._]?(\d{1,2})[ ._-]+(?:Folge|Episode)[ ._]?(\d{1,3})/i) ||
    base.match(/\bSeason[ ._]?(\d{1,2})[ ._-]+Episode[ ._]?(\d{1,3})/i);
  if (!m) {
    // "Episode 5" / "Folge 5" without season → season inferred from folder later
    const e = base.match(/\b(?:Episode|Folge|E)[ ._]?(\d{1,3})\b/i);
    if (e) return { season: null, episode: parseInt(e[1], 10), title: null };
    return null;
  }
  const season = parseInt(m[1], 10);
  const episode = parseInt(m[2], 10);
  // whatever comes after the SxxEyy marker is usually the episode title
  const after = base.slice((m.index ?? 0) + m[0].length);
  const title = cleanTitle(after).replace(/^[-. _]+/, "").trim() || null;
  return { season, episode, title };
}

/** Season number from a folder name, or null. */
export function parseSeasonFolder(name) {
  const m =
    name.match(/^(?:Staffel|Season|Series)[ ._]?(\d{1,2})$/i) ||
    name.match(/^S(\d{1,2})$/i) ||
    name.match(/^(?:Staffel|Season)[ ._]?(\d{1,2})\b/i);
  if (m) return parseInt(m[1], 10);
  if (/^(specials?|extras?)$/i.test(name)) return 0;
  return null;
}

/** Show title from the file name (the part before the SxxEyy marker). */
export function showTitleFromFile(fileName) {
  const base = fileName.replace(/\.[^.]+$/, "");
  const m = base.match(/[Ss]\d{1,2}[ ._-]?[Ee]\d{1,3}|\b\d{1,2}x\d{1,3}\b/);
  const head = m && m.index > 0 ? base.slice(0, m.index) : base;
  return cleanTitle(head);
}

export function parseMovie(fileName) {
  const year = extractYear(fileName);
  let title = cleanTitle(fileName);
  if (year) title = title.replace(String(year), "").trim();
  return { title: title || fileName, year };
}
