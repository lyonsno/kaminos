// kaminos-test: node
// Structured operator layout for the composite pressure solve: the same
// matrix as Sexy's face list (`volume-composite-grid.mjs`), stored as six
// fixed neighbour slots per cell plus a short tail for the coarse cells whose
// face against the fine box is tiled. CPU contracts only; the GPU conformance
// and cost runs are separate scripts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompositeGrid, applyCompositePressure } from '../volume-composite-grid.mjs';
import { buildCompositeStructure, applyCompositeStructure, buildCompositeHierarchy } from '../volume-composite-fast-pcg-gpu.mjs';

const small = closed => createCompositeGrid({ shape: [4, 6, 4], cellWidth: 1, fine: { min: [1, 1, 1], max: [3, 3, 3], ratio: 2 }, boundary: axis => axis === 1 ? 'open' : 'wall', solid: p => closed && p[1] > 4 && p[1] < 5 });
const ratio4 = () => createCompositeGrid({ shape: [8, 16, 8], cellWidth: 1 / 8, fine: { min: [2 / 8, 1 / 8, 2 / 8], max: [6 / 8, 5 / 8, 6 / 8], ratio: 4 }, boundary: axis => axis === 1 ? 'open' : 'wall' });

function seeded(n, seed = 7) {
  let s = seed >>> 0; const out = new Float64Array(n);
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; out[i] = (s / 2 ** 32) * 2 - 1; }
  return out;
}

for (const [name, make] of [['open 152', () => small(false)], ['closed 136', () => small(true)], ['ratio 4', ratio4]]) {
  test(`structure (${name}): six slots plus a seam tail reproduce the face matrix exactly`, () => {
    const grid = make();
    const s = buildCompositeStructure(grid);
    const n = grid.cells.length;
    assert.equal(s.cells, n);
    assert.equal(s.slotIndex.length, n * 6);
    assert.equal(s.slotCoefficient.length, n * 6);
    assert.equal(s.tailStart.length, n + 1);
    // Every seam tail belongs to a coarse cell that faces the fine box; fine cells never need one.
    for (let i = 0; i < n; i++) {
      const tail = s.tailStart[i + 1] - s.tailStart[i];
      if (tail > 0) assert.equal(grid.cells[i].level, 0, `cell ${i} has a tail but is fine`);
      for (let k = 0; k < 6; k++) {
        const j = s.slotIndex[i * 6 + k];
        if (j < 0) { assert.equal(s.slotCoefficient[i * 6 + k], 0); continue; }
        assert.ok(j < n);
        const back = [0, 1, 2, 3, 4, 5].some(m => s.slotIndex[j * 6 + m] === i && s.slotCoefficient[j * 6 + m] === s.slotCoefficient[i * 6 + k])
          || Array.from({ length: s.tailStart[j + 1] - s.tailStart[j] }, (_, t) => s.tailStart[j] + t).some(t => s.tailIndex[t] === i && s.tailCoefficient[t] === s.slotCoefficient[i * 6 + k]);
        assert.ok(back, `slot ${i}->${j} has no symmetric entry`);
      }
    }
    // Diagonal is the face sum including open faces; the stored diagonal is hers.
    for (let i = 0; i < n; i++) assert.ok(Math.abs(s.diagonal[i] - grid.diagonal[i]) < 1e-12);
    // The operator applied through the structure equals the face-list operator.
    const p = seeded(n);
    const ours = applyCompositeStructure(s, p), hers = applyCompositePressure(grid, p);
    let worst = 0; for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(ours[i] - hers[i]));
    assert.ok(worst < 1e-12, `operator mismatch ${worst}`);
  });
}

test('structure: every interior face appears once in each direction and open faces only in the diagonal', () => {
  const grid = ratio4();
  const s = buildCompositeStructure(grid);
  const seen = new Map();
  const add = (a, b, k) => { const key = a < b ? `${a},${b}` : `${b},${a}`; seen.set(key, (seen.get(key) ?? 0) + 1); void k; };
  for (let i = 0; i < grid.cells.length; i++) {
    for (let k = 0; k < 6; k++) if (s.slotIndex[i * 6 + k] >= 0) add(i, s.slotIndex[i * 6 + k]);
    for (let t = s.tailStart[i]; t < s.tailStart[i + 1]; t++) add(i, s.tailIndex[t]);
  }
  const interior = grid.faces.filter(f => f.b >= 0);
  assert.equal(seen.size, interior.length);
  for (const count of seen.values()) assert.equal(count, 2);
  const openCells = new Set(grid.faces.filter(f => f.b < 0).map(f => f.a));
  assert.ok(openCells.size > 0);
});

test('hierarchy: every level-0 cell has exactly one parent on the all-coarse level and the parent lists cover them once', () => {
  const grid = ratio4();
  const h = buildCompositeHierarchy(grid);
  assert.deepEqual(h.levels[0].shape, [8, 16, 8]);
  assert.equal(h.levels.length >= 3, true, 'coarsens below the all-coarse level');
  const counted = new Uint32Array(grid.cells.length);
  for (let c = 0; c < h.parentChildStart.length - 1; c++) for (let t = h.parentChildStart[c]; t < h.parentChildStart[c + 1]; t++) counted[h.parentChild[t]]++;
  assert.ok(counted.every(v => v === 1));
  for (let i = 0; i < grid.cells.length; i++) {
    const q = grid.cells[i].coarse;
    assert.equal(h.parentOf[i], q[0] + 8 * (q[1] + 16 * q[2]));
  }
  // The all-coarse level is a regular Poisson operator: 6 same-width neighbours
  // or an open face at y; solid or outside cells are masked.
  const L1 = h.levels[0];
  assert.equal(L1.mask.length, 8 * 16 * 8);
  assert.ok(L1.mask.every(v => v === 1), 'no solids in this fixture');
  assert.equal(h.levels.at(-1).shape.every(v => v >= 1), true);
});
