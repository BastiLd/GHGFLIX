import { create } from 'zustand';
import type { Update } from '@tauri-apps/plugin-updater';
import { IS_TAURI } from './platform';

export const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const appBuild = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
type WebBuild = { app: string; version: string; buildId: string; minimumServerVersion: string };
export function compareVersions(a: string, b: string) {
  const parts = (value: string) => {
    if (!/^\d+\.\d+\.\d+$/.test(value)) throw Error('Ungültige Versionsangabe');
    return value.split('.').map(Number);
  };
  const aa = parts(a), bb = parts(b);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return Math.sign(aa[i] - bb[i]);
  return 0;
}
export async function checkWebsite(fetcher: typeof fetch = fetch, currentBuild = appBuild) {
  const [manifestResponse, serverResponse] = await Promise.all([
    fetcher('./build-info.json', { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
    fetcher('/api/ping', { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
  ]);
  if (!manifestResponse.ok || !serverResponse.ok) throw Error('Website oder Server ist für die Update-Prüfung nicht erreichbar.');
  const manifest: WebBuild = await manifestResponse.json();
  const server = await serverResponse.json();
  if (manifest.app !== 'ghgflix-web' || !manifest.buildId || server.app !== 'ghgflix-server') throw Error('Keine gültigen GHGFlix-Updateinformationen.');
  if (compareVersions(server.version, manifest.minimumServerVersion) < 0) {
    throw Error(`Server ${server.version}: Diese Website benötigt mindestens Server ${manifest.minimumServerVersion}. Bitte zuerst den Server aktualisieren.`);
  }
  return { available: manifest.buildId !== currentBuild, version: manifest.version, serverVersion: String(server.version), buildId: manifest.buildId };
}

type UpdateState = {
  phase: 'idle' | 'checking' | 'current' | 'available' | 'installing' | 'error';
  version: string; serverVersion: string; error: string; progress: number | null;
  checkedAt: number; dismissed: boolean;
  check: () => Promise<void>; install: (playbackActive: boolean) => Promise<void>; dismiss: () => void;
};
let pending: Update | null = null;
export const useUpdates = create<UpdateState>((set, get) => ({
  phase: 'idle', version: '', serverVersion: '', error: '', progress: null, checkedAt: 0, dismissed: false,
  dismiss: () => set({ dismissed: true }),
  check: async () => {
    if (['checking', 'installing'].includes(get().phase)) return;
    const previousVersion = get().version;
    set({ phase: 'checking', error: '' });
    try {
      if (pending) { await pending.close(); pending = null; }
      if (IS_TAURI) {
        const { check } = await import('@tauri-apps/plugin-updater');
        pending = await check({ timeout: 20000 });
        const version = pending?.version || '';
        set({ phase: pending ? 'available' : 'current', version, checkedAt: Date.now(), dismissed: version === previousVersion && get().dismissed });
      } else {
        const result = await checkWebsite();
        set({ phase: result.available ? 'available' : 'current', version: result.version, serverVersion: result.serverVersion, checkedAt: Date.now(), dismissed: result.version === previousVersion && get().dismissed });
      }
    } catch (e) {
      // An unreachable/missing feed must never be presented as "up to date".
      set({ phase: 'error', error: `Update-Prüfung fehlgeschlagen: ${String(e)}`, checkedAt: Date.now() });
    }
  },
  install: async (playbackActive) => {
    if (get().phase !== 'available') return;
    if (playbackActive) { set({ error: 'Bitte zuerst die Wiedergabe einschließlich Mini-Player und Bild-in-Bild schließen.' }); return; }
    set({ phase: 'installing', error: '', progress: null });
    try {
      if (!IS_TAURI) { window.location.reload(); return; }
      if (!pending) throw Error('Bitte erneut auf Updates prüfen.');
      let received = 0, total = 0;
      await pending.downloadAndInstall(event => {
        if (event.event === 'Started') total = event.data.contentLength || 0;
        if (event.event === 'Progress') received += event.data.chunkLength;
        set({ progress: total ? Math.min(100, Math.round(received / total * 100)) : null });
      });
      // Windows exits during install; other desktop targets need an explicit restart.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      set({ phase: 'error', error: `Update nicht installiert: ${String(e)}`, progress: null });
    }
  },
}));
