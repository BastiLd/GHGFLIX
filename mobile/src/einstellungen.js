/**
 * ══════════════════════════════════════════════════════════════════════════
 *  EINSTELLUNGEN
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Alles, was sich einstellen lässt, an einem Ort — samt Standardwerten und
 * dauerhafter Speicherung. Die Werte überleben das Schließen der App und
 * gelten geräteweit (ein Fernseher braucht andere Untertitelgrößen als ein
 * Handy, deshalb bewusst NICHT über die Cloud abgeglichen).
 *
 * Die Beschreibungen hier werden direkt in der Oberfläche angezeigt. Sie
 * stehen absichtlich neben den Werten und nicht in der Ansicht: So bleibt
 * beim Hinzufügen einer Einstellung nichts vergessen.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const SCHLUESSEL = "ghgflix.einstellungen";

/** Standardwerte — bewusst so gewählt, dass sie am Fernseher gut aussehen. */
export const STANDARD = {
  /* ── Wiedergabe ──────────────────────────────────────────────────── */
  sprungVor: 30,               // Sekunden
  sprungZurueck: 10,
  tempo: 1,
  autoNaechste: true,          // nächste Folge von selbst starten
  autoNaechsteAb: 0.95,        // ab welchem Anteil als „fertig“ gilt
  fortsetzenAb: 30,            // erst ab dieser Position wieder aufnehmen
  bildmodus: "contain",        // contain | cover | fill
  tonSprache: "",              // bevorzugte Tonspur-Sprache, "" = automatisch

  /* ── Untertitel ──────────────────────────────────────────────────── */
  utSprache: "",               // bevorzugte Sprache, "" = aus
  utAn: false,                 // beim Start einschalten
  utGroesse: 1,                // Faktor 0.7 – 2.0
  utFarbe: "#ffffff",
  utHintergrund: 0.55,         // Deckkraft des Kastens hinter dem Text
  utPosition: 0.08,            // Abstand vom unteren Rand, Anteil der Höhe
  utVersatz: 0,                // Sekunden, falls sie zu früh oder spät kommen
  utRand: true,                // schwarze Kontur um die Schrift

  /* ── Oberfläche ──────────────────────────────────────────────────── */
  leisteAus: 5,                // Sekunden bis die Bedienleiste verschwindet
  updatePruefen: true,         // beim Start nach neuer App-Fassung sehen
  /* auto | unten | seite — siehe FELDER unten für die Begründung. */
  navigation: "auto",
};

/** Auswahlmöglichkeiten und Beschreibungen für die Einstellungsseite. */
export const FELDER = [
  {
    gruppe: "Wiedergabe",
    eintraege: [
      { name: "sprungZurueck", titel: "Sprung zurück", einheit: "Sek",
        werte: [5, 10, 15, 30], hinweis: "Wie weit die Taste ⏪ zurückspringt." },
      { name: "sprungVor", titel: "Sprung vor", einheit: "Sek",
        werte: [10, 15, 30, 60, 90], hinweis: "Wie weit die Taste ⏩ vorspringt." },
      { name: "tempo", titel: "Geschwindigkeit",
        werte: [0.75, 1, 1.25, 1.5, 2], anzeige: (v) => (v === 1 ? "Normal" : v + "×"),
        hinweis: "Gilt ab der nächsten Wiedergabe." },
      { name: "autoNaechste", titel: "Nächste Folge automatisch",
        werte: [true, false], anzeige: (v) => (v ? "An" : "Aus"),
        hinweis: "Startet die Folgefolge, sobald eine zu Ende ist." },
      { name: "bildmodus", titel: "Bildanpassung",
        werte: ["contain", "cover", "fill"],
        anzeige: (v) => ({ contain: "Einpassen (nichts abschneiden)", cover: "Füllen (Ränder abschneiden)", fill: "Verzerren" }[v]),
        hinweis: "„Füllen“ beseitigt schwarze Balken, schneidet dafür oben und unten etwas ab." },
      { name: "fortsetzenAb", titel: "Fortsetzen ab", einheit: "Sek",
        werte: [10, 30, 60, 120],
        hinweis: "Erst ab dieser Position wird beim nächsten Mal fortgesetzt." },
    ],
  },
  {
    gruppe: "Untertitel",
    eintraege: [
      { name: "utAn", titel: "Beim Start einschalten",
        werte: [true, false], anzeige: (v) => (v ? "An" : "Aus"),
        hinweis: "Wählt beim Abspielen gleich die bevorzugte Sprache." },
      { name: "utSprache", titel: "Bevorzugte Sprache",
        werte: ["", "ger", "eng", "fre", "spa", "ita"],
        anzeige: (v) => ({ "": "Automatisch", ger: "Deutsch", eng: "Englisch", fre: "Französisch", spa: "Spanisch", ita: "Italienisch" }[v]),
        hinweis: "Wird bevorzugt gewählt, wenn die Datei sie anbietet." },
      { name: "utGroesse", titel: "Schriftgröße",
        werte: [0.7, 0.85, 1, 1.25, 1.5, 2],
        anzeige: (v) => ({ 0.7: "Sehr klein", 0.85: "Klein", 1: "Normal", 1.25: "Groß", 1.5: "Sehr groß", 2: "Riesig" }[v] || v + "×"),
        hinweis: "Am Fernseher aus drei Metern ist „Groß“ meist angenehmer." },
      { name: "utFarbe", titel: "Schriftfarbe",
        werte: ["#ffffff", "#f5e663", "#7fe07f", "#8fc9ff", "#ffffff"],
        anzeige: (v) => ({ "#ffffff": "Weiß", "#f5e663": "Gelb", "#7fe07f": "Grün", "#8fc9ff": "Blau" }[v] || v),
        hinweis: "Gelb hebt sich auf hellen Bildern oft besser ab." },
      { name: "utHintergrund", titel: "Hintergrundkasten",
        werte: [0, 0.35, 0.55, 0.8, 1],
        anzeige: (v) => (v === 0 ? "Aus" : Math.round(v * 100) + " %"),
        hinweis: "Dunkler Kasten hinter dem Text — hilft bei unruhigen Bildern." },
      { name: "utRand", titel: "Schwarze Kontur",
        werte: [true, false], anzeige: (v) => (v ? "An" : "Aus"),
        hinweis: "Umrandet die Schrift, damit sie überall lesbar bleibt." },
      { name: "utPosition", titel: "Höhe über dem Rand",
        werte: [0.03, 0.08, 0.14, 0.22],
        anzeige: (v) => Math.round(v * 100) + " %",
        hinweis: "Höher setzen, falls der Fernseher unten etwas abschneidet." },
      { name: "utVersatz", titel: "Zeitversatz", einheit: "Sek",
        werte: [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3],
        anzeige: (v) => (v === 0 ? "Passt" : (v > 0 ? "+" : "") + v + " Sek"),
        hinweis: "Nur nötig, wenn die Untertitel zu früh oder zu spät kommen." },
    ],
  },
  {
    gruppe: "Bedienung",
    eintraege: [
      { name: "navigation", titel: "Navigation",
        werte: ["auto", "unten", "seite"],
        anzeige: (v) => ({
          auto: "Automatisch (empfohlen)",
          unten: "Leiste unten (wie Netflix)",
          seite: "Seitenleiste links",
        }[v]),
        hinweis:
          "„Automatisch“ heißt: am Handy die Leiste unten, am Fernseher die Seitenleiste. " +
          "Am Handy nimmt eine Seitenleiste die halbe Bildbreite ein — dann brechen Titel " +
          "mitten im Wort um. Am Fernseher ist es umgekehrt: dort ist seitlich richtig, " +
          "weil man mit der Fernbedienung hoch und runter wandert." },
      { name: "leisteAus", titel: "Bedienleiste ausblenden nach", einheit: "Sek",
        werte: [3, 5, 8, 15, 0],
        anzeige: (v) => (v === 0 ? "Nie" : v + " Sek"),
        hinweis: "Wie lange die Knöpfe sichtbar bleiben, wenn nichts gedrückt wird." },
      { name: "updatePruefen", titel: "Nach Updates sehen",
        werte: [true, false], anzeige: (v) => (v ? "An" : "Aus"),
        hinweis: "Prüft beim Start, ob auf dem Server eine neuere Fassung liegt." },
    ],
  },
];

/* ── Laden und Speichern ────────────────────────────────────────────────── */

let zwischenspeicher = null;

export async function laden() {
  if (zwischenspeicher) return zwischenspeicher;
  try {
    const roh = await AsyncStorage.getItem(SCHLUESSEL);
    zwischenspeicher = roh ? { ...STANDARD, ...JSON.parse(roh) } : { ...STANDARD };
  } catch {
    zwischenspeicher = { ...STANDARD };
  }
  return zwischenspeicher;
}

export async function sichern(neu) {
  zwischenspeicher = { ...STANDARD, ...neu };
  try {
    await AsyncStorage.setItem(SCHLUESSEL, JSON.stringify(zwischenspeicher));
  } catch { /* voller Speicher — dann gilt es wenigstens für diese Sitzung */ }
  return zwischenspeicher;
}

/** Der zuletzt geladene Stand, ohne Warten (für den Player). */
export const jetzt = () => zwischenspeicher || STANDARD;

/* ── Spurauswahl nach Vorlieben ─────────────────────────────────────────── */

/**
 * Passende Tonspur wählen.
 *
 * Reihenfolge: gewünschte Sprache → als Standard markierte → erste.
 * Das entspricht dem, was Plex und Jellyfin tun, und trifft in der Praxis
 * fast immer das Richtige.
 */
export function waehleTon(spuren, wunschSprache) {
  if (!spuren?.length) return null;
  if (wunschSprache) {
    const t = spuren.find((s) => passtSprache(s.sprache, wunschSprache));
    if (t) return t;
  }
  return spuren.find((s) => s.standard) || spuren[0];
}

/**
 * Passenden Untertitel wählen.
 *
 * Bild-Untertitel (PGS/VOBSUB) werden übersprungen — sie enthalten keinen
 * Text und ließen sich nur durch Einbrennen anzeigen.
 */
export function waehleUntertitel(spuren, wunschSprache, an) {
  if (!an || !spuren?.length) return null;
  const brauchbar = spuren.filter((s) => s.text && !s.bild);
  if (!brauchbar.length) return null;
  if (wunschSprache) {
    const genau = brauchbar.find((s) => passtSprache(s.sprache, wunschSprache) && !s.erzwungen);
    if (genau) return genau;
    const auchErzwungen = brauchbar.find((s) => passtSprache(s.sprache, wunschSprache));
    if (auchErzwungen) return auchErzwungen;
    return null;   // Wunschsprache gewünscht, aber nicht vorhanden -> lieber aus
  }
  return brauchbar.find((s) => s.standard && !s.erzwungen) || brauchbar[0];
}

/** "ger" und "de" und "deu" meinen dasselbe. */
export function passtSprache(a, b) {
  if (!a || !b) return false;
  const norm = (x) => {
    const s = String(x).toLowerCase().trim();
    const gleich = {
      de: "ger", deu: "ger", ger: "ger",
      en: "eng", eng: "eng",
      fr: "fre", fra: "fre", fre: "fre",
      es: "spa", spa: "spa",
      it: "ita", ita: "ita",
      nl: "nld", dut: "nld", ned: "nld", nld: "nld",
      pt: "por", por: "por",
      ru: "rus", rus: "rus",
      ja: "jpn", jpn: "jpn",
    };
    return gleich[s] || s;
  };
  return norm(a) === norm(b);
}
