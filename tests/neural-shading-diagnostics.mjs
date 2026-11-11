// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {NeuralFallbackReadout,sourceFallbackSummary} from '../scene-neural-diagnostics.mjs';

test('source fallback summary counts actual opaque neural pixels and exposes scope',()=>{
 const state=sourceFallbackSummary(new Uint32Array([12,9,3,0]),{width:5,height:4,scale:.25,capture:[1,1],frame:7});
 assert.equal(state.neuralPixels,12);
 assert.equal(state.reconstructedPixels,9);
 assert.equal(state.fullRatePixels,3);
 assert.equal(state.fullRateFraction,.25);
 assert.equal(state.neuralCoverage,.6);
 assert.equal(state.scope,'opaque-neural-source-pixels');
 assert.equal(state.requestedScale,.25);
 assert.equal(state.nominalPixelFraction,.0625);
 assert.equal(state.receivingPassIncluded,false);
 assert.throws(()=>sourceFallbackSummary([12,9,2,0],{width:5,height:4,scale:.25}),/counter/);
 assert.throws(()=>sourceFallbackSummary([12,9,2,1],{width:5,height:4,scale:.25}),/unclassified/);
});

test('readout starts off and performs no work until an explicit sample',async()=>{
 let probes=0;const readout=new NeuralFallbackReadout(async()=>{probes++;return {fullRateFraction:.25};});
 assert.equal(readout.read().status,'off');assert.equal(probes,0);
 const result=await readout.sample();assert.equal(probes,1);assert.equal(result.status,'snapshot');assert.equal(result.result.fullRateFraction,.25);
 readout.stop();assert.equal(readout.read().status,'off');assert.equal(readout.read().result,null);assert.equal(probes,1);
});

test('overlapping requests share one sample and stopped/stale/failed output is never current',async()=>{
 let release,probes=0;const readout=new NeuralFallbackReadout(()=>{probes++;return new Promise(resolve=>{release=resolve;});});
 const a=readout.sample(),b=readout.sample();assert.equal(probes,1);assert.equal(a,b);
 readout.stop();release({fullRateFraction:.8});await a;assert.equal(readout.read().status,'off');assert.equal(readout.read().result,null);
 const c=readout.sample();readout.invalidate('camera');release({fullRateFraction:.2});await c;assert.equal(readout.read().status,'stale');assert.equal(readout.read().result,null);
 const broken=new NeuralFallbackReadout(async()=>{throw Error('device lost');});await assert.rejects(broken.sample(),/device lost/);assert.equal(broken.read().status,'failed');assert.equal(broken.read().result,null);
});

test('synchronous probe failures release the sampler for another request',async()=>{
 let n=0;const readout=new NeuralFallbackReadout(()=>{if(++n===1)throw Error('not available');return {fullRateFraction:0};});
 await assert.rejects(readout.sample(),/not available/);assert.equal(readout.read().busy,false);
 assert.equal((await readout.sample()).status,'snapshot');assert.equal(n,2);
});

test('preparation changes enter the fresh snapshot while post-capture changes invalidate it',async()=>{
 let finish,captured;
 const readout=new NeuralFallbackReadout(context=>{captured=context.captured;return new Promise(resolve=>{finish=resolve;});},{deferInvalidationUntilCapture:true});
 const first=readout.sample();readout.invalidate('environment arrived before capture');
 assert.equal(readout.read().status,'sampling');captured();finish({fullRateFraction:0});assert.equal((await first).status,'snapshot');
 const second=readout.sample();captured();readout.invalidate('camera changed after capture');finish({fullRateFraction:.2});await second;
 assert.equal(readout.read().status,'stale');assert.equal(readout.read().result,null);
 const missing=new NeuralFallbackReadout(async()=>({}),{deferInvalidationUntilCapture:true});await assert.rejects(missing.sample(),/capture boundary/);
});
