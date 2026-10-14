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

test('the prepared cutout is the input, the stage is named, and the mesh is saved',async()=>{
  const {s,calls,states}=service();
  const saved=await s.run(input);
  assert.equal(calls[0].image.source,input.preparation.prepared.source,'the alpha cutout, not the original photo');
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
  await assert.rejects(service().s.run({...input,preparation:null}),/Prepare the image/);
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
