export function normalizeServerAddress(value:string):string {
  let url:URL;
  try { url=new URL(value.trim()); } catch { throw Error('Bitte eine vollständige Serveradresse mit http:// oder https:// eingeben.'); }
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)
    throw Error('Die Serveradresse darf keine Zugangsdaten, Suchparameter oder # enthalten.');
  return url.href.replace(/\/+$/,'');
}

/** Validate the server before sending its password; do not store plaintext credentials. */
export async function openServerConnection(address:string,password:string) {
  const base=normalizeServerAddress(address);
  let ping;
  try {
    const response=await fetch(base+'/api/ping',{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error();
    ping=await response.json();
    if(ping.app!=='ghgflix-server')throw Error();
  } catch { throw Error('Unter dieser Adresse antwortet kein erreichbarer GHGFlix-Server. Adresse und Verbindung prüfen.'); }
  let token='';
  if(ping.auth) {
    if(!password)throw Error('Bitte das gemeinsame Server-Passwort eingeben.');
    const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password}),signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok||!data.token)throw Error(data.error||'Das Server-Passwort wurde nicht angenommen.');
    token=data.token;
  }
  if(!ping.accounts)throw Error(`Server ${ping.version||'(ältere Version)'}: ${ping.auth?'Server-Passwort angenommen. ':''}Für persönliche Accounts bitte zuerst den GHGFlix-Server auf Version 3.6.0 oder neuer aktualisieren. Ein App-Update allein reicht nicht.`);
  return {base,token,id:String(ping.id),version:ping.version};
}
