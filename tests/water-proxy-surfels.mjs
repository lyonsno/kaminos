// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeInterfaceSurfels,surfelExtrapolationSeconds,createInterfaceSurfelProducer,SURFEL_FLOATS} from '../proxy-snapshot.mjs';
import {localLiquidPresentationPlan} from '../local-liquid-presentation.mjs';
import {checkedViewportDisplay} from '../viewport-display-settings.mjs';

const RECORD_FLOATS=20;
const layout={recordFloats:RECORD_FLOATS,activeCountCounterIndex:0,fields:{positionId:0,velocityConfidence:4,normalCurvature:8,thicknessContactWetnessMaterial:12}};
function records(list,capacity) {
 const data=new Float32Array(capacity*RECORD_FLOATS);
 list.forEach((r,i)=>{const at=i*RECORD_FLOATS;data.set([...r.p,i],at);data.set([...r.v,1],at+4);data.set([...r.n,r.curvature??0],at+8);data.set([r.thickness??0,0,1,r.material??0],at+12);});
 return data;
}

test('interface records decode into a CPU surfel snapshot',()=>{
 const list=[
  {p:[0,1,2],v:[0.1,0,0],n:[0,1,0],thickness:0.3,curvature:2},
  {p:[NaN,0,0],v:[0,0,0],n:[0,1,0]},
  {p:[3,4,5],v:[0,-1,0],n:[1,0,0],thickness:0.7,curvature:-1},
  {p:[9,9,9],v:[0,0,0],n:[0,1,0],material:-1},
  {p:[6,7,8],v:[0,0,1],n:[0,0,1],thickness:0.1},
 ];
 const counters=new Uint32Array(10);counters[0]=5;
 const snapshot=decodeInterfaceSurfels(counters,records(list,8),{...layout,capacity:8,maxInstances:100,writeTick:120,stepSeconds:1/60,capturedAtMs:5000});
 assert.equal(snapshot.schema,'kaminos.proxy-snapshot.v0');
 assert.equal(snapshot.kind,'surfels');
 assert.equal(snapshot.activeRecords,5);
 assert.equal(snapshot.count,3,'non-finite and dormant records are dropped');
 assert.equal(snapshot.data.length,3*SURFEL_FLOATS);
 assert.deepEqual(Array.from(snapshot.data.slice(0,SURFEL_FLOATS)).map(v=>Number(v.toFixed(4))),[0,1,2,0,1,0,0.1,0,0,0.3,2]);
 assert.equal(snapshot.simTimeS,2);
 assert.equal(snapshot.capturedAtMs,5000);
});

test('active count is clamped to capacity and decimated to the instance budget',()=>{
 const list=Array.from({length:10},(_,i)=>({p:[i,0,0],v:[0,0,0],n:[0,1,0],thickness:i/10}));
 const counters=new Uint32Array(10);counters[0]=999;
 const snapshot=decodeInterfaceSurfels(counters,records(list,10),{...layout,capacity:10,maxInstances:4,writeTick:0,stepSeconds:1/60,capturedAtMs:0});
 assert.equal(snapshot.activeRecords,10,'counter beyond capacity is clamped');
 assert.equal(snapshot.stride,3);
 assert.deepEqual(Array.from({length:snapshot.count},(_,i)=>snapshot.data[i*SURFEL_FLOATS]),[0,3,6,9]);
 assert.throws(()=>decodeInterfaceSurfels(counters,new Float32Array(5),{...layout,capacity:10,maxInstances:4}),/records/);
});

test('extrapolation is clamped to a short window',()=>{
 assert.equal(surfelExtrapolationSeconds(10.05,10,0.25),0.05000000000000071);
 assert.equal(surfelExtrapolationSeconds(11,10,0.25),0.25);
 assert.equal(surfelExtrapolationSeconds(9,10,0.25),0);
});

test('the producer copies at a decimated cadence with at most one map in flight',async()=>{
 const submitted=[],maps=[];
 const buffer=size=>({size,state:'unmapped',mapAsync(){this.state='pending';return new Promise(resolve=>maps.push(()=>{this.state='mapped';resolve();}));},getMappedRange(){return new ArrayBuffer(this.size);},unmap(){this.state='unmapped';},destroy(){}});
 const device={createBuffer:({size})=>buffer(size),createCommandEncoder:()=>({copies:[],copyBufferToBuffer(...a){this.copies.push(a);},finish(){return this;}}),queue:{submit:list=>submitted.push(...list)}};
 const descriptor={device,recordsBuffer:{},countersBuffer:{},recordFloats:RECORD_FLOATS,recordBytes:RECORD_FLOATS*4,counterBytes:40,capacity:16,activeCountCounterIndex:0,fields:layout.fields,writeTick:0};
 const published=[];
 const producer=createInterfaceSurfelProducer({descriptor:()=>descriptor,everyFrames:3,maxInstances:8,stepSeconds:1/60,onSnapshot:s=>published.push(s),now:()=>42});
 for(let i=0;i<7;i++)producer.tick();
 assert.equal(submitted.length,1,'no second copy while the first map is pending');
 assert.equal(submitted[0].copies.length,2,'counters and records are copied together');
 assert.equal(submitted[0].copies[1][4],16*RECORD_FLOATS*4,'records copy spans the capacity');
 maps.splice(0).forEach(resolve=>resolve());
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(published.length,1);
 assert.equal(published[0].count,0,'an all-zero counter decodes to an empty snapshot');
 for(let i=0;i<3;i++)producer.tick();
 assert.equal(submitted.length,2,'copies resume after the map resolves');
 assert.equal(producer.state().snapshotsPublished,1);
 producer.dispose();
});

test('host presentation plan: proxy keeps one scene render and drops the liquid passes',()=>{
 assert.deepEqual(localLiquidPresentationPlan('full'),{step:true,sceneColor:true,sceneDepth:true,environment:true,liquidComposite:true});
 assert.deepEqual(localLiquidPresentationPlan('proxy'),{step:true,sceneColor:true,sceneDepth:false,environment:false,liquidComposite:false});
 assert.throws(()=>localLiquidPresentationPlan('xray'),/presentation/);
});

test('water display is a validated viewport preference',()=>{
 assert.equal(checkedViewportDisplay().water,'full');
 assert.equal(checkedViewportDisplay({water:'proxy'}).water,'proxy');
 assert.throws(()=>checkedViewportDisplay({water:'wire'}),/water/);
});

import {createProxySnapshotRegistry,surfelSummary} from '../proxy-snapshot.mjs';
test('snapshots carry a bounds/centroid summary consumers can use without iterating',()=>{
 const data=new Float32Array([0,0,0, 0,1,0, 0,0,0, 0.2,0, 2,4,-2, 0,1,0, 0,0,0, 0.4,0]);
 const summary=surfelSummary(data,2);
 assert.deepEqual({...summary,meanThickness:undefined},{count:2,bounds:[[0,0,-2],[2,4,0]],centroid:[1,2,-1],meanThickness:undefined});
 assert.ok(Math.abs(summary.meanThickness-0.3)<1e-6);
 assert.deepEqual(surfelSummary(new Float32Array(0),0),{count:0,bounds:null,centroid:null,meanThickness:null});
 const counters=new Uint32Array(10);counters[0]=1;
 const snapshot=decodeInterfaceSurfels(counters,records([{p:[1,2,3],v:[0,0,0],n:[0,1,0],thickness:0.5}],2),{...layout,capacity:2,maxInstances:8});
 assert.deepEqual(snapshot.summary.bounds,[[1,2,3],[1,2,3]]);
});

test('the registry keeps the latest snapshot per source and tells producers when anyone is listening',()=>{
 const registry=createProxySnapshotRegistry();
 assert.equal(registry.wanted('water'),false);
 const seen=[];const unsubscribe=registry.subscribe('water',s=>seen.push(s.writeTick));
 assert.equal(registry.wanted('water'),true);
 registry.publish('water',{writeTick:3,capturedAtMs:10,count:2,summary:{count:2}});
 registry.publish('fire',{writeTick:9,capturedAtMs:11,count:0,summary:{count:0}});
 assert.deepEqual(seen,[3]);
 assert.equal(registry.latest('water').writeTick,3);
 assert.deepEqual(registry.sources().map(s=>[s.source,s.subscribers,s.writeTick]),[['water',1,3],['fire',0,9]]);
 const late=[];registry.subscribe('water',s=>late.push(s.writeTick),{replayLatest:true});
 assert.deepEqual(late,[3],'a late subscriber can start from the latest snapshot');
 registry.subscribe('water',()=>{throw Error('bad consumer');});
 registry.publish('water',{writeTick:4,capturedAtMs:12,count:1,summary:{count:1}});
 assert.deepEqual(seen,[3,4],'one failing consumer does not starve the others');
 assert.equal(registry.state().consumerErrors,1);
 unsubscribe();
 registry.clear('water');
 assert.equal(registry.latest('water'),null);
});
