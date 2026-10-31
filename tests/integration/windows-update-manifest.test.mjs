import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateManifest } from '../../scripts/windows-update-manifest.mjs';
test('matches MSI and NSIS without changing the installation type', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ghgflix-manifest-')); t.after(() => rmSync(dir, { force: true, recursive: true }));
  const files = ['GHGFlix_3.6.2_x64-setup.exe', 'GHGFlix_3.6.2_x64_en-US.msi'].map(name => join(dir, name));
  for (const file of files) { writeFileSync(file, 'test fixture'); writeFileSync(file + '.sig', Buffer.from('signature fixture').toString('base64')); }
  const result = updateManifest('3.6.2', files);
  assert.match(result.platforms['windows-x86_64-msi'].url, /\.msi$/);
  assert.match(result.platforms['windows-x86_64-nsis'].url, /-setup\.exe$/);
  assert.throws(() => updateManifest('3.6.3', files), /version/);
  assert.throws(() => updateManifest('3.6.2', files.slice(0, 1)), /Both/);
  rmSync(files[0] + '.sig'); assert.throws(() => updateManifest('3.6.2', files), /signature missing/);
});
