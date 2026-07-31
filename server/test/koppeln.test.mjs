/**
 * Tests für die Kopplung („Fernseher freischalten ohne Tippen").
 *
 * Geprüft wird der vollständige Ablauf so, wie er am Gerät passiert:
 * Fernseher fordert Code an → Handy löst ihn mit dem Passwort ein →
 * Fernseher holt sein Token ab. Dazu die Fälle, in denen es schiefgehen
 * kann: falsches Passwort, abgelaufener Code, zweimal einlösen, geratener
 * Code.
 *
 * Aufruf:
 *   cd server
 *   node test/koppeln.test.mjs
 */
import {
  _leeren, kopplungsSeite, loeseKopplungEin, offeneKopplungen,
  pruefeKopplung, starteKopplung,
} from "../src/koppeln.js";

let gut = 0;
const fehler = [];
function pruefe(was, bedingung) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was); }
}

_leeren();

console.log("\n── Der normale Ablauf ──────────────────────────────────────");
{
  const v = starteKopplung("Android TV");
  pruefe("ein Code wird ausgegeben", !!v?.code);
  pruefe(`er ist sechs Zeichen lang (${v.code})`, v.code.length === 6);
  pruefe("er läuft in etwa zehn Minuten ab",
    v.gueltigBis - Date.now() > 9 * 60_000 && v.gueltigBis - Date.now() <= 10 * 60_000);

  pruefe("vor dem Einlösen: noch offen", pruefeKopplung(v.code).status === "offen");

  const ok = loeseKopplungEin(v.code, "geheimes-token-123");
  pruefe("das Einlösen gelingt", ok === true);

  const nachher = pruefeKopplung(v.code);
  pruefe("danach ist die Kopplung fertig", nachher.status === "fertig");
  pruefe("und das Token kommt an", nachher.token === "geheimes-token-123");

  pruefe("ein zweites Abholen findet nichts mehr (Code gilt einmal)",
    pruefeKopplung(v.code).status === "unbekannt");
}

console.log("\n── Codes sind gut lesbar und eindeutig ─────────────────────");
{
  _leeren();
  const codes = new Set();
  let nurGuteZeichen = true;
  for (let i = 0; i < 200; i++) {
    const v = starteKopplung();
    if (!v) break;
    codes.add(v.code);
    // Keine verwechselbaren Zeichen: 0/O, 1/I/L, 2/Z, 5/S, 8/B
    if (/[01258OILZSB]/.test(v.code)) nurGuteZeichen = false;
  }
  pruefe("keine verwechselbaren Zeichen (0/O, 1/I/L, 2/Z, 5/S, 8/B)", nurGuteZeichen);
  pruefe(`die Codes wiederholen sich nicht (${codes.size} verschiedene)`, codes.size > 15);
  pruefe("die Zahl offener Vorgänge bleibt begrenzt", offeneKopplungen() <= 20);
}

console.log("\n── Was schiefgehen kann ────────────────────────────────────");
{
  _leeren();
  pruefe("ein geratener Code ist unbekannt", pruefeKopplung("XXXXXX").status === "unbekannt");
  pruefe("ein leerer Code ist unbekannt", pruefeKopplung("").status === "unbekannt");
  pruefe("null ist unbekannt", pruefeKopplung(null).status === "unbekannt");
  pruefe("ein unbekannter Code lässt sich nicht einlösen",
    loeseKopplungEin("XXXXXX", "token") === false);

  const v = starteKopplung();
  pruefe("Kleinschreibung wird trotzdem erkannt",
    pruefeKopplung(v.code.toLowerCase()).status === "offen");
  loeseKopplungEin(v.code, "t1");
  pruefe("ein zweites Einlösen wird abgelehnt", loeseKopplungEin(v.code, "t2") === false);
  pruefe("und es bleibt beim ersten Token", pruefeKopplung(v.code).token === "t1");
}

console.log("\n── Zwei Fernseher gleichzeitig ─────────────────────────────");
{
  _leeren();
  const a = starteKopplung("Wohnzimmer");
  const b = starteKopplung("Schlafzimmer");
  pruefe("beide bekommen verschiedene Codes", a.code !== b.code);
  loeseKopplungEin(b.code, "token-schlafzimmer");
  pruefe("nur der eingelöste ist fertig", pruefeKopplung(b.code).status === "fertig");
  pruefe("der andere bleibt offen", pruefeKopplung(a.code).status === "offen");
}

console.log("\n── Die Seite fürs Handy ────────────────────────────────────");
{
  const seite = kopplungsSeite({ code: "K7M2QX" });
  pruefe("es kommt eine HTML-Seite", seite.startsWith("<!doctype html>"));
  pruefe("der Code steht darin", seite.includes("K7M2QX"));
  pruefe("es gibt ein Passwortfeld", seite.includes('type="password"'));
  pruefe("das Formular schickt an /koppeln", seite.includes('action="/koppeln"'));
  pruefe("der Code wird mitgeschickt", seite.includes('name="code"'));
  pruefe("sie funktioniert ohne JavaScript", !seite.includes("<script"));
  pruefe("mit Ansicht für Handys", seite.includes("viewport"));

  const fertig = kopplungsSeite({ fertig: true });
  pruefe("die Erfolgsseite sagt Bescheid", fertig.includes("Verbunden"));
  pruefe("und zeigt kein Formular mehr", !fertig.includes("<form"));

  const mitFehler = kopplungsSeite({ code: "ABC123", meldung: "Falsches Passwort." });
  pruefe("eine Fehlermeldung wird angezeigt", mitFehler.includes("Falsches Passwort."));

  // Eingeschleuster HTML-Code darf nicht wirken
  const boese = kopplungsSeite({ code: '<img src=x onerror=alert(1)>' });
  pruefe("eingeschleustes HTML wird entschärft",
    !boese.includes("<img src=x") && boese.includes("&lt;img"));
}

console.log("\n────────────────────────────────────────────────────────────");
if (fehler.length) {
  console.log(`\nFEHLGESCHLAGEN: ${fehler.length} von ${gut + fehler.length}`);
  for (const f of fehler) console.log("   - " + f);
  process.exit(1);
}
console.log(`\nAlle ${gut} Kopplungs-Tests bestanden.`);
