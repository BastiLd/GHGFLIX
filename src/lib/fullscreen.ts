/** Serialize window transitions across route changes and PiP. */
export function createFullscreenController(window: { isFullscreen(): Promise<boolean>; setFullscreen(on: boolean): Promise<void> }) {
  let current = false;
  let revision = 0;
  let pending = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(on: boolean) => void>();
  const publish = (on: boolean) => { current = on; listeners.forEach((fn) => fn(on)); };
  const change = (target: boolean | null) => {
    ++revision; ++pending;
    const task = tail.catch(() => {}).then(async () => {
      const on = target ?? !current;
      await window.setFullscreen(on);
      publish(on);
    });
    tail = task.finally(() => { --pending; });
    // Keep the queue usable after a rejected OS/browser request.
    void tail.catch(() => {});
    return task;
  };
  return {
    subscribe(fn: (on: boolean) => void) { listeners.add(fn); fn(current); return () => { listeners.delete(fn); }; },
    async sync() {
      if (pending) return;
      const version = revision;
      const on = await window.isFullscreen();
      if (!pending && version === revision) publish(on);
    },
    toggle: () => change(null),
    exit: () => change(false),
  };
}
