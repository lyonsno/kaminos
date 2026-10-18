// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { continuousDetailOffset, resolveContinuousDetail, CONTINUOUS_DETAIL_WGSL } from '../volume-continuous-detail.mjs';

test('the UI snapshot forwards independent detail controls to the renderer', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const filter = index.match(/REACTION_FRONT_EXTRACTOR_CONTROL_FIELDS\.filter\((field => [^\n]+?)\)\.map/)[1];
  const admitted = new Function(`return (${filter})`)();
  for (const key of ['renderDetail', 'renderDetailScale']) assert.equal(admitted({key}), true, `${key} reaches the renderer`);
});

test('coordinate publication carries its own blend phase through moving and held draws', () => {
  const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
  const store = core.match(/fn waveletCoordStore[\s\S]*?\n}/)[0];
  assert.match(store, /vec4<f32>\(coord, u\.wavelet_turbulence\.w\)/, 'stamp the phase used by coordinate transport, not the later CPU step counter');
  assert.match(CONTINUOUS_DETAIL_WGSL, /textureLoad\(waveletCoordSrc, vec3<i32>\(0\), 0\)\.w/, 'draw reads the consumed generation stamp');
  assert.doesNotMatch(CONTINUOUS_DETAIL_WGSL, /u\.continuous_detail\.z/);
  const a = [2.3, 4.5, 6.7], b = [7.4, 1.5, 3.1], reset = [12.5, 4.5, 8.5];
  for (const step of [24, 48]) {
    const published = {phase: step, a: step === 48 ? reset : a, b: step === 24 ? reset : b};
    const draw = () => continuousDetailOffset(published.a, published.b, published.phase, 1, .5);
    const moving = draw();
    assert.deepEqual(moving, continuousDetailOffset(a, b, step, 1, .5));
    assert.deepEqual(draw(), moving, 'holding the generation cannot change its blend phase');
  }
});

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
