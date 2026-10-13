import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import {createOwnedBrowserReveal} from '../tools/owned-browser-reveal.mjs';

test('owner reveal preserves its page, refuses substitutions and requires native foreground',async()=>{
  let frontCalls=0,foreground=true,closed=false,starts=['owner-start','browser-start'];
  const binding={request_id:randomUUID(),request_digest:'digest',job_id:'job',url:'http://127.0.0.1:1234/scene'};
  const page={isClosed:()=>closed,url:()=>binding.url,bringToFront:async()=>{frontCalls++;},
    context:()=>({newCDPSession:async()=>({send:async()=>({targetInfo:{targetId:'retained-page',url:binding.url}}),detach:async()=>{}})})};
  const service=await createOwnedBrowserReveal({page,browser:{isConnected:()=>true},browserPid:process.pid,binding,
    readStarts:async()=>starts,nativeForeground:async(pid,reveal)=>({pid,foreground:reveal&&foreground})});
  const command=action=>({schema:'gpu-greenroom.application-reveal-request.v1',action,call_id:randomUUID(),...binding,reveal:service.identity});
  try{
    const mode=(await fs.lstat(service.identity.socket_path)).mode&0o777;assert.equal(mode,0o600);
    const inspect=await service.handle(command('inspect'));assert.equal(inspect.error,undefined);assert.equal(frontCalls,0);
    for(const key of ['request_id','request_digest','job_id','url']){
      const failed=await service.handle({...command('reveal'),[key]:'different'});assert.match(failed.error,/changed/);assert.equal(failed.foreground,undefined);
    }
    assert.equal(frontCalls,0);
    for(let i=0;i<2;i++){const result=await service.handle(command('reveal'));assert.equal(result.foreground,true);}
    assert.equal(frontCalls,2);
    foreground=false;const failed=await service.handle(command('reveal'));assert.match(failed.error,/foreground not observed/);assert.equal(failed.foreground,undefined);
    starts=['owner-start','replaced-browser'];assert.match((await service.handle(command('reveal'))).error,/expired or changed/);
    closed=true;assert.match((await service.handle(command('reveal'))).error,/session ended/);
    const malformed=await new Promise((resolve,reject)=>{
      const socket=net.connect(service.identity.socket_path);let text='';socket.on('error',reject);socket.on('connect',()=>socket.write('{bad\n'));
      socket.on('data',value=>text+=value);socket.on('end',()=>resolve(JSON.parse(text)));
    });assert.match(malformed.error,/Invalid reveal JSON/);
  }finally{await service.dispose();}
  await assert.rejects(fs.lstat(service.identity.socket_path),{code:'ENOENT'});
});
