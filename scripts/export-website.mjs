import { readFileSync, readdirSync, statSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export function exportWebsite(source, destination) {
  source = resolve(source); destination = resolve(destination);
  if (source === destination || destination.startsWith(source + '/') || destination.startsWith(source + '\\')) throw Error('Exportziel muss außerhalb des Builds liegen.');
  if (existsSync(destination) && readdirSync(destination).length) throw Error('Exportziel muss leer sein.');
  const info = JSON.parse(readFileSync(join(source, 'build-info.json'), 'utf8'));
  if (info.app !== 'ghgflix-web' || !/^\d+\.\d+\.\d+$/.test(info.version) || !info.buildId || !/^[a-f0-9]{40}$/.test(info.revision)) throw Error('Kein veröffentlichbarer Website-Build.');
  const html = readFileSync(join(source, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+)"/g)) {
    if (!existsSync(resolve(source, match[1]))) throw Error(`Fehlende Datei: ${match[1]}`);
  }
  if (!html.includes('./assets/')) throw Error('Keine gebaute Website gefunden.');
  function verify(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name), rel = relative(source, path);
      if (entry.isSymbolicLink() || /(^|[\\/])\.|\.(?:map|key|db|sqlite|pem|ts|tsx)$/.test(rel)) throw Error(`Nicht öffentliche Build-Datei: ${rel}`);
      if (entry.isDirectory()) verify(path);
      else if (!entry.isFile() || statSync(path).size > 64 * 1024 * 1024) throw Error(`Ungültige Build-Datei: ${rel}`);
    }
  }
  verify(source);
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
  return info;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2] || !process.argv[3]) throw Error('Aufruf: node scripts/export-website.mjs BUILD LEERES_ZIEL');
  const info = exportWebsite(process.argv[2], process.argv[3]);
  console.log(`Website ${info.version} aus ${info.revision} exportiert.`);
}
