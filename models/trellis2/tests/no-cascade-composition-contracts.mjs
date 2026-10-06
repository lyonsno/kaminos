import assert from 'node:assert/strict';
import {models} from './generation-composition-contracts.mjs';
import {createTrellisGenerationFromConditioningAdapter} from '../trellis-generation.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
const allocated=[],loaded=[],phases=[],stages=[];
const runtime={device:{limits:{maxStorageBufferBindingSize:134217728},queue:{async onSubmittedWorkDone(){}}},
  createTensor(spec){const t={...spec,byteLength:spec.shape.reduce((n,x)=>n*x,4),buffer:spec.buffer??{destroy(){t.destroyed=true;}}};allocated.push(t);return t;},
  uploadTensor(){},defineComputeKernel(k){return k;},
  async runKernel(k,o){for(const b of k.bindings)assert.ok(!b.resource.destroyed&&!b.resource.buffer?.destroyed);stages.push(o.stage);},
  async readTensor(t){assert.equal(t.dtype,'u32');return new Uint32Array([t.name.includes('hash-status')?0:t.name.includes('occupancy.count')?3:5]);}};
const active={...models};delete active.highResolutionShape;
const conditioning=runtime.createTensor({name:'resident-conditioning',shape:[1,7,5],dtype:'f32',usage:U.storage});
const adapter=createTrellisGenerationFromConditioningAdapter({route:{runtime,routeId:'synthetic-preview-composition'},
  conditioningTensor:conditioning,models:active,pipelineType:'512',meshResolution:512,seed:42,
  async loadModel(role){loaded.push(role);return {...active[role],role};},onPhase:e=>phases.push(e.phase)});
const result=await adapter.run({id:'one-preview'});
assert.equal(result.pipelineType,'512');assert.equal(result.meshResolution,512);
assert.equal(result.lowResolutionRows,3);assert.equal(result.highResolutionRows,3);
assert.deepEqual(loaded,['sparseFlow','occupancyDecoder','lowResolutionShape','shapeDecoder','textureFlow','textureDecoder']);
assert.deepEqual(phases.filter(x=>x!=='generation-checkpoint-input-loading'),['sparse-structure-sampling','occupancy-decoding',
  'low-resolution-shape-sampling','learned-geometry-decoding','shape-conditioned-texture-sampling','shape-guided-material-decoding']);
assert.deepEqual(Object.keys(result.initialNoise),['sparse','lowResolutionShape','texture']);
assert.ok(stages.every(x=>!x.startsWith('slat-regrid')),'actual composition cannot execute a hidden cascade');
assert.deepEqual(result.geometry.features.shape,[5,7]);assert.deepEqual(result.material.features.shape,[5,6]);
assert.ok(!result.geometry.features.destroyed&&!result.material.features.destroyed);
adapter.dispose();assert.ok(!conditioning.destroyed);
console.log('Actual composition takes LR directly to512 geometry/guided material without support/HR load/noise; synthetic runtime is not native generation evidence.');
