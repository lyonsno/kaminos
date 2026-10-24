// kaminos-test: node
import assert from 'node:assert/strict';
import { compareFrozenCfgArray, runFrozenCfgCase } from '../frozen-cfg-witness.js';
assert.throws(() => compareFrozenCfgArray(new Float32Array(0), new Float32Array(0)), /complete/);
assert.throws(() => compareFrozenCfgArray(new Float32Array(2), new Float32Array(3)), /equal-sized/);
assert.throws(() => compareFrozenCfgArray(new Float32Array([NaN]), new Float32Array([0])), /nonfinite/);
assert.throws(() => compareFrozenCfgArray(new Float32Array([0]), new Float32Array([Infinity])), /nonfinite/);
assert.equal(compareFrozenCfgArray(new Float32Array([1, 2]), new Float32Array([1, 2])).exact, true);
const corrupt = compareFrozenCfgArray(new Float32Array([0, 0]), new Float32Array([1, 2]));
assert.equal(corrupt.exact, false); assert.equal(corrupt.unequal, 2); assert.equal(corrupt.maxAbs, 2);
assert.equal(corrupt.rms, Math.sqrt(2.5));
console.log('Frozen CFG comparisons reject partial/nonfinite tensors and preserve finite corruption as a mismatch.');

// The observed CFT adapter has vendor/architecture, but blank description/device.
// Stop at fixture admission: this is a CPU runtime-admission test, not GPU proof.
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const admitted = new Error('fixture admission reached');
try {
  for (const [overrides, expected, expectedRequests] of [
    [{}, admitted, 1],
    [{ vendor: 'other' }, /native Apple Metal required/, 0],
    [{ architecture: 'other' }, /native Apple Metal required/, 0],
    [{ isFallbackAdapter: true }, /native Apple Metal required/, 0],
  ]) {
    let requests = 0, destroyed = 0;
    const device = { queue: {}, features: new Set(), limits: {},
      addEventListener() {}, destroy() { destroyed++; } };
    const adapter = { info: { vendor: 'apple', architecture: 'metal-3',
      description: '', device: '', isFallbackAdapter: false, ...overrides },
      async requestDevice() { requests++; return device; } };
    Object.defineProperty(globalThis, 'navigator', { configurable: true,
      value: { gpu: { async requestAdapter() { return adapter; } } } });
    await assert.rejects(runFrozenCfgCase({ get config() { throw admitted; } }, 0), expected);
    assert.equal(requests, expectedRequests);
    assert.equal(destroyed, expectedRequests, 'destroy exactly the owned device');
  }
} finally {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
}
console.log('Observed blank adapter description reaches fixture admission; wrong/fallback routes reject before requesting a device.');
