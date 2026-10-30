import React, { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Image, Linking, ScrollView, Text, View } from "react-native";
import { FFeld, QrBild } from "./bausteine.js";
import { FKnopf, FokusReihe, useFokusSystem } from "./fokus.js";
import { kanalbildWaehlen } from "./kanalbild.js";
import { C, M, st, istTV } from "./stile.js";
import { beitragsFormat, FORMATE, gruppenIds, kanalAufruf, kanalUebersicht, webAdresse } from "./kanaele-api.js";

/** Each action occupies one focus row: no hidden horizontal controls on a TV. */
function Aktion({ text, onPress, row, disabled, children, selected }) {
  return <FokusReihe zeile={row}>
    <FKnopf spalte={0} onPress={disabled ? undefined : onPress} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={text} accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      style={[st.knopf, { minHeight: 44, paddingVertical: 10 }, selected && { borderColor: C.red }]}
      fokusStil={st.fokus}>
      {children}<Text style={[st.knopfText, { flex: 1, flexShrink: 1, opacity: disabled ? 0.5 : 1 }]}>{text}</Text>
    </FKnopf>
  </FokusReihe>;
}

export function KanaeleSeite({ api, onChange }) {
  const sys = useFokusSystem();
  const [history, setHistory] = useState([{ kind: "groups" }]);
  const route = history[history.length - 1];
  const [overview, setOverview] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("");
  const [tab, setTab] = useState("");
  const [limit, setLimit] = useState(40);
  const live = useRef(true);
  const context = useRef(api);
  context.current = api;
  const currentRoute = useRef(route);
  currentRoute.current = route;
  const lock = useRef(false);
  const back = useCallback(() => {
    if (history.length <= 1) return false;
    setHistory((h) => h.slice(0, -1)); setError(""); setNotice(""); return true;
  }, [history.length]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", back);
    return () => sub.remove();
  }, [back]);
  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setLimit(40); }, 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    let cancelled = false;
    kanalUebersicht(api).then((data) => { if (!cancelled) setOverview(data); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [api, revision]);
  useEffect(() => {
    if (route.kind !== "posts") return;
    let cancelled = false;
    setLoading(true); setError(""); setItems([]);
    kanalAufruf(api, "feed_items", {
      ...(route.all ? {} : { gruppeId: route.groupId }), feedId: route.feedId,
      format: format || null, search: query, unreadOnly: tab === "unread", savedOnly: tab === "saved", limit,
    }).then((data) => { if (!cancelled) setItems(data); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, route, query, format, tab, limit, revision]);

  const open = (next) => { setError(""); setNotice(""); setHistory((h) => [...h, next]); };
  const run = async (fn, success) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const valid = () => live.current && context.current === api;
    try {
      const result = await fn();
      if (valid()) {
        setRevision((v) => v + 1);
        onChange?.();
        if (currentRoute.current === route) success?.(result);
      }
    } catch (e) { if (valid()) setError(e.message || String(e)); }
    finally { lock.current = false; if (valid()) setBusy(false); }
  };
  const call = (name, args) => kanalAufruf(api, name, args);
  const groups = overview?.groups ?? [];
  const feeds = overview?.feeds ?? [];
  const group = groups.find((g) => g.id === route.groupId);
  const channel = feeds.find((f) => f.id === route.feedId);
  const channels = route.all ? feeds : feeds.filter((f) => route.groupId == null ? gruppenIds(f).length === 0 : gruppenIds(f).includes(route.groupId));
  let row = 0;
  const action = (text, fn, options = {}) => <Aktion key={options.id ?? text} text={text} row={row++}
    disabled={busy} onPress={fn} {...options} />;
  const posts = (target) => { setSearch(""); setQuery(""); setFormat(""); setTab(""); setLimit(40); open({ kind: "posts", ...target }); };

  return <ScrollView key={route.kind + (route.feedId ?? route.groupId ?? "")} ref={(r) => sys?.setzeScrollRef?.(r)}
    style={{ flex: 1 }} contentContainerStyle={{ padding: M.rand, paddingBottom: 60, gap: 12 }}
    onLayout={(e) => sys?.merkeSichtHoehe?.(e.nativeEvent.layout.height)}>
    <Text style={st.h1}>{route.kind === "groups" ? "Kanäle" : route.kind === "posts" ? channel?.titel ?? group?.name ?? (route.all ? "Alle Beiträge" : "Ohne Gruppe") : route.kind === "post" ? route.item.titel : ({ formatFilter: "Format wählen", tabFilter: "Beiträge anzeigen", postFormat: "Format festlegen", groupEdit: "Gruppe bearbeiten", feedEdit: "Kanal bearbeiten", subscribe: "Kanal abonnieren", channels: "Kanäle in dieser Gruppe" }[route.kind] ?? "Kanäle")}</Text>
    {history.length > 1 && action("Zurück", back, { disabled: false })}
    {!!error && <><Text accessibilityRole="alert" style={[st.fliess, { color: "#ff8b91" }]}>{error}</Text>
      {action("Erneut laden", () => { setError(""); setRevision((v) => v + 1); })}</>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={st.fliess}>{notice}</Text>}
    {busy && <Text style={st.gedaempft}>Bitte warten …</Text>}

    {route.kind === "groups" && <>
      <Text style={st.gedaempft}>{overview ? `${overview.unread} ungelesene Beiträge` : "Kanäle werden geladen …"}</Text>
      {action("Alle Beiträge", () => posts({ all: true }))}
      {action("Neue Beiträge abrufen", () => run(() => call("feed_refresh"), (r) => setNotice(`${r.neu} neue Beiträge`)))}
      {groups.map((g) => action(`${g.name} · ${g.abos} Kanäle · ${g.ungelesen} ungelesen`, () => posts({ groupId: g.id }), {
        id: `group:${g.id}`, children: (g.bild || g.bilder?.[0]) ? <Image source={{ uri: g.bild || g.bilder[0] }} style={{ width: 80, height: 45, borderRadius: 6 }} /> : null,
      }))}
      {action("Neue Gruppe", () => open({ kind: "groupEdit" }))}
      {action("Kanal abonnieren", () => open({ kind: "subscribe" }))}
      <Text style={st.gedaempft}>Neue Beiträge erscheinen in der App. Geräte-Push ist in dieser App noch nicht verfügbar.</Text>
    </>}

    {route.kind === "posts" && <>
      <FokusReihe zeile={row++}><FFeld spalte={0} wert={search} aufWert={setSearch} platzhalter="Beiträge suchen" accessibilityLabel="Beiträge suchen" /></FokusReihe>
      {action(`Format: ${FORMATE.find(([id]) => id === format)?.[1]}`, () => open({ kind: "formatFilter" }))}
      {action(`Anzeige: ${{ "": "Alle", unread: "Ungelesen", saved: "Gemerkt" }[tab]}`, () => open({ kind: "tabFilter" }))}
      {route.feedId ? action("Kanal bearbeiten", () => open({ kind: "feedEdit", feedId: route.feedId })) : <>
        {action("Kanäle dieser Gruppe", () => open({ kind: "channels", groupId: route.groupId, all: route.all }))}
        {route.groupId && action("Gruppe bearbeiten", () => open({ kind: "groupEdit", groupId: route.groupId }))}
      </>}
      {loading && <Text style={st.gedaempft}>Beiträge werden geladen …</Text>}
      {!loading && !error && !items.length && <Text style={st.gedaempft}>Keine passenden Beiträge.</Text>}
      {items.map((b) => action(`${b.titel} · ${b.feedTitel}${b.gelesen ? "" : " · Neu"}${b.gemerkt ? " · Gemerkt" : ""}`, () => open({ kind: "post", item: b }), {
        id: b.id, children: b.bild ? <Image source={{ uri: b.bild }} style={{ width: 80, height: 45, borderRadius: 6 }} /> : null,
      }))}
      {items.length >= limit && limit < 400 && action("Weitere Beiträge laden", () => setLimit((v) => Math.min(400, v + 40)))}
      {items.length === 400 && <Text style={st.gedaempft}>400 Beiträge angezeigt. Mit Suche oder Format weiter eingrenzen.</Text>}
    </>}

    {route.kind === "channels" && <>
      {channels.map((f) => action(f.titel, () => posts({ groupId: route.groupId, all: route.all, feedId: f.id }), { id: f.id }))}
      {!channels.length && <Text style={st.gedaempft}>Noch keine Kanäle zugeordnet.</Text>}
      {action("Kanal abonnieren", () => open({ kind: "subscribe" }))}
      <Text style={st.gedaempft}>Zuordnungen können bei „Kanal bearbeiten“ geändert werden. Ein Kanal kann in mehreren Gruppen liegen.</Text>
    </>}
    {route.kind === "formatFilter" && FORMATE.map(([id, name]) => action(name, () => { setFormat(id); setLimit(40); back(); }, { selected: format === id }))}
    {route.kind === "tabFilter" && [["", "Alle"], ["unread", "Ungelesen"], ["saved", "Gemerkt"]].map(([id, name]) => action(name, () => { setTab(id); setLimit(40); back(); }, { selected: tab === id }))}

    {route.kind === "post" && <>
      {route.item.bild && <Image source={{ uri: route.item.bild }} style={{ width: "100%", maxWidth: 640, aspectRatio: 16 / 9 }} resizeMode="contain" />}
      <Text style={st.gedaempft}>{beitragsFormat(route.item) === "unknown" ? "Format nicht eindeutig erkannt" : FORMATE.find(([id]) => id === beitragsFormat(route.item))?.[1]}</Text>
      <Text style={st.fliess}>{route.item.beschreibung}</Text>
      {action("Beitrag öffnen", () => run(async () => {
        const url = webAdresse(route.item.url);
        if (!url) throw new Error("Dieser Beitrag hat keine gültige Webadresse.");
        await Linking.openURL(url);
        await call("feed_mark_read", { ids: [route.item.id] });
      }, () => setNotice("Beitrag in der passenden App geöffnet.")))}
      {istTV && webAdresse(route.item.url) && <><Text style={st.gedaempft}>Alternativ auf dem Handy öffnen:</Text><QrBild text={webAdresse(route.item.url)} groesse={180} /></>}
      {action(route.item.gemerkt ? "Nicht mehr merken" : "Für später merken", () => run(() => call("feed_saved", { id: route.item.id, on: !route.item.gemerkt }), () => setHistory((h) => [...h.slice(0, -1), { ...route, item: { ...route.item, gemerkt: !route.item.gemerkt } }])))}
      {action(route.item.gesehen ? "Als ungesehen markieren" : "Als gesehen markieren", () => run(() => call("feed_watched", { id: route.item.id, on: !route.item.gesehen }), () => setHistory((h) => [...h.slice(0, -1), { ...route, item: { ...route.item, gesehen: !route.item.gesehen } }])))}
      {action("Format festlegen", () => open({ kind: "postFormat", item: route.item }))}
    </>}
    {route.kind === "postFormat" && [[null, "Automatische Erkennung"], ...FORMATE.filter(([id]) => id && id !== "unknown")].map(([id, name]) => action(name, () => run(() => call("feed_format", { id: route.item.id, format: id }), () => {
      setHistory((h) => [...h.slice(0, -2), { kind: "post", item: { ...route.item, formatOverride: id } }]);
    })))}
    {["groupEdit", "feedEdit", "subscribe"].includes(route.kind) && <KanalEditor key={route.kind + (route.feedId ?? route.groupId ?? "")} route={route}
      group={group} feed={channel} groups={groups} startRow={row} busy={busy} run={run} call={call} back={back} onRemoved={() => setHistory([{ kind: "groups" }])} />}
  </ScrollView>;
}

function KanalEditor({ route, group, feed, groups, startRow, busy, run, call, back, onRemoved }) {
  const [name, setName] = useState(group?.name ?? feed?.titel ?? "");
  const [memberships, setMemberships] = useState(feed ? gruppenIds(feed) : []);
  const [notify, setNotify] = useState(feed?.benachrichtigen ?? true);
  const [url, setUrl] = useState("");
  const [art, setArt] = useState("youtube");
  const [confirmRemove, setConfirmRemove] = useState(false);
  let row = startRow;
  const action = (text, fn, selected) => <Aktion key={text} text={text} row={row++} disabled={busy} onPress={fn} selected={selected} />;
  if (route.kind === "subscribe") return <>
    <FokusReihe zeile={row++}><FFeld spalte={0} wert={url} aufWert={setUrl} platzhalter="YouTube-Kanal oder RSS-Adresse" accessibilityLabel="Kanaladresse" autoCapitalize="none" /></FokusReihe>
    {action(`Quelle: ${art === "youtube" ? "YouTube" : "Blog / RSS"}`, () => setArt((a) => a === "youtube" ? "blog" : "youtube"))}
    {action("Abonnieren", () => run(() => call("feed_add", { url, art }), back))}
  </>;
  return <>
    <FokusReihe zeile={row++}><FFeld spalte={0} wert={name} aufWert={setName} platzhalter="Name" accessibilityLabel="Name" /></FokusReihe>
    {route.kind === "feedEdit" && <>
      {action(`Neue Beiträge melden: ${notify ? "An" : "Aus"}`, () => setNotify((v) => !v), notify)}
      <Text style={st.gedaempft}>Gruppen wählen (mehrere möglich):</Text>
      {groups.filter((g) => g.id).map((g) => action(`${memberships.includes(g.id) ? "✓ " : ""}${g.name}`, () => setMemberships((ids) => ids.includes(g.id) ? ids.filter((id) => id !== g.id) : [...ids, g.id]), memberships.includes(g.id)))}
    </>}
    {route.kind === "groupEdit" && <>
      {group?.bild && <Image source={{ uri: group.bild }} style={{ width: "100%", maxWidth: 480, aspectRatio: 16 / 9 }} resizeMode="contain" />}
      {group && !istTV && action("Bild auswählen und speichern", () => run(async () => {
        const image = await kanalbildWaehlen();
        if (image !== null) await call("set_setting", { key: `feed_group_image_${group.id}`, value: image });
      }))}
      {group?.bild && action("Gruppenbild entfernen", () => run(() => call("set_setting", { key: `feed_group_image_${group.id}`, value: "" })))}
      <Text style={st.gedaempft}>{istTV ? "Eigene Bilder können in der Handy-, Web- oder Desktop-App gewählt werden." : group ? "Die Bildauswahl speichert das Gruppenbild sofort. Der Name wird mit Speichern übernommen." : "Nach dem Anlegen kannst du ein eigenes Bild auswählen."}</Text>
    </>}
    {action("Speichern", () => run(async () => {
      if (!name.trim()) throw new Error("Bitte einen Namen eingeben.");
      if (route.kind === "feedEdit") return call("feed_update", { id: feed.id, titel: name.trim(), gruppeIds: memberships, benachrichtigen: notify });
      return group ? call("feed_group_update", { id: group.id, name: name.trim() }) : call("feed_group_add", { name: name.trim() });
    }, back))}
    {(group || feed) && (confirmRemove ? <>
      <Text style={st.fliess}>{feed ? "Abo und seine Beiträge wirklich entfernen? Auch Merkliste und Gesehen-Markierungen dieses Kanals werden entfernt." : "Gruppe wirklich entfernen? Kanäle und Beiträge bleiben erhalten."}</Text>
      {action("Entfernen bestätigen", () => run(() => feed ? call("feed_remove", { id: feed.id }) : call("feed_group_remove", { id: group.id }), onRemoved))}
      {action("Abbrechen", () => setConfirmRemove(false))}
    </> : action(feed ? "Abo entfernen" : "Gruppe entfernen", () => setConfirmRemove(true)))}
  </>;
}
