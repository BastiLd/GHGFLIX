import {useEffect,useState} from 'react';
import {loadServerConfig,saveServerConfig} from '../lib/serverSync';
import {setAccountToken} from '../lib/platform';
import {openServerConnection} from '../lib/serverConnection';
import {PasswordInput} from './PasswordInput';

export function ServerConnection({onConnected=()=>window.location.reload()}:{onConnected?:()=>void}) {
  const [url,setUrl]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{void loadServerConfig().then(c=>setUrl((c.mode==='manual'?c.manualUrl:c.endpoints[0]?.url)||c.manualUrl||''));},[]);
  const connect=async(e:React.FormEvent)=>{
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    try {
      const result=await openServerConnection(url,password);
      const cfg=await loadServerConfig();
      await saveServerConfig({...cfg,enabled:true,mode:'manual',manualUrl:result.base,token:result.token});
      setPassword('');onConnected();
    } catch(e){setError((e as Error).message);} finally {setBusy(false);}
  };
  const local=async()=>{
    if(busy)return;setBusy(true);setError('');
    try {const cfg=await loadServerConfig();setAccountToken('');await saveServerConfig({...cfg,enabled:false});window.location.reload();}
    catch(e){setError((e as Error).message);setBusy(false);}
  };
  const field='w-full bg-ghg-bg2 border border-ghg-line rounded-lg p-3 mt-1';
  return <form onSubmit={connect} className="space-y-4 border border-ghg-line bg-ghg-surface rounded-2xl p-5">
    <h2 className="text-xl font-bold">Mit Server verbinden</h2>
    <p className="text-sm text-ghg-muted">Adresse und gemeinsames Server-Passwort eingeben. Danach meldest du dich mit deinem persönlichen Account an.</p>
    <label className="block text-sm">Serveradresse<input aria-label="Serveradresse" type="url" value={url} onChange={e=>setUrl(e.target.value)} required disabled={busy} className={field} placeholder="http://192.168.68.10:8484" autoComplete="url"/></label>
    <label className="block text-sm">Server-Passwort<PasswordInput aria-label="Server-Passwort" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy} className={field} autoComplete="current-password"/></label>
    <p className="text-xs text-ghg-muted">Leer lassen, wenn der Server kein Passwort verlangt. Gespeichert wird nur der Zugangstoken.</p>
    {error&&<p role="alert" className="text-sm text-ghg-red">{error}</p>}
    <button disabled={busy} className="w-full rounded-lg bg-ghg-red p-3 font-semibold disabled:opacity-50">{busy?'Verbindung wird geprüft …':'Verbinden und anmelden'}</button>
    <button type="button" disabled={busy} className="text-sm text-ghg-muted" onClick={()=>void local()}>Lokale Desktop-Bibliothek öffnen</button>
  </form>;
}
