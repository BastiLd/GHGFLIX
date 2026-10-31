import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const dir=mkdtempSync(join(tmpdir(),'ghgflix-account-recovery-'));
Object.assign(process.env,{DATA_DIR:dir,GHGFLIX_PASSWORD:'gateway-secret'});
delete process.env.GHGFLIX_ACCOUNT_SETUP_KEY;
const {openDb,setSetting,getSetting}=await import('../src/db.js');
const {accountContext}=await import('../src/account-context.js');
const a=await import('../src/accounts.js');
const db=openDb();
try {
  db.prepare("UPDATE profiles SET name='Standard' WHERE id=1").run();
  db.prepare("INSERT INTO progress VALUES(1,'movie',42,24,90,0,1)").run();
  setSetting('feeds',JSON.stringify([{id:'legacy',name:'Owner channel'}]));
  a.initializeAccounts();
  const friend=await a.registerAccount({email:'friend@example.test',password:'friend-password-123',serverPassword:'gateway-secret'},'gateway');
  const candidate=await a.registerAccount({email:'owner@example.test',password:'owner-password-123',serverPassword:'gateway-secret'},'gateway');
  const original=a.accountProfiles(a.sessionFor(candidate.token))[0];
  await accountContext.run({accountId:candidate.account.id},async()=>{
    setSetting('feeds',JSON.stringify([{id:'new',name:'New channel'}]));
    await assert.rejects(a.claimOwner(a.sessionFor(candidate.token),{password:'owner-password-123',setupKey:'wrong'}));
    const owner=await a.claimOwner(a.sessionFor(candidate.token),{password:'owner-password-123',setupKey:readFileSync(join(dir,'account-setup-key'),'utf8').trim()});
    assert(owner.account.isAdmin);assert.equal(a.sessionFor(candidate.token),null);
    assert.deepEqual(a.accountProfiles(a.sessionFor(owner.token)).map(p=>p.id),[1,original.id]);
    assert.equal(a.accountProfiles(a.sessionFor(owner.token))[0].name,'Standard (bisher 1)');
    assert.equal(db.prepare('SELECT position FROM progress WHERE profile_id=1').get().position,24);
    assert.deepEqual(JSON.parse(getSetting('feeds')).map(f=>f.id),['legacy','new']);
    assert.equal(a.accountProfiles(a.sessionFor(friend.token)).length,1);
    const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../src/account-admin.js',import.meta.url)),'reset-password','owner@example.test'],{env:process.env,input:'recovered-password-123\n',encoding:'utf8',windowsHide:true});
    assert.equal(cli.status,0,cli.stderr);assert(!cli.stdout.includes('recovered-password'));
    assert.equal(a.sessionFor(owner.token),null);assert(a.sessionFor(friend.token));
    await assert.rejects(a.loginAccount({email:'owner@example.test',password:'owner-password-123'},'gateway'));
    assert((await a.loginAccount({email:'owner@example.test',password:'recovered-password-123'},'gateway')).account.isAdmin);
  });
  console.log('Owner claim, collision-safe legacy migration, channel merge, progress preservation and host-only password recovery passed.');
} finally {db.close();rmSync(dir,{recursive:true,force:true});}
