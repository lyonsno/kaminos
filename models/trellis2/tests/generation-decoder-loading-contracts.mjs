import assert from 'node:assert/strict';
import {loadGenerationInputs} from '../generation-inputs.js';
import {m} from './generation-input-fixture.js';
const fetched=[],inputs=await loadGenerationInputs(m,async key=>{fetched.push(key);return {key};});
for(const role of ['shapeDecoder','textureDecoder']){
  fetched.length=0;const model=await inputs.loadModel(role,{streamParameters:true});
  assert.ok(!fetched.some(key=>key.startsWith(role+'.')),
    'Learned decoder construction must not fetch its complete CPU checkpoint before the first parameter upload.');
  assert.deepEqual(model.weights,{});assert.equal(typeof model.loadWeight,'function');
  for(const [name,key]of Object.entries(m.models[role].tensors)){
    fetched.length=0;assert.equal((await model.loadWeight(name)).key,key);
    assert.deepEqual(fetched,[key],'Exactly the requested identified checkpoint parameter is fetched.');
  }
  fetched.length=0;await assert.rejects(model.loadWeight('constructor'),/parameter/);
  assert.deepEqual(fetched,[]);
  const eager=await inputs.loadModel(role);
  assert.deepEqual(Object.keys(eager.weights).sort(),Object.keys(m.models[role].tensors).sort());
}
console.log('Shape/material CPU checkpoints stream by identified parameter; default eager compatibility remains.');
