import { createHash } from "node:crypto";
import { stat, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Große MKVs müssen für eine Textspur vollständig gelesen werden. Ergebnisse
 * werden deshalb geteilt und im Server-Datenordner statt bei den Filmen abgelegt. */
export function erzeugeUntertitelCache(ordner = null) {
  const laufend = new Map(), fertig = new Map();
  return async (datei, spur, laden) => {
    let info;
    try { info = await stat(datei); } catch { return null; }
    const key = createHash("sha256").update(JSON.stringify([resolve(datei), info.size, info.mtimeMs, spur])).digest("hex");
    if (fertig.has(key)) return fertig.get(key);
    if (laufend.has(key)) return laufend.get(key);
    const job = (async () => {
      const ziel = ordner && join(ordner, `${key}.vtt`);
      let vtt;
      if (ziel) { try { vtt = await readFile(ziel, "utf8"); } catch {} }
      if (!vtt?.startsWith("WEBVTT")) {
        vtt = await laden();
        // Fehlgeschlagene Extraktionen dürfen einen späteren Versuch nicht vergiften.
        if (!vtt?.startsWith("WEBVTT")) return null;
        if (ziel) { try { await mkdir(ordner, { recursive: true }); await writeFile(ziel, vtt, "utf8"); } catch {} }
      }
      fertig.set(key, vtt);
      if (fertig.size > 32) fertig.delete(fertig.keys().next().value);
      return vtt;
    })();
    laufend.set(key, job);
    try { return await job; } finally { laufend.delete(key); }
  };
}
