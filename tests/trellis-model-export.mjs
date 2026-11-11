// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as storage from '../neumip-model.mjs';import {createNeumipStudent} from '../neumip-training.mjs';
test('source-trained student exports through the author format and reloads identical parameters',()=>{
 assert.equal(typeof storage.writeNeumipModel,'function','shared runtime must include its trainer export function');
 const model=createNeumipStudent({resolution:32,seed:41}),bytes=storage.writeNeumipModel(model),copy=storage.readNeumipModel(bytes);
 assert.deepEqual(copy.offset.data,model.offset.data);assert.equal(copy.mips.length,model.mips.length);copy.mips.forEach((t,i)=>assert.deepEqual(t.data,model.mips[i].data));copy.layers.forEach((l,i)=>{assert.deepEqual(l.weights,model.layers[i].weights);assert.deepEqual(l.biases,model.layers[i].biases);});
});
