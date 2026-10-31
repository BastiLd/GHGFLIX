import type {Route} from '@playwright/test';
export async function mockAccount(route:Route){
 const path=new URL(route.request().url()).pathname;
 const profile={id:1,name:'Testprofil',avatar:null,is_child:0,max_age:12,has_pin:0};
 if(path==='/api/ping'){await route.fulfill({json:{auth:false,accounts:true,id:'browser-fixture'}});return true;}
 if(path==='/api/accounts/status'){await route.fulfill({json:{required:true,setupNeeded:false,registration:true}});return true;}
 if(path==='/api/accounts/me'){await route.fulfill({json:{account:{id:1,email:'fixture@example.test',isAdmin:true},profile,expiresAt:Date.now()+3600000}});return true;}
 if(path==='/api/profiles'){await route.fulfill({json:[profile]});return true;}
 return false;
}
