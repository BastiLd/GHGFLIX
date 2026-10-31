// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';

beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers();
  delete (window as any).__TAURI_INTERNALS__;
  const storage=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

it('does not poll with just a gateway token, resumes after login and stops when unmounted',async()=>{
  const platform=await import('./platform');platform.configureAccountServer('','one');platform.setWebToken('gateway');
  const fetcher=vi.fn().mockResolvedValue(Response.json({result:{running:false}}));vi.stubGlobal('fetch',fetcher);
  const {listen}=await import('./backend');const stop=await listen('library://updated',vi.fn());
  await vi.advanceTimersByTimeAsync(6000);expect(fetcher).not.toHaveBeenCalled();
  platform.setAccountToken('personal');await vi.advanceTimersByTimeAsync(2000);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/invoke/scan_status',expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer personal'})}));
  platform.setAccountToken('');await vi.advanceTimersByTimeAsync(4000);expect(fetcher).toHaveBeenCalledTimes(1);
  stop();stop();expect(vi.getTimerCount()).toBe(0);
});

it('does not overlap slow polls or emit scan updates from a previous account',async()=>{
  const platform=await import('./platform');platform.configureAccountServer('','one');platform.setAccountToken('first');
  let finish!:(r:Response)=>void;
  const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);
  const {listen}=await import('./backend');const progress=vi.fn(),stop=await listen('scan://progress',progress);
  await vi.advanceTimersByTimeAsync(6000);expect(fetcher).toHaveBeenCalledTimes(1);
  platform.setAccountToken('second');finish(Response.json({result:{running:true,stage:'scan'}}));
  await vi.advanceTimersByTimeAsync(0);expect(progress).not.toHaveBeenCalled();stop();
});

it('only a 401 for the current personal token expires the session',async()=>{
  const platform=await import('./platform');platform.configureAccountServer('','one');platform.setWebToken('gateway');
  const dispatch=vi.spyOn(window,'dispatchEvent');
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'Nicht angemeldet'},{status:401})));
  const {invoke}=await import('./backend');
  await expect(invoke('scan_status')).rejects.toThrow('Nicht angemeldet');expect(dispatch).not.toHaveBeenCalled();
  platform.setAccountToken('personal');
  await expect(invoke('scan_status')).rejects.toThrow('Nicht angemeldet');
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({type:'ghgflix:account-required'}));
});

it.each(['account','server'])('ignores an old 401 after changing %s',async(change)=>{
  const platform=await import('./platform');platform.configureAccountServer('http://first.test','one');platform.setAccountToken('old');
  const dispatch=vi.spyOn(window,'dispatchEvent');let finish!:(r:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
  const {invoke}=await import('./backend');const pending=expect(invoke('scan_status')).rejects.toThrow('Nicht angemeldet');
  if(change==='server')platform.configureAccountServer('http://second.test','two');
  platform.setAccountToken(change==='server'?'old':'new');
  finish(Response.json({error:'Nicht angemeldet'},{status:401}));await pending;expect(dispatch).not.toHaveBeenCalled();
});

it('keeps gateway and credential errors local, while detecting a truly expired account request',async()=>{
  const platform=await import('./platform');platform.configureAccountServer('','one');platform.setWebToken('gateway');platform.setAccountToken('personal');
  const dispatch=vi.spyOn(window,'dispatchEvent');
  const fetcher=vi.fn(async()=>Response.json({error:'Anmeldung erforderlich',code:'account_required'},{status:401}));vi.stubGlobal('fetch',fetcher);
  const {accountRequest}=await import('./accounts');
  await expect(accountRequest('/api/accounts/status',undefined,'GET',true)).rejects.toThrow();expect(dispatch).not.toHaveBeenCalled();
  await expect(accountRequest('/api/accounts/login',{email:'x',password:'wrong'})).rejects.toThrow();expect(dispatch).not.toHaveBeenCalled();
  await expect(accountRequest('/api/accounts/me')).rejects.toThrow();
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({type:'ghgflix:account-required'}));
});
