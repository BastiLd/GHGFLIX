// ============================================================================
// Bonusmaterial einer Serie — und kurze Notizen an einzelnen Einträgen.
//
// Port von src-tauri/src/extras.rs. WARUM ES DAS GIBT (gemessen am 19.08.2026
// am Desktop): In den Serienordnern lagen 83 Dateien wie
// `The Newsroom …\Featurettes\Season 1\Inside the Episode\Amen.mkv` und
// `Suits …\Extras\Season 02\Gag Reel.mkv`. Ohne Folgennummer wurden sie zu
// „Filmen", und die TMDb-Suche hängte ihnen einen echten Kinofilm an („Amen."
// von 2002, „Gag" von 2006). Der Server hat solche Ordner bisher einfach
// übersprungen — jetzt landen sie als das, was sie sind: Zusatzmaterial der
// Serie, nach Art getrennt und der Staffel zugeordnet.
//
// Desktop und Server MÜSSEN hier gleich entscheiden, sonst sieht der Fernseher
// andere Reiter als der PC.
// ============================================================================
import { statSync } from "node:fs";
import { openDb } from "./db.js";
import { parseSeasonFromDir } from "./parser.js";

/** Die Arten von Zusatzmaterial. `sonstiges` ist der Auffangwert. */
export const ARTEN = ["special", "blooper", "behind", "deleted", "featurette", "interview", "trailer", "sonstiges"];

/** Ordnernamen, die eine Art KONKRET benennen — sie schlagen den Dateinamen. */
function artAusOrdnerKonkret(name) {
  const t = String(name).trim().toLowerCase();
  const hat = (w) => t.includes(w);
  if (hat("gag") || hat("blooper") || hat("outtake") || hat("panne")) return "blooper";
  if (hat("deleted") || hat("geloescht") || hat("gelöscht") || hat("entfernte szene")) return "deleted";
  if (hat("behind the scenes") || hat("hinter den kulissen") || hat("making of") || hat("making-of")) return "behind";
  if (hat("interview")) return "interview";
  if (hat("trailer") || hat("teaser")) return "trailer";
  if (hat("inside the episode")) return "featurette";
  // „Special Extras Season 1" ist ein SAMMELordner, kein Specials-Ordner.
  if (hat("special") && !hat("extra") && !hat("bonus") && !hat("featurette")) return "special";
  return null;
}

/** SAMMELordner („Extras", „Bonus") dürfen den Dateinamen NICHT überstimmen
 *  (sonst wurde `Suits …\Extras\Season 02\Gag Reel.mkv` zur „Featurette"). */
function artAusSammelordner(name) {
  const t = String(name).trim().toLowerCase();
  return t.includes("featurette") || t.includes("bonus") || t.includes("extra") ? "featurette" : null;
}

/** Dateiname → Art, wenn der Ordner nichts verrät. */
function artAusDatei(stem) {
  const t = String(stem).toLowerCase();
  const hat = (w) => t.includes(w);
  if (hat("gag reel") || hat("blooper") || hat("outtake")) return "blooper";
  if (hat("deleted scene") || hat("deleted-scene")) return "deleted";
  if (hat("behind the scenes") || hat("making of")) return "behind";
  if (hat("interview")) return "interview";
  if (hat("trailer") || hat("teaser")) return "trailer";
  return null;
}

/** Staffel eines Ordners. Ausgeschriebenes „Season 1" hat Vorrang — sonst
 *  würde „Special Extras Season 1" wegen „Special" zu Staffel 0. */
export function staffelAusOrdner(name) {
  const m = /\b(?:season|staffel|saison)\s*0*(\d{1,3})\b/i.exec(String(name));
  if (m) return Number(m[1]);
  return parseSeasonFromDir(name);
}

/**
 * Art + Staffel eines Bonus-Fundes aus den Ordnern ZWISCHEN Bibliothek und
 * Datei. Der tiefste (spezifischste) Ordner gewinnt:
 * `Featurettes\Season 1\Deleted Scenes\x.mkv` → „deleted", Staffel 1.
 */
export function artUndStaffel(relOrdner, dateiname) {
  let konkret = null;
  let sammel = null;
  let staffel = null;
  for (const teil of relOrdner) {
    const s = staffelAusOrdner(teil);
    if (s != null) staffel = s;
    konkret = artAusOrdnerKonkret(teil) ?? konkret;
    sammel = artAusSammelordner(teil) ?? sammel;
  }
  // Reihenfolge: konkreter Ordner → Dateiname → Sammelordner → unbekannt.
  return { art: konkret ?? artAusDatei(dateiname) ?? sammel ?? "sonstiges", staffel };
}

/** Einen Fund eintragen. Von Hand gesetzte Einträge werden NICHT überschrieben. */
export function merken(showId, path, titel, art, staffel) {
  const d = openDb();
  const alt = d.prepare("SELECT von_hand FROM extras WHERE path = ?").get(path);
  if (alt?.von_hand === 1) {
    // Handentscheidung schlägt die Automatik — nur die Serie nachziehen.
    d.prepare("UPDATE extras SET show_id=? WHERE path=?").run(showId, path);
    return;
  }
  d.prepare(
    `INSERT INTO extras (show_id, path, titel, art, staffel, von_hand, added_at) VALUES (?,?,?,?,?,0,?)
     ON CONFLICT(path) DO UPDATE SET show_id=excluded.show_id, titel=excluded.titel,
       art=excluded.art, staffel=excluded.staffel`,
  ).run(showId, path, titel, art, staffel ?? null, Date.now());
}

const COLS = `e.id, e.show_id, e.path, e.titel, e.art, e.staffel, e.von_hand, e.width, e.height,
              (SELECT n.text FROM notizen n WHERE n.path = e.path) notiz`;

/** Zeile → Form, die die Oberfläche erwartet (wie extras::Extra am Desktop). */
export const extraOut = (r) =>
  r && {
    id: r.id,
    showId: r.show_id,
    path: r.path,
    titel: r.titel,
    art: r.art,
    staffel: r.staffel ?? null,
    vonHand: r.von_hand === 1,
    notiz: r.notiz ?? null,
    width: r.width ?? null,
    height: r.height ?? null,
  };

export function fuerSerie(showId) {
  return openDb()
    .prepare(`SELECT ${COLS} FROM extras e WHERE e.show_id = ? ORDER BY COALESCE(e.staffel, 9999), e.titel COLLATE NOCASE`)
    .all(showId)
    .map(extraOut);
}

export function get(id) {
  return extraOut(openDb().prepare(`SELECT ${COLS} FROM extras e WHERE e.id = ?`).get(id)) ?? null;
}

/** Art und/oder Staffel von Hand setzen (Zuordnungs-Fenster). */
export function vonHandSetzen(id, art, staffel) {
  if (!ARTEN.includes(art)) throw new Error("Unbekannte Art: " + art);
  openDb().prepare("UPDATE extras SET art=?, staffel=?, von_hand=1 WHERE id=?").run(art, staffel ?? null, id);
}

/** Einträge wegräumen, deren Datei es nicht mehr gibt (offline Platten ausgenommen). */
export function aufraeumen(istOffline) {
  const d = openDb();
  for (const r of d.prepare("SELECT id, path FROM extras").all()) {
    if (istOffline(r.path)) continue;
    let weg = false;
    try {
      statSync(r.path);
    } catch {
      weg = true;
    }
    if (weg) d.prepare("DELETE FROM extras WHERE id = ?").run(r.id);
  }
  // Bonusmaterial einer verschwundenen Serie hat keinen Anker mehr.
  d.exec("DELETE FROM extras WHERE show_id NOT IN (SELECT id FROM shows)");
}

// ── Notizen ─────────────────────────────────────────────────────────────────

/** Notiz setzen (leerer Text löscht sie). Hängt am Pfad, überlebt „neu aufbauen". */
export function notizSetzen(path, text) {
  const d = openDb();
  const t = String(text ?? "").trim();
  if (!t) d.prepare("DELETE FROM notizen WHERE path = ?").run(path);
  else d.prepare("INSERT INTO notizen (path, text) VALUES (?,?) ON CONFLICT(path) DO UPDATE SET text=excluded.text").run(path, t);
}

export const notiz = (path) => openDb().prepare("SELECT text FROM notizen WHERE path = ?").get(path)?.text ?? null;

/** Alle Notizen auf einmal als [pfad, text] — die Serienansicht braucht sie je Folge. */
export const alleNotizen = () =>
  openDb().prepare("SELECT path, text FROM notizen").all().map((r) => [r.path, r.text]);
