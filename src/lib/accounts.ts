import {create} from 'zustand';
import {IS_WEB,accountToken,setAccountToken,serverBase,serverToken,setWebToken,configureAccountServer} from './platform';
import {loadServerConfig,resolveServer,saveServerConfig,stopServerSync} from './serverSync';
import {stopSupabaseSync} from './supabase';
import {useStore} from './store';
import {useUiPrefs} from './uiPrefs';

export interface AccountProfile {id:number;name:string;avatar:string|null;is_child:number;max_age:number;has_pin:number}
export interface AccountSession {account:{id:number;email:string;isAdmin:boolean};profile:AccountProfile|null;expiresAt:number}
export const useAccount = create<{session:AccountSession|null;enabled:boolean;setSession:(s:AccountSession|null)=>void}>(set=>({
  session:null,enabled:IS_WEB,setSession:session=>set({session}),
}));
export async function connectAccounts() {
  let base='';
  if(!IS_WEB){
    const cfg=await loadServerConfig();
    if(!cfg.enabled){
      if(cfg.configured===false)throw Error('Verbinde dich mit deinem GHGFlix-Server oder öffne deine lokale Desktop-Bibliothek.');
      configureAccountServer(null,'');useAccount.setState({enabled:false});return null;
    }
    const found=await resolveServer(cfg);if(!found)throw Error('Medienserver nicht erreichbar. Bitte Verbindung prüfen.');
    base=found;setWebToken(cfg.token);
    stopServerSync();stopSupabaseSync();
  }
  const r=await fetch(base+'/api/ping',{signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Medienserver nicht erreichbar.');
  const ping=await r.json();
  if(!ping.accounts)throw Error(`Dein Server meldet Version ${ping.version||'unbekannt'}. Persönliche Accounts benötigen GHGFlix-Server 3.6.0 oder neuer. Bitte zuerst den Server aktualisieren; ein App-Update allein reicht nicht.`);
  configureAccountServer(base,String(ping.id));useAccount.setState({enabled:true});
  return ping;
}
export async function accountRequest<T=any>(path:string,body?:unknown,method=body?'POST':'GET',gateway=false):Promise<T> {
  const res=await fetch(serverBase()+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${gateway?serverToken():accountToken()||serverToken()}`},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await res.json();
  if(!res.ok){
    if(res.status===401 && !['invalid_credentials'].includes(data.code) && !path.endsWith('/login')) window.dispatchEvent(new CustomEvent('ghgflix:account-required'));
    throw Object.assign(Error(data.error||'Anfrage fehlgeschlagen.'),{status:res.status,code:data.code});
  }
  return data;
}
export async function gatewayLogin(password:string) {
  const res=await fetch(serverBase()+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  const data=await res.json();if(!res.ok)throw Error(data.error||'Server-Passwort falsch.');
  setWebToken(data.token||'');setAccountToken('');
  if(!IS_WEB){const cfg=await loadServerConfig();await saveServerConfig({...cfg,token:data.token||''});}
}
export function acceptSession(data:AccountSession&{token?:string}) {
  const previous=useAccount.getState().session;
  if(previous?.account.id!==data.account.id||previous?.profile?.id!==data.profile?.id)useUiPrefs.getState().reset();
  if(data.token)setAccountToken(data.token);
  useAccount.getState().setSession(data);
  useStore.getState().setProfile(data.profile?String(data.profile.id):'',data.profile?.name||'',data.profile?.avatar);
  useStore.getState().protokollLeeren();useStore.setState({toasts:[]});
}
export async function selectAccountProfile(id:string,credentials:{pin?:string;password?:string}={}) {
  const profile=await accountRequest<AccountProfile>('/api/accounts/select-profile',{id:Number(id),...credentials});
  const session=useAccount.getState().session;
  if(session)acceptSession({...session,profile});
  return profile;
}
export async function logoutAccount() {
  try {
    const subscription=await navigator.serviceWorker?.getRegistration().then(r=>r?.pushManager?.getSubscription()).catch(()=>null);
    await accountRequest('/api/accounts/logout',{pushEndpoint:subscription?.endpoint});
  } finally {
    setAccountToken('');useAccount.getState().setSession(null);useStore.getState().setProfile('','');useStore.getState().protokollLeeren();
    useUiPrefs.getState().reset();
    window.dispatchEvent(new CustomEvent('ghgflix:account-required'));
  }
}
