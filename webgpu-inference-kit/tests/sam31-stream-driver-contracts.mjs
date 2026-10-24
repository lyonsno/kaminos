// kaminos-test: node
import assert from 'node:assert/strict';
import * as driver from '../src/sam31-stream-driver.js';
assert.equal(typeof driver.createSam31StreamDriver, 'function', 'persistent tracking must call the actual shared WebGPU phases');
await assert.rejects(driver.createSam31StreamDriver({ packageRuntime: { modelPackage: { components: {} } } }), /stream.*model/i);
assert.equal(typeof driver.hashSam31StreamTensorSet, 'function');
const first = { '0:memory': new Float32Array([1]), '1:memory': new Float32Array([2]) };
const a = await driver.hashSam31StreamTensorSet(first);
first['1:memory'][0] = 3;
assert.notEqual(await driver.hashSam31StreamTensorSet(first), a, 'later-frame changes must alter the bank identity');
assert.equal(await driver.hashSam31StreamTensorSet({ '1:memory': first['1:memory'], '0:memory': first['0:memory'] }),
  await driver.hashSam31StreamTensorSet(first), 'identity binds roles rather than insertion order');
console.log('SAM3.1 stream driver rejects fixture-only model packages');
