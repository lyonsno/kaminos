import assert from 'node:assert/strict';
import test from 'node:test';
import * as serving from '../slat-sampler.js';
import {loadGenerationInputs} from '../generation-inputs.js';
import {m} from './generation-input-fixture.js';
assert.equal(typeof serving.validateGenerationInputs,'function',
  'Native generation must admit complete checkpoint descriptors rather than accept default/partial model inputs.');
const tensorCount=Object.keys(m.tensors).length;
assert.equal(serving.validateGenerationInputs(m).tensorCount,tensorCount);
const clone=()=>structuredClone(m);
for(const role of ['shapeDecoder','textureDecoder'])test('reject shortened '+role,()=>{
  const reduced=clone();reduced.models[role].config.numBlocks=[0,0,0,0,0];
  const reducedShapes=serving.generationInputShapes(reduced).models[role];
  reduced.models[role].tensors=Object.fromEntries(Object.entries(reducedShapes).map(([key,shape])=>{
    const name=role+'.reduced.'+key;
    reduced.tensors[name]={file:name+'.f32',dtype:'float32',shape,byteLength:shape.reduce((n,x)=>n*x,4),sha256:'c'.repeat(64)};
    return[key,name];
  }));
  assert.throws(()=>serving.validateGenerationInputs(reduced),/canonical decoder architecture/,
    'Regenerating all descriptors for a shortened decoder must not admit a different model as the full source route.');
});
for(const name of [m.models.textureFlow.tensors.gelu,m.models.textureDecoder.siluTable])test('reject substituted activation '+name,()=>{
  const different=clone();
  // The shared SiLU alias needs a distinct descriptor before its content identity can differ.
  if(name===m.models.textureDecoder.siluTable){different.tensors['texture.silu']={...different.tensors[name],sha256:'e'.repeat(64)};
    different.models.textureDecoder.siluTable='texture.silu';}
  else different.tensors[name].sha256='e'.repeat(64);
  assert.throws(()=>serving.validateGenerationInputs(different),/activation table content identity/,
    'Shared activation storage may not substitute a different admitted table.');
});
let bad=clone();delete bad.models.highResolutionShape;assert.throws(()=>serving.validateGenerationInputs(bad),/highResolutionShape/);
bad=clone();bad.models.highResolutionShape.identity.sha256=bad.models.lowResolutionShape.identity.sha256;
assert.throws(()=>serving.validateGenerationInputs(bad),/separate.*checkpoint/);
bad=clone();bad.models.sparseFlow.config.steps=1;assert.throws(()=>serving.validateGenerationInputs(bad),/source sampler/);
bad=clone();delete bad.tensors[m.models.textureFlow.tensors['block29.mlp.out.weight']];
assert.throws(()=>serving.validateGenerationInputs(bad),/complete.*tensor/);
bad=clone();bad.tensors['image.pixels'].byteLength-=4;assert.throws(()=>serving.validateGenerationInputs(bad),/complete.*tensor/);
bad=clone();bad.tensors['image.pixels'].file='../hidden.f32';assert.throws(()=>serving.validateGenerationInputs(bad),/safe.*tensor/);
bad=clone();bad.models.textureDecoder.config.channels=[1];assert.throws(()=>serving.validateGenerationInputs(bad));
bad=clone();bad.status='failed';assert.throws(()=>serving.validateGenerationInputs(bad),/successful/);
const additive=clone();additive.future={diagnostic:true};additive.tensors['image.pixels'].future='metadata';
assert.equal(serving.validateGenerationInputs(additive).tensorCount,tensorCount);
const fetched=[],loaded=await loadGenerationInputs(m,async key=>{fetched.push(key);return new Float32Array(m.tensors[key].byteLength/4);});
assert.equal(typeof loaded.loadModels,'function');assert.equal(loaded.models,undefined);
assert.ok(fetched.every(key=>key.startsWith('dino.')||key==='image.pixels'),
  'DINO execution can settle before multi-GB downstream checkpoints are fetched. This is input loading, not model-result injection.');
console.log('Complete source-model/config/tensor admission rejects partial weights, shadowed schedule, reused HR checkpoint and failed package; additive metadata remains compatible. Synthetic descriptors are policy fixtures, not external checkpoint evidence.');
export {m};
