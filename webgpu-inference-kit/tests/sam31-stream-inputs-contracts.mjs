// kaminos-test: node
import assert from 'node:assert/strict';
import * as inputs from '../src/sam31-stream-inputs.js';

assert.equal(typeof inputs.createSam31TrackingInputs, 'function', 'live tracking needs checkpoint-backed slot and positional inputs');
const valid = Float32Array.from({ length: 4096 }, (_, i) => i);
const invalid = Float32Array.from(valid, n => -n - 1);
const positionMatrix = new Float32Array(256);
positionMatrix[0] = 0.5;
positionMatrix[129] = 0.5;
const helper = inputs.createSam31TrackingInputs({ valid, invalid, noMemory: new Float32Array(256).fill(2),
  positionMatrix, height: 2, width: 2, objectSlots: [1, 7] });
assert.equal(helper.extraPerObjectEmbedding[0], -1);
assert.equal(helper.extraPerObjectEmbedding[256], 256);
assert.equal(helper.extraPerObjectEmbedding[7 * 256], 7 * 256);
valid.fill(99);
assert.equal(helper.extraPerObjectEmbedding[256], 256, 'checkpoint inputs are owned snapshots');
const features = new Float32Array(4 * 256).fill(3);
assert.equal(helper.conditionImage(features)[0], 5);
assert.equal(features[0], 3);
assert.ok(Math.abs(helper.imagePosition[0] + 1) < 1e-6);
assert.ok(Math.abs(helper.imagePosition[1] + 1) < 1e-6);
assert.ok(Math.abs(helper.imagePosition[256] - 1) < 1e-6, 'x coordinate changes across a row');
assert.ok(Math.abs(helper.imagePosition[512 + 1] - 1) < 1e-6, 'y coordinate changes across rows');
const masks = new Float32Array(16 * 4).fill(4);
const scores = new Float32Array(16).fill(3);
scores[7] = -1;
const filtered = helper.suppressMasks(masks, scores);
assert.deepEqual(Array.from(filtered.slice(0, 4)), [-1024, -1024, -1024, -1024], 'unused slots must not become objects');
assert.deepEqual(Array.from(filtered.slice(4, 8)), [4, 4, 4, 4]);
assert.equal(filtered[7 * 4], -1024, 'absent tracked objects are suppressed');
assert.equal(masks[0], 4);
const memory = helper.memoryInputs({ masks: filtered, scores, pointers: new Float32Array(4096).fill(5),
  width: 2, height: 2, targetWidth: 4, targetHeight: 4, conditioning: false });
assert.equal(memory.maskLogits.length, 16 * 16);
assert.equal(memory.maskLogits[0], 0, 'invalid slots mux to zero after sigmoid(0)*2-1, not absent-object -1');
assert.equal(memory.maskLogits[16], 4);
assert.equal(memory.maskLogits[7 * 16], -1024, 'valid absent objects remain absent');
assert.equal(memory.objectScores[0], 0);
assert.equal(memory.pointers[0], 0);
assert.equal(memory.pointers[256], 5);
assert.ok(memory.conditioning.every(n => n === 0));
const conditioning = helper.memoryInputs({ masks, scores, pointers: new Float32Array(4096),
  width: 2, height: 2, targetWidth: 2, targetHeight: 2, conditioning: true });
assert.equal(conditioning.conditioning[0], 0);
assert.equal(conditioning.conditioning[1], 1);
assert.throws(() => helper.suppressMasks(new Float32Array(3), scores), /mask/);
assert.throws(() => inputs.createSam31TrackingInputs({ valid, invalid, noMemory: new Float32Array(256), positionMatrix,
  height: 2, width: 2, objectSlots: [1, 1] }), /objectSlots/);
console.log('SAM3.1 production tracking input contracts passed');
