// Optional HTTP proxy for the isolated AVD. Reject LAN discovery/other hosts.
// Set only on that AVD: adb -P 5041 -s emulator-5568 shell settings put global http_proxy 10.0.2.2:19846
import { createServer, request } from "node:http";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
export function createFixtureProxy() {
const proxy = createServer((req, res) => {
  let url;
  try { url = new URL(req.url); } catch { res.writeHead(403); return res.end(); }
  if (url.protocol !== "http:" || url.hostname !== "10.0.2.2" || !["19844", "19845"].includes(url.port)) {
    res.writeHead(403); return res.end("Only the isolated GHGFlix fixture is allowed.");
  }
  // Fault injection affects only playback metadata of our generated fixture.
  if (url.pathname.startsWith("/api/play/") && existsSync("test-results/mobile-offline")) {
    res.writeHead(503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Testserver vorübergehend nicht erreichbar" }));
  }
  const upstream = request({ hostname: "127.0.0.1", port: url.port, path: url.pathname + url.search,
    method: req.method, headers: req.headers }, (reply) => { res.writeHead(reply.statusCode, reply.headers); reply.on("error", () => res.destroy()); reply.pipe(res); });
  upstream.on("error", () => { if (!res.destroyed && !res.headersSent) { res.writeHead(502); res.end(); } else res.destroy(); });
  req.on("error", () => upstream.destroy());
  res.on("close", () => upstream.destroy());
  req.pipe(upstream);
});
proxy.on("connection", socket => socket.on("error", () => socket.destroy()));
proxy.on("clientError", (_, socket) => socket.destroy());
proxy.on("connect", (_, socket) => socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"));
return proxy;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) createFixtureProxy().listen(19846, "127.0.0.1", () => console.log("Own emulator proxy: only fixture ports 19844/19845"));
