// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createTrellisDinoV3ConditioningAdapter} from '../dinov3-serving.js';
import {pixelValues,prefixWeights,dinoLayerWeights} from './dinov3-serving-contracts.mjs';

test('the production encoder waits for each submitted kernel and preserves completion failure',async()=>{
 let submitted=0,waited=0,release;const gate=new Promise(r=>release=r),lost=Error('observed queue completion loss');
 const runtime={device:{limits:{maxComputeWorkgroupsPerDimension:65535},queue:{async onSubmittedWorkDone(){waited++;await gate;throw lost;}}},
  createManagedBuffer(d){return {...d,destroy(){}};},createUniformBuffer(d){return {buffer:{...d,destroy(){}}};},
  createTensor(d){return {...d,byteLength:d.shape.reduce((a,b)=>a*b,4)};},uploadTensor(){},defineComputeKernel(d){return d;},
  async runKernel(){submitted++;if(submitted>1)throw Error('encoded next kernel before previous GPU completion');}};
 const adapter=createTrellisDinoV3ConditioningAdapter({route:{routeId:'test',runtime},pixelValues,prefixWeights,loadLayerWeights:async()=>dinoLayerWeights});
 const running=adapter.run({id:'real-invocation'});const observed=running.catch(e=>e);
 await new Promise(r=>setImmediate(r));
 release();const error=await observed;
 assert.equal(submitted,1,'no following encoder kernel is submitted while prior GPU work is pending');
 assert.equal(waited,1);assert.equal(error,lost);assert.equal(adapter.state,'failed');assert.equal(adapter.outputs,undefined);adapter.dispose();
});
