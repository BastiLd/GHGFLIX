/**
 * Tests für die Serversuche im Netz.
 *
 * Damit hier wirklich etwas bewiesen wird und nicht nur Attrappen befragt
 * werden, startet der Test einen ECHTEN kleinen HTTP-Server auf 127.0.0.1
 * und lässt die Suche ihn finden. Zusätzlich wird geprüft, dass fremde
 * Geräte im Netz nicht fälschlich für den GHGFlix-Server gehalten werden.
 *
 * Aufruf:
 *   cd mobile
 *   node test/netzsuche.test.mjs
 */
import http from "node:http";
import { netzTeil, normUrl, ping, portTeil, sucheImNetz, sucheServer } from "../src/netzsuche.js";

let gut = 0;
const fehler = [];
function pruefe(was, bedingung) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was); }
}

/** Startet einen Server, der sich als das Gewünschte ausgibt. */
function starte(antwort, port = 0) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      if (req.url.startsWith("/api/ping")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(antwort));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    s.listen(port, "127.0.0.1", () => ok({ s, port: s.address().port }));
  });
}

console.log("\n── Adressen aufräumen ──────────────────────────────────────");
pruefe("http:// wird ergänzt", normUrl("192.168.1.5:8484") === "http://192.168.1.5:8484");
pruefe("Schrägstrich am Ende fällt weg", normUrl("http://a.b/") === "http://a.b");
pruefe("https bleibt https", normUrl("https://x.de") === "https://x.de");
pruefe("Leereingabe bleibt leer", normUrl("  ") === "");

console.log("\n── Netz und Port herauslesen ───────────────────────────────");
pruefe("Netzteil aus voller Adresse", netzTeil("http://192.168.68.157:8484") === "192.168.68");
pruefe("Netzteil ohne Port", netzTeil("10.0.0.42") === "10.0.0");
pruefe("kein Netzteil bei Namen", netzTeil("http://meinserver.local") === null);
pruefe("Port wird gelesen", portTeil("http://192.168.1.5:9999") === 9999);
pruefe("ohne Port kommt 8484", portTeil("http://192.168.1.5") === 8484);

console.log("\n── Echten Server anpingen ──────────────────────────────────");
{
  const { s, port } = await starte({ app: "ghgflix-server", version: "2.3.2" });
  const r = await ping(`http://127.0.0.1:${port}`);
  pruefe("der eigene Server wird erkannt", r?.app === "ghgflix-server");
  pruefe("die Antwort kommt vollständig an", r?.version === "2.3.2");
  s.close();
}

console.log("\n── Fremde Geräte werden NICHT verwechselt ──────────────────");
{
  // Ein Drucker, eine Fritzbox, irgendein anderes Webinterface …
  const { s, port } = await starte({ app: "irgendwas-anderes" });
  const r = await ping(`http://127.0.0.1:${port}`);
  pruefe("fremdes Gerät wird abgelehnt", r === null);
  s.close();
}
{
  const { s, port } = await starte("kein json");
  const r = await ping(`http://127.0.0.1:${port}`);
  pruefe("unsinnige Antwort wird abgelehnt", r === null);
  s.close();
}

console.log("\n── Tote Adresse blockiert nicht ────────────────────────────");
{
  const start = Date.now();
  // 127.0.0.1 auf einem sicher freien Port -> sofortiges "connection refused"
  const r = await ping("http://127.0.0.1:9", 1200);
  const dauer = Date.now() - start;
  pruefe("keine Antwort ergibt null", r === null);
  pruefe(`und blockiert nicht (${dauer} ms < 1500)`, dauer < 1500);
}

console.log("\n── Suche im Netz findet den Server ─────────────────────────");
{
  // Eine echte Suche über 127.0.0.x ist nicht möglich (nur .1 existiert),
  // deshalb wird hier das Netz 127.0.0 mit dem Port des Testservers geprüft:
  // die Suche muss 127.0.0.1 finden und bei den übrigen 253 aufgeben.
  const { s, port } = await starte({ app: "ghgflix-server" });
  const start = Date.now();
  const t = await sucheImNetz("127.0.0", [port]);
  const dauer = Date.now() - start;
  pruefe("der Server wird im Netz gefunden", t?.url === `http://127.0.0.1:${port}`);
  pruefe(`die Suche ist zügig (${dauer} ms < 12000)`, dauer < 12000);
  s.close();
}

console.log("\n── Bekannte Adresse hat Vorrang (der Normalfall) ───────────");
{
  const { s, port } = await starte({ app: "ghgflix-server" });
  const adr = `http://127.0.0.1:${port}`;
  const start = Date.now();
  const t = await sucheServer([adr]);
  const dauer = Date.now() - start;
  pruefe("die gespeicherte Adresse wird sofort genommen", t?.url === adr);
  pruefe(`ohne das ganze Netz zu durchsuchen (${dauer} ms < 900)`, dauer < 900);
  s.close();
}

console.log("\n── Abbruch wirkt ───────────────────────────────────────────");
{
  let abgebrochen = false;
  setTimeout(() => { abgebrochen = true; }, 250);
  const start = Date.now();
  // Ein Netz ohne irgendetwas -> läuft lange, muss aber abbrechen
  await sucheImNetz("203.0.113", [8484], null, () => abgebrochen);
  const dauer = Date.now() - start;
  pruefe(`Abbruch beendet die Suche zügig (${dauer} ms < 6000)`, dauer < 6000);
}

console.log("\n────────────────────────────────────────────────────────────");
if (fehler.length) {
  console.log(`\nFEHLGESCHLAGEN: ${fehler.length} von ${gut + fehler.length}`);
  for (const f of fehler) console.log("   - " + f);
  process.exit(1);
}
console.log(`\nAlle ${gut} Netzsuche-Tests bestanden.`);
