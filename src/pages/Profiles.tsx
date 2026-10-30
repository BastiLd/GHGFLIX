import { Pencil,Plus,User,ArrowLeft,Camera } from "lucide-react";
import { useEffect,useState } from "react";
import { useNavigate,useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "../lib/store";
import { IS_WEB } from "../lib/platform";
import { availableProfiles,saveProfile,refreshActiveProfile,avatarFromFile,type Profile } from "../lib/profiles";
import { startSupabaseSync } from "../lib/supabase";
import { loadServerConfig,syncOnce } from "../lib/serverSync";
import { Button,Modal,Spinner,TextInput } from "../components/ui";
import { AvatarCropper } from "../components/AvatarCropper";

export default function Profiles(){
  const navigate=useNavigate(),qc=useQueryClient(),[params]=useSearchParams();
  const toast=useStore(s=>s.toast),setProfile=useStore(s=>s.setProfile);
  const [profiles,setProfiles]=useState<Profile[]>([]),[loading,setLoading]=useState(true);
  const [edit,setEdit]=useState<Profile|null>(null),[name,setName]=useState(''),[avatar,setAvatar]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [cropImage,setCropImage]=useState<HTMLImageElement|null>(null),[reading,setReading]=useState(false);
  const open=(p:Profile)=>{setEdit(p);setName(p.name);setAvatar(p.avatar);setCropImage(null);setError('');};
  useEffect(()=>{let active=true;availableProfiles().then(ps=>{if(!active)return;setProfiles(ps);const target=ps.find(p=>p.id===params.get('edit'));if(target)open(target);}).catch(e=>setError(e.message)).finally(()=>setLoading(false));return()=>{active=false;};},[]);
  const choose=(p:Profile)=>{setProfile(p.id,p.name,p.avatar);qc.invalidateQueries();if(!IS_WEB&&p.cloud)void loadServerConfig().then(cfg=>{if(cfg.enabled)void syncOnce().catch(e=>toast(e.message,'error'));else startSupabaseSync(p.id,p.name);});navigate('/');};
  const save=async()=>{if(!edit||busy)return;setBusy(true);setError('');try{
    await saveProfile(edit.id||null,name,avatar);setProfiles(await refreshActiveProfile());setEdit(null);toast('Profil gespeichert','success');
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  return <div className="min-h-dvh bg-ghg-bg px-5 py-10 flex flex-col items-center justify-center">
    <div className="w-full max-w-2xl"><button onClick={()=>navigate('/')} className="flex gap-2 items-center text-ghg-muted mb-8"><ArrowLeft size={18}/>Zurück</button>
    <h1 className="text-2xl font-bold mb-2">Wer schaut?</h1><p className="text-sm text-ghg-muted mb-7">Profil auswählen oder Name und Bild bearbeiten.</p>
    {error&&!edit&&<p role="alert" className="text-ghg-red mb-4">{error}</p>}
    {loading?<Spinner/>:<div className="flex flex-wrap gap-6">{profiles.map(p=><div key={p.id} className="w-28 text-center">
      <button aria-label={`Profil ${p.name} auswählen`} onClick={()=>choose(p)} className={`w-24 h-24 rounded-full overflow-hidden mx-auto grid place-items-center ${p.avatar?'':'bg-ghg-red'}`}>{p.avatar?<img src={p.avatar} alt="" className="w-full h-full object-cover"/>:<User size={38}/>}</button>
      <p className="text-sm font-semibold mt-3 truncate">{p.name}</p><button onClick={()=>open(p)} aria-label={`${p.name} bearbeiten`} className="text-xs text-ghg-muted flex items-center justify-center gap-1.5 w-full py-3"><Pencil size={14}/>Bearbeiten</button>
    </div>)}{(IS_WEB||profiles.some(p=>p.cloud))&&<button onClick={()=>open({id:'',name:'',avatar:null})} className="w-24 h-24 rounded-2xl border border-dashed border-ghg-line grid place-items-center" aria-label="Profil hinzufügen"><Plus/></button>}</div>}
    {!IS_WEB&&!profiles.some(p=>p.cloud)&&<Button variant="ghost" onClick={()=>navigate('/login')}>Für Cloud-Sync anmelden</Button>}
    <p className="text-xs text-ghg-muted mt-6">{IS_WEB?'Diese Profile gelten auf allen Geräten, die mit diesem Server verbunden sind.':'Mit Cloud-Sync werden Profile, Fortschritt und Meine Liste zwischen deinen Geräten abgeglichen.'}</p></div>
    <Modal open={!!edit} onClose={()=>!busy&&!reading&&(cropImage?setCropImage(null):setEdit(null))} title={cropImage?'Profilbild anpassen':edit?.id?'Profil bearbeiten':'Neues Profil'}>
      {cropImage?<AvatarCropper image={cropImage} onCancel={()=>setCropImage(null)} onApply={data=>{setAvatar(data);setCropImage(null);}}/>:<div className="space-y-4"><div className="flex items-center gap-4"><div className={`w-20 h-20 rounded-full overflow-hidden grid place-items-center ${avatar?'avatar-checker':'bg-ghg-red'}`}>{avatar?<img src={avatar} alt="Profilbild-Vorschau" className="w-full h-full object-cover"/>:<User size={32}/>}</div>
      <div><label className="cursor-pointer flex gap-2 items-center text-sm"><Camera size={17}/>{reading?'Bild wird geladen …':'Bild auswählen'}<input aria-label="Profilbild auswählen" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy||reading} onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;setReading(true);try{setCropImage(await avatarFromFile(f));setError('');}catch(x){setError(String((x as Error).message));}finally{setReading(false);}}}/></label>{avatar&&<button className="text-xs text-ghg-muted mt-3" onClick={()=>setAvatar(null)}>Bild entfernen</button>}</div></div>
      <label className="block text-sm">Name</label><TextInput value={name} onChange={setName} placeholder="Dein Name" onEnter={save}/>
      <p className="text-xs text-ghg-muted">Dein rundes Profilbild wird mit dem gewählten Ausschnitt und Hintergrund privat gespeichert.</p>
      {error&&<p role="alert" className="text-sm text-ghg-red">{error}</p>}
      <div className="flex gap-2 justify-end"><Button variant="ghost" disabled={busy||reading} onClick={()=>setEdit(null)}>Abbrechen</Button><Button disabled={busy||reading||!name.trim()} onClick={save}>{busy?'Speichert …':'Speichern'}</Button></div></div>}
    </Modal>
  </div>;
}
