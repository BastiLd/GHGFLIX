import webpush from "web-push";
import { openDb } from "./db.js";
import { sendNativePosts } from "./native-push.js";

const contact = () => process.env.PUSH_CONTACT || "";
const configured = () => /^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(contact());
function database() {
  const db = openDb();
  db.exec("CREATE TABLE IF NOT EXISTS push_keys (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS push_devices (endpoint TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return db;
}
function keys() {
  const db = database();
  const row = db.prepare("SELECT value FROM push_keys WHERE id=1").get();
  if (row) return JSON.parse(row.value);
  const value = webpush.generateVAPIDKeys();
  db.prepare("INSERT INTO push_keys VALUES (1, ?)").run(JSON.stringify(value));
  return value;
}
export function pushStatus(endpoint = null) {
  const registered = typeof endpoint === "string" && !!database().prepare("SELECT 1 FROM push_devices WHERE endpoint=?").get(endpoint);
  return { configured: configured(), publicKey: configured() ? keys().publicKey : null, registered };
}
export function validateSubscription(subscription) {
  const url = new URL(subscription?.endpoint);
  const host = url.hostname;
  const allowed = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host.endsWith(".push.services.mozilla.com") || host === "web.push.apple.com" || host.endsWith(".notify.windows.com");
  if (!allowed || url.protocol !== "https:" || url.port || url.username || url.password || url.hash) throw new Error("Push-Anbieter wird nicht unterstützt");
  const k = subscription.keys;
  if (!k || !/^[A-Za-z0-9_-]+$/.test(k.p256dh) || !/^[A-Za-z0-9_-]+$/.test(k.auth) || Buffer.from(k.p256dh, "base64url").length !== 65 || Buffer.from(k.auth, "base64url").length !== 16) throw new Error("Ungültiger Push-Schlüssel");
  return { endpoint: url.href, keys: { p256dh: k.p256dh, auth: k.auth } };
}
export function subscribePush(subscription) {
  if (!configured()) throw new Error("Am Server muss PUSH_CONTACT (mailto: oder HTTPS) gesetzt sein");
  const clean = validateSubscription(subscription);
  const db = database();
  if (!db.prepare("SELECT 1 FROM push_devices WHERE endpoint=?").get(clean.endpoint) && db.prepare("SELECT COUNT(*) AS n FROM push_devices").get().n >= 100) throw new Error("Zu viele Push-Geräte");
  db.prepare("INSERT OR REPLACE INTO push_devices VALUES (?, ?)").run(clean.endpoint, JSON.stringify(clean));
  return true;
}
export function unsubscribePush(endpoint) {
  database().prepare("DELETE FROM push_devices WHERE endpoint=?").run(String(endpoint));
  return true;
}
export async function sendNewPosts(posts, feeds, send = webpush.sendNotification.bind(webpush)) {
  // Independent opt-ins: a server can use native delivery without Web Push.
  const native = sendNativePosts(posts,feeds).catch(() => console.warn("[native-push] Zustellung fehlgeschlagen"));
  try { await sendWebPosts(posts,feeds,send); } finally { await native; }
}
async function sendWebPosts(posts, feeds, send) {
  if (!configured()) return;
  const enabled = new Set(feeds.filter(f => f.benachrichtigen).map(f => f.id));
  const count = posts.filter(p => enabled.has(p.feedId)).length;
  if (!count) return;
  const db = database();
  const payload = JSON.stringify({ title: "GHGFlix", body: `${count} neue Beiträge in deinen Kanälen`, url: "/#/kanaele" });
  const vapidDetails = { subject: contact(), ...keys() };
  for (const row of db.prepare("SELECT value FROM push_devices").all()) {
    const subscription = JSON.parse(row.value);
    try { await send(subscription, payload, { vapidDetails, TTL: 3600, timeout: 10000 }); }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) unsubscribePush(subscription.endpoint);
      else console.warn("[push] Zustellung fehlgeschlagen", e.statusCode || "network");
    }
  }
}
