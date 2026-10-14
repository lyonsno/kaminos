// kaminos-test: node — the page's appGpuHost factory (index.html) hands every caller the one host
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createAppGpuHost} from '../app-gpu-host.mjs';
import * as kit from '../webgpu-inference-kit/src/core.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const a=html.indexOf('  // Reserved before the first await');const b=html.indexOf('  window.kaminosAppGpu=appGpuHost;',a);
assert.ok(a>0&&b>a,'the page factory must be present');
const source=html.slice(a,b).replace("await import('./webgpu-inference-kit/src/core.js')",'await kitModule()');
function page({failFirst=false}={}){
  let imports=0;
  const device={queue:{submit(){},async onSubmittedWorkDone(){}}};
  const owner={setForegroundOpportunityRequester(){},foregroundGpuContext:()=>({renderer:'kaminos-app',device,queue:device.queue})};
  const installed=new Map();
  const handoff={has:id=>installed.has(id),install:(id,r)=>installed.set(id,r),async activate(){}};
  const context={sharedGpu:{device,adapter:{info:{description:'fixture'}}},compositionHost:{device,setForegroundServiceActive(){},runForegroundFrame:run=>run()},
    createAppGpuHost,frameOwner:()=>owner,foregroundHandoff:()=>handoff,Error,Promise,
    kitModule:async()=>{imports++;await new Promise(r=>setTimeout(r,5));if(failFirst&&imports===1)throw Error('kit import failed');return kit;}};
  vm.runInNewContext(`${source}\nthis.appGpuHost=appGpuHost;`,context);
  return {get:context.appGpuHost,imports:()=>imports};
}

test('two concurrent first acquisitions get the same host, and a second model run is refused while one is active',async()=>{
  const p=page();const [x,y]=await Promise.all([p.get(),p.get()]);
  assert.equal(x,y,'one host for the page');assert.equal(p.imports(),1);
  const run=await x.beginRun('first',{routeId:'a'});
  await assert.rejects(y.beginRun('second',{routeId:'b'}),/already has an active run/);
  await run.finish();
});

test('a failed construction releases the reservation so the next call retries',async()=>{
  const p=page({failFirst:true});
  await assert.rejects(p.get(),/kit import failed/);
  const host=await p.get();assert.ok(host?.beginRun,'the retry builds the host');assert.equal(await p.get(),host);
});
