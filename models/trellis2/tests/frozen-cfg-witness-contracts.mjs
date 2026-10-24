// kaminos-test: node
import assert from 'node:assert/strict';
import { compareFrozenCfgArray } from '../frozen-cfg-witness.js';
assert.throws(() => compareFrozenCfgArray(new Float32Array(0), new Float32Array(0)), /complete/);
assert.throws(() => compareFrozenCfgArray(new Float32Array(2), new Float32Array(3)), /equal-sized/);
assert.throws(() => compareFrozenCfgArray(new Float32Array([NaN]), new Float32Array([0])), /nonfinite/);
assert.throws(() => compareFrozenCfgArray(new Float32Array([0]), new Float32Array([Infinity])), /nonfinite/);
assert.equal(compareFrozenCfgArray(new Float32Array([1, 2]), new Float32Array([1, 2])).exact, true);
const corrupt = compareFrozenCfgArray(new Float32Array([0, 0]), new Float32Array([1, 2]));
assert.equal(corrupt.exact, false); assert.equal(corrupt.unequal, 2); assert.equal(corrupt.maxAbs, 2);
assert.equal(corrupt.rms, Math.sqrt(2.5));
console.log('Frozen CFG comparisons reject partial/nonfinite tensors and preserve finite corruption as a mismatch.');
