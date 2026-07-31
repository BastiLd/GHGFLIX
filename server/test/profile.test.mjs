// ============================================================================
// Test: Profil-Auflösung — der Grund für „0 gesendet, 0 empfangen"
//
// Die Weboberfläche (und damit Fernseher/Handy-Browser) schickt die Profil-ID
// "local" als TEXT. Der Server führt Profile als ZAHLEN. Dadurch fand der
// Cloud-Abgleich nie etwas zum Senden, und Heruntergeladenes war für die
// Weboberfläche unsichtbar.
//
// Start:  node --experimental-sqlite test/profile.test.mjs   (Node 22)
//         node test/profile.test.mjs                          (Node 24+)
// ============================================================================
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(tmpdir(), `ghgflix-profiletest-${Date.now()}`);
mkdirSync(ROOT, { recursive: true });
process.env.DATA_DIR = ROOT;
process.env.TMDB_API_KEY = "";

const { openDb, resolveProfile } = await import("../src/db.js");
const { handleInvoke } = await import("../src/invoke.js");

let fails = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fails++;
    console.error(`✗ ${label}\n   erwartet: ${JSON.stringify(want)}\n   bekommen: ${JSON.stringify(got)}`);
  } else console.log(`✓ ${label}`);
};

const db = openDb();

// ── 1) "local" muss auf ein ECHTES Profil zeigen ───────────────────────────
const resolved = resolveProfile("local");
check("'local' wird zu einer numerischen Profil-ID", /^\d+$/.test(resolved), true);
check(
  "Die aufgelöste ID gehört zu einer echten Profilzeile",
  !!db.prepare("SELECT 1 FROM profiles WHERE id=?").get(Number(resolved)),
  true,
);
check("Unbekannter Text landet beim selben Profil", resolveProfile("irgendwas"), resolved);
check("Leere Angabe landet beim selben Profil", resolveProfile(""), resolved);

// ── 2) Eine echte numerische ID bleibt unverändert ─────────────────────────
const zweit = db.prepare("INSERT INTO profiles (name, created_at) VALUES (?,?)").run("Zweitprofil", Date.now());
const zweitId = String(Number(zweit.lastInsertRowid));
check("Bestehende Zahlen-ID bleibt erhalten", resolveProfile(zweitId), zweitId);
check("Nicht existierende Zahlen-ID fällt zurück", resolveProfile("99999"), resolved);

// ── 3) Fortschritt aus der Weboberfläche landet auffindbar ────────────────
db.prepare("INSERT INTO movies (title, path, added_at, tmdb_id) VALUES (?,?,?,?)").run(
  "Testfilm", "/tmp/testfilm.mkv", Date.now(), 603,
);
const movieId = db.prepare("SELECT id FROM movies WHERE tmdb_id=603").get().id;

await handleInvoke("set_progress", {
  profileId: "local", // genau das schickt die Weboberfläche
  mediaType: "movie",
  refId: movieId,
  positionSec: 123,
  durationSec: 8160,
  watched: false,
});

const gespeichert = db.prepare("SELECT profile_id FROM progress WHERE ref_id=?").get(movieId);
check("Fortschritt liegt unter der numerischen ID, nicht unter 'local'", String(gespeichert.profile_id), resolved);

// Genau diese Abfrage benutzt der Cloud-Abgleich zum Senden:
db.prepare("UPDATE profiles SET supabase_id='00000000-0000-0000-0000-000000000000' WHERE id=?").run(Number(resolved));
const sendbar = db
  .prepare(
    `SELECT COUNT(*) c FROM progress pr JOIN profiles p ON p.id = pr.profile_id
     WHERE p.supabase_id IS NOT NULL`,
  )
  .get().c;
check("Der Cloud-Abgleich findet die Zeile jetzt (vorher: 0)", sendbar, 1);

// ── 4) Auslesen über "local" muss dieselbe Zeile liefern ──────────────────
const gelesen = await handleInvoke("list_progress", { profileId: "local" });
check("Weboberfläche liest ihren eigenen Fortschritt wieder", gelesen.length, 1);
check("Position stimmt", gelesen[0].positionSec, 123);

// ── 5) Aus der Cloud geholte Daten sind für die Weboberfläche sichtbar ────
await handleInvoke("apply_remote_progress", {
  profileId: "local",
  rows: [{ mediaType: "movie", tmdbId: 603, season: -1, episode: -1, positionSec: 4000, durationSec: 8160, watched: false, updatedAt: Date.now() + 1000 }],
});
const nachPull = await handleInvoke("list_progress", { profileId: "local" });
check("Cloud-Stand kommt in der Weboberfläche an", nachPull[0].positionSec, 4000);

try {
  rmSync(ROOT, { recursive: true, force: true });
} catch {
  /* egal */
}

console.log(fails === 0 ? "\nAlle Profil-Tests bestanden." : `\n${fails} Test(s) fehlgeschlagen.`);
process.exit(fails === 0 ? 0 : 1);
