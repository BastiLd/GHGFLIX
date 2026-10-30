/**
 * ══════════════════════════════════════════════════════════════════════════
 *  FOKUS — die React-Schicht über dem Fokus-Kern
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Der Kern (fokus-kern.js) entscheidet, WAS ausgewählt ist. Diese Datei
 * verbindet ihn mit React Native: sie nimmt die Fernbedienungstasten
 * entgegen, zeichnet die Markierung und scrollt das Gewählte ins Bild.
 *
 * ── WIE DIE TASTEN HEREINKOMMEN ───────────────────────────────────────────
 * React Native meldet Fernbedienungstasten als geräteweites Ereignis
 * "onHWKeyEvent" (ReactAndroidHWInputDeviceHelper.java). Ausgelöst wird es in
 * ReactRootView.dispatchKeyEvent — und diese Methode läuft nur an, wenn
 * Android IRGENDWO im Baum einen Fokus hat. Liegt gar kein Fokus, gehen die
 * Tasten an der App vorbei.
 *
 * Deshalb gibt es den ANKER: ein unsichtbares Textfeld, das den Android-Fokus
 * dauerhaft festhält. Zwei Dinge werden damit auf einmal erreicht:
 *
 *   1. Die Tasten kommen zuverlässig an, weil immer etwas fokussiert ist.
 *   2. Alle Knöpfe und Kacheln können focusable={false} sein. Damit hört
 *      Androids eigene Fokus-Suche auf, eigenmächtig herumzuspringen und
 *      Listen zu verschieben — die App bestimmt die Auswahl allein.
 *
 * Punkt 2 war der eigentliche Fehler der Vorversion: Androids Fokus-Suche
 * arbeitet geometrisch und wird bei recycelten Listen-Kacheln unberechenbar.
 * Poster bekamen deshalb keine Markierung, obwohl Knöpfe funktionierten.
 *
 * Nebeneffekt, der wichtig ist: Weil nichts sonst fokussierbar ist, löst
 * Android bei OK auch keinen zweiten Klick aus — es gibt keine doppelte
 * Auslösung. Fingertipp am Handy funktioniert unverändert, denn
 * focusable={false} betrifft nur das Steuerkreuz, nicht Berührungen.
 *
 * ── FALLS DER ANKER NICHT GREIFT ──────────────────────────────────────────
 * Sollte das Festhalten auf einem Gerät nicht klappen, verhält sich die App
 * wie zuvor: Android hält den Fokus irgendwo, die Tasten kommen trotzdem an,
 * und die Auswahl-Logik läuft unverändert. Es wird also in keinem Fall
 * schlechter als vorher.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { BackHandler, DeviceEventEmitter, Platform, Pressable, TextInput, View } from "react-native";
import { erzeugeFokusKern } from "./fokus-kern.js";
import { erzeugeTastenSteuerung } from "./fernbedienung.js";

const Ctx = createContext(null);
const OverlayCtx = createContext(null);
/** Zeilennummer wird von <FokusReihe> an die Kinder durchgereicht. */
const ReiheCtx = createContext({ bereich: "inhalt", zeile: 0, scrollZuSpalte: null });

export const useFokusSystem = () => useContext(Ctx);

let laufendeNummer = 0;
const neuerSchluessel = (p) => `${p}#${++laufendeNummer}`;

/* ════════════════════════════════════════════════════════════════════════ */

export function FokusProvider({ children, aktiv = true }) {
  const [overlay, setOverlay] = useState(null);
  const kernRef = useRef(null);
  const ankerRef = useRef(null);
  const scrollRef = useRef(null);          // senkrechte Liste des Bildschirms
  const zeilenY = useRef(new Map());       // Zeile -> y-Position
  const sichtHoehe = useRef(0);
  const scrollY = useRef(0);
  const tastenVorher = useMemo(() => new Set(), []);

  if (!kernRef.current) {
    kernRef.current = erzeugeFokusKern({
      beiWechsel: (neu) => {
        if (!neu) return;
        // waagerecht: die Reihe zur Spalte schieben
        neu.scrollZuSpalte?.(neu.spalte);
        // senkrecht: die Zeile in die Bildmitte holen
        if (neu.sichtbarMachen) neu.sichtbarMachen();
        else if (neu.bereich === "inhalt") {
          const y = zeilenY.current.get(neu.zeile);
          if (y != null && scrollRef.current) {
            const ziel = Math.max(0, y - Math.max(120, sichtHoehe.current * 0.28));
            scrollRef.current.scrollTo?.({ y: ziel, animated: true });
          }
        }
      },
    });
  }
  const kern = kernRef.current;

  /* ── Anker: hält den Android-Fokus fest ───────────────────────────────── */
  const ankerHolen = useCallback(() => {
    if (!aktiv || Platform.OS !== "android") return;
    try { ankerRef.current?.focus?.(); } catch {}
  }, [aktiv]);
  useEffect(() => {
    const t = setTimeout(ankerHolen, 350); // nach dem ersten Zeichnen
    return () => clearTimeout(t);
  }, [ankerHolen]);

  /* ── Tasten entgegennehmen ───────────────────────────────────────────── */
  useEffect(() => {
    if (!aktiv) return;
    let ab;
    try {
      const taste = erzeugeTastenSteuerung({
        bewegen: (r) => [...tastenVorher].some((fn) => fn(r) === true) || kern.bewegen(r),
        ausloesen: () => [...tastenVorher].some((fn) => fn("select") === true) || kern.ausloesen(),
        langDruecken: () => kern.langDruecken(),
        weiter: (art) => tastenHoerer.forEach((fn) => { try { fn(art); } catch {} }),
      });
      ab = DeviceEventEmitter.addListener("onHWKeyEvent", taste);
    } catch { /* iOS kennt das Ereignis nicht */ }
    return () => ab?.remove?.();
  }, [aktiv, kern]);

  /* ── Zusätzliche Tastenabonnenten (Player) ───────────────────────────── */
  const tastenHoerer = useMemo(() => new Set(), []);

  const wert = useMemo(() => ({
    kern, tastenHoerer, tastenVorher, ankerHolen, aktiv,
    setzeScrollRef: (r) => { if (scrollRef.current !== r) scrollY.current = 0; scrollRef.current = r; },
    merkeScrollY: (y) => { scrollY.current = y; },
    sichtbarMachen: (ref) => {
      const liste = scrollRef.current;
      if (!liste || !ref?.measureInWindow) return;
      requestAnimationFrame(() => {
        ref.measureInWindow((_x, y, _w, h) => {
          liste.measureInWindow?.((_sx, sy, _sw, sh) => {
            const rand = 64;
            if (h > sh - rand * 2 || y < sy + rand || y + h > sy + sh - rand) {
              const ziel = Math.max(0, scrollY.current + y - sy - rand);
              liste.scrollTo?.({ y: ziel, animated: true });
            }
          });
        });
      });
    },
    merkeZeileY: (zeile, y) => zeilenY.current.set(zeile, y),
    merkeSichtHoehe: (h) => { sichtHoehe.current = h; },
  }), [kern, tastenHoerer, ankerHolen, aktiv]);

  return (
    <OverlayCtx.Provider value={setOverlay}><Ctx.Provider value={wert}>
      {children}
      {overlay}
      {/* Der Anker. 1×1 Pixel, unsichtbar, ohne Bildschirmtastatur.
          Muss eine echte Größe haben — Android vergibt an 0×0-Views
          keinen Fokus (PFLAG_HAS_BOUNDS). */}
      {aktiv && Platform.OS === "android" && <TextInput
        ref={ankerRef}
        style={{ position: "absolute", left: -2, top: -2, width: 1, height: 1, opacity: 0 }}
        showSoftInputOnFocus={false}
        caretHidden
        blurOnSubmit={false}
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      />}
    </Ctx.Provider></OverlayCtx.Provider>
  );
}

/** Dialoge liegen über der App, unabhängig von der Länge einer Scroll-Seite. */
export function FokusOverlay({ children }) {
  const setzen = useContext(OverlayCtx);
  useEffect(() => {
    setzen?.(children);
    return () => setzen?.(null);
  }, [setzen, children]);
  return setzen ? null : children;
}

/* ════════════════════════════════════════════════════════════════════════ */

/**
 * Meldet ein Element beim Kern an und sagt, ob es ausgewählt ist.
 *
 * @returns {boolean} ausgewählt
 */
export function useFokusElement({
  bereich, zeile, spalte = 0, onPress, onLang, onFokus, uebersprigen, scrollZuSpalte, id, aufRichtung,
}) {
  const sys = useFokusSystem();
  const reihe = useContext(ReiheCtx);
  const [an, setAn] = useState(false);
  const schluesselRef = useRef(null);
  if (!schluesselRef.current) schluesselRef.current = id ?? neuerSchluessel("e");

  const b = bereich ?? reihe.bereich;
  const z = zeile ?? reihe.zeile;
  const scroll = scrollZuSpalte ?? reihe.scrollZuSpalte;

  // Immer die frischesten Rückrufe verwenden, ohne neu anzumelden
  const halt = useRef({ onPress, onLang, aufRichtung, onFokus });
  halt.current = { onPress, onLang, aufRichtung, onFokus };
  const hatRichtung = !!aufRichtung;

  useEffect(() => {
    if (!sys || !sys.aktiv) return;
    const s = schluesselRef.current;
    sys.kern.anmelden(s, {
      bereich: b, zeile: z, spalte, uebersprigen,
      scrollZuSpalte: (s) => halt.current.scroll?.(s),
      sichtbarMachen: () => halt.current.sichtbarMachen?.(),
      onPress: () => halt.current.onPress?.(),
      onLang: () => { if (!halt.current.onLang) return false; halt.current.onLang(); return true; },
      aufRichtung: (r) => halt.current.aufRichtung?.(r),
      melde: (wert) => { setAn(wert); if (wert) halt.current.onFokus?.(); },
    });
    return () => { sys.kern.abmelden(s); };
  }, [sys]);
  halt.current.scroll = scroll;
  halt.current.sichtbarMachen = reihe.sichtbarMachen;
  useEffect(() => {
    sys?.kern.aktualisieren(schluesselRef.current, { bereich: b, zeile: z, spalte, uebersprigen });
  }, [sys, b, z, spalte, uebersprigen]);

  return an;
}

/* ════════════════════════════════════════════════════════════════════════ */

/**
 * Auswählbarer Knopf. Ersetzt Pressable überall dort, wo mit der
 * Fernbedienung hin navigiert werden können soll.
 *
 * focusable={false} ist Absicht — siehe Erklärung oben im Dateikopf.
 */
export function FKnopf({
  style, fokusStil, children, onPress, onLang, onFokus, aufRichtung,
  bereich, zeile, spalte, uebersprigen, scrollZuSpalte, id, disabled, ...rest
}) {
  const an = useFokusElement({
    bereich, zeile, spalte, onPress, onLang, onFokus, aufRichtung, uebersprigen: uebersprigen || disabled, scrollZuSpalte, id,
  });
  const basis = typeof style === "function" ? style({ pressed: false }) : style;
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected: an }}
      testID={an ? "tv-focus" : undefined}
      focusable={false}
      onPress={onPress}
      onLongPress={onLang}
      style={[basis, an && fokusStil]}
    >
      {typeof children === "function" ? children({ fokus: an }) : children}
    </Pressable>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */

/**
 * Eine waagerechte Reihe. Gibt ihren Zeilenindex an die Kinder weiter und
 * kümmert sich darum, dass die gewählte Kachel ins Bild gescrollt wird.
 */
export function FokusReihe({ zeile, bereich = "inhalt", listeRef, children, onLayoutY }) {
  const sys = useFokusSystem();
  const ref = useRef(null);

  const scrollZuSpalte = useCallback((spalte) => {
    const l = listeRef?.current;
    if (!l?.scrollToIndex) return;
    try {
      l.scrollToIndex({ index: spalte, animated: true, viewPosition: 0.5 });
    } catch {
      // scrollToIndex wirft, solange die Kachel noch nicht ausgemessen ist
      try { l.scrollToOffset?.({ offset: Math.max(0, spalte * 130 - 200), animated: true }); } catch {}
    }
  }, [listeRef]);

  const sichtbarMachen = useCallback(() => sys?.sichtbarMachen?.(ref.current), [sys]);
  const wert = useMemo(() => ({ bereich, zeile, scrollZuSpalte, sichtbarMachen }), [bereich, zeile, scrollZuSpalte, sichtbarMachen]);

  return (
    <ReiheCtx.Provider value={wert}>
      <View
        ref={ref}
        collapsable={false}
        onLayout={(e) => {
          const y = e.nativeEvent.layout.y;
          sys?.merkeZeileY?.(zeile, y);
          onLayoutY?.(y);
        }}
      >
        {children}
      </View>
    </ReiheCtx.Provider>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */

/** Fernbedienungstasten abonnieren, die der Fokus nicht selbst verbraucht. */
export function useFernbedienung(fn) {
  const sys = useFokusSystem();
  const halt = useRef(fn);
  halt.current = fn;
  useEffect(() => {
    if (!sys) return;
    const weiter = (art) => halt.current?.(art);
    sys.tastenHoerer.add(weiter);
    return () => { sys.tastenHoerer.delete(weiter); };
  }, [sys]);
}

/** Player darf verborgene Bedienelemente wecken, bevor der Fokus navigiert. */
export function useFernbedienungVorher(fn) {
  const sys = useFokusSystem();
  const halt = useRef(fn); halt.current = fn;
  useEffect(() => {
    if (!sys) return;
    const vorher = (taste) => halt.current(taste);
    sys.tastenVorher.add(vorher);
    return () => sys.tastenVorher.delete(vorher);
  }, [sys]);
}

/** Dialog an- und abmelden, damit er die Tasten für sich behält. */
export function useDialog(offen, schliessen) {
  const sys = useFokusSystem();
  const halt = useRef(schliessen);
  halt.current = schliessen;
  useEffect(() => {
    if (!sys || !offen) return;
    sys.kern.dialogAuf();
    const back = BackHandler.addEventListener("hardwareBackPress", () => { halt.current?.(); return true; });
    return () => { back.remove(); sys.kern.dialogZu(); };
  }, [sys, offen]);
}
