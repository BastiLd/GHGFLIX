import React,{useEffect,useState} from 'react';
import {ScrollView,Text,View} from 'react-native';
import {FFeld,Knopf} from './bausteine.js';
import {FokusReihe} from './fokus.js';
import {C,M,st} from './stile.js';
import {GoogleLogin} from './GoogleLogin.js';
export function AccountScreen({api,onSession,onServer}) {
  const [mode,setMode]=useState('login'),[status,setStatus]=useState(null),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[key,setKey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [serverPassword,setServerPassword]=useState('');
  useEffect(()=>{let active=true;api('/api/accounts/status').then(s=>{if(active)setStatus(s);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[api]);
  const submit=async()=>{if(busy)return;setBusy(true);setError('');try{
    if(mode!=='login'&&password!==repeat)throw Error('Die Passwörter stimmen nicht überein.');
    await onSession(await api('/api/accounts/'+mode,{method:'POST',body:{email,password,setupKey:key,serverPassword}}));
  }catch(e){setError(e.message);}finally{setBusy(false);}};
  return <ScrollView style={{flex:1,backgroundColor:C.bg}} contentContainerStyle={{padding:M.rand,alignItems:'center'}} keyboardShouldPersistTaps="handled"><View style={{width:'100%',maxWidth:520,gap:12}}>
    <Text style={st.h1}>{mode==='setup'?'Besitzer-Account':mode==='register'?'Account erstellen':'Dein Account'}</Text><Text style={st.gedaempft}>Nach dem Serverzugang meldest du dich persönlich an. Deine Profile, Bilder und Wiedergabestände gehören zu deinem Account.</Text>
    <FokusReihe zeile={0}><FFeld spalte={0} accessibilityLabel="E-Mail" wert={email} aufWert={setEmail} platzhalter="E-Mail" autoCapitalize="none" keyboardType="email-address" autoComplete="email" maxLength={254}/></FokusReihe>
    <FokusReihe zeile={1}><FFeld spalte={0} accessibilityLabel="Account-Passwort" wert={password} aufWert={setPassword} platzhalter="Account-Passwort" secureTextEntry autoCapitalize="none" maxLength={128}/></FokusReihe>
    {mode!=='login'&&<><Text style={st.gedaempft}>Mindestens 10 Zeichen. Die E-Mail ist dein Anmeldename; es wird keine Bestätigungs-Mail verschickt.</Text><FokusReihe zeile={2}><FFeld spalte={0} accessibilityLabel="Passwort wiederholen" wert={repeat} aufWert={setRepeat} platzhalter="Passwort wiederholen" secureTextEntry maxLength={128}/></FokusReihe></>}
    {mode==='setup'&&<><FokusReihe zeile={3}><FFeld spalte={0} accessibilityLabel="Besitzer-Schlüssel" wert={key} aufWert={setKey} platzhalter="Besitzer-Schlüssel" secureTextEntry autoCapitalize="none"/></FokusReihe><Text style={st.gedaempft}>Der einmalige Schlüssel liegt auf deinem Server in DATA_DIR/account-setup-key. Er ordnet dir die bisherigen Profile zu.</Text></>}
    {!!error&&<Text accessibilityRole="alert" style={{color:C.red}}>{error}</Text>}
    {mode==='register'&&<FokusReihe zeile={3}><FFeld spalte={0} accessibilityLabel="Server-Passwort für neuen Account" wert={serverPassword} aufWert={setServerPassword} platzhalter="Server-Passwort für neuen Account" secureTextEntry/></FokusReihe>}
    <FokusReihe zeile={4}><Knopf spalte={0} haupt text={busy?'Bitte warten …':mode==='login'?'Anmelden':'Account anlegen'} onPress={submit}/></FokusReihe>
    <FokusReihe zeile={5}><View style={{flexDirection:'row',gap:10,flexWrap:'wrap'}}>{mode!=='login'?<Knopf spalte={0} text="Zur Anmeldung" onPress={()=>{setMode('login');setError('');}}/>:status?.registration?<Knopf spalte={0} text="Neuen Account erstellen" onPress={()=>{setMode('register');setError('');}}/>:null}{status?.setupNeeded&&mode!=='setup'&&<Knopf spalte={1} text="Ich bin Serverbesitzer" onPress={()=>{setMode('setup');setError('');}}/>}</View></FokusReihe>
    <FokusReihe zeile={6}><Knopf spalte={0} text="Serverzugang ändern" onPress={onServer}/></FokusReihe>
    {mode==='login'&&(status?.google?<GoogleLogin api={api} onSession={onSession}/>:<Text style={st.gedaempft}>Google-Anmeldung ist am Server noch nicht eingerichtet.</Text>)}
  </View></ScrollView>;
}
