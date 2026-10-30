// Nur die App-Huelle speichern. Medien, API-Antworten und Anmeldedaten bleiben
// bewusst ausserhalb des Cache; sie werden vom angemeldeten Server geladen.
const CACHE = "ghgflix-shell-20261026-1";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(["./offline.html", "./icon-192.png", "./icon-512.png"])));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("ghgflix-shell-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.search) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./offline.html")));
  } else if (/\/assets\/|\.(png|svg|woff2|css|js)$/.test(url.pathname) && !url.pathname.endsWith("/sw.js")) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }));
  }
});
