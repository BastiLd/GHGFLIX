/**
 * Tests für die ERREICHBARKEIT der HTTP-Endpunkte.
 *
 * WARUM ES DIESE DATEI GIBT
 * -------------------------
 * Im Juli 2026 war die QR-Kopplung wochenlang kaputt, ohne dass es auffiel:
 * Die drei Routen (/api/pair/start, /api/pair/check, /koppeln) steckten
 * versehentlich INNERHALB des `if (p === "/api/apk" && POST)`-Blocks in
 * index.js. Eine Anfrage kann aber nie gleichzeitig /api/apk UND
 * /api/pair/start sein — die Kopplung war über HTTP schlicht nie erreichbar.
 *
 * Warum kein Test das gemerkt hat: koppeln.test.mjs importiert `koppeln.js`
 * direkt und prüft die Logik für sich. Die war die ganze Zeit korrekt. Kaputt
 * war die VERDRAHTUNG — und die kann man nur sehen, wenn man echte
 * HTTP-Anfragen an den echten Server schickt.
 *
 * Genau das macht diese Datei: sie startet den richtigen Server (src/index.js)
 * auf einem freien Port mit einem Wegwerf-Datenordner und klopft die Routen
 * von außen ab, so wie es der Fernseher tun würde.
 *
 * Aufruf:
 *   cd server
 *   node test/routen.test.mjs
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

// ── Server hochfahren ───────────────────────────────────────────────────────
// Freien Port besorgen, damit der Test nie mit einem laufenden Server kollidiert.
const PORT = await new Promise((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});

const DATEN = mkdtempSync(join(tmpdir(), "ghgflix-routen-"));
const PASSWORT = "test-passwort-123";

process.env.PORT = String(PORT);
process.env.DATA_DIR = DATEN;
process.env.GHGFLIX_PASSWORD = PASSWORT;
process.env.BROWSE_ROOTS = DATEN;       // kein echtes Dateisystem anfassen
process.env.SCAN_INTERVAL_SEC = "99999"; // kein Rescan während des Tests

// Der Import STARTET den Server (index.js ruft server.listen selbst auf).
await import("../src/index.js");

const basis = `http://127.0.0.1:${PORT}`;
const hole = (pfad, opts) => fetch(basis + pfad, opts);

// Warten, bis der Server wirklich antwortet.
let bereit = false;
for (let i = 0; i < 100; i++) {
  try {
    const r = await hole("/api/ping");
    if (r.ok) { bereit = true; break; }
  } catch { /* noch nicht oben */ }
  await new Promise((r) => setTimeout(r, 100));
}
if (!bereit) {
  console.error("Server ist nicht hochgekommen — Test abgebrochen.");
  process.exit(1);
}

console.log("\n── Grundlagen ──────────────────────────────────────────────");
{
  const r = await hole("/api/ping");
  const d = await r.json();
  pruefe("/api/ping antwortet ohne Anmeldung", r.status === 200 && d.ok === true);
  pruefe("und meldet, dass ein Passwort gesetzt ist", d.auth === true);

  const geschuetzt = await hole("/api/library");
  pruefe("/api/library ist ohne Token gesperrt", geschuetzt.status === 401);
}

/* ── REGRESSION: YouTube-Fehler 153 ───────────────────────────────────────
   Hier stand `Referrer-Policy: no-referrer`. Damit schickt der Browser beim
   Laden des YouTube-<iframe> keinen Referer, und YouTube verweigert die
   Einbettung mit „Fehler 153 – Fehler bei der Konfiguration des
   Videoplayers" — genau der gemeldete Trailer-Fehler unter /#/show/28.
   Wird der Header je wieder auf no-referrer gesetzt, schlägt das hier fehl. */
console.log("\n── Sicherheitsheader (Trailer-Einbettung) ──────────────────");
{
  const r = await hole("/api/ping");
  const rp = (r.headers.get("referrer-policy") || "").toLowerCase();
  pruefe("Referrer-Policy ist NICHT no-referrer (sonst YouTube-Fehler 153)", rp !== "no-referrer");
  pruefe("sondern strict-origin-when-cross-origin", rp === "strict-origin-when-cross-origin");
  pruefe("nosniff bleibt gesetzt", r.headers.get("x-content-type-options") === "nosniff");
  pruefe("X-Frame-Options bleibt gesetzt", (r.headers.get("x-frame-options") || "").toUpperCase() === "SAMEORIGIN");
}

/* ── DER EIGENTLICHE REGRESSIONSTEST ──────────────────────────────────────
   Jede dieser Routen war durch die Verschachtelung im /api/apk-Block tot.
   Wichtig ist hier vor allem: NICHT 404/401 — das wäre das alte Verhalten. */
console.log("\n── QR-Kopplung: sind die Routen überhaupt erreichbar? ──────");
let code = null;
{
  const r = await hole("/api/pair/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ geraet: "Android TV" }),
  });
  pruefe("POST /api/pair/start ist erreichbar (nicht 404/401)", r.status === 200);
  const d = await r.json().catch(() => ({}));
  code = d.code || null;
  pruefe("und liefert einen Kopplungscode", typeof code === "string" && code.length === 6);
}

{
  const r = await hole(`/api/pair/check?code=${encodeURIComponent(code || "XXXXXX")}`);
  pruefe("GET /api/pair/check ist erreichbar", r.status === 200);
  const d = await r.json().catch(() => ({}));
  pruefe("und meldet den Code als offen", d.status === "offen");
}

{
  const r = await hole(`/koppeln?code=${encodeURIComponent(code || "")}`);
  const html = await r.text();
  pruefe("GET /koppeln liefert die Handy-Seite (nicht die Web-App)", r.status === 200 && /<form/i.test(html));
}

console.log("\n── Der komplette Ablauf, wie am Gerät ──────────────────────");
{
  // Das Handy schickt ein ganz normales HTML-Formular (urlencoded) — genau so,
  // wie es ein Browser ohne JavaScript tut.
  const falsch = await hole("/koppeln", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: code || "", passwort: "falsch" }).toString(),
  });
  const htmlFalsch = await falsch.text();
  pruefe("falsches Passwort wird abgewiesen", /Falsches Passwort/i.test(htmlFalsch));

  const nochOffen = await (await hole(`/api/pair/check?code=${code}`)).json();
  pruefe("und der Fernseher bekommt dadurch KEIN Token", nochOffen.status === "offen");

  const richtig = await hole("/koppeln", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: code || "", passwort: PASSWORT }).toString(),
  });
  pruefe("richtiges Passwort wird angenommen", richtig.status === 200);

  const fertig = await (await hole(`/api/pair/check?code=${code}`)).json();
  pruefe("der Fernseher holt sein Token ab", fertig.status === "fertig" && !!fertig.token);

  // Der Beweis, dass die Kopplung wirklich etwas wert ist: mit genau diesem
  // Token muss eine geschuetzte Route aufgehen.
  const mitToken = await hole("/api/library", {
    headers: { Authorization: "Bearer " + fertig.token },
  });
  pruefe("und mit diesem Token geht /api/library auf", mitToken.status === 200);
}

console.log("\n── Der APK-Block bleibt geschützt ──────────────────────────");
{
  // Gegenprobe: Beim Herauslösen der Kopplung darf die Anmeldepflicht des
  // Uploads nicht verlorengehen (die stand vorher im selben Block).
  const ohne = await hole("/api/apk", { method: "POST", body: "PK-nicht-echt" });
  pruefe("POST /api/apk ohne Token wird abgewiesen", ohne.status === 401);

  const status = await hole("/api/apk/status");
  pruefe("/api/apk/status bleibt ohne Anmeldung lesbar (für die TV-Seite)", status.status === 200);

  const seite = await hole("/app");
  pruefe("/app (Installationsseite) bleibt ohne Anmeldung erreichbar", seite.status === 200);
}

// ── Aufräumen ───────────────────────────────────────────────────────────────
console.log(`\n${gut} Prüfungen bestanden, ${fehler.length} fehlgeschlagen.`);
if (fehler.length) {
  console.log("\nFehlgeschlagen:");
  fehler.forEach((f) => console.log("  - " + f));
}
try { rmSync(DATEN, { recursive: true, force: true }); } catch { /* egal */ }
process.exit(fehler.length ? 1 : 0);
