// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {residentBeamPlan,residentBeamRefresh} from '../particle-resident-beam.mjs';

test('rotating acquisition sends one centered ray to both histories and revisits all nine slots',()=>{
 const p=residentBeamPlan({width:9,sections:12,stride:3});
 assert.equal(p.retainedRays,9);assert.equal(p.sections,12);assert.equal(p.sampleCount,108);
 assert.equal(p.receiverRays,81);assert.equal(p.points,972);
 assert.deepEqual(Array.from({length:10},(_,i)=>residentBeamRefresh(p,i)),[
  {slot:0,x:1,y:1},{slot:1,x:4,y:1},{slot:2,x:7,y:1},
  {slot:3,x:1,y:4},{slot:4,x:4,y:4},{slot:5,x:7,y:4},
  {slot:6,x:1,y:7},{slot:7,x:4,y:7},{slot:8,x:7,y:7},{slot:0,x:1,y:1}]);
 assert.throws(()=>residentBeamPlan({width:8,sections:12,stride:3}),/divisible/);
 assert.throws(()=>residentBeamRefresh(p,-1),/schedule/);
});

import {createParticleLightSliceView} from '../volume-particle-light-slice-view.mjs';
test('native renderer borrows exactly one same-step resident output without assuming resource ownership',()=>{
 const previous=globalThis.GPUBufferUsage;
 globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8};
 const retired=[],writes=[],device={limits:{maxBufferSize:1024,maxStorageBufferBindingSize:1024},createBuffer:o=>o,queue:{writeBuffer:(...a)=>writes.push(a)}};
 const view=createParticleLightSliceView(device,buffers=>retired.push(...buffers));
 const axis=Float32Array.from([0,0,0,1,0,0,1,2,1,0,0,2,0,1,0,2]);
 const buffer={size:128,usage:128},identity={epoch:2,step:7,materialStamp:"native"};
 try{
  view.set({axis,buffer,identity,device});
  assert.equal(view.entries(2,7,"native")[0].resource.buffer,buffer);
  assert.deepEqual(view.entries(2,8,"native"),[]);
  assert.deepEqual(view.entries(2,7,"edited"),[]);
  assert.deepEqual(view.entries(3,7),[]);
  assert.throws(()=>view.set({axis,buffer,identity,device:{}}),/resident beam/);
  view.set({axis,values:new Float32Array(32).fill(1),identity});
  assert.notEqual(view.entries(2,8)[0].resource.buffer,buffer,'CPU-authored held view keeps existing behavior');
  assert.equal(writes.length,3);
  view.dispose();
  assert.ok(!retired.includes(buffer));
 }finally{globalThis.GPUBufferUsage=previous;}
});
