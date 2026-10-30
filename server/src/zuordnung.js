// ============================================================================
// Handentscheidungen: „Diese Datei ist in Wirklichkeit …" — Port von
// src-tauri/src/zuordnung.rs.
//
// WARUM (Rückmeldung vom 19.08.2026): An einer Datei ließ sich nur Staffel und
// Folge ändern. Man konnte nicht sagen „das ist ein Film", „das gehört zu einer
// anderen Serie", „das ist ein Blooper" — und eine versehentlich zugeordnete
// Sprach-/Qualitätsfassung wurde man nicht mehr los. Genau das kann diese
// Tabelle. Sie hängt am DATEIPFAD, schlägt jede Automatik und überlebt
// „Bibliothek neu aufbauen".
//
//   ziel = 'folge' | 'film' | 'extra' | 'ignorieren'
// ============================================================================
import { basename } from "node:path";
import { openDb } from "./db.js";

export const ZIELE = ["folge", "film", "extra", "ignorieren"];

const zahl = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Eingabe von außen (camelCase, wie die Oberfläche sie schickt) prüfen. */
export function zielAus(roh) {
  const z = roh ?? {};
  const ziel = String(z.ziel ?? "");
  if (!ZIELE.includes(ziel)) throw new Error("Unbekanntes Ziel: " + ziel);
  return {
    ziel,
    showTmdb: zahl(z.showTmdb),
    staffel: zahl(z.staffel),
    episode: zahl(z.episode),
    extraArt: z.extraArt ? String(z.extraArt) : null,
    tmdbId: zahl(z.tmdbId),
  };
}

export function setzen(path, z) {
  openDb()
    .prepare(
      `INSERT INTO zuordnung (path, ziel, show_tmdb, staffel, episode, extra_art, tmdb_id) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(path) DO UPDATE SET ziel=excluded.ziel, show_tmdb=excluded.show_tmdb, staffel=excluded.staffel,
         episode=excluded.episode, extra_art=excluded.extra_art, tmdb_id=excluded.tmdb_id`,
    )
    .run(path, z.ziel, z.showTmdb, z.staffel, z.episode, z.extraArt, z.tmdbId);
}

/** Handentscheidung aufheben — die Automatik übernimmt wieder. */
export const loeschen = (path) => openDb().prepare("DELETE FROM zuordnung WHERE path = ?").run(path);

export function fuer(path) {
  const r = openDb()
    .prepare("SELECT ziel, show_tmdb, staffel, episode, extra_art, tmdb_id FROM zuordnung WHERE path = ?")
    .get(path);
  if (!r) return null;
  return {
    ziel: r.ziel,
    showTmdb: r.show_tmdb ?? null,
    staffel: r.staffel ?? null,
    episode: r.episode ?? null,
    extraArt: r.extra_art ?? null,
    tmdbId: r.tmdb_id ?? null,
  };
}

/** Alle Handentscheidungen auf einmal (Pfad → Ziel) — spart beim Scan tausende Einzelabfragen. */
export function alle() {
  const m = new Map();
  for (const r of openDb().prepare("SELECT path FROM zuordnung").all()) m.set(r.path, fuer(r.path));
  return m;
}

export function artKlartext(art) {
  return (
    {
      special: "Special",
      blooper: "Bloopers",
      behind: "Hinter den Kulissen",
      deleted: "Gelöschte Szene",
      featurette: "Featurette",
      interview: "Interview",
      trailer: "Trailer",
    }[art] ?? "Sonstiges"
  );
}

const zwei = (n) => String(n).padStart(2, "0");

/**
 * Inhalt des Zuordnungs-Fensters: jede Datei mit vollem Pfad — plus die
 * Begründung, warum sie unsicher ist. „Unsicher" heißt bewusst NICHT „falsch":
 * es sind die Fälle, in denen die Automatik geraten hat.
 */
export function liste(nurUnsichere) {
  const d = openDb();
  const vonHand = new Set(d.prepare("SELECT path FROM zuordnung").all().map((r) => r.path));
  const notizen = new Map(d.prepare("SELECT path, text FROM notizen").all().map((r) => [r.path, r.text]));
  const out = [];
  const eintrag = (path, aktuell, beschreibung, unsicher, hand) =>
    out.push({
      path,
      dateiname: basename(path.replace(/\\/g, "/")),
      aktuell,
      beschreibung,
      unsicher: unsicher ?? null,
      vonHand: !!hand || vonHand.has(path),
      notiz: notizen.get(path) ?? null,
    });

  for (const m of d.prepare("SELECT path, title, year, tmdb_id FROM movies").all()) {
    eintrag(
      m.path,
      "film",
      m.year ? `Film · ${m.title} (${m.year})` : `Film · ${m.title}`,
      m.tmdb_id == null ? "Kein TMDb-Treffer — Titel konnte nicht sicher zugeordnet werden" : null,
    );
  }

  // Jede physische Datei einzeln — auch die zweite Sprach-/Qualitätsfassung.
  const folgen = d
    .prepare(
      `SELECT ef.path, s.title serie, e.season, e.episode, e.title eptitel, s.tmdb_id
       FROM episode_files ef JOIN episodes e ON ef.episode_id = e.id JOIN shows s ON e.show_id = s.id`,
    )
    .all();
  const gesehen = new Set();
  for (const f of folgen) {
    gesehen.add(f.path);
    eintrag(
      f.path,
      "folge",
      `${f.serie} · S${zwei(f.season)}E${zwei(f.episode)}${f.eptitel ? " · " + f.eptitel : ""}`,
      f.tmdb_id == null
        ? "Serie hat keinen TMDb-Treffer"
        : f.eptitel == null
          ? "Folge gibt es bei TMDb nicht — Nummer könnte falsch sein"
          : null,
    );
  }
  // Altbestand: Folgen, deren Hauptdatei (noch) nicht in episode_files steht.
  for (const e of d
    .prepare(
      `SELECT e.path, s.title serie, e.season, e.episode, e.title eptitel, s.tmdb_id
       FROM episodes e JOIN shows s ON e.show_id = s.id`,
    )
    .all()) {
    if (gesehen.has(e.path)) continue;
    eintrag(
      e.path,
      "folge",
      `${e.serie} · S${zwei(e.season)}E${zwei(e.episode)}${e.eptitel ? " · " + e.eptitel : ""}`,
      e.tmdb_id == null ? "Serie hat keinen TMDb-Treffer" : e.eptitel == null ? "Folge gibt es bei TMDb nicht — Nummer könnte falsch sein" : null,
    );
  }

  for (const x of d
    .prepare("SELECT x.path, x.titel, x.art, x.staffel, s.title serie, x.von_hand FROM extras x JOIN shows s ON x.show_id = s.id")
    .all()) {
    eintrag(
      x.path,
      "extra",
      `${x.serie} · ${artKlartext(x.art)}${x.staffel != null ? " · Staffel " + x.staffel : ""} · ${x.titel}`,
      x.art === "sonstiges" && x.von_hand !== 1 ? "Art nicht erkannt — bitte einordnen" : null,
      x.von_hand === 1,
    );
  }

  // Bewusst Ausgeblendetes — damit man es auch wiederfindet.
  for (const r of d.prepare("SELECT path FROM zuordnung WHERE ziel = 'ignorieren'").all()) {
    eintrag(r.path, "nirgends", "Ausgeblendet (von Hand)", null, true);
  }

  const ergebnis = nurUnsichere ? out.filter((e) => e.unsicher) : out;
  ergebnis.sort(
    (a, b) =>
      Number(!!b.unsicher) - Number(!!a.unsicher) ||
      a.dateiname.toLowerCase().localeCompare(b.dateiname.toLowerCase()),
  );
  return ergebnis;
}
