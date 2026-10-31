import {useEffect,useState} from 'react';
import {accountRequest} from '../lib/accounts';
import {openUrl} from '../lib/backend';
export function GoogleLogin({onSession}:{onSession:(data:any)=>void}) {
  const [flow,setFlow]=useState<any>(null),[ready,setReady]=useState<any>(null),[error,setError]=useState(''),[password,setPassword]=useState(''),[serverPassword,setServerPassword]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!flow||ready)return;let active=true;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const r=await accountRequest('/api/accounts/google/check',flow);if(!active)return;if(r.state==='ready'){setReady(r);return;}timer=setTimeout(poll,2000);}catch(e){if(active)setError((e as Error).message);}};
    timer=setTimeout(poll,1500);return()=>{active=false;clearTimeout(timer);};
  },[flow,ready]);
  const finish=async()=>{if(busy)return;setBusy(true);setError('');try{onSession(await accountRequest('/api/accounts/google/finish',{...flow,password,serverPassword}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="border-t border-ghg-line pt-4 space-y-3 text-sm">
    {!flow?<button type="button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{setFlow(await accountRequest('/api/accounts/google/start',{}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Mit Google anmelden</button>:!ready?<><button type="button" className="underline" onClick={()=>void openUrl(flow.url)}>Google-Anmeldung öffnen</button><p className="text-ghg-muted">Nach der Bestätigung hierher zurückkehren. Dieser Vorgang gilt zehn Minuten.</p><button type="button" onClick={()=>{setFlow(null);setError('');}}>Abbrechen</button></>:<><p>Google-Konto: {ready.email}</p>{ready.needsPassword&&<label className="block">{ready.existingAccount?'Bestehendes Account-Passwort zum Verknüpfen':'Account-Passwort einmalig festlegen (mindestens 10 Zeichen)'}<input type="password" aria-label="Passwort für Google-Account" className="w-full bg-ghg-bg2 border border-ghg-line rounded p-3 mt-2" value={password} onChange={e=>setPassword(e.target.value)} maxLength={128}/></label>}<label className="block text-sm">{ready.needsPassword&&!ready.existingAccount&&<>Server-Passwort für neuen Account<input aria-label="Server-Passwort für Google-Account" type="password" value={serverPassword} onChange={e=>setServerPassword(e.target.value)} className="w-full bg-ghg-bg2 rounded p-3"/></>}</label><button type="button" disabled={busy} onClick={()=>void finish()} className="bg-ghg-red rounded-lg p-3">Anmeldung abschließen</button></>}
    {!!error&&<p role="alert" className="text-ghg-red">{error}</p>}
  </div>;
}
