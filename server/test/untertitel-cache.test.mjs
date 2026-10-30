import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { erzeugeUntertitelCache } from "../src/untertitel-cache.js";

test("Untertitel werden geteilt, nach Neustart wiederverwendet und bei geänderter Datei neu gelesen", async () => {
  const root = await mkdtemp(join(tmpdir(), "ghgflix-ut-cache-"));
  try {
    const datei = join(root, "film.mkv"), ordner = join(root, "cache");
    await writeFile(datei, "original");
    let aufrufe = 0;
    const laden = async () => { aufrufe++; await new Promise((r) => setTimeout(r, 20)); return "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHallo\n"; };
    const cache = erzeugeUntertitelCache(ordner);
    const resultate = await Promise.all([cache(datei, 0, laden), cache(datei, 0, laden)]);
    assert.equal(aufrufe, 1); assert.equal(resultate[0], resultate[1]);
    assert.equal(await erzeugeUntertitelCache(ordner)(datei, 0, laden), resultate[0]);
    assert.equal(aufrufe, 1);
    await cache(datei, 1, laden); assert.equal(aufrufe, 2);
    await writeFile(datei, "geänderte Mediendatei");
    await cache(datei, 0, laden); assert.equal(aufrufe, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Fehler bleiben wiederholbar und fehlende Dateien lösen keine Extraktion aus", async () => {
  const root = await mkdtemp(join(tmpdir(), "ghgflix-ut-cache-"));
  try {
    const datei = join(root, "film.mkv"); await writeFile(datei, "original");
    let aufrufe = 0; const cache = erzeugeUntertitelCache();
    const laden = async () => { aufrufe++; return aufrufe === 1 ? null : "WEBVTT\n\n"; };
    assert.equal(await cache(datei, 0, laden), null);
    assert.equal(await cache(datei, 0, laden), "WEBVTT\n\n");
    assert.equal(aufrufe, 2);
    assert.equal(await cache(join(root, "fehlt.mkv"), 0, laden), null);
    assert.equal(aufrufe, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
