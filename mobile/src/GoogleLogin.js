import React,{useEffect,useState} from 'react';
import {Linking,Text,View} from 'react-native';
import {FFeld,Knopf,QrBild} from './bausteine.js';
import {FokusReihe} from './fokus.js';
import {C,istTV,st} from './stile.js';
export function GoogleLogin({api,onSession}) {
  const [flow,setFlow]=useState(null),[ready,setReady]=useState(null),[error,setError]=useState(''),[password,setPassword]=useState(''),[serverPassword,setServerPassword]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!flow||ready)return;let active=true,timer;
    const poll=async()=>{try{const r=await api('/api/accounts/google/check',{method:'POST',body:flow});if(!active)return;if(r.state==='ready'){setReady(r);return;}timer=setTimeout(poll,2000);}catch(e){if(active)setError(e.message);}};
    timer=setTimeout(poll,1500);return()=>{active=false;clearTimeout(timer);};
  },[flow,ready,api]);
  const run=async(fn)=>{if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <View style={{gap:10}}>
    {!flow?<FokusReihe zeile={10}><Knopf spalte={0} text="Mit Google anmelden" onPress={()=>run(async()=>setFlow(await api('/api/accounts/google/start',{method:'POST',body:{}})))}/></FokusReihe>:!ready?<>
      {istTV?<><Text style={st.gedaempft}>Mit dem Handy scannen und Google-Anmeldung bestätigen.</Text><QrBild text={flow.url}/></>:<FokusReihe zeile={10}><Knopf spalte={0} text="Google-Anmeldung öffnen" onPress={()=>Linking.openURL(flow.url).catch(e=>setError(e.message))}/></FokusReihe>}
      <Text style={st.gedaempft}>Nach der Bestätigung hierher zurückkehren. Dieser Vorgang gilt zehn Minuten.</Text><FokusReihe zeile={11}><Knopf spalte={0} text="Abbrechen" onPress={()=>{setFlow(null);setError('');}}/></FokusReihe>
    </>:<><Text style={st.gedaempft}>Google-Konto: {ready.email}</Text>{ready.needsPassword&&<FokusReihe zeile={10}><FFeld spalte={0} accessibilityLabel="Passwort für Google-Account" wert={password} aufWert={setPassword} platzhalter={ready.existingAccount?'Bestehendes Account-Passwort':'Neues Account-Passwort (mindestens 10 Zeichen)'} secureTextEntry maxLength={128}/></FokusReihe>}
      <>{ready.needsPassword&&!ready.existingAccount&&<FokusReihe zeile={11}><FFeld spalte={0} wert={serverPassword} aufWert={setServerPassword} platzhalter="Server-Passwort für neuen Account" secureTextEntry/></FokusReihe>}</><FokusReihe zeile={12}><Knopf spalte={0} text="Anmeldung abschließen" onPress={()=>run(async()=>onSession(await api('/api/accounts/google/finish',{method:'POST',body:{...flow,password,serverPassword}})))}/></FokusReihe></>}
    {!!error&&<Text style={{color:C.red}}>{error}</Text>}
  </View>;
}
