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
import { netzTeil, normAdresse, normUrl, ping, portTeil, sucheImNetz, sucheServer } from "../src/netzsuche.js";

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

/* ── Eingabe von Hand ───────────────────────────────────────────────────
   „Es ist nicht bei allen 192.168.68" — wer in einem anderen Netz sitzt,
   muss die drei Zahlen eintippen können, ohne die letzte zu kennen. */
console.log("\n── Adresse/Netz von Hand eingeben ──────────────────────────");
{
  const f = (t) => JSON.stringify(normAdresse(t));
  pruefe("volle Adresse", f("192.168.78.10") === JSON.stringify({ art: "adresse", url: "http://192.168.78.10:8484" }));
  pruefe("mit eigenem Port", f("192.168.78.10:8080") === JSON.stringify({ art: "adresse", url: "http://192.168.78.10:8080" }));
  pruefe("mit http:// davor", f("http://192.168.78.10:8484") === JSON.stringify({ art: "adresse", url: "http://192.168.78.10:8484" }));
  pruefe("nur die drei Zahlen = ganzes Netz",
    f("192.168.78") === JSON.stringify({ art: "netz", netz: "192.168.78", port: 8484 }));
  pruefe("auch als 192.168.78.x geschrieben",
    f("192.168.78.x") === JSON.stringify({ art: "netz", netz: "192.168.78", port: 8484 }));
  pruefe("Netz mit eigenem Port", normAdresse("10.0.5:9000")?.port === 9000);
  pruefe("Name statt Zahlen geht auch", normAdresse("ghgflix.local")?.url === "http://ghgflix.local:8484");
  pruefe("Unsinn wird abgelehnt", normAdresse("   ") === null && normAdresse("!!!") === null);
  pruefe("zu grosse Zahlen werden nicht als Netz gelesen", normAdresse("999.1.1")?.art !== "netz");
}

console.log("\n── Von Hand angegebene Adresse wird zuerst geprüft ──────────");
{
  const { s, port } = await starte({ ok: true, app: "ghgflix-server", version: "9.9.9" });
  const start = Date.now();
  // Bewusst OHNE bekannte Adressen: gefunden werden darf sie nur, weil sie
  // von Hand mitgegeben wurde.
  const t = await sucheServer([], null, null, { zusatz: [`127.0.0.1:${port}`] });
  const dauer = Date.now() - start;
  pruefe("die eingetippte Adresse wird gefunden", t?.info?.version === "9.9.9");
  pruefe(`und zwar sofort, ohne Netzsuche (${dauer} ms < 900)`, dauer < 900);
  s.close();
}

console.log("\n── Gleichzeitigkeit ist einstellbar ────────────────────────");
{
  // Mit 1 gleichzeitig darf nichts kaputtgehen — nur langsamer werden.
  const { s, port } = await starte({ ok: true, app: "ghgflix-server", version: "1.2.3" });
  const t = await sucheImNetz("127.0.0", [port], null, null, 1);
  pruefe("auch mit nur einer Verbindung wird gefunden", t?.info?.version === "1.2.3");
  s.close();
}

console.log("\n────────────────────────────────────────────────────────────");
if (fehler.length) {
  console.log(`\nFEHLGESCHLAGEN: ${fehler.length} von ${gut + fehler.length}`);
  for (const f of fehler) console.log("   - " + f);
  process.exit(1);
}
console.log(`\nAlle ${gut} Netzsuche-Tests bestanden.`);
