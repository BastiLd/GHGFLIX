/**
 * ══════════════════════════════════════════════════════════════════════════
 *  FOKUS-KERN — die Auswahl-Logik für die Fernbedienung
 * ══════════════════════════════════════════════════════════════════════════
 *
 * WARUM ES DIESE DATEI GIBT
 *
 * Erster Versuch war, sich auf Androids eigenen View-Fokus zu verlassen und
 * nur die Markierung selbst zu zeichnen. Das ging halb: Knöpfe bekamen einen
 * Rahmen, Poster in den waagerechten Reihen aber nicht, und im Player war
 * kaum in die Bedienleiste hineinzukommen. Der Grund ist, dass Androids
 * Fokus-Suche geometrisch arbeitet und bei überlappenden, teils
 * ausgeblendeten und in Listen recycelten Views unvorhersehbar wird.
 *
 * Deshalb bestimmt die App den Fokus jetzt selbst — genau wie Netflix, Plex
 * und Jellyfin es auf Fernsehern tun. Der Trick: nicht mit Bildschirm-
 * koordinaten rechnen, sondern mit einem LOGISCHEN RASTER. Jedes
 * auswählbare Element sagt, in welchem Bereich, welcher Zeile und welcher
 * Spalte es sitzt. Die Richtungstasten bewegen sich dann durch dieses Raster.
 *
 * Das hat drei handfeste Vorteile:
 *   1. Es ist völlig vorhersehbar — kein „warum springt er jetzt dorthin?“
 *   2. Es ist ohne Gerät testbar (siehe test/fokus.test.mjs), weil überhaupt
 *      kein React und kein Bildschirm nötig ist
 *   3. Es ist schnell: kein Messen von Views bei jedem Tastendruck
 *
 * DAS RASTER
 *
 *   Bereich "nav"     — die Seitenleiste, eine senkrechte Liste
 *   Bereich "inhalt"  — der Hauptteil, Zeilen mit je mehreren Spalten
 *   Bereich "dialog"  — liegt über allem; solange einer offen ist, bekommen
 *                       nav und inhalt keine Tasten
 *
 *   ← am linken Rand des Inhalts   → springt in die Seitenleiste
 *   → in der Seitenleiste          → springt zurück in den Inhalt
 *   ↑ ↓ wechseln die Zeile und behalten die Spalte so gut wie möglich bei
 *
 * Diese Datei kennt weder React noch React Native. Sie ist reine Logik.
 */

/** Reihenfolge der Bereiche von links nach rechts. */
export const BEREICHE = ["nav", "inhalt"];

/**
 * Erzeugt einen Fokus-Kern.
 *
 * @param {object}   [opt]
 * @param {Function} [opt.beiWechsel] wird mit (neu, alt) aufgerufen
 */
export function erzeugeFokusKern(opt = {}) {
  /** Schlüssel -> Eintrag. Schlüssel ist frei wählbar, aber eindeutig. */
  const elemente = new Map();
  let aktiv = null;         // Schlüssel des ausgewählten Elements
  let dialogEbene = 0;      // >0 = ein Dialog liegt oben

  const beiWechsel = opt.beiWechsel || (() => {});

  /* ── Anmelden / Abmelden ─────────────────────────────────────────────── */

  /**
   * @param {string} schluessel eindeutig, z. B. "reihe3:kachel7"
   * @param {object} e
   * @param {string} e.bereich  "nav" | "inhalt" | "dialog"
   * @param {number} e.zeile    Zeilennummer innerhalb des Bereichs
   * @param {number} e.spalte   Spaltennummer innerhalb der Zeile
   * @param {Function} [e.onPress]   bei OK
   * @param {Function} [e.onLang]    bei langem Druck
   * @param {Function} [e.melde]     (an: boolean) => void – zeichnet die Markierung
   * @param {boolean}  [e.zuerst]    bevorzugt beim ersten Fokus eines Bereichs
   * @param {boolean}  [e.uebersprigen] nie automatisch anspringen
   */
  function anmelden(schluessel, e) {
    elemente.set(schluessel, { schluessel, ...e });
    // Noch nichts ausgewählt? Dann übernimmt das erste brauchbare Element.
    if (aktiv == null && !e.uebersprigen && e.bereich !== "dialog") {
      setzen(schluessel);
    }
    // Öffnet sich ein Dialog, wandert der Fokus hinein.
    if (e.bereich === "dialog" && dialogEbene > 0) {
      const jetzt = elemente.get(aktiv);
      if (!jetzt || jetzt.bereich !== "dialog") setzen(schluessel);
    }
  }

  function abmelden(schluessel) {
    const war = aktiv === schluessel;
    elemente.delete(schluessel);
    if (!war) return;
    aktiv = null;
    // Ersatz suchen: möglichst in derselben Zeile, sonst irgendwo sinnvoll.
    const ersatz = naechstesNach(schluessel);
    if (ersatz) setzen(ersatz.schluessel);
    else {
      const irgendwo = [...elemente.values()].find((x) => !x.uebersprigen && istErlaubt(x));
      if (irgendwo) setzen(irgendwo.schluessel);
    }
  }

  /** Wird beim Abmelden gebraucht: das nächstbeste Element in derselben Zeile. */
  function naechstesNach(schluessel) {
    const alt = letzteBekannt.get(schluessel);
    if (!alt) return null;
    const kandidaten = [...elemente.values()]
      .filter((x) => x.bereich === alt.bereich && x.zeile === alt.zeile && !x.uebersprigen)
      .sort((a, b) => Math.abs(a.spalte - alt.spalte) - Math.abs(b.spalte - alt.spalte));
    return kandidaten[0] ?? null;
  }
  /** Merkt sich Position auch nach dem Abmelden, für sauberen Ersatz. */
  const letzteBekannt = new Map();

  /* ── Auswahl setzen ──────────────────────────────────────────────────── */

  function setzen(schluessel) {
    if (schluessel === aktiv) return;
    const alt = aktiv;
    const altE = alt != null ? elemente.get(alt) : null;
    const neuE = elemente.get(schluessel);
    if (!neuE) return;
    aktiv = schluessel;
    letzteBekannt.set(schluessel, { bereich: neuE.bereich, zeile: neuE.zeile, spalte: neuE.spalte });
    // Spalte der Zeile merken, damit ↑↓ die Position hält
    spaltenGedaechtnis.set(neuE.bereich + ":" + neuE.zeile, neuE.spalte);
    altE?.melde?.(false);
    neuE.melde?.(true);
    beiWechsel(neuE, altE);
  }

  const spaltenGedaechtnis = new Map();
  /** Zuletzt benutzte Spalte, damit ↓ und wieder ↑ dieselbe Kachel trifft. */
  let letzteSpalte = 0;

  /* ── Bereichsregeln ──────────────────────────────────────────────────── */

  function istErlaubt(e) {
    if (dialogEbene > 0) return e.bereich === "dialog";
    return e.bereich !== "dialog";
  }

  function alleErlaubten() {
    return [...elemente.values()].filter((x) => istErlaubt(x) && !x.uebersprigen);
  }

  /* ── Bewegung ────────────────────────────────────────────────────────── */

  /**
   * @param {"up"|"down"|"left"|"right"} richtung
   * @returns {boolean} true, wenn sich etwas bewegt hat
   */
  function bewegen(richtung) {
    const jetzt = elemente.get(aktiv);
    if (!jetzt) {
      const erst = alleErlaubten()[0];
      if (erst) { setzen(erst.schluessel); return true; }
      return false;
    }

    /* Manche Elemente wollen die Richtungstasten selbst haben — allen voran
       der Fortschrittsbalken im Player, bei dem ← und → im Video springen
       statt den Fokus zu verschieben. Gibt aufRichtung true zurück, ist die
       Taste verbraucht und der Fokus bleibt, wo er ist. */
    if (jetzt.aufRichtung?.(richtung) === true) return true;

    const feld = alleErlaubten();

    if (richtung === "left" || richtung === "right") {
      const schritt = richtung === "right" ? 1 : -1;
      // 1) Innerhalb derselben Zeile weiter
      const inZeile = feld
        .filter((x) => x.bereich === jetzt.bereich && x.zeile === jetzt.zeile)
        .sort((a, b) => a.spalte - b.spalte);
      const i = inZeile.findIndex((x) => x.schluessel === jetzt.schluessel);
      const ziel = inZeile[i + schritt];
      if (ziel) { letzteSpalte = ziel.spalte; setzen(ziel.schluessel); return true; }

      // 2) Am linken Rand des Inhalts: in die Seitenleiste
      if (richtung === "left" && jetzt.bereich === "inhalt") {
        const nav = feld.filter((x) => x.bereich === "nav");
        if (nav.length) {
          const ausgewaehlt = nav.find((x) => x.aktivMarkiert) ?? nav[navMerker(nav)];
          setzen((ausgewaehlt ?? nav[0]).schluessel);
          return true;
        }
      }
      // 3) Aus der Seitenleiste zurück in den Inhalt
      if (richtung === "right" && jetzt.bereich === "nav") {
        const inhalt = feld.filter((x) => x.bereich === "inhalt");
        if (inhalt.length) {
          const zeile = Math.min(...inhalt.map((x) => x.zeile));
          const kandidaten = inhalt.filter((x) => x.zeile === zeile).sort((a, b) => a.spalte - b.spalte);
          setzen(kandidaten[0].schluessel);
          return true;
        }
      }
      return false;
    }

    // ↑ / ↓ : Zeile wechseln, Spalte möglichst halten
    const schritt = richtung === "down" ? 1 : -1;
    const zeilen = [...new Set(feld.filter((x) => x.bereich === jetzt.bereich).map((x) => x.zeile))]
      .sort((a, b) => a - b);
    const zi = zeilen.indexOf(jetzt.zeile);
    const zielZeile = zeilen[zi + schritt];
    if (zielZeile == null) return false;

    const inZielZeile = feld
      .filter((x) => x.bereich === jetzt.bereich && x.zeile === zielZeile)
      .sort((a, b) => a.spalte - b.spalte);
    if (!inZielZeile.length) return false;

    // Wunschspalte: die zuletzt in dieser Zeile benutzte, sonst die aktuelle
    const gemerkt = spaltenGedaechtnis.get(jetzt.bereich + ":" + zielZeile);
    const wunsch = gemerkt != null ? gemerkt : jetzt.spalte;
    const ziel = inZielZeile.reduce((best, x) =>
      Math.abs(x.spalte - wunsch) < Math.abs(best.spalte - wunsch) ? x : best,
    inZielZeile[0]);
    setzen(ziel.schluessel);
    return true;
  }

  /** In der Seitenleiste: bevorzugt den Eintrag der aktuellen Seite. */
  let navMerkerIndex = 0;
  function navMerker(nav) {
    return Math.max(0, Math.min(navMerkerIndex, nav.length - 1));
  }
  function merkeNav(index) { navMerkerIndex = index; }

  /* ── Auslösen ────────────────────────────────────────────────────────── */

  function ausloesen() {
    const e = elemente.get(aktiv);
    if (!e) return false;
    e.onPress?.();
    return true;
  }

  function langDruecken() {
    const e = elemente.get(aktiv);
    if (!e?.onLang) return false;
    e.onLang();
    return true;
  }

  /* ── Dialoge ─────────────────────────────────────────────────────────── */

  function dialogAuf() {
    dialogEbene += 1;
    vorDialog.push(aktiv);
    const erst = [...elemente.values()].find((x) => x.bereich === "dialog");
    if (erst) setzen(erst.schluessel);
  }
  function dialogZu() {
    dialogEbene = Math.max(0, dialogEbene - 1);
    const zurueck = vorDialog.pop();
    if (zurueck && elemente.has(zurueck)) setzen(zurueck);
    else {
      const erst = alleErlaubten()[0];
      if (erst) setzen(erst.schluessel);
    }
  }
  const vorDialog = [];

  /* ── Nach außen ──────────────────────────────────────────────────────── */

  return {
    anmelden, abmelden, setzen, bewegen, ausloesen, langDruecken,
    dialogAuf, dialogZu, merkeNav,
    get aktiv() { return aktiv; },
    get aktivesElement() { return elemente.get(aktiv) ?? null; },
    get anzahl() { return elemente.size; },
    get imDialog() { return dialogEbene > 0; },
    /** nur für Tests */
    _alle: () => [...elemente.values()],
  };
}
