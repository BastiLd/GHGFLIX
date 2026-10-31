import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(here);
export default defineConfig({testDir:'account-test',outputDir:'../test-results/native-account-browser',timeout:45000,workers:1,use:{baseURL:'http://127.0.0.1:19849',headless:true,channel:'chrome'},webServer:[{command:'node tests/integration/account-server.mjs',cwd:root,url:'http://127.0.0.1:19848/api/ping',reuseExistingServer:false},{command:'npm run dev -- --port 19849',cwd:here,env:{GHGFLIX_TEST_SERVER_URL:'http://127.0.0.1:19848'},url:'http://127.0.0.1:19849/app.html',reuseExistingServer:false}],projects:[{name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'tv',use:{viewport:{width:960,height:540}}}]});
