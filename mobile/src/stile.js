/**
 * Farben und Stile für Handy und Fernseher.
 *
 * Die Werte stammen aus der Desktop-App (tailwind.config: ghg-bg, ghg-bg2,
 * ghg-surface, ghg-line, ghg-red, ghg-text, ghg-muted), damit alle drei
 * Oberflächen wirklich gleich aussehen und nicht nur ungefähr.
 *
 * MASSE UND FERNSEHER
 * Ein Fernseher steht drei Meter weg, ein Handy 30 cm. Deshalb skaliert die
 * Datei die wichtigsten Größen über `gross`: auf einem breiten Bildschirm
 * (ab 900 Punkten, also praktisch jeder Fernseher) werden Kacheln, Schriften
 * und Abstände größer. Ein einziger Satz Stile bedient damit beides.
 */
import { Dimensions, Platform, StyleSheet } from "react-native";

const fenster = Dimensions.get("window");
/** true auf Fernsehern und Tablets im Querformat. */
export const gross = Math.max(fenster.width, fenster.height) >= 900;

/**
 * Läuft die App auf einem Fernseher?
 *
 * React Native setzt `Platform.isTV` unter Android anhand des Gerätemodus
 * (UI_MODE_TYPE_TELEVISION) — auf einem Google-TV also zuverlässig true, auf
 * einem Handy false. Als zweites Merkmal ein sehr breiter Bildschirm, damit
 * auch ein an den Fernseher angeschlossener Stick richtig erkannt wird.
 */
export const istTV = Platform.isTV === true || fenster.width >= 1200;

/**
 * Schmales Gerät (Handy im Hochformat).
 *
 * WICHTIG FÜR DIE NAVIGATION: Die Seitenleiste war früher auch hier fest
 * 190 Punkte breit. Auf einem Handy mit rund 390 Punkten Breite ist das die
 * HALBE Anzeige — der Inhalt daneben wurde so schmal, dass Überschriften
 * mitten im Wort umbrachen („Weitersch auen", „Serv er wech seln"). Deshalb
 * bekommt ein schmales Gerät die Navigation unten, wie bei Netflix.
 */
export const istHandy = !istTV && Math.min(fenster.width, fenster.height) < 600;

/** Farbpalette – identisch zur Desktop-App. */
export const C = {
  bg: "#0b0b0f",
  bg2: "#14141a",
  surface: "#1c1c24",
  surface2: "#24242e",
  line: "#2e2e38",
  red: "#e50914",
  redDunkel: "#b00610",
  text: "#f2f2f5",
  muted: "#9a9aa8",
  weiss: "#ffffff",
};

/** Maße, die zwischen Handy und Fernseher wechseln. */
export const M = {
  posterB: gross ? 168 : 118,
  posterH: gross ? 252 : 177,
  breitB: gross ? 300 : 218,
  breitH: gross ? 169 : 123,
  rand: gross ? 40 : 16,
  luecke: gross ? 16 : 12,
  heroH: gross ? 460 : 300,
  navBreit: gross ? 230 : 190,
  navSchmal: gross ? 76 : 64,
  titel: gross ? 34 : 22,
  reiheTitel: gross ? 22 : 15,
  kachelTitel: gross ? 15 : 12,
  klein: gross ? 13 : 11,
};

export const st = StyleSheet.create({
  /* ── Grundgerüst ───────────────────────────────────────────────────── */
  wurzel: { flex: 1, backgroundColor: C.bg, flexDirection: "row" },
  /* Am Handy liegt die Navigation unten, der Inhalt also DARÜBER statt
     daneben — deshalb die Spaltenrichtung. */
  wurzelHandy: { flex: 1, backgroundColor: C.bg, flexDirection: "column" },
  inhalt: { flex: 1 },

  /* ── Untere Navigationsleiste (Handy, wie bei Netflix) ─────────────── */
  unten: {
    flexDirection: "row",
    backgroundColor: "#101016",
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 7,
    // Platz für die Wisch-Leiste am unteren Rand moderner Telefone
    paddingBottom: 22,
  },
  untenEintrag: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 2 },
  untenSymbol: { fontSize: 21, lineHeight: 25, marginBottom: 3 },
  untenText: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.2 },
  /* Der Zähler sitzt als kleine Blase am Symbol — für „Filme 65" ist unten
     kein Platz, und als eigene Zeile würde er die Leiste zu hoch machen. */
  untenBlase: {
    position: "absolute", top: -3, right: -12, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: C.red, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  untenBlaseText: { color: C.weiss, fontSize: 9, fontWeight: "900" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  reihe: { flexDirection: "row", alignItems: "center" },
  reiheZwischen: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  /* ── Seitenleiste (wie in der Desktop-App) ─────────────────────────── */
  nav: {
    backgroundColor: C.bg2,
    borderRightWidth: 1,
    borderRightColor: C.line,
    paddingTop: gross ? 28 : 18,
    paddingBottom: 12,
  },
  navMarke: {
    color: C.red,
    fontWeight: "900",
    fontSize: gross ? 24 : 19,
    letterSpacing: 0.3,
    paddingHorizontal: gross ? 20 : 14,
    marginBottom: gross ? 26 : 18,
  },
  navMarkeKurz: {
    color: C.red, fontWeight: "900", fontSize: gross ? 24 : 19,
    textAlign: "center", marginBottom: gross ? 26 : 18,
  },
  navEintrag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: gross ? 12 : 8,
    marginBottom: 4,
    paddingHorizontal: gross ? 14 : 10,
    paddingVertical: gross ? 13 : 10,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "transparent",
  },
  navEintragAktiv: {
    backgroundColor: "#e5091426",
    borderColor: "#e5091459",
  },
  navEintragFokus: {
    backgroundColor: C.surface2,
    borderColor: C.weiss,
  },
  navSymbol: { fontSize: gross ? 21 : 17, width: gross ? 26 : 22, textAlign: "center" },
  navText: { color: C.muted, fontSize: gross ? 16 : 13.5, fontWeight: "600", flex: 1 },
  navTextAktiv: { color: C.red },
  navTextFokus: { color: C.text },
  navZahl: {
    color: C.muted, fontSize: gross ? 12 : 10, backgroundColor: C.surface2,
    borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2, overflow: "hidden",
  },
  navFuss: { paddingHorizontal: gross ? 20 : 14, paddingTop: 8 },
  navVersion: { color: "#6e6e7e", fontSize: gross ? 11 : 9.5, letterSpacing: 0.4 },

  /* ── Kopfbild ──────────────────────────────────────────────────────── */
  hero: { height: M.heroH, position: "relative" },
  heroBild: { width: "100%", height: M.heroH, backgroundColor: C.bg2 },
  heroText: { position: "absolute", left: M.rand, right: M.rand, bottom: gross ? 34 : 14 },
  heroTitel: {
    color: C.text, fontSize: gross ? 46 : 26, fontWeight: "900",
    textShadowColor: "#000", textShadowRadius: 10, marginBottom: 4,
  },
  heroMeta: { color: C.red, fontSize: gross ? 15 : 12, fontWeight: "700", marginBottom: 6 },
  heroBeschreibung: {
    color: "#d8d8e2", fontSize: gross ? 15 : 12, lineHeight: gross ? 22 : 17,
    maxWidth: gross ? 780 : undefined,
  },
  heroKnopfReihe: { flexDirection: "row", gap: 12, marginTop: gross ? 18 : 12 },

  /* ── Knöpfe ────────────────────────────────────────────────────────── */
  knopf: {
    backgroundColor: C.surface2,
    borderRadius: 10,
    paddingHorizontal: gross ? 22 : 16,
    paddingVertical: gross ? 13 : 10,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  knopfHaupt: { backgroundColor: C.red },
  knopfText: { color: C.text, fontWeight: "800", fontSize: gross ? 16 : 13 },
  knopfTextHaupt: { color: C.weiss },

  /* ── DIE MARKIERUNG ────────────────────────────────────────────────────
     Ein Rahmen allein ist auf drei Meter zu wenig. Deshalb: kräftiger
     weißer Rahmen, leichte Aufhellung und ein Schatten, der die Kachel
     vom Hintergrund abhebt. Die Rahmenbreite ist IMMER vorhanden (nur
     transparent), sonst würde beim Auswählen die ganze Reihe verrutschen. */
  fokus: {
    borderColor: C.weiss,
    backgroundColor: "#ffffff1f",
    shadowColor: "#ffffff",
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },

  /* ── Kacheln ───────────────────────────────────────────────────────── */
  kachel: {
    borderWidth: 3,
    borderColor: "transparent",
    borderRadius: 14,
    padding: 2,
  },
  kachelFokus: {
    borderColor: C.weiss,
    backgroundColor: "#ffffff1a",
    shadowColor: "#ffffff",
    shadowOpacity: 0.6,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 14,
    transform: [{ scale: 1.06 }],
  },
  poster: { width: M.posterB, height: M.posterH, borderRadius: 10, backgroundColor: C.surface },
  breitBild: { width: M.breitB, height: M.breitH, borderRadius: 10, backgroundColor: C.surface },
  kachelTitel: {
    color: C.text, fontSize: M.kachelTitel, fontWeight: "600",
    marginTop: 6, lineHeight: M.kachelTitel + 3,
  },
  kachelUnter: { color: C.muted, fontSize: M.klein, marginTop: 1 },

  /* ── Abzeichen auf Kacheln ─────────────────────────────────────────── */
  abzeichenNeu: {
    position: "absolute", left: 6, top: 6, backgroundColor: C.red,
    borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2,
  },
  abzeichenNote: {
    position: "absolute", right: 6, top: 6, backgroundColor: "#000000cc",
    borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2,
  },
  abzeichenText: { color: C.weiss, fontSize: gross ? 11 : 9, fontWeight: "800" },
  fortschrittBg: {
    position: "absolute", left: 0, right: 0, bottom: 0, height: 4,
    backgroundColor: "#00000099", borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
  },
  fortschrittFg: { height: 4, backgroundColor: C.red },
  spielPunkt: {
    position: "absolute", right: 8, top: 8, width: gross ? 36 : 30,
    height: gross ? 36 : 30, borderRadius: 18, backgroundColor: "#000000bb",
    alignItems: "center", justifyContent: "center",
  },

  /* ── Reihen ────────────────────────────────────────────────────────── */
  reihenTitel: {
    color: C.text, fontSize: M.reiheTitel, fontWeight: "800",
    paddingHorizontal: M.rand, marginTop: gross ? 26 : 18, marginBottom: gross ? 12 : 8,
  },

  /* ── Text ──────────────────────────────────────────────────────────── */
  h1: { color: C.text, fontSize: M.titel, fontWeight: "900" },
  h2: { color: C.text, fontSize: gross ? 22 : 16, fontWeight: "800" },
  fliess: { color: "#cfcfda", fontSize: gross ? 15 : 12.5, lineHeight: gross ? 23 : 19 },
  gedaempft: { color: C.muted, fontSize: gross ? 14 : 12 },

  /* ── Eingabefelder ─────────────────────────────────────────────────── */
  feld: {
    backgroundColor: C.surface,
    borderWidth: 2,
    borderColor: C.line,
    borderRadius: 10,
    color: C.text,
    paddingHorizontal: 14,
    paddingVertical: gross ? 14 : 11,
    fontSize: gross ? 16 : 14,
  },
  feldFokus: { borderColor: C.weiss, backgroundColor: C.surface2 },

  /* ── Karten / Flächen ──────────────────────────────────────────────── */
  karte: {
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    padding: gross ? 22 : 16,
  },

  /* ── Player ────────────────────────────────────────────────────────── */
  playerWurzel: { flex: 1, backgroundColor: "#000" },
  playerKopf: {
    position: "absolute", top: 0, left: 0, right: 0,
    paddingHorizontal: M.rand, paddingTop: gross ? 30 : 20, paddingBottom: 40,
    flexDirection: "row", alignItems: "flex-start", gap: 14,
  },
  playerFuss: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: M.rand, paddingBottom: gross ? 34 : 22, paddingTop: 60,
  },
  balkenSpur: {
    height: 6, borderRadius: 3, backgroundColor: "#ffffff33", flex: 1,
    overflow: "visible", justifyContent: "center",
  },
  balkenVoll: { height: 6, borderRadius: 3, backgroundColor: C.red, position: "absolute", left: 0 },
  balkenPuffer: { height: 6, borderRadius: 3, backgroundColor: "#ffffff44", position: "absolute", left: 0 },
  balkenGriff: {
    position: "absolute", width: gross ? 20 : 16, height: gross ? 20 : 16,
    borderRadius: 10, backgroundColor: C.weiss, marginLeft: gross ? -10 : -8,
  },
  balkenRahmen: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderWidth: 2, borderColor: "transparent", borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 10,
  },
  playerZeit: { color: C.weiss, fontSize: gross ? 15 : 12, fontVariant: ["tabular-nums"], minWidth: gross ? 74 : 54 },
  playerKnopfReihe: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: gross ? 14 : 10, marginTop: gross ? 16 : 10 },
  rundKnopf: {
    minWidth: gross ? 62 : 50, height: gross ? 62 : 50, borderRadius: 14,
    backgroundColor: "#ffffff1c", alignItems: "center", justifyContent: "center",
    paddingHorizontal: gross ? 16 : 12, borderWidth: 3, borderColor: "transparent",
    flexDirection: "row", gap: 6,
  },
  rundKnopfHaupt: { backgroundColor: C.red },
  rundKnopfText: { color: C.weiss, fontWeight: "800", fontSize: gross ? 17 : 14 },
  playerTitel: { color: C.weiss, fontSize: gross ? 24 : 17, fontWeight: "800" },
  playerUnter: { color: "#c9c9d6", fontSize: gross ? 15 : 12, marginTop: 2 },

  /* ── Dialog ────────────────────────────────────────────────────────── */
  dialogHinter: {
    position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: "#000000d9", alignItems: "center", justifyContent: "center",
    padding: M.rand,
  },
  dialogKasten: {
    backgroundColor: C.bg2, borderRadius: 16, borderWidth: 1, borderColor: C.line,
    padding: gross ? 26 : 18, width: "100%", maxWidth: gross ? 720 : 520, maxHeight: "86%",
  },

  /* ── Sonstiges ─────────────────────────────────────────────────────── */
  marke: { color: C.red, fontWeight: "900", fontSize: gross ? 30 : 22, letterSpacing: 0.5 },
  trenner: { height: 1, backgroundColor: C.line, marginVertical: gross ? 18 : 12 },
  hinweis: {
    backgroundColor: "#e5091422", borderWidth: 1, borderColor: "#e5091455",
    borderRadius: 10, padding: 12,
  },
});
