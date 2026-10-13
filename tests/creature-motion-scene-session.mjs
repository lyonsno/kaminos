// Cross-owner module composition over deterministic Three objects. The caller
// names the actual shared session module; this does not replace native host use.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as THREE from '../lib/three.core.js';
import definition from '../experiments/creature-motion/retained.experiment.mjs';
if(!process.argv[2])throw Error('Pass the actual owner-scene-session.mjs path');
const {createOwnerSceneSession}=await import(pathToFileURL(resolve(process.argv[2])));
const scene=new THREE.Scene(),unrelated=new THREE.Group();scene.add(unrelated);
const callbacks=new Set(),records=[],roots=[];
let view={position:[1,2,3],target:[0,0,0]},counter=0;
const source={frames:31,fps:30,source_sha256:'a'.repeat(64),retargeted:false};
const host={scene:{open:async()=>createOwnerSceneSession({
 async loadAsset(asset){
  const root=new THREE.Group(),bone=new THREE.Object3D();bone.name='pelvis';root.add(bone);scene.add(root);roots.push(root);
  root.userData.native_motion=structuredClone(source);
  const clip=new THREE.AnimationClip('source clip',1,[new THREE.VectorKeyframeTrack('pelvis.position',[0,.5,1],[0,0,0,0,0,.3,0,0,.6])]);
  return {id:`body-${++counter}`,root,clips:[clip],source:asset,owned:true};
 },attach:()=>{throw Error('This consumer loads its owned asset');},remove:({root})=>scene.remove(root),
 readView:()=>view,setView:next=>(view=next),redraw:()=>{},
 onFrame:callback=>(callbacks.add(callback),()=>callbacks.delete(callback)),
})}};
const inputs={asset:'/retained/body.glb',source_sha256:source.source_sha256};
const experiment=await definition.create({host,inputs,record:r=>records.push(r)});
experiment.operations.resume();
for(const deltaSeconds of [0,.25,.25])for(const callback of [...callbacks])callback({deltaSeconds});
assert.equal(experiment.read().frame,15);assert.ok(Math.abs(roots[0].children[0].position.z-.3)<1e-6);
const held=experiment.operations.hold();assert.equal(callbacks.size,0);assert.equal(held.inputs.frame,15);
const staleCallbacks=[...callbacks];await experiment.dispose();for(const callback of staleCallbacks)callback({deltaSeconds:1});
assert.equal(roots[0].parent,null);assert.equal(unrelated.parent,scene);
await assert.rejects(()=>definition.create({host,inputs:{...inputs,source_sha256:'b'.repeat(64)}}),/source.*identity/);
assert.equal(roots[1].parent,null,'failed source admission must release the real session-owned registration');
const reopened=await definition.create({host,inputs:held.inputs});assert.equal(reopened.read().frame,15);
reopened.operations.resume();assert.equal(callbacks.size,1);const stale=[...callbacks];await reopened.dispose();
for(const callback of stale)callback({deltaSeconds:1});assert.equal(callbacks.size,0);assert.equal(roots[2].parent,null);
assert.equal(unrelated.parent,scene);assert.ok(records.some(r=>r.kind==='creature.hold'&&r.phase==='applied'));
console.log('Actual owner-session module + creature definition: shared frame/custody/hold/reopen composition passes; native viewport/capture not exercised');

// Review fail-first controls use the actual helper, not a stand-in disposal.
const failures=[];
for(const kind of ['delayed-remove','failed-remove','redraw-throw','create-throw']){
 let release,throwRedraw=false,removed=0;
 const gate=new Promise(resolve=>{release=resolve;});
 const root=new THREE.Group(),bone=new THREE.Object3D();bone.name='pelvis';root.add(bone);scene.add(root);
 root.userData.native_motion=structuredClone(source);
 const clip=new THREE.AnimationClip('cleanup fixture',1,[new THREE.VectorKeyframeTrack('pelvis.position',[0,1],[0,0,0,0,0,.6])]);
 const session=createOwnerSceneSession({
  loadAsset:async()=>({id:`cleanup-${kind}`,root,clips:[clip],owned:true}),attach:()=>{},
  async remove(){if(kind==='delayed-remove'||kind==='failed-remove')await gate;scene.remove(root);removed++;if(kind==='failed-remove')throw Error('owned removal failed');},
  redraw(){if(throwRedraw)throw Error('host redraw failed');},
  readView:()=>view,setView(){throwRedraw=true;throw Error('view rejected');},
  onFrame:callback=>(callbacks.add(callback),()=>callbacks.delete(callback)),
 });
 const fixtureHost={scene:{open:()=>session}};
 try{
  if(kind==='create-throw'){
   let error;try{await definition.create({host:fixtureHost,inputs:{...inputs,view}});}catch(e){error=e;}
   assert.ok(error,'failed creation is reported');
   const errors=error instanceof AggregateError?error.errors:[error];
   assert.ok(errors.some(e=>e.message==='view rejected'),'the original creation error survives cleanup failure');
   assert.ok(errors.some(e=>e.message==='host redraw failed'),'cleanup notification error remains observable');
   assert.equal(root.parent,null,'failed create still removes its owned registration');
  }else{
   const owner=await definition.create({host:fixtureHost,inputs});
   if(kind==='redraw-throw')throwRedraw=true;
   const first=owner.dispose(),second=owner.dispose();
   let secondSettled=false;const outcome=second.then(()=>{secondSettled=true;return null;},error=>{secondSettled=true;return error;});
   const firstOutcome=first.then(()=>null,error=>error);
   if(kind!=='redraw-throw'){
    await Promise.resolve();await Promise.resolve();
    assert.equal(secondSettled,false,'repeated close must await the same pending owned removal');
    assert.equal(root.parent,scene);release();
   }
   const [a,b]=await Promise.all([firstOutcome,outcome]);
   if(kind==='delayed-remove'){assert.equal(a,null);assert.equal(b,null);}
   else{assert.ok(a);assert.equal(b,a,'all callers receive the same cleanup rejection');}
   assert.equal(root.parent,null,'host/controller errors must not skip owned session cleanup');assert.equal(removed,1);
  }
 }catch(error){failures.push(`${kind}: ${error.message}`);}
 finally{release();try{await session.dispose();}catch{} }
}
assert.deepEqual(failures,[],'owner disposal and failed creation preserve completion, failures and owned cleanup');
