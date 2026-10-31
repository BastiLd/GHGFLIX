import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IS_TAURI } from '../lib/platform';
import { usePlayback } from '../lib/playback';
import { appVersion, useUpdates } from '../lib/updates';
import { useUiPrefs } from '../lib/uiPrefs';
import { openUrl } from '../lib/backend';
import { Button } from './ui';

function usePlaybackActive() {
  const active = usePlayback(s => s.mpvInited || !!s.mini || s.handoff || !!s.expandTo);
  const location = useLocation();
  return active || location.pathname.startsWith('/play/');
}

/** Mounted once after login; preference loading must finish before network work. */
export function UpdateNotice() {
  const enabled = useUiPrefs(s => s.updateCheck && s.loaded);
  const state = useUpdates();
  const active = usePlaybackActive();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      if (document.visibilityState === 'visible' && Date.now() - useUpdates.getState().checkedAt >= 15 * 60000) void useUpdates.getState().check();
    };
    check();
    const timer = setInterval(check, 60000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, [enabled]);
  if (state.phase !== 'available' || state.dismissed || active || location.pathname === '/settings') return null;
  return <aside aria-label="Update verfügbar" className="fixed bottom-20 md:bottom-6 right-4 left-4 md:left-auto z-[250] md:max-w-sm p-4 rounded-xl bg-ghg-surface2 border border-ghg-line shadow-xl">
    <p className="font-semibold">{IS_TAURI ? 'App-Update' : 'Website-Update'} {state.version} verfügbar</p>
    <div className="flex gap-2 mt-3"><Button onClick={() => navigate('/settings')}>Update ansehen</Button><Button variant="ghost" onClick={state.dismiss}>Später</Button></div>
  </aside>;
}

export function AppUpdates() {
  const state = useUpdates();
  const active = usePlaybackActive();
  const enabled = useUiPrefs(s => s.updateCheck);
  const busy = state.phase === 'checking' || state.phase === 'installing';
  const status = state.phase === 'checking' ? 'Updates werden geprüft …'
    : state.phase === 'installing' ? `Update wird heruntergeladen und installiert${state.progress === null ? ' …' : `: ${state.progress} %`}`
    : state.phase === 'available' ? `${IS_TAURI ? 'App' : 'Website'} ${state.version} ist verfügbar.`
    : state.phase === 'current' ? (IS_TAURI ? 'Die App ist aktuell.' : 'Du nutzt die auf dieser Adresse bereitgestellte Website.') : '';
  return <div className="space-y-3">
    <p className="text-sm">{IS_TAURI ? 'App' : 'Website'}: <span className="font-mono">{appVersion}</span>{state.serverVersion && <span className="ml-4">Server: <span className="font-mono">{state.serverVersion}</span></span>}</p>
    <p className="text-sm text-ghg-muted">{IS_TAURI ? 'Neue Versionen werden von GitHub geladen und vor der Installation geprüft. „Herunterladen & aktualisieren“ schließt die App; Einstellungen und Profile bleiben erhalten.' : 'WebHafen kann geprüfte Website-Versionen automatisch aus GitHub übernehmen. Mit „Website neu laden“ öffnest du den bereitgestellten Stand. Dein GHGFlix-Server wird separat aktualisiert.'}</p>
    <div className="flex gap-2 flex-wrap">
      <Button variant="ghost" disabled={busy} onClick={() => void state.check()}>Auf Updates prüfen</Button>
      {state.phase === 'available' && <Button disabled={active} onClick={() => void state.install(active)}>{IS_TAURI ? 'Herunterladen & aktualisieren' : 'Website neu laden'}</Button>}
      <Button variant="ghost" onClick={() => void openUrl('https://github.com/BastiLd/GHGFLIX/releases/latest').catch(() => {})}>Aktuelle Downloads öffnen</Button>
    </div>
    {active && state.phase === 'available' && <p className="text-sm text-ghg-muted">Zum Aktualisieren zuerst Player, Mini-Player und Bild-in-Bild schließen.</p>}
    {status && <p role="status" className="text-sm">{status}</p>}
    {state.error && <p role="alert" className="text-sm text-red-400">{state.error}</p>}
    <label className="flex gap-3 items-center text-sm"><input type="checkbox" checked={enabled} onChange={e => useUiPrefs.getState().setPref('updateCheck', e.target.checked)}/>Automatisch auf Updates prüfen</label>
  </div>;
}
