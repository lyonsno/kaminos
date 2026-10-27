// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {opticalSteppingConfig, resolveOpticalStepping,validateOpticalPreviewArm} from '../volume-optical-native.mjs';
import {allocateRayStrata,historyAllocationGeometry,createRayAllocationHistory} from '../volume-history-allocation.mjs';

test('fixed-count allocations are available on the joined emissive route',()=>{
  for(const mode of ['budgeted','joins','history']){
    const requested=opticalSteppingConfig({mode});
    const actual=resolveOpticalStepping(requested,{emissive:true,exterior:true,explicit:true});
    assert.equal(actual.mode,mode);
    assert.equal(actual.reason,null);
    assert.equal(actual.floor,'one fresh material evaluation per allocated stratum');
  }
});

test('allocation partitions the full ray at each small production count',()=>{
  for(const count of [1,2,3,4,5,8,32,192])for(const phase of [.05,.5,.95]){
    const segments=[{start:7,end:8,weight:1},{start:8,end:8.1,weight:100},{start:8.1,end:10,weight:1}];
    const bins=allocateRayStrata(segments,count,phase);
    assert.equal(bins.length,count);assert.equal(bins[0].start,7);assert.equal(bins.at(-1).end,10);
    for(let i=0;i<count;i++){
      const b=bins[i];assert.ok(b.width>0);assert.ok(b.sample>b.start&&b.sample<b.end);
      if(i)assert.equal(b.start,bins[i-1].end);
    }
    assert.ok(Math.abs(bins.reduce((a,b)=>a+b.width,0)-3)<1e-12);
    // A homogeneous medium has the same optical thickness at every allocation.
    const transmission=bins.reduce((a,b)=>a*Math.exp(-2*b.width),1);
    assert.ok(Math.abs(transmission-Math.exp(-6))<1e-12);
  }
});
test('positive uniform coverage survives strong history and joins receive actual samples',()=>{
  const s=[{start:0,end:.45,weight:1},{start:.45,end:.55,weight:50},{start:.55,end:1,weight:1}];
  const weighted=allocateRayStrata(s,3),uniform=allocateRayStrata(s.map(x=>({...x,weight:1})),3);
  assert.equal(weighted.filter(b=>b.sample>.45&&b.sample<.55).length,3);
  assert.equal(uniform.filter(b=>b.sample>.45&&b.sample<.55).length,1);
  assert.equal(weighted[0].start,0);assert.equal(weighted.at(-1).end,1);
  for(const invalid of [[],[{start:0,end:1,weight:0}],[{start:0,end:1,weight:1},{start:2,end:3,weight:1}]])assert.throws(()=>allocateRayStrata(invalid,2));
});
test('guidance uses dispatched cubic geometry and refuses invalid addressing',()=>{
  assert.equal(historyAllocationGeometry({min:[-4,-1,-4],max:[4,15,4],dims:[32,64,32]}).cells,65536);
  assert.throws(()=>historyAllocationGeometry({min:[0,0,0],max:[1,2,1],dims:[32,32,32]}),/cubic/);
  assert.throws(()=>historyAllocationGeometry({min:[0,0,0],max:[1,1,1],dims:[65536,65536,65536]}),/u32/);
});
test('draw history is isolated, reset on edits and rewind, and constrained by actual device limits',()=>{
  globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8};
  let id=0;const clears=[];
  const device={limits:{maxBufferSize:4096,maxStorageBufferBindingSize:4096},
    createBuffer:d=>({...d,id:++id,destroy(){this.destroyed=true;}}),queue:{writeBuffer(){}}};
  const h=createRayAllocationHistory(device),encoder={clearBuffer:b=>clears.push(b.id)};
  const box={min:[-1,-1,-1],max:[1,3,1],dims:[4,8,4]};
  assert.equal(h.prepare(encoder,box,'scene1',10).historyFrames,0);
  const first=h.read().observationsOffset;assert.notEqual(first,h.read().previousOffset);
  assert.equal(h.prepare(encoder,box,'scene1',11).historyFrames,1);
  assert.equal(first,h.read().previousOffset);assert.notEqual(first,h.read().observationsOffset);
  assert.equal(h.prepare(encoder,box,'scene2',11).historyFrames,0);
  assert.equal(h.prepare(encoder,box,'scene2',5).resetReason,'simulation-rewind');
  assert.equal(h.read().historyFrames,0);
  assert.throws(()=>h.prepare(encoder,{...box,dims:[32,64,32]},'large',6),/device storage/);
  h.reset();assert.equal(h.prepare(encoder,box,'scene2',6).historyFrames,0);h.dispose();
});
test('fixed-count history refuses trace/non-emissive substitution',()=>{
  const requested=opticalSteppingConfig({mode:'history'});
  for(const route of [{emissive:false},{emissive:true,trace:true}]){
    assert.throws(()=>resolveOpticalStepping(requested,{...route,explicit:true}),/requires/);
    assert.equal(resolveOpticalStepping(requested,route).mode,'current');
  }
});

test('history witness rejects missing guidance and a substituted exterior route',()=>{
  const sample={ok:true,image:{width:1,height:1,rgba:[1,2,3,255]}};
  const state={backend:'WebGPU:apple',simStepCount:8,controls:{raySteps:3},
    opticalStepping:{effective:'history',tolerance:.001},raymarchShaderSpecialization:{effective:'lean-emissive-raymarch-v0'},physicalColor:{effective:'emissive-transport-v2'}};
  assert.throws(()=>validateOpticalPreviewArm(sample,state,{mode:'history',tolerance:.001,step:8,raySteps:3}),/guidance/);
});
