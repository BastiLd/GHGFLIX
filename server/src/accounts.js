import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, DATA_DIR, getSetting, setSetting,settingOr } from './db.js';
import { profileValues } from './profile.js';
import { personalSetting } from './account-context.js';

const scrypt = promisify(scryptCallback);
const TTL = 30 * 24 * 60 * 60 * 1000;
export const digest = value => createHash('sha256').update(String(value)).digest('hex');
export const accountError = (message, status = 400, code = 'account_error') => Object.assign(Error(message), { status, code });
const fail = (message, status = 400, code) => { throw accountError(message, status, code); };
const setupPath = join(DATA_DIR, 'account-setup-key');
const hasOwner = () => !!openDb().prepare('SELECT 1 FROM accounts WHERE is_admin=1').get();
export function initializeAccounts() {
  if (!hasOwner() && !process.env.GHGFLIX_ACCOUNT_SETUP_KEY && !existsSync(setupPath)) {
    writeFileSync(setupPath, randomBytes(24).toString('base64url'), { flag: 'wx', mode: 0o600 });
    console.log('[accounts] Besitzer-Account einrichten. Einmaliger Schlüssel liegt in DATA_DIR/account-setup-key.');
  }
}
const registrationAllowed=()=>process.env.GHGFLIX_REGISTRATION!=='off'&&!!settingOr('password','GHGFLIX_PASSWORD','');
export const accountStatus = () => ({ required: true, setupNeeded: !hasOwner(), registration: registrationAllowed() });
export function cleanEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Bitte eine gültige E-Mail-Adresse eingeben.');
  return email;
}
function checkPassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) fail('Das Passwort muss 10 bis 128 Zeichen lang sein.');
}
let hashing = 0;
async function derive(password, salt) {
  if (hashing >= 4) fail('Anmeldung ausgelastet. Bitte kurz warten.', 429);
  hashing++;
  try { return await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); }
  finally { hashing--; }
}
export async function hashPassword(password) {
  checkPassword(password);
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  // Unknown users take the same expensive path as a wrong password.
  const [, salt = '00000000000000000000000000000000', expected = '0'.repeat(128)] = String(encoded || '').split(':');
  if (typeof password !== 'string' || password.length > 128) return false;
  const actual = await derive(password, salt), target = Buffer.from(expected, 'hex');
  return target.length === actual.length && timingSafeEqual(actual, target);
}
const attempts = new Map();
export async function limitedLogin(ip, email, operation) {
  const keys = [`ip:${ip}`, `email:${String(email).trim().toLowerCase().slice(0,254)}`];
  const now = Date.now();
  for (const [k,v] of attempts) if (v.until <= now) attempts.delete(k);
  if (attempts.size > 4000) fail('Anmeldung ausgelastet. Bitte später versuchen.', 429);
  for (const key of keys) {
    const a = attempts.get(key) ?? { count: 0, until: now + 5 * 60_000 };
    if (a.count >= (key.startsWith('ip:') ? 100 : 8)) fail('Zu viele Versuche. Bitte 5 Minuten warten.', 429);
    a.count++; attempts.set(key, a);
  }
  const result=await operation();
  attempts.delete(keys[1]); // Only the IP budget counts successful requests.
  return result;
}
export function sessionFor(token) {
  if (!token || token.length > 150) return null;
  return openDb().prepare(`SELECT s.*,a.email,a.is_admin FROM account_sessions s
    JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?`).get(digest(token), Date.now()) ?? null;
}
export function newSession(id, serverTokenHash) {
  const db = openDb(), token = randomBytes(32).toString('base64url'), now = Date.now();
  db.prepare('DELETE FROM account_sessions WHERE expires_at<=?').run(now);
  db.prepare(`DELETE FROM account_sessions WHERE token_hash IN
    (SELECT token_hash FROM account_sessions WHERE account_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 19)`).run(id);
  db.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?)').run(digest(token), id, serverTokenHash, null, now, now + TTL);
  return { token, ...sessionInfo(sessionFor(token)) };
}
export function sessionInfo(session) {
  return { account: { id: session.account_id, email: session.email, isAdmin: !!session.is_admin },
    profile: session.profile_id ? ownedProfile(session, session.profile_id) : null, expiresAt: session.expires_at };
}
export async function registerAccount(body, serverTokenHash, setup = false) {
  const db = openDb(), email = cleanEmail(body.email);
  if (setup) {
    if (hasOwner()) fail('Der Besitzer-Account wurde bereits eingerichtet.', 409);
    const key = process.env.GHGFLIX_ACCOUNT_SETUP_KEY || (existsSync(setupPath) ? readFileSync(setupPath,'utf8').trim() : '');
    if (!key || digest(body.setupKey ?? '') !== digest(key)) fail('Besitzer-Schlüssel ungültig.', 403);
  } else {
    if (!registrationAllowed()) fail('Registrierung ist am Server ausgeschaltet. Für neue Accounts muss ein Server-Passwort eingerichtet sein.', 403);
    if(digest(body.serverPassword??'')!==digest(settingOr('password','GHGFLIX_PASSWORD',''))) fail('Zum Erstellen eines neuen Accounts bitte das Server-Passwort erneut eingeben.',403);
  }
  const passwordHash = await hashPassword(body.password);
  db.exec('BEGIN IMMEDIATE');
  let id;
  try {
    if (setup && hasOwner()) fail('Der Besitzer-Account wurde bereits eingerichtet.', 409);
    if (db.prepare('SELECT 1 FROM accounts WHERE email=?').get(email)) fail('Account konnte nicht erstellt werden. Bitte anmelden oder eine andere Adresse verwenden.', 409);
    id = Number(db.prepare('INSERT INTO accounts(email,password_hash,is_admin,created_at) VALUES(?,?,?,?)').run(email,passwordHash,setup?1:0,Date.now()).lastInsertRowid);
    if (setup) {
      db.prepare('UPDATE profiles SET account_id=? WHERE account_id IS NULL').run(id);
      setSetting('legacy_owner_account', String(id));
      // Existing channel subscriptions belong to the owner, never to a guest.
      for (const row of db.prepare('SELECT key,value FROM settings').all().filter(r=>personalSetting(r.key)))
        db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run(`account:${id}:${row.key}`,row.value);
      for (const table of ['push_devices','native_push_devices']) if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all();
        if (!cols.some(c=>c.name==='account_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN account_id INTEGER NOT NULL DEFAULT 0`);
        db.prepare(`UPDATE ${table} SET account_id=? WHERE account_id=0`).run(id);
      }
    }
    if (!db.prepare('SELECT 1 FROM profiles WHERE account_id=?').get(id))
      db.prepare('INSERT INTO profiles(name,created_at,updated_at,account_id) VALUES(?,?,?,?)').run('Standard',Date.now(),Date.now(),id);
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
  if (setup && existsSync(setupPath)) rmSync(setupPath);
  return newSession(id, serverTokenHash);
}
export async function loginAccount(body, serverTokenHash) {
  const user = openDb().prepare('SELECT * FROM accounts WHERE email=?').get(String(body.email ?? '').trim().toLowerCase());
  const valid = await verifyPassword(body.password, user?.password_hash);
  if (!valid || !user) fail('E-Mail oder Passwort falsch.', 401, 'invalid_credentials');
  return newSession(user.id, serverTokenHash);
}
export async function claimOwner(session,body) {
  await confirmPassword(session,body.password);
  if(hasOwner())fail('Der Besitzer-Account ist bereits eingerichtet.',409);
  const key=process.env.GHGFLIX_ACCOUNT_SETUP_KEY||(existsSync(setupPath)?readFileSync(setupPath,'utf8').trim():'');
  if(!key||digest(body.setupKey??'')!==digest(key))fail('Besitzer-Schlüssel ungültig.',403);
  const db=openDb();db.exec('BEGIN IMMEDIATE');
  try{
    if(hasOwner())fail('Der Besitzer-Account ist bereits eingerichtet.',409);
    for(const p of db.prepare('SELECT id,name FROM profiles WHERE account_id IS NULL').all()) {
      let name=p.name,n=1;
      while(db.prepare('SELECT 1 FROM profiles WHERE account_id=? AND name=?').get(session.account_id,name))name=p.name.slice(0,25)+` (bisher ${n++})`;
      db.prepare('UPDATE profiles SET account_id=?,name=? WHERE id=?').run(session.account_id,name,p.id);
    }
    setSetting('legacy_owner_account',String(session.account_id));
    for(const r of db.prepare('SELECT key,value FROM settings').all().filter(r=>personalSetting(r.key))) {
      const target=`account:${session.account_id}:${r.key}`;
      const previous=db.prepare('SELECT value FROM settings WHERE key=?').get(target)?.value;
      let value=r.value;
      if(previous&&['feeds','feed_items','feed_gruppen'].includes(r.key)){
        const current=JSON.parse(previous),legacy=JSON.parse(r.value);
        if(Array.isArray(current)&&Array.isArray(legacy))value=JSON.stringify([...new Map([...legacy,...current].map(x=>[x.id,x])).values()]);
      }else if(previous)value=previous;
      db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(target,value);
    }
    for(const table of ['push_devices','native_push_devices'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)){
      if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='account_id'))db.exec(`ALTER TABLE ${table} ADD COLUMN account_id INTEGER NOT NULL DEFAULT 0`);
      db.prepare(`UPDATE ${table} SET account_id=? WHERE account_id=0`).run(session.account_id);
    }
    db.prepare('UPDATE accounts SET is_admin=1 WHERE id=?').run(session.account_id);
    db.prepare('DELETE FROM account_sessions WHERE token_hash=?').run(session.token_hash);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  if(existsSync(setupPath))rmSync(setupPath);
  return newSession(session.account_id,session.server_token_hash);
}
export function logoutAccount(session) { openDb().prepare('DELETE FROM account_sessions WHERE token_hash=?').run(session.token_hash); }
export async function confirmPassword(session, password) {
  const hash = openDb().prepare('SELECT password_hash FROM accounts WHERE id=?').get(session.account_id)?.password_hash;
  if (!await verifyPassword(password,hash)) fail('Account-Passwort falsch.', 403, 'password_required');
}
export async function changePassword(session, body) {
  await confirmPassword(session,body.currentPassword);
  const hash = await hashPassword(body.newPassword), db = openDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE accounts SET password_hash=? WHERE id=?').run(hash,session.account_id);
    db.prepare('DELETE FROM account_sessions WHERE account_id=?').run(session.account_id);
    for (const table of ['push_devices','native_push_devices']) {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
        db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(session.account_id);
    }
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
  return newSession(session.account_id,session.server_token_hash);
}
export function ownedProfile(session, id) {
  const p = openDb().prepare('SELECT id,name,avatar,is_child,max_age,updated_at,pin_hash IS NOT NULL has_pin FROM profiles WHERE id=? AND account_id=?').get(Number(id),session.account_id);
  if (!p) fail('Profil nicht gefunden.',404,'profile_missing');
  return p;
}
export function accountProfiles(session) {
  return openDb().prepare('SELECT id,name,avatar,is_child,max_age,updated_at,pin_hash IS NOT NULL has_pin FROM profiles WHERE account_id=? ORDER BY id').all(session.account_id);
}
export function activeProfile(session, requested) {
  if (!session.profile_id) fail('Bitte ein Profil auswählen.',409,'profile_required');
  const p = ownedProfile(session,session.profile_id);
  // The session, not a client-controlled profile parameter, selects the identity.
  if (requested && requested !== 'local' && String(requested) !== String(p.id)) fail('Bitte dieses Profil zuerst auswählen.',403,'profile_mismatch');
  return p;
}
export async function selectProfile(session, body) {
  const target = ownedProfile(session,body.id);
  const previous = session.profile_id ? ownedProfile(session,session.profile_id) : null;
  const pinHash = openDb().prepare('SELECT pin_hash FROM profiles WHERE id=?').get(target.id).pin_hash;
  if (pinHash) {
    if (!/^\d{6}$/.test(body.pin ?? '') || !await verifyPassword(body.pin,pinHash)) fail('Profil-PIN falsch.',403,'pin_required');
  } else if (previous?.is_child && (!target.is_child || target.max_age > previous.max_age)) await confirmPassword(session,body.password);
  openDb().prepare('UPDATE account_sessions SET profile_id=? WHERE token_hash=?').run(target.id,session.token_hash);
  return target;
}
export async function saveAccountProfile(session, id, body) {
  // Profile management always requires the personal password, including an
  // adult profile in another tab that was selected before the child's session.
  await confirmPassword(session,body.password);
  const db = openDb(), old = id ? ownedProfile(session,id) : null;
  const values = profileValues({...body,avatar:body.avatar===undefined?old?.avatar:body.avatar});
  const child = body.is_child === undefined ? !!old?.is_child : body.is_child === true || body.is_child === 1;
  const age = body.max_age === undefined ? old?.max_age ?? 12 : Number(body.max_age);
  if (![0,6,12,16].includes(age)) fail('Bitte eine Altersgrenze von 0, 6, 12 oder 16 wählen.');
  let pinHash;
  if (body.pin !== undefined) {
    if (body.pin !== '' && !/^\d{6}$/.test(body.pin)) fail('Die Profil-PIN muss genau sechs Ziffern enthalten.');
    const salt = randomBytes(16).toString('hex');
    pinHash = body.pin === '' ? null : `scrypt:${salt}:${(await derive(body.pin,salt)).toString('hex')}`;
  }
  if (!id && accountProfiles(session).length >= 12) fail('Maximal 12 Profile pro Account.');
  try {
    if (id) db.prepare('UPDATE profiles SET name=?,avatar=?,is_child=?,max_age=?,updated_at=? WHERE id=? AND account_id=?').run(values.name,values.avatar,child?1:0,age,Date.now(),Number(id),session.account_id);
    else id = Number(db.prepare('INSERT INTO profiles(name,avatar,is_child,max_age,created_at,updated_at,account_id) VALUES(?,?,?,?,?,?,?)').run(values.name,values.avatar,child?1:0,age,Date.now(),Date.now(),session.account_id).lastInsertRowid);
  } catch(e) { if(String(e).includes('UNIQUE')) fail('In deinem Account gibt es bereits ein Profil mit diesem Namen.'); throw e; }
  if (pinHash !== undefined) openDb().prepare('UPDATE profiles SET pin_hash=? WHERE id=?').run(pinHash,Number(id));
  if (old && (old.is_child !== Number(child) || old.max_age !== age || pinHash !== undefined))
    db.prepare('DELETE FROM account_sessions WHERE profile_id=? AND token_hash<>?').run(Number(id),session.token_hash);
  return ownedProfile(session,id);
}
export async function deleteAccountProfile(session, id, body) {
  await confirmPassword(session,body.password);
  ownedProfile(session,id);
  const db = openDb();
  if (accountProfiles(session).length <= 1) fail('Das letzte Profil kann nicht gelöscht werden.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const cloud = db.prepare('SELECT supabase_id FROM profiles WHERE id=?').get(Number(id))?.supabase_id;
    if (cloud) db.prepare('INSERT OR IGNORE INTO deleted_cloud_profiles VALUES(?)').run(cloud);
    for (const table of ['progress','pending_progress','favorites','favorite_sync']) db.prepare(`DELETE FROM ${table} WHERE profile_id=?`).run(Number(id));
    // Revoke devices currently using this profile; no fallback to somebody else.
    db.prepare('DELETE FROM account_sessions WHERE profile_id=?').run(Number(id));
    db.prepare('DELETE FROM profiles WHERE id=? AND account_id=?').run(Number(id),session.account_id);
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
  return {ok:true};
}
