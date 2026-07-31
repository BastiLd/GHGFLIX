/**
 * Tests für den Fokus-Kern — die Auswahl-Logik der Fernbedienung.
 *
 * Der Kern kennt weder React noch einen Bildschirm, deshalb lässt sich hier
 * ohne Gerät und ohne Cloud-Build prüfen, ob sich die Auswahl so bewegt, wie
 * man es am Fernseher erwartet. Ein Durchlauf dauert Millisekunden; ein Build
 * plus Installation am Fernseher dauert eine Viertelstunde.
 *
 * Aufruf:
 *   cd mobile
 *   node test/fokus.test.mjs
 */
import { erzeugeFokusKern } from "../src/fokus-kern.js";

let gut = 0;
const fehler = [];
function pruefe(was, bedingung) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was); }
}

/** Baut einen Startbildschirm nach: Seitenleiste + Reihen mit Kacheln. */
function baueStartbildschirm() {
  const markiert = new Set();
  const k = erzeugeFokusKern();
  const anmelden = (s, e) =>
    k.anmelden(s, { ...e, melde: (an) => (an ? markiert.add(s) : markiert.delete(s)) });

  // Seitenleiste: 5 Einträge untereinander (jeder eine eigene Zeile, Spalte 0)
  ["start", "filme", "serien", "liste", "einst"].forEach((n, i) =>
    anmelden("nav:" + n, { bereich: "nav", zeile: i, spalte: 0 }));

  // Inhalt: Zeile 0 = Hero-Knöpfe, Zeile 1 = Suche, Zeile 2..4 = Kachelreihen
  anmelden("hero:ansehen", { bereich: "inhalt", zeile: 0, spalte: 0 });
  anmelden("hero:infos",   { bereich: "inhalt", zeile: 0, spalte: 1 });
  anmelden("suche",        { bereich: "inhalt", zeile: 1, spalte: 0 });
  for (let r = 2; r <= 4; r++)
    for (let s = 0; s < 8; s++)
      anmelden(`reihe${r}:k${s}`, { bereich: "inhalt", zeile: r, spalte: s });

  return { k, markiert };
}

console.log("\n── Grundlagen ──────────────────────────────────────────────");
{
  const { k, markiert } = baueStartbildschirm();
  pruefe("nach dem Aufbau ist etwas ausgewählt", k.aktiv != null);
  pruefe("genau EIN Element ist markiert", markiert.size === 1);
  pruefe("die Markierung sitzt am ausgewählten Element", markiert.has(k.aktiv));
}

console.log("\n── Waagerecht durch eine Kachelreihe ────────────────────────");
{
  const { k, markiert } = baueStartbildschirm();
  k.setzen("reihe2:k0");
  k.bewegen("right");
  pruefe("rechts geht zur nächsten Kachel", k.aktiv === "reihe2:k1");
  k.bewegen("right"); k.bewegen("right");
  pruefe("mehrfach rechts zählt weiter", k.aktiv === "reihe2:k3");
  k.bewegen("left");
  pruefe("links geht zurück", k.aktiv === "reihe2:k2");
  pruefe("immer nur EINE Markierung", markiert.size === 1);

  k.setzen("reihe2:k7");
  const bewegt = k.bewegen("right");
  pruefe("am rechten Ende passiert nichts", k.aktiv === "reihe2:k7" && bewegt === false);
}

console.log("\n── Senkrecht zwischen Reihen ────────────────────────────────");
{
  const { k } = baueStartbildschirm();
  k.setzen("reihe2:k5");
  k.bewegen("down");
  pruefe("runter behält die Spalte bei", k.aktiv === "reihe3:k5");
  k.bewegen("down");
  pruefe("noch eine Reihe runter, Spalte bleibt", k.aktiv === "reihe4:k5");
  k.bewegen("up"); k.bewegen("up");
  pruefe("wieder hoch landet bei derselben Spalte", k.aktiv === "reihe2:k5");
}

console.log("\n── Spalten-Gedächtnis (der klassische Ärger am Fernseher) ───");
{
  const { k } = baueStartbildschirm();
  // In Reihe 2 weit nach rechts, dann runter in Reihe 3, dort nach links,
  // dann wieder hoch: Reihe 2 soll die alte Position wiederhaben.
  k.setzen("reihe2:k6");
  k.bewegen("down");                      // reihe3:k6
  k.bewegen("left"); k.bewegen("left");   // reihe3:k4
  k.bewegen("up");
  pruefe("hoch merkt sich, wo man in dieser Reihe war", k.aktiv === "reihe2:k6");
  k.bewegen("down");
  pruefe("runter merkt sich das ebenfalls", k.aktiv === "reihe3:k4");
}

console.log("\n── Übergang zur Seitenleiste ────────────────────────────────");
{
  const { k } = baueStartbildschirm();
  k.setzen("reihe3:k0");
  k.bewegen("left");
  pruefe("links am Rand springt in die Seitenleiste", k.aktiv?.startsWith("nav:"));
  k.bewegen("down");
  pruefe("in der Seitenleiste geht runter zum nächsten Eintrag", k.aktiv === "nav:filme");
  k.bewegen("up");
  pruefe("und wieder hoch", k.aktiv === "nav:start");
  k.bewegen("right");
  pruefe("rechts führt zurück in den Inhalt", k.aktiv?.startsWith("inhalt") || !k.aktiv.startsWith("nav:"));

  k.setzen("nav:start");
  const raus = k.bewegen("left");
  pruefe("links in der Seitenleiste tut nichts", k.aktiv === "nav:start" && raus === false);
}

console.log("\n── Nicht aus Versehen in die Seitenleiste ───────────────────");
{
  const { k } = baueStartbildschirm();
  k.setzen("reihe3:k3");
  k.bewegen("left"); k.bewegen("left"); k.bewegen("left");
  pruefe("aus Spalte 3 braucht es 3x links bis Spalte 0", k.aktiv === "reihe3:k0");
  k.bewegen("left");
  pruefe("erst der 4. Druck wechselt in die Seitenleiste", k.aktiv?.startsWith("nav:"));
}

console.log("\n── OK-Taste ─────────────────────────────────────────────────");
{
  const k = erzeugeFokusKern();
  let gedrueckt = null;
  k.anmelden("a", { bereich: "inhalt", zeile: 0, spalte: 0, onPress: () => (gedrueckt = "a") });
  k.anmelden("b", { bereich: "inhalt", zeile: 0, spalte: 1, onPress: () => (gedrueckt = "b") });
  k.ausloesen();
  pruefe("OK löst das ausgewählte Element aus", gedrueckt === "a");
  k.bewegen("right"); k.ausloesen();
  pruefe("nach dem Wechsel löst das neue aus", gedrueckt === "b");
}

console.log("\n── Dialoge fangen die Tasten ab ─────────────────────────────");
{
  const k = erzeugeFokusKern();
  let gedrueckt = null;
  k.anmelden("hinten", { bereich: "inhalt", zeile: 0, spalte: 0, onPress: () => (gedrueckt = "hinten") });
  k.anmelden("hinten2", { bereich: "inhalt", zeile: 0, spalte: 1 });
  k.dialogAuf();
  k.anmelden("dlg:ja",   { bereich: "dialog", zeile: 0, spalte: 0, onPress: () => (gedrueckt = "ja") });
  k.anmelden("dlg:nein", { bereich: "dialog", zeile: 0, spalte: 1 });
  pruefe("beim Öffnen wandert die Auswahl in den Dialog", k.aktiv === "dlg:ja");
  k.bewegen("right");
  pruefe("im Dialog bewegt sich die Auswahl", k.aktiv === "dlg:nein");
  k.bewegen("down");
  pruefe("der Dialog lässt nicht nach hinten durch", k.aktiv === "dlg:nein");
  k.setzen("dlg:ja"); k.ausloesen();
  pruefe("OK trifft den Dialog, nicht den Hintergrund", gedrueckt === "ja");
  k.abmelden("dlg:ja"); k.abmelden("dlg:nein"); k.dialogZu();
  pruefe("nach dem Schließen ist der alte Platz wieder da", k.aktiv === "hinten");
}

console.log("\n── Kachel verschwindet (Liste lädt nach / Filter greift) ────");
{
  const { k, markiert } = baueStartbildschirm();
  k.setzen("reihe3:k4");
  k.abmelden("reihe3:k4");
  pruefe("die Auswahl bleibt nicht im Nichts hängen", k.aktiv != null);
  pruefe("sie landet in derselben Reihe", k.aktiv?.startsWith("reihe3:"));
  pruefe("sie landet gleich daneben", k.aktiv === "reihe3:k3" || k.aktiv === "reihe3:k5");
  pruefe("und ist auch sichtbar markiert", markiert.has(k.aktiv));
}

console.log("\n── Ganze Reihe verschwindet ─────────────────────────────────");
{
  const { k } = baueStartbildschirm();
  k.setzen("reihe4:k2");
  for (let s = 0; s < 8; s++) k.abmelden(`reihe4:k${s}`);
  pruefe("die Auswahl überlebt", k.aktiv != null);
  pruefe("sie sitzt auf einem noch vorhandenen Element",
    k._alle().some((x) => x.schluessel === k.aktiv));
}

console.log("\n── Player: Balken oben, Knöpfe darunter ─────────────────────");
{
  const k = erzeugeFokusKern();
  const gedrueckt = [];
  k.anmelden("bar", { bereich: "inhalt", zeile: 0, spalte: 0, onPress: () => gedrueckt.push("bar") });
  ["zurueck10", "pause", "vor10", "naechste"].forEach((n, i) =>
    k.anmelden("btn:" + n, { bereich: "inhalt", zeile: 1, spalte: i, onPress: () => gedrueckt.push(n) }));

  k.setzen("btn:pause");
  k.ausloesen();
  pruefe("Pause lässt sich auslösen", gedrueckt.at(-1) === "pause");
  k.bewegen("up");
  pruefe("hoch führt zum Fortschrittsbalken", k.aktiv === "bar");
  k.bewegen("down");
  pruefe("runter geht zurück zu den Knöpfen", k.aktiv?.startsWith("btn:"));
  k.setzen("btn:zurueck10");
  k.bewegen("right"); k.bewegen("right"); k.bewegen("right");
  pruefe("alle vier Knöpfe sind erreichbar", k.aktiv === "btn:naechste");
}

console.log("\n── Langer Druck ─────────────────────────────────────────────");
{
  const k = erzeugeFokusKern();
  let lang = false, kurz = false;
  k.anmelden("a", {
    bereich: "inhalt", zeile: 0, spalte: 0,
    onPress: () => (kurz = true), onLang: () => (lang = true),
  });
  k.langDruecken();
  pruefe("langer Druck ruft die eigene Aktion", lang === true && kurz === false);
}

console.log("\n── Übersprungene Elemente ───────────────────────────────────");
{
  const k = erzeugeFokusKern();
  k.anmelden("deko", { bereich: "inhalt", zeile: 0, spalte: 0, uebersprigen: true });
  k.anmelden("echt", { bereich: "inhalt", zeile: 0, spalte: 1 });
  pruefe("reine Deko wird nicht angesprungen", k.aktiv === "echt");
}

console.log("\n── Element verarbeitet Richtungstasten selbst (Fortschrittsbalken) ──");
{
  const k = erzeugeFokusKern();
  const gesprungen = [];
  k.anmelden("bar", {
    bereich: "inhalt", zeile: 0, spalte: 0,
    // Der Balken behaelt links/rechts fuer sich, oben/unten gibt er weiter
    aufRichtung: (r) => {
      if (r === "left" || r === "right") { gesprungen.push(r); return true; }
      return false;
    },
  });
  k.anmelden("btn:a", { bereich: "inhalt", zeile: 1, spalte: 0 });
  k.anmelden("btn:b", { bereich: "inhalt", zeile: 1, spalte: 1 });

  k.setzen("bar");
  k.bewegen("right"); k.bewegen("right"); k.bewegen("left");
  pruefe("links/rechts springen im Video statt den Fokus zu bewegen",
    k.aktiv === "bar" && gesprungen.join() === "right,right,left");
  k.bewegen("down");
  pruefe("runter verlaesst den Balken trotzdem", k.aktiv?.startsWith("btn:"));
  k.bewegen("right");
  pruefe("bei den Knoepfen wirkt rechts wieder normal", k.aktiv === "btn:b");
  k.bewegen("up");
  pruefe("hoch fuehrt zurueck zum Balken", k.aktiv === "bar");
}

console.log("\n────────────────────────────────────────────────────────────");
if (fehler.length) {
  console.log(`\nFEHLGESCHLAGEN: ${fehler.length} von ${gut + fehler.length}`);
  for (const f of fehler) console.log("   - " + f);
  process.exit(1);
}
console.log(`\nAlle ${gut} Fokus-Tests bestanden.`);
