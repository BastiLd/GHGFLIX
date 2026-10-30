// Disposable local server for a separately created Android emulator.
// Never point this script at an existing DATA_DIR or a user's media library.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import sharp from "sharp";
mkdirSync("test-results", { recursive: true });
const dir = mkdtempSync(resolve("test-results/mobile-fixture-"));
process.env.DATA_DIR = dir;
for (const key of ["SHOWS_DIRS", "MOVIES_DIRS", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_USER_ID", "TMDB_API_KEY", "PUSH_CONTACT"]) process.env[key] = "";
Object.assign(process.env, { HOST: "127.0.0.1", PORT: "19844", BROWSE_ROOTS: dir, GHGFLIX_PASSWORD: "", GHGFLIX_WEB_DIR: resolve("dist"), SCAN_INTERVAL_SEC: "99999" });
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
setSetting("feed_gruppen", JSON.stringify([{ id: "science", name: "Science", emoji: "S", sortierung: 0 }, { id: "space", name: "Space", emoji: "S", sortierung: 1 }]));
setSetting("feeds", JSON.stringify([{ id: "lab", titel: "Testkanal", art: "blog", feedUrl: "http://127.0.0.1:19845/feed", gruppeIds: ["science", "space"], benachrichtigen: true, zuletzt: Date.now() }]));
setSetting("feed_items", JSON.stringify([{ id: "lab:one", feedId: "lab", art: "blog", titel: "Mars-Testbeitrag", url: "http://10.0.2.2:19845/article", gelesen: false, gemerkt: false, gesehen: false, istShort: null, veroeffentlicht: Date.now() }]));
setSetting("feed_group_image_science", `data:image/png;base64,${image.toString("base64")}`);
writeFileSync("test-results/mobile-fixture.json", JSON.stringify({ dir, imageFile, server: "http://127.0.0.1:19844", emulatorServer: "http://10.0.2.2:19844" }, null, 2));
console.log("Isolated fixture ready: http://10.0.2.2:19844 (Android emulator),", dir);
await import("../../server/src/index.js");
