/**
 * Die Seiten der App — dieselben wie in der Desktop-Fassung.
 *
 *   Start          Kopfbild + Reihen (Weiterschauen, Neu, Meine Liste, …)
 *   Filme/Serien   Raster über die ganze Sammlung
 *   Meine Liste    Favoriten
 *   Suche          Eingabe + Treffer
 *   Einstellungen  Server, Profil, Bildgröße, Info
 *   Detailseiten   Serie (mit Staffeln und Folgen) und Film
 *
 * Alles ist mit der Fernbedienung bedienbar: jede Reihe bekommt eine
 * Zeilennummer, jede Kachel eine Spaltennummer, und der Fokus-Kern führt
 * daran entlang. Zeilennummern werden fortlaufend vergeben — deshalb steht
 * bei den Startseiten-Reihen `zeile={z++}` statt einer festen Zahl: Reihen,
 * die gerade leer sind (z. B. „Weiterschauen“ bei einem frischen Profil),
 * werden gar nicht gezeichnet und dürfen dann auch keine Zeile verbrauchen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, ScrollView, Text, View } from "react-native";
import { FKnopf, FokusReihe, useDialog, useFokusSystem } from "./fokus.js";
import {
  BackdropKopf, BreitReihe, Dialog, DialogListe, FFeld, Hero, Knopf, Laden,
  PosterReihe, Verlauf, fmtZeit, parseGenres, se,
} from "./bausteine.js";
import { C, M, gross, st } from "./stile.js";
import { FELDER, laden as ladeEinstellungen, sichern as sichereEinstellungen } from "./einstellungen.js";

/* ══ Hilfen ══════════════════════════════════════════════════════════════ */

/** Wie viele Kacheln passen nebeneinander ins Raster? */
const spaltenZahl = (breite) =>
  Math.max(2, Math.floor((breite - M.rand * 2 + M.luecke) / (M.posterB + 8 + M.luecke)));

/** Eine ScrollView, die dem Fokus-System ihre Bewegung meldet. */
function Seite({ children, aufScrollRef }) {
  const sys = useFokusSystem();
  const ref = useRef(null);
  return (
    <ScrollView
      ref={(r) => {
        ref.current = r;
        sys?.setzeScrollRef?.(r);
        aufScrollRef?.(r);
      }}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: gross ? 70 : 44 }}
      onLayout={(e) => sys?.merkeSichtHoehe?.(e.nativeEvent.layout.height)}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/* ══ Startseite ══════════════════════════════════════════════════════════ */

export function StartSeite({ lib, weiter, verlauf, favoriten, img, aufTitel, aufAbspielen }) {
  const [heroNr, setHeroNr] = useState(0);

  const alle = useMemo(() => [
    ...(lib?.shows || []).map((x) => ({ ...x, _t: "show" })),
    ...(lib?.movies || []).map((x) => ({ ...x, _t: "movie" })),
  ], [lib]);

  const heroListe = useMemo(
    () => alle.filter((x) => x.backdrop).sort((a, b) => (b.added_at || 0) - (a.added_at || 0)).slice(0, 8),
    [alle],
  );
  useEffect(() => {
    if (heroListe.length < 2) return;
    const t = setInterval(() => setHeroNr((n) => n + 1), 14000);
    return () => clearInterval(t);
  }, [heroListe.length]);
  const hero = heroListe[heroNr % (heroListe.length || 1)];

  const neu = useMemo(
    () => [...alle].sort((a, b) => (b.added_at || 0) - (a.added_at || 0)).slice(0, 20),
    [alle],
  );
  const top = useMemo(
    () => alle.filter((x) => (x.rating || 0) >= 7).sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 20),
    [alle],
  );
  const meine = useMemo(() => {
    if (!lib) return [];
    return (favoriten || []).map((f) =>
      f.mediaType === "show"
        ? { ...((lib.shows || []).find((s) => s.id === f.refId) || {}), _t: "show" }
        : { ...((lib.movies || []).find((m) => m.id === f.refId) || {}), _t: "movie" },
    ).filter((x) => x.id);
  }, [favoriten, lib]);

  const genreReihen = useMemo(() => {
    const zaehler = new Map();
    for (const x of alle) for (const g of parseGenres(x.genres)) zaehler.set(g, (zaehler.get(g) || 0) + 1);
    return [...zaehler.entries()]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([g]) => ({ genre: g, items: alle.filter((x) => parseGenres(x.genres).includes(g)).slice(0, 20) }));
  }, [alle]);

  if (!lib) return <Laden text="Bibliothek wird geladen …" />;
  if (!alle.length) return <LeerHinweis />;

  // Zeilennummern fortlaufend vergeben (siehe Erklärung im Dateikopf)
  let z = 0;
  const R = ({ titel, items, breit, ohneFortschritt, aufDruck }) => {
    if (!items?.length) return null;
    const zeile = z++;
    return (
      <>
        <Text style={st.reihenTitel}>{titel}</Text>
        {breit
          ? <BreitReihe zeile={zeile} items={items} img={img} onPress={aufDruck} ohneFortschritt={ohneFortschritt} />
          : <PosterReihe zeile={zeile} items={items} img={img} onPress={aufDruck} />}
      </>
    );
  };

  const heroZeile = hero ? z++ : -99;

  return (
    <Seite>
      {hero && (
        <Hero
          x={hero}
          img={img}
          zeile={heroZeile}
          aufAnsehen={() => aufAbspielen(hero)}
          aufInfos={() => aufTitel(hero)}
        />
      )}
      <R titel="Weiterschauen" items={weiter} breit aufDruck={aufAbspielen} />
      <R titel="Neu hinzugefügt" items={neu} aufDruck={aufTitel} />
      <R titel="Meine Liste" items={meine} aufDruck={aufTitel} />
      <R titel="Serien" items={(lib.shows || []).map((x) => ({ ...x, _t: "show" }))} aufDruck={aufTitel} />
      <R titel="Filme" items={(lib.movies || []).map((x) => ({ ...x, _t: "movie" }))} aufDruck={aufTitel} />
      <R titel="Top bewertet" items={top} aufDruck={aufTitel} />
      <R titel="Zuletzt gesehen" items={verlauf} breit ohneFortschritt aufDruck={aufAbspielen} />
      {genreReihen.map((g) => (
        <R key={g.genre} titel={g.genre} items={g.items} aufDruck={aufTitel} />
      ))}
    </Seite>
  );
}

function LeerHinweis() {
  return (
    <View style={[st.center, { padding: M.rand }]}>
      <Text style={[st.h2, { marginBottom: 10, textAlign: "center" }]}>Noch nichts da</Text>
      <Text style={[st.gedaempft, { textAlign: "center" }]}>
        Die Bibliothek ist leer. Starte am Server oder in der Desktop-App{"\n"}
        einen Suchlauf, damit die Filme und Serien eingelesen werden.
      </Text>
    </View>
  );
}

/* ══ Raster-Seite (Filme / Serien / Meine Liste) ═════════════════════════ */

export function RasterSeite({ titel, items, img, aufTitel, leerText }) {
  const [breite, setBreite] = useState(0);
  const spalten = spaltenZahl(breite || 1280);

  if (!items) return <Laden />;

  return (
    <Seite>
      <View onLayout={(e) => setBreite(e.nativeEvent.layout.width)}>
        <View style={{ paddingHorizontal: M.rand, paddingTop: gross ? 34 : 22, paddingBottom: 4 }}>
          <Text style={st.h1}>{titel}</Text>
          <Text style={st.gedaempft}>
            {items.length} {items.length === 1 ? "Eintrag" : "Einträge"}
          </Text>
        </View>

        {items.length === 0 ? (
          <View style={{ padding: M.rand * 2, alignItems: "center" }}>
            <Text style={[st.gedaempft, { textAlign: "center" }]}>{leerText || "Nichts vorhanden."}</Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: M.rand - 4, paddingTop: 10 }}>
            {/* Zeilenweise aufteilen, damit der Fokus ein sauberes Raster hat */}
            {Array.from({ length: Math.ceil(items.length / spalten) }, (_, r) => (
              <FokusReihe key={r} zeile={r}>
                <View style={{ flexDirection: "row", gap: M.luecke - 4, marginBottom: M.luecke - 4 }}>
                  {items.slice(r * spalten, r * spalten + spalten).map((x, i) => (
                    <RasterKachel key={x.id ?? i} x={x} img={img} spalte={i} onPress={aufTitel} />
                  ))}
                </View>
              </FokusReihe>
            ))}
          </View>
        )}
      </View>
    </Seite>
  );
}

function RasterKachel({ x, img, spalte, onPress }) {
  const note = Number(x.rating) || 0;
  return (
    <FKnopf
      spalte={spalte}
      onPress={() => onPress(x)}
      style={[st.kachel, { width: M.posterB + 8 }]}
      fokusStil={st.kachelFokus}
    >
      <View>
        {x.poster ? (
          <Image source={{ uri: img(x.poster, "w500") }} style={st.poster} />
        ) : (
          <View style={[st.poster, st.center, { padding: 8 }]}>
            <Text numberOfLines={5} style={{ color: C.muted, fontSize: M.klein, textAlign: "center" }}>
              {x.title}
            </Text>
          </View>
        )}
        {note > 0 && (
          <View style={st.abzeichenNote}>
            <Text style={st.abzeichenText}>★ {note.toFixed(1)}</Text>
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={st.kachelTitel}>{x.title}</Text>
      <Text numberOfLines={1} style={st.kachelUnter}>
        {x.seasons ? `${x.seasons} Staffel${x.seasons > 1 ? "n" : ""}` : x.year ? String(x.year) : " "}
      </Text>
    </FKnopf>
  );
}

/* ══ Suche ═══════════════════════════════════════════════════════════════ */

export function SuchSeite({ lib, img, aufTitel }) {
  const [q, setQ] = useState("");
  const [breite, setBreite] = useState(0);
  const spalten = spaltenZahl(breite || 1280);

  const treffer = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const passt = (x) => (x.title || "").toLowerCase().includes(s);
    return [
      ...(lib?.shows || []).filter(passt).map((x) => ({ ...x, _t: "show" })),
      ...(lib?.movies || []).filter(passt).map((x) => ({ ...x, _t: "movie" })),
    ];
  }, [q, lib]);

  return (
    <Seite>
      <View onLayout={(e) => setBreite(e.nativeEvent.layout.width)}>
        <View style={{ paddingHorizontal: M.rand, paddingTop: gross ? 34 : 22 }}>
          <Text style={[st.h1, { marginBottom: 12 }]}>Suche</Text>
          <FokusReihe zeile={0}>
            <FFeld
              spalte={0}
              wert={q}
              aufWert={setQ}
              platzhalter="Titel eingeben …"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </FokusReihe>
          <Text style={[st.gedaempft, { marginTop: 8 }]}>
            {q.trim()
              ? `${treffer.length} ${treffer.length === 1 ? "Treffer" : "Treffer"}`
              : "Am Fernseher: Feld auswählen und OK drücken, dann erscheint die Tastatur."}
          </Text>
        </View>

        <View style={{ paddingHorizontal: M.rand - 4, paddingTop: 14 }}>
          {Array.from({ length: Math.ceil(treffer.length / spalten) }, (_, r) => (
            <FokusReihe key={r} zeile={r + 1}>
              <View style={{ flexDirection: "row", gap: M.luecke - 4, marginBottom: M.luecke - 4 }}>
                {treffer.slice(r * spalten, r * spalten + spalten).map((x, i) => (
                  <RasterKachel key={`${x._t}${x.id}`} x={x} img={img} spalte={i} onPress={aufTitel} />
                ))}
              </View>
            </FokusReihe>
          ))}
        </View>
      </View>
    </Seite>
  );
}

/* ══ Detailseite Serie ═══════════════════════════════════════════════════ */

export function SerienSeite({ api, img, id, startStaffel, aufAbspielen, aufZurueck }) {
  const [daten, setDaten] = useState(null);
  const [fortschritt, setFortschritt] = useState([]);
  const [favorit, setFavorit] = useState(false);
  const [staffel, setStaffel] = useState(startStaffel ?? null);
  const [dialog, setDialog] = useState(false);
  /* Punkt 3: "Filme" ist ein eigener Bereich NEBEN den Staffeln — kein
     Staffelwert, sonst müsste jede Rechnung auf `staffel` plötzlich auch
     Nicht-Zahlen vertragen. */
  const [filmeAn, setFilmeAn] = useState(false);

  const laden = useCallback(() => {
    api(`/api/shows/${id}`).then(setDaten).catch(() => {});
    api("/api/progress").then((p) => setFortschritt(Array.isArray(p) ? p : [])).catch(() => {});
    api("/api/favorites")
      .then((f) => setFavorit(!!(Array.isArray(f) && f.find((x) => x.mediaType === "show" && x.refId === +id))))
      .catch(() => {});
  }, [api, id]);
  useEffect(laden, [laden]);

  useDialog(dialog);

  const fMap = useMemo(
    () => new Map(fortschritt.filter((x) => x.mediaType === "episode").map((x) => [x.refId, x])),
    [fortschritt],
  );

  if (!daten) return <Laden />;
  const { show, seasons } = daten;
  const filme = daten.movies ?? [];
  const hatSpecials = seasons.some((s) => s.season === 0);
  // Specials (Staffel 0) sind keine eigene Staffel — sie bekommen einen
  // eigenen Reiter und dürfen die Staffelzahl nicht mitzählen.
  const echteStaffeln = seasons.filter((s) => s.season > 0);
  const aktuelle =
    staffel != null && seasons.some((s) => s.season === staffel)
      ? staffel
      : (seasons.find((s) => s.season > 0) ?? seasons[0])?.season;
  const folgen = seasons.find((s) => s.season === aktuelle)?.episodes ?? [];
  const alleFolgen = seasons.flatMap((s) => s.episodes);
  const naechste = alleFolgen.find((e) => !fMap.get(e.id)?.watched) ?? alleFolgen[0];

  const naechsteNach = (epId) => {
    const i = alleFolgen.findIndex((e) => e.id === epId);
    const n = alleFolgen[i + 1];
    return n ? { id: n.id, se: se(n.season, n.episode), title: n.title } : null;
  };
  const spiele = (e) =>
    aufAbspielen({
      type: "episode", id: e.id, title: show.title,
      subtitle: `${se(e.season, e.episode)}${e.title ? " · " + e.title : ""}`,
      nextEp: naechsteNach(e.id),
    });

  const favUm = () =>
    api("/api/favorites", { method: "POST", body: { mediaType: "show", refId: +id } })
      .then((r) => setFavorit(!!r.favorite))
      .catch(() => {});
  const gesehenUm = (e, wert) =>
    api("/api/watched", { method: "POST", body: { mediaType: "episode", refId: e.id, watched: wert } })
      .then(() => api("/api/progress").then(setFortschritt))
      .catch(() => {});

  return (
    <Seite>
      <BackdropKopf uri={show.backdrop ? img(show.backdrop, "w1280") : null} />

      <View style={{ paddingHorizontal: M.rand, marginTop: -10 }}>
        <Text style={st.h1}>{show.title}</Text>
        <Text style={[st.gedaempft, { marginTop: 4, marginBottom: 10 }]}>
          {[
            show.year,
            show.rating ? `★ ${Number(show.rating).toFixed(1)}` : null,
            `${echteStaffeln.length} Staffel${echteStaffeln.length > 1 ? "n" : ""}`,
            `${alleFolgen.length} Folgen`,
            ...parseGenres(show.genres).slice(0, 3),
          ].filter(Boolean).join("   ·   ")}
        </Text>
        {!!show.overview && (
          <Text style={[st.fliess, { marginBottom: 16, maxWidth: gross ? 900 : undefined }]}>
            {show.overview}
          </Text>
        )}

        <FokusReihe zeile={0}>
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            {!!naechste && (
              <Knopf
                text={`Weiter mit ${se(naechste.season, naechste.episode)}`}
                symbol="▶" haupt spalte={0}
                onPress={() => spiele(naechste)}
              />
            )}
            <Knopf
              text={favorit ? "In meiner Liste" : "Zu meiner Liste"}
              symbol={favorit ? "♥" : "♡"}
              spalte={1}
              onPress={favUm}
            />
            {echteStaffeln.length > 1 && (
              <Knopf
                text={filmeAn || aktuelle === 0 ? "Staffeln" : `Staffel ${aktuelle}`}
                symbol="▾" spalte={2}
                onPress={() => setDialog(true)}
              />
            )}
            {/* Punkt 3: Specials und Filme als eigene Reiter */}
            {hatSpecials && (
              <Knopf
                text="Specials"
                symbol="★" spalte={3}
                onPress={() => { setFilmeAn(false); setStaffel(0); }}
              />
            )}
            {filme.length > 0 && (
              <Knopf
                text={`Filme (${filme.length})`}
                symbol="▣" spalte={4}
                onPress={() => setFilmeAn(true)}
              />
            )}
            {/* Feste Spaltennummern mit Lücken — das Fokus-System kommt damit
                zurecht (bei nur einer Staffel fehlt Spalte 2 schon immer). */}
            <Knopf text="Zurück" symbol="←" spalte={5} onPress={aufZurueck} />
          </View>
        </FokusReihe>

        <Text style={[st.h2, { marginTop: gross ? 30 : 22, marginBottom: 10 }]}>
          {filmeAn
            ? `Filme zu dieser Serie · ${filme.length}`
            : aktuelle === 0
              ? `Specials · ${folgen.length} Folgen`
              : `Staffel ${aktuelle} · ${folgen.length} Folgen`}
        </Text>
      </View>

      {/* Reiter „Filme": Kinofilme dieser Serie (Punkt 3) */}
      {filmeAn && (
        <View style={{ paddingHorizontal: M.rand }}>
          {filme.map((mv, i) => (
            <FokusReihe key={mv.id} zeile={i + 1}>
              <FKnopf
                spalte={0}
                onPress={() => aufAbspielen({ type: "movie", id: mv.id, title: mv.title, subtitle: "" })}
                style={[
                  st.kachel,
                  { flexDirection: "row", gap: 14, padding: 8, marginBottom: 8, alignItems: "center" },
                ]}
                fokusStil={st.fokus}
              >
                {mv.poster ? (
                  <Image
                    source={{ uri: img(mv.poster, "w300") }}
                    style={{ width: gross ? 100 : 70, height: gross ? 150 : 105, borderRadius: 8, backgroundColor: C.surface }}
                  />
                ) : (
                  <View style={{ width: gross ? 100 : 70, height: gross ? 150 : 105, borderRadius: 8, backgroundColor: C.surface }} />
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: C.text, fontWeight: "700", fontSize: gross ? 17 : 13.5 }}>
                    {mv.title}
                    {mv.year ? `  (${mv.year})` : ""}
                  </Text>
                  {!!mv.overview && (
                    <Text numberOfLines={3} style={[st.gedaempft, { marginTop: 3 }]}>{mv.overview}</Text>
                  )}
                  {mv.duration > 0 && (
                    <Text style={[st.gedaempft, { marginTop: 3, fontSize: M.klein }]}>{fmtZeit(mv.duration)}</Text>
                  )}
                </View>
              </FKnopf>
            </FokusReihe>
          ))}
        </View>
      )}

      {/* Bewusst NICHT nur ausgeblendet: beide Listen melden ihre Knöpfe beim
          Fokus-System unter denselben Zeilen/Spalten an. Lägen sie gleichzeitig
          im Baum, würde die Fernbedienung auf unsichtbare Einträge springen. */}
      {!filmeAn && (
      <View style={{ paddingHorizontal: M.rand }}>
        {folgen.map((e, i) => {
          const f = fMap.get(e.id);
          const anteil = f?.duration > 0 ? Math.min(1, f.position / f.duration) : 0;
          return (
            <FokusReihe key={e.id} zeile={i + 1}>
              <FKnopf
                spalte={0}
                onPress={() => spiele(e)}
                onLang={() => gesehenUm(e, !f?.watched)}
                style={[
                  st.kachel,
                  { flexDirection: "row", gap: 14, padding: 8, marginBottom: 8, alignItems: "center" },
                ]}
                fokusStil={st.fokus}
              >
                <View>
                  {e.still ? (
                    <Image
                      source={{ uri: img(e.still, "w300") }}
                      style={{ width: gross ? 190 : 128, height: gross ? 107 : 72, borderRadius: 8, backgroundColor: C.surface }}
                    />
                  ) : (
                    <View style={{ width: gross ? 190 : 128, height: gross ? 107 : 72, borderRadius: 8, backgroundColor: C.surface }} />
                  )}
                  {anteil > 0 && (
                    <View style={st.fortschrittBg}>
                      <View style={[st.fortschrittFg, { width: `${Math.round(anteil * 100)}%` }]} />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: C.text, fontWeight: "700", fontSize: gross ? 17 : 13.5 }}>
                    {se(e.season, e.episode)}{e.title ? " · " + e.title : ""}
                    {f?.watched ? "  ✓" : ""}
                  </Text>
                  {!!e.overview && (
                    <Text numberOfLines={2} style={[st.gedaempft, { marginTop: 3 }]}>{e.overview}</Text>
                  )}
                  {e.duration > 0 && (
                    <Text style={[st.gedaempft, { marginTop: 3, fontSize: M.klein }]}>
                      {fmtZeit(e.duration)}
                      {anteil > 0 && !f?.watched ? `  ·  noch ${fmtZeit(f.duration - f.position)}` : ""}
                    </Text>
                  )}
                </View>
              </FKnopf>
            </FokusReihe>
          );
        })}
        <Text style={[st.gedaempft, { fontSize: M.klein, marginTop: 6 }]}>
          Tipp: OK lange gedrückt halten markiert eine Folge als gesehen.
        </Text>
      </View>
      )}

      {dialog && (
        <Dialog titel="Staffel wählen">
          <DialogListe
            aktiv={aktuelle}
            aufWahl={(w) => { setStaffel(w); setFilmeAn(false); setDialog(false); }}
            eintraege={seasons.map((s) => ({
              wert: s.season,
              // Staffel 0 heißt überall „Specials" — „Staffel 0" versteht niemand.
              text: s.season === 0
                ? `Specials · ${s.episodes.length} Folgen`
                : `Staffel ${s.season} · ${s.episodes.length} Folgen`,
            }))}
          />
        </Dialog>
      )}
    </Seite>
  );
}

/* ══ Detailseite Film ════════════════════════════════════════════════════ */

export function FilmSeite({ api, img, id, aufAbspielen, aufZurueck }) {
  const [mv, setMv] = useState(null);
  const [favorit, setFavorit] = useState(false);
  const [gesehen, setGesehen] = useState(false);
  const [fortschritt, setFortschritt] = useState(null);

  useEffect(() => {
    api(`/api/movies/${id}`).then(setMv).catch(() => {});
    api("/api/favorites")
      .then((f) => setFavorit(!!(Array.isArray(f) && f.find((x) => x.mediaType === "movie" && x.refId === +id))))
      .catch(() => {});
    api("/api/progress")
      .then((ps) => {
        const p = Array.isArray(ps) ? ps.find((x) => x.mediaType === "movie" && x.refId === +id) : null;
        setGesehen(!!p?.watched);
        setFortschritt(p || null);
      })
      .catch(() => {});
  }, [api, id]);

  if (!mv) return <Laden />;

  const anteil = fortschritt?.duration > 0 ? Math.min(1, fortschritt.position / fortschritt.duration) : 0;
  const favUm = () =>
    api("/api/favorites", { method: "POST", body: { mediaType: "movie", refId: +id } })
      .then((r) => setFavorit(!!r.favorite)).catch(() => {});
  const gesehenUm = () =>
    api("/api/watched", { method: "POST", body: { mediaType: "movie", refId: +id, watched: !gesehen } })
      .then(() => setGesehen(!gesehen)).catch(() => {});

  return (
    <Seite>
      <BackdropKopf uri={mv.backdrop ? img(mv.backdrop, "w1280") : null} />
      <View style={{ paddingHorizontal: M.rand, marginTop: -10 }}>
        <Text style={st.h1}>{mv.title}</Text>
        <Text style={[st.gedaempft, { marginTop: 4, marginBottom: 10 }]}>
          {[
            mv.year,
            mv.rating ? `★ ${Number(mv.rating).toFixed(1)}` : null,
            mv.duration ? fmtZeit(mv.duration) : null,
            mv.width ? `${mv.width}×${mv.height}` : null,
            ...parseGenres(mv.genres).slice(0, 3),
          ].filter(Boolean).join("   ·   ")}
        </Text>
        {!!mv.overview && (
          <Text style={[st.fliess, { marginBottom: 8, maxWidth: gross ? 900 : undefined }]}>{mv.overview}</Text>
        )}
        {anteil > 0 && !gesehen && (
          <Text style={[st.gedaempft, { marginBottom: 14 }]}>
            Angesehen bis {fmtZeit(fortschritt.position)} · noch {fmtZeit(fortschritt.duration - fortschritt.position)}
          </Text>
        )}

        <FokusReihe zeile={0}>
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <Knopf
              text={anteil > 0 && !gesehen ? "Fortsetzen" : "Abspielen"}
              symbol="▶" haupt spalte={0}
              onPress={() => aufAbspielen({ type: "movie", id: mv.id, title: mv.title, subtitle: "" })}
            />
            <Knopf
              text={favorit ? "In meiner Liste" : "Zu meiner Liste"}
              symbol={favorit ? "♥" : "♡"} spalte={1} onPress={favUm}
            />
            <Knopf
              text={gesehen ? "Als ungesehen" : "Als gesehen"}
              symbol={gesehen ? "↺" : "✓"} spalte={2} onPress={gesehenUm}
            />
            <Knopf text="Zurück" symbol="←" spalte={3} onPress={aufZurueck} />
          </View>
        </FokusReihe>
      </View>
    </Seite>
  );
}

/* ══ Profilauswahl ═══════════════════════════════════════════════════════ */

export function ProfilSeite({ api, aufWahl, aufZurueck }) {
  const [liste, setListe] = useState(null);
  useEffect(() => {
    api("/api/profiles").then((p) => setListe(Array.isArray(p) ? p : [])).catch(() => setListe([]));
  }, [api]);

  if (!liste) return <Laden />;

  return (
    <Seite>
      <View style={{ padding: M.rand, paddingTop: gross ? 60 : 40 }}>
        <Text style={[st.h1, { marginBottom: 6 }]}>Wer schaut?</Text>
        <Text style={[st.gedaempft, { marginBottom: gross ? 30 : 20 }]}>
          Jedes Profil merkt sich seinen eigenen Fortschritt.
        </Text>
        <FokusReihe zeile={0}>
          <View style={{ flexDirection: "row", gap: M.luecke, flexWrap: "wrap" }}>
            {liste.map((p, i) => (
              <FKnopf
                key={p.id}
                spalte={i}
                onPress={() => aufWahl(p.id)}
                style={[st.kachel, { alignItems: "center", padding: 10 }]}
                fokusStil={st.kachelFokus}
              >
                <View
                  style={{
                    width: gross ? 120 : 84, height: gross ? 120 : 84, borderRadius: 16,
                    backgroundColor: C.red, alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Text style={{ color: C.weiss, fontSize: gross ? 46 : 32, fontWeight: "900" }}>
                    {(p.name || "?").slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <Text style={[st.kachelTitel, { textAlign: "center", width: gross ? 120 : 84 }]}>
                  {p.name}
                </Text>
              </FKnopf>
            ))}
          </View>
        </FokusReihe>
        {!!aufZurueck && (
          <View style={{ marginTop: 26 }}>
            <FokusReihe zeile={1}>
              <View style={{ flexDirection: "row" }}>
                <Knopf text="Zurück" symbol="←" spalte={0} onPress={aufZurueck} />
              </View>
            </FokusReihe>
          </View>
        )}
      </View>
    </Seite>
  );
}

/* ══ Einstellungen ═══════════════════════════════════════════════════════ */

export function EinstellungenSeite({
  conn, base, serverInfo, profilName, version, appAktuell,
  aufServerAendern, aufProfilWechseln, aufNeuEinlesen, aufAbmelden, aufUpdate,
}) {
  const [werte, setWerte] = useState(null);
  const [meldung, setMeldung] = useState("");
  const [offenerDialog, setOffenerDialog] = useState(null);   // { name, titel, ... }

  useEffect(() => { ladeEinstellungen().then(setWerte); }, []);
  useDialog(!!offenerDialog);

  const zeigen = (t) => { setMeldung(t); setTimeout(() => setMeldung(""), 4000); };

  const setzen = async (name, wert) => {
    const neu = { ...werte, [name]: wert };
    setWerte(neu);
    await sichereEinstellungen(neu);
    setOffenerDialog(null);
  };

  if (!werte) return <Laden />;

  // Zeilennummern fortlaufend vergeben — jede Karte bekommt ihren Block
  let z = 0;

  return (
    <Seite>
      <View style={{ padding: M.rand, paddingTop: gross ? 34 : 22 }}>
        <Text style={[st.h1, { marginBottom: 4 }]}>Einstellungen</Text>
        <Text style={[st.gedaempft, { marginBottom: gross ? 26 : 18 }]}>
          GHGFlix{version ? ` · App-Version ${version}` : ""}
        </Text>

        {!!meldung && (
          <View style={[st.hinweis, { marginBottom: 16 }]}>
            <Text style={{ color: C.text, fontSize: M.klein }}>{meldung}</Text>
          </View>
        )}

        {/* ── App-Aktualisierung ─────────────────────────────────────── */}
        {!!appAktuell && appAktuell.neuer && (
          <View style={[st.karte, { marginBottom: 14, borderColor: C.red }]}>
            <Text style={[st.h2, { marginBottom: 4 }]}>Neue Fassung verfügbar</Text>
            <Text style={[st.gedaempft, { marginBottom: 14 }]}>
              Auf dem Server liegt Version {appAktuell.version}
              {appAktuell.groesse ? ` (${appAktuell.groesse})` : ""}.
              {"\n"}Installiert ist {version}.
            </Text>
            <FokusReihe zeile={z++}>
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <Knopf
                  text="Jetzt aktualisieren" symbol="⬇" haupt spalte={0}
                  onPress={() => { aufUpdate?.(); zeigen("Wird heruntergeladen — danach die Installation bestätigen."); }}
                />
              </View>
            </FokusReihe>
          </View>
        )}

        {/* ── Server ────────────────────────────────────────────────── */}
        <View style={[st.karte, { marginBottom: 14 }]}>
          <Text style={[st.h2, { marginBottom: 10 }]}>Server</Text>
          <Zeile name="Adresse" wert={base || "nicht verbunden"} />
          <Zeile name="Version" wert={serverInfo?.version || "unbekannt"} />
          <Zeile name="Anmeldung" wert={conn?.token ? "angemeldet" : serverInfo?.auth ? "Passwort nötig" : "kein Passwort"} />
          <View style={{ height: 14 }} />
          <FokusReihe zeile={z++}>
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Knopf text="Server wechseln" symbol="⟳" spalte={0} onPress={aufServerAendern} />
              <Knopf
                text="Bibliothek neu einlesen" symbol="⟳" spalte={1}
                onPress={() => { aufNeuEinlesen(); zeigen("Suchlauf gestartet — das kann einige Minuten dauern."); }}
              />
            </View>
          </FokusReihe>
        </View>

        {/* ── Profil ────────────────────────────────────────────────── */}
        <View style={[st.karte, { marginBottom: 14 }]}>
          <Text style={[st.h2, { marginBottom: 10 }]}>Profil</Text>
          <Zeile name="Aktuell" wert={profilName || `Profil ${conn?.profile}`} />
          <Zeile name="Fortschritt" wert="wird mit allen Geräten abgeglichen" />
          <View style={{ height: 14 }} />
          <FokusReihe zeile={z++}>
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Knopf text="Profil wechseln" symbol="👤" spalte={0} onPress={aufProfilWechseln} />
              {!!aufAbmelden && <Knopf text="Abmelden" spalte={1} onPress={aufAbmelden} />}
            </View>
          </FokusReihe>
        </View>

        {/* ── Alle einstellbaren Werte ──────────────────────────────── */}
        {FELDER.map((gruppe) => (
          <View key={gruppe.gruppe} style={[st.karte, { marginBottom: 14 }]}>
            <Text style={[st.h2, { marginBottom: 12 }]}>{gruppe.gruppe}</Text>
            {gruppe.eintraege.map((f) => {
              const zeile = z++;
              const zeige = f.anzeige || ((v) => String(v) + (f.einheit ? " " + f.einheit : ""));
              return (
                <FokusReihe key={f.name} zeile={zeile}>
                  <FKnopf
                    spalte={0}
                    onPress={() => setOffenerDialog(f)}
                    style={[
                      st.kachel,
                      { flexDirection: "row", alignItems: "center", padding: 10, marginBottom: 4 },
                    ]}
                    fokusStil={st.fokus}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: C.text, fontSize: gross ? 15.5 : 13, fontWeight: "700" }}>
                        {f.titel}
                      </Text>
                      {!!f.hinweis && (
                        <Text style={[st.gedaempft, { fontSize: M.klein, marginTop: 2 }]}>{f.hinweis}</Text>
                      )}
                    </View>
                    <Text style={{ color: C.red, fontSize: gross ? 15 : 12.5, fontWeight: "800", marginLeft: 12 }}>
                      {zeige(werte[f.name])}  ▾
                    </Text>
                  </FKnopf>
                </FokusReihe>
              );
            })}
          </View>
        ))}

        {/* ── Bedienung ─────────────────────────────────────────────── */}
        <View style={[st.karte, { marginBottom: 14 }]}>
          <Text style={[st.h2, { marginBottom: 10 }]}>Tasten der Fernbedienung</Text>
          {[
            ["Steuerkreuz", "Auswahl bewegen — das Gewählte ist weiß umrandet"],
            ["OK", "Auswahl bestätigen"],
            ["OK gedrückt halten", "Folge als gesehen markieren"],
            ["Zurück", "eine Ebene zurück"],
            ["⏯ / ⏪ / ⏩", "im Player: Pause, zurück, vor"],
            ["← / →  im Player", "auf dem Fortschrittsbalken springen"],
            ["⏭", "nächste Folge"],
            ["ℹ", "Infos zum laufenden Titel"],
          ].map(([a, b]) => (
            <View key={a} style={{ flexDirection: "row", marginBottom: 7 }}>
              <Text style={{ color: C.text, fontSize: gross ? 14 : 12, fontWeight: "700", width: gross ? 190 : 140 }}>
                {a}
              </Text>
              <Text style={[st.gedaempft, { flex: 1 }]}>{b}</Text>
            </View>
          ))}
        </View>

        <Text style={[st.gedaempft, { fontSize: M.klein, textAlign: "center", marginTop: 8 }]}>
          GHGFlix · ZickZack Edition
        </Text>
      </View>

      {/* ── Auswahl-Dialog ────────────────────────────────────────────── */}
      {offenerDialog && (
        <Dialog titel={offenerDialog.titel}>
          {!!offenerDialog.hinweis && (
            <Text style={[st.gedaempft, { marginBottom: 12 }]}>{offenerDialog.hinweis}</Text>
          )}
          <DialogListe
            aktiv={werte[offenerDialog.name]}
            aufWahl={(v) => setzen(offenerDialog.name, v)}
            eintraege={[...new Set(offenerDialog.werte)].map((v) => ({
              wert: v,
              text: (offenerDialog.anzeige || ((x) => String(x) + (offenerDialog.einheit ? " " + offenerDialog.einheit : "")))(v),
            }))}
          />
        </Dialog>
      )}
    </Seite>
  );
}

function Zeile({ name, wert }) {
  return (
    <View style={{ flexDirection: "row", marginBottom: 6 }}>
      <Text style={{ color: C.muted, fontSize: gross ? 14 : 12, width: gross ? 150 : 110 }}>{name}</Text>
      <Text style={{ color: C.text, fontSize: gross ? 14 : 12, flex: 1 }} numberOfLines={2}>{wert}</Text>
    </View>
  );
}
