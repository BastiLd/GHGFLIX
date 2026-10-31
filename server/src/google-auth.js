import {randomBytes,createHash,createPublicKey,verify} from 'node:crypto';
import {openDb} from './db.js';
import {accountError,cleanEmail,digest,newSession,registerAccount,verifyPassword} from './accounts.js';

const pending=new Map();
const clientId=()=>process.env.GOOGLE_CLIENT_ID||'';
const redirectUri=()=>process.env.GOOGLE_REDIRECT_URI||'';
export function googleConfigured(){
  try { const u=new URL(redirectUri());return !!(clientId()&&process.env.GOOGLE_CLIENT_SECRET&&u.protocol==='https:'&&u.pathname==='/api/accounts/google/callback'&&!u.search&&!u.hash&&!u.username&&!u.password); }
  catch{return false;}
}
const clean=()=>{for(const [id,p] of pending)if(p.expires<Date.now())pending.delete(id);};
function operation(body,serverHash){
  clean();const p=pending.get(String(body.id));
  if(!p||p.proof!==digest(body.proof??'')||p.serverHash!==serverHash)throw accountError('Google-Anmeldung abgelaufen. Bitte neu starten.',403);
  return p;
}
export function startGoogle(serverHash){
  if(!googleConfigured())throw accountError('Google-Anmeldung ist am Server noch nicht eingerichtet.',503);
  clean();if(pending.size>=100)throw accountError('Zu viele Anmeldungen. Bitte später versuchen.',429);
  const id=randomBytes(24).toString('base64url'),proof=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),nonce=randomBytes(24).toString('base64url');
  pending.set(id,{proof:digest(proof),serverHash,verifier,nonce,expires:Date.now()+10*60_000,used:false,busy:false,claims:null,error:null});
  const params=new URLSearchParams({client_id:clientId(),redirect_uri:redirectUri(),response_type:'code',scope:'openid email',state:id,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'});
  pending.get(id).authorizationUrl='https://accounts.google.com/o/oauth2/v2/auth?'+params;
  return {id,proof,url:new URL(redirectUri()).origin+'/api/accounts/google/go?id='+id,expiresIn:600};
}
export function googleAuthorizationUrl(id){clean();const p=pending.get(String(id));if(!p||p.used)throw accountError('Google-Anmeldung abgelaufen.',404);return p.authorizationUrl;}
export function validateGoogleToken(jwt,keys,expected){
  const parts=String(jwt).split('.');if(parts.length!==3)throw Error('Ungültiges Google-Token.');
  const header=JSON.parse(Buffer.from(parts[0],'base64url').toString()),claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());
  const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig'));
  if(header.alg!=='RS256'||!jwk||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw Error('Google-Signatur ungültig.');
  const now=Math.floor(Date.now()/1000);
  if(!['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||claims.aud!==expected.audience||
    (claims.azp&&claims.azp!==expected.audience)||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+60||
    claims.nonce!==expected.nonce||claims.email_verified!==true||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255)throw Error('Google-Anmeldung konnte nicht bestätigt werden.');
  cleanEmail(claims.email);return claims;
}
let certificates=null;
async function googleKeys(){
  if(certificates&&certificates.expires>Date.now())return certificates.keys;
  const r=await fetch('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Google-Schlüssel nicht erreichbar.');
  const {keys}=await r.json();if(!Array.isArray(keys))throw Error('Google-Schlüssel ungültig.');
  certificates={keys,expires:Date.now()+5*60_000};return keys;
}
export async function googleCallback(params){
  clean();const p=pending.get(params.get('state'));
  if(!p||p.used)throw accountError('Google-Anmeldung abgelaufen oder bereits verwendet.',400);
  p.used=true;
  try{
    if(params.get('error')||!params.get('code'))throw Error('Google-Anmeldung wurde abgebrochen.');
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({code:params.get('code'),client_id:clientId(),client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:redirectUri(),grant_type:'authorization_code',code_verifier:p.verifier}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Google-Anmeldung fehlgeschlagen.');
    const data=await response.json();p.claims=validateGoogleToken(data.id_token,await googleKeys(),{audience:clientId(),nonce:p.nonce});
  }catch(e){p.error='Google-Anmeldung konnte nicht abgeschlossen werden. Bitte neu starten.';throw accountError(p.error,400);}
}
export function checkGoogle(body,serverHash){
  const p=operation(body,serverHash);if(p.error)throw accountError(p.error);
  if(!p.claims)return {state:'waiting'};
  const db=openDb(),linked=db.prepare('SELECT id FROM accounts WHERE google_sub=?').get(p.claims.sub);
  return {state:'ready',email:p.claims.email,needsPassword:!linked,existingAccount:!linked&&!!db.prepare('SELECT id FROM accounts WHERE email=?').get(cleanEmail(p.claims.email))};
}
export async function finishGoogle(body,serverHash){
  const p=operation(body,serverHash);
  if(!p.claims||p.error||p.busy)throw accountError('Google-Anmeldung ist noch nicht bereit.',409);
  p.busy=true;
  try{
    const db=openDb();let user=db.prepare('SELECT * FROM accounts WHERE google_sub=?').get(p.claims.sub);
    if(!user){
      const email=cleanEmail(p.claims.email);user=db.prepare('SELECT * FROM accounts WHERE email=?').get(email);
      if(user){
        // Matching unverified local email is NOT proof of ownership. Linking
        // always requires that account's existing password.
        if(!await verifyPassword(body.password,user.password_hash))throw accountError('Zum Verknüpfen bitte das bestehende Account-Passwort eingeben.',403);
        if(user.google_sub&&user.google_sub!==p.claims.sub)throw accountError('Dieser Account ist bereits mit einem anderen Google-Konto verknüpft.',409);
      }else{
        const created=await registerAccount({email,password:body.password,setupKey:body.setupKey,serverPassword:body.serverPassword},serverHash,!!body.setupKey);
        user={id:created.account.id};
        db.prepare('DELETE FROM account_sessions WHERE token_hash=?').run(digest(created.token));
      }
      db.prepare('UPDATE accounts SET google_sub=? WHERE id=?').run(p.claims.sub,user.id);
    }
    const result=newSession(user.id,serverHash);pending.delete(String(body.id));return result;
  }finally{p.busy=false;}
}
