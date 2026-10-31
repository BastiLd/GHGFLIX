// Recovery requires direct access to the server/container. Nothing here is
// exposed over HTTP. Passwords arrive over stdin, never command-line arguments.
import {openDb} from './db.js';
import {cleanEmail,hashPassword} from './accounts.js';
import {emitKeypressEvents} from 'node:readline';

async function passwordInput(){
  if(!process.stdin.isTTY){
    let value='';for await(const chunk of process.stdin){value+=chunk;if(value.length>256)throw Error('Passwort zu lang.');}
    return value.replace(/\r?\n$/,'');
  }
  process.stdout.write('Neues Passwort (10–128 Zeichen): ');
  emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=(error)=>{process.stdin.off('keypress',key);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value);};
    const key=(str,k)=>{if(k?.ctrl&&k?.name==='c')return finish(Error('Abgebrochen.'));if(k?.name==='return')return finish();if(k?.name==='backspace'){value=value.slice(0,-1);return;}if(str&&!k?.ctrl&&!k?.meta&&value.length<128)value+=str;};
    process.stdin.on('keypress',key);
  });
}
try{
  const [command,email]=process.argv.slice(2);
  if(command!=='reset-password'||!email)throw Error('Aufruf: node src/account-admin.js reset-password <E-Mail> (Passwort verdeckt oder über stdin eingeben)');
  const db=openDb(),user=db.prepare('SELECT id FROM accounts WHERE email=?').get(cleanEmail(email));
  if(!user)throw Error('Account nicht gefunden.');
  const hash=await hashPassword(await passwordInput());
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('UPDATE accounts SET password_hash=? WHERE id=?').run(hash,user.id);
    db.prepare('DELETE FROM account_sessions WHERE account_id=?').run(user.id);
    for(const table of ['push_devices','native_push_devices'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)&&db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='account_id'))db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(user.id);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  db.close();console.log('Passwort geändert. Die Account-Sitzungen und Push-Anmeldungen wurden widerrufen.');
}catch(e){console.error(e.message);process.exitCode=1;}
