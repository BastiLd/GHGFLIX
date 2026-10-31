import {useEffect,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {useQueryClient} from '@tanstack/react-query';
import {Wordmark} from './Brand';
import {accountRequest,acceptSession,connectAccounts,gatewayLogin,useAccount} from '../lib/accounts';
import {accountToken,setAccountToken,IS_WEB} from '../lib/platform';
import {usePlayback} from '../lib/playback';
import {destroy} from '../lib/mpv';
import {useUiPrefs} from '../lib/uiPrefs';
import Profiles from '../pages/Profiles';
import {GoogleLogin} from './GoogleLogin';
import {ServerConnection} from './ServerConnection';
import {PasswordInput} from './PasswordInput';

export function AccountGate({children}:{children:React.ReactNode}) {
  const session=useAccount(s=>s.session),enabled=useAccount(s=>s.enabled),qc=useQueryClient(),navigate=useNavigate(),location=useLocation();
  const [stage,setStage]=useState('loading'),[mode,setMode]=useState('login'),[status,setStatus]=useState({setupNeeded:false,registration:true,google:false});
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[setupKey,setSetupKey]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  const [serverPassword,setServerPassword]=useState('');
  const [changeServer,setChangeServer]=useState(false);
  useEffect(()=>{
    let active=true;
    const load=async()=>{
      setStage('loading');setError('');
      try{
        const ping=await connectAccounts();if(!active)return;
        if(!ping){setStage('ready');return;}
        let info;
        try{info=await accountRequest('/api/accounts/status',undefined,'GET',true);}catch(e){if((e as any).status===401){setStage('server');return;}throw e;}
        if(!active)return;setStatus(info);
        if(accountToken()) {
          try{const data=await accountRequest('/api/accounts/me');if(!active)return;acceptSession(data);setStage('ready');void useUiPrefs.getState().load();return;}
          catch(e){if((e as any).status!==401)throw e;setAccountToken('');}
        }
        setStage('account');
      }catch(e){if(active){setError((e as Error).message);setStage('error');}}
    };
    void load();
    const expired=()=>{setAccountToken('');useAccount.getState().setSession(null);setStage('account');setMode('login');setPassword('');setRepeat('');setServerPassword('');setSetupKey('');qc.clear();void destroy().catch(()=>{});usePlayback.getState().clearQueue();usePlayback.setState({mini:null,handoff:false,expandTo:null,mpvInited:false});};
    window.addEventListener('ghgflix:account-required',expired);
    const serverExpired=()=>{expired();setStage('server');};
    window.addEventListener('ghgflix:unauthorized',serverExpired);
    return()=>{active=false;window.removeEventListener('ghgflix:account-required',expired);window.removeEventListener('ghgflix:unauthorized',serverExpired);};
  },[retry,qc]);
  useEffect(()=>{
    if(!session||!enabled)return;
    let active=true;
    const refresh=async()=>{
      try{
        const data=await accountRequest('/api/accounts/me');if(!active)return;
        const old=useAccount.getState().session;
        if(JSON.stringify(data.profile)!==JSON.stringify(old?.profile)||data.account.id!==old?.account.id){
          await qc.cancelQueries();await destroy().catch(()=>{});qc.clear();usePlayback.getState().clearQueue();usePlayback.setState({mini:null,handoff:false,expandTo:null,mpvInited:false});acceptSession(data);
        }
      }catch{/* Offline keeps the gate; 401 is handled by accountRequest. */}
    };
    const storage=(e:StorageEvent)=>{if(e.key==='ghgflix.profileId'||e.key?.startsWith('ghgflix.account.'))void refresh();};
    const focus=()=>void refresh();const timer=window.setInterval(focus,30000);
    window.addEventListener('storage',storage);window.addEventListener('focus',focus);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('storage',storage);window.removeEventListener('focus',focus);};
  },[session?.account.id,enabled,qc]);
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    try{
      if(stage==='server'){await gatewayLogin(password);setServerPassword(password);setPassword('');setRetry(x=>x+1);return;}
      if(mode!=='login' && password!==repeat)throw Error('Die Passwörter stimmen nicht überein.');
      const data=await accountRequest('/api/accounts/'+mode,{email,password,setupKey,serverPassword},'POST',true);
      acceptSession(data);qc.clear();usePlayback.getState().clearQueue();setPassword('');setRepeat('');setSetupKey('');setServerPassword('');setStage('ready');navigate('/profiles',{replace:true});
      void useUiPrefs.getState().load();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  if(stage==='ready' && (!enabled||session)) {
    if(enabled&&!session?.profile) return <Profiles/>;
    if(session?.profile?.is_child && ['/kanaele','/settings','/stats','/login','/connect'].some(p=>location.pathname.startsWith(p)))
      return <div className="min-h-dvh grid place-items-center p-6"><div><h1 className="text-xl mb-4">Im Kinderprofil ausgeblendet</h1><button onClick={()=>navigate('/')} className="mr-6">Zur Startseite</button><button onClick={()=>navigate('/profiles')}>Profil wechseln</button></div></div>;
    return <>{children}</>;
  }
  if(!IS_WEB && (stage==='error'||changeServer))return <div className="h-dvh overflow-y-auto bg-ghg-bg p-5"><div className="w-full max-w-lg mx-auto py-6 space-y-5">
    <Wordmark size="lg"/>{error&&<p role="alert" className="text-sm text-ghg-muted">{error}</p>}
    <ServerConnection onConnected={()=>{setChangeServer(false);setRetry(n=>n+1);}}/>
    {changeServer&&<button onClick={()=>setChangeServer(false)}>Zurück zur Anmeldung</button>}
  </div></div>;
  const field='w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-3 text-sm';
  return <div className="h-dvh overflow-y-auto bg-ghg-bg p-5"><div className="w-full max-w-md mx-auto py-6 space-y-6">
    <Wordmark size="lg"/>
    {stage==='loading'?<p role="status">Mit GHGFlix verbinden …</p>:stage==='error'?<><p role="alert">{error}</p><button onClick={()=>setRetry(n=>n+1)}>Erneut verbinden</button></>:<form onSubmit={submit} className="bg-ghg-surface border border-ghg-line rounded-2xl p-6 space-y-4">
      <h1 className="text-xl font-bold">{stage==='server'?'Server-Passwort':mode==='setup'?'Besitzer-Account einrichten':mode==='register'?'Account erstellen':'Dein Account'}</h1>
      <p className="text-sm text-ghg-muted">{stage==='server'?'Mit dem gemeinsamen Passwort öffnest du den Serverzugang.':'Deine Profile, Bilder, Merkliste und Wiedergabestände gehören zu deinem Account.'}</p>
      {stage!=='server'&&<label className="block text-sm">E-Mail<input className={field} aria-label="E-Mail" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254}/></label>}
      <label className="block text-sm">{stage==='server'?'Server-Passwort':'Account-Passwort'}<PasswordInput className={field} aria-label={stage==='server'?'Server-Passwort':'Account-Passwort'}  autoComplete={mode==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={stage==='server'||mode==='login'?1:10} maxLength={128}/></label>
      {stage!=='server'&&mode!=='login'&&<><p className="text-xs text-ghg-muted">Mindestens 10 Zeichen. Die E-Mail dient als Anmeldename; es wird keine Bestätigungs-Mail verschickt.</p><label className="block text-sm">Passwort wiederholen<PasswordInput className={field} aria-label="Passwort wiederholen"  autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)} required/></label></>}
      {stage!=='server'&&mode==='setup'&&<label className="block text-sm">Besitzer-Schlüssel<PasswordInput className={field} aria-label="Besitzer-Schlüssel"  autoComplete="off" value={setupKey} onChange={e=>setSetupKey(e.target.value)} required/><span className="block text-xs text-ghg-muted mt-2">Auf deinem Server in DATA_DIR/account-setup-key. Damit übernimmst du einmalig die bisherigen Profile.</span></label>}
      {stage!=='server'&&mode==='register'&&<label className="block text-sm">Server-Passwort für neuen Account<PasswordInput className={field} aria-label="Server-Passwort für neuen Account"  autoComplete="off" value={serverPassword} onChange={e=>setServerPassword(e.target.value)} required/></label>}
      {error&&<p role="alert" className="text-ghg-red text-sm">{error}</p>}
      <button disabled={busy} className="w-full rounded-xl py-3 bg-ghg-red font-semibold disabled:opacity-50">{busy?'Bitte warten …':stage==='server'?'Server öffnen':mode==='login'?'Anmelden':mode==='setup'?'Besitzer-Account anlegen':'Account erstellen'}</button>
      {stage!=='server'&&<div className="flex flex-wrap gap-4 text-sm">{mode!=='login'&&<button type="button" onClick={()=>{setMode('login');setError('');}}>Zur Anmeldung</button>}{mode==='login'&&status.registration&&<button type="button" onClick={()=>{setMode('register');setError('');}}>Neuen Account erstellen</button>}{status.setupNeeded&&mode!=='setup'&&<button type="button" onClick={()=>{setMode('setup');setError('');}}>Ich bin der Serverbesitzer</button>}</div>}
      {stage!=='server'&&mode==='login'&&(status.google?<GoogleLogin onSession={data=>{acceptSession(data);qc.clear();usePlayback.getState().clearQueue();setPassword('');setRepeat('');setServerPassword('');setSetupKey('');setStage('ready');navigate('/profiles',{replace:true});void useUiPrefs.getState().load();}}/>:<p className="text-xs text-ghg-muted">Google-Anmeldung ist am Server noch nicht eingerichtet.</p>)}
    </form>}
    {!IS_WEB&&stage!=='loading'&&<button className="text-sm text-ghg-muted" onClick={()=>{setChangeServer(true);setError('');}}>Serveradresse oder Server-Passwort ändern</button>}
  </div></div>;
}
