import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFingerFluidTruthScenePopulation, createWebGPUFingerFluidSolver } from '../finger-fluid-webgpu-core.js';

const shaderSource = readFileSync(new URL('../finger-fluid-webgpu-core.js', import.meta.url), 'utf8');
const browserSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const lambda = shaderSource.match(/fn compute_density_lambda[\s\S]*?(?=@compute @workgroup_size\([^\n]+\)\nfn solve_position_delta)/)?.[0] ?? '';
const delta = shaderSource.match(/fn solve_position_delta[\s\S]*?(?=@compute @workgroup_size\([^\n]+\)\nfn apply_position_delta)/)?.[0] ?? '';

assert.match(shaderSource, /fn density_neighbor_cell_might_contribute\(position: vec3<f32>, neighborCell: vec3<i32>, radiusScale: f32\) -> bool/, 'the candidate-cell predicate is in the actual compute shader');
assert.match(shaderSource, /if \(params\.refinementControl\.y != 0u \|\| params\.refinementControl\.w == 0u\) \{ return true; \}/, 'adaptive refinement and the baseline comparison bypass the uniform-volume cull');
assert.match(shaderSource, /let nearest = clamp\(position, lower, upper\);[\s\S]*return dot\(separation, separation\) <= supportRadius \* supportRadius;/, 'cell rejection uses a padded sphere/AABB distance test');
assert.match(shaderSource, /let cellPadding = cellWidth \* 0\.001;[\s\S]*select\(cellMin - cellPadding/, 'the cell box expands across f32 grid-coordinate rounding');
assert.match(shaderSource, /select\(cellMin - cellPadding, min\(cellMin - cellPadding, position\), neighborCell == vec3<i32>\(0\)\)/, 'minimum edge-cell sides include clamped out-of-domain particles');
assert.match(shaderSource, /select\(cellMax \+ cellPadding, max\(cellMax \+ cellPadding, position\), neighborCell == vec3<i32>\(params\.gridDims\.xyz\) - vec3<i32>\(1\)\)/, 'maximum edge-cell sides include clamped out-of-domain particles');
for (const [name, stage] of [['lambda', lambda], ['correction', delta]]) {
  assert.match(stage, /if \(!density_neighbor_cell_might_contribute\(position, neighborCell, selfRadiusScale\)\) \{ continue; \}[\s\S]*atomicLoad\(&cellHeads\[cellIndex\(neighborCell\)\]\)/, `${name} skips irrelevant cells before following the linked list`);
}
assert.match(shaderSource, /view\.setUint32\(188, safeDensityCellRejection \? 1 : 0, true\)/, 'effective route selection reaches the shader uniform');
assert.ok(browserSource.includes("params.get('finger_fluid_density_cell_rejection')"), 'the browser route exposes the comparison switch');
assert.ok(browserSource.includes('densityCellRejection: fingerFluidBenchConfig.effectiveDensityCellRejection'), 'the browser forwards the effective switch to the solver');
assert.ok(browserSource.includes('effectiveDensityCellRejection: requestedDensityCellRejection && !requestedAdaptiveDensity'), 'adaptive-density route explicitly downgrades the uniform-volume cull');
assert.ok(browserSource.includes('gpuState.effectiveDensityCellRejection = gpuState.densityCellRejection'), 'debug evidence reports the effective route');
assert.match(shaderSource, /const safeDensityCellRejection = densityCellRejection === true && !safeAdaptiveDensity;/, 'direct API marks the adaptive bypass ineffective');
await assert.rejects(createWebGPUFingerFluidSolver({ densityCellRejection: 1 }), /density cell rejection must be a boolean/, 'the direct API rejects a silently downgraded switch');

// f32 grid-coordinate arithmetic can assign a contributing particle just
// outside the reconstructed unpadded AABB. This exact counterexample came
// from the reviewed shader arithmetic, not a double-precision geometry proxy.
const f32 = Math.fround;
const cellWidthF32 = f32(f32(3.4 - -3.4) / 32);
const cellMinF32 = f32(f32(-3.4) + f32(10 * cellWidthF32));
const cellMaxF32 = f32(cellMinF32 + cellWidthF32);
const queryX = f32(-1.4600001573562622);
const neighborX = f32(-1.2750002145767212);
const supportF32 = f32(0.185);
assert.ok(f32(Math.abs(f32(queryX - neighborX))) < supportF32, 'the boundary pair contributes');
assert.ok(f32(cellMinF32 - queryX) > supportF32, 'the unpadded AABB wrongly rejects it');
const paddedMinF32 = f32(cellMinF32 - f32(cellWidthF32 * 0.001));
assert.ok(f32(paddedMinF32 - queryX) < supportF32, 'the padded AABB retains the f32 boundary pair');

// This independent CPU oracle checks the predicate's intended geometry against
// all contributing pairs in the actual initial 49,152-particle scene.
const count = 49_152;
const { particleData } = createFingerFluidTruthScenePopulation(count);
const min = [-3.4, -1.2, -3.4];
const max = [3.4, 3.0, 3.4];
const dims = [32, 20, 32];
const width = min.map((value, axis) => (max[axis] - value) / dims[axis]);
const radius = 0.185;
// The admitted source recycler resets particles above boundsMax.y before
// collideDomain. gridCoord clamps them into the top edge cell, which is
// geometrically unbounded above for a conservative candidate test.
const recycledQuery = [-0.942499995, 3.635862350, -2.582499981];
const recycledNeighbor = [-0.887499988, 3.632549047, -2.582499981];
const recycledCell = [11, 19, 3];
const squared = values => values.reduce((sum, value) => sum + value * value, 0);
assert.ok(squared(recycledQuery.map((value, axis) => value - recycledNeighbor[axis])) < radius ** 2, 'recycled pair contributes');
const edgeDistanceSquared = squared(recycledCell.map((cell, axis) => {
  const lower = min[axis] + cell * width[axis] - width[axis] * 0.001;
  const upper = lower + width[axis] * 1.002;
  const conservativeLower = cell === 0 ? Math.min(lower, recycledQuery[axis]) : lower;
  const conservativeUpper = cell === dims[axis] - 1 ? Math.max(upper, recycledQuery[axis]) : upper;
  return Math.max(conservativeLower - recycledQuery[axis], 0, recycledQuery[axis] - conservativeUpper);
}));
assert.ok(edgeDistanceSquared <= radius ** 2, 'the extended edge cell retains the contributing recycled pair');

const cells = Array.from({ length: dims.reduce((value, dimension) => value * dimension, 1) }, () => []);
const cellIndex = (x, y, z) => x + dims[0] * (y + dims[1] * z);
const coordinates = [];
for (let index = 0; index < count; index += 1) {
  const coord = min.map((value, axis) => Math.max(0, Math.min(dims[axis] - 1, Math.floor((particleData[index * 16 + axis] - value) / width[axis]))));
  coordinates.push(coord);
  cells[cellIndex(...coord)].push(index);
}
let contributors = 0;
let rejectedCandidates = 0;
for (let index = 0; index < count; index += 1) {
  const coord = coordinates[index];
  for (let z = Math.max(0, coord[2] - 1); z <= Math.min(dims[2] - 1, coord[2] + 1); z += 1) {
    for (let y = Math.max(0, coord[1] - 1); y <= Math.min(dims[1] - 1, coord[1] + 1); y += 1) {
      for (let x = Math.max(0, coord[0] - 1); x <= Math.min(dims[0] - 1, coord[0] + 1); x += 1) {
        const c = [x, y, z];
        const distanceSquared = c.reduce((sum, cell, axis) => {
          const lower = min[axis] + cell * width[axis];
          const upper = lower + width[axis];
          const position = particleData[index * 16 + axis];
          return sum + Math.max(lower - position, 0, position - upper) ** 2;
        }, 0);
        const keep = distanceSquared <= radius ** 2;
        for (const neighbor of cells[cellIndex(x, y, z)]) {
          if (neighbor === index) continue;
          if (!keep) rejectedCandidates += 1;
          const pairDistanceSquared = c.reduce((sum, _, axis) => sum + (particleData[index * 16 + axis] - particleData[neighbor * 16 + axis]) ** 2, 0);
          if (pairDistanceSquared < radius ** 2) {
            contributors += 1;
            assert.ok(keep, `contributor ${neighbor} for particle ${index} cannot be culled`);
          }
        }
      }
    }
  }
}
assert.equal(contributors, 6_636_250, 'the fixture has the expected source-derived contributing-pair count');
assert.ok(rejectedCandidates > 17_000_000, 'the candidate cull has a concrete opportunity on the actual scene');
console.log('Finger Fluid density cell rejection contract passed');
