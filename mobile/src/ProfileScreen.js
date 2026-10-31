import React,{useEffect,useState} from 'react';
import {Image,ScrollView,Text,View} from 'react-native';
import {FKnopf,FokusReihe} from './fokus.js';
import {FFeld,Knopf,Laden,QrBild} from './bausteine.js';
import {C,M,istTV,st} from './stile.js';
export function ProfilSeite({api,base='',account,activeProfile,aufWahl,aufZurueck,aufAbmelden,onSession,onRefresh}){
  const [liste,setListe]=useState(null),[edit,setEdit]=useState(null),[unlock,setUnlock]=useState(null),[name,setName]=useState(''),[avatar,setAvatar]=useState(null);
  const [child,setChild]=useState(false),[age,setAge]=useState(12),[pin,setPin]=useState(''),[pinChanged,setPinChanged]=useState(false),[password,setPassword]=useState('');
  const [fehler,setFehler]=useState(''),[busy,setBusy]=useState(false),[deleting,setDeleting]=useState(false),[accountEdit,setAccountEdit]=useState(false),[newPassword,setNewPassword]=useState(''),[repeatPassword,setRepeatPassword]=useState('');
  const [canClaim,setCanClaim]=useState(false),[claim,setClaim]=useState(false),[ownerKey,setOwnerKey]=useState('');
  useEffect(()=>{api('/api/accounts/status').then(s=>setCanClaim(s.setupNeeded)).catch(()=>{});},[api]);
  const load=()=>api('/api/profiles').then(p=>setListe(Array.isArray(p)?p:[])).catch(e=>setFehler(e.message));
  useEffect(()=>{load();const t=setInterval(load,15000);return()=>clearInterval(t);},[api]);
  const run=async(fn)=>{if(busy)return;setBusy(true);setFehler('');try{await fn();}catch(e){setFehler(e.message);}finally{setBusy(false);}};
  const open=p=>{setEdit(p);setName(p.name);setAvatar(p.avatar);setChild(!!p.is_child);setAge(p.max_age??12);setPin('');setPinChanged(false);setPassword('');setFehler('');setDeleting(false);};
  const choose=p=>{
    if(p.has_pin || (activeProfile?.is_child&&(!p.is_child||p.max_age>activeProfile.max_age))){setUnlock(p);setPin('');setPassword('');setFehler('');}
    else void run(async()=>{await aufWahl(await api('/api/accounts/select-profile',{method:'POST',body:{id:p.id}}));});
  };
  const save=()=>run(async()=>{await api(edit.id?'/api/profiles/'+edit.id:'/api/profiles',{method:edit.id?'PATCH':'POST',body:{name,avatar,is_child:child,max_age:age,password,...(pinChanged?{pin}:{})}});await load();await onRefresh?.();setEdit(null);});
  const photo=()=>run(async()=>{
    const ImagePicker=await import("expo-image-picker"),ImageManipulator=await import("expo-image-manipulator");
    const picked=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:true,aspect:[1,1],quality:0.8});if(picked.canceled)return;
    const asset=picked.assets?.[0];
    if(!asset?.uri||!asset.width||!asset.height||asset.width*asset.height>40_000_000||(asset.fileSize??0)>20_000_000)throw Error('Bitte ein Bild bis 20 MB und 40 Megapixel wählen.');
    const side=Math.min(asset.width,asset.height);
    const result=await ImageManipulator.manipulateAsync(asset.uri,[{crop:{originX:Math.floor((asset.width-side)/2),originY:Math.floor((asset.height-side)/2),width:side,height:side}},{resize:{width:256,height:256}}],{compress:0.8,format:ImageManipulator.SaveFormat.JPEG,base64:true});
    if(!result.base64)throw Error('Dieses Bild konnte nicht verarbeitet werden.');
    const data='data:image/jpeg;base64,'+result.base64;if(data.length>180000)throw Error('Bitte ein kleineres Bild wählen.');setAvatar(data);
  });
  if(!liste&&!fehler)return <Laden/>;
  return <ScrollView style={{flex:1,backgroundColor:C.bg}} contentContainerStyle={{padding:M.rand,paddingTop:28}} keyboardShouldPersistTaps="handled"><View style={{maxWidth:850,gap:14}}>
    <Text style={st.h1}>{unlock?'Profil öffnen':accountEdit?claim?'Serverbesitzer werden':'Account-Passwort ändern':edit?edit.id?'Profil bearbeiten':'Neues Profil':activeProfile?'Account & Profile':'Wer schaut?'}</Text><Text style={st.gedaempft}>{account?.email||'Deine Profile, Bilder und Wiedergabestände'}</Text>
    {!!fehler&&<Text accessibilityRole="alert" style={{color:C.red}}>{fehler}</Text>}
    {unlock?<>
      <Text style={st.h2}>{unlock.name}</Text><FokusReihe zeile={0}><FFeld spalte={0} accessibilityLabel={unlock.has_pin?'Profil-PIN':'Account-Passwort'} wert={unlock.has_pin?pin:password} aufWert={unlock.has_pin?setPin:setPassword} platzhalter={unlock.has_pin?'Sechsstellige Profil-PIN':'Account-Passwort'} secureTextEntry keyboardType={unlock.has_pin?'number-pad':'default'} maxLength={unlock.has_pin?6:128}/></FokusReihe>
      <FokusReihe zeile={1}><View style={{flexDirection:'row',gap:12}}><Knopf spalte={0} text={busy?'Bitte warten …':'Profil öffnen'} haupt onPress={()=>run(async()=>{const selected=await api('/api/accounts/select-profile',{method:'POST',body:{id:unlock.id,...(unlock.has_pin?{pin}:{password})}});setUnlock(null);await aufWahl(selected);})}/><Knopf spalte={1} text="Zurück" onPress={()=>setUnlock(null)}/></View></FokusReihe>
    </>:accountEdit?<>
      <FokusReihe zeile={0}><FFeld spalte={0} accessibilityLabel="Bisheriges Passwort" wert={password} aufWert={setPassword} platzhalter="Bisheriges Passwort" secureTextEntry maxLength={128}/></FokusReihe>
      <FokusReihe zeile={1}><FFeld spalte={0} accessibilityLabel={claim?"Besitzer-Schlüssel":"Neues Passwort"} wert={claim?ownerKey:newPassword} aufWert={claim?setOwnerKey:setNewPassword} platzhalter={claim?"Besitzer-Schlüssel aus DATA_DIR/account-setup-key":"Neues Passwort (mindestens 10 Zeichen)"} secureTextEntry maxLength={128}/></FokusReihe>
      {!claim&&<FokusReihe zeile={2}><FFeld spalte={0} accessibilityLabel="Neues Passwort wiederholen" wert={repeatPassword} aufWert={setRepeatPassword} platzhalter="Neues Passwort wiederholen" secureTextEntry maxLength={128}/></FokusReihe>}
      <Text style={st.gedaempft}>{claim?'Vorhandene Profile werden deinem Account zugeordnet. Neue Profile bleiben erhalten.':'Andere Geräte werden abgemeldet.'}</Text><FokusReihe zeile={3}><View style={{flexDirection:'row',gap:12}}><Knopf spalte={0} text={claim?"Profile übernehmen":"Passwort speichern"} haupt onPress={()=>run(async()=>{if(!claim&&newPassword!==repeatPassword)throw Error('Die neuen Passwörter stimmen nicht überein.');const r=await api(claim?'/api/accounts/claim-owner':'/api/accounts/password',{method:'POST',body:claim?{password,setupKey:ownerKey}:{currentPassword:password,newPassword}});setAccountEdit(false);await onSession(r);})}/><Knopf spalte={1} text="Zurück" onPress={()=>setAccountEdit(false)}/></View></FokusReihe>
    </>:edit?<>
      {!!avatar&&<Image source={{uri:avatar}} style={{width:90,height:90,borderRadius:45}}/>}
      <FokusReihe zeile={0}><FFeld spalte={0} accessibilityLabel="Profilname" wert={name} aufWert={setName} platzhalter="Name" maxLength={40}/></FokusReihe>
      <FokusReihe zeile={1}><View style={{flexDirection:'row',gap:12,flexWrap:'wrap'}}>{!istTV&&<Knopf spalte={0} text="Bild auswählen" onPress={photo}/>}{!!avatar&&<Knopf spalte={1} text="Bild entfernen" onPress={()=>setAvatar(null)}/>}<Knopf spalte={2} text={child?'Kinderprofil: An':'Kinderprofil: Aus'} onPress={()=>setChild(v=>!v)}/></View></FokusReihe>
      {child&&<><FokusReihe zeile={2}><View style={{flexDirection:'row',gap:10,flexWrap:'wrap'}}>{[0,6,12,16].map((a,i)=><Knopf key={a} spalte={i} text={`Bis ${a} Jahre${age===a?' ✓':''}`} onPress={()=>setAge(a)}/>)}</View></FokusReihe><Text style={st.gedaempft}>Unbekannte Altersfreigaben, Kanäle und externe Trailer werden ausgeblendet.</Text></>}
      <FokusReihe zeile={3}><FFeld spalte={0} accessibilityLabel="Profil-PIN" wert={pin} aufWert={v=>{setPin(v.replace(/[^0-9]/g,''));setPinChanged(true);}} platzhalter={edit.has_pin?'Neue PIN (leer: bisherige bleibt)':'Optionale PIN, sechs Ziffern'} secureTextEntry keyboardType="number-pad" maxLength={6}/></FokusReihe>
      {!!edit.has_pin&&<FokusReihe zeile={4}><Knopf spalte={0} text={pinChanged&&!pin?'PIN wird entfernt':'PIN entfernen'} onPress={()=>{setPin('');setPinChanged(true);}}/></FokusReihe>}
      <FokusReihe zeile={5}><FFeld spalte={0} accessibilityLabel="Account-Passwort zur Bestätigung" wert={password} aufWert={setPassword} platzhalter="Account-Passwort zur Bestätigung" secureTextEntry maxLength={128}/></FokusReihe>
      <FokusReihe zeile={6}><View style={{flexDirection:'row',gap:12,flexWrap:'wrap'}}><Knopf spalte={0} text={busy?'Speichert …':'Speichern'} haupt onPress={save}/><Knopf spalte={1} text="Zurück" onPress={()=>setEdit(null)}/>{!!edit.id&&liste?.length>1&&<Knopf spalte={2} text="Profil löschen" onPress={()=>setDeleting(true)}/>}</View></FokusReihe>
      {deleting&&<><Text style={{color:C.red}}>Profil „{edit.name}“ mit Fortschritt und Merkliste dauerhaft löschen?</Text><FokusReihe zeile={7}><Knopf spalte={0} text="Endgültig löschen" onPress={()=>run(async()=>{await api('/api/profiles/'+edit.id,{method:'DELETE',body:{password}});await load();setEdit(null);})}/></FokusReihe></>}
      {istTV&&<View style={{gap:10,alignItems:'flex-start'}}><Text style={st.h2}>Profilbild am Handy ändern</Text><QrBild text={base.replace(/\/$/,'')+'/#/profiles?edit='+edit.id}/><Text style={st.gedaempft}>In der WebApp mit deinem Account anmelden und das Bild auswählen.</Text></View>}
    </>:<>
      <Text style={st.h2}>Deine Profile</Text>
      <Text style={st.gedaempft}>Bild wählen zum Wechseln. Unter „Bearbeiten“ findest du Profilbild, Name, Kinderfreigaben und sechsstellige PIN.</Text>
      <FokusReihe zeile={0}><View style={{flexDirection:'row',gap:20,flexWrap:'wrap'}}>{(liste||[]).map((p,i)=><FKnopf key={p.id} spalte={i} onPress={()=>choose(p)} style={{width:112,alignItems:'center',borderWidth:2,borderColor:'transparent',padding:6,borderRadius:12}} fokusStil={st.kachelFokus}><View style={{width:80,height:80,borderRadius:40,overflow:'hidden',backgroundColor:p.avatar?'transparent':C.red,alignItems:'center',justifyContent:'center'}}>{p.avatar?<Image source={{uri:p.avatar}} style={{width:80,height:80}}/>:<Text style={{fontSize:32,color:C.weiss}}>{p.name?.[0]}</Text>}</View><Text style={st.kachelTitel}>{p.name}</Text><Text style={st.gedaempft}>{p.is_child?`Bis ${p.max_age} Jahre`:''}{p.has_pin?' · PIN':''}</Text></FKnopf>)}</View></FokusReihe>
      <FokusReihe zeile={1}><View style={{flexDirection:'row',gap:12,flexWrap:'wrap'}}>{(liste||[]).map((p,i)=><Knopf key={p.id} text={p.name+' bearbeiten'} spalte={i} onPress={()=>open(p)}/>)}</View></FokusReihe>
      <FokusReihe zeile={2}><View style={{flexDirection:'row',gap:12,flexWrap:'wrap'}}><Knopf spalte={0} text="Profil hinzufügen" onPress={()=>open({id:0,name:'',avatar:null})}/></View></FokusReihe>
      <Text style={[st.h2,{marginTop:16}]}>Dein Account</Text>
      <Text style={st.gedaempft}>{account?.email} · {account?.isAdmin?'Serverbesitzer':'angemeldet'}</Text>
      <FokusReihe zeile={3}><View style={{flexDirection:'row',gap:12,flexWrap:'wrap'}}><Knopf spalte={0} text="Account-Passwort ändern" onPress={()=>{setClaim(false);setAccountEdit(true);setPassword('');setNewPassword('');setRepeatPassword('');setFehler('');}}/>{!!aufAbmelden&&<Knopf spalte={1} text="Account abmelden" onPress={aufAbmelden}/>}</View></FokusReihe>
      <Text style={st.gedaempft}>Nach dem Abmelden kannst du einen anderen Account anmelden oder erstellen. Gespeicherte Passwörter und PINs sind nicht auslesbar.</Text>
      {canClaim&&<FokusReihe zeile={4}><Knopf spalte={0} text="Vorhandene Profile übernehmen" onPress={()=>{setClaim(true);setAccountEdit(true);setPassword('');setOwnerKey('');setFehler('');}}/></FokusReihe>}
      {!!aufZurueck&&<FokusReihe zeile={5}><Knopf text="Zurück" spalte={0} onPress={aufZurueck}/></FokusReihe>}
    </>}
  </View></ScrollView>;
}
