// Profilbilder bleiben kleine, private JPEG/PNG/WebP-Daten im geschützten Profil.
// Dadurch funktionieren sie offline und auf TV, ohne öffentliche Bild-Buckets.
import { openDb } from './db.js';

export function profileValues(body) {
  const name = String(body.name ?? '').trim();
  if (!name || name.length > 40) throw Error('Bitte einen Namen mit 1 bis 40 Zeichen eingeben.');
  const avatar = body.avatar || null;
  if (avatar && (typeof avatar !== 'string' || avatar.length > 180000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar))) {
    throw Error('Bitte ein kleines JPG-, PNG- oder WebP-Profilbild wählen.');
  }
  return { name, avatar };
}
export function listServerProfiles() {
  return openDb().prepare('SELECT id,name,avatar,supabase_id,updated_at FROM profiles ORDER BY id').all();
}
export function saveServerProfile(id, body) {
  const d = openDb(), previous=id==null?null:d.prepare('SELECT avatar FROM profiles WHERE id=?').get(id);
  // Der TV ändert nur den Namen. Ein inzwischen am Handy gewähltes Bild erhalten.
  const values = profileValues({...body,avatar:body.avatar===undefined?previous?.avatar:body.avatar}), stamp = Date.now();
  if (id != null) {
    if (!d.prepare('SELECT id FROM profiles WHERE id=?').get(id)) throw Error('Profil nicht gefunden.');
    d.prepare('UPDATE profiles SET name=?,avatar=?,updated_at=? WHERE id=?').run(values.name,values.avatar,stamp,id);
  } else {
    id = Number(d.prepare('INSERT INTO profiles(name,avatar,created_at,updated_at) VALUES(?,?,?,?)').run(values.name,values.avatar,stamp,stamp).lastInsertRowid);
  }
  return listServerProfiles().find(p => p.id === Number(id));
}

// Eine Entfernung ist ebenfalls eine Änderung. Ohne Tombstone käme der Titel
// beim nächsten Cloud-Pull sofort zurück. TMDb-Koordinaten überleben Neu-Scans.
export function recordFavorite(db, profileId, mediaType, refId, removed) {
  const table = mediaType === 'movie' ? 'movies' : 'shows';
  const tmdb = db.prepare(`SELECT tmdb_id FROM ${table} WHERE id=?`).get(refId)?.tmdb_id;
  if (!tmdb) return;
  const stamp = Date.now();
  db.prepare(`INSERT INTO favorite_sync(profile_id,media_type,tmdb_id,added_at,removed,updated_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,media_type,tmdb_id) DO UPDATE SET
    added_at=excluded.added_at,removed=excluded.removed,updated_at=excluded.updated_at`).run(profileId,mediaType,tmdb,stamp,removed?1:0,stamp);
}

export function favoriteStates(profileId) {
  const d=openDb();
  d.prepare(`INSERT OR IGNORE INTO favorite_sync(profile_id,media_type,tmdb_id,added_at,removed,updated_at)
    SELECT f.profile_id,f.media_type,coalesce(m.tmdb_id,s.tmdb_id),f.added_at,0,f.added_at FROM favorites f
    LEFT JOIN movies m ON f.media_type='movie' AND m.id=f.ref_id LEFT JOIN shows s ON f.media_type='show' AND s.id=f.ref_id
    WHERE f.profile_id=? AND coalesce(m.tmdb_id,s.tmdb_id) IS NOT NULL`).run(profileId);
  return d.prepare('SELECT media_type,tmdb_id,added_at,removed,updated_at FROM favorite_sync WHERE profile_id=?').all(profileId).map(r=>({...r,removed:!!r.removed}));
}
export function applyFavoriteStates(profileId,rows) {
  const d=openDb();favoriteStates(profileId);
  for(const r of rows.slice(0,500)){
    if(!['movie','show'].includes(r.media_type)||!Number.isSafeInteger(r.tmdb_id)||r.tmdb_id<=0||!Number.isFinite(r.updated_at)||!Number.isFinite(r.added_at))throw Error('Ungültiger Merklisten-Eintrag.');
    const old=d.prepare('SELECT updated_at FROM favorite_sync WHERE profile_id=? AND media_type=? AND tmdb_id=?').get(profileId,r.media_type,r.tmdb_id);
    if(old&&old.updated_at>=r.updated_at)continue;
    d.prepare(`INSERT INTO favorite_sync VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,media_type,tmdb_id) DO UPDATE SET
      added_at=excluded.added_at,removed=excluded.removed,updated_at=excluded.updated_at`).run(profileId,r.media_type,r.tmdb_id,r.added_at,r.removed?1:0,r.updated_at);
    const ref=d.prepare(`SELECT id FROM ${r.media_type==='movie'?'movies':'shows'} WHERE tmdb_id=?`).get(r.tmdb_id)?.id;
    if(!ref)continue;
    if(r.removed)d.prepare('DELETE FROM favorites WHERE profile_id=? AND media_type=? AND ref_id=?').run(profileId,r.media_type,ref);
    else d.prepare('INSERT OR IGNORE INTO favorites VALUES(?,?,?,?)').run(profileId,r.media_type,ref,r.added_at);
  }
}
