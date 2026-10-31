import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function updateManifest(version, files, repo = 'BastiLd/GHGFLIX') {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Stable version required');
  const platforms = {};
  for (const file of files) {
    if (!existsSync(file) || !existsSync(file + '.sig')) throw Error('Installer/signature missing');
    const signature = readFileSync(file + '.sig', 'utf8').trim();
    if (!signature || !/^[A-Za-z0-9+/=]+$/.test(signature)) throw Error('Invalid signature encoding');
    const name = basename(file);
    if (!name.includes(version) || !(/_x64-setup\.exe$/.test(name) || /_x64_en-US\.msi$/.test(name))) throw Error('Unexpected installer/version');
    const type = name.endsWith('.msi') ? 'msi' : 'nsis';
    platforms[`windows-x86_64-${type}`] = { signature, url: `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(name)}` };
  }
  if (!platforms['windows-x86_64-nsis'] || !platforms['windows-x86_64-msi']) throw Error('Both Windows installer types are required');
  // Older Tauri updater clients use the platform without an installer suffix.
  platforms['windows-x86_64'] = platforms['windows-x86_64-nsis'];
  return { version, notes: `GHGFlix ${version}`, pub_date: new Date().toISOString(), platforms };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const bundle = process.argv[2] || 'src-tauri/target/release/bundle';
  const files = [join(bundle, 'nsis', `GHGFlix_${version}_x64-setup.exe`), join(bundle, 'msi', `GHGFlix_${version}_x64_en-US.msi`)];
  writeFileSync(process.argv[3] || 'latest.json', JSON.stringify(updateManifest(version, files), null, 2) + '\n');
  console.log(`Signed update manifest for ${version} generated.`);
}
