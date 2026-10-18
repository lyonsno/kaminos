// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { continuousDetailOffset, resolveContinuousDetail } from '../volume-continuous-detail.mjs';

test('saved basins can retain independent render detail without enabling a simulation force', () => {
  const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url)));
  assert.equal(schema.controlCount, schema.controls.length, 'server validates schema inventory before any basin load');
  const controls = Object.values(schema).flat().filter(x => x && typeof x === 'object');
  for (const [key, value] of [['volume-render-detail', 0], ['volume-render-detail-scale', 2]]) {
    const control = controls.find(c => c.key === key);
    assert.ok(control, `${key} must be a persisted, additive control`);
    assert.equal(control.additiveDefault, value);
  }
});

test('displacement is bounded by its support halo and continuous within a cell', () => {
  let variation = 0;
  const b = [2.31, 4.73, 1.47];
  for (let i = 0; i < 120; i++) {
    const a = [i * 0.137, 3.17, 5.29];
    const v = continuousDetailOffset(a, b, i % 48, 1, 0.5);
    assert.ok(Math.hypot(...v) < 1, 'one-cell halo encloses every displaced lookup');
    assert.deepEqual(continuousDetailOffset(a, b, i, 0, 2), [0, 0, 0]);
    const nearby = continuousDetailOffset([a[0] + 1e-5, a[1], a[2]], b, i % 48, 1, 0.5);
    assert.ok(Math.hypot(...v.map((x, k) => x - nearby[k])) < 0.002);
    variation += Math.hypot(...v);
  }
  assert.ok(variation > 1, 'detail must actually move sub-cell lookups');
  assert.equal(resolveContinuousDetail({renderDetail: 1, waveletTurbulence: 0}).admitted, true);
});

test('resetting either transported coordinate set at zero weight does not pop the detail', () => {
  const a = [2.3, 4.5, 6.7], b = [7.4, 1.5, 3.1], lattice = [12.5, 4.5, 8.5];
  assert.deepEqual(continuousDetailOffset(a, b, 0, 0.7, 2), continuousDetailOffset(lattice, b, 0, 0.7, 2));
  assert.deepEqual(continuousDetailOffset(a, b, 24, 0.7, 2), continuousDetailOffset(a, lattice, 24, 0.7, 2));
});
