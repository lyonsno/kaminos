import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Replayable native pixels from volume-physical-color-witness's sparse ring.
// The top-left pixel is visibly empty in this fixed camera/fixture; this is
// not an assertion that an arbitrary flame photograph must have black corners.
const root = resolve(process.argv[2]);
const receipt = JSON.parse(readFileSync(`${root}/receipt.json`));
assert.equal(receipt.status, 'captured');
assert.equal(receipt.initialState.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
assert.match(receipt.initialState.backend, /apple/i);
const pixels = name => readFileSync(`${root}/${name}.rgba`);
assert.ok(pixels('legacy').equals(pixels('legacy-return')), 'legacy round trip preserves identical pixels');
assert.ok(!pixels('thermal-1900').equals(pixels('thermal-1900-plus-one')), 'exposure reaches visible pixels');
assert.ok(!pixels('thermal-1900').equals(pixels('thermal-2400')), 'temperature reaches visible pixels');
for (const name of ['thermal-1900','thermal-1900-plus-one','thermal-2400']) {
  assert.deepEqual([...pixels(name).subarray(0, 3)], [0,0,0], `${name}: empty background has no authored radiance floor`);
}
console.log('matched native color/legacy/empty-background pixels passed');
