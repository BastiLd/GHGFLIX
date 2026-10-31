// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ enabled: false, check: vi.fn(), relaunch: vi.fn() }));
vi.mock('./platform', () => ({ get IS_TAURI() { return native.enabled; } }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: native.check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: native.relaunch }));
import { checkWebsite, compareVersions, useUpdates } from './updates';
const manifest = { app: 'ghgflix-web', version: '3.6.2', buildId: 'new-build', minimumServerVersion: '3.6.0' };
function responses(serverVersion = '3.6.1') {
  return vi.fn().mockResolvedValueOnce({ ok: true, json: async () => manifest }).mockResolvedValueOnce({ ok: true, json: async () => ({ app: 'ghgflix-server', version: serverVersion }) });
}
beforeEach(() => { native.enabled = false; useUpdates.setState({ phase: 'idle', version: '', error: '', dismissed: false }); });
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('compares versions numerically and rejects invalid versions', () => {
  expect(compareVersions('3.10.0', '3.9.5')).toBe(1);
  expect(() => compareVersions('unknown', '3.6.0')).toThrow();
});
it('checks the deployed website build separately from the API version', async () => {
  const fetcher = responses();
  await expect(checkWebsite(fetcher, 'old-build')).resolves.toMatchObject({ available: true, version: '3.6.2', serverVersion: '3.6.1' });
  expect(fetcher.mock.calls[0][1].cache).toBe('no-store');
  await expect(checkWebsite(responses(), 'new-build')).resolves.toMatchObject({ available: false });
});
it('does not advertise an incompatible website for an old backend', async () => {
  await expect(checkWebsite(responses('2.8.0'))).rejects.toThrow('mindestens Server 3.6.0');
});
it('a missing manifest is an error, never an up-to-date result', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  await useUpdates.getState().check();
  expect(useUpdates.getState().phase).toBe('error');
});
it('deduplicates native checks and respects the no-update response', async () => {
  native.enabled = true;
  let resolve!: (value: null) => void;
  native.check.mockReturnValue(new Promise(r => { resolve = r; }));
  const first = useUpdates.getState().check();
  await vi.waitFor(() => expect(native.check).toHaveBeenCalledTimes(1));
  await useUpdates.getState().check();
  resolve(null); await first;
  expect(native.check).toHaveBeenCalledTimes(1);
  expect(useUpdates.getState().phase).toBe('current');
});
it('blocks installation while playing and never restarts after signature failure', async () => {
  native.enabled = true;
  const update = { version: '3.7.0', close: vi.fn(), downloadAndInstall: vi.fn().mockRejectedValue(Error('Invalid signature')) };
  native.check.mockResolvedValue(update);
  await useUpdates.getState().check();
  await useUpdates.getState().install(true);
  expect(update.downloadAndInstall).not.toHaveBeenCalled();
  expect(useUpdates.getState().phase).toBe('available');
  await useUpdates.getState().install(false);
  expect(useUpdates.getState().phase).toBe('error');
  expect(useUpdates.getState().error).toContain('Invalid signature');
  expect(native.relaunch).not.toHaveBeenCalled();
});
it('downloads once, reports progress and relaunches only after successful install', async () => {
  native.enabled = true;
  const update = { version: '3.7.0', close: vi.fn(), downloadAndInstall: vi.fn(async callback => {
    callback({ event: 'Started', data: { contentLength: 100 } });
    callback({ event: 'Progress', data: { chunkLength: 55 } });
    expect(useUpdates.getState().progress).toBe(55);
    await useUpdates.getState().install(false);
  }) };
  native.check.mockResolvedValue(update);
  await useUpdates.getState().check();
  await useUpdates.getState().install(false);
  expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
  expect(native.relaunch).toHaveBeenCalledTimes(1);
});
