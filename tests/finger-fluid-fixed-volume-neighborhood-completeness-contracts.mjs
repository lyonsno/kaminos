import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFingerFluidTruthScenePopulation } from '../finger-fluid-webgpu-core.js';

const source = readFileSync(new URL('../finger-fluid-webgpu-core.js', import.meta.url), 'utf8');
const f32 = Math.fround;
const boundsMin = [f32(-3.4), f32(-1.2), f32(-3.4)];
const boundsMax = [f32(3.4), f32(3.0), f32(3.4)];
const gridDims = [32, 20, 32];
const spans = boundsMin.map((value, axis) => f32(boundsMax[axis] - value));
const cellWidths = spans.map((span, axis) => f32(span / gridDims[axis]));
const kernelRadius = f32(0.185);
const coarsePopulation = createFingerFluidTruthScenePopulation(24_576, 'multi_regime_playground', {
  referenceParticleCount: 36_864,
});
const finePopulation = createFingerFluidTruthScenePopulation(36_864, 'multi_regime_playground', {
  referenceParticleCount: 36_864,
});

function shaderGridCoord(position) {
  return position.map((value, axis) => {
    const normalized = Math.max(0, Math.min(f32(0.999999), f32(f32(value - boundsMin[axis]) / spans[axis])));
    return Math.trunc(f32(normalized * gridDims[axis]));
  });
}

function requiredSearchRange(radiusScale) {
  const supportRadius = f32(kernelRadius * radiusScale);
  return cellWidths.map((cellWidth) => Math.max(1, Math.ceil(f32(supportRadius + f32(cellWidth * f32(0.001))) / cellWidth)));
}

function shaderCellMightContribute(position, neighborCell, radiusScale) {
  const nearest = position.map((value, axis) => {
    const cellMin = f32(boundsMin[axis] + f32(neighborCell[axis] * cellWidths[axis]));
    const cellMax = f32(cellMin + cellWidths[axis]);
    const cellPadding = f32(cellWidths[axis] * f32(0.001));
    const lower = neighborCell[axis] === 0
      ? Math.min(f32(cellMin - cellPadding), value)
      : f32(cellMin - cellPadding);
    const upper = neighborCell[axis] === gridDims[axis] - 1
      ? Math.max(f32(cellMax + cellPadding), value)
      : f32(cellMax + cellPadding);
    return Math.max(lower, Math.min(upper, value));
  });
  const separation = position.map((value, axis) => f32(value - nearest[axis]));
  const squaredDistance = f32(f32(separation[0] * separation[0] + separation[1] * separation[1])
    + separation[2] * separation[2]);
  const supportRadius = f32(kernelRadius * radiusScale);
  return squaredDistance <= f32(supportRadius * supportRadius);
}

function extractFunction(name) {
  const start = source.indexOf(`fn ${name}(`);
  assert.notEqual(start, -1, `shader contains ${name}`);
  const nextCompute = source.indexOf('\n@compute', start);
  const nextFunction = source.indexOf('\nfn ', start + name.length + 4);
  const candidates = [nextCompute, nextFunction].filter(index => index !== -1);
  return source.slice(start, candidates.length === 0 ? source.length : Math.min(...candidates));
}

assert.match(source, /neighborSearchRadiusScale:\s*f32/, 'the uniform carries the maximum radius scale searched by neighbor kernels');
assert.match(source,
  /neighborSearchCellRadius:\s*vec4<u32>/,
  'the uniform carries the precomputed per-axis search range without per-particle division');
assert.match(source,
  /fn neighbor_search_cell_radius\(\) -> vec3<i32>\s*\{\s*return vec3<i32>\(params\.neighborSearchCellRadius\.xyz\);/,
  'all shader walks use the same precomputed per-axis search range');
assert.match(source,
  /const safeNeighborSearchCellRadius = GRID_DIMS\.map[\s\S]*safeKernelRadius[\s\S]*safeNeighborSearchRadiusScale[\s\S]*Math\.ceil[\s\S]*cellWidth/,
  'CPU configuration rounds support outward per axis using the real grid cell width');
assert.match(source,
  /fn neighbor_cell_might_contribute_with_scale\([\s\S]*params\.fluid\.x \* radiusScale[\s\S]*dot\(separation, separation\) <= supportRadius \* supportRadius/,
  'added cells are conservatively filtered by the same padded sphere-versus-cell geometry');

const scaledSupportConsumers = [
  'compute_material_tracer_diffusion',
  'compute_density_lambda',
  'solve_position_delta',
  'classify_free_surface',
  'compute_velocity_viscosity',
  'compute_vorticity',
  'apply_vorticity_confinement',
  'compute_support_particle_shift',
  'estimate_interface_curvature',
  'compact_interface_records',
];
for (const name of scaledSupportConsumers) {
  const body = extractFunction(name);
  assert.match(body, /neighbor_search_cell_radius\(\)/,
    `${name} searches the complete per-axis cell range for scaled kernel support`);
  assert.match(body,
    /neighbor_cell_might_contribute_with_scale\(position, neighborCell, params\.neighborSearchRadiusScale\)/,
    `${name} culls only extra cells that cannot contain a contributing pair`);
  assert.match(body, /while \(current >= 0\)/,
    `${name} traverses the complete linked list without an artificial neighbor cap`);
  assert.match(body, /current = particleNext\[neighborIndex\]/,
    `${name} follows each linked-list successor until the natural end`);
}

// A pair just over one cell width apart can still have positive density weight
// at the 24,576-particle fixed-volume scale, despite occupying cells two apart.
const population = coarsePopulation;
assert.equal(population.particleVolumeScale, 1.5);
const radiusScale = f32(Math.pow(population.particleVolumeScale, 1 / 3));
assert.equal(finePopulation.particleVolumeScale, 1);
assert.deepEqual(requiredSearchRange(f32(Math.pow(finePopulation.particleVolumeScale, 1 / 3))), [1, 1, 1],
  'the reference-resolution population keeps the original 27-cell stencil');
const supportRadius = f32(kernelRadius * radiusScale);
const query = [f32(-1), f32(boundsMin[1] + 10 * cellWidths[1] + cellWidths[1] - 0.001), f32(-1)];
const neighbor = [query[0], f32(boundsMin[1] + 12 * cellWidths[1]), query[2]];
const queryCell = shaderGridCoord(query);
const neighborCell = shaderGridCoord(neighbor);
const separation = f32(neighbor[1] - query[1]);
assert.deepEqual(queryCell.map((value, axis) => value === neighborCell[axis] ? 0 : neighborCell[axis] - value), [0, 2, 0],
  'the adversarial pair is assigned to cells outside the old 27-cell stencil');
assert.ok(separation < supportRadius, 'the adversarial pair lies inside the effective fixed-volume support');
const q = f32(separation / supportRadius);
assert.ok(q < 1 && f32(Math.pow(f32(1 - f32(q * q)), 3)) > 0,
  'the adversarial pair has positive density-kernel weight rather than merely touching support');
const searchRange = requiredSearchRange(radiusScale);
assert.deepEqual(searchRange, [1, 2, 1], 'the support requires a two-cell search only along the narrow grid axis');
assert.ok(neighborCell.every((value, axis) => Math.abs(value - queryCell[axis]) <= searchRange[axis]),
  'the computed search range includes the contributing pair');
assert.ok(shaderCellMightContribute(query, neighborCell, radiusScale),
  'the padded sphere-versus-cell test retains an adversarial contributing cell outside the old stencil');

// Independently bin the real coarse population at the support diameter. A
// pair within support cannot occupy oracle bins more than one apart on an axis;
// compare every such pair with the solver grid's computed search range.
const particleStride = population.particleData.length / population.particleCount;
const positions = Array.from({ length: population.particleCount }, (_, index) => {
  const offset = index * particleStride;
  return [
    population.particleData[offset],
    population.particleData[offset + 1],
    population.particleData[offset + 2],
  ];
});
const oracleCells = new Map();
const cellKey = cell => cell.join(',');
const oracleCoords = positions.map(position => position.map(value => Math.floor(value / supportRadius)));
for (let index = 0; index < positions.length; index += 1) {
  const key = cellKey(oracleCoords[index]);
  const contents = oracleCells.get(key) ?? [];
  contents.push(index);
  oracleCells.set(key, contents);
}

let contributingDirectedPairs = 0;
for (let index = 0; index < positions.length; index += 1) {
  const position = positions[index];
  const oracleCell = oracleCoords[index];
  const solverCell = shaderGridCoord(position);
  for (let z = -1; z <= 1; z += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let x = -1; x <= 1; x += 1) {
        const oracleNeighborCell = [oracleCell[0] + x, oracleCell[1] + y, oracleCell[2] + z];
        for (const neighborIndex of oracleCells.get(cellKey(oracleNeighborCell)) ?? []) {
          if (neighborIndex === index) continue;
          const other = positions[neighborIndex];
          const dx = f32(position[0] - other[0]);
          const dy = f32(position[1] - other[1]);
          const dz = f32(position[2] - other[2]);
          const squaredDistance = f32(f32(dx * dx + dy * dy) + dz * dz);
          if (f32(Math.sqrt(squaredDistance)) >= supportRadius) continue;
          contributingDirectedPairs += 1;
          const otherSolverCell = shaderGridCoord(other);
          const cellDelta = solverCell.map((value, axis) => Math.abs(otherSolverCell[axis] - value));
          assert.ok(cellDelta.every((value, axis) => value <= searchRange[axis]),
            `contributing scene pair ${index}/${neighborIndex} lies inside the shader search range`);
          if (cellDelta.some(value => value > 1)) {
            assert.ok(shaderCellMightContribute(position, otherSolverCell, radiusScale),
              `sphere-versus-cell culling retains contributing scene pair ${index}/${neighborIndex}`);
          }
        }
      }
    }
  }
}
assert.ok(contributingDirectedPairs > 0, 'the actual reduced-count scene has a nonempty support neighborhood');

const paramsSource = source.slice(source.indexOf('function writeSimulationParams'), source.indexOf('function setLiveInletPacket'));
assert.match(source, /label: 'kaminos-finger-fluid-params',[\s\S]*size: 240/,
  'the GPU uniform allocation covers the appended per-axis search range');
assert.match(paramsSource, /const buffer = new ArrayBuffer\(240\)/,
  'the CPU upload covers the appended per-axis search range');
assert.match(paramsSource,
  /view\.setFloat32\(28, safeNeighborSearchRadiusScale, true\)/,
  'the maximum support radius reaches the WGSL uniform ABI');
for (const [offset, axis] of [[224, 0], [228, 1], [232, 2]]) {
  assert.match(paramsSource,
    new RegExp(`view\\.setUint32\\(${offset}, safeNeighborSearchCellRadius\\[${axis}\\], true\\)`),
    `the ${['x', 'y', 'z'][axis]} search range reaches the WGSL uniform ABI`);
}
assert.match(source,
  /const safeNeighborSearchRadiusScale = Math\.max\(1, safeUniformParticleRadiusScale\)/,
  'fixed-volume support is covered even when the density-kernel specialization is disabled');

console.log('Finger Fluid fixed-volume neighborhood completeness contracts passed');
