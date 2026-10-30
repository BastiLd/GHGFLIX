import React,{useEffect,useState} from 'react';
import {Image,Linking,ScrollView,Text,View} from 'react-native';
import {FKnopf,FokusReihe} from './fokus.js';
import {FFeld,Knopf,Laden,QrBild} from './bausteine.js';
import {C,M,gross,st} from './stile.js';
export function ProfilSeite({api,base='',aufWahl,aufZurueck}){
  const [liste,setListe]=useState(null),[edit,setEdit]=useState(null),[name,setName]=useState(''),[fehler,setFehler]=useState(''),[busy,setBusy]=useState(false);
  const load=()=>api('/api/profiles').then(p=>setListe(Array.isArray(p)?p:[])).catch(e=>setFehler(e.message));
  useEffect(()=>{load();const t=setInterval(load,5000);return()=>clearInterval(t);},[api]);
  const save=async()=>{if(busy)return;setBusy(true);try{await api('/api/profiles/'+edit.id,{method:'PATCH',body:{name}});await load();setEdit(null);}catch(e){setFehler(e.message);}finally{setBusy(false);}};
  const address=base.replace(/\/$/,'')+'/#/profiles?edit='+edit?.id;
  if(!liste&&!fehler)return <Laden/>;
  return <ScrollView style={{flex:1,backgroundColor:C.bg}} contentContainerStyle={{padding:M.rand,paddingTop:gross?35:24}}>
    <Text style={st.h1}>{edit?'Profil bearbeiten':'Wer schaut?'}</Text>
    <Text style={[st.gedaempft,{marginTop:6,marginBottom:20}]}>{edit?'Name hier ändern. Für ein eigenes Foto die WebApp öffnen.':'Profile, Fortschritt und Meine Liste werden über deinen Server abgeglichen.'}</Text>
    {!!fehler&&<Text style={{color:C.red,marginBottom:12}}>{fehler}</Text>}
    {edit?<View style={{flexDirection:gross?'row':'column',gap:26,maxWidth:900}}>
      <View style={{flex:1,maxWidth:400}}><FokusReihe zeile={0}><FFeld wert={name} aufWert={setName} platzhalter="Name" maxLength={40} spalte={0}/></FokusReihe>
      <FokusReihe zeile={1}><View style={{flexDirection:'row',gap:10,marginTop:16}}><Knopf text={busy?'Speichert …':'Speichern'} haupt spalte={0} onPress={save}/><Knopf text="Zurück" spalte={1} onPress={()=>setEdit(null)}/></View></FokusReihe></View>
      <View style={{alignItems:'center',gap:12}}><Text style={st.h2}>Profilbild am Handy ändern</Text><QrBild text={address}/><Text selectable style={[st.gedaempft,{maxWidth:330,textAlign:'center'}]}>Mit der Kamera scannen und in der WebApp „Bild auswählen“ antippen. Eine bestehende Server-Anmeldung wird verwendet.</Text>
      {!gross&&<FokusReihe zeile={2}><Knopf text="WebApp öffnen" spalte={0} onPress={()=>Linking.openURL(address).catch(e=>setFehler(e.message))}/></FokusReihe>}</View>
    </View>:<><FokusReihe zeile={0}><View style={{flexDirection:'row',gap:20,flexWrap:'wrap'}}>{(liste||[]).map((p,i)=><FKnopf key={p.id} spalte={i} onPress={()=>aufWahl(p.id)} style={{width:100,alignItems:'center',borderWidth:2,borderColor:'transparent',padding:6,borderRadius:12}} fokusStil={st.kachelFokus}>
      <View style={{width:80,height:80,borderRadius:40,overflow:'hidden',backgroundColor:p.avatar?'transparent':C.red,alignItems:'center',justifyContent:'center'}}>{p.avatar?<Image source={{uri:p.avatar}} style={{width:80,height:80,borderRadius:40}}/>:<Text style={{fontSize:32,color:C.weiss,fontWeight:'800'}}>{p.name?.[0]}</Text>}</View><Text style={[st.kachelTitel,{marginTop:8}]}>{p.name}</Text></FKnopf>)}</View></FokusReihe>
      <FokusReihe zeile={1}><View style={{flexDirection:'row',gap:12,marginTop:16,flexWrap:'wrap'}}>{(liste||[]).map((p,i)=><Knopf key={p.id} text={p.name+' bearbeiten'} spalte={i} onPress={()=>{setEdit(p);setName(p.name);setFehler('');}}/>)}</View></FokusReihe>
      {!!aufZurueck&&<FokusReihe zeile={2}><View style={{marginTop:22}}><Knopf text="Zurück" spalte={0} onPress={aufZurueck}/></View></FokusReihe>}</>}
  </ScrollView>;
}
