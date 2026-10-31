import {defineConfig} from '@playwright/test';

const devices = [
  {name:'desktop',port:19849,viewport:{width:1440,height:900}},
  {name:'phone',port:19850,viewport:{width:390,height:844},isMobile:true,hasTouch:true},
  {name:'tv',port:19851,viewport:{width:960,height:540}},
];

export default defineConfig({
  testDir:'./tests/onboarding',outputDir:'./test-results/onboarding',timeout:60000,workers:1,
  use:{headless:true},
  // Each size gets its own disposable server so owner creation is real in all three.
  webServer:devices.map(({port})=>({command:'node tests/integration/account-server.mjs',env:{PORT:String(port)},url:`http://127.0.0.1:${port}/api/ping`,reuseExistingServer:false})),
  projects:devices.map(({name,port,...use})=>({name,use:{...use,baseURL:`http://127.0.0.1:${port}`}})),
});
