import sharp from "sharp";
import {test,expect} from '@playwright/test';
test('personal account, child profile, PIN, images, isolation and logout',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.getByLabel('Server-Passwort',{exact:true}).fill('server-ui-password');await page.getByRole('button',{name:'Server öffnen',exact:true}).click();
 await page.getByRole('button',{name:'Neuen Account erstellen',exact:true}).click();
 await page.getByLabel('E-Mail',{exact:true}).fill(`${info.project.name}-${Date.now()}@example.test`);
 await page.getByLabel('Account-Passwort',{exact:true}).fill('browser-test-password');await page.getByLabel('Passwort wiederholen',{exact:true}).fill('browser-test-password');
 await page.getByRole('button',{name:'Account erstellen',exact:true}).click();await expect(page.getByRole('heading',{name:'Wer schaut?'})).toBeVisible();
 await page.getByRole('button',{name:'Profil hinzufügen',exact:true}).click();
 await page.getByPlaceholder('Dein Name').fill('Kleine Zuschauer');await page.getByLabel('Kinderprofil',{exact:true}).check();await page.getByLabel('Altersgrenze',{exact:true}).selectOption('6');
 await page.getByLabel('Account-Passwort zur Bestätigung',{exact:true}).fill('browser-test-password');await page.getByRole('button',{name:'Speichern',exact:true}).click();
 await page.getByRole('button',{name:'Profil Kleine Zuschauer auswählen',exact:true}).click();await expect(page).toHaveURL(/#\/$/);
 await page.goto('/#/movies');await expect(page.getByText('Familienfilm',{exact:true}).first()).toBeVisible();await expect(page.getByText('Erwachsenenfilm',{exact:true})).toHaveCount(0);await expect(page.getByText('Unbekannte Freigabe',{exact:true})).toHaveCount(0);
 await page.goto('/#/profiles');await page.getByRole('button',{name:'Profil Standard auswählen',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByLabel('Account-Passwort',{exact:true}).fill('wrong-password');await page.getByRole('button',{name:'Profil öffnen',exact:true}).click();await expect(page.getByRole('alert').last()).toContainText('falsch');
 await page.getByLabel('Account-Passwort',{exact:true}).fill('browser-test-password');await page.getByRole('button',{name:'Profil öffnen',exact:true}).click();await expect(page).toHaveURL(/#\/$/);
 await page.goto('/#/profiles');await page.getByRole('button',{name:'Standard bearbeiten',exact:true}).click();
 const avatar=await sharp({create:{width:256,height:256,channels:3,background:'#ff8800'}}).png().toBuffer();
 await page.getByLabel('Profilbild auswählen',{exact:true}).setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:avatar});await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
 await page.getByLabel('Profil-PIN',{exact:true}).fill('123456');await page.getByLabel('Account-Passwort zur Bestätigung',{exact:true}).fill('browser-test-password');await page.getByRole('button',{name:'Speichern',exact:true}).click();
 await expect(page.getByRole('button',{name:'Profil Standard auswählen',exact:true}).locator('img')).toHaveAttribute('src',/^data:image\//);
 await page.getByRole('button',{name:'Profil Kleine Zuschauer auswählen',exact:true}).click();await expect(page).toHaveURL(/#\/$/);await page.goto('/#/profiles');await page.getByRole('button',{name:'Profil Standard auswählen',exact:true}).click();await page.getByLabel('Profil-PIN',{exact:true}).fill('123456');await page.getByRole('button',{name:'Profil öffnen',exact:true}).click();await expect(page).toHaveURL(/#\/$/);
 await page.goto('/#/profiles');await page.getByRole('button',{name:'Kleine Zuschauer bearbeiten',exact:true}).click();await page.getByLabel('Account-Passwort zur Bestätigung',{exact:true}).fill('browser-test-password');await page.getByRole('button',{name:'Profil löschen',exact:true}).click();await page.getByRole('button',{name:'Endgültig löschen',exact:true}).click();await expect(page.getByRole('button',{name:'Profil Kleine Zuschauer auswählen',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Account abmelden',exact:true}).click();await expect(page.getByRole('button',{name:'Anmelden',exact:true})).toBeVisible();await expect(page.getByText('Familienfilm',{exact:true})).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('an existing account can claim and retain legacy profiles with the owner key',async({page,request},info)=>{
 test.skip(info.project.name!=='desktop','Owner migration runs once per disposable server.');
 const gateway=await (await request.post('/api/login',{data:{password:'server-ui-password'}})).json();
 const account=await (await request.post('/api/accounts/register',{headers:{Authorization:'Bearer '+gateway.token},data:{email:'claim-owner@example.test',password:'owner-browser-password',serverPassword:'server-ui-password'}})).json();
 const ping=await (await request.get('/api/ping')).json();
 await page.addInitScript(({id,token,server})=>{localStorage.setItem('ghgflix.web.token',server);localStorage.setItem('ghgflix.account.'+id,token);},{id:ping.id,token:account.token,server:gateway.token});
 await page.goto('/#/profiles');await page.getByRole('button',{name:'Vorhandene Profile übernehmen',exact:true}).click();
 await page.getByLabel('Bisheriges Passwort',{exact:true}).fill('owner-browser-password');await page.getByLabel('Besitzer-Schlüssel',{exact:true}).fill('fixture-owner-setup');
 await page.getByRole('button',{name:'Profile übernehmen',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^Profil .+ auswählen$/})).toHaveCount(2);
 await expect(page.getByRole('button',{name:'Vorhandene Profile übernehmen',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:/^Profil .+ auswählen$/}).first().click();await expect(page).toHaveURL(/#\/$/);await page.goto('/#/settings');
 await expect(page.getByRole('button',{name:'Server & Verbindung',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Server & Verbindung',exact:true}).click();await expect(page.getByText('GHGFLIX_PASSWORD',{exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/settings-server-guide.png',fullPage:true,animations:'disabled'});
});

test('account switch clears cached appearance preferences and keeps server controls hidden',async({page,request},info)=>{
 test.skip(info.project.name!=='desktop','Shared store regression.');
 const gateway=await (await request.post('/api/login',{data:{password:'server-ui-password'}})).json();
 const ping=await (await request.get('/api/ping')).json();
 const users=[];
 for(const suffix of ['a','b']){
   const u=await (await request.post('/api/accounts/register',{headers:{Authorization:'Bearer '+gateway.token},data:{email:`prefs-${suffix}@example.test`,password:'preferences-test-password',serverPassword:'server-ui-password'}})).json();
   const profiles=await (await request.get('/api/profiles',{headers:{Authorization:'Bearer '+u.token}})).json();
   await request.post('/api/accounts/select-profile',{headers:{Authorization:'Bearer '+u.token},data:{id:profiles[0].id}});users.push(u);
 }
 await request.post('/api/invoke/set_setting',{headers:{Authorization:'Bearer '+users[0].token},data:{key:'pref_cardSize',value:'sm'}});
 await page.addInitScript(({id,token,server})=>{localStorage.setItem('ghgflix.web.token',server);localStorage.setItem('ghgflix.account.'+id,token);},{id:ping.id,token:users[0].token,server:gateway.token});
 await page.goto('/#/settings');await expect(page.getByRole('combobox',{name:'Kartengröße',exact:true})).toHaveValue('sm');
 await expect(page.getByRole('button',{name:'Bibliothek',exact:true})).toHaveCount(0);
 await page.goto('/#/profiles');await page.getByRole('button',{name:'Account abmelden',exact:true}).click();
 await page.getByLabel('E-Mail',{exact:true}).fill('prefs-b@example.test');await page.getByLabel('Account-Passwort',{exact:true}).fill('preferences-test-password');await page.getByRole('button',{name:'Anmelden',exact:true}).click();
 await page.getByRole('button',{name:'Profil Standard auswählen',exact:true}).click();await page.goto('/#/settings');
 await expect(page.getByRole('combobox',{name:'Kartengröße',exact:true})).toHaveValue('md');
});
