import {test,expect} from '@playwright/test';
test('native components against real account API: registration, child profile, PIN and logout',async({page,request},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const gateway=await (await request.post('http://127.0.0.1:19848/api/login',{data:{password:'server-ui-password'}})).json();
 await page.addInitScript(({device,token})=>localStorage.setItem(`ghgflix-preview:${device}:ghgflix.conn`,JSON.stringify({manualUrl:location.origin,list:[],token,profile:0})),{device:info.project.name,token:gateway.token});
 await page.goto(`/app.html?live=1&setup=1&device=${info.project.name}`);
 await page.getByText('Neuen Account erstellen',{exact:true}).click();
 await page.getByPlaceholder('E-Mail',{exact:true}).fill(`${info.project.name}-${Date.now()}@native.example.test`);
 await page.getByPlaceholder('Account-Passwort',{exact:true}).fill('native-test-password');await page.getByPlaceholder('Passwort wiederholen').fill('native-test-password');await page.getByPlaceholder('Server-Passwort für neuen Account').fill('server-ui-password');
 await page.getByText('Account anlegen',{exact:true}).click();await expect(page.getByText('Wer schaut?',{exact:true})).toBeVisible();
 await page.getByText('Profil hinzufügen',{exact:true}).click();await page.getByPlaceholder('Name',{exact:true}).fill('Kind');await page.getByText('Kinderprofil: Aus',{exact:true}).click();await page.getByText('Bis 6 Jahre',{exact:true}).click();await page.getByPlaceholder('Account-Passwort zur Bestätigung').fill('native-test-password');await page.getByText('Speichern',{exact:true}).click();
 await page.getByText('Standard bearbeiten',{exact:true}).click();await page.getByPlaceholder('Optionale PIN, sechs Ziffern').fill('123456');await page.getByPlaceholder('Account-Passwort zur Bestätigung').fill('native-test-password');await page.getByText('Speichern',{exact:true}).click();
 await page.getByText('Kind',{exact:true}).click();await expect(page.getByText('Familienfilm',{exact:true}).first()).toBeVisible();await expect(page.getByText('Erwachsenenfilm',{exact:true})).toHaveCount(0);
 await page.getByLabel('Account & Profile',{exact:true}).click();await page.getByText('Standard',{exact:true}).click();await page.getByPlaceholder('Sechsstellige Profil-PIN').fill('123456');await page.getByText('Profil öffnen',{exact:true}).last().click();await expect(page.getByText('Erwachsenenfilm',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Einstellungen',exact:true}).click();await expect(page.getByText('App aktualisieren',{exact:true})).toBeVisible();
 await page.getByText('Account & Profile öffnen',{exact:true}).click();
 await page.getByText('Account-Passwort ändern',{exact:true}).click();await page.getByPlaceholder('Bisheriges Passwort',{exact:true}).fill('native-test-password');await page.getByPlaceholder('Neues Passwort (mindestens 10 Zeichen)',{exact:true}).fill('native-updated-password');await page.getByPlaceholder('Neues Passwort wiederholen',{exact:true}).fill('native-updated-password');await page.getByText('Passwort speichern',{exact:true}).click();
 await page.getByLabel('Account & Profile',{exact:true}).click();await page.getByText('Account abmelden',{exact:true}).click();await expect(page.getByText('Dein Account',{exact:true})).toBeVisible();expect(errors).toEqual([]);
});
