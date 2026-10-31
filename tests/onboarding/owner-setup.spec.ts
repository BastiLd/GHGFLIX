import {test,expect} from '@playwright/test';

test('owner setup and registration survive background ticks; expired sessions still log out',async({page,request},info)=>{
  const errors:string[]=[];
  const scans:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',r=>{if(r.url().endsWith('/api/invoke/scan_status'))scans.push(r.url());});
  await page.goto('/');
  await page.getByLabel('Server-Passwort',{exact:true}).fill('server-ui-password');
  await page.getByRole('button',{name:'Server öffnen',exact:true}).click();
  const ownerButton=page.getByRole('button',{name:'Ich bin der Serverbesitzer',exact:true});
  await expect(ownerButton).toHaveCSS('border-top-width','1px');
  await ownerButton.focus();
  await expect(ownerButton).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/onboarding-login-${info.project.name}.png`,fullPage:true,animations:'disabled'});
  await ownerButton.press('Enter');
  await page.getByLabel('E-Mail',{exact:true}).fill(`${info.project.name}-owner@example.test`);
  await page.getByLabel('Account-Passwort',{exact:true}).fill('owner-browser-password');
  await page.getByLabel('Passwort wiederholen',{exact:true}).fill('owner-browser-password');
  await page.getByLabel('Besitzer-Schlüssel',{exact:true}).fill('fixture-owner-setup');
  // More than two real two-second poll intervals, not just a fast click-through.
  await page.waitForTimeout(5200);
  await expect(page.getByRole('heading',{name:'Besitzer-Account einrichten',exact:true})).toBeVisible();
  await expect(page.getByLabel('Besitzer-Schlüssel',{exact:true})).toHaveValue('fixture-owner-setup');
  await page.screenshot({path:`test-results/onboarding-owner-${info.project.name}.png`,fullPage:true,animations:'disabled'});
  expect(scans).toHaveLength(0);
  await page.getByRole('button',{name:'Zur Anmeldung',exact:true}).click();
  await page.getByRole('button',{name:'Neuen Account erstellen',exact:true}).click();
  await page.waitForTimeout(4200);
  await expect(page.getByRole('heading',{name:'Account erstellen',exact:true})).toBeVisible();
  await expect(page.getByLabel('Account-Passwort',{exact:true})).toHaveValue('owner-browser-password');
  expect(scans).toHaveLength(0);
  await page.getByRole('button',{name:'Ich bin der Serverbesitzer',exact:true}).click();
  await page.getByLabel('Besitzer-Schlüssel',{exact:true}).fill('wrong-key');
  await page.getByRole('button',{name:'Besitzer-Account anlegen',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Besitzer-Schlüssel ungültig');
  await expect(page.getByRole('heading',{name:'Besitzer-Account einrichten',exact:true})).toBeVisible();
  await page.getByLabel('Besitzer-Schlüssel',{exact:true}).fill('fixture-owner-setup');
  await page.getByRole('button',{name:'Besitzer-Account anlegen',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Wer schaut?',exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^Profil .+ auswählen$/}).first().click();
  await expect.poll(()=>scans.length).toBeGreaterThan(0);
  const token=await page.evaluate(()=>{
    const key=Object.keys(localStorage).find(k=>k.startsWith('ghgflix.account.'));
    return key?localStorage.getItem(key):null;
  });
  expect(token).toBeTruthy();
  // Revoke on the real server: no synthetic UI event and no client logout button.
  expect((await request.post('/api/accounts/logout',{headers:{Authorization:`Bearer ${token}`},data:{}})).ok()).toBe(true);
  await expect(page.getByRole('heading',{name:'Dein Account',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('account actions respect reduced motion',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  const button=page.getByRole('button',{name:'Server öffnen',exact:true});
  await button.hover();
  await expect(button).toHaveCSS('transform','none');
  await expect(button).toHaveCSS('transition-duration','0s');
});
