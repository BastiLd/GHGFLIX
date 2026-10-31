import {afterEach,expect,it,vi} from 'vitest';
import {normalizeServerAddress,openServerConnection} from './serverConnection';
afterEach(()=>vi.unstubAllGlobals());
it('normalizes a server and rejects credentials or fragments before any request',async()=>{
  expect(normalizeServerAddress(' http://server:8484/ ')).toBe('http://server:8484');
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  for(const url of ['file:///C:/private','http://user:password@server','https://server/#/profiles','https://server/?token=secret'])await expect(openServerConnection(url,'secret')).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('does not send a password to a site that is not a GHGFlix server',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({app:'different-service'}));vi.stubGlobal('fetch',fetcher);
  await expect(openServerConnection('http://fixture.test','secret')).rejects.toThrow('kein erreichbarer GHGFlix-Server');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('accepts the gateway password on old servers and reports the required server update',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({app:'ghgflix-server',version:'2.8.0',auth:true}))
    .mockResolvedValueOnce(Response.json({token:'gateway-token'}));vi.stubGlobal('fetch',fetcher);
  await expect(openServerConnection('http://fixture.test','gateway-secret')).rejects.toThrow('Server-Passwort angenommen.');
  expect(fetcher).toHaveBeenLastCalledWith('http://fixture.test/api/login',expect.objectContaining({body:JSON.stringify({password:'gateway-secret'})}));
});
it('rejects wrong passwords and returns only the gateway token on current servers',async()=>{
  const ping={app:'ghgflix-server',version:'3.6.1',id:'fixture',auth:true,accounts:true};
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json(ping)).mockResolvedValueOnce(Response.json({error:'Passwort falsch'},{status:401}));vi.stubGlobal('fetch',fetcher);
  await expect(openServerConnection('http://fixture.test','wrong')).rejects.toThrow('Passwort falsch');
  fetcher.mockResolvedValueOnce(Response.json(ping)).mockResolvedValueOnce(Response.json({token:'token'}));
  const connected=await openServerConnection('http://fixture.test','secret');
  expect(connected).toEqual({base:'http://fixture.test',token:'token',id:'fixture',version:'3.6.1'});
  expect(JSON.stringify(connected)).not.toContain('secret');
});
it('open servers do not require a password or create an extra gateway session',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({app:'ghgflix-server',accounts:true,id:'open',auth:false}));vi.stubGlobal('fetch',fetcher);
  expect((await openServerConnection('http://fixture.test','')).token).toBe('');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
