// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../tools/disintegrating-log-witness.mjs',import.meta.url),'utf8');
const start=source.indexOf('  for(const [name,position,scale,reason]');
const end=source.indexOf('  await page.evaluate(async blocker=>',start);
assert.ok(start>0&&end>start);
const body=source.slice(start,end);

async function exercise({changeRevision=false,badSample=false}={}){
 const report={collisionNegatives:[]},saved=[],label={textContent:''};
 let revision=0,samples=0,delayed=0;
 let runtime={geometryRevision:revision};
 const window={
  kaminosSceneCollision:{read:()=>({runtime})},
  kaminosSetSceneObjectTransform(){runtime={geometryRevision:++revision,validation:'gpu-resident-unread'};if(revision===1)label.textContent='Submitted · GPU solid field unverified';},
  __kaminosVolumePrototype:{debugState:()=>({sceneCollision:runtime,followingDomain:{translation:[0,0,0]}}),
   async sampleSceneCollisionMask(){
    const reason=samples++===0?'authored-solid-does-not-intersect-volume':'authored-solid-occludes-emitter-source-support';
    runtime={geometryRevision:revision,reason:badSample?'wrong-reason':reason,effective:'off'};
    return {valid:false,cells:new Uint8Array(1),runtime};
   }},
 };
 const page={evaluate:async(fn,arg)=>fn(arg),async waitForFunction(predicate,arg){
  if(predicate(arg))return;
  delayed++;label.textContent='Unavailable · '+runtime.reason;
  if(changeRevision)runtime={...runtime,geometryRevision:++revision};
  assert.ok(predicate(arg),'The observer must finish on publication or revision change');
 }};
 const context={page,report,blocker:'test-box',guarded:p=>p,assert,window,document:{getElementById:()=>label},save:async()=>{saved.push(structuredClone(report));}};
 const run=vm.runInNewContext(`(async()=>{${body}})()`,context);
 if(changeRevision){
  await assert.rejects(run,/revision changed/i);
  assert.ok(saved.some(x=>x.collisionNegatives[0]?.ordinary?.runtime.geometryRevision!==x.collisionNegatives[0]?.submitted?.geometryRevision&&x.collisionNegatives[0]?.ordinary),'The changed revision must be retained before rejection');
 }else if(badSample){
  await assert.rejects(run,/wrong-reason/);
  assert.equal(saved.at(-1).collisionNegatives[0].sampled.runtime.reason,'wrong-reason','A failed sample must remain replayable');
 }else{
  await run;assert.equal(delayed,2);assert.equal(report.collisionNegatives.length,2);
  assert.equal(report.collisionNegatives[0].beforeReadoutRefresh.text,'Submitted · GPU solid field unverified');
  assert.ok(report.collisionNegatives.every(x=>x.ordinary.text==='Unavailable · '+x.sampled.runtime.reason),'Each case must observe its own rejection, not the prior label');
 }
}
await exercise();
await exercise({badSample:true});
await exercise({changeRevision:true});
