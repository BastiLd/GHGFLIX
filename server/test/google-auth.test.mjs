import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dir=mkdtempSync(join(tmpdir(),'ghgflix-google-'));
Object.assign(process.env,{DATA_DIR:dir,GHGFLIX_PASSWORD:'server-secret',GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-client-secret',GOOGLE_REDIRECT_URI:'https://fixture.example.test/api/accounts/google/callback'});
const {openDb}=await import('../src/db.js');const db=openDb();
const {validateGoogleToken,startGoogle,checkGoogle,googleCallback,finishGoogle,googleAuthorizationUrl}=await import('../src/google-auth.js');
const {registerAccount,sessionFor}=await import('../src/accounts.js');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture',use:'sig'};
const now=Math.floor(Date.now()/1000),claims={iss:'https://accounts.google.com',aud:'test-client',sub:'google-sub-1',nonce:'nonce',email:'google@example.test',email_verified:true,iat:now,exp:now+300};
function jwt(c=claims,h={alg:'RS256',kid:'fixture'}){const prefix=[h,c].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return prefix+'.'+sign('RSA-SHA256',Buffer.from(prefix),privateKey).toString('base64url');}
assert.equal(validateGoogleToken(jwt(),[jwk],{audience:'test-client',nonce:'nonce'}).sub,'google-sub-1');
for(const changes of [{iss:'https://attacker.test'},{aud:'other-client'},{azp:'other-client'},{nonce:'wrong'},{email_verified:false},{exp:now-1},{iat:now+500},{sub:''}])assert.throws(()=>validateGoogleToken(jwt({...claims,...changes}),[jwk],{audience:'test-client',nonce:'nonce'}));
assert.throws(()=>validateGoogleToken(jwt(claims,{alg:'none',kid:'fixture'}),[jwk],{audience:'test-client',nonce:'nonce'}));
assert.throws(()=>validateGoogleToken(jwt(),[],{audience:'test-client',nonce:'nonce'}));
const existing=await registerAccount({email:'google@example.test',password:'existing-secret-123',serverPassword:'server-secret'},'gateway');
const flow=startGoogle('gateway');assert.throws(()=>checkGoogle(flow,'other-gateway'));assert.throws(()=>checkGoogle({...flow,proof:'bad'},'gateway'));assert.equal(checkGoogle(flow,'gateway').state,'waiting');
assert.ok(flow.url.length<200,'TV QR must fit');const nonce=new URL(googleAuthorizationUrl(flow.id)).searchParams.get('nonce');let called=0;const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{called++;if(url.endsWith('/token')){assert.equal(options.body.get('client_secret'),'test-client-secret');assert.equal(options.body.get('grant_type'),'authorization_code');assert.ok(options.body.get('code_verifier'));return Response.json({id_token:jwt({...claims,nonce})});}if(url.endsWith('/certs'))return Response.json({keys:[jwk]});throw Error('Unexpected network request');};
try{
 await googleCallback(new URLSearchParams({state:flow.id,code:'fixture-code'}));assert.equal(called,2);
 await assert.rejects(()=>googleCallback(new URLSearchParams({state:flow.id,code:'replay'})));
 assert.equal(checkGoogle(flow,'gateway').existingAccount,true);
 await assert.rejects(()=>finishGoogle({...flow,password:'wrong'},'gateway'));
 assert.equal(db.prepare('SELECT google_sub FROM accounts WHERE id=?').get(existing.account.id).google_sub,null);
 const linked=await finishGoogle({...flow,password:'existing-secret-123'},'gateway');assert.equal(linked.account.id,existing.account.id);assert.ok(sessionFor(linked.token));
 assert.throws(()=>checkGoogle(flow,'gateway'));
 const signup=startGoogle('gateway');const signupNonce=new URL(googleAuthorizationUrl(signup.id)).searchParams.get('nonce');
 globalThis.fetch=async()=>Response.json({id_token:jwt({...claims,sub:'new-google-user',email:'new@example.test',nonce:signupNonce})});
 await googleCallback(new URLSearchParams({state:signup.id,code:'new-user-code'}));
 await assert.rejects(()=>finishGoogle({...signup,password:'new-user-secret-123'},'gateway'),/Server-Passwort/);
 const created=await finishGoogle({...signup,password:'new-user-secret-123',serverPassword:'server-secret'},'gateway');
 assert.equal(created.account.email,'new@example.test');assert.equal(created.account.isAdmin,false);
 console.log('Google tests passed: signature/claims, state and proof binding, single-use callback, PKCE, explicit password linking and replay rejection. Provider network simulated.');
}finally{globalThis.fetch=original;db.close();rmSync(dir,{recursive:true,force:true});}
