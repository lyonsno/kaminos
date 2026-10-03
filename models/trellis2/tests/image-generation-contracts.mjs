import assert from 'node:assert/strict';
import * as serving from '../slat-sampler.js';
assert.equal(typeof serving.createTrellisImageGenerationAdapter,'function',
  'The production image caller must join the complete DINO producer to actual generation without a host feature artifact.');
import {route,pixelValues,prefixWeights,dinoLayerWeights} from './dinov3-serving-contracts.mjs';
import {models as smallModels} from './generation-composition-contracts.mjs';
const allocations=[],runs=[],reads=[],base=route.runtime;let phase,marked=false,failStage;
const runtime={...base,
  createTensor(d){const t={...d,byteLength:d.shape.reduce((a,b)=>a*b,4)};
    t.buffer=d.buffer??{destroy(){t.destroyed=true;}};allocations.push(t);return t;},
  async runKernel(k,o){for(const b of k.bindings)assert.ok(!b.resource.destroyed&&!b.resource.buffer?.destroyed);
    runs.push({k,o});if(o.stage==='slat-regrid-mark')marked=true;
    if(o.stage===failStage)throw Error('image generation injected failure');},
  async readTensor(t){reads.push(t);assert.equal(t.dtype,'u32');assert.equal(t.byteLength,4);
    return new Uint32Array([t.name.includes('hash-status')?0:t.name.includes('occupancy.count')?3:
      phase==='learned-cascade-support'&&marked?4:5]);}},models={};
for(const [role,m]of Object.entries(smallModels)){
  models[role]={...m};
  if(m.weights.blocks){models[role].config={...m.config,contextRows:1029,contextChannels:1024};
    models[role].weights={...m.weights,blocks:m.weights.blocks.map(b=>({...b,'cross.kv.weight':new Float32Array(2*m.config.channels*1024)}))};}
}
const options={route:{runtime,routeId:'whole-image-generation'},pixelValues,prefixWeights,
  async loadLayerWeights(){return dinoLayerWeights;},models,meshResolution:128,
  onPhase(e){phase=e.phase;if(phase==='learned-cascade-support')marked=false;}},
  a=serving.createTrellisImageGenerationAdapter(options),invocation={id:'whole-native-invocation'},out=await a.run(invocation);
assert.equal(a.state,'completed');assert.equal(out.dino.blocksExecuted,24);
assert.deepEqual(out.conditioning.shape,[1,1029,1024]);
assert.ok(runs.filter(r=>r.o.stage==='flow-resident-conditioning-bf16').every(r=>r.k.bindings[0].resource===out.conditioning));
assert.ok(runs.every(r=>r.o.schedulerInvocation===invocation));assert.ok(reads.every(t=>t.byteLength===4&&t.dtype==='u32'));
assert.equal(out.geometry.features.shape[1],7);assert.equal(out.material.features.shape[1],6);
assert.equal(out.featureBytesToCPUDuringServing,0);assert.equal(out.conditioning.buffer.destroyed,undefined);
assert.equal(Object.keys(a.noiseInputs).length,4);await assert.rejects(a.run(invocation),/completed/);a.dispose();
assert.ok(out.conditioning.buffer.destroyed);assert.ok(out.geometry.features.destroyed);assert.ok(out.material.features.destroyed);
failStage='decoder-layernorm';const failed=serving.createTrellisImageGenerationAdapter(options);
await assert.rejects(failed.run(invocation),/injected/);assert.equal(failed.state,'failed');assert.equal(failed.outputs,undefined);
assert.equal(failed.phase,'learned-cascade-support');assert.equal(failed.noiseInputs.sparse.values.length,32768);
failed.dispose();await assert.rejects(failed.run(invocation),/disposed/);
failStage=undefined;let checkpointLoadObserved=false;
const stagedLoads=[],modelInputs=Object.fromEntries(Object.entries(models).map(([role,m])=>[role,{config:m.config,identity:m.identity}]));
const staged=serving.createTrellisImageGenerationAdapter({...options,models:undefined,modelInputs,
  async loadModel(role){assert.ok(staged.conditioning?.buffer);stagedLoads.push(role);return models[role];}});
const stagedOut=await staged.run(invocation);
assert.deepEqual(stagedLoads,['sparseFlow','occupancyDecoder','lowResolutionShape','shapeDecoder',
  'highResolutionShape','shapeDecoder','textureFlow','textureDecoder']);
assert.deepEqual(stagedOut.geometry.features.shape,[5,7]);assert.deepEqual(stagedOut.material.features.shape,[5,6]);staged.dispose();
assert.throws(()=>serving.createTrellisImageGenerationAdapter({...options,modelInputs,loadModel(){}}),/one.*staged.*source/);
const loadFailure=serving.createTrellisImageGenerationAdapter({...options,models:undefined,modelInputs,
  async loadModel(role){if(role==='occupancyDecoder')throw Error('observed staged checkpoint failure');return models[role];}});
await assert.rejects(loadFailure.run(invocation),/observed staged checkpoint failure/);
assert.equal(loadFailure.state,'failed');assert.equal(loadFailure.phase,'generation-checkpoint-input-loading');
assert.equal(loadFailure.outputs,undefined);assert.ok(loadFailure.conditioning.buffer);
assert.equal(loadFailure.noiseInputs.sparse.values.length,32768);loadFailure.dispose();
const lazy=serving.createTrellisImageGenerationAdapter({...options,models:undefined,async loadModels(){
  assert.ok(lazy.conditioning?.buffer,'checkpoint loader runs after actual DINO producer output exists');
  checkpointLoadObserved=true;return models;}});
const lazyOut=await lazy.run(invocation);assert.ok(checkpointLoadObserved);assert.deepEqual(lazyOut.geometry.features.shape,[5,7]);lazy.dispose();
console.log('Actual DINO → seven-model generation shares one resident conditioning tensor and invocation; scalar-only serving reads, preserved noise and producer/output lifetimes. Fake runtime is not native full-model proof.');
