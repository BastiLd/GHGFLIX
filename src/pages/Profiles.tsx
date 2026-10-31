import {useUiPrefs} from "../lib/uiPrefs";
import {startSupabaseSync} from "../lib/supabase";
import { Pencil,Plus,User,ArrowLeft,Camera } from "lucide-react";
import { useEffect,useState } from "react";
import { useNavigate,useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "../lib/store";
import { usesServer } from "../lib/platform";
import { availableProfiles,saveProfile,deleteProfile,refreshActiveProfile,avatarFromFile,type Profile } from "../lib/profiles";
import { Button,Modal,Spinner,TextInput } from "../components/ui";
import { accountRequest,acceptSession,logoutAccount,selectAccountProfile,useAccount } from "../lib/accounts";
import { usePlayback } from "../lib/playback";
import { destroy } from "../lib/mpv";
import { AvatarCropper } from "../components/AvatarCropper";

export default function Profiles(){
  const navigate=useNavigate(),qc=useQueryClient(),[params]=useSearchParams();
  const toast=useStore(s=>s.toast),setProfile=useStore(s=>s.setProfile);
  const [profiles,setProfiles]=useState<Profile[]>([]),[loading,setLoading]=useState(true);
  const [edit,setEdit]=useState<Profile|null>(null),[name,setName]=useState(''),[avatar,setAvatar]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [cropImage,setCropImage]=useState<HTMLImageElement|null>(null),[reading,setReading]=useState(false);
  const session=useAccount(s=>s.session);
  const [canClaim,setCanClaim]=useState(false),[claim,setClaim]=useState(false),[ownerKey,setOwnerKey]=useState('');
  useEffect(()=>{if(usesServer())void accountRequest('/api/accounts/status').then(s=>setCanClaim(s.setupNeeded)).catch(()=>{});},[]);
  const [child,setChild]=useState(false),[age,setAge]=useState(12),[password,setPassword]=useState(''),[pin,setPin]=useState(''),[pinChanged,setPinChanged]=useState(false);
  const [unlock,setUnlock]=useState<Profile|null>(null),[confirmDelete,setConfirmDelete]=useState(false),[accountEdit,setAccountEdit]=useState(false),[newPassword,setNewPassword]=useState('');
  const open=(p:Profile)=>{setEdit(p);setName(p.name);setAvatar(p.avatar);setCropImage(null);setError('');setChild(!!p.is_child);setAge(p.max_age??12);setPassword('');setPin('');setPinChanged(false);setConfirmDelete(false);};
  useEffect(()=>{let active=true;availableProfiles().then(ps=>{if(!active)return;setProfiles(ps);const target=ps.find(p=>p.id===params.get('edit'));if(target)open(target);}).catch(e=>setError(e.message)).finally(()=>setLoading(false));return()=>{active=false;};},[]);
  const choose=async(p:Profile,credentials:{pin?:string;password?:string}={})=>{
    if(busy)return;
    if(usesServer() && !credentials.pin && !credentials.password && (p.has_pin || (session?.profile?.is_child && (!p.is_child || (p.max_age??12)>session.profile.max_age)))){setUnlock(p);setPassword('');setPin('');setError('');return;}
    setBusy(true);setError('');
    try {
      await qc.cancelQueries();await destroy().catch(()=>{});usePlayback.getState().clearQueue();usePlayback.setState({mini:null,handoff:false,expandTo:null,mpvInited:false});
      if(usesServer())await selectAccountProfile(p.id,credentials);else {setProfile(p.id,p.name,p.avatar);if(p.cloud)startSupabaseSync(p.id,p.name);}
      await useUiPrefs.getState().load();
      qc.clear();setUnlock(null);navigate('/');
    } catch(e){setError((e as Error).message);} finally{setBusy(false);}
  };
  const save=async()=>{if(!edit||busy)return;setBusy(true);setError('');try{
    await saveProfile(edit.id||null,name,avatar,usesServer()?{password,is_child:child,max_age:age,...(pinChanged?{pin}:{})}:{});
    if(usesServer())acceptSession(await accountRequest("/api/accounts/me"));qc.clear();setProfiles(await refreshActiveProfile());setEdit(null);toast('Profil gespeichert','success');
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  return <div className="min-h-dvh bg-ghg-bg px-5 py-10 flex flex-col items-center justify-center">
    <div className="w-full max-w-2xl"><button onClick={()=>navigate('/')} className="flex gap-2 items-center text-ghg-muted mb-8"><ArrowLeft size={18}/>Zurück</button>
    <h1 className="text-2xl font-bold mb-2">Wer schaut?</h1><p className="text-sm text-ghg-muted mb-7">{session?session.account.email:'Profil auswählen oder Name und Bild bearbeiten.'}</p>{usesServer()&&<div className="flex flex-wrap gap-5 text-sm mb-7"><button onClick={()=>{setClaim(false);setAccountEdit(true);setPassword('');setNewPassword('');setError('');}}>Account-Passwort ändern</button><button onClick={()=>void logoutAccount().then(()=>qc.clear())}>Account abmelden</button>{canClaim&&<button onClick={()=>{setClaim(true);setAccountEdit(true);setPassword('');setOwnerKey('');setError('');}}>Vorhandene Profile übernehmen</button>}</div>}
    {error&&!edit&&<p role="alert" className="text-ghg-red mb-4">{error}</p>}
    {loading?<Spinner/>:<div className="flex flex-wrap gap-6">{profiles.map(p=><div key={p.id} className="w-28 text-center">
      <button aria-label={`Profil ${p.name} auswählen`} onClick={()=>void choose(p)} className={`w-24 h-24 rounded-full overflow-hidden mx-auto grid place-items-center ${p.avatar?'':'bg-ghg-red'}`}>{p.avatar?<img src={p.avatar} alt="" className="w-full h-full object-cover"/>:<User size={38}/>}</button>
      <p className="text-sm font-semibold mt-3 truncate">{p.name}{p.is_child?` · bis ${p.max_age}`:''}{p.has_pin?' · PIN':''}</p><button onClick={()=>open(p)} aria-label={`${p.name} bearbeiten`} className="text-xs text-ghg-muted flex items-center justify-center gap-1.5 w-full py-3"><Pencil size={14}/>Bearbeiten</button>
    </div>)}{(usesServer()||profiles.some(p=>p.cloud))&&<button onClick={()=>open({id:'',name:'',avatar:null})} className="w-24 h-24 rounded-2xl border border-dashed border-ghg-line grid place-items-center" aria-label="Profil hinzufügen"><Plus/></button>}</div>}
    {!usesServer()&&!profiles.some(p=>p.cloud)&&<Button variant="ghost" onClick={()=>navigate('/login')}>Für Cloud-Sync anmelden</Button>}
    <p className="text-xs text-ghg-muted mt-6">{usesServer()?'Nur dein Account kann diese Profile nutzen. Kinder sehen nur Inhalte mit passender Altersfreigabe.':'Mit Cloud-Sync werden Profile, Fortschritt und Meine Liste zwischen deinen Geräten abgeglichen.'}</p></div>
    <Modal open={!!edit} onClose={()=>!busy&&!reading&&(cropImage?setCropImage(null):setEdit(null))} title={cropImage?'Profilbild anpassen':edit?.id?'Profil bearbeiten':'Neues Profil'}>
      {cropImage?<AvatarCropper image={cropImage} onCancel={()=>setCropImage(null)} onApply={data=>{setAvatar(data);setCropImage(null);}}/>:<div className="space-y-4"><div className="flex items-center gap-4"><div className={`w-20 h-20 rounded-full overflow-hidden grid place-items-center ${avatar?'avatar-checker':'bg-ghg-red'}`}>{avatar?<img src={avatar} alt="Profilbild-Vorschau" className="w-full h-full object-cover"/>:<User size={32}/>}</div>
      <div><label className="cursor-pointer flex gap-2 items-center text-sm"><Camera size={17}/>{reading?'Bild wird geladen …':'Bild auswählen'}<input aria-label="Profilbild auswählen" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy||reading} onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;setReading(true);try{setCropImage(await avatarFromFile(f));setError('');}catch(x){setError(String((x as Error).message));}finally{setReading(false);}}}/></label>{avatar&&<button className="text-xs text-ghg-muted mt-3" onClick={()=>setAvatar(null)}>Bild entfernen</button>}</div></div>
      <label className="block text-sm">Name</label><TextInput value={name} onChange={setName} placeholder="Dein Name" onEnter={save}/>
      {usesServer()&&<div className="space-y-3">
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={child} onChange={e=>setChild(e.target.checked)}/>Kinderprofil</label>
        {child&&<><label className="block text-sm">Altersgrenze<select aria-label="Altersgrenze" className="ml-3 bg-ghg-bg2 rounded p-2" value={age} onChange={e=>setAge(Number(e.target.value))}>{[0,6,12,16].map(a=><option key={a} value={a}>Bis {a} Jahre</option>)}</select></label><p className="text-xs text-ghg-muted">Unbekannte Freigaben, Kanäle und externe Trailer werden ausgeblendet. Der Wechsel in ein weniger beschränktes Profil braucht dessen PIN oder dein Account-Passwort.</p></>}
        <label className="block text-sm">{edit?.has_pin?'Neue Profil-PIN (leer lassen: bisherige bleibt)':'Profil-PIN (optional, sechs Ziffern)'}<input aria-label="Profil-PIN" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={e=>{setPin(e.target.value.replace(/[^0-9]/g,''));setPinChanged(true);}} className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg p-2 mt-1"/></label>
        {!!edit?.has_pin&&<button className="text-xs" onClick={()=>{setPin('');setPinChanged(true);}}>PIN entfernen{pinChanged&&!pin?' ✓':''}</button>}
        <label className="block text-sm">Account-Passwort zur Bestätigung<input aria-label="Account-Passwort zur Bestätigung" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg p-2 mt-1"/></label>
        {!!edit?.id&&profiles.length>1&&<div><button className="text-sm text-ghg-red" onClick={()=>setConfirmDelete(true)}>Profil löschen</button>{confirmDelete&&<div className="mt-2 text-sm"><p>Profil „{edit.name}“ mit Fortschritt und Merkliste dauerhaft löschen?</p><button disabled={busy||!password} className="mt-2 text-ghg-red" onClick={async()=>{if(!edit)return;setBusy(true);try{await deleteProfile(edit.id,password);setEdit(null);qc.clear();setProfiles(await availableProfiles());}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Endgültig löschen</button></div>}</div>}
      </div>}
      <p className="text-xs text-ghg-muted">Dein rundes Profilbild wird mit dem gewählten Ausschnitt und Hintergrund privat gespeichert.</p>
      {error&&<p role="alert" className="text-sm text-ghg-red">{error}</p>}
      <div className="flex gap-2 justify-end"><Button variant="ghost" disabled={busy||reading} onClick={()=>setEdit(null)}>Abbrechen</Button><Button disabled={busy||reading||!name.trim()} onClick={save}>{busy?'Speichert …':'Speichern'}</Button></div></div>}
    </Modal>
    <Modal open={!!unlock} onClose={()=>!busy&&setUnlock(null)} title={`Profil ${unlock?.name??''} öffnen`}><form className="space-y-4" onSubmit={e=>{e.preventDefault();if(unlock)void choose(unlock,unlock.has_pin?{pin}:{password});}}>
      <label className="block text-sm">{unlock?.has_pin?'Sechsstellige Profil-PIN':'Account-Passwort'}<input aria-label={unlock?.has_pin?'Profil-PIN':'Account-Passwort'} type="password" inputMode={unlock?.has_pin?'numeric':undefined} maxLength={unlock?.has_pin?6:128} value={unlock?.has_pin?pin:password} onChange={e=>unlock?.has_pin?setPin(e.target.value):setPassword(e.target.value)} className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg p-3 mt-2" autoFocus/></label>
      {error&&<p role="alert" className="text-ghg-red">{error}</p>}<button disabled={busy} className="bg-ghg-red rounded-lg p-3">Profil öffnen</button>
    </form></Modal>
    <Modal open={accountEdit} onClose={()=>!busy&&setAccountEdit(false)} title={claim?"Serverbesitzer werden":"Account-Passwort ändern"}><form className="space-y-4" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{acceptSession(await accountRequest(claim?'/api/accounts/claim-owner':'/api/accounts/password',claim?{password,setupKey:ownerKey}:{currentPassword:password,newPassword}));if(claim)setCanClaim(false);qc.clear();setProfiles(await availableProfiles());setAccountEdit(false);navigate('/profiles');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
      <label className="block text-sm">Bisheriges Passwort<input aria-label="Bisheriges Passwort" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full bg-ghg-bg2 p-3 mt-1" required/></label>
      {claim?<label className="block text-sm">Besitzer-Schlüssel<input aria-label="Besitzer-Schlüssel" type="password" value={ownerKey} onChange={e=>setOwnerKey(e.target.value)} className="w-full bg-ghg-bg2 p-3 mt-1" required/></label>:<label className="block text-sm">Neues Passwort<input aria-label="Neues Passwort" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={newPassword} onChange={e=>setNewPassword(e.target.value)} className="w-full bg-ghg-bg2 p-3 mt-1" required/></label>}
      <p className="text-xs text-ghg-muted">{claim?'Mit dem Schlüssel aus DATA_DIR/account-setup-key übernimmst du die bisherigen Profile. Deine neuen Profile bleiben erhalten.':'Andere Geräte werden abgemeldet. Mindestens 10 Zeichen.'}</p>{error&&<p role="alert" className="text-ghg-red">{error}</p>}<button disabled={busy} className="bg-ghg-red p-3 rounded-lg">{claim?"Profile übernehmen":"Passwort speichern"}</button>
    </form></Modal>
  </div>;
}
