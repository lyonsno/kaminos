import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { balancedWgslBlock } from './helpers/wgsl-guard-ownership.mjs';
import { RAYMARCH_NEIGHBORHOOD_WGSL as sampling } from '../volume-raymarch-sampling.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const body = name => {
  const block = balancedWgslBlock(sampling + core, `fn ${name}(`);
  return block.slice(block.indexOf('{') + 1, -1);
};
const mix = (a, b, t) => a * (1 - t) + b * t;
const advanceBody = body('materialEmptyAdvance');
const advance = new Function('dtBase', 'cellExit', 'occupancySkipStrength', 'mix', 'min', 'max', advanceBody);
for (const strength of [0.01, 0.5, 1]) {
  assert.ok(advance(4 / 36, 0.01 / 24, strength, mix, Math.min, Math.max) <= 0.01 / 24,
    'empty-cell advancement must not cross an unchecked interpolation cell');
}
const select = (a, b, c) => c ? b : a;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cellBody = new Function('q', 'direction', 'count', 'clamp', 'max', 'floor', 'select', body('raymarchCellOriginAxis'));
const cell = (q, d, n) => cellBody(q, d, n, clamp, Math.max, Math.floor, select);
const exitBody = new Function('q', 'dqdt', 'count', 'raymarchCellOriginAxis', 'select', 'max', body('raymarchMaterialExitAxis'));
const exit = (q, d, n = 48) => exitBody(q, d, n, cell, select, Math.max);
assert.equal(cell(10, -24, 48), 9, 'negative exact face belongs to the lower cell');
assert.equal(cell(10, 24, 48), 10);
assert.equal(exit(10, -24), 1 / 24);
assert.ok(Math.abs(exit(10.999, 24) - 0.001 / 24) < 1e-14, 'near faces are not discarded');
assert.equal(exit(-0.5, 24), 1.5 / 24, 'lower clamped extension uses the real ray coordinate');
assert.equal(exit(47.5, -24), 1.5 / 24, 'upper clamped extension uses the real ray coordinate');
assert.equal(exit(-0.5, -24), 1e6);
assert.equal(exit(47.5, 24), 1e6);
assert.equal(exit(10, 0), 1e6);
for (const direction of [-24, 24]) {
  for (const start of [10, 10.99, 10.999]) {
    let q = start;
    const node = direction > 0 ? 13 : 8;
    let found = false;
    for (let i = 0; i < 10; i++) {
      const c = cell(q, direction, 48);
      if (c === node - 1 || c === node) { found = true; break; }
      q += direction * advance(4 / 36, exit(q, direction), 1, mix, Math.min, Math.max);
    }
    assert.equal(found, true, 'a one-node reconstructed sheet is visited, not jumped');
  }
}
const empty = new Function('smoke', 'fuel', 'front', body('raymarchMaterialEmpty'));
assert.equal(empty(0, 0, 0), true, 'moving air needs no optical evaluation');
assert.equal(empty(0, 1, 0), true, 'fuel without a reaction front cannot emit');
assert.equal(empty(0, 0, 1), true, 'front without fuel cannot emit');
assert.equal(empty(0, 0.008, 1), true);
assert.equal(empty(0, 1, 0.001), true);
assert.equal(empty(0, 0.009, 0.002), false, 'clean reaction is retained even with zero soot');
assert.equal(empty(1e-30, 0, 0), false, 'no guessed opacity threshold discards low-density smoke');
// Fuel and front on different corners can emit between them: reduce raw bounds,
// never a per-corner boolean or shaded intensity.
assert.equal(empty(0, Math.max(1, 0), Math.max(0, 1)), false);
assert.match(sampling, /result.materialBounds = max\(max\(max\(bounds0, bounds1\)/);
assert.match(core, /LEAN_EMISSIVE_RAYMARCH && u.emissive_material.w > 0.5\s*&& !flowKernelReconstructionActive/);
assert.match(core, /occupancySkipStrength > 0.0/);
assert.match(core, /if \(materialTraversal\)[\s\S]*else if \(!fullGridCapture && directSupport/);
console.log('material traversal contracts passed');
