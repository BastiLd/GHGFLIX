// Disposable local server for a separately created Android emulator.
// Never point this script at an existing DATA_DIR or a user's media library.
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import sharp from "sharp";
mkdirSync("test-results", { recursive: true });
const dir = mkdtempSync(resolve("test-results/mobile-fixture-"));
process.env.DATA_DIR = dir;
for (const key of ["SHOWS_DIRS", "MOVIES_DIRS", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_USER_ID", "TMDB_API_KEY", "PUSH_CONTACT", "EXPO_PUSH_ENABLED", "EXPO_PUSH_PROJECT_ID", "EXPO_PUSH_ACCESS_TOKEN"]) process.env[key] = "";
// Only for exercising the native opt-in/error UI. No provider credentials are
// imported; run the AVD behind emulator-proxy.mjs (external requests blocked).
if (process.env.GHGFLIX_TEST_NATIVE_PUSH === "1") {
  process.env.EXPO_PUSH_ENABLED = "1";
  process.env.EXPO_PUSH_PROJECT_ID = "b14ed30d-3ecc-4465-ac79-7988b90ab0d8";
}
Object.assign(process.env, { HOST: "127.0.0.1", PORT: "19844", BROWSE_ROOTS: dir, GHGFLIX_PASSWORD: "emulator-server", GHGFLIX_ACCOUNT_SETUP_KEY:"emulator-owner-key", GHGFLIX_WEB_DIR: resolve("dist"), SCAN_INTERVAL_SEC: "99999" });
const image = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#35588c" } }).png().toBuffer();
const imageFile = join(dir, "test-group.png"); writeFileSync(imageFile, image);
const movie = join(dir, "Testfilm.mp4");
execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "90", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", movie], { stdio: "pipe", windowsHide: true });
const rss = createServer((req, res) => {
  if (req.url === "/feed") {
    res.writeHead(200, { "Content-Type": "application/rss+xml" });
    res.end('<rss><channel><title>Testkanal</title><item><guid>one</guid><title>Mars-Testbeitrag</title><link>http://10.0.2.2:19845/article</link></item></channel></rss>');
  } else { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<h1>Lokaler GHGFlix-Testbeitrag</h1>"); }
});
await new Promise((r) => rss.listen(19845, "127.0.0.1", r));
const { openDb, setSetting } = await import("../../server/src/db.js");
const db = openDb();
db.prepare("UPDATE profiles SET name='Testprofil'").run();
db.prepare("INSERT INTO movies (id,title,path,added_at) VALUES (1,'Testfilm',?,?)").run(movie, Date.now());
const converted = join(dir, "Umwandlung.mkv");
execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", movie, "-c:v", "ffv1", "-c:a", "copy", converted], { stdio: "pipe", windowsHide: true });
db.prepare("INSERT INTO movies (id,title,path,added_at) VALUES (2,'Umwandlung',?,?)").run(converted, Date.now());
db.prepare("INSERT INTO shows (id,title,added_at) VALUES (1,'Testserie',?)").run(Date.now());
db.prepare("UPDATE movies SET cert=CASE WHEN id=1 THEN '6' ELSE '18' END").run();
db.prepare("UPDATE shows SET cert='6'").run();
for (let id = 1; id <= 3; id++) {
  const episode = join(dir, `Testserie-S01E0${id}.mp4`);
  copyFileSync(movie, episode);
  db.prepare("INSERT INTO episodes (id,show_id,season,episode,title,path,added_at) VALUES (?,1,1,?,?,?,?)").run(id, id, `Folge ${id}`, episode, Date.now());
}
setSetting("feed_gruppen", JSON.stringify([{ id: "science", name: "Science", emoji: "S", sortierung: 0 }, { id: "space", name: "Space", emoji: "S", sortierung: 1 }]));
setSetting("feeds", JSON.stringify([{ id: "lab", titel: "Testkanal", art: "blog", feedUrl: "http://127.0.0.1:19845/feed", gruppeIds: ["science", "space"], benachrichtigen: true, zuletzt: Date.now() }]));
setSetting("feed_items", JSON.stringify([{ id: "lab:one", feedId: "lab", art: "blog", titel: "Mars-Testbeitrag", url: "http://10.0.2.2:19845/article", gelesen: false, gemerkt: false, gesehen: false, istShort: null, veroeffentlicht: Date.now() }]));
setSetting("feed_group_image_science", `data:image/png;base64,${image.toString("base64")}`);
writeFileSync("test-results/mobile-fixture.json", JSON.stringify({ dir, imageFile, server: "http://127.0.0.1:19844", emulatorServer: "http://10.0.2.2:19844" }, null, 2));
console.log("Isolated fixture ready: http://10.0.2.2:19844 (Android emulator),", dir);
await import("../../server/src/index.js");
