import assert from 'node:assert/strict';
import {loadGenerationInputs} from '../generation-inputs.js';
import {m} from './generation-input-fixture.js';
const fetched=[],inputs=await loadGenerationInputs(m,async key=>{fetched.push(key);return {key};});
for(const role of ['sparseFlow','lowResolutionShape','highResolutionShape','textureFlow']){
  fetched.length=0;
  const model=await inputs.loadModel(role,{streamBlocks:true});
  assert.ok(!fetched.some(key=>/\.block\d+\./.test(key)),
    'Streaming construction must not fetch all 30 CPU block checkpoints before the first upload.');
  assert.equal(model.weights.blocks,undefined);
  assert.equal(typeof model.loadBlockWeights,'function');
  for(let i=0;i<30;i++){
    fetched.length=0;const block=await model.loadBlockWeights(i);
    const expected=Object.keys(m.models[role].tensors).filter(k=>k.startsWith('block'+i+'.'));
    assert.deepEqual(Object.keys(block).sort(),[...expected.map(k=>k.slice(('block'+i+'.').length)),'gelu'].sort());
    assert.ok(fetched.every(key=>key.startsWith(role+'.block'+i+'.')));
    assert.equal(block['mlp.in.weight'].key,m.models[role].tensors['block'+i+'.mlp.in.weight']);
  }
  const count=fetched.length;
  await assert.rejects(model.loadBlockWeights(30),/block index/);
  assert.equal(fetched.length,count);
}
const occupancy=await inputs.loadModel('occupancyDecoder',{streamBlocks:true});
assert.equal(occupancy.loadBlockWeights,undefined);
console.log('Flow CPU checkpoints are fetched one complete source block at a time; all 30 remain covered and decoder loading is unchanged.');
