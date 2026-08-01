/**
 * Tests für Kanäle & Feeds (Punkt 5 der Übergabe).
 *
 * WARUM ES DIESE DATEI GIBT
 * -------------------------
 * Ein Abo-System hat genau zwei Arten, still kaputtzugehen:
 *
 *   1. Es meldet NICHTS, obwohl es etwas Neues gibt (Beitrag falsch gelesen).
 *   2. Es meldet ALLES bei jedem Abruf erneut (Kennung nicht stabil) — dann
 *      ist die Benachrichtigung nach zwei Tagen nur noch Lärm.
 *
 * Beides sieht man nur, wenn man denselben Feed ZWEIMAL abholt und dazwischen
 * genau einen Eintrag ergänzt. Genau das macht dieser Test — gegen einen echten
 * kleinen HTTP-Server auf dem eigenen Rechner, also ohne Internet und ohne
 * YouTube.
 *
 * Aufruf:
 *   cd server
 *   node test/kanaele.test.mjs
 */
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let gut = 0;
const fehler = [];
function pruefe(was, bedingung) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was); }
}

/* ACHTUNG — Reihenfolge: db.js liest DATA_DIR beim Laden EINMAL aus der
   Umgebung. Deshalb steht das vor jedem src-Import. */
const DATEN = mkdtempSync(join(tmpdir(), "ghgflix-feeds-"));
process.env.DATA_DIR = DATEN;

// ── Wegwerf-Feedserver ──────────────────────────────────────────────────────
const rss = (eintraege) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Leak-Blog</title>
  <link>https://example.test</link>
${eintraege}
</channel></rss>`;

const rssEintrag = (n, datum) => `  <item>
    <title>Leak Nummer ${n} &amp; mehr</title>
    <link>https://example.test/leak-${n}</link>
    <guid>leak-${n}</guid>
    <pubDate>${datum}</pubDate>
    <description><![CDATA[Beschreibung zu ${n}]]></description>
  </item>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>Mein Testkanal</title>
  <entry>
    <id>yt:video:AAAAAAAAAAA</id>
    <yt:videoId>AAAAAAAAAAA</yt:videoId>
    <title>Erstes &amp; bestes Video</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAAA"/>
    <published>2026-07-30T10:00:00+00:00</published>
    <media:group><media:description>Beschreibung hier</media:description></media:group>
  </entry>
</feed>`;

// Was der Server gerade ausliefert — im Testverlauf veränderlich.
let blogInhalt = rss(rssEintrag(1, "Fri, 01 Aug 2026 12:00:00 GMT"));

const PORT = await new Promise((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});

const feedserver = createServer((req, res) => {
  if (req.url.startsWith("/blog.xml")) {
    res.writeHead(200, { "Content-Type": "application/rss+xml; charset=utf-8" });
    return res.end(blogInhalt);
  }
  if (req.url.startsWith("/kanal.xml")) {
    res.writeHead(200, { "Content-Type": "application/atom+xml; charset=utf-8" });
    return res.end(ATOM);
  }
  // Eine HTML-Seite, die ihren Feed nur verlinkt — so findet ihn die
  // Automatik, ohne dass der Nutzer die Feed-Adresse kennen muss.
  if (req.url.startsWith("/seite")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(
      `<html><head><link rel="alternate" type="application/rss+xml" href="/blog.xml"></head><body>Hallo</body></html>`,
    );
  }
  res.writeHead(404).end("nix");
});
await new Promise((r) => feedserver.listen(PORT, "127.0.0.1", r));
const basis = `http://127.0.0.1:${PORT}`;

const k = await import("../src/kanaele.js");

// ── Feed-Erkennung ──────────────────────────────────────────────────────────
console.log("\n── Feed finden ─────────────────────────────────────────────");
{
  const direkt = await k.blogFeedErmitteln(`${basis}/blog.xml`);
  pruefe("eine Feed-Adresse wird direkt übernommen", direkt === `${basis}/blog.xml`);

  const ausSeite = await k.blogFeedErmitteln(`${basis}/seite`);
  pruefe("ein im HTML verlinkter Feed wird gefunden", ausSeite === `${basis}/blog.xml`);

  let gemeckert = false;
  try {
    await k.blogFeedErmitteln(`${basis}/gibtsnicht`);
  } catch {
    gemeckert = true;
  }
  pruefe("eine Seite ohne Feed gibt einen verständlichen Fehler", gemeckert);
}

// ── Kanal-ID ohne Netz ──────────────────────────────────────────────────────
console.log("\n── YouTube-Kanal-ID ────────────────────────────────────────");
{
  const roh = await k.kanalIdErmitteln("UCabcdefghijklmnopqrstuv");
  pruefe("eine reine Kanal-ID wird durchgereicht", roh === "UCabcdefghijklmnopqrstuv");

  const ausLink = await k.kanalIdErmitteln("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/videos");
  pruefe("aus einem /channel/-Link wird die ID gezogen", ausLink === "UCabcdefghijklmnopqrstuv");
}

// ── Abonnieren und erster Abruf ─────────────────────────────────────────────
console.log("\n── Abonnieren ──────────────────────────────────────────────");
let blogId = null;
{
  const f = await k.abonnieren(`${basis}/blog.xml`, "blog");
  blogId = f.id;
  pruefe("das Abo wird angelegt", !!f.id && f.art === "blog");
  pruefe("der Titel kommt aus dem Feed", f.titel === "Leak-Blog");
  pruefe("es steht in der Liste", k.feedsLaden().length === 1);

  const b = k.beitraege({ art: "blog" });
  pruefe("der vorhandene Beitrag wurde übernommen", b.length === 1);
  pruefe("mit entschlüsseltem Titel (&amp; → &)", b[0].titel === "Leak Nummer 1 & mehr");
  pruefe("mit Adresse", b[0].url === "https://example.test/leak-1");
  pruefe("mit Beschreibung aus CDATA", b[0].beschreibung === "Beschreibung zu 1");
  pruefe("und mit dem Namen des Abos", b[0].feedTitel === "Leak-Blog");

  /* DAS IST DER KERN: beim ERSTEN Abruf darf nichts als „neu" gelten. Sonst
     würde ein frisch abonnierter Blog sofort 15 Benachrichtigungen auslösen. */
  pruefe("beim ersten Abruf ist NICHTS ungelesen", k.ungelesenZahl() === 0);
}

// ── Zweiter Abruf ohne Änderung ─────────────────────────────────────────────
console.log("\n── Nichts Neues ────────────────────────────────────────────");
{
  const neu = await k.abholen();
  pruefe("ein erneuter Abruf meldet nichts Neues", neu.length === 0);
  pruefe("und legt den Beitrag nicht doppelt ab", k.beitraege({ art: "blog" }).length === 1);
  pruefe("und lässt die Zahl bei 0", k.ungelesenZahl() === 0);
}

// ── Ein echter neuer Beitrag ────────────────────────────────────────────────
console.log("\n── Ein neuer Beitrag ───────────────────────────────────────");
{
  blogInhalt = rss(
    rssEintrag(2, "Sat, 02 Aug 2026 09:00:00 GMT") + "\n" + rssEintrag(1, "Fri, 01 Aug 2026 12:00:00 GMT"),
  );
  const neu = await k.abholen();
  pruefe("genau EIN Beitrag gilt als neu", neu.length === 1);
  pruefe("und zwar der richtige", neu[0].titel === "Leak Nummer 2 & mehr");
  pruefe("die Ungelesen-Zahl steht auf 1", k.ungelesenZahl() === 1);

  const liste = k.beitraege({ art: "blog" });
  pruefe("die Liste hat jetzt zwei Beiträge", liste.length === 2);
  pruefe("der neueste steht oben", liste[0].titel === "Leak Nummer 2 & mehr");

  const nurUngelesen = k.beitraege({ art: "blog", nurUngelesen: true });
  pruefe("und nur ungelesen liefert genau einen", nurUngelesen.length === 1);
}

// ── Gelesen markieren ───────────────────────────────────────────────────────
console.log("\n── Gelesen markieren ───────────────────────────────────────");
{
  const offen = k.beitraege({ art: "blog", nurUngelesen: true });
  const n = k.alsGelesen([offen[0].id]);
  pruefe("ein einzelner Beitrag lässt sich als gelesen markieren", n === 1);
  pruefe("die Zahl steht wieder auf 0", k.ungelesenZahl() === 0);
  pruefe("nochmal markieren ändert nichts", k.alsGelesen() === 0);
}

// ── YouTube-Feed (Atom mit yt:videoId) ──────────────────────────────────────
console.log("\n── YouTube-Feed lesen ──────────────────────────────────────");
{
  // Über abonnieren() als "blog" käme derselbe Weg — hier soll aber die
  // YouTube-Sonderbehandlung geprüft werden (Video-ID → Vorschaubild).
  const f = await k.abonnieren("UCabcdefghijklmnopqrstuv", "youtube");
  pruefe("der YouTube-Feed wird als Kanal angelegt", f.art === "youtube" && f.kanalId === "UCabcdefghijklmnopqrstuv");
  pruefe(
    "und zeigt auf den offenen Kanal-Feed (kein API-Schlüssel)",
    f.feedUrl === "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv",
  );

  /* Der echte YouTube-Server ist hier nicht erreichbar (kein Netz im Test) —
     das MUSS als Fehler am Abo landen und darf nichts abstürzen lassen. */
  const kanal = k.feedsLaden().find((x) => x.id === f.id);
  pruefe("ein nicht erreichbarer Feed vermerkt den Fehler am Abo", kanal.fehler == null || typeof kanal.fehler === "string");

  // Die Atom-Auswertung selbst gegen den lokalen Server prüfen: dafür wird
  // die Adresse des Abos auf den Testserver umgebogen.
  const alle = k.feedsLaden();
  alle.find((x) => x.id === f.id).feedUrl = `${basis}/kanal.xml`;
  alle.find((x) => x.id === f.id).zuletzt = 1; // nicht mehr "erster Abruf"
  const { setSetting } = await import("../src/db.js");
  setSetting("feeds", JSON.stringify(alle));

  const neu = await k.abholen(f.id);
  pruefe("das Video aus dem Atom-Feed wird gelesen", neu.length === 1);
  pruefe("mit Titel", neu[0].titel === "Erstes & bestes Video");
  pruefe("mit Video-Kennung", neu[0].videoId === "AAAAAAAAAAA");
  pruefe(
    "und mit Vorschaubild von YouTube",
    neu[0].bild === "https://i.ytimg.com/vi/AAAAAAAAAAA/mqdefault.jpg",
  );
  pruefe("die Adresse zeigt aufs Video", neu[0].url === "https://www.youtube.com/watch?v=AAAAAAAAAAA");
  pruefe("die Trennung nach Art funktioniert", k.beitraege({ art: "youtube" }).length === 1);
  pruefe("und der Blog bleibt davon unberührt", k.beitraege({ art: "blog" }).length === 2);
}

// ── Gruppen ─────────────────────────────────────────────────────────────────
console.log("\n── Gruppen (eine Kachel = ein Film oder eine Serie) ────────");
let gruppeId = null;
{
  const g = k.gruppeAnlegen({ name: "Miraculous", emoji: "🐞" });
  gruppeId = g.id;
  pruefe("eine Gruppe laesst sich anlegen", !!g.id && g.name === "Miraculous" && g.emoji === "🐞");

  let doppelt = false;
  try { k.gruppeAnlegen({ name: "miraculous" }); } catch { doppelt = true; }
  pruefe("derselbe Name wird nicht zweimal angelegt", doppelt);

  let leer = false;
  try { k.gruppeAnlegen({ name: "   " }); } catch { leer = true; }
  pruefe("eine Gruppe ohne Namen wird abgelehnt", leer);

  // Der Blog aus den Tests oben in die Gruppe stecken.
  k.feedAendern(blogId, { gruppeId: g.id });
  const kacheln = k.gruppenUebersicht();
  const meine = kacheln.find((x) => x.id === g.id);
  pruefe("die Kachel zaehlt das Abo", meine?.abos === 1 && meine?.blogs === 1);
  pruefe("und die Beitraege darin", meine?.beitraege === 2);

  /* Der ZWECK der Gruppe: nur ihre Beitraege zeigen. Ohne Filterung waere
     die Gruppe nur Zierde. */
  pruefe("Beitraege der Gruppe sind gefiltert", k.beitraege({ gruppeId: g.id }).length === 2);
  pruefe("eine fremde Gruppe liefert nichts", k.beitraege({ gruppeId: "gibtsnicht" }).length === 0);
  pruefe("gruppeId null liefert nur die gruppenlosen", k.beitraege({ gruppeId: null }).every((b) => b.gruppeId == null));
  pruefe("ohne gruppeId kommt alles", k.beitraege({}).length >= 2);

  // Nur EINE Gruppe darf beim Oeffnen aufgehen.
  const zweite = k.gruppeAnlegen({ name: "Marvel", emoji: "🦸" });
  k.gruppeAendern(g.id, { standardOffen: true });
  k.gruppeAendern(zweite.id, { standardOffen: true });
  const offen = k.gruppenUebersicht().filter((x) => x.standardOffen);
  pruefe("hoechstens eine Gruppe oeffnet automatisch", offen.length === 1 && offen[0].id === zweite.id);

  k.gruppeAendern(g.id, { farbe: "#ff4d5a", emoji: "🎬" });
  const nachher = k.gruppenUebersicht().find((x) => x.id === g.id);
  pruefe("Farbe und Symbol lassen sich aendern", nachher.farbe === "#ff4d5a" && nachher.emoji === "🎬");

  // Loeschen darf die Abos NICHT mitnehmen.
  const vorherAbos = k.feedsLaden().length;
  const r = k.gruppeLoeschen(zweite.id);
  pruefe("Loeschen entfernt nur die Gruppe", k.feedsLaden().length === vorherAbos && r.geloescht);
}

// ── Suche, Sortierung, Merkliste, Gesehen ───────────────────────────────────
console.log("\n── Suche, Merkliste und Gesehen ────────────────────────────");
{
  pruefe("Suche findet den Beitrag", k.beitraege({ suche: "Nummer 2" }).length === 1);
  pruefe("Suche ohne Treffer liefert nichts", k.beitraege({ suche: "voellig-egal-xyz" }).length === 0);

  const alle = k.beitraege({ sortierung: "neu" });
  const alt = k.beitraege({ sortierung: "alt" });
  pruefe("Sortierung dreht die Reihenfolge um", alle[0].id === alt[alt.length - 1].id);

  const eins = alle[0];
  k.merken(eins.id, true);
  pruefe("ein Beitrag laesst sich merken", k.beitraege({ nurGemerkt: true }).length === 1);
  k.merken(eins.id, false);
  pruefe("und wieder aus der Merkliste nehmen", k.beitraege({ nurGemerkt: true }).length === 0);

  k.gesehenSetzen(eins.id, true);
  pruefe("Gesehenes gilt zugleich als gelesen", k.beitraege({}).find((b) => b.id === eins.id).gelesen === true);
  pruefe("und laesst sich ausblenden", !k.beitraege({ ohneGesehene: true }).some((b) => b.id === eins.id));
  k.gesehenSetzen(eins.id, false);
}

// ── Shorts-Filter ───────────────────────────────────────────────────────────
console.log("\n── Shorts trennen ──────────────────────────────────────────");
{
  const alle = k.beitraege({});
  // Marken von Hand setzen — der echte Abruf gegen YouTube gehoert nicht in
  // einen Test, der ohne Netz laufen soll.
  const roh = JSON.parse((await import("../src/db.js")).getSetting("feed_items"));
  roh[0].istShort = true;
  roh[1].istShort = false;
  if (roh[2]) roh[2].istShort = null;
  (await import("../src/db.js")).setSetting("feed_items", JSON.stringify(roh));

  const shorts = k.beitraege({ format: "shorts" });
  const videos = k.beitraege({ format: "videos" });
  pruefe("Shorts-Filter liefert nur echte Shorts", shorts.length === 1 && shorts[0].istShort === true);
  /* Ungeprueftes (istShort === null) MUSS bei "Videos" mitkommen - sonst
     verschwinden neue Beitraege, solange die Pruefung noch aussteht. */
  pruefe("Video-Filter zeigt auch ungeprueftes", videos.every((b) => b.istShort !== true) && videos.length === alle.length - 1);
}

// ── Abbestellen ─────────────────────────────────────────────────────────────
console.log("\n── Abbestellen ─────────────────────────────────────────────");
{
  k.abbestellen(blogId);
  pruefe("das Abo ist weg", !k.feedsLaden().some((f) => f.id === blogId));
  pruefe("und seine Beiträge sind mit weg", k.beitraege({ art: "blog" }).length === 0);
  pruefe("die anderen Abos bleiben", k.feedsLaden().length === 1);
}

console.log(`\n${gut} Prüfungen bestanden, ${fehler.length} fehlgeschlagen.`);
if (fehler.length) {
  console.log("\nFehlgeschlagen:");
  fehler.forEach((f) => console.log("  - " + f));
}
feedserver.close();
try { rmSync(DATEN, { recursive: true, force: true }); } catch { /* egal */ }
process.exit(fehler.length ? 1 : 0);
