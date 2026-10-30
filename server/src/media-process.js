import { spawn } from "node:child_process";

const pending = new WeakMap();
/** Stop only a child started by this server, including Windows launcher children. */
export function terminateMediaProcess(child) {
  if (pending.has(child)) return pending.get(child);
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Medienprozess wurde nicht rechtzeitig beendet")), 10000);
    child.once("close", () => { clearTimeout(timer); resolve(); });
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("error", () => { try { child.kill("SIGKILL"); } catch {} });
    } else {
      try { child.kill("SIGKILL"); } catch (e) { clearTimeout(timer); reject(e); }
    }
  });
  pending.set(child, done);
  return done;
}
