import { openDb } from './db.js';
import { accountError, activeProfile } from './accounts.js';
import { personalSetting } from './account-context.js';

export function ageRating(cert) {
  const m = String(cert ?? '').trim().match(/^(?:FSK\s*(?:ab\s*)?)?(0|6|12|16|18)(?:\s*(?:Jahre|Jahren))?$/i);
  return m ? Number(m[1]) : null;
}
export function mediaAllowed(profile, type, id) {
  const db = openDb();
  const table = { movie:'movies', show:'shows', episode:'episodes', extra:'extras' }[type];
  if (!table || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) return false;
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(Number(id));
  if (!row) return false;
  if (!profile.is_child) return true;
  const cert = ['episode','extra'].includes(type) ? db.prepare('SELECT cert FROM shows WHERE id=?').get(row.show_id)?.cert : row.cert;
  const age = ageRating(cert);
  return age !== null && age <= profile.max_age;
}
export function requireMedia(profile,type,id) {
  if (!mediaAllowed(profile,type,id)) throw accountError('Inhalt nicht verfügbar.',404,'content_unavailable');
}
export function pathMedia(path) {
  const db = openDb();
  for (const [type,table] of [['movie','movies'],['episode','episodes'],['extra','extras']]) {
    const row = db.prepare(`SELECT id FROM ${table} WHERE path=?`).get(String(path ?? ''));
    if (row) return {type,id:row.id};
  }
  const f = db.prepare('SELECT episode_id id FROM episode_files WHERE path=?').get(String(path ?? ''));
  return f ? {type:'episode',id:f.id} : null;
}
export function requirePath(profile,path) {
  const media = pathMedia(path);
  if (!media) throw accountError('Datei nicht verfügbar.',404);
  requireMedia(profile,media.type,media.id);
}
export function allowedImage(profile,raw) {
  if (!profile.is_child) return true;
  const db = openDb();
  for (const [type,table,cols] of [['movie','movies',['poster','backdrop','local_poster','local_backdrop','logo']],['show','shows',['poster','backdrop','local_poster','local_backdrop','logo']],['episode','episodes',['still','local_still']]]) {
    const value=String(raw??'');
    const local=value.startsWith('local:')?value.slice(6):value;
    const where=cols.map(c=>`(${c}=? OR ${c}=?)`).join(' OR ');
    for(const row of db.prepare(`SELECT id FROM ${table} WHERE ${where}`).all(...cols.flatMap(()=>[value,local])))
      if(mediaAllowed(profile,type,row.id))return true;
  }
  return db.prepare('SELECT show_id FROM season_art WHERE path=?').all(raw).some(r=>mediaAllowed(profile,'show',r.show_id));
}
export const filterRefs = (profile,rows) => rows.filter(r=>mediaAllowed(profile,r.mediaType ?? r.media_type,r.refId ?? r.ref_id));
export const filterMedia = (profile,type,rows) => !profile.is_child?rows:rows.filter(r=>mediaAllowed(profile,type,r.id));
export function requireAdmin(session,profile) {
  if (!session.is_admin || profile?.is_child) throw accountError('Nur der Serverbesitzer kann diese Einstellung ändern.',403);
}
const clientCommands = new Set(`list_movies get_movie movie_versions list_shows get_show_detail get_episode episode_versions list_show_episodes search_episodes
  path_exists file_info set_progress get_progress list_progress continue_watching recently_watched toggle_favorite list_favorites
  set_watched set_show_watched set_season_watched get_stats tmdb_extras tmdb_videos tmdb_images get_season_art media_thumbnail trickplay_info play_info
  show_extras get_extra apply_remote_progress`.split(/\s+/));
const feedCommands = new Set(`feeds_list feed_add feed_remove feed_update feed_items feed_saved feed_format feed_watched feed_groups feed_group_add feed_group_update feed_group_remove feed_refresh feed_unread feed_mark_read push_status native_push_status native_push_subscribe native_push_unsubscribe push_subscribe push_unsubscribe`.split(/\s+/));
export function authorizeInvoke(session,cmd,a) {
  const profile = activeProfile(session,a.profileId);
  a.profileId = String(profile.id);
  // Do not let clients supply internal context or a different URL credential.
  for (const key of Object.keys(a)) if (key.startsWith('__')) delete a[key];
  if (cmd === 'get_setting' || cmd === 'set_setting') {
    const key = String(a.key ?? '');
    if (personalSetting(key)) {
      if (profile.is_child && /^feeds?$|^feed_/.test(key)) throw accountError('Kanäle sind im Kinderprofil ausgeblendet.',403);
      return profile;
    }
    if (cmd === 'get_setting' && ['server_name','accent','tmdb_lang'].includes(key)) return profile;
    if(cmd==='get_setting'&&(!session.is_admin||profile.is_child)){a.__privateSetting=true;return profile;}
    requireAdmin(session,profile);
    if (/^(account:|auth_|password$|legacy_owner_account$|profile_ids_|supabase_key$)/.test(key)) throw accountError('Geschützte Servereinstellung.',403);
    return profile;
  }
  if(cmd==='scan_status'||cmd==='is_scanning')return profile;
  if (feedCommands.has(cmd)) {
    if (profile.is_child) throw accountError('Kanäle ohne verlässliche Altersfreigabe sind im Kinderprofil ausgeblendet.',403);
    return profile;
  }
  if (!clientCommands.has(cmd)) requireAdmin(session,profile);
  if (['get_movie','movie_versions'].includes(cmd)) requireMedia(profile,'movie',a.id);
  if (cmd==='get_show_detail') requireMedia(profile,'show',a.id);
  if (['get_episode','episode_versions'].includes(cmd)) requireMedia(profile,'episode',a.id);
  if (cmd==='get_extra') requireMedia(profile,'extra',a.id);
  if (['list_show_episodes','set_show_watched','set_season_watched','get_season_art','show_extras'].includes(cmd)) requireMedia(profile,'show',a.showId);
  if (['set_progress','get_progress','toggle_favorite','set_watched'].includes(cmd)) requireMedia(profile,a.mediaType,a.refId);
  if (['play_info','path_exists','file_info','media_thumbnail','trickplay_info'].includes(cmd)) requirePath(profile,a.path);
  if (profile.is_child && ['tmdb_extras','tmdb_videos','tmdb_images','apply_remote_progress','get_stats'].includes(cmd)) throw accountError('Im Kinderprofil nicht verfügbar.',403);
  return profile;
}
export function filterInvoke(profile,cmd,result) {
  if (!profile.is_child) return result;
  if (cmd === 'list_movies' || cmd === 'movie_versions') return filterMedia(profile,'movie',result);
  if (cmd === 'list_shows') return filterMedia(profile,'show',result);
  if (cmd === 'search_episodes') return filterMedia(profile,'episode',result);
  if (cmd === 'get_show_detail' && result) return {...result,movies:filterMedia(profile,'movie',result.movies)};
  if (['list_progress','continue_watching','recently_watched','list_favorites'].includes(cmd)) return filterRefs(profile,result);
  return result;
}
export function authorizeRest(session,profile,p,url,method) {
  if (/^\/api\/(?:settings|libraries|browse|detect|scan|logout_all|supabase)(?:\/|$)/.test(p)) requireAdmin(session,profile);
  if (profile.is_child && p.startsWith('/api/sync/')) throw accountError('Abgleich im Kinderprofil nicht verfügbar.',403);
  let m = p.match(/^\/api\/(?:play|stream|transcode|hls|thumb|subs|untertitel)\/(movie|episode|extra)\/(\d+)(?:\/|$)/);
  if (m) requireMedia(profile,m[1],Number(m[2]));
  m = p.match(/^\/api\/(movies|shows)\/(\d+)$/);
  if (m) requireMedia(profile,m[1]==='movies'?'movie':'show',Number(m[2]));
  if (p==='/api/thumbfile' || p==='/api/trickplay') requirePath(profile,url.searchParams.get('path'));
  if (p==='/api/img' && !allowedImage(profile,url.searchParams.get('path'))) throw accountError('Bild nicht verfügbar.',404);
}
