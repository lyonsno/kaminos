import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smoothstep = (lo, hi, x) => { const t = clamp((x - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); };
// Execute the scalar production extractor; the baseline path is the pre-change bake.
const helper = core.match(/fn boundaryRidgeFromStencil\([\s\S]*?\) -> f32 \{([\s\S]*?)\n\}/);
const baseline = core.slice(core.indexOf('  let laplacian = abs(px + nx'), core.indexOf('  let boundarySidecarCoverage ='));
assert.ok(helper || baseline.includes('let boundarySidecarRidge'), 'production extraction is available');
const body = helper ? helper[1] : `${baseline}\nreturn boundarySidecarRidge;`;
const evaluate = new Function('center', 'px', 'nx', 'py', 'ny', 'pz', 'nz', 'gain', 'cut', 'u',
  'abs', 'sqrt', 'max', 'min', 'clamp', 'smoothstep', body);
function ridge(stencil, { mode = 1, level = 0.2, radius = 1.5, gain = 1, cut = 0.135 } = {}) {
  return evaluate(...stencil, gain, cut, {
    boundary_sidecar_display: { y: mode, z: level, w: radius },
    boundary_fire_structure: { x: gain, y: cut }, boundary_sidecar_controls: { w: 1 },
  }, Math.abs, Math.sqrt, Math.max, Math.min, clamp, smoothstep);
}
function ramp(center = 0.2, slope = 0.05, axis = 0) {
  const values = [center, center, center, center, center, center, center];
  values[1 + axis * 2] += slope;
  values[2 + axis * 2] -= slope;
  return values;
}
assert.ok(ridge(ramp()) > 0.999999, 'a coherent planar support transition receives emphasis even with zero Laplacian');
for (const axis of [0, 1, 2]) {
  assert.ok(Math.abs(ridge(ramp(0.2, 0.05, axis)) - 1) < 1e-12);
  assert.ok(Math.abs(ridge(ramp(0.2, -0.05, axis)) - 1) < 1e-12);
}
assert.equal(ridge(Array(7).fill(0.2)), 0, 'a uniform body at the level is not a transition');
assert.equal(ridge([0.2, 0, 0, 0, 0, 0, 0]), 0, 'isolated peak has no directional transition at its center');
assert.equal(ridge([0.2, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4]), 0, 'isolated valley has no directional transition at its center');
assert.equal(ridge(ramp(), { gain: 0 }), 0);
assert.ok(Math.abs(ridge(ramp(), { gain: 0.4 }) - 0.4) < 1e-12, 'gain changes amplitude, not band position');
assert.equal(ridge(ramp(0.4)), 0, 'support well outside the band is rejected');
assert.ok(ridge(ramp(0.23), { radius: 2 }) > ridge(ramp(0.23), { radius: 1 }), 'radius expands the band');
assert.ok(ridge(ramp(0.3), { level: 0.3 }) > ridge(ramp(0.3), { level: 0.2 }), 'level relocates the band');
const diagonal = [0.23, 0.26, 0.20, 0.27, 0.19, 0.23, 0.23];
assert.ok(Math.abs(ridge(diagonal) - ridge(ramp(0.23))) < 1e-12, 'equal gradient magnitude gives equal planar band width');
assert.ok(Math.abs(ridge(ramp(0.23, 0.05)) - ridge(ramp(0.26, 0.1))) < 1e-12, 'band distance follows the local slope');
assert.ok(ridge([0.2, 0.3, 0.25, 0.2, 0.2, 0.2, 0.2]) < ridge(ramp()), 'local reversal reduces response');
assert.equal(ridge(ramp(), { cut: 0 }), ridge(ramp(), { cut: 0.55 }), 'legacy cut cannot shift the new band');
for (const stencil of [ramp(), [0.7, 0.1, 0.2, 0.15, 0.4, 0.1, 0.3], Array(7).fill(0), ramp(0.13)]) {
  for (const gain of [0, 0.67, 1, 2]) {
    for (const cut of [0, 0.135, 0.55]) {
      const [c, ...neighbors] = stencil;
      const expected = smoothstep(cut, cut + 0.14, Math.abs(neighbors.reduce((a, b) => a + b, 0) - 6 * c) * gain);
      assert.ok(Math.abs(ridge(stencil, { mode: 0, gain, cut }) - expected) < 1e-12, 'curvature mode preserves the old transfer');
    }
  }
}
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
assert.equal(schema.controlCount, schema.controls.length);
for (const [key, expected] of Object.entries({
  'volume-ridge-extractor-mode': '0', 'volume-ridge-support-level': '0.2', 'volume-ridge-radius-cells': '1.5',
})) assert.equal(schema.controls.find(control => control.key === key)?.additiveDefault, expected);
console.log('support transition: planar response, flat/extremum rejection, independent controls, legacy transfer preserved');
