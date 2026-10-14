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
  let release,fail=false;const meshRunning={sf3d:false,trellis:false,trellisPage:false};
  const ctx={meshRunning,meshBusy:m=>meshRunning[m],redraw(){},authoringImageGenerator:{busy:()=>false},Error,
    trellisPageRunInner:()=>new Promise((res,rej)=>{release=()=>fail?rej(Error('boom')):res('done');})};
  vm.runInNewContext(html.slice(a,b)+'\nthis.run=trellisPageRun;',ctx);
  const first=ctx.run({});assert.equal(meshRunning.trellisPage,true,'reserved before any await');
  await assert.rejects(ctx.run({}),/Another model/);
  release();assert.equal(await first,'done');assert.equal(meshRunning.trellisPage,false);
  fail=true;const second=ctx.run({});release();await assert.rejects(second,/boom/);assert.equal(meshRunning.trellisPage,false,'released on failure too');
});
