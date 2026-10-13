// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import * as inputs from '../generation-inputs.js';
import {m} from './generation-input-fixture.js';

const checkpointOnly=()=>{
  const manifest=structuredClone(m);
  delete manifest.tensors[manifest.image.pixelTensor];delete manifest.image;
  return manifest;
};
const recorder=()=>{
  const fetched=[];
  // Descriptor-loading policy only: these markers are not learned tensors or
  // backend evidence. Model adapters separately admit actual array shapes.
  return {fetched,fetch:async key=>{fetched.push(key);return {checkpointKey:key};}};
};

test('checkpoint loading does not require or fetch a package image',async()=>{
  assert.equal(typeof inputs.loadGenerationCheckpoints,'function');
  assert.equal(typeof inputs.validateGenerationCheckpoints,'function');
  const manifest=checkpointOnly(),r=recorder();
  const plan=inputs.validateGenerationCheckpoints(manifest);
  assert.equal(plan.tensorCount,inputs.validateGenerationInputs(m).tensorCount-1);
  assert.ok(!plan.tensorKeys.includes('image.pixels'));
  const loaded=await inputs.loadGenerationCheckpoints(manifest,r.fetch);
  assert.ok(!Object.hasOwn(loaded,'pixelValues'));
  assert.deepEqual(r.fetched,Object.values(m.dino.prefix));
  assert.equal(loaded.seed,m.seed);assert.equal(loaded.meshResolution,m.meshResolution);
  assert.equal(loaded.pipelineType,'1024_cascade');
  assert.deepEqual(loaded.dinoIdentity,m.dino.identity);
  assert.deepEqual(loaded.modelInputs.lowResolutionShape.identity,m.models.lowResolutionShape.identity);
  await loaded.loadLayerWeights(23);
  assert.deepEqual(r.fetched.slice(Object.keys(m.dino.prefix).length),Object.values(m.dino.layers[23]));
});

test('caller pixels are returned unchanged and package pixels cannot shadow them',async()=>{
  const pixels=new Float32Array(512*512*3);pixels[0]=1.25;
  for(const manifest of [m,checkpointOnly()]){
    const r=recorder(),loaded=await inputs.loadGenerationInputs(manifest,r.fetch,{pixelValues:pixels});
    assert.ok(loaded.pixelValues===pixels,'selected caller pixel array must not be replaced');
    assert.ok(!r.fetched.includes('image.pixels'));
    assert.deepEqual(r.fetched,Object.values(m.dino.prefix));
  }
});

test('invalid explicit caller input refuses before fetching instead of falling back',async()=>{
  const nonfinite=new Float32Array(512*512*3);nonfinite[123]=NaN;
  for(const supplied of [{},{pixelValues:undefined},{pixelValues:new Uint8Array(512*512*3)},
    {pixelValues:new Float32Array(3)},{pixelValues:nonfinite},null]){
    const r=recorder();
    await assert.rejects(inputs.loadGenerationInputs(m,r.fetch,supplied),/complete finite prepared.*pixel/);
    assert.deepEqual(r.fetched,[]);
  }
});

test('checkpoint-only admission retains full model and schedule checks',()=>{
  for(const mutate of [
    x=>delete x.tensors[x.models.textureFlow.tensors['block29.mlp.out.weight']],
    x=>x.models.sparseFlow.config.steps=1,
    x=>x.models.highResolutionShape.identity.sha256=x.models.lowResolutionShape.identity.sha256,
    x=>x.dino.layers.pop(),
    x=>x.models.shapeDecoder.config.channels=[1]
  ]){
    const manifest=checkpointOnly();mutate(manifest);
    assert.throws(()=>inputs.validateGenerationCheckpoints(manifest),TypeError);
  }
  assert.throws(()=>inputs.validateGenerationInputs(checkpointOnly()),/complete identified tensor/);
});

test('downstream checkpoints remain stage/block/parameter loaded',async()=>{
  const r=recorder(),loaded=await inputs.loadGenerationCheckpoints(checkpointOnly(),r.fetch);
  r.fetched.length=0;
  const flow=await loaded.loadModel('lowResolutionShape',{streamBlocks:true});
  assert.equal(flow.weights.blocks,undefined);
  assert.ok(r.fetched.every(key=>!key.includes('.block')));
  assert.ok(!r.fetched.some(key=>key.startsWith('highResolutionShape.')));
  r.fetched.length=0;await flow.loadBlockWeights(29);
  assert.deepEqual(r.fetched,Object.entries(m.models.lowResolutionShape.tensors)
    .filter(([key])=>key.startsWith('block29.')).map(([,name])=>name));
  r.fetched.length=0;
  const decoder=await loaded.loadModel('shapeDecoder',{streamParameters:true});
  assert.deepEqual(decoder.weights,{});assert.deepEqual(r.fetched,['shared.silu']);
  r.fetched.length=0;await decoder.loadWeight('output_layer.weight');
  assert.deepEqual(r.fetched,[m.models.shapeDecoder.tensors['output_layer.weight']]);
});

test('legacy input loading still requires and fetches its package image',async()=>{
  const r=recorder(),loaded=await inputs.loadGenerationInputs(m,r.fetch);
  assert.deepEqual(loaded.pixelValues,{checkpointKey:'image.pixels'});
  assert.deepEqual(r.fetched,[...Object.values(m.dino.prefix),'image.pixels']);
  await assert.rejects(inputs.loadGenerationInputs(checkpointOnly(),r.fetch),/complete identified tensor/);
});
