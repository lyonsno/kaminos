import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createFluidBenchScene} from '../finger-fluid-bench-viewport.mjs';
import {sampleFingerFluidPlaygroundHeight} from '../finger-fluid-webgpu-core.js';

test('shared river presentation samples the solver river support and retains the optical block',()=>{
 const scene=new THREE.Scene(),fixture=createFluidBenchScene({scene,truthScene:'river_playground'});
 try {
  const positions=fixture.group.children[0].geometry.attributes.position;
  let riverDifferences=0;
  for(let i=0;i<positions.count;i++) {
   const x=positions.getX(i),z=positions.getZ(i);
   const expected=sampleFingerFluidPlaygroundHeight(x,z,true);
   assert.ok(Math.abs(positions.getY(i)-expected)<1e-6,`river support differs at ${x},${z}`);
   riverDifferences+=Number(Math.abs(expected-sampleFingerFluidPlaygroundHeight(x,z))>1e-3);
  }
  assert.ok(riverDifferences>100,'channel is visibly represented');
  assert.ok(fixture.group.children.some(o=>o.name==='Fluid bench optical block'),'optical block remains in the river fixture');
 } finally {fixture.dispose();}
});

test('ordinary playground still uses its original support and block',()=>{
 const scene=new THREE.Scene(),fixture=createFluidBenchScene({scene,truthScene:'multi_regime_playground'});
 try {
  const p=fixture.group.children[0].geometry.attributes.position;
  for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getY(i)-sampleFingerFluidPlaygroundHeight(p.getX(i),p.getZ(i)))<1e-6);
  assert.ok(fixture.group.children.some(o=>o.name==='Fluid bench optical block'));
 }finally{fixture.dispose();}
});
