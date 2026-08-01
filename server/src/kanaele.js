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
/* Mehr Abos brauchen mehr Platz — mit Gruppen kommen schnell 10+ Kanäle
   zusammen. 600 Beiträge sind als JSON immer noch nur wenige hundert KB. */
const MAX_ITEMS = 600;

/** So viele Beiträge werden pro Feed und Abruf übernommen. */
const MAX_PRO_FEED = 15;

const HOLEN_TIMEOUT_MS = 15_000;

/* Ein Short darf höchstens 3 Minuten lang sein (YouTube hat 2024 von 60 s
   erhöht). Nur zusammen mit Hochformat aussagekräftig. */
const MAX_SHORT_SEK = 185;

/**
 * Kopfzeilen für YouTube-Anfragen.
 *
 * DAS ZUSTIMMUNGS-COOKIE IST DER SPRINGENDE PUNKT (gemessen am 01.08.2026):
 * Ohne es antwortet YouTube aus der EU auf JEDE Anfrage mit
 * `302 → consent.youtube.com`. Die alte Shorts-Erkennung las das als
 * „Umleitung, also kein Short" — und markierte damit ausnahmslos jedes Video
 * als normales Video. Der Filter hat deshalb nie funktioniert.
 *
 * Mit `SOCS`/`CONSENT` liefert YouTube die echte Antwort:
 *   /shorts/<id>  →  200  = wirklich ein Short
 *                 →  303  = normales Video (leitet auf /watch um)
 * An 10 echten Videos geprüft, 10 von 10 richtig.
 */
const YT_KOPF = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept-Language": "de,en;q=0.8",
  Cookie: "SOCS=CAISEwgDEgk0ODE3Nzk3MjQaAmRlIAEaBgiA_LyaBg; CONSENT=YES+cb",
};

/** fetch mit hartem Zeitlimit — ein hängender Server darf nichts blockieren. */
async function mitZeitlimit(fn, ms = 10_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

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
    // Ein echter Browser-Agent ist Pflicht: „GHGFlix/1.0" wird von etlichen
    // Seiten (und von YouTubes Zustimmungswand) anders behandelt als ein
    // Browser. Das Zustimmungs-Cookie schadet fremden Seiten nicht.
    headers: { ...YT_KOPF, Accept: "application/rss+xml, application/atom+xml, application/xml, text/html;q=0.8, */*;q=0.5" },
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
/* Übliche Adressen, unter denen Blogsysteme ihren Feed anbieten. Reihenfolge
   nach Häufigkeit: WordPress zuerst, dann die allgemeinen, dann Blogger.
   Gemessen am 01.08.2026: „tumblr.com" hat keinen Feed im HTML, aber ein
   echter Tumblr-Blog liefert unter /rss einen — ohne dieses Abklopfen war
   „Blog hinzufügen" für solche Seiten schlicht unmöglich. */
const FEED_PFADE = [
  "/feed", "/feed/", "/rss", "/rss/", "/rss.xml", "/feed.xml", "/atom.xml",
  "/index.xml", "/?feed=rss2", "/feeds/posts/default", "/blog/feed", "/news/feed",
];

const SIEHT_NACH_FEED_AUS = (t) => /<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(String(t).slice(0, 3000));

/**
 * Aus einer Blog-Adresse den Feed heraussuchen.
 *
 * Drei Stufen, weil jede für sich in echten Fällen scheitert:
 *   1. Ist die Adresse selbst schon ein Feed? (dann fertig)
 *   2. Steht im HTML ein <link rel="alternate" type="application/rss+xml">?
 *   3. Sonst die üblichen Pfade abklopfen (/feed, /rss, …).
 *
 * Dazu ein HTTP-Rückfall: `serienblitz.de` verweigert die HTTPS-Verbindung
 * rundweg (ECONNREFUSED auf Port 443), antwortet über http aber sauber.
 * Ohne diesen Rückfall bekam der Nutzer nur „error sending request for url".
 */
export async function blogFeedErmitteln(eingabe) {
  const roh = String(eingabe || "").trim();
  if (!roh) throw new Error("Bitte eine Adresse angeben");

  /* Welche Adressen probieren wir?
     Gemessen am 01.08.2026: Der Nutzer gab "https://serienblitz.de/feed"
     (mit Schema) direkt ein. Vorher wurde bei vorhandenem Schema NUR diese
     eine Adresse versucht — https scheiterte mit ECONNREFUSED, und es gab
     KEINEN http-Rückfall, obwohl genau der bei schemalosen Eingaben schon
     lief. Jetzt: bei "https://" zusätzlich dieselbe Adresse über http. */
  const versuche = [];
  if (/^https:\/\//i.test(roh)) {
    versuche.push(roh, roh.replace(/^https:\/\//i, "http://"));
  } else if (/^http:\/\//i.test(roh)) {
    versuche.push(roh);
  } else {
    versuche.push(`https://${roh}`, `http://${roh}`);
  }

  let text = null;
  let basis = null;
  const fehler = [];
  for (const u of versuche) {
    try {
      text = await holen(u);
      basis = u;
      break;
    } catch (e) {
      fehler.push(`${u}: ${String(e.message || e).slice(0, 80)}`);
    }
  }
  if (text == null) {
    throw new Error(
      `Die Seite ist nicht erreichbar.\n${fehler.join("\n")}\n` +
        `Tipp: Läuft die Seite nur über http://? Dann bitte mit „http://" davor eintragen.`,
    );
  }

  // 1) Schon selbst ein Feed?
  if (SIEHT_NACH_FEED_AUS(text)) return basis;

  // 2) Im HTML verlinkt?
  const m =
    /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i.exec(text) ||
    /<link[^>]+href=["']([^"']+)["'][^>]*type=["']application\/(?:rss|atom)\+xml["']/i.exec(text);
  if (m) return new URL(entschluesseln(m[1]), basis).toString();

  // 3) Übliche Pfade abklopfen.
  const wurzel = new URL(basis);
  for (const p of FEED_PFADE) {
    const kandidat = new URL(p, `${wurzel.protocol}//${wurzel.host}`).toString();
    try {
      const t = await holen(kandidat);
      if (SIEHT_NACH_FEED_AUS(t)) return kandidat;
    } catch {
      /* der nächste Pfad ist dran */
    }
  }

  throw new Error(
    `Auf „${basis}" ist kein RSS-/Atom-Feed zu finden — weder im Seitenkopf noch unter den üblichen ` +
      `Adressen (${FEED_PFADE.slice(0, 6).join(", ")} …).\n` +
      `Zwei häufige Gründe:\n` +
      `• Es ist die Startseite einer Plattform statt eines einzelnen Blogs. ` +
      `Bei Tumblr z. B. „meinblog.tumblr.com" statt „tumblr.com".\n` +
      `• Die Seite bietet gar keinen Feed an. Dann hilft nur die Feed-Adresse direkt, ` +
      `falls es eine gibt.`,
  );
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

/** Einstellungen eines Abos ändern. */
export function feedAendern(id, teil = {}) {
  const feeds = feedsLaden();
  const f = feeds.find((x) => x.id === id);
  if (!f) throw new Error("Dieses Abo gibt es nicht");
  if (teil.benachrichtigen != null) f.benachrichtigen = !!teil.benachrichtigen;
  if (teil.titel) f.titel = String(teil.titel);
  // gruppeId === null heißt ausdrücklich „aus der Gruppe nehmen".
  if (teil.gruppeId !== undefined) f.gruppeId = teil.gruppeId ? String(teil.gruppeId) : null;
  feedsSpeichern(feeds);
  return f;
}

/* ══ Gruppen ══════════════════════════════════════════════════════════════
   Eine Gruppe ist ein Thema: ein Film, eine Filmreihe oder eine Serie. Darin
   liegen die Abos und Blogs, die dazu gehören — z. B. „Miraculous" mit dem
   offiziellen Kanal, zwei Fan-Kanälen und einem Leak-Blog.

   Warum am ABO und nicht am einzelnen Beitrag: ein Kanal bleibt beim Thema.
   Einmal einsortiert, landet alles Neue von selbst richtig — sonst müsste
   man jedes Video von Hand zuordnen. */

const GRUPPEN_KEY = "feed_gruppen";

export const gruppenLaden = () => {
  const g = lesen(GRUPPEN_KEY, []);
  return Array.isArray(g) ? g : [];
};
const gruppenSpeichern = (v) => setSetting(GRUPPEN_KEY, JSON.stringify(v));

const neueGruppenId = () => `g${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function gruppeAnlegen({ name, emoji = "📺", farbe = null } = {}) {
  const n = String(name || "").trim();
  if (!n) throw new Error("Die Gruppe braucht einen Namen");
  const alle = gruppenLaden();
  if (alle.some((g) => g.name.toLowerCase() === n.toLowerCase())) {
    throw new Error("Eine Gruppe mit diesem Namen gibt es schon");
  }
  const g = {
    id: neueGruppenId(),
    name: n,
    emoji: String(emoji || "📺").slice(0, 4),
    farbe: farbe ? String(farbe) : null,
    /* Beim Öffnen der Seite direkt aufklappen statt nur als Kachel zu warten.
       Höchstens EINE Gruppe darf das haben — sonst wäre nicht entschieden,
       welche gewinnt. */
    standardOffen: false,
    sortierung: alle.length,
    angelegt: jetzt(),
  };
  alle.push(g);
  gruppenSpeichern(alle);
  return g;
}

export function gruppeAendern(id, teil = {}) {
  const alle = gruppenLaden();
  const g = alle.find((x) => x.id === id);
  if (!g) throw new Error("Diese Gruppe gibt es nicht");
  if (teil.name != null && String(teil.name).trim()) g.name = String(teil.name).trim();
  if (teil.emoji != null) g.emoji = String(teil.emoji).slice(0, 4) || "📺";
  if (teil.farbe !== undefined) g.farbe = teil.farbe ? String(teil.farbe) : null;
  if (teil.sortierung != null) g.sortierung = Number(teil.sortierung) || 0;
  if (teil.standardOffen != null) {
    const an = !!teil.standardOffen;
    // Nur eine Gruppe darf beim Öffnen aufgehen.
    if (an) for (const x of alle) x.standardOffen = false;
    g.standardOffen = an;
  }
  gruppenSpeichern(alle);
  return g;
}

/** Gruppe löschen. Die Abos darin bleiben — sie werden nur gruppenlos. */
export function gruppeLoeschen(id) {
  gruppenSpeichern(gruppenLaden().filter((g) => g.id !== id));
  const feeds = feedsLaden();
  let n = 0;
  for (const f of feeds) {
    if (f.gruppeId === id) {
      f.gruppeId = null;
      n++;
    }
  }
  if (n) feedsSpeichern(feeds);
  return { geloescht: true, abosFreigegeben: n };
}

/** Gruppen mit Zählern, so wie die Kachelansicht sie braucht. */
export function gruppenUebersicht() {
  const feeds = feedsLaden();
  const items = beitraegeLaden();
  const bau = (g) => {
    const abos = feeds.filter((f) => (g ? f.gruppeId === g.id : !f.gruppeId));
    const ids = new Set(abos.map((f) => f.id));
    const meine = items.filter((b) => ids.has(b.feedId));
    return {
      id: g?.id ?? null,
      name: g?.name ?? "Ohne Gruppe",
      emoji: g?.emoji ?? "📁",
      farbe: g?.farbe ?? null,
      standardOffen: g?.standardOffen ?? false,
      sortierung: g?.sortierung ?? 9999,
      abos: abos.length,
      kanaele: abos.filter((f) => f.art === "youtube").length,
      blogs: abos.filter((f) => f.art === "blog").length,
      beitraege: meine.length,
      ungelesen: meine.filter((b) => !b.gelesen).length,
      // Ein paar Vorschaubilder für die Kachel.
      bilder: meine.filter((b) => b.bild).slice(0, 4).map((b) => b.bild),
    };
  };
  const liste = gruppenLaden().sort((a, b) => a.sortierung - b.sortierung).map(bau);
  const ohne = bau(null);
  // „Ohne Gruppe" nur zeigen, wenn dort wirklich etwas liegt.
  if (ohne.abos > 0) liste.push(ohne);
  return liste;
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
    /* null = noch nicht geprüft. Der Feed verrät es nicht, das klärt
       istShortPruefen() beim Abholen. */
    istShort: null,
    gemerkt: false,
    gesehen: false,
    entdeckt: jetzt(),
  };
}

/**
 * Ist dieses YouTube-Video ein Short?
 *
 * Der Atom-Feed sagt es NICHT — dort steht kein Wort über Länge oder Format.
 * Es gibt aber einen verlässlichen Weg ohne API-Schlüssel: die Adresse
 * `youtube.com/shorts/<id>` beantwortet YouTube unterschiedlich.
 *   - echtes Short  → 200, die Seite existiert
 *   - normales Video → Umleitung auf /watch?v=…
 * Deshalb wird die Umleitung bewusst NICHT gefolgt und nur der Statuscode
 * angesehen. Das kostet einen kleinen Abruf pro NEUEM Video, und das Ergebnis
 * wird dauerhaft gemerkt — bestehende Beiträge werden nie erneut geprüft.
 *
 * Bei Zeitüberschreitung oder Fehler: null zurückgeben (unbekannt) statt zu
 * raten. Ein falsch einsortiertes Video wäre ärgerlicher als eins ohne Marke.
 */
export async function istShortPruefen(videoId) {
  if (!videoId) return { istShort: null, dauerSek: null };

  // ── Weg 1: die Adresse selbst fragen (billig, ein HEAD ohne Inhalt) ──
  try {
    const r = await mitZeitlimit((signal) =>
      fetch(`https://www.youtube.com/shorts/${videoId}`, {
        method: "HEAD",
        redirect: "manual",
        signal,
        headers: YT_KOPF,
      }),
    );
    if (r.status === 200) return { istShort: true, dauerSek: null };
    if (r.status >= 300 && r.status < 400) return { istShort: false, dauerSek: null };
  } catch {
    /* weiter mit Weg 2 */
  }

  // ── Weg 2: die Videoseite lesen (Bildformat und Länge) ──
  // Kostet mehr, liefert dafür auch die Laufzeit für die Anzeige.
  try {
    const t = await mitZeitlimit((signal) =>
      fetch(`https://www.youtube.com/watch?v=${videoId}`, { signal, headers: YT_KOPF }).then((r) =>
        r.ok ? r.text() : "",
      ),
    );
    if (!t) return { istShort: null, dauerSek: null };
    const dauer = /"lengthSeconds":"(\d+)"/.exec(t)?.[1];
    const masse = /"width":(\d+),"height":(\d+)/.exec(t);
    const dauerSek = dauer ? Number(dauer) : null;
    if (!masse) return { istShort: null, dauerSek };
    const hochkant = Number(masse[2]) > Number(masse[1]);
    // Beides muss stimmen: hochkant UND kurz. Ein hochkant gedrehtes langes
    // Video ist kein Short, ein kurzes Querformat auch nicht.
    const istShort = hochkant && dauerSek != null && dauerSek <= MAX_SHORT_SEK;
    return { istShort, dauerSek };
  } catch {
    return { istShort: null, dauerSek: null };
  }
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

  /* Shorts-Marke nachtragen — nur für Beiträge, die sie noch nicht haben.
     Bewusst NACH dem Einsammeln und mit Obergrenze: bei einem frisch
     abonnierten Kanal wären es sonst 15 zusätzliche Abrufe auf einmal, und
     der Nutzer wartet vor einer leeren Seite. Was übrig bleibt, holt der
     nächste Durchlauf in 30 Minuten. */
  const offen = vorhanden.filter((b) => b.art === "youtube" && b.videoId && b.istShort == null).slice(0, 25);
  for (const b of offen) {
    const { istShort, dauerSek } = await istShortPruefen(b.videoId);
    b.istShort = istShort;
    if (dauerSek != null) b.dauerSek = dauerSek;
  }

  vorhanden.sort((a, b) => b.veroeffentlicht - a.veroeffentlicht);
  beitraegeSpeichern(vorhanden);
  feedsSpeichern(feeds);
  return neue;
}

/* ── Lesen ──────────────────────────────────────────────────────────────── */

/**
 * Beiträge lesen — mit allen Filtern der Oberfläche.
 *
 * `format`: "shorts" nur Kurzvideos, "videos" alles außer Kurzvideos.
 *   Beiträge ohne geprüfte Marke (istShort === null) gelten als normales
 *   Video: lieber einmal zu viel zeigen als etwas verschwinden lassen.
 */
export function beitraege({
  art = null,
  gruppeId = undefined,
  feedId = null,
  limit = 60,
  nurUngelesen = false,
  nurGemerkt = false,
  ohneGesehene = false,
  format = null,
  suche = null,
  sortierung = "neu",
} = {}) {
  const feedListe = feedsLaden();
  const feeds = new Map(feedListe.map((f) => [f.id, f]));

  // gruppeId: undefined = egal, null = nur gruppenlose, sonst genau diese
  let erlaubt = null;
  if (gruppeId !== undefined) {
    erlaubt = new Set(feedListe.filter((f) => (gruppeId === null ? !f.gruppeId : f.gruppeId === gruppeId)).map((f) => f.id));
  }

  const q = suche ? String(suche).toLowerCase().trim() : null;
  let liste = beitraegeLaden()
    .filter((b) => (art ? b.art === art : true))
    .filter((b) => (feedId ? b.feedId === feedId : true))
    .filter((b) => (erlaubt ? erlaubt.has(b.feedId) : true))
    .filter((b) => (nurUngelesen ? !b.gelesen : true))
    .filter((b) => (nurGemerkt ? !!b.gemerkt : true))
    .filter((b) => (ohneGesehene ? !b.gesehen : true))
    .filter((b) => {
      if (!format) return true;
      if (format === "shorts") return b.istShort === true;
      return b.istShort !== true; // "videos": auch ungeprüfte zeigen
    })
    .filter((b) => {
      if (!q) return true;
      const wo = `${b.titel} ${b.beschreibung ?? ""} ${feeds.get(b.feedId)?.titel ?? ""}`.toLowerCase();
      return wo.includes(q);
    });

  if (sortierung === "alt") liste.sort((a, b) => a.veroeffentlicht - b.veroeffentlicht);
  else if (sortierung === "kanal") {
    liste.sort(
      (a, b) =>
        (feeds.get(a.feedId)?.titel ?? "").localeCompare(feeds.get(b.feedId)?.titel ?? "", "de") ||
        b.veroeffentlicht - a.veroeffentlicht,
    );
  } else liste.sort((a, b) => b.veroeffentlicht - a.veroeffentlicht);

  return liste.slice(0, Math.max(1, Math.min(400, limit))).map((b) => {
    const f = feeds.get(b.feedId);
    return { ...b, feedTitel: f?.titel ?? "Unbekannt", feedArt: f?.art ?? b.art, gruppeId: f?.gruppeId ?? null };
  });
}

/** Merkliste („Später ansehen") umschalten. */
export function merken(id, an = true) {
  const alle = beitraegeLaden();
  const b = alle.find((x) => x.id === id);
  if (!b) throw new Error("Diesen Beitrag gibt es nicht");
  b.gemerkt = !!an;
  beitraegeSpeichern(alle);
  return b.gemerkt;
}

/** Gesehen-Markierung umschalten. Gesehenes gilt zugleich als gelesen. */
export function gesehenSetzen(id, an = true) {
  const alle = beitraegeLaden();
  const b = alle.find((x) => x.id === id);
  if (!b) throw new Error("Diesen Beitrag gibt es nicht");
  b.gesehen = !!an;
  if (an) b.gelesen = true;
  beitraegeSpeichern(alle);
  return b.gesehen;
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
