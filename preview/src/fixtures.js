// Ausschließlich lokale Beispieldaten. Kein Zugriff auf die echte Mediathek.
const names = ["Nachtzug", "Orbit", "Wildnis", "Die letzte Welle", "Nordlicht", "Horizont", "Echo", "Tiefblau", "Morgenrot", "Unter dem Eis", "Sternenstaub", "Ferne Ufer"];
const colors = ["#7c496a", "#354d86", "#436b4e", "#457782", "#53647d", "#aa7149"];
const now = Math.floor(Date.now() / 1000);
export const library = {
  movies: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: names[i % names.length] + (i >= 12 ? ` ${Math.floor(i / 12) + 1}` : ""), year: 2024 + i % 3, rating: 7.2 + i % 4 * .4, genres: '["Drama","Abenteuer"]', poster: `movie:${i}`, backdrop: `wide:${i}`, added_at: now - i * 86400, overview: "Eine Reise ins Unbekannte. Zwischen vertrauten Orten und neuen Begegnungen beginnt eine Geschichte, die alles verändert.", duration: 90, width: 1920, height: 1080, _t: "movie" })),
  shows: Array.from({ length: 14 }, (_, i) => ({ id: 101 + i, title: ["Zwischen den Welten", "Die Küste", "Licht und Schatten", "Aufbruch"][i % 4] + (i >= 4 ? ` ${Math.floor(i / 4) + 1}` : ""), year: 2025, rating: 8.4, seasons: 3, genres: '["Drama","Abenteuer"]', poster: `show:${i}`, backdrop: `wide:${i + 3}`, added_at: now - (i + 1) * 86400, overview: "Alte Geheimnisse, neue Wege. Eine Gruppe von Freunden entdeckt, wie nah Abenteuer und Zuhause beieinanderliegen.", _t: "show" })),
};
let favorites = [{ mediaType: "movie", refId: 2 }, { mediaType: "show", refId: 101 }];
let progress = [{ mediaType: "movie", refId: 1, position: 12, duration: 90, watched: false }];
export function image(p, size) {
  const i = +(p?.split(":")[1] || 0), wide = size === "w1280", w = wide ? 1280 : 500, h = wide ? 720 : 750;
  const name = names[i % names.length].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${colors[i % colors.length]}"/><stop offset="1" stop-color="#10121e"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * .73}" cy="${h * .32}" r="${w * .22}" fill="#ffffff" opacity=".10"/><path d="M0 ${h * .73} L${w * .35} ${h * .3} L${w * .7} ${h * .72} L${w} ${h * .5} V${h} H0Z" fill="#050913" opacity=".45"/><path d="M0 ${h * .85} L${w * .6} ${h * .58} L${w} ${h * .8} V${h} H0Z" fill="#080a11" opacity=".6"/><text x="${w * .09}" y="${h * .83}" fill="white" font-family="Arial,sans-serif" font-size="${wide ? 65 : 40}" font-weight="800">${name}</text><text x="${w * .09}" y="${h * .89}" fill="#cbd0df" font-family="Arial,sans-serif" font-size="${wide ? 20 : 16}" letter-spacing="4">GHGFLIX · VORSCHAUDATEN</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
export function installFixtures() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, opts = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.origin);
    if (!url.pathname.startsWith("/api/")) return original(input, opts);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const p = url.pathname, body = opts.body ? JSON.parse(opts.body) : {};
    if (p === "/api/library" && new URLSearchParams(location.search).get("fault") === "library") return new Response(JSON.stringify({ error: "Vorschau: Server vorübergehend nicht erreichbar." }), { status: 503 });
    let data;
    if (p === "/api/ping") data = { app: "ghgflix-server", version: "2.8.0", auth: false, accounts:true, id:"preview", server_id: "preview" };
    else if(p==='/api/accounts/me')data={account:{id:1,email:'preview@example.test',isAdmin:true},profile:{id:1,name:'Alex',avatar:null,is_child:0,max_age:12}};
    else if(p==='/api/accounts/status')data={required:true,setupNeeded:false,registration:true};
    else if(p==='/api/accounts/select-profile')data={id:body.id,name:body.id===1?'Alex':'Familie',avatar:null,is_child:0,max_age:12};
    else if (p === "/api/library") data = library;
    else if (p === "/api/profiles") data = [{ id: 1, name: "Alex", color: "#e50914" }, { id: 2, name: "Familie", color: "#477cc2" }];
    else if (p === "/api/continue" || p === "/api/history") data = library.movies.slice(0, 6).map((m) => ({ ...m, mediaType: "movie", refId: m.id, position: 12, duration: 90 }));
    else if (p === "/api/favorites") {
      if (opts.method === "POST") { const existing = favorites.some((f) => f.mediaType === body.mediaType && f.refId === body.refId); favorites = existing ? favorites.filter((f) => !(f.mediaType === body.mediaType && f.refId === body.refId)) : [...favorites, body]; data = { favorite: !existing }; }
      else data = favorites;
    }
    else if (p === "/api/progress") { if (opts.method === "POST") { progress = [...progress.filter((x) => !(x.mediaType === body.mediaType && x.refId === body.refId)), body]; data = { ok: true }; } else data = progress; }
    else if (p.startsWith("/api/movies/")) data = library.movies.find((x) => x.id === +p.split("/").pop());
    else if (p.startsWith("/api/shows/")) { const show = library.shows.find((x) => x.id === +p.split("/").pop()); data = { show, seasons: [1, 2, 3].map((s) => ({ season: s, episodes: Array.from({ length: 8 }, (_, i) => ({ id: s * 100 + i, season: s, episode: i + 1, title: ["Ein neuer Anfang", "Die Entscheidung", "Auf der Suche"][i % 3], duration: 90, overview: "Die Geschichte geht weiter.", still: `wide:${i}` })) })), movies: [] }; }
    else if (p.startsWith("/api/play/")) data = { direct: true, directUrl: "/sample.mp4", transcodeUrl: "/sample.mp4", duration: 90, untertitelUrl: "/api/preview-subtitles", spuren: { audio: [{ id: "a0", nr: 0, name: "Deutsch", sprache: "deu" }], sub: Array.from({ length: new URLSearchParams(location.search).get("tracks") === "none" ? 0 : 16 }, (_, i) => ({ id: `s${i}`, nr: i, name: `Sprache ${String(i + 1).padStart(2, "0")}`, sprache: i === 0 ? "deu" : "eng", text: true, bild: false })) } };
    else if (p === "/api/preview-subtitles") return new Response("WEBVTT\n\n00:00:00.000 --> 00:01:30.000\nVorschau-Untertitel\n", { headers: { "Content-Type": "text/vtt" } });
    else if (p === "/api/apk/status") data = { available: false };
    else if (p === "/api/settings") data = {};
    else if (p === "/api/watched") data = { ok: true };
    else return new Response(JSON.stringify({ error: `Vorschau-Endpunkt fehlt: ${p}` }), { status: 404 });
    return new Response(JSON.stringify(data ?? {}), { headers: { "Content-Type": "application/json" } });
  };
}
