import { currentAccountId,accountContext } from './account-context.js';
import { openDb, getSetting } from "./db.js";

const project = () => process.env.EXPO_PUSH_PROJECT_ID || "";
const configured = () => process.env.EXPO_PUSH_ENABLED === "1" && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(project());
const validToken = (t) => typeof t === "string" && /^(Expo|Exponent)PushToken\[[\w-]{10,200}\]$/.test(t);
function database() {
  const db = openDb();
  db.exec(`CREATE TABLE IF NOT EXISTS native_push_devices (token TEXT PRIMARY KEY, project TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS native_push_receipts (id TEXT PRIMARY KEY, token TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  if(!db.prepare("PRAGMA table_info(native_push_devices)").all().some(c=>c.name==='account_id')) db.exec("ALTER TABLE native_push_devices ADD COLUMN account_id INTEGER NOT NULL DEFAULT 0");
  return db;
}
function tokens(value) {
  if (!Array.isArray(value) || value.length > 100 || value.some(t => !validToken(t))) throw new Error("Ungültige Geräteanmeldung");
  return [...new Set(value)];
}
export function nativePushStatus(known = []) {
  const db = database();
  return { configured: configured(), projectId: configured() ? project() : null,
    registered: tokens(known).some(t => !!db.prepare("SELECT 1 FROM native_push_devices WHERE token=? AND project=? AND account_id=?").get(t,project(),currentAccountId())) };
}
export function subscribeNativePush(token, projectId, previous = []) {
  if (!configured()) throw new Error("Native Geräte-Push ist am Server noch nicht eingerichtet");
  if (projectId !== project() || !validToken(token)) throw new Error("Geräteanmeldung passt nicht zum eingerichteten App-Projekt");
  const old = tokens(previous), db = database();
  const replacing = old.some(t => !!db.prepare("SELECT 1 FROM native_push_devices WHERE token=? AND project=? AND account_id=?").get(t,projectId,currentAccountId()));
  if (!db.prepare("SELECT 1 FROM native_push_devices WHERE token=?").get(token) &&
      !replacing && db.prepare("SELECT COUNT(*) n FROM native_push_devices").get().n >= 100) throw new Error("Zu viele Push-Geräte");
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM native_push_receipts WHERE token=?").run(token);
    db.prepare("INSERT OR REPLACE INTO native_push_devices(token,project,account_id) VALUES (?,?,?)").run(token,projectId,currentAccountId());
    for (const t of old) if (t !== token && db.prepare("SELECT 1 FROM native_push_devices WHERE token=? AND account_id=?").get(t,currentAccountId())) {
      db.prepare("DELETE FROM native_push_devices WHERE token=? AND project=? AND account_id=?").run(t,projectId,currentAccountId());
      db.prepare("DELETE FROM native_push_receipts WHERE token=?").run(t);
    }
    db.exec("COMMIT");
  } catch(e) { db.exec("ROLLBACK"); throw e; }
  return true;
}
export function unsubscribeNativePush(known) {
  const db = database();
  for (const t of tokens(known)) {
    if(!db.prepare("SELECT 1 FROM native_push_devices WHERE token=? AND account_id=?").get(t,currentAccountId()))continue;
    db.prepare("DELETE FROM native_push_devices WHERE token=? AND account_id=?").run(t,currentAccountId());
    db.prepare("DELETE FROM native_push_receipts WHERE token=?").run(t);
  }
  return true;
}
async function request(path, body, transport) {
  const response = await transport(`https://exp.host/--/api/v2/push/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json",
      ...(process.env.EXPO_PUSH_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Push-Anbieter antwortet mit HTTP ${response.status}`);
  const result = await response.json();
  if (result.errors?.length || !result.data) throw new Error("Push-Anbieter hat die Anfrage abgelehnt");
  return result.data;
}
export async function sendNativePosts(posts, feeds, transport = fetch) {
  if (!configured()) return;
  const enabled = new Set(feeds.filter(f => f.benachrichtigen).map(f => f.id));
  const count = posts.filter(p => enabled.has(p.feedId)).length;
  if (!count) return;
  const db = database();
  const devices = db.prepare("SELECT token FROM native_push_devices WHERE project=? AND account_id=?").all(project(),currentAccountId());
  if (!devices.length) return;
  const messages = devices.map(({token}) => ({ to: token, title: "GHGFlix", body: `${count} neue Beiträge in deinen Kanälen`,
    channelId: "kanaele", ttl: 3600, data: { screen: "channels", serverId: getSetting("server_id") } }));
  const tickets = await request("send", messages, transport);
  if (!Array.isArray(tickets) || tickets.length !== devices.length) throw new Error("Unvollständige Push-Bestätigung");
  tickets.forEach((ticket,i) => {
    const token=devices[i].token;
    // Do not reintroduce an entry after an in-flight unsubscribe/renewal.
    if (!db.prepare("SELECT 1 FROM native_push_devices WHERE token=? AND account_id=?").get(token,currentAccountId())) return;
    if (ticket.status === "ok" && typeof ticket.id === "string") {
      db.prepare("INSERT OR REPLACE INTO native_push_receipts VALUES (?,?,?)").run(ticket.id,token,Date.now());
    } else if (ticket.details?.error === "DeviceNotRegistered") unsubscribeNativePush([token]);
    else console.warn("[native-push] Anbieter hat eine Meldung abgelehnt");
  });
}
let checking = false;
export async function checkNativeReceipts(transport = fetch, now = Date.now()) {
  if (!configured() || checking) return;
  checking = true;
  try {
    const db=database();
    db.prepare("DELETE FROM native_push_receipts WHERE created_at < ?").run(now-24*3600_000);
    const rows=db.prepare(`SELECT r.id,r.token,d.account_id FROM native_push_receipts r JOIN native_push_devices d ON d.token=r.token
      WHERE d.project=? AND r.created_at <= ? LIMIT 100`).all(project(),now-15*60_000);
    if (!rows.length) return;
    const receipts=await request("getReceipts",{ids:rows.map(r=>r.id)},transport);
    for (const row of rows) {
      const receipt=receipts[row.id];
      if (!receipt || !db.prepare("SELECT 1 FROM native_push_receipts WHERE id=?").get(row.id)) continue;
      if (receipt.details?.error === "DeviceNotRegistered") accountContext.run({accountId:row.account_id},()=>unsubscribeNativePush([row.token]));
      else if (receipt.status !== "ok") console.warn("[native-push] Zustellung nicht bestätigt");
      db.prepare("DELETE FROM native_push_receipts WHERE id=?").run(row.id);
    }
  } finally { checking=false; }
}
