// kaminos-test: node
import assert from 'node:assert/strict';
import {evaluateCrown} from '../experiments/compound-crown/mechanism.mjs';
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
let first;
assert.doesNotThrow(()=>{first=evaluateCrown({opening:.4,swirl:0});},'an authored compound mechanism must produce a usable pose');
assert.equal(first.vanes.length,12);assert.equal(first.leaves.length,10);
for(let i=0;i<=100;i++){
 const s=i/100,pose=evaluateCrown({opening:s,swirl:2*s-1});
 for(const v of pose.vanes){
  assert.ok(Math.abs(distance(v.pivot,v.crankEnd)-pose.crankLength)<1e-12,'rigid crank length');
  assert.ok(Math.abs(distance(v.crankEnd,v.ringEnd)-pose.rodLength)<1e-12,'closed fixed-length transmission');
  assert.ok(Number.isFinite(v.angle));
 }
 for(const leaf of pose.leaves){
  assert.ok(distance(leaf.follower,leaf.slotAtDrive)<1e-12,'follower stays on authored ring cam throughout its stroke');
  assert.ok(leaf.polygon.flat().every(Number.isFinite));
 }
}
const a=evaluateCrown({opening:0,swirl:.5}),b=evaluateCrown({opening:1,swirl:.5}),c=evaluateCrown({opening:1,swirl:-.5});
assert.deepEqual(a.vanes,b.vanes,'upper and lower controls independent');assert.deepEqual(b.leaves,c.leaves);
assert.equal(a.clearRadius,0);assert.ok(b.clearRadius>.45,'iris actually reveals an opening');
const repeated=evaluateCrown({vaneCount:17,irisCount:13,opening:.5});assert.equal(repeated.vanes.length,17);assert.equal(repeated.leaves.length,13);
for(const p of [{opening:NaN},{swirl:2},{irisCount:2},{vaneCount:1},{rate:Infinity}])assert.throws(()=>evaluateCrown(p));
assert.deepEqual(evaluateCrown(first.recipe),first,'plain recipe reconstructs deterministic body frames');
console.log('Compound Crown: independent drives, rigid crank/rod closure, cam-followers, real aperture, repetition and recipe round trip.');
const {createCrownView}=await import('../experiments/compound-crown/view.mjs');
const {Vector3,Box3}=await import('../lib/three.core.js');
const view=createCrownView({opening:0});const root=view.root;
for(let i=0;i<=20;i++){
 const pose=view.update({opening:i/20,swirl:i/10-1});
 for(const leaf of pose.leaves){
  const node=view.parts.get(leaf.id).getObjectByName('cam-follower'),p=node.getWorldPosition(new Vector3());
  assert.ok(Math.hypot(p.x-leaf.follower[0],p.z-leaf.follower[1])<1e-12,'rendered follower agrees with the mechanism');
 }
 for(const v of pose.vanes){const rod=root.getObjectByName(v.id+'-rod');assert.ok(Math.abs(rod.geometry.parameters.width-pose.rodLength)<1e-12,'renderer never stretches a rod to fake closure');}
 assert.ok(!new Box3().setFromObject(root).isEmpty());
}
view.update({vaneCount:17,irisCount:13});assert.equal(view.root,root,'rebuilding families preserves selectable root identity');assert.ok(view.parts.has('vane-16'));view.dispose();
