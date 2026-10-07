import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');

// Five vec4 partials per workgroup: compact, wide, vorticity/blocked, profile,
// and the lateral moments (heat·x, heat·z, smoke·x, smoke·z) that give a
// per-slab centroid of the hot gas in grid coordinates — the instrument for a
// plume that leans with no wind.
test('the residual probe folds per-slab heat and smoke centroids from lateral moment partials', () => {
  assert.equal(core.PRESSURE_RESIDUAL_FLOATS_PER_WORKGROUP, 20);
  const grid = 8, workgroupsX = 2, workgroupsY = 3; // 8 x 12 x 8 → 2 x 3 x 2 workgroups
  const workgroupCount = workgroupsX * workgroupsY * workgroupsX;
  const partials = new Float32Array(workgroupCount * 20);
  // slab 1 (workgroups with y index 1): all heat at cell x = 6, z = 1; smoke at x = 1, z = 6.
  for (let i = 0; i < workgroupCount; i += 1) {
    const slab = Math.floor(i / workgroupsX) % workgroupsY;
    if (slab !== 1) continue;
    const at = i * 20;
    partials[at + 13] = 2;          // heat sum
    partials[at + 14] = 4;          // smoke sum
    partials[at + 16] = 2 * 6;      // heat·x
    partials[at + 17] = 2 * 1;      // heat·z
    partials[at + 18] = 4 * 1;      // smoke·x
    partials[at + 19] = 4 * 6;      // smoke·z
  }
  const profile = core.residualProfileFromPartials(partials, { grid, workgroupsX, workgroupsY, workgroupCount });
  assert.equal(profile.identity, 'height-profile-before-projection-v1');
  // Centroids are reported relative to the grid centre, in cells: (grid − 1) / 2 = 3.5.
  assert.deepEqual(profile.heatCentroidCells, [null, [2.5, -2.5], null]);
  assert.deepEqual(profile.smokeCentroidCells, [null, [-2.5, 2.5], null]);
  assert.deepEqual(profile.heatMean.map(v => Number(v.toFixed(6))), [0, 2 * 4 / (grid * grid * 4), 0]);
  // An empty slab is null, never zero or NaN: zero would read as "centred".
  const empty = core.residualProfileFromPartials(new Float32Array(workgroupCount * 20), { grid, workgroupsX, workgroupsY, workgroupCount });
  assert.deepEqual(empty.heatCentroidCells, [null, null, null]);
});

test('the probe shader writes the lateral moments as the fifth partial and the capture records the centroids', () => {
  const reduce = source.slice(source.indexOf('fn pressureResidualReduce('), source.indexOf('fn csPressureResidualBefore('));
  assert.match(reduce, /let partialIndex = 5u \* \(/, 'partial stride is five vec4');
  assert.match(reduce, /heatX = heatValue \* f32\(gid\.x\);/);
  assert.match(reduce, /heatZ = heatValue \* f32\(gid\.z\);/);
  assert.match(reduce, /pressureResidualPartials\[partialIndex \+ 4u\] = vec4<f32>\(heatXSum, heatZSum, smokeXSum, smokeZSum\);/);
  assert.match(source, /profile: residualProfileFromPartials\(partials, \{ grid, workgroupsX, workgroupsY, workgroupCount \}\),/, 'the readback uses the pure fold');
  assert.match(capture, /heatCentroidCells: s\.pressureSolver\.residual\.profile\?\.heatCentroidCells \?\? null/, 'probe carries the centroids');
  assert.match(capture, /heatCentroidCells: probe\.residual\?\.heatCentroidCells \?\? null, heatMean: probe\.residual\?\.heatMean \?\? null/, 'samples carry the centroids and the slab heat that weights them');
});
