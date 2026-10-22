// kaminos-test: node — the Generate service for TRELLIS in this page: prepared cutout in, stages, Stop, saved GLB
import test from 'node:test';import assert from 'node:assert/strict';
import {createTrellisPageAuthoringGeneration,trellisPageStage} from '../authoring-trellis-page.mjs';

const glb=new Uint8Array([0x67,0x6c,0x54,0x46,2,0,0,0,12,0,0,0]).buffer;
const input={source:'/api/read?root=image-inbox&path=a.png',name:'a.png',preparation:{status:'complete',original:{sha256:'a'.repeat(64)},prepared:{source:'/api/read?root=image-preparations&path=x/cutout.png'}}};
function service(over={}){
  const calls=[],states=[];
  const s=createTrellisPageAuthoringGeneration({availability:()=>({status:'available'}),changed:st=>states.push(st),
    runPage:async({image,signal,onPhase})=>{calls.push({image,signal});await onPhase({phase:'sparse-structure-sampling'});return {glb,generation:{runId:'r',route:'trellis'},label:'a',timing:{phases:[]}};},
    persist:async(g,gen,label)=>{calls.push({persist:label});return {source:'/api/read?root=generated-meshes&path=x.glb',name:`${label} · TRELLIS.glb`};},...over});
  return {s,calls,states};
}

test('the selected image is the input, the stage is named, and the mesh is saved',async()=>{
  const {s,calls,states}=service();
  const saved=await s.run(input);
  assert.equal(calls[0].image.source,input.source,'the page prepares the selected image itself');
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(calls[1].persist,'a');assert.equal(saved.name,'a · TRELLIS.glb');
  assert.ok(states.some(st=>st.stage==='Shape structure'),'model phases become readable stages');
  assert.equal(s.read().status,'complete');assert.deepEqual(s.read().results.map(r=>r.name),['a · TRELLIS.glb']);
});

test('Stop aborts the run and reports a clean stop',async()=>{
  let release;const {s}=service({runPage:({signal})=>new Promise((_,reject)=>{release=()=>reject(signal.reason);signal.addEventListener('abort',()=>release());})});
  const running=s.run(input);await new Promise(r=>setTimeout(r,0));
  assert.equal(s.read().canStop,true);assert.equal(s.stop(),true);
  assert.equal(await running,null);assert.equal(s.read().status,'stopped');
});

test('a mesh that could not be saved is kept and can be saved again',async()=>{
  let fail=true;const {s}=service({persist:async()=>{if(fail)throw Error('disk full');return {name:'a · TRELLIS.glb'};}});
  await assert.rejects(s.run(input),/disk full/);
  assert.equal(s.read().status,'failed');assert.ok(s.read().pending,'the generated GLB is retained');
  fail=false;const saved=await s.retryPersistence();assert.equal(saved.name,'a · TRELLIS.glb');assert.equal(s.read().pending,null);
});

test('without a prepared image, or while unavailable or blocked, nothing runs',async()=>{
  await assert.rejects(service().s.run({...input,source:null}),/Choose a source image/);
  const u=service({availability:()=>({status:'unavailable',message:'No TRELLIS checkpoint package on this server'})});
  assert.equal(u.s.read().status,'unavailable');assert.match(u.s.read().error,/checkpoint package/);
  const b=service({blocked:()=>'Stable Fast 3D is generating.'});
  await assert.rejects(b.s.run(input),/Stable Fast 3D/);assert.equal(b.calls.length,0);
});

test('model phases map to a few plain stages',()=>{
  assert.equal(trellisPageStage('dinov3-block3-mlp-up-resident'),'Reading the image');
  assert.equal(trellisPageStage('low-resolution-shape-sampling'),'Shape detail');
  assert.equal(trellisPageStage('shape-conditioned-texture-sampling'),'Texture');
  assert.equal(trellisPageStage('post-model-uv-unwrap'),'Unwrapping UVs');
  assert.equal(trellisPageStage('something-new'),'Generating');
});

test('a release failure while stopping is reported as a failure, not a clean stop',async()=>{
  const {s}=service({runPage:({signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('TRELLIS GPU route was not released: held (queue settlement failed)'))))});
  const running=s.run(input);await new Promise(r=>setTimeout(r,0));s.stop();
  await assert.rejects(running,/not released/);
  assert.equal(s.read().status,'failed');assert.match(s.read().error,/not released/);
});

test('page TRELLIS is reserved from its first step to its end (index.html wrapper)',async()=>{
  const fs=await import('node:fs'),vm=await import('node:vm');
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const a=html.indexOf('  const trellisPageRun=async options=>{'),b=html.indexOf('  // Witness hook',a);
  assert.ok(a>0&&b>a,'the reserving wrapper exists');
  let release,fail=false;const meshRunning={sf3d:false,trellis:false,trellisPage:false},events=[];
  const lease=await import('../greenroom-lease.mjs');
  const ctx={meshRunning,meshBusy:m=>meshRunning[m],redraw(){},authoringImageGenerator:{busy:()=>false},Error,JSON,URLSearchParams,setInfo(){},
    location:{search:''},crypto:{randomUUID:()=>'run-1'},addEventListener(){},navigator:{},Blob,setTimeout,clearTimeout,
    loadModule:async()=>lease,unsettled:[],appGpuHost:async()=>({unsettledRuns:()=>ctx.unsettled}),
    // The server's Greenroom lease: held for the run, released after it.
    fetch:async(_,{body})=>{const b=JSON.parse(body);events.push(b.action);return {ok:true,json:async()=>b.action==='claim'?{status:'held',leaseId:'kaminos-page-run-1',ttlSeconds:120}:{status:'released'}};},
    trellisPageRunInner:()=>{events.push('run');return new Promise((res,rej)=>{release=()=>fail?rej(Error('boom')):res({generation:{runId:'r'}});});}};
  vm.runInNewContext(html.slice(a,b)+'\nthis.run=trellisPageRun;',ctx);
  const first=ctx.run({});assert.equal(meshRunning.trellisPage,true,'reserved before any await');
  await assert.rejects(ctx.run({}),/Another model/);
  while(!release)await new Promise(r=>setTimeout(r,0));
  release();const done=await first;assert.equal(meshRunning.trellisPage,false);
  assert.deepEqual(events,['claim','run','release'],'the run happens inside a held Greenroom lease');
  assert.deepEqual(JSON.parse(JSON.stringify(done.generation.gpuLease)),{status:'held',leaseId:'kaminos-page-run-1'},'the generation records its lease');
  fail=true;release=null;events.length=0;const second=ctx.run({});while(!release)await new Promise(r=>setTimeout(r,0));
  release();await assert.rejects(second,/boom/);assert.equal(meshRunning.trellisPage,false,'released on failure too');
  assert.deepEqual(events,['claim','run','release'],'and the lease is released on failure');
  // A model run the app GPU host still counts unsettled keeps Greenroom blocked, whatever the error looks like.
  fail=true;release=null;events.length=0;ctx.unsettled=['trellis-frame-run'];const held=ctx.run({});while(!release)await new Promise(r=>setTimeout(r,0));
  release();await assert.rejects(held,/boom/);assert.deepEqual(events,['claim','run'],'no release while the host has an unsettled run');ctx.unsettled=[];
  // A server with no Greenroom: the run goes ahead unleased, and says so when it starts, not afterwards.
  const infos=[];ctx.setInfo=m=>infos.push(m);fail=false;release=null;events.length=0;
  ctx.fetch=async(_,{body})=>{const b=JSON.parse(body);events.push(b.action);return {ok:true,json:async()=>({status:'unconfigured'})};};
  const third=ctx.run({});while(!release)await new Promise(r=>setTimeout(r,0));
  assert.ok(infos.some(m=>/without a Greenroom lease/.test(m)),'announced before the run finishes');
  release();assert.equal((await third).generation.gpuLease.status,'unconfigured');assert.deepEqual(events,['claim','run']);
});

test('the service prepares its own input and shows the cutout it used',async()=>{
  const {s}=service({runPage:async({onInput})=>{await onInput({kind:'cutout',source:'/api/read?root=image-inbox&path=a-cutout.png'});return {glb,generation:{runId:'r'},label:'a'};}});
  assert.equal(s.preparesInput,true);
  await s.run(input);assert.deepEqual(s.read().inputPreview,{kind:'cutout',source:'/api/read?root=image-inbox&path=a-cutout.png',input:input.source},'the preview carries the image it came from');
});

test('the operation stays busy through saving and while a mesh waits to be saved again',async()=>{
  let release;const {s}=service({persist:()=>new Promise((_,reject)=>{release=()=>reject(Error('disk full'));})});
  const running=s.run(input);await new Promise(r=>setTimeout(r,0));
  assert.equal(s.busy(),true,'saving is still the operation');release();await assert.rejects(running,/disk full/);
  assert.equal(s.busy(),true,'a retained mesh keeps the choice bound to this service');
});

test('after a successful save retry the operation is released and the drawer is told (picker unlocks)',async()=>{
  let fail=true;const seen=[];let s;
  s=createTrellisPageAuthoringGeneration({availability:()=>({status:'available'}),changed:()=>seen.push(s?.busy()),
    runPage:async()=>({glb,generation:{runId:'r'},label:'a'}),persist:async()=>{if(fail)throw Error('disk full');return {name:'a · TRELLIS.glb'};}});
  await assert.rejects(s.run(input),/disk full/);fail=false;await s.retryPersistence();
  assert.equal(seen.at(-1),false,'the last notification sees the operation released');
});

test('the used-input description says what the page actually used, including a cutout it could not save',async()=>{
  const {describeTrellisInput}=await import('../authoring-trellis-page.mjs');
  const ok=await describeTrellisInput({image:{source:'/a.png'},cutout:{rgba:new Uint8Array(4),width:1,height:1},label:'a',
    encode:async()=>new ArrayBuffer(8),fetch:async()=>({ok:true,json:async()=>({entry:{source:'/a-cutout.png'}})})});
  assert.deepEqual(ok,{kind:'cutout',source:'/a-cutout.png'});
  const http=await describeTrellisInput({image:{source:'/a.png'},cutout:{rgba:new Uint8Array(4),width:1,height:1},label:'a',
    encode:async()=>new ArrayBuffer(8),fetch:async()=>({ok:false,status:500,json:async()=>({error:'disk full'})})});
  assert.equal(http.kind,'cutout-unsaved');assert.equal(http.source,null);assert.match(http.error,/disk full|500/);
  const thrown=await describeTrellisInput({image:{source:'/a.png'},cutout:{rgba:new Uint8Array(4),width:1,height:1},label:'a',
    encode:async()=>{throw Error('encode failed');},fetch:async()=>{throw Error('unreached');}});
  assert.deepEqual({kind:thrown.kind,source:thrown.source,error:thrown.error},{kind:'cutout-unsaved',source:null,error:'encode failed'});
  assert.deepEqual(await describeTrellisInput({image:{source:'/alpha.png'},cutout:null,label:'a'}),{kind:'original-alpha',source:'/alpha.png'});
});

test('the run surfel asset travels with the mesh to persistence',async()=>{
  const surfelGlb=new ArrayBuffer(16);let got;
  const {s}=service({runPage:async()=>({glb,generation:{runId:'r'},label:'a',surfelGlb,surfels:{status:'built',count:7}}),
    persist:async(g,gen,label,extra)=>{got=extra;return {name:'a · TRELLIS.glb'};}});
  await s.run(input);
  assert.equal(got?.surfelGlb,surfelGlb);assert.deepEqual(got?.surfels,{status:'built',count:7});
});

// A run whose decode succeeded and whose mesh finishing failed, carrying the surfels built before cleanup.
const finishingFailure=(message='UV unwrap failed')=>Object.assign(Error(message),{trellisSurfelsRun:{surfelGlb:new ArrayBuffer(16),surfels:{status:'built',count:7},
  label:'a',generation:{schema:'kaminos.asset-generation.v1',runId:'r',route:'trellis',input:{sha256:'b'.repeat(64)},meshFinishing:{status:'failed',error:message}}}});

test('a mesh-finishing failure still saves the surfels built from the decoded field, and the failure stays visible',async()=>{
  let saved;let runs=0;
  const {s}=service({runPage:async()=>{runs++;throw finishingFailure();},persist:async(g,gen,label,extra)=>{saved={g,gen,label,extra};return {name:'a · TRELLIS surfels.glb'};}});
  await assert.rejects(s.run(input),/UV unwrap failed/);
  assert.equal(saved.g,null,'no mesh');assert.equal(saved.extra.surfels.count,7);assert.equal(saved.gen.input.source,input.source);
  assert.equal(saved.gen.meshFinishing.status,'failed');
  const view=s.read();assert.equal(view.status,'failed');assert.match(view.error,/UV unwrap failed/);assert.match(view.error,/surfels saved/);
  assert.equal(view.results.length,1);assert.equal(runs,1);
});

test('if saving those surfels fails, they are retained and a retry saves them without running TRELLIS again',async()=>{
  let fail=true,runs=0;
  const {s}=service({runPage:async()=>{runs++;throw finishingFailure();},persist:async()=>{if(fail)throw Error('disk full');return {name:'a · TRELLIS surfels.glb'};}});
  await assert.rejects(s.run(input),/UV unwrap failed/);
  assert.equal(s.busy(),true,'the surfels wait to be saved');fail=false;
  const saved=await s.retryPersistence();assert.equal(saved.name,'a · TRELLIS surfels.glb');assert.equal(runs,1);
});

test('a stopped run saves nothing, even with surfels attached',async()=>{
  let persisted=0;
  const {s}=service({runPage:async({signal})=>{await new Promise(r=>setTimeout(r,5));throw Object.assign(signal.reason??new DOMException('stopped','AbortError'),{trellisSurfelsRun:finishingFailure().trellisSurfelsRun});},
    persist:async()=>{persisted++;return {};}});
  const running=s.run(input);s.stop();assert.equal(await running,null);assert.equal(persisted,0);
});
