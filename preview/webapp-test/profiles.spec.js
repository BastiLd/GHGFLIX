import {test,expect} from '@playwright/test';
import path from 'node:path';

test('Profilname und privates Bild erscheinen in zweitem Browser',async({page,browser},info)=>{
  const name='Profilpruefung '+info.project.name;
  const renamed=name+' Neu';
  {
    await page.goto('/#/profiles');
    await page.getByRole('button',{name:'Profil hinzufügen'}).click();
    await page.getByPlaceholder('Dein Name').fill(name);
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    await page.getByRole('button',{name:name+' bearbeiten',exact:true}).click();
    await page.getByPlaceholder('Dein Name').fill(renamed);
    await page.getByLabel('Profilbild auswählen').setInputFiles(path.resolve('public/icon-512.png'));
    await expect(page.getByRole('heading',{name:'Profilbild anpassen'})).toBeVisible();
    await page.getByRole('slider',{name:'Bildzoom'}).focus();
    await page.getByRole('slider',{name:'Bildzoom'}).press('Home');
    await expect(page.getByRole('slider',{name:'Bildzoom'})).toHaveValue('0.2');
    const pixels=()=>page.getByAltText('Runde Profilbild-Vorschau').evaluate(async img=>{
      await img.decode();const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,256,256);
      return {corner:[...ctx.getImageData(0,0,1,1).data],empty:[...ctx.getImageData(128,24,1,1).data]};
    });
    await expect.poll(async()=>(await pixels()).empty[3]).toBe(0);
    await page.getByLabel('Hintergrundfarbe',{exact:true}).fill('#35a7ff');
    await expect.poll(async()=>(await pixels()).empty).toEqual([53,167,255,255]);
    expect((await pixels()).corner[3]).toBe(0);
    await page.screenshot({path:`preview/evidence/avatar-crop-${info.project.name}.png`});
    await page.getByRole('radio',{name:'Transparent',exact:true}).check();
    await expect.poll(async()=>(await pixels()).empty[3]).toBe(0);
    await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    await expect(page.getByAltText('Profilbild-Vorschau')).toBeVisible();
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    const other=await browser.newContext({viewport:{width:390,height:844}});
    const second=await other.newPage();
    await second.goto(new URL('/#/profiles', page.url()).href);
    await expect(second.getByRole('button',{name:'Profil '+renamed+' auswählen'}).locator('img')).toBeVisible();
    await second.getByRole('button',{name:renamed+' bearbeiten',exact:true}).click();
    await expect(second.getByPlaceholder('Dein Name')).toHaveValue(renamed);
    await expect(second.getByAltText('Profilbild-Vorschau')).toBeVisible();
    expect(await second.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await second.screenshot({path:`preview/evidence/profile-editor-${info.project.name}.png`});
    await other.close();
  }
});
