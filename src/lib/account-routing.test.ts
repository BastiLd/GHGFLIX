// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),command:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}));
vi.mock('tauri-plugin-mpv-api',()=>({command:mocks.command}));
beforeEach(()=>{
  vi.resetModules();vi.clearAllMocks();const storage=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
  Object.assign(window,{__TAURI_INTERNALS__:{}});
});
it('keeps the desktop connection local and sends library/preview requests to the selected account server',async()=>{
  const p=await import('./platform');p.configureAccountServer('http://fixture.test:8484','one');p.setAccountToken('personal-token');
  const fetcher=vi.fn().mockResolvedValue(Response.json({result:'/api/thumbfile?path=fixture&token=personal-token'}));vi.stubGlobal('fetch',fetcher);
  const {invoke}=await import('./backend');
  await invoke('get_setting',{key:'ghg_server_config'});expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('get_setting',{key:'ghg_server_config'});
  expect(await invoke('media_thumbnail',{path:'/library/movie.mkv'})).toBe('http://fixture.test:8484/api/thumbfile?path=fixture&token=personal-token');
  expect(fetcher).toHaveBeenCalledWith('http://fixture.test:8484/api/invoke/media_thumbnail',expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer personal-token'})}));
  p.configureAccountServer('http://other.test','two');expect(p.accountToken()).toBe('');
});
it('loads a protected server stream into native mpv and leaves local playback local',async()=>{
  const p=await import('./platform');p.configureAccountServer('http://fixture.test:8484','one');p.setAccountToken('personal-token');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({result:{directUrl:'/api/stream/movie/1'}})));
  const {command}=await import('./mpv');await command('loadfile',['/server/movie.mkv','replace']);
  expect(mocks.command).toHaveBeenCalledWith('loadfile',['http://fixture.test:8484/api/stream/movie/1?token=personal-token','replace']);
  p.configureAccountServer(null,'');await command('loadfile',['C:/local/movie.mkv','replace']);
  expect(mocks.command).toHaveBeenLastCalledWith('loadfile',['C:/local/movie.mkv','replace']);
});
