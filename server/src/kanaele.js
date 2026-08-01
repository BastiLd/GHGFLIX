// ============================================================================
// Kanäle & Feeds (Punkt 5 der Übergabe) — Server-Seite
//
// Zwei Dinge in einem Modul, weil es technisch dasselbe ist:
//
//   YOUTUBE   Ein abonnierter Kanal. YouTube bietet zu JEDEM Kanal einen
//             offenen Atom-Feed an:
//               https://www.youtube.com/feeds/videos.xml?channel_id=UC…
//             Der braucht KEINEN API-Schlüssel und kein Kontingent — genau
//             deshalb dieser Weg und nicht die YouTube Data API.
//   LEAKS/BLOG Ein beliebiger RSS- oder Atom-Feed. Gleiches Abholen, gleiches
//             Merken, gleiche Benachrichtigung.
//
// Gespeichert wird in den Einstellungen (Schlüssel `feeds` und `feed_items`),
// nicht in eigenen Tabellen. Grund: keine Schema-Wanderung nötig, und der
// Datenbestand ist winzig (ein paar Dutzend Zeilen). Die Beitragsliste ist
// hart gedeckelt, damit sie nicht unbegrenzt wächst.
//
// Kein XML-Parser als Abhängigkeit: der Server ist bewusst ohne npm-Pakete
// gebaut. Die Feeds von YouTube und gängigen Blogs sind flach genug, dass
// gezielte reguläre Ausdrücke reichen — und ein kaputter Feed darf hier nur
// „nichts Neues" bedeuten, nie einen Absturz.
// ============================================================================
import { getSetting, setSetting } from "./db.js";

const FEEDS_KEY = "feeds";
const ITEMS_KEY = "feed_items";

/** So viele Beiträge werden insgesamt aufgehoben. */
const MAX_ITEMS = 300;

/** So viele Beiträge werden pro Feed und Abruf übernommen. */
const MAX_PRO_FEED = 15;

const HOLEN_TIMEOUT_MS = 15_000;

const jetzt = () => Date.now();

function lesen(key, standard) {
  try {
    const roh = getSetting(key);
    if (!roh) return standard;
    const o = JSON.parse(roh);
    return o ?? standard;
  } catch {
    return standard;
  }
}

export const feedsLaden = () => {
  const v = lesen(FEEDS_KEY, []);
  return Array.isArray(v) ? v : [];
};
const feedsSpeichern = (v) => setSetting(FEEDS_KEY, JSON.stringify(v));

export const beitraegeLaden = () => {
  const v = lesen(ITEMS_KEY, []);
  return Array.isArray(v) ? v : [];
};
const beitraegeSpeichern = (v) => setSetting(ITEMS_KEY, JSON.stringify(v.slice(0, MAX_ITEMS)));

/* ── kleine XML-Helfer ──────────────────────────────────────────────────── */

const ENTITAETEN = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
function entschluesseln(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (ganz, name) => {
      const k = name.toLowerCase();
      if (ENTITAETEN[k] != null) return ENTITAETEN[k];
      if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16) || 63);
      if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10) || 63);
      return ganz;
    })
    .trim();
}

/** Inhalt des ersten <tag>…</tag> in `xml`. */
function tagInhalt(xml, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  return m ? entschluesseln(m[1]) : null;
}

/** Wert eines Attributs des ersten passenden Tags. */
function tagAttribut(xml, tag, attribut) {
  const m = new RegExp(`<${tag}\\b[^>]*\\b${attribut}=["']([^"']+)["'][^>]*>`, "i").exec(xml);
  return m ? entschluesseln(m[1]) : null;
}

/** Alle <item>- bzw. <entry>-Blöcke eines Feeds. */
function eintraege(xml) {
  const raus = [];
  for (const tag of ["item", "entry"]) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
    let m;
    while ((m = re.exec(xml))) raus.push(m[1]);
    if (raus.length) break; // RSS und Atom nie mischen
  }
  return raus;
}

async function holen(url, alsText = true) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(HOLEN_TIMEOUT_MS),
    headers: {
      // Ohne erkennbaren Browser-Agenten liefert YouTube eine Zustimmungsseite
      // statt der Kanalseite — dann fände die Kanal-ID-Suche unten nichts.
      "User-Agent": "Mozilla/5.0 (compatible; GHGFlix/1.0)",
      "Accept-Language": "de,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return alsText ? res.text() : res;
}

/* ── YouTube: Adresse → Kanal-ID ────────────────────────────────────────── */

/**
 * Aus allem, was ein Nutzer einwirft, die Kanal-ID (UC…) machen.
 *
 * Erlaubt sind: die reine ID, /channel/UC…, @handle, /c/Name, /user/Name und
 * sogar ein Link auf ein einzelnes Video des Kanals. Alles außer der reinen ID
 * braucht einen Seitenabruf, weil YouTube die ID nur im HTML nennt.
 */
export async function kanalIdErmitteln(eingabe) {
  const text = String(eingabe || "").trim();
  if (!text) throw new Error("Bitte eine YouTube-Adresse oder Kanal-ID angeben");

  if (/^UC[\w-]{20,}$/.test(text)) return text;
  const direkt = /youtube\.com\/channel\/(UC[\w-]{20,})/i.exec(text);
  if (direkt) return direkt[1];

  let url = text;
  if (!/^https?:\/\//i.test(url)) {
    url = url.startsWith("@") ? `https://www.youtube.com/${url}` : `https://www.youtube.com/@${url}`;
  }
  let html;
  try {
    html = await holen(url);
  } catch (e) {
    throw new Error(`Die Kanalseite ist nicht erreichbar: ${String(e.message || e)}`);
  }
  const m =
    /"channelId":"(UC[\w-]{20,})"/.exec(html) ||
    /<link[^>]+rel="canonical"[^>]+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{20,})"/i.exec(html) ||
    /channel\/(UC[\w-]{20,})/.exec(html);
  if (!m) throw new Error("Auf dieser Seite steht keine Kanal-ID. Bitte den Link zur Kanal-Startseite verwenden.");
  return m[1];
}

/** Aus einer Blog-Adresse den Feed heraussuchen (falls kein Feed angegeben). */
export async function blogFeedErmitteln(eingabe) {
  const url = String(eingabe || "").trim();
  if (!url) throw new Error("Bitte eine Adresse angeben");
  const voll = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  let text;
  try {
    text = await holen(voll);
  } catch (e) {
    throw new Error(`Nicht erreichbar: ${String(e.message || e)}`);
  }
  // Schon selbst ein Feed?
  if (/<rss[\s>]|<feed[\s>]/i.test(text.slice(0, 2000))) return voll;

  const m =
    /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i.exec(text) ||
    /<link[^>]+href=["']([^"']+)["'][^>]*type=["']application\/(?:rss|atom)\+xml["']/i.exec(text);
  if (!m) throw new Error("Auf dieser Seite ist kein RSS-/Atom-Feed verlinkt. Bitte die Feed-Adresse direkt angeben.");
  return new URL(entschluesseln(m[1]), voll).toString();
}

/* ── Feeds verwalten ────────────────────────────────────────────────────── */

const neueId = () => `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/**
 * Kanal oder Blog abonnieren.
 * `art` ist "youtube" oder "blog".
 */
export async function abonnieren(eingabe, art = "youtube") {
  const feeds = feedsLaden();
  let feed;

  if (art === "youtube") {
    const kanalId = await kanalIdErmitteln(eingabe);
    if (feeds.some((f) => f.kanalId === kanalId)) throw new Error("Dieser Kanal ist schon abonniert");
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${kanalId}`;
    let titel = kanalId;
    try {
      titel = tagInhalt(await holen(feedUrl), "title") || kanalId;
    } catch {
      /* Titel ist nur Kosmetik — beim ersten Abruf kommt er nach */
    }
    feed = {
      id: neueId(),
      art: "youtube",
      titel,
      kanalId,
      feedUrl,
      seite: `https://www.youtube.com/channel/${kanalId}`,
      benachrichtigen: true,
      hinzugefuegt: jetzt(),
      zuletzt: 0,
      fehler: null,
    };
  } else {
    const feedUrl = await blogFeedErmitteln(eingabe);
    if (feeds.some((f) => f.feedUrl === feedUrl)) throw new Error("Dieser Feed ist schon abonniert");
    let titel = feedUrl;
    try {
      titel = tagInhalt(await holen(feedUrl), "title") || feedUrl;
    } catch {
      /* siehe oben */
    }
    feed = {
      id: neueId(),
      art: "blog",
      titel,
      kanalId: null,
      feedUrl,
      seite: feedUrl,
      benachrichtigen: true,
      hinzugefuegt: jetzt(),
      zuletzt: 0,
      fehler: null,
    };
  }

  feeds.push(feed);
  feedsSpeichern(feeds);
  // Direkt einmal abholen, damit die Liste nicht leer bleibt.
  await abholen(feed.id).catch(() => {});
  return feedsLaden().find((f) => f.id === feed.id) ?? feed;
}

export function abbestellen(id) {
  const feeds = feedsLaden().filter((f) => f.id !== id);
  feedsSpeichern(feeds);
  beitraegeSpeichern(beitraegeLaden().filter((b) => b.feedId !== id));
  return true;
}

/** Einstellungen eines Abos ändern (derzeit nur `benachrichtigen`). */
export function feedAendern(id, teil = {}) {
  const feeds = feedsLaden();
  const f = feeds.find((x) => x.id === id);
  if (!f) throw new Error("Dieses Abo gibt es nicht");
  if (teil.benachrichtigen != null) f.benachrichtigen = !!teil.benachrichtigen;
  if (teil.titel) f.titel = String(teil.titel);
  feedsSpeichern(feeds);
  return f;
}

/* ── Abholen ────────────────────────────────────────────────────────────── */

function beitragAus(block, feed) {
  const istYoutube = feed.art === "youtube";
  const videoId = istYoutube ? tagInhalt(block, "yt:videoId") : null;
  const link =
    tagInhalt(block, "link") ||
    tagAttribut(block, "link", "href") ||
    (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);
  const titel = tagInhalt(block, "title") || "(ohne Titel)";
  const datum =
    tagInhalt(block, "published") || tagInhalt(block, "pubDate") || tagInhalt(block, "updated") || null;
  const beschreibung =
    tagInhalt(block, "media:description") || tagInhalt(block, "description") || tagInhalt(block, "summary") || null;
  const bild = videoId
    ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
    : tagAttribut(block, "media:thumbnail", "url") || tagAttribut(block, "enclosure", "url") || null;

  // Eindeutige Kennung: bei YouTube die Video-ID, sonst <guid>/<id>/Link.
  const kennung = videoId || tagInhalt(block, "guid") || tagInhalt(block, "id") || link || titel;
  if (!kennung) return null;

  const zeit = datum ? Date.parse(datum) : NaN;
  return {
    id: `${feed.id}:${kennung}`,
    feedId: feed.id,
    art: feed.art,
    videoId: videoId || null,
    titel,
    url: link,
    bild,
    beschreibung: beschreibung ? beschreibung.slice(0, 400) : null,
    veroeffentlicht: Number.isNaN(zeit) ? jetzt() : zeit,
    gelesen: false,
    entdeckt: jetzt(),
  };
}

/**
 * Einen Feed (oder alle) abholen. Gibt die NEUEN Beiträge zurück — daraus
 * baut index.js die Benachrichtigung.
 */
export async function abholen(nurId = null) {
  const feeds = feedsLaden();
  const ziele = nurId ? feeds.filter((f) => f.id === nurId) : feeds;
  if (ziele.length === 0) return [];

  const vorhanden = beitraegeLaden();
  const bekannt = new Set(vorhanden.map((b) => b.id));
  const neue = [];

  for (const feed of ziele) {
    try {
      const xml = await holen(feed.feedUrl);
      const feedTitel = tagInhalt(xml, "title");
      if (feedTitel) feed.titel = feedTitel;
      let genommen = 0;
      for (const block of eintraege(xml)) {
        if (genommen >= MAX_PRO_FEED) break;
        genommen++;
        const b = beitragAus(block, feed);
        if (!b || bekannt.has(b.id)) continue;
        bekannt.add(b.id);
        /* Beim ERSTEN Abruf eines neuen Abos gilt nichts als „neu": sonst
           würde ein frisch abonnierter Kanal sofort 15 Benachrichtigungen
           auslösen. Die Beiträge landen trotzdem in der Liste — nur eben
           schon als gelesen. */
        if (feed.zuletzt === 0) b.gelesen = true;
        else neue.push(b);
        vorhanden.push(b);
      }
      feed.zuletzt = jetzt();
      feed.fehler = null;
    } catch (e) {
      feed.fehler = String(e.message || e).slice(0, 200);
      console.warn(`[feeds] "${feed.titel}" nicht abrufbar: ${feed.fehler}`);
    }
  }

  vorhanden.sort((a, b) => b.veroeffentlicht - a.veroeffentlicht);
  beitraegeSpeichern(vorhanden);
  feedsSpeichern(feeds);
  return neue;
}

/* ── Lesen ──────────────────────────────────────────────────────────────── */

export function beitraege({ art = null, limit = 60, nurUngelesen = false } = {}) {
  const feeds = new Map(feedsLaden().map((f) => [f.id, f]));
  return beitraegeLaden()
    .filter((b) => (art ? b.art === art : true))
    .filter((b) => (nurUngelesen ? !b.gelesen : true))
    .slice(0, Math.max(1, Math.min(300, limit)))
    .map((b) => ({ ...b, feedTitel: feeds.get(b.feedId)?.titel ?? "Unbekannt" }));
}

export function ungelesenZahl(art = null) {
  return beitraegeLaden().filter((b) => !b.gelesen && (art ? b.art === art : true)).length;
}

/** Beiträge als gelesen markieren. Ohne `ids` alle. */
export function alsGelesen(ids = null) {
  const alle = beitraegeLaden();
  const menge = ids ? new Set(ids) : null;
  let n = 0;
  for (const b of alle) {
    if (b.gelesen) continue;
    if (menge && !menge.has(b.id)) continue;
    b.gelesen = true;
    n++;
  }
  beitraegeSpeichern(alle);
  return n;
}
