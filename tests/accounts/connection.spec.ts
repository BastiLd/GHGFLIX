import {test,expect} from '@playwright/test';
test('desktop recovery accepts the server password directly, then opens account login',async({page},info)=>{
  test.skip(info.project.name!=='desktop','Desktop transport simulation; no native window is controlled.');
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const w=window as any;
    w.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,
      invoke:async(cmd:string,args:any)=>{
        if(cmd==='get_setting'&&args.key==='ghg_server_config')return localStorage.getItem('fixture.config')||(location.search.includes('fresh=1')?null:JSON.stringify({enabled:true,mode:'manual',manualUrl:'http://old-server.test',endpoints:[],token:''}));
        if(cmd==='set_setting'&&args.key==='ghg_server_config'){localStorage.setItem('fixture.config',args.value);return;}
        if(cmd==='plugin:app|version')return '3.6.1';
        return null;
      }};
    w.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  });
  await page.route('http://old-server.test/api/ping',r=>r.fulfill({json:{app:'ghgflix-server',version:'2.8.0',auth:true}}));
  await page.route('http://old-server.test/api/login',r=>r.fulfill({json:r.request().postDataJSON().password==='right-server-password'?{token:'old-token'}:{error:'Passwort falsch'},status:r.request().postDataJSON().password==='right-server-password'?200:401}));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Mit Server verbinden',exact:true})).toBeVisible();
  await expect(page.getByLabel('Serveradresse',{exact:true})).toHaveValue('http://old-server.test');
  await page.getByLabel('Server-Passwort',{exact:true}).fill('wrong');
  await page.getByRole('button',{name:'Verbinden und anmelden',exact:true}).click();await expect(page.getByRole('alert').last()).toContainText('Passwort falsch');
  await page.getByLabel('Server-Passwort',{exact:true}).fill('right-server-password');
  await page.getByRole('button',{name:'Server-Passwort anzeigen',exact:true}).click();await expect(page.getByLabel('Server-Passwort',{exact:true})).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'Server-Passwort verbergen',exact:true}).click();
  await page.getByRole('button',{name:'Verbinden und anmelden',exact:true}).click();await expect(page.getByRole('alert').last()).toContainText('Server-Passwort angenommen.');
  expect(await page.evaluate(()=>localStorage.getItem('fixture.config'))).toBeNull();
  await page.screenshot({path:'test-results/desktop-old-server-message.png',fullPage:true});
  await page.getByLabel('Serveradresse',{exact:true}).fill('http://127.0.0.1:19848');
  await page.getByLabel('Server-Passwort',{exact:true}).fill('server-ui-password');
  await page.getByRole('button',{name:'Verbinden und anmelden',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Dein Account',exact:true})).toBeVisible();
  const config=await page.evaluate(()=>localStorage.getItem('fixture.config'));
  expect(config).not.toContain('server-ui-password');expect(JSON.parse(config!).token).toBeTruthy();
  await page.getByRole('button',{name:'Serveradresse oder Server-Passwort ändern',exact:true}).click();
  await expect(page.getByLabel('Server-Passwort',{exact:true})).toHaveValue('');
  await page.evaluate(()=>localStorage.removeItem('fixture.config'));await page.goto('/?fresh=1');
  await expect(page.getByRole('heading',{name:'Mit Server verbinden',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Lokale Desktop-Bibliothek öffnen',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('profile entry exposes account settings, confirms password change and logs back in',async({page,request},info)=>{
  const email=`access-${info.project.name}@example.test`,password='first-account-password',next='second-account-password';
  const gateway=await (await request.post('/api/login',{data:{password:'server-ui-password'}})).json();
  const ping=await (await request.get('/api/ping')).json();
  const account=await (await request.post('/api/accounts/register',{headers:{Authorization:'Bearer '+gateway.token},data:{email,password,serverPassword:'server-ui-password'}})).json();
  const profiles=await (await request.get('/api/profiles',{headers:{Authorization:'Bearer '+account.token}})).json();
  await request.post('/api/accounts/select-profile',{headers:{Authorization:'Bearer '+account.token},data:{id:profiles[0].id}});
  await page.addInitScript(({id,token,server})=>{localStorage.setItem('ghgflix.web.token',server);localStorage.setItem('ghgflix.account.'+id,token);},{id:ping.id,token:account.token,server:gateway.token});
  await page.goto('/');await page.getByRole('button',{name:/^Account & Profile/}).filter({visible:true}).first().click();
  await expect(page.getByRole('heading',{name:'Dein Account',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Deine Profile',exact:true})).toBeVisible();
  await page.screenshot({path:`test-results/profiles-hub-${info.project.name}.png`,fullPage:true});
  const scroll=page.getByTestId('profile-scroll');
  await scroll.evaluate(e=>{e.scrollTop=e.scrollHeight;});
  if(info.project.name!=='desktop')expect(await scroll.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
  await scroll.evaluate(e=>{e.scrollTop=0;});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Account-Passwort ändern',exact:true}).click();
  await page.getByLabel('Bisheriges Passwort',{exact:true}).fill(password);
  await page.getByLabel('Neues Passwort',{exact:true}).fill(next);
  await page.getByLabel('Neues Passwort wiederholen',{exact:true}).fill('different-password');
  await page.getByRole('button',{name:'Passwort speichern',exact:true}).click();await expect(page.getByRole('alert').last()).toContainText('stimmen nicht');
  await page.getByLabel('Neues Passwort wiederholen',{exact:true}).fill(next);await page.getByRole('button',{name:'Passwort speichern',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Account abmelden',exact:true}).click();await page.getByLabel('E-Mail',{exact:true}).fill(email);await page.getByLabel('Account-Passwort',{exact:true}).fill(next);
  await page.getByRole('button',{name:'Anmelden',exact:true}).click();await expect(page.getByRole('heading',{name:'Wer schaut?',exact:true})).toBeVisible();
});
