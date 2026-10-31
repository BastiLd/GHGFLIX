import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportWebsite } from '../../scripts/export-website.mjs';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ghgflix-web-export-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'build'), target = join(root, 'export');
  mkdirSync(join(source, 'assets'), { recursive: true });
  writeFileSync(join(source, 'index.html'), '<script src="./assets/app.js"></script>');
  writeFileSync(join(source, 'assets/app.js'), 'console.log("built")');
  writeFileSync(join(source, 'build-info.json'), JSON.stringify({ app: 'ghgflix-web', version: '3.6.2', buildId: 'build', revision: 'a'.repeat(40) }));
  return { source, target };
}
test('exports a complete built website without copying source directories', t => {
  const { source, target } = fixture(t);
  assert.equal(exportWebsite(source, target).version, '3.6.2');
  assert.match(readFileSync(join(target, 'assets/app.js'), 'utf8'), /built/);
  assert.throws(() => exportWebsite(source, target), /leer/);
});
test('refuses secret files and source maps before any copy', t => {
  const { source, target } = fixture(t);
  writeFileSync(join(source, '.env'), 'secret');
  assert.throws(() => exportWebsite(source, target), /Nicht öffentliche/);
});
test('refuses incomplete artifacts', t => {
  const { source, target } = fixture(t);
  writeFileSync(join(source, 'index.html'), '<script src="./assets/missing.js"></script>');
  assert.throws(() => exportWebsite(source, target), /Fehlende Datei/);
});
