/* GHGFlix web app — vanilla JS SPA (no build step, no dependencies).
   Hash routing so the phone's back button/gesture always does the right
   thing (player → detail page → overview), seasons are remembered. */
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ── connection manager ──────────────────────────────────────────────────────
// Saved endpoints (Lokal / Domain / Tailscale). When the PWA shell loads but
// the current origin is unreachable (e.g. you left the house), it pings the
// other addresses and hops to the first one that answers. Manual mode only
// switches when the user picks an address.
const CONN_KEY = "ghgflix.endpoints";
const conn = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(CONN_KEY)) || { mode: "auto", list: [] };
    } catch {
      return { mode: "auto", list: [] };
    }
  },
  save(v) {
    localStorage.setItem(CONN_KEY, JSON.stringify(v));
  },
  async ping(base, ms = 3500) {
    try {
      const r = await fetch(base.replace(/\/$/, "") + "/api/ping", { signal: AbortSignal.timeout(ms) });
      const j = await r.json();
      return j && j.app === "ghgflix-server";
    } catch {
      return false;
    }
  },
  async autoSwitch() {
    const c = this.load();
    if (c.mode !== "auto" || c.list.length === 0) return;
    if (await this.ping(location.origin)) return; // current server fine
    for (const e of c.list) {
      const base = e.url.replace(/\/$/, "");
      if (base === location.origin) continue;
      if (await this.ping(base)) {
        toast(`Wechsle zu ${e.name || base} …`);
        location.replace(base + location.pathname + location.hash);
        return;
      }
    }
  },
};

// ── api ─────────────────────────────────────────────────────────────────────
const store = {
  get token() { return localStorage.getItem("ghgflix.token") || ""; },
  set token(v) { v ? localStorage.setItem("ghgflix.token", v) : localStorage.removeItem("ghgflix.token"); },
  get profile() { return parseInt(localStorage.getItem("ghgflix.profile") || "0", 10); },
  set profile(v) { localStorage.setItem("ghgflix.profile", String(v)); },
};

async function api(path, opts = {}) {
  const url = new URL(path, location.origin);
  url.searchParams.set("profile", String(store.profile || 1));
  if (store.token) url.searchParams.set("token", store.token);
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    store.token = "";
    route(); // back to login
    throw new Error("unauthorized");
  }
  return res.json();
}

const img = (path, size = "w342") => (path ? `/api/img?path=${encodeURIComponent(path)}&size=${size}${store.token ? `&token=${store.token}` : ""}&profile=1` : null);
const thumbUrl = (type, id) => `/api/thumb/${type}/${id}?profile=1${store.token ? `&token=${store.token}` : ""}`;
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};

let toastTimer;
function toast(msg) {
  $(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}

// ── layout ──────────────────────────────────────────────────────────────────
/** GHGFlix wordmark (GHG white + Flix red + red zigzag), like the desktop app. */
const wordmark = (fontSize = 26) => `
  <div class="wordmark">
    <div class="wm" style="font-size:${fontSize}px"><span class="ghg">GHG</span><span class="flix">Flix</span></div>
    <svg viewBox="0 0 120 12" preserveAspectRatio="none" style="height:${Math.round(fontSize * 0.3)}px;width:${Math.round(fontSize * 3)}px;margin-top:${Math.round(fontSize * 0.22)}px" fill="none" aria-hidden="true">
      <polyline points="2,9 14,3 26,9 38,3 50,9 62,3 74,9 86,3 98,9 110,3 118,7" stroke="#e50914" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>`;

const NAV = [
  { id: "home", hash: "#/", label: "Start", ic: "🏠" },
  { id: "movies", hash: "#/movies", label: "Filme", ic: "🎬" },
  { id: "shows", hash: "#/shows", label: "Serien", ic: "📺" },
  { id: "settings", hash: "#/settings", label: "Einstellungen", ic: "⚙️" },
];

let lastCounts = { shows: null, movies: null };

function shell(active, inner) {
  const pName = localStorage.getItem("ghgflix.profileName") || "Profil";
  app.innerHTML = `
    <div class="frame">
      <aside class="sidebar">
        <div class="logo">${wordmark(26)}</div>
        <nav>
          ${NAV.map((n) => `
            <button class="navitem ${active === n.id ? "active" : ""}" onclick="location.hash='${n.hash}'">
              <span class="ic">${n.ic}</span><span class="lbl">${n.label}</span>
              ${n.id === "movies" && lastCounts.movies != null ? `<span class="count">${lastCounts.movies}</span>` : ""}
              ${n.id === "shows" && lastCounts.shows != null ? `<span class="count">${lastCounts.shows}</span>` : ""}
            </button>`).join("")}
        </nav>
        <button class="profilebtn" onclick="localStorage.removeItem('ghgflix.profile');location.reload()">
          <span class="ava">${esc((pName[0] || "P").toUpperCase())}</span>
          <span><span class="pn">${esc(pName)}</span><br><span class="ps">Profil wechseln</span></span>
        </button>
      </aside>
      <div class="main">
        <div class="topbar">
          <div class="searchwrap">
            <span class="si">🔍</span>
            <input class="search" id="topsearch" placeholder="Suchen …" value="${esc(active === "search" ? currentQuery : "")}">
          </div>
          <div class="spacer"></div>
          <button class="iconbtn" id="rescanTop" title="Bibliothek scannen">↻</button>
        </div>
        <div class="content"><div class="page">${inner}</div></div>
      </div>
    </div>`;
  const search = $("#topsearch");
  search.oninput = () => runSearch(search.value);
  $("#rescanTop").onclick = async () => { await api("/api/scan", { method: "POST" }); toast("Scan gestartet …"); };
}

let currentQuery = "";
let searchTimer;
function runSearch(q) {
  currentQuery = q;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    if (!q.trim()) { if (location.hash.startsWith("#/search")) location.hash = "#/"; return; }
    const lib = await getLibrary();
    const ql = q.toLowerCase();
    const shows = lib.shows.filter((s) => s.title.toLowerCase().includes(ql));
    const movies = lib.movies.filter((m) => m.title.toLowerCase().includes(ql));
    const box = $("#searchResults");
    const html = `
      ${shows.length ? `<div class="section-title">Serien</div><div class="grid">${shows.map((s) => posterCard("show", s)).join("")}</div>` : ""}
      ${movies.length ? `<div class="section-title">Filme</div><div class="grid">${movies.map((m) => posterCard("movie", m)).join("")}</div>` : ""}
      ${!shows.length && !movies.length ? '<div class="empty">Nichts gefunden</div>' : ""}`;
    if (box) box.innerHTML = html;
    else { if (!location.hash.startsWith("#/search")) history.replaceState(null, "", "#/search"); renderSearchPage(q, html); }
  }, 180);
}
function renderSearchPage(q, html) {
  shell("search", `<div class="section-title">Suche: „${esc(q)}“</div><div id="searchResults">${html}</div>`);
  const s = $("#topsearch");
  s.focus();
  s.setSelectionRange(q.length, q.length);
}

const posterCard = (kind, x) => `
  <a class="card" href="#/${kind}/${x.id}">
    ${x.poster ? `<img class="poster" loading="lazy" src="${img(x.poster)}">` : `<div class="poster ph">${esc(x.title)}</div>`}
    <div class="t">${esc(x.title)}</div>
    ${x.year ? `<div class="st">${x.year}</div>` : ""}
  </a>`;

// ── views ───────────────────────────────────────────────────────────────────
async function viewLogin() {
  const ping = await api("/api/ping").catch(() => null);
  if (!ping?.auth || store.token) return viewProfiles();
  app.innerHTML = `
    <div class="center-screen"><div style="width:min(380px,92vw)">
      <div style="display:flex;justify-content:center;margin-bottom:28px">${wordmark(40)}</div>
      <div class="panel"><h3>Anmelden</h3><div class="desc">Server: ${esc(ping.name)}</div>
        <div class="field"><label>Passwort</label><input id="pw" type="password" autofocus></div>
        <button class="btn" id="go" style="width:100%;justify-content:center">Anmelden</button>
      </div>
    </div></div>`;
  const go = async () => {
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("#pw").value }) }).then((x) => x.json());
    if (r.token) { store.token = r.token; route(); } else toast(r.error || "Fehler");
  };
  $("#go").onclick = go;
  $("#pw").onkeydown = (e) => e.key === "Enter" && go();
}

async function viewProfiles() {
  const profiles = await api("/api/profiles");
  if (store.profile && profiles.some((p) => p.id === store.profile)) {
    const me = profiles.find((p) => p.id === store.profile);
    if (me) localStorage.setItem("ghgflix.profileName", me.name);
    return viewHome();
  }
  // only one profile? skip the picker (single-user convenience) and honor
  // whatever route the user actually navigated to (settings, a detail page, …)
  if (profiles.length === 1) {
    store.profile = profiles[0].id;
    localStorage.setItem("ghgflix.profileName", profiles[0].name);
    return route();
  }
  app.innerHTML = `
    <div class="center-screen"><div>
      <div style="display:flex;justify-content:center;margin-bottom:12px">${wordmark(40)}</div>
      <p style="text-align:center;color:var(--muted);margin-bottom:28px;margin-top:14px">Wer schaut?</p>
      <div class="profile-grid">
        ${profiles.map((p) => `<button class="pf" data-id="${p.id}" data-name="${esc(p.name)}"><span class="ava">${esc(p.name[0].toUpperCase())}</span><span>${esc(p.name)}</span></button>`).join("")}
        <button class="pf" id="addpf"><span class="ava" style="background:var(--surface2)">+</span><span>Neu</span></button>
      </div>
    </div></div>`;
  const pick = (id, name) => { store.profile = id; localStorage.setItem("ghgflix.profileName", name); viewHome(); };
  app.querySelectorAll(".pf[data-id]").forEach((b) => (b.onclick = () => pick(+b.dataset.id, b.dataset.name)));
  $("#addpf").onclick = async () => {
    const name = prompt("Name des Profils?");
    if (!name) return;
    const r = await api("/api/profiles", { method: "POST", body: { name } });
    if (r.id) pick(r.id, name); else toast(r.error || "Fehler");
  };
}

let libraryCache = null;
const getLibrary = async (force) => (libraryCache = !force && libraryCache ? libraryCache : await api("/api/library"));

const contCard = (c) => {
  const href = c.mediaType === "movie" ? `#/play/movie/${c.refId}` : `#/play/episode/${c.refId}`;
  const pic = c.still ? img(c.still, "w300") : c.mBackdrop || c.sBackdrop ? img(c.mBackdrop || c.sBackdrop, "w300") : thumbUrl(c.mediaType, c.refId);
  const sub = c.mediaType === "episode" ? `S${String(c.season).padStart(2, "0")}E${String(c.episode).padStart(2, "0")} · ${fmtTime(c.duration - c.position)} übrig` : `${fmtTime(c.duration - c.position)} übrig`;
  return `<a class="ccard" href="${href}"><img loading="lazy" src="${pic}"><div class="play-badge"><span>▶</span></div><div class="bar"><i style="width:${Math.round((c.position / c.duration) * 100)}%"></i></div><div class="t">${esc(c.title)}</div><div class="s">${sub}</div></a>`;
};

async function viewHome() {
  const [lib, cont] = await Promise.all([getLibrary(), api("/api/continue")]);
  lastCounts = { shows: lib.shows.length, movies: lib.movies.length };
  const empty = lib.shows.length === 0 && lib.movies.length === 0;

  // hero: newest item with a backdrop (like the desktop app's rotating hero)
  const heroPool = [
    ...lib.movies.filter((m) => m.backdrop).map((m) => ({ ...m, kind: "movie" })),
    ...lib.shows.filter((s) => s.backdrop).map((s) => ({ ...s, kind: "show" })),
  ].sort((a, b) => b.added_at - a.added_at);
  const hero = heroPool[0];
  const heroHtml = hero
    ? `<a class="herobox" href="#/${hero.kind}/${hero.id}">
        <img src="${img(hero.backdrop, "w1280")}">
        <div class="grad"></div>
        <div class="info">
          <h1>${esc(hero.title)}</h1>
          <div class="meta">${hero.year ?? ""}${hero.rating ? ` · ★ ${hero.rating.toFixed(1)}` : ""}${hero.genres ? ` · ${esc(hero.genres)}` : ""}</div>
          <p>${esc(hero.overview ?? "")}</p>
        </div>
      </a>`
    : "";

  const newest = [...lib.movies, ...lib.shows.map((s) => ({ ...s, _show: true }))].sort((a, b) => b.added_at - a.added_at).slice(0, 16);
  shell(
    "home",
    empty
      ? `<div class="empty">Noch nichts in der Bibliothek.<br><br>Geh zu <b>⚙️ Einstellungen → Bibliotheken</b> und füge deine Film- und Serienordner hinzu (oder lass sie automatisch erkennen).<br><br><a class="btn" href="#/settings">Zu den Einstellungen</a></div>`
      : `${heroHtml}
     ${cont.length ? `<div class="section-title">Weiterschauen</div><div class="hrow">${cont.map(contCard).join("")}</div>` : ""}
     ${lib.shows.length ? `<div class="section-title">Serien</div><div class="hrow">${lib.shows.map((s) => posterCard("show", s)).join("")}</div>` : ""}
     ${lib.movies.length ? `<div class="section-title">Filme</div><div class="hrow">${lib.movies.map((x) => posterCard("movie", x)).join("")}</div>` : ""}
     ${newest.length ? `<div class="section-title">Neu dazugekommen</div><div class="hrow">${newest.map((x) => posterCard(x._show ? "show" : "movie", x)).join("")}</div>` : ""}`,
  );
}

async function viewGrid(kind) {
  const lib = await getLibrary();
  lastCounts = { shows: lib.shows.length, movies: lib.movies.length };
  const items = kind === "shows" ? lib.shows : lib.movies;
  const linkKind = kind === "shows" ? "show" : "movie";
  const title = kind === "shows" ? "Serien" : "Filme";
  shell(
    kind,
    `<div class="section-title">${title} <span style="color:var(--muted);font-weight:400;font-size:14px">${items.length}</span></div>
     <div class="grid">${items.map((x) => posterCard(linkKind, x)).join("") || '<div class="empty">Nichts gefunden — läuft der Scan noch? (Einstellungen → Bibliotheken)</div>'}</div>`,
  );
}

async function viewShow(id, params) {
  const [data, prog] = await Promise.all([api(`/api/shows/${id}`), api("/api/progress")]);
  const progMap = new Map(prog.filter((x) => x.mediaType === "episode").map((x) => [x.refId, x]));
  const { show, seasons } = data;

  // season tab memory: URL param → last visited → first (the desktop-app fix, here too)
  const memKey = `ghgflix.season.${id}`;
  const want = parseInt(params.get("season") ?? sessionStorage.getItem(memKey) ?? "", 10);
  let season = seasons.some((s) => s.season === want) ? want : (seasons.find((s) => s.season > 0) ?? seasons[0])?.season ?? 1;

  // next unwatched episode for the big button
  const flat = seasons.flatMap((s) => s.episodes);
  const nextEp = flat.find((e) => { const p = progMap.get(e.id); return !p?.watched; }) ?? flat[0];
  const resume = nextEp && progMap.get(nextEp.id);

  const render = () => {
    sessionStorage.setItem(memKey, String(season));
    const cur = seasons.find((s) => s.season === season);
    shell(
      "shows",
      `<div class="detail-hero">${show.backdrop ? `<img src="${img(show.backdrop, "w1280")}">` : ""}<div class="grad"></div><button class="backbtn" onclick="history.length>1?history.back():location.hash='#/shows'">← Zurück</button></div>
       <div class="detail">
        <h1>${esc(show.title)}</h1>
        <div class="meta">${show.year ?? ""} · ${seasons.length} Staffeln · ${flat.length} Folgen${show.rating ? ` · ★ ${show.rating.toFixed(1)}` : ""}${show.genres ? ` · ${esc(show.genres)}` : ""}</div>
        <div class="btnrow">${nextEp ? `<a class="btn" href="#/play/episode/${nextEp.id}">▶ ${resume && !resume.watched && resume.position > 30 ? "Fortsetzen" : "Abspielen"} · S${String(nextEp.season).padStart(2, "0")}E${String(nextEp.episode).padStart(2, "0")}</a>` : ""}</div>
        <p class="overview">${esc(show.overview ?? "")}</p>
        <div class="tabs">${seasons.map((s) => `<button data-s="${s.season}" class="${s.season === season ? "active" : ""}">${s.season === 0 ? "Specials" : "Staffel " + s.season}</button>`).join("")}</div>
        <div class="eplist">
          ${(cur?.episodes ?? [])
            .map((e) => {
              const p = progMap.get(e.id);
              const pct = p && p.duration > 0 ? Math.min(100, Math.round((p.position / p.duration) * 100)) : 0;
              return `<a class="ep ${p?.watched ? "watched" : ""}" href="#/play/episode/${e.id}">
                <img loading="lazy" src="${e.still ? img(e.still, "w300") : thumbUrl("episode", e.id)}">
                <div class="info">
                  <div class="n">${e.episode}. ${esc(e.title ?? "Folge " + e.episode)}</div>
                  <div class="d">${esc(e.overview ?? "")}</div>
                  ${pct > 0 && !p?.watched ? `<div class="prog"><i style="width:${pct}%"></i></div>` : ""}
                </div></a>`;
            })
            .join("")}
        </div>
       </div>`,
    );
    app.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { season = +b.dataset.s; render(); }));
  };
  render();
}

async function viewMovie(id) {
  const [mv, prog] = await Promise.all([api(`/api/movies/${id}`), api("/api/progress")]);
  const p = prog.find((x) => x.mediaType === "movie" && x.refId === +id);
  shell(
    "movies",
    `<div class="detail-hero">${mv.backdrop ? `<img src="${img(mv.backdrop, "w1280")}">` : ""}<div class="grad"></div><button class="backbtn" onclick="history.length>1?history.back():location.hash='#/movies'">← Zurück</button></div>
     <div class="detail">
      <h1>${esc(mv.title)}</h1>
      <div class="meta">${mv.year ?? ""}${mv.rating ? ` · ★ ${mv.rating.toFixed(1)}` : ""}${mv.genres ? ` · ${esc(mv.genres)}` : ""}${mv.duration ? ` · ${Math.round(mv.duration / 60)} Min.` : ""}</div>
      <div class="btnrow"><a class="btn" href="#/play/movie/${mv.id}">▶ ${p && !p.watched && p.position > 30 ? "Fortsetzen" : "Abspielen"}</a></div>
      <p class="overview">${esc(mv.overview ?? "")}</p>
     </div>`,
  );
}

// ── player ──────────────────────────────────────────────────────────────────
let playerCleanup = null;

async function viewPlayer(type, id) {
  playerCleanup?.();
  const [info, prog, detail] = await Promise.all([
    api(`/api/play/${type}/${id}`),
    api("/api/progress"),
    type === "episode" ? null : api(`/api/movies/${id}`),
  ]);
  if (info.error) { toast("Nicht gefunden"); location.hash = "#/"; return; }

  let title = "", subtitle = "", nextId = null, showId = null, season = null;
  if (type === "episode") {
    // find the episode + its show for titles and the next-episode button
    const lib = await getLibrary();
    for (const s of lib.shows) {
      const d = await api(`/api/shows/${s.id}`).catch(() => null);
      const flat = d?.seasons?.flatMap((x) => x.episodes) ?? [];
      const idx = flat.findIndex((e) => e.id === +id);
      if (idx >= 0) {
        const e = flat[idx];
        title = s.title;
        season = e.season;
        subtitle = `S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}${e.title ? " · " + e.title : ""}`;
        nextId = flat[idx + 1]?.id ?? null;
        showId = s.id;
        break;
      }
    }
  } else {
    title = detail?.title ?? "Film";
    subtitle = detail?.year ? String(detail.year) : "";
  }

  const saved = prog.find((x) => x.mediaType === type && x.refId === +id);
  const resumeAt = saved && !saved.watched && saved.position > 30 && saved.position < (saved.duration || Infinity) * 0.95 ? saved.position : 0;
  const totalDuration = info.duration || saved?.duration || 0;

  app.innerHTML = `
    <div class="player">
      <video id="v" playsinline autoplay></video>
      <div class="pcenter" id="spin"><div class="spin"></div></div>
      <div class="pui" id="ui">
        <div class="top">
          <button class="pbtn" id="back" title="Zurück">←</button>
          <button class="pbtn" id="closex" title="Player schließen">✕</button>
          <div class="titles"><div class="t1">${esc(title)}</div><div class="t2">${esc(subtitle)}</div></div>
        </div>
        <div class="bottom">
          <div class="seek"><span id="cur">0:00</span><input type="range" id="bar" min="0" max="${Math.max(1, Math.floor(totalDuration))}" value="0" step="1"><span id="tot">${fmtTime(totalDuration)}</span></div>
          <div class="controls">
            <button class="pbtn" id="rew">⏪ 10</button>
            <button class="pbtn big" id="pp">⏸</button>
            <button class="pbtn" id="fwd">10 ⏩</button>
            ${nextId ? `<button class="pbtn" id="next" title="Nächste Folge">⏭</button>` : ""}
            <button class="pbtn" id="fs" title="Vollbild">⛶</button>
          </div>
        </div>
      </div>
    </div>`;

  const v = $("#v"), ui = $("#ui"), bar = $("#bar");
  // transcode streams start at an offset — real position = offset + currentTime
  let mode = info.direct ? "direct" : "transcode";
  let offset = 0;
  let ended = false;

  const src = (t) => {
    if (mode === "direct") { offset = 0; v.src = info.directUrl; if (t > 0) v.addEventListener("loadedmetadata", () => (v.currentTime = t), { once: true }); }
    else { offset = t; v.src = `${info.transcodeUrl}&t=${Math.floor(t)}`; }
  };
  const pos = () => offset + (v.currentTime || 0);

  src(resumeAt);
  v.onerror = () => {
    if (mode === "direct") { mode = "transcode"; toast("Direktwiedergabe klappt nicht — Transcoding …"); src(pos() || resumeAt); }
    else toast("Wiedergabefehler");
  };

  const save = (watched = false) => {
    if (totalDuration <= 0 && !v.duration) return;
    const dur = totalDuration || v.duration || 0;
    const done = watched || (dur > 0 && pos() >= dur * 0.95);
    api("/api/progress", { method: "POST", body: { mediaType: type, refId: +id, position: pos(), duration: dur, watched: done } }).catch(() => {});
  };
  const saveTimer = setInterval(save, 10000);

  // UI show/hide
  let hideTimer;
  const wake = () => {
    ui.classList.remove("hidden");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => !v.paused && ui.classList.add("hidden"), 3000);
  };
  wake();
  v.parentElement.onpointermove = wake;
  v.onclick = () => (ui.classList.contains("hidden") ? wake() : v.paused ? v.play() : v.pause());

  v.ontimeupdate = () => {
    if (!bar.dragging) bar.value = Math.floor(pos());
    $("#cur").textContent = fmtTime(pos());
    if (!totalDuration && v.duration) { bar.max = Math.floor(v.duration); $("#tot").textContent = fmtTime(v.duration); }
  };
  v.onplay = () => { $("#pp").textContent = "⏸"; wake(); };
  v.onpause = () => { $("#pp").textContent = "▶"; wake(); };
  v.onwaiting = () => ($("#spin").style.display = "");
  v.onplaying = () => ($("#spin").style.display = "none");
  v.onended = () => {
    ended = true;
    save(true);
    if (nextId) location.hash = `#/play/episode/${nextId}`;
    else goBack();
  };

  bar.oninput = () => { bar.dragging = true; $("#cur").textContent = fmtTime(+bar.value); };
  bar.onchange = () => {
    bar.dragging = false;
    const t = +bar.value;
    if (mode === "direct") v.currentTime = t;
    else src(t);
  };
  $("#pp").onclick = () => (v.paused ? v.play() : v.pause());
  $("#rew").onclick = () => (mode === "direct" ? (v.currentTime -= 10) : src(Math.max(0, pos() - 10)));
  $("#fwd").onclick = () => (mode === "direct" ? (v.currentTime += 10) : src(pos() + 10));
  $("#fs").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : v.parentElement.requestFullscreen?.().catch(() => {}));
  if (nextId) $("#next").onclick = () => (location.hash = `#/play/episode/${nextId}`);

  // Back = to the detail page WITH the right season; X = same target (the web
  // player has no mini mode — both leave, back keeps history natural).
  const backTarget = type === "episode" && showId != null ? `#/show/${showId}?season=${season}` : type === "movie" ? `#/movie/${id}` : "#/";
  const goBack = () => { location.hash = backTarget; };
  $("#back").onclick = goBack;
  $("#closex").onclick = goBack;

  playerCleanup = () => {
    clearInterval(saveTimer);
    if (!ended) save();
    v.pause();
    v.removeAttribute("src");
    v.load();
    playerCleanup = null;
  };
}

// ── settings ────────────────────────────────────────────────────────────────
/** Folder-browser modal (in-container filesystem) — click your way to a
 *  folder instead of typing paths blind, exactly like the desktop app's
 *  picker. onPick(path, kind) fires when the user chooses "Serien"/"Filme". */
async function openBrowseModal(onPick) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);

  const render = async (path) => {
    const data = await api(`/api/browse?path=${encodeURIComponent(path || "roots")}`);
    if (data.error) { toast(data.error); render("roots"); return; }
    const isRoots = data.roots;
    overlay.innerHTML = `
      <div class="modalbox">
        <div class="modalhead"><h3>${isRoots ? "Platte / Laufwerk wählen" : "Ordner wählen"}</h3><button class="iconbtn" id="mclose">✕</button></div>
        <div class="breadcrumb">${isRoots ? "Alle eingebundenen Laufwerke" : esc(data.path)}</div>
        <div class="browse-list">
          ${!isRoots && data.parent ? `<button class="browse-item up" data-p="${esc(data.parent)}">‹ .. (zurück)</button>` : ""}
          ${data.entries.map((e) => `<button class="browse-item" data-p="${esc(e.path)}">${isRoots ? "💽" : "📁"} ${esc(e.name)}</button>`).join("") || '<div class="hint" style="padding:8px 4px">Keine Unterordner hier</div>'}
        </div>
        ${isRoots ? '<p class="hint">Öffne die Platte, auf der deine Filme/Serien liegen, und navigiere in den passenden Ordner.</p>' : `
        <div class="btnrow" style="margin-top:14px">
          <button class="btn" id="pickShow">📺 Als Serien-Ordner</button>
          <button class="btn ghost" id="pickMovie">🎬 Als Film-Ordner</button>
        </div>`}
      </div>`;
    overlay.querySelectorAll(".browse-item").forEach((b) => (b.onclick = () => render(b.dataset.p)));
    $("#mclose", overlay).onclick = () => overlay.remove();
    if (!isRoots) {
      $("#pickShow", overlay).onclick = () => { onPick(data.path, "show"); overlay.remove(); };
      $("#pickMovie", overlay).onclick = () => { onPick(data.path, "movie"); overlay.remove(); };
    }
  };
  await render("roots");
}

/** Auto-detection modal: scans all drives and offers found folders to add. */
async function openDetectModal(onDone) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `<div class="modalbox"><div class="modalhead"><h3>Automatische Erkennung</h3><button class="iconbtn" id="mclose">✕</button></div><div class="spinner-center"><div class="spin"></div></div><p class="hint" style="text-align:center">Durchsuche alle Laufwerke …</p></div>`;
  document.body.appendChild(overlay);
  $("#mclose", overlay).onclick = () => overlay.remove();

  const data = await api("/api/detect").catch(() => ({ found: [] }));
  const found = data.found || [];
  const box = overlay.querySelector(".modalbox");
  if (!found.length) {
    box.innerHTML = `<div class="modalhead"><h3>Automatische Erkennung</h3><button class="iconbtn" id="mclose2">✕</button></div><div class="empty">Keine Medienordner gefunden.<br><br>Nutze „Ordner hinzufügen“, um manuell einen Ordner zu wählen.</div>`;
    $("#mclose2", overlay).onclick = () => overlay.remove();
    return;
  }
  box.innerHTML = `
    <div class="modalhead"><h3>${found.length} Ordner gefunden</h3><button class="iconbtn" id="mclose3">✕</button></div>
    <p class="hint" style="margin-top:0">Häkchen setzen und übernehmen — Typ (Serien/Filme) kannst du je Ordner ändern.</p>
    <div style="max-height:46vh;overflow-y:auto;margin:12px 0">
      ${found.map((f, i) => `
        <div class="detect-item">
          <input type="checkbox" class="dchk" data-i="${i}" checked style="width:20px;height:20px;accent-color:var(--red)">
          <div class="grow"><b>${esc(f.name)}</b><div class="dp">${esc(f.path)}</div></div>
          <select class="dkind" data-i="${i}" style="background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:6px 8px;color:var(--text)">
            <option value="show" ${f.kind === "show" ? "selected" : ""}>Serien</option>
            <option value="movie" ${f.kind === "movie" ? "selected" : ""}>Filme</option>
          </select>
        </div>`).join("")}
    </div>
    <button class="btn" id="applyDetect" style="width:100%;justify-content:center">Ausgewählte übernehmen</button>`;
  $("#mclose3", overlay).onclick = () => overlay.remove();
  $("#applyDetect", overlay).onclick = async () => {
    const picks = [...overlay.querySelectorAll(".dchk")].filter((c) => c.checked).map((c) => {
      const i = +c.dataset.i;
      const kind = overlay.querySelector(`.dkind[data-i="${i}"]`).value;
      return { path: found[i].path, kind };
    });
    let ok = 0;
    for (const p of picks) {
      const r = await api("/api/libraries", { method: "POST", body: p });
      if (!r.error) ok++;
    }
    overlay.remove();
    toast(`${ok} Bibliothek(en) hinzugefügt — Scan läuft …`);
    libraryCache = null;
    onDone();
  };
}

async function viewSettings() {
  const s = await api("/api/settings");
  const scan = await api("/api/scan/status");
  const libs = await api("/api/libraries");
  const c = conn.load();
  shell(
    "settings",
    `<div class="section-title">Einstellungen</div>

     <div class="panel"><h3>Bibliotheken <span class="tag ${scan.tmdb ? "ok" : "bad"}">TMDb ${scan.tmdb ? "aktiv" : "kein Key"}</span></h3>
      <div class="desc">${scan.shows} Serien · ${scan.episodes} Folgen · ${scan.movies} Filme ${scan.running ? "· <b>Scan läuft …</b>" : ""}</div>
      <div id="libList">${libs
        .map(
          (l) => `
        <div class="libitem">
          <span class="tag ${l.kind === "show" ? "ok" : ""}">${l.kind === "show" ? "📺 Serien" : "🎬 Filme"}</span>
          <span class="lp">${esc(l.path)}</span>
          <button class="iconbtn" data-libdel="${l.id}" title="Entfernen">🗑</button>
        </div>`,
        )
        .join("") || '<div class="hint" style="margin:8px 0">Noch keine Bibliothek. Klick auf <b>Automatisch erkennen</b> — das durchsucht alle Laufwerke.</div>'}</div>
      <div class="btnrow">
        <button class="btn" id="detectLib">✨ Automatisch erkennen</button>
        <button class="btn ghost" id="addLib">+ Ordner hinzufügen</button>
        <button class="btn ghost" id="rescan">↻ Neu scannen</button>
      </div>
      <div class="field" style="margin-top:14px"><label>TMDb API-Key (für Poster & Beschreibungen)</label><input id="tmdb" placeholder="${s.tmdb_key_set ? "•••••• (gesetzt)" : "z.B. 1ab2c3…"}"></div>
      <p class="hint">Mehrere Platten werden automatisch mitgesucht (alles, was im Container unter <code>/media</code>, <code>/DATA</code> oder <code>/mnt</code> eingebunden ist). „Automatisch erkennen“ findet Film-/Serienordner von selbst; mit „Ordner hinzufügen“ klickst du dich manuell durch alle Laufwerke.</p>
     </div>

     <div class="panel"><h3>Verbindungen (Lokal / Domain / Tailscale)</h3>
      <div class="desc">Adressen, unter denen dieser Server erreichbar ist. Bei „Automatisch“ springt die App auf die erste erreichbare Adresse, wenn die aktuelle nicht antwortet (z.B. unterwegs → Tailscale).</div>
      <div class="field"><label>Modus</label>
        <select id="cmode"><option value="auto" ${c.mode === "auto" ? "selected" : ""}>Automatisch wechseln</option><option value="manual" ${c.mode === "manual" ? "selected" : ""}>Nur manuell</option></select>
      </div>
      <div id="clist">${c.list.map((e, i) => `
        <div class="field" style="display:flex;gap:8px;align-items:center">
          <input data-i="${i}" data-k="name" value="${esc(e.name)}" placeholder="Name" style="flex:0 0 110px">
          <input data-i="${i}" data-k="url" value="${esc(e.url)}" placeholder="http://…">
          <button class="iconbtn" data-del="${i}">🗑</button>
          <button class="iconbtn" data-go="${i}" title="Jetzt zu dieser Adresse wechseln">↗</button>
        </div>`).join("")}</div>
      <button class="btn ghost" id="cadd">+ Adresse hinzufügen</button>
      <div class="hint">Beispiele: <code>http://192.168.1.50:8484</code> (lokal) · <code>https://flix.meinedomain.de</code> · <code>http://zimaboard.tailnet-xyz.ts.net:8484</code> (Tailscale)</div>
     </div>

     <div class="panel"><h3>Supabase-Sync <span class="tag ${s.supabase_configured ? "ok" : ""}">${s.supabase_configured ? "verbunden" : "nicht konfiguriert"}</span></h3>
      <div class="desc">Cloud-Abgleich mit deinem bestehenden GHGFlix-Supabase. Senden und Empfangen sind getrennt schaltbar.</div>
      <label class="switch"><input type="checkbox" id="sb_pull" ${s.supabase_pull ? "checked" : ""}> Von Supabase empfangen</label>
      <label class="switch"><input type="checkbox" id="sb_push" ${s.supabase_push ? "checked" : ""}> Zu Supabase senden</label>
      <div class="field"><label>Supabase-URL</label><input id="sb_url" placeholder="${s.supabase_configured ? "•••••• (gesetzt)" : "https://xyz.supabase.co"}"></div>
      <div class="field"><label>Service-Role-Key</label><input id="sb_key" type="password" placeholder="${s.supabase_configured ? "•••••• (gesetzt)" : "eyJ…"}"></div>
      <button class="btn ghost" id="sb_import">Alles aus Supabase importieren</button>
     </div>

     <div class="panel"><h3>Server</h3>
      <div class="field"><label>Server-Name</label><input id="sname" value="${esc(s.server_name)}"></div>
      <div class="field"><label>Passwort (leer = kein Login nötig)</label><input id="spw" type="password" placeholder="${s.password_set ? "•••••• (gesetzt)" : "optional"}"></div>
     </div>

     <button class="btn" id="saveAll" style="width:100%;justify-content:center">Speichern</button>`,
  );

  $("#rescan").onclick = async () => { await api("/api/scan", { method: "POST" }); toast("Scan gestartet"); libraryCache = null; };
  $("#detectLib").onclick = () => openDetectModal(() => viewSettings());
  $("#addLib").onclick = () =>
    openBrowseModal(async (path, kind) => {
      const r = await api("/api/libraries", { method: "POST", body: { path, kind } });
      if (r.error) { toast(r.error); return; }
      toast("Bibliothek hinzugefügt — Scan läuft im Hintergrund …");
      libraryCache = null;
      viewSettings();
    });
  app.querySelectorAll("[data-libdel]").forEach(
    (b) =>
      (b.onclick = async () => {
        await api(`/api/libraries/${b.dataset.libdel}`, { method: "DELETE" });
        libraryCache = null;
        toast("Bibliothek entfernt");
        viewSettings();
      }),
  );
  $("#sb_import").onclick = async () => {
    toast("Import läuft …");
    const r = await api("/api/supabase/import", { method: "POST" });
    toast(r.ok ? `Import fertig: ${r.pulled} Einträge` : r.error || "Fehler");
  };

  const saveConn = () => {
    const list = [...app.querySelectorAll("#clist .field")].map((f) => ({
      name: f.querySelector('[data-k="name"]').value.trim(),
      url: f.querySelector('[data-k="url"]').value.trim().replace(/\/$/, ""),
    })).filter((e) => e.url);
    conn.save({ mode: $("#cmode").value, list });
  };
  $("#cadd").onclick = () => { saveConn(); const v = conn.load(); v.list.push({ name: "", url: "" }); conn.save(v); viewSettings(); };
  app.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { saveConn(); const v = conn.load(); v.list.splice(+b.dataset.del, 1); conn.save(v); viewSettings(); }));
  app.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { saveConn(); const e = conn.load().list[+b.dataset.go]; if (e?.url) location.href = e.url; }));

  $("#saveAll").onclick = async () => {
    saveConn();
    const body = {
      server_name: $("#sname").value.trim() || "GHGFlix",
      supabase_push: $("#sb_push").checked ? "on" : "off",
      supabase_pull: $("#sb_pull").checked ? "on" : "off",
    };
    if ($("#tmdb").value.trim()) body.tmdb_key = $("#tmdb").value.trim();
    if ($("#sb_url").value.trim()) body.supabase_url = $("#sb_url").value.trim();
    if ($("#sb_key").value.trim()) body.supabase_key = $("#sb_key").value.trim();
    if ($("#spw").value.trim()) body.password = $("#spw").value.trim();
    await api("/api/settings", { method: "POST", body });
    toast("Gespeichert");
  };
}

// ── router ──────────────────────────────────────────────────────────────────
async function route() {
  playerCleanup?.();
  const hash = location.hash.slice(1) || "/";
  const [path, query] = hash.split("?");
  const params = new URLSearchParams(query || "");
  const seg = path.split("/").filter(Boolean);
  try {
    if (!store.token) {
      const ping = await api("/api/ping").catch(() => null);
      if (ping?.auth) return viewLogin();
    }
    if (!store.profile) return viewProfiles();
    if (seg.length === 0) return viewHome();
    if (seg[0] === "shows") return viewGrid("shows");
    if (seg[0] === "movies") return viewGrid("movies");
    if (seg[0] === "show") return viewShow(seg[1], params);
    if (seg[0] === "movie") return viewMovie(seg[1]);
    if (seg[0] === "play") return viewPlayer(seg[1], seg[2]);
    if (seg[0] === "settings") return viewSettings();
    return viewHome();
  } catch (e) {
    if (String(e.message) !== "unauthorized") {
      app.innerHTML = `<div class="center-screen"><div class="empty">Server nicht erreichbar.<br><br><button class="btn" onclick="location.reload()">Neu versuchen</button></div></div>`;
      conn.autoSwitch();
    }
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", () => playerCleanup?.());
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
conn.autoSwitch();
route();
