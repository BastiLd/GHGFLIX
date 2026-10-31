// Isolated simulation of WebHafen's static site + /api/* Caddy routing.
// No live WebHafen configuration or user data is touched.
import { createServer, request } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const upstream = request({ host: '127.0.0.1', port: 19848, path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
  }
  let path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  try {
    if (statSync(path).isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' + url.search }); res.end(); return; }
      path = resolve(path, 'index.html');
    }
    if (!path.startsWith(root + sep) || !statSync(path).isFile()) throw Error();
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(path).pipe(res);
  } catch { res.writeHead(404); res.end(); }
}).listen(19850, '127.0.0.1', () => console.log('WebHafen simulation: 19850; isolated API: 19848'));
