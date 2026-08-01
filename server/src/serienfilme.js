// Welche Filme gehören zu einer Serie? (Punkt 3 der Übergabe) — Server-Seite.
//
// 1:1-Gegenstück zu src-tauri/src/serienfilme.rs. Die ausführliche Begründung
// steht dort; kurz:
//
//   1. ORDNER — der Film liegt unterhalb des Serienordners (stärkstes Signal,
//      der Nutzer hat die Datei selbst dorthin gelegt).
//   2. TITEL  — der Filmtitel beginnt mit dem Serientitel und geht darüber
//      hinaus. Reine Gleichheit zählt NICHT: ein Film, der genau so heißt wie
//      die Serie, ist die Vorlage und nicht ein Zusatzfilm.
//   3. HAND   — Zuordnungen und Ausschlüsse des Nutzers schlagen beides. Sie
//      hängen an TMDb-ID/Titel statt an der Zeilen-ID, damit sie „Bibliothek
//      neu aufbauen" überleben.
import { getSetting, setSetting, openDb } from "./db.js";
import { lettersOnly, showKey, parseSeasonFromDir } from "./parser.js";

export const LINK_KEY = "show_movie_links";

const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Stabiler Schlüssel einer Serie. */
export const showSchluessel = (show) =>
  show?.tmdb_id ? `tmdb:${show.tmdb_id}` : `titel:${showKey(show?.title || "")}`;

/** Stabiler Schlüssel eines Films — Titel plus Jahr, nicht die Zeilen-ID. */
export function filmSchluessel(m) {
  const basis = lettersOnly(m?.title || "").toLowerCase() || String(m?.title || "").toLowerCase();
  return m?.year ? `${basis}|${m.year}` : basis;
}

function alleLinks() {
  try {
    const roh = getSetting(LINK_KEY);
    const o = roh ? JSON.parse(roh) : {};
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

/**
 * Der Ordner, in dem die Serie liegt — aus dem Pfad einer Folge abgeleitet.
 * „…/Serie/Season 1/folge.mkv" → „…/serie". Flache Serienordner ergeben ihren
 * eigenen Ordner.
 */
function serienOrdner(episoden) {
  const ep = episoden?.[0];
  if (!ep?.path) return null;
  const teile = norm(ep.path).split("/");
  teile.pop(); // Dateiname
  const letzter = teile[teile.length - 1] || "";
  if (parseSeasonFromDir(letzter) != null) teile.pop();
  return teile.join("/");
}

function passtAutomatisch(m, titelNorm, ordner) {
  if (ordner && norm(m.path).startsWith(ordner + "/")) return true;
  if (!titelNorm) return false;
  const film = lettersOnly(m.title || "").toLowerCase();
  return film.length > titelNorm.length && film.startsWith(titelNorm + " ");
}

/**
 * Die Filme, die zu dieser Serie gehören — als rohe DB-Zeilen. Der Aufrufer
 * bringt sie selbst in die passende Form (withArt bzw. movieOut).
 */
export function fuerSerie(show, episoden) {
  const d = openDb();
  const links = alleLinks()[showSchluessel(show)] || {};
  const dazu = new Set((links.dazu || []).map((x) => String(x).toLowerCase()));
  const weg = new Set((links.weg || []).map((x) => String(x).toLowerCase()));

  const ordner = serienOrdner(episoden);
  const titelNorm = lettersOnly(show?.title || "").toLowerCase();

  return d
    .prepare("SELECT * FROM movies")
    .all()
    .filter((m) => {
      const k = filmSchluessel(m).toLowerCase();
      if (weg.has(k)) return false;
      if (dazu.has(k)) return true;
      return passtAutomatisch(m, titelNorm, ordner);
    })
    .sort(
      (a, b) =>
        (a.year ?? 9999) - (b.year ?? 9999) ||
        String(a.title).toLowerCase().localeCompare(String(b.title).toLowerCase(), "de"),
    );
}

/** Einen Film von Hand zuordnen (`dazu = true`) oder ausschließen. */
export function verknuepfen(show, film, dazu) {
  const alle = alleLinks();
  const key = showSchluessel(show);
  const e = alle[key] || { dazu: [], weg: [] };
  const fk = filmSchluessel(film);
  e.dazu = (e.dazu || []).filter((x) => String(x).toLowerCase() !== fk);
  e.weg = (e.weg || []).filter((x) => String(x).toLowerCase() !== fk);
  (dazu ? e.dazu : e.weg).push(fk);
  alle[key] = e;
  setSetting(LINK_KEY, JSON.stringify(alle));
}
