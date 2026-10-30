import { IS_WEB, webToken } from "./platform";
import { getSetting,setSetting } from "./api";
import { initSupabase,getSession,listProfiles,createProfile,updateProfile,ensureCloudProfile } from "./supabase";
import { loadServerConfig,serverProfileRequest } from "./serverSync";
import { useStore } from "./store";
export interface Profile { id:string; name:string; avatar:string|null; cloud?:boolean }
async function request(path:string,method="GET",body?:unknown){
  const r=await fetch(path,{method,headers:{"Content-Type":"application/json",Authorization:`Bearer ${webToken()}`},body:body?JSON.stringify(body):undefined});
  const data=await r.json();if(!r.ok)throw Error(data.error||"Profile konnten nicht geladen werden.");return data;
}
export async function availableProfiles():Promise<Profile[]>{
  if(IS_WEB)return (await request('/api/profiles')).map((p:Profile)=>({...p,id:String(p.id),cloud:!!(p as unknown as {supabase_id:string}).supabase_id}));
  const cfg=await loadServerConfig();
  if(cfg.enabled){
    const ps=await serverProfileRequest<{id:number;name:string;avatar:string|null;supabase_id:string|null}[]>('/api/profiles');
    const links=JSON.parse((await getSetting('server_profile_links'))||'{}');
    return ps.map(p=>({id:ps.length===1||links.local===p.id?'local':'server:'+p.id,name:p.name,avatar:p.avatar,cloud:true}));
  }
  await initSupabase();
  const state=useStore.getState();
  if(await getSession()){
    const linked=await ensureCloudProfile('local',state.profileName);
    return (await listProfiles()).map(p=>({...p,id:p.id===linked?'local':p.id,cloud:true}));
  }
  return [{id:'local',name:(await getSetting('local_profile_name'))||state.profileName,avatar:(await getSetting('local_profile_avatar'))||null}];
}
export async function saveProfile(id:string|null,name:string,avatar:string|null):Promise<void>{
  if(!name.trim()||name.trim().length>40)throw Error('Bitte einen Namen mit 1 bis 40 Zeichen eingeben.');
  if(IS_WEB){await request(id?'/api/profiles/'+id:'/api/profiles',id?'PATCH':'POST',{name,avatar});return;}
  if((await loadServerConfig()).enabled){
    const ps=await serverProfileRequest<{id:number;name:string}[]>('/api/profiles');
    const links=JSON.parse((await getSetting('server_profile_links'))||'{}');
    const target=id==='local'?(links.local|| (ps.length===1?ps[0].id:null)):id?.replace('server:','');
    if(id&&!target)throw Error('Bitte zuerst das Server-Profil auswählen.');
    await serverProfileRequest(target?'/api/profiles/'+target:'/api/profiles',target?'PATCH':'POST',{name,avatar});return;
  }
  await initSupabase();
  if(await getSession()){
    const cloud=id?await ensureCloudProfile(id,name):null;
    if(cloud)await updateProfile(cloud,name,avatar);else{const p=await createProfile(name);if(avatar)await updateProfile(p.id,name,avatar);}
  }else{
    if(id!=='local')throw Error('Für weitere Profile bitte zuerst anmelden.');
    await setSetting('local_profile_name',name);await setSetting('local_profile_avatar',avatar||'');
  }
}
export async function refreshActiveProfile(){
  const profiles=await availableProfiles();const state=useStore.getState();
  const profile=profiles.find(p=>p.id===state.profileId) ?? (profiles.length===1?profiles[0]:null);
  if(profile)state.setProfile(profile.id,profile.name,profile.avatar);
  return profiles;
}
export async function avatarFromFile(file:File):Promise<HTMLImageElement>{
  if(file.size>15*1024*1024||!/^image\/(jpeg|png|webp)$/.test(file.type))throw Error('Bitte ein JPG-, PNG- oder WebP-Bild bis 15 MB wählen.');
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();img.src=url;await img.decode();
    return img;
  }finally{URL.revokeObjectURL(url);}
}
