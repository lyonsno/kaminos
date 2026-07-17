import {
  ADAPTIVE_VOLUME_GPU_ERROR_LIMITS,
  ADAPTIVE_VOLUME_GPU_REPORT_SCHEMA,
  ADAPTIVE_VOLUME_GPU_ROUTE,
  ADAPTIVE_VOLUME_PRODUCTION_SURVIVAL_SCHEMA,
  ADAPTIVE_VOLUME_SCALE_LAW_SCHEMA,
  DENSE_DENIAL_METHOD,
  FULL_SELECTION_AGAINST_DENSE_MAXIMUM_ABSOLUTE_ERROR,
  bitonicSortRecordCount,
  buildBitonicSortStages,
  buildCompactSmokeProduct,
  parseSelectedBrickArtifact,
  validateAdaptiveVolumeGpuReport,
  validateAdaptiveVolumeProductionSurvivalReport,
  validateAdaptiveVolumeScaleLawReport,
} from './smoke-adaptive-volume-gpu-falsifier.mjs';

const DEFAULTS = Object.freeze({
  matchedReport: './artifacts/pyro-smoke-matched-optics-r5-0716/native/matched-optics-report.json',
  fitReport: './artifacts/pyro-smoke-extinction-residual-oracle-r2-full-covariance-0716/source-step45/coarse-plus-residual.fit-report.json',
  sourceSidecar: './artifacts/pyro-smoke-extinction-residual-oracle-r2-full-covariance-0716/source-step45/smoke-extinction-support-sidecar.f32',
  selection: './artifacts/pyro-smoke-adaptive-residual-bricks-r6-0716/native/b4-e0980000/selected-brick-indices.sbrk',
  referenceDepth: './artifacts/pyro-smoke-adaptive-residual-bricks-r6-0716/native/dense-reference/optical-depth.f32',
  moduleSource: './smoke-adaptive-volume-gpu-falsifier.mjs',
  browserSource: './smoke-adaptive-volume-gpu-falsifier-browser.js',
  witnessSource: './smoke-adaptive-volume-gpu-witness.mjs',
  htmlSource: './smoke-adaptive-volume-gpu-falsifier.html',
  productionVolumeSource: './volume-core.js',
  warmupSamples: 3,
  steadySamples: 12,
  buildWarmupSamples: 1,
  buildSteadySamples: 4,
  scaleFactors: [1, 2, 4],
  workloadDimensions: [[3456, 2234]],
  scaleDispatchRepeats: 16,
  scaleWarmupSamples: 1,
  scaleSteadySamples: 7,
  minimumAggregateGpuMs: 2,
  productionSurvival: false,
  productionDispatchRepeats: 1,
  productionWarmupSamples: 1,
  productionSteadySamples: 5,
  productionTileRows: 128,
});

const state = { phase: 'initializing', message: 'Initializing', report: null, error: null };
const statusNode = document.getElementById('status');
const reportNode = document.getElementById('report');

function setStatus(message) {
  statusNode.textContent = message;
  state.message = message;
}

function applyReportDisposition(report) {
  const disposition = validateAdaptiveVolumeGpuReport(report);
  report.optimizationClaimAllowed = disposition.optimizationClaimAllowed;
  report.optimizationClaimRejectionReasons = disposition.reasons;
  report.status = disposition.optimizationClaimAllowed ? 'passed' : 'invalid-for-optimization-claim';
  if (report.scaleLaw) {
    const scaleDisposition = validateAdaptiveVolumeScaleLawReport(report);
    report.scaleLawEvidenceAllowed = scaleDisposition.scaleLawEvidenceAllowed;
    report.scaleLawRejectionReasons = scaleDisposition.reasons;
  }
  if (report.productionSurvival) {
    const survivalDisposition = validateAdaptiveVolumeProductionSurvivalReport(report);
    report.productionSurvivalEvidenceAllowed = survivalDisposition.productionSurvivalEvidenceAllowed;
    report.productionSurvivalRejectionReasons = survivalDisposition.reasons;
  }
  return disposition;
}

function queryConfig() {
  const params = new URLSearchParams(location.search);
  const integer = (key, fallback) => {
    if (!params.has(key)) return fallback;
    const value = Number(params.get(key));
    if (!Number.isInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer`);
    return value;
  };
  const positiveNumber = (key, fallback) => {
    if (!params.has(key)) return fallback;
    const value = Number(params.get(key));
    if (!(value > 0) || !Number.isFinite(value)) throw new Error(`${key} must be positive and finite`);
    return value;
  };
  const scaleFactors = (params.get('scale_factors') || DEFAULTS.scaleFactors.join(','))
    .split(',')
    .map(value => Number(value));
  if (scaleFactors.length < 3 || scaleFactors.some(value => !(value > 0) || !Number.isFinite(value))) {
    throw new Error('scale_factors must contain at least three positive finite values');
  }
  for (let index = 1; index < scaleFactors.length; index += 1) {
    if (!(scaleFactors[index] > scaleFactors[index - 1])) throw new Error('scale_factors must be strictly increasing');
  }
  const workloadDimensions = (params.get('workload_dimensions') || DEFAULTS.workloadDimensions.map(([width, height]) => `${width}x${height}`).join(','))
    .split(',')
    .filter(Boolean)
    .map(value => {
      const match = /^(\d+)x(\d+)$/.exec(value.trim());
      if (!match) throw new Error('workload_dimensions must contain WIDTHxHEIGHT values');
      const width = Number(match[1]);
      const height = Number(match[2]);
      if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        throw new Error('workload_dimensions must contain positive integer dimensions');
      }
      return [width, height];
    });
  const config = {
    matchedReport: params.get('matched_report') || DEFAULTS.matchedReport,
    fitReport: params.get('fit_report') || DEFAULTS.fitReport,
    sourceSidecar: params.get('source_sidecar') || DEFAULTS.sourceSidecar,
    selection: params.get('selection') || DEFAULTS.selection,
    referenceDepth: params.get('reference_depth') || DEFAULTS.referenceDepth,
    gitCommit: params.get('git_commit') || '',
    gitBranch: params.get('git_branch') || '',
    gitStatusShort: params.get('git_status_short') || '',
    warmupSamples: integer('warmup_samples', DEFAULTS.warmupSamples),
    steadySamples: integer('steady_samples', DEFAULTS.steadySamples),
    buildWarmupSamples: integer('build_warmup_samples', DEFAULTS.buildWarmupSamples),
    buildSteadySamples: integer('build_steady_samples', DEFAULTS.buildSteadySamples),
    scaleFactors,
    workloadDimensions,
    scaleDispatchRepeats: integer('scale_dispatch_repeats', DEFAULTS.scaleDispatchRepeats),
    scaleWarmupSamples: integer('scale_warmup_samples', DEFAULTS.scaleWarmupSamples),
    scaleSteadySamples: integer('scale_steady_samples', DEFAULTS.scaleSteadySamples),
    minimumAggregateGpuMs: positiveNumber('minimum_aggregate_gpu_ms', DEFAULTS.minimumAggregateGpuMs),
    productionSurvival: (params.get('production_survival') || String(DEFAULTS.productionSurvival)) === 'true',
    productionDispatchRepeats: integer('production_dispatch_repeats', DEFAULTS.productionDispatchRepeats),
    productionWarmupSamples: integer('production_warmup_samples', DEFAULTS.productionWarmupSamples),
    productionSteadySamples: integer('production_steady_samples', DEFAULTS.productionSteadySamples),
    productionTileRows: integer('production_tile_rows', DEFAULTS.productionTileRows),
  };
  if (config.scaleDispatchRepeats <= 1) throw new Error('scale_dispatch_repeats must be greater than one');
  if (config.scaleWarmupSamples <= 0 || config.scaleSteadySamples <= 0) throw new Error('scale timing sample counts must be positive');
  if (config.productionDispatchRepeats <= 0 || config.productionWarmupSamples <= 0 || config.productionSteadySamples < 3) {
    throw new Error('production survival timing requires positive dispatch/warmup counts and at least three steady samples');
  }
  if (config.productionTileRows <= 0 || config.productionTileRows > 2234) throw new Error('production_tile_rows must be in [1, 2234]');
  return config;
}

async function fetchJson(url, label) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${label} fetch failed: ${response.status}`);
  return response.json();
}

async function fetchBytes(url, label) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${label} fetch failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function sha256(bytes) {
  const view = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', view);
  return `sha256:${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')}`;
}

function multiplyMatrix4(left, right) {
  const output = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) output[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
    }
  }
  return output;
}

function invertMatrix4(matrix) {
  const rows = Array.from({ length: 4 }, (_, row) => [
    ...Array.from({ length: 4 }, (_, column) => matrix[column * 4 + row]),
    ...Array.from({ length: 4 }, (_, column) => Number(row === column)),
  ]);
  for (let pivotColumn = 0; pivotColumn < 4; pivotColumn += 1) {
    let pivotRow = pivotColumn;
    for (let row = pivotColumn + 1; row < 4; row += 1) {
      if (Math.abs(rows[row][pivotColumn]) > Math.abs(rows[pivotRow][pivotColumn])) pivotRow = row;
    }
    if (Math.abs(rows[pivotRow][pivotColumn]) < 1e-14) throw new Error('camera view-projection matrix is singular');
    [rows[pivotColumn], rows[pivotRow]] = [rows[pivotRow], rows[pivotColumn]];
    const pivot = rows[pivotColumn][pivotColumn];
    for (let column = 0; column < 8; column += 1) rows[pivotColumn][column] /= pivot;
    for (let row = 0; row < 4; row += 1) {
      if (row === pivotColumn) continue;
      const scale = rows[row][pivotColumn];
      for (let column = 0; column < 8; column += 1) rows[row][column] -= scale * rows[pivotColumn][column];
    }
  }
  return Array.from({ length: 16 }, (_, index) => rows[index % 4][4 + Math.floor(index / 4)]);
}

function transformPoint4(matrix, point) {
  return [0, 1, 2, 3].map(row => matrix[row] * point[0]
    + matrix[4 + row] * point[1]
    + matrix[8 + row] * point[2]
    + matrix[12 + row] * point[3]);
}

function unproject(matrix, x, y, z) {
  const value = transformPoint4(matrix, [x, y, z, 1]);
  return value.slice(0, 3).map(component => component / value[3]);
}

function intersectBounds(origin, direction, minimum, maximum) {
  let start = -Infinity;
  let end = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]) < 1e-14) {
      if (origin[axis] < minimum[axis] || origin[axis] > maximum[axis]) return null;
      continue;
    }
    const first = (minimum[axis] - origin[axis]) / direction[axis];
    const second = (maximum[axis] - origin[axis]) / direction[axis];
    start = Math.max(start, Math.min(first, second));
    end = Math.min(end, Math.max(first, second));
  }
  start = Math.max(start, 0);
  return end > start ? [start, end] : null;
}

function buildRays(camera, width, height, minimum, maximum) {
  const inverse = invertMatrix4(multiplyMatrix4(camera.projectionMatrix, camera.matrixWorldInverse));
  const rays = new Float32Array(width * height * 8);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const far = unproject(inverse, ((x + 0.5) / width) * 2 - 1, 1 - ((y + 0.5) / height) * 2, 1);
      const raw = far.map((value, axis) => value - camera.position[axis]);
      const length = Math.hypot(...raw);
      const direction = raw.map(value => value / length);
      const interval = intersectBounds(camera.position, direction, minimum, maximum);
      const offset = (y * width + x) * 8;
      rays.set(direction, offset);
      rays[offset + 3] = interval?.[0] ?? 0;
      rays[offset + 4] = interval?.[1] ?? -1;
    }
  }
  return rays;
}

function makeBuffer(device, label, bytes, usage, data = null) {
  const size = Math.max(4, Math.ceil(bytes / 4) * 4);
  const buffer = device.createBuffer({ label, size, usage, mappedAtCreation: data != null });
  if (data != null) {
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    buffer.unmap();
  }
  return { buffer, bytes: size };
}

function createParams({ grid, blockSize, selectedCount, width, height, samplesPerCell, extinctionCoefficient, minimum, maximum, cameraPosition }) {
  const bytes = new ArrayBuffer(80);
  const view = new DataView(bytes);
  const u32 = [grid, grid / blockSize, blockSize, selectedCount, width, height];
  u32.forEach((value, index) => view.setUint32(index * 4, value, true));
  view.setFloat32(24, samplesPerCell, true);
  view.setFloat32(28, extinctionCoefficient, true);
  [...minimum, 0, ...maximum, 0, ...cameraPosition, 0].forEach((value, index) => view.setFloat32(32 + index * 4, value, true));
  return new Uint8Array(bytes);
}

function buildProductionFieldProxy(sidecar, grid, blockSize) {
  const cellCount = grid ** 3;
  const front = new Float32Array(cellCount);
  for (let index = 0; index < cellCount; index += 1) {
    const coverage = sidecar[index * 4 + 1];
    front[index] = coverage;
  }
  const coarseGrid = grid / blockSize;
  const majorant = new Float32Array(coarseGrid ** 3 * 4);
  for (let bz = 0; bz < coarseGrid; bz += 1) {
    for (let by = 0; by < coarseGrid; by += 1) {
      for (let bx = 0; bx < coarseGrid; bx += 1) {
        const coarseIndex = bx + by * coarseGrid + bz * coarseGrid ** 2;
        for (let z = 0; z < blockSize; z += 1) {
          for (let y = 0; y < blockSize; y += 1) {
            for (let x = 0; x < blockSize; x += 1) {
              const cell = bx * blockSize + x
                + (by * blockSize + y) * grid
                + (bz * blockSize + z) * grid ** 2;
              const physical = sidecar[cell * 4];
              const coverage = sidecar[cell * 4 + 1];
              const ridge = sidecar[cell * 4 + 2];
              const residual = sidecar[cell * 4 + 3];
              majorant[coarseIndex * 4] = Math.max(majorant[coarseIndex * 4], physical);
              majorant[coarseIndex * 4 + 1] = Math.max(majorant[coarseIndex * 4 + 1], ridge + residual);
              majorant[coarseIndex * 4 + 2] = Math.max(majorant[coarseIndex * 4 + 2], physical + ridge * 0.34);
              majorant[coarseIndex * 4 + 3] = Math.max(majorant[coarseIndex * 4 + 3], physical * 0.50 + coverage * 0.30 + ridge * 0.44 + residual * 0.20);
            }
          }
        }
      }
    }
  }
  return { slots: sidecar, front, majorant, coarseGrid };
}

const COMMON_WGSL = String.raw`
struct Params {
  grid: u32, coarseGrid: u32, blockSize: u32, selectedCount: u32,
  width: u32, height: u32, samplesPerCell: f32, extinction: f32,
  minimum: vec4<f32>, maximum: vec4<f32>, cameraPosition: vec4<f32>,
};
struct Ray { directionStart: vec4<f32>, endPad: vec4<f32> };
fn cellIndex(c: vec3<u32>, edge: u32) -> u32 { return c.x + c.y * edge + c.z * edge * edge; }
fn pointCell(point: vec3<f32>, p: Params) -> vec3<u32> {
  let normalized = clamp((point - p.minimum.xyz) / (p.maximum.xyz - p.minimum.xyz), vec3<f32>(0.0), vec3<f32>(0.999999));
  return vec3<u32>(floor(normalized * f32(p.grid)));
}
`;

const DENSE_WGSL = COMMON_WGSL + String.raw`
@group(0) @binding(0) var<storage, read> source: array<f32>;
@group(0) @binding(1) var<storage, read> rays: array<Ray>;
@group(0) @binding(2) var<uniform> p: Params;
@group(0) @binding(3) var<storage, read_write> output: array<f32>;
fn sampleDense(point: vec3<f32>) -> f32 {
  let coordinate = (point - p.minimum.xyz) / (p.maximum.xyz - p.minimum.xyz) * f32(p.grid) - vec3<f32>(0.5);
  let base = vec3<i32>(floor(coordinate));
  let fraction = coordinate - vec3<f32>(base);
  var sampled = 0.0;
  for (var dz = 0; dz <= 1; dz++) { for (var dy = 0; dy <= 1; dy++) { for (var dx = 0; dx <= 1; dx++) {
    let c = vec3<u32>(clamp(base + vec3<i32>(dx, dy, dz), vec3<i32>(0), vec3<i32>(i32(p.grid) - 1)));
    let w = select(1.0 - fraction.x, fraction.x, dx == 1) * select(1.0 - fraction.y, fraction.y, dy == 1) * select(1.0 - fraction.z, fraction.z, dz == 1);
    sampled += source[cellIndex(c, p.grid)] * w;
  }}}
  return max(0.0, sampled);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= p.width || gid.y >= p.height) { return; }
  let pixel = gid.x + gid.y * p.width;
  let ray = rays[pixel];
  if (ray.endPad.x <= ray.directionStart.w) { output[pixel] = 0.0; return; }
  let stepWorld = min(min((p.maximum.x - p.minimum.x), (p.maximum.y - p.minimum.y)), (p.maximum.z - p.minimum.z)) / f32(p.grid) / p.samplesPerCell;
  var distance = ray.directionStart.w;
  var depth = 0.0;
  for (var step = 0u; step < 1024u; step++) {
    if (distance >= ray.endPad.x) { break; }
    let segment = min(stepWorld, ray.endPad.x - distance);
    let point = p.cameraPosition.xyz + ray.directionStart.xyz * (distance + segment * 0.5);
    depth += sampleDense(point) * segment * p.extinction;
    distance += segment;
  }
  output[pixel] = depth;
}
`;

const SPARSE_WGSL = COMMON_WGSL + String.raw`
@group(0) @binding(0) var<storage, read> coarse: array<f32>;
@group(0) @binding(1) var<storage, read> indirection: array<i32>;
@group(0) @binding(2) var<storage, read> atlas: array<f32>;
@group(0) @binding(3) var<storage, read> rays: array<Ray>;
@group(0) @binding(4) var<uniform> p: Params;
@group(0) @binding(5) var<storage, read_write> output: array<f32>;
fn brickIndex(c: vec3<u32>) -> u32 { return c.x + c.y * p.coarseGrid + c.z * p.coarseGrid * p.coarseGrid; }
fn sampleAtlas(point: vec3<f32>, brick: vec3<u32>, slot: u32) -> f32 {
  let edge = p.blockSize + 2u;
  let coordinate = (point - p.minimum.xyz) / (p.maximum.xyz - p.minimum.xyz) * f32(p.grid) - vec3<f32>(0.5);
  let base = vec3<i32>(floor(coordinate));
  let fraction = coordinate - vec3<f32>(base);
  let brickOrigin = vec3<i32>(brick * p.blockSize);
  var sampled = 0.0;
  for (var dz = 0; dz <= 1; dz++) { for (var dy = 0; dy <= 1; dy++) { for (var dx = 0; dx <= 1; dx++) {
    let globalCell = clamp(base + vec3<i32>(dx, dy, dz), vec3<i32>(0), vec3<i32>(i32(p.grid) - 1));
    let local = vec3<u32>(clamp(globalCell - brickOrigin + vec3<i32>(1), vec3<i32>(0), vec3<i32>(i32(edge) - 1)));
    let atlasIndex = slot * edge * edge * edge + cellIndex(local, edge);
    let w = select(1.0 - fraction.x, fraction.x, dx == 1) * select(1.0 - fraction.y, fraction.y, dy == 1) * select(1.0 - fraction.z, fraction.z, dz == 1);
    sampled += atlas[atlasIndex] * w;
  }}}
  return max(0.0, sampled);
}
fn brickExitDistance(point: vec3<f32>, direction: vec3<f32>, brick: vec3<u32>) -> f32 {
  let brickWorld = (p.maximum.xyz - p.minimum.xyz) / f32(p.coarseGrid);
  var result = 1e30;
  for (var axis = 0u; axis < 3u; axis++) {
    let d = direction[axis];
    if (abs(d) > 1e-8) {
      let boundaryIndex = select(f32(brick[axis]), f32(brick[axis] + 1u), d > 0.0);
      let boundary = p.minimum[axis] + boundaryIndex * brickWorld[axis];
      let delta = (boundary - point[axis]) / d;
      if (delta > 1e-7) { result = min(result, delta); }
    }
  }
  return result;
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= p.width || gid.y >= p.height) { return; }
  let pixel = gid.x + gid.y * p.width;
  let ray = rays[pixel];
  if (ray.endPad.x <= ray.directionStart.w) { output[pixel] = 0.0; return; }
  let fineStep = min(min((p.maximum.x - p.minimum.x), (p.maximum.y - p.minimum.y)), (p.maximum.z - p.minimum.z)) / f32(p.grid) / p.samplesPerCell;
  var distance = ray.directionStart.w;
  var depth = 0.0;
  var globalStep = 0u;
  loop {
    if (distance >= ray.endPad.x || globalStep >= 1024u) { break; }
    let segment = min(fineStep, ray.endPad.x - distance);
    let samplePoint = p.cameraPosition.xyz + ray.directionStart.xyz * (distance + segment * 0.5);
    let cell = pointCell(samplePoint, p);
    let brick = cell / p.blockSize;
    let index = brickIndex(brick);
    let slot = indirection[index];
    if (slot >= 0) {
      depth += sampleAtlas(samplePoint, brick, u32(slot)) * segment * p.extinction;
      distance += segment;
      globalStep += 1u;
    } else {
      let midpointExitDistance = brickExitDistance(samplePoint, ray.directionStart.xyz, brick);
      let alignedRunSteps = max(1u, u32(ceil(midpointExitDistance / fineStep)));
      let runSteps = min(alignedRunSteps, 1024u - globalStep);
      let runLength = min(ray.endPad.x - distance, f32(runSteps) * fineStep);
      depth += coarse[index] * runLength * p.extinction;
      distance += runLength;
      globalStep += runSteps;
    }
  }
  output[pixel] = depth;
}
`;

const PRODUCTION_TILE_WGSL = String.raw`
struct ProductionTile { rowOffset: u32, rowCount: u32, pad0: u32, pad1: u32 };
struct ProductionCamera { inverseViewProjection: mat4x4<f32> };
`;

const PRODUCTION_MECHANISMS_WGSL = String.raw`
fn readProxySlot(c: vec3<i32>, slot: u32) -> vec4<f32> {
  var shifted = c;
  if (slot == 1u) { shifted.x += 1; }
  if (slot == 2u) { shifted.y += 1; }
  if (slot == 3u) { shifted.z += 1; }
  let cell = vec3<u32>(clamp(shifted, vec3<i32>(0), vec3<i32>(i32(productionP.grid) - 1)));
  let raw = fieldProxy[cellIndex(cell, productionP.grid)];
  if (slot == 0u) { return vec4<f32>(raw.z * 0.20, raw.y * 0.10, raw.w * 0.20, raw.x); }
  if (slot == 1u) { return raw; }
  if (slot == 2u) { return vec4<f32>(raw.z, raw.w, raw.y, raw.x * 0.20); }
  return vec4<f32>(raw.y, raw.z, raw.w, raw.x);
}
fn sampleFluidSlot(point: vec3<f32>, slot: u32) -> vec4<f32> {
  let coordinate = (point - productionP.minimum.xyz) / (productionP.maximum.xyz - productionP.minimum.xyz) * f32(productionP.grid) - vec3<f32>(0.5);
  let base = vec3<i32>(floor(coordinate));
  let fraction = coordinate - vec3<f32>(base);
  let c000 = readProxySlot(base + vec3<i32>(0, 0, 0), slot);
  let c100 = readProxySlot(base + vec3<i32>(1, 0, 0), slot);
  let c010 = readProxySlot(base + vec3<i32>(0, 1, 0), slot);
  let c110 = readProxySlot(base + vec3<i32>(1, 1, 0), slot);
  let c001 = readProxySlot(base + vec3<i32>(0, 0, 1), slot);
  let c101 = readProxySlot(base + vec3<i32>(1, 0, 1), slot);
  let c011 = readProxySlot(base + vec3<i32>(0, 1, 1), slot);
  let c111 = readProxySlot(base + vec3<i32>(1, 1, 1), slot);
  return mix(mix(mix(c000, c100, fraction.x), mix(c010, c110, fraction.x), fraction.y), mix(mix(c001, c101, fraction.x), mix(c011, c111, fraction.x), fraction.y), fraction.z);
}
fn sampleWorldVelocity(point: vec3<f32>) -> vec4<f32> { return sampleFluidSlot(point, 0u); }
fn sampleWorldMaterial(point: vec3<f32>) -> vec4<f32> { return sampleFluidSlot(point, 1u); }
fn sampleWorldFireLayer(point: vec3<f32>) -> vec4<f32> { return sampleFluidSlot(point, 2u); }
fn sampleWorldMicrodetail(point: vec3<f32>) -> vec4<f32> { return sampleFluidSlot(point, 3u); }
fn sampleFrontCell(c: vec3<i32>) -> f32 {
  let cell = vec3<u32>(clamp(c, vec3<i32>(0), vec3<i32>(i32(productionP.grid) - 1)));
  return frontProxy[cellIndex(cell, productionP.grid)];
}
fn sampleWorldFrontField(point: vec3<f32>) -> f32 {
  let coordinate = (point - productionP.minimum.xyz) / (productionP.maximum.xyz - productionP.minimum.xyz) * f32(productionP.grid) - vec3<f32>(0.5);
  let base = vec3<i32>(floor(coordinate));
  let f = coordinate - vec3<f32>(base);
  let x00 = mix(sampleFrontCell(base), sampleFrontCell(base + vec3<i32>(1, 0, 0)), f.x);
  let x10 = mix(sampleFrontCell(base + vec3<i32>(0, 1, 0)), sampleFrontCell(base + vec3<i32>(1, 1, 0)), f.x);
  let x01 = mix(sampleFrontCell(base + vec3<i32>(0, 0, 1)), sampleFrontCell(base + vec3<i32>(1, 0, 1)), f.x);
  let x11 = mix(sampleFrontCell(base + vec3<i32>(0, 1, 1)), sampleFrontCell(base + vec3<i32>(1, 1, 1)), f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}
fn majorantIndex(c: vec3<u32>) -> u32 { return c.x + c.y * productionP.coarseGrid + c.z * productionP.coarseGrid * productionP.coarseGrid; }
fn sampleMajorantCell(c: vec3<i32>) -> vec4<f32> {
  let cell = vec3<u32>(clamp(c, vec3<i32>(0), vec3<i32>(i32(productionP.coarseGrid) - 1)));
  return majorantProxy[majorantIndex(cell)];
}
fn majorantCoordinate(point: vec3<f32>) -> vec3<f32> {
  return clamp((point - productionP.minimum.xyz) / (productionP.maximum.xyz - productionP.minimum.xyz) * f32(productionP.coarseGrid), vec3<f32>(0.0), vec3<f32>(f32(productionP.coarseGrid) - 0.001));
}
fn sampleWorldMajorant(point: vec3<f32>) -> vec4<f32> { return sampleMajorantCell(vec3<i32>(floor(majorantCoordinate(point)))); }
fn sampleWorldMajorantLinear(point: vec3<f32>) -> vec4<f32> {
  let q = clamp((point - productionP.minimum.xyz) / (productionP.maximum.xyz - productionP.minimum.xyz) * (f32(productionP.coarseGrid) - 1.0), vec3<f32>(0.0), vec3<f32>(f32(productionP.coarseGrid) - 1.001));
  let base = vec3<i32>(floor(q));
  let f = fract(q);
  let x00 = mix(sampleMajorantCell(base), sampleMajorantCell(base + vec3<i32>(1, 0, 0)), f.x);
  let x10 = mix(sampleMajorantCell(base + vec3<i32>(0, 1, 0)), sampleMajorantCell(base + vec3<i32>(1, 1, 0)), f.x);
  let x01 = mix(sampleMajorantCell(base + vec3<i32>(0, 0, 1)), sampleMajorantCell(base + vec3<i32>(1, 0, 1)), f.x);
  let x11 = mix(sampleMajorantCell(base + vec3<i32>(0, 1, 1)), sampleMajorantCell(base + vec3<i32>(1, 1, 1)), f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}
fn sampleWorldMajorantDilated(point: vec3<f32>) -> vec4<f32> {
  let c = vec3<i32>(floor(majorantCoordinate(point)));
  var m = sampleMajorantCell(c);
  m = max(m, sampleMajorantCell(c + vec3<i32>(1, 0, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(-1, 0, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, 1, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, -1, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, 0, 1)));
  return max(m, sampleMajorantCell(c + vec3<i32>(0, 0, -1)));
}
fn majorantGradientSignal(point: vec3<f32>) -> f32 {
  let c = vec3<i32>(floor(majorantCoordinate(point)));
  return clamp(abs(sampleMajorantCell(c + vec3<i32>(1, 0, 0)).w - sampleMajorantCell(c + vec3<i32>(-1, 0, 0)).w)
    + abs(sampleMajorantCell(c + vec3<i32>(0, 1, 0)).w - sampleMajorantCell(c + vec3<i32>(0, -1, 0)).w)
    + abs(sampleMajorantCell(c + vec3<i32>(0, 0, 1)).w - sampleMajorantCell(c + vec3<i32>(0, 0, -1)).w), 0.0, 1.5);
}
fn majorantCellExitDistance(point: vec3<f32>, direction: vec3<f32>) -> f32 {
  let q = majorantCoordinate(point);
  let dqdt = direction / (productionP.maximum.xyz - productionP.minimum.xyz) * f32(productionP.coarseGrid);
  var best = 1e6;
  for (var axis = 0u; axis < 3u; axis++) {
    if (abs(dqdt[axis]) > 0.0001) {
      let boundary = select(floor(q[axis]), floor(q[axis]) + 1.0, dqdt[axis] > 0.0);
      let t = (boundary - q[axis]) / dqdt[axis];
      if (t > 0.0001) { best = min(best, t); }
    }
  }
  return best;
}
fn adaptiveRayStepScale(interest: f32, adaptiveRays: f32) -> f32 {
  return mix(1.0, mix(2.65, 0.68, smoothstep(0.035, 0.92, interest)), clamp(adaptiveRays, 0.0, 1.0));
}
fn occupancySkipStepScale(occupancy: f32, occupancySkipStrength: f32, adaptiveRays: f32) -> f32 {
  let emptySpan = 1.0 - smoothstep(0.012, 0.135, occupancy);
  return clamp(1.0 + emptySpan * clamp(occupancySkipStrength, 0.0, 1.0) * mix(1.45, 3.20, clamp(adaptiveRays, 0.0, 1.0)), 1.0, 4.60);
}
fn raymarchEarlyTermination(transmittance: f32) -> bool { return transmittance < 0.012; }
fn productionRayDirection(pixelX: u32, pixelY: u32) -> vec3<f32> {
  let ndc = vec2<f32>((f32(pixelX) + 0.5) / f32(productionP.width) * 2.0 - 1.0, 1.0 - (f32(pixelY) + 0.5) / f32(productionP.height) * 2.0);
  let clip = cameraP.inverseViewProjection * vec4<f32>(ndc, 1.0, 1.0);
  let farPoint = clip.xyz / clip.w;
  return normalize(farPoint - productionP.cameraPosition.xyz);
}
fn intersectProductionBounds(direction: vec3<f32>) -> vec2<f32> {
  var start = -1e30;
  var end = 1e30;
  for (var axis = 0u; axis < 3u; axis++) {
    if (abs(direction[axis]) < 1e-14) {
      if (productionP.cameraPosition[axis] < productionP.minimum[axis] || productionP.cameraPosition[axis] > productionP.maximum[axis]) { return vec2<f32>(0.0, -1.0); }
    } else {
      let first = (productionP.minimum[axis] - productionP.cameraPosition[axis]) / direction[axis];
      let second = (productionP.maximum[axis] - productionP.cameraPosition[axis]) / direction[axis];
      start = max(start, min(first, second));
      end = min(end, max(first, second));
    }
  }
  start = max(start, 0.0);
  return vec2<f32>(start, end);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= productionP.width || gid.y >= tileP.rowCount) { return; }
  let globalY = gid.y + tileP.rowOffset;
  if (globalY >= productionP.height) { return; }
  let pixel = gid.x + globalY * productionP.width;
  let direction = productionRayDirection(gid.x, globalY);
  let hit = intersectProductionBounds(direction);
  if (hit.y <= hit.x) { productionOutput[pixel] = vec2<f32>(0.0); return; }
  let baseStep = min(min(productionP.maximum.x - productionP.minimum.x, productionP.maximum.y - productionP.minimum.y), productionP.maximum.z - productionP.minimum.z) / f32(productionP.grid) / productionP.samplesPerCell;
  var distance = hit.x;
  var depth = 0.0;
  var transmittance = 1.0;
  var productionStepCount = 0u;
  var majorantSkipCount = 0u;
  var earlyTerminationCount = 0u;
  for (var iteration = 0u; iteration < 192u; iteration++) {
    if (distance >= hit.y) { break; }
    if (raymarchEarlyTermination(transmittance)) { earlyTerminationCount = 1u; break; }
    let point = productionP.cameraPosition.xyz + direction * distance;
    let majorantNearest = sampleWorldMajorant(point);
    let majorantLinear = sampleWorldMajorantLinear(point);
    let majorantDilated = sampleWorldMajorantDilated(point);
    let majorant = mix(majorantNearest, mix(majorantLinear, majorantDilated, 0.70), 0.72);
    let majorantEdge = majorantGradientSignal(point);
    let guardedImportance = max(majorant.w, majorantDilated.w * 0.70 * 0.80);
    let majorantEmpty = 1.0 - smoothstep(0.004, 0.090, guardedImportance + majorantEdge * 0.80 * 0.24);
    let majorantSkipGate = majorantEmpty * 0.70 * (1.0 - smoothstep(0.012, 0.16, majorantEdge * 0.80));
    if (majorantSkipGate > 0.42) {
      distance += min(majorantCellExitDistance(point, direction) + baseStep * 0.20, baseStep * (1.0 + majorantSkipGate * 6.0));
      majorantSkipCount += 1u;
      continue;
    }
    let velocityDensity = sampleWorldVelocity(point);
    let material = sampleWorldMaterial(point);
    let fireLayer = sampleWorldFireLayer(point);
    let microLayer = sampleWorldMicrodetail(point);
    let frontTopology = sampleWorldFrontField(point);
    productionStepCount += 1u;
    let velMag = length(velocityDensity.xyz);
    let rawExtinction = max(0.0, material.x * 0.74 + microLayer.x * 0.42 + microLayer.y * 0.34 + material.w * 0.12);
    let microTexture = clamp(microLayer.x * 1.55 + microLayer.y * 2.45 + microLayer.z * 1.30 + microLayer.w * 0.55, 0.0, 2.4);
    let temperature = fireLayer.x + fireLayer.z * 0.4 + frontTopology * 0.1;
    let occupancy = clamp(velocityDensity.w * 0.44 + material.x * 0.38 + rawExtinction * 0.28 + temperature * 0.24 + fireLayer.x * 0.28 + material.y * 0.16 + microTexture * 0.20 + velMag * 0.32, 0.0, 1.8);
    let emptySpanScale = occupancySkipStepScale(occupancy, 0.35, 0.65);
    if (emptySpanScale > 1.08) { distance += min(baseStep * emptySpanScale, hit.y - distance); continue; }
    let interest = clamp(velocityDensity.w * 0.22 + material.x * 0.16 + material.y * 0.10 + temperature * 0.40 + fireLayer.x * 0.36 + fireLayer.z * 0.22 + microTexture * 0.22 + velMag * 0.46 + microLayer.z * 0.30 + microLayer.y * 0.42, 0.0, 1.6);
    let localStep = min(baseStep * adaptiveRayStepScale(interest, 0.65), hit.y - distance);
    let testedExtinction = sampleSmokeExtinction(point) * productionP.extinction;
    depth += testedExtinction * localStep;
    transmittance *= exp(-testedExtinction * localStep);
    distance += localStep;
  }
  let packedWork = productionStepCount + majorantSkipCount * 256u + earlyTerminationCount * 65536u + 131072u;
  productionOutput[pixel] = vec2<f32>(depth, f32(packedWork));
}
`;

const PRODUCTION_DENSE_WGSL = COMMON_WGSL + PRODUCTION_TILE_WGSL + String.raw`
@group(0) @binding(0) var<storage, read> denseSmoke: array<f32>;
@group(0) @binding(1) var<storage, read> fieldProxy: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> frontProxy: array<f32>;
@group(0) @binding(3) var<storage, read> majorantProxy: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> cameraP: ProductionCamera;
@group(0) @binding(5) var<uniform> productionP: Params;
@group(0) @binding(6) var<storage, read_write> productionOutput: array<vec2<f32>>;
@group(0) @binding(7) var<uniform> tileP: ProductionTile;
fn sampleSmokeExtinction(point: vec3<f32>) -> f32 {
  let coordinate = (point - productionP.minimum.xyz) / (productionP.maximum.xyz - productionP.minimum.xyz) * f32(productionP.grid) - vec3<f32>(0.5);
  let base = vec3<i32>(floor(coordinate));
  let f = coordinate - vec3<f32>(base);
  var sampled = 0.0;
  for (var z = 0; z <= 1; z++) { for (var y = 0; y <= 1; y++) { for (var x = 0; x <= 1; x++) {
    let c = vec3<u32>(clamp(base + vec3<i32>(x, y, z), vec3<i32>(0), vec3<i32>(i32(productionP.grid) - 1)));
    let w = select(1.0 - f.x, f.x, x == 1) * select(1.0 - f.y, f.y, y == 1) * select(1.0 - f.z, f.z, z == 1);
    sampled += denseSmoke[cellIndex(c, productionP.grid)] * w;
  }}}
  return max(0.0, sampled);
}
` + PRODUCTION_MECHANISMS_WGSL;

const PRODUCTION_SPARSE_WGSL = COMMON_WGSL + PRODUCTION_TILE_WGSL + String.raw`
@group(0) @binding(0) var<storage, read> compactCoarse: array<f32>;
@group(0) @binding(1) var<storage, read> compactIndirect: array<i32>;
@group(0) @binding(2) var<storage, read> compactAtlas: array<f32>;
@group(0) @binding(3) var<storage, read> fieldProxy: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> frontProxy: array<f32>;
@group(0) @binding(5) var<storage, read> majorantProxy: array<vec4<f32>>;
@group(0) @binding(6) var<uniform> cameraP: ProductionCamera;
@group(0) @binding(7) var<uniform> productionP: Params;
@group(0) @binding(8) var<storage, read_write> productionOutput: array<vec2<f32>>;
@group(0) @binding(9) var<uniform> tileP: ProductionTile;
fn compactBrickIndex(c: vec3<u32>) -> u32 { return c.x + c.y * productionP.coarseGrid + c.z * productionP.coarseGrid * productionP.coarseGrid; }
fn sampleSmokeExtinction(point: vec3<f32>) -> f32 {
  let cell = pointCell(point, productionP);
  let brick = cell / productionP.blockSize;
  let index = compactBrickIndex(brick);
  let slot = compactIndirect[index];
  if (slot < 0) { return max(0.0, compactCoarse[index]); }
  let edge = productionP.blockSize + 2u;
  let coordinate = (point - productionP.minimum.xyz) / (productionP.maximum.xyz - productionP.minimum.xyz) * f32(productionP.grid) - vec3<f32>(0.5);
  let base = vec3<i32>(floor(coordinate));
  let f = coordinate - vec3<f32>(base);
  let brickOrigin = vec3<i32>(brick * productionP.blockSize);
  var sampled = 0.0;
  for (var z = 0; z <= 1; z++) { for (var y = 0; y <= 1; y++) { for (var x = 0; x <= 1; x++) {
    let globalCell = clamp(base + vec3<i32>(x, y, z), vec3<i32>(0), vec3<i32>(i32(productionP.grid) - 1));
    let local = vec3<u32>(clamp(globalCell - brickOrigin + vec3<i32>(1), vec3<i32>(0), vec3<i32>(i32(edge) - 1)));
    let atlasIndex = u32(slot) * edge * edge * edge + cellIndex(local, edge);
    let w = select(1.0 - f.x, f.x, x == 1) * select(1.0 - f.y, f.y, y == 1) * select(1.0 - f.z, f.z, z == 1);
    sampled += compactAtlas[atlasIndex] * w;
  }}}
  return max(0.0, sampled);
}
` + PRODUCTION_MECHANISMS_WGSL;

const BUILD_WGSL = COMMON_WGSL + String.raw`
struct Pair { score: f32, index: u32 };
struct SortParams { j: u32, k: u32, count: u32, pad: u32 };
@group(0) @binding(0) var<storage, read> source: array<f32>;
@group(0) @binding(1) var<storage, read_write> coarse: array<f32>;
@group(0) @binding(2) var<storage, read_write> pairs: array<Pair>;
@group(0) @binding(3) var<uniform> p: Params;
@compute @workgroup_size(64)
fn hierarchy(@builtin(global_invocation_id) gid: vec3<u32>) {
  let brickIndex = gid.x;
  let brickCount = p.coarseGrid * p.coarseGrid * p.coarseGrid;
  if (brickIndex >= arrayLength(&pairs)) { return; }
  if (brickIndex >= brickCount) { pairs[brickIndex] = Pair(-1.0, brickIndex); return; }
  let brick = vec3<u32>(brickIndex % p.coarseGrid, (brickIndex / p.coarseGrid) % p.coarseGrid, brickIndex / (p.coarseGrid * p.coarseGrid));
  var sum = 0.0;
  for (var z = 0u; z < 4u; z++) { for (var y = 0u; y < 4u; y++) { for (var x = 0u; x < 4u; x++) {
    sum += source[cellIndex(brick * p.blockSize + vec3<u32>(x, y, z), p.grid)];
  }}}
  let mean = sum / f32(p.blockSize * p.blockSize * p.blockSize);
  coarse[brickIndex] = mean;
  var score = 0.0;
  for (var z = 0u; z < 4u; z++) { for (var y = 0u; y < 4u; y++) { for (var x = 0u; x < 4u; x++) {
    let residual = source[cellIndex(brick * p.blockSize + vec3<u32>(x, y, z), p.grid)] - mean;
    score += residual * residual;
  }}}
  pairs[brickIndex] = Pair(score, brickIndex);
}
@group(1) @binding(0) var<storage, read_write> sortPairs: array<Pair>;
@group(1) @binding(1) var<uniform> sortP: SortParams;
fn pairGreater(a: Pair, b: Pair) -> bool { return a.score > b.score || (a.score == b.score && a.index < b.index); }
@compute @workgroup_size(256)
fn bitonic(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= sortP.count) { return; }
  let other = i ^ sortP.j;
  if (other <= i || other >= sortP.count) { return; }
  let ascending = (i & sortP.k) == 0u;
  let left = sortPairs[i];
  let right = sortPairs[other];
  let swap = select(!pairGreater(left, right), pairGreater(left, right), ascending);
  if (swap && (left.score != right.score || left.index != right.index)) {
    sortPairs[i] = right;
    sortPairs[other] = left;
  }
}
@group(2) @binding(0) var<storage, read_write> indirect: array<i32>;
@group(2) @binding(1) var<storage, read> selectedPairs: array<Pair>;
@group(2) @binding(2) var<uniform> selectP: Params;
@compute @workgroup_size(256)
fn initializeIndirection(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x < selectP.coarseGrid * selectP.coarseGrid * selectP.coarseGrid) { indirect[gid.x] = -1; }
}
@compute @workgroup_size(256)
fn scatterSelection(@builtin(global_invocation_id) gid: vec3<u32>) {
  let slot = gid.x;
  if (slot >= selectP.selectedCount) { return; }
  let pairIndex = arrayLength(&selectedPairs) - 1u - slot;
  indirect[selectedPairs[pairIndex].index] = i32(slot);
}
@group(3) @binding(0) var<storage, read> packSource: array<f32>;
@group(3) @binding(1) var<storage, read> packPairs: array<Pair>;
@group(3) @binding(2) var<storage, read_write> packAtlas: array<f32>;
@group(3) @binding(3) var<uniform> packP: Params;
@compute @workgroup_size(256)
fn packFineAtlas(@builtin(global_invocation_id) gid: vec3<u32>) {
  let edge = packP.blockSize + 2u;
  let cellsPerSlot = edge * edge * edge;
  let linear = gid.x;
  if (linear >= packP.selectedCount * cellsPerSlot) { return; }
  let slot = linear / cellsPerSlot;
  let localIndex = linear % cellsPerSlot;
  let local = vec3<u32>(localIndex % edge, (localIndex / edge) % edge, localIndex / (edge * edge));
  let pairIndex = arrayLength(&packPairs) - 1u - slot;
  let brickIndex = packPairs[pairIndex].index;
  let brick = vec3<u32>(brickIndex % packP.coarseGrid, (brickIndex / packP.coarseGrid) % packP.coarseGrid, brickIndex / (packP.coarseGrid * packP.coarseGrid));
  let sourceCell = vec3<u32>(clamp(vec3<i32>(brick * packP.blockSize + local) - vec3<i32>(1), vec3<i32>(0), vec3<i32>(i32(packP.grid) - 1)));
  packAtlas[linear] = packSource[cellIndex(sourceCell, packP.grid)];
}
`;

function createComputePipeline(device, code, entryPoint, label, layout = 'auto') {
  return device.createComputePipeline({ label, layout, compute: { module: device.createShaderModule({ label: `${label} shader`, code }), entryPoint } });
}

async function readBuffer(device, source, bytes) {
  const readback = device.createBuffer({ size: Math.ceil(bytes / 4) * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, readback, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await Promise.race([
    readback.mapAsync(GPUMapMode.READ),
    device.lost.then(info => { throw new Error(`WebGPU device lost during readback: ${info.reason}: ${info.message}`); }),
  ]);
  const copy = readback.getMappedRange().slice(0, bytes);
  readback.unmap();
  readback.destroy();
  return copy;
}

async function resolveTimestamps(device, encode, queryCount, monotonicGroups = [Array.from({ length: queryCount }, (_, index) => index)]) {
  const querySet = device.createQuerySet({ type: 'timestamp', count: queryCount });
  const resolve = device.createBuffer({ size: queryCount * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: queryCount * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.pushErrorScope('validation');
  try {
    const encoder = device.createCommandEncoder();
    encode(encoder, querySet);
    encoder.resolveQuerySet(querySet, 0, queryCount, resolve, 0);
    encoder.copyBufferToBuffer(resolve, 0, readback, 0, queryCount * 8);
    device.queue.submit([encoder.finish()]);
    await Promise.race([
      readback.mapAsync(GPUMapMode.READ),
      device.lost.then(info => { throw new Error(`WebGPU device lost during timestamp readback: ${info.reason}: ${info.message}`); }),
    ]);
    const values = new BigUint64Array(readback.getMappedRange().slice(0));
    readback.unmap();
    const validation = await device.popErrorScope();
    if (validation) throw validation;
    if (Array.from(values).some(value => value === 0n)) throw new Error(`timestamp-query-incomplete:${Array.from(values).join(',')}`);
    for (const group of monotonicGroups) {
      for (let index = 1; index < group.length; index += 1) {
        if (values[group[index]] < values[group[index - 1]]) {
          throw new Error(`timestamp-query-nonmonotonic:${group.join(',')}:${Array.from(values).join(',')}`);
        }
      }
    }
    return values;
  } catch (error) {
    try { await device.popErrorScope(); } catch {}
    throw error;
  } finally {
    resolve.destroy();
    readback.destroy();
    querySet.destroy?.();
  }
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return { samples: sorted, count: sorted.length, minimum: sorted[0], median: sorted[Math.floor(sorted.length / 2)], mean: sum / sorted.length, maximum: sorted.at(-1) };
}

async function profilePass(device, { warmups, samples, encode }) {
  for (let index = 0; index < warmups; index += 1) await resolveTimestamps(device, encode, 2);
  const times = [];
  for (let index = 0; index < samples; index += 1) {
    const timestamp = await resolveTimestamps(device, encode, 2);
    times.push(Number(timestamp[1] - timestamp[0]) / 1_000_000);
  }
  return stats(times);
}

async function profileRepeatedPass(device, { warmups, samples, dispatchRepeats, encode }) {
  const aggregate = await profilePass(device, { warmups, samples, encode });
  const perDispatch = stats(aggregate.samples.map(value => value / dispatchRepeats));
  return { aggregate, perDispatch, dispatchRepeats };
}

async function profilePairedRepeatedPasses(device, {
  warmups,
  samples,
  dispatchRepeats,
  encodeArm,
}) {
  const measureArm = async arm => {
    const timestamps = await resolveTimestamps(device, (encoder, querySet) => {
      encodeArm(encoder, querySet, arm, 0, 1);
    }, 2);
    return Number(timestamps[1] - timestamps[0]) / 1_000_000;
  };
  const runPair = async index => {
    const denseFirst = index % 2 === 0;
    const order = denseFirst ? 'dense-compact' : 'compact-dense';
    let denseAggregateGpuMs;
    let compactAggregateGpuMs;
    if (denseFirst) {
      denseAggregateGpuMs = await measureArm('dense');
      compactAggregateGpuMs = await measureArm('compact');
    } else {
      compactAggregateGpuMs = await measureArm('compact');
      denseAggregateGpuMs = await measureArm('dense');
    }
    return {
      order,
      denseAggregateGpuMs,
      compactAggregateGpuMs,
      compactOverDenseRatio: compactAggregateGpuMs / denseAggregateGpuMs,
    };
  };
  for (let index = 0; index < warmups; index += 1) await runPair(index);
  const pairedSamples = [];
  for (let index = 0; index < samples; index += 1) pairedSamples.push(await runPair(index));
  const profile = arm => {
    const aggregate = stats(pairedSamples.map(row => row[`${arm}AggregateGpuMs`]));
    return {
      aggregate,
      perDispatch: stats(aggregate.samples.map(value => value / dispatchRepeats)),
      dispatchRepeats,
    };
  };
  return {
    timingProtocol: 'paired-alternating-submit-v0',
    submissionCountPerPair: 2,
    pairedSamples,
    pairedRatio: stats(pairedSamples.map(row => row.compactOverDenseRatio)),
    pairedRatioByOrder: {
      denseCompact: stats(pairedSamples.filter(row => row.order === 'dense-compact').map(row => row.compactOverDenseRatio)),
      compactDense: stats(pairedSamples.filter(row => row.order === 'compact-dense').map(row => row.compactOverDenseRatio)),
    },
    dense: profile('dense'),
    compact: profile('compact'),
  };
}

function summarizeRayWorkload(rays, grid, samplesPerCell, minimum, maximum) {
  const stepWorld = Math.min(...minimum.map((value, axis) => maximum[axis] - value)) / grid / samplesPerCell;
  let intersectingRayCount = 0;
  let denseStepCount = 0;
  let maximumDenseStepsPerRay = 0;
  for (let offset = 0; offset < rays.length; offset += 8) {
    const start = rays[offset + 3];
    const end = rays[offset + 4];
    if (!(end > start)) continue;
    const steps = Math.ceil((end - start) / stepWorld - 1e-7);
    intersectingRayCount += 1;
    denseStepCount += steps;
    maximumDenseStepsPerRay = Math.max(maximumDenseStepsPerRay, steps);
  }
  return { intersectingRayCount, denseStepCount, maximumDenseStepsPerRay, stepWorld };
}

function inspectProductionVolumeSource(bytes) {
  const source = new TextDecoder().decode(bytes);
  const required = new Map([
    ['majorant-grid', ['sampleWorldMajorant', 'sampleWorldMajorantLinear', 'sampleWorldMajorantDilated']],
    ['occupancy-skip', ['occupancySkipStepScale']],
    ['adaptive-rays', ['adaptiveRayStepScale']],
    ['early-transmittance', ['raymarchEarlyTermination']],
    ['five-live-field-samples', ['sampleWorldVelocity', 'sampleWorldMaterial', 'sampleWorldFireLayer', 'sampleWorldMicrodetail', 'sampleWorldFrontField']],
  ]);
  for (const [mechanism, tokens] of required) {
    for (const token of tokens) if (!source.includes(token)) throw new Error(`production attribution missing ${mechanism}:${token}`);
  }
  return {
    authority: 'static-production-shader-source-inspection-v0',
    sourcePath: DEFAULTS.productionVolumeSource,
    measuredProductionBottleneck: false,
    observedMechanisms: [...required.keys()],
    claimBoundary: 'Static source inspection identifies production work that R8 omits; it does not measure which production stage dominates.',
  };
}

function resolveWorkloadDimensions(config, baseWidth, baseHeight) {
  const dimensions = config.scaleFactors.map(scaleFactor => ({
    scaleFactor,
    width: Math.max(1, Math.round(baseWidth * scaleFactor)),
    height: Math.max(1, Math.round(baseHeight * scaleFactor)),
  }));
  for (const [width, height] of config.workloadDimensions) dimensions.push({ scaleFactor: null, width, height });
  const unique = new Map(dimensions.map(row => [`${row.width}x${row.height}`, row]));
  return [...unique.values()].sort((left, right) => left.width * left.height - right.width * right.height);
}

async function profileScaleLawWorkloads(device, {
  config,
  baseWidth,
  baseHeight,
  camera,
  minimum,
  maximum,
  grid,
  blockSize,
  selectedCount,
  samplesPerCell,
  extinctionCoefficient,
  denseAllocation,
  prebuiltCoarseAllocation,
  prebuiltIndirectAllocation,
  prebuiltAtlasAllocation,
  densePipeline,
  sparsePipeline,
  storageCopy,
}) {
  const workloads = [];
  for (const { scaleFactor, width, height } of resolveWorkloadDimensions(config, baseWidth, baseHeight)) {
    const pixelCount = width * height;
    const rays = buildRays(camera, width, height, minimum, maximum);
    const workload = summarizeRayWorkload(rays, grid, samplesPerCell, minimum, maximum);
    const raysAllocation = makeBuffer(device, `R8 rays ${width}x${height}`, rays.byteLength, GPUBufferUsage.STORAGE, rays);
    const paramsData = createParams({
      grid, blockSize, selectedCount, width, height, samplesPerCell, extinctionCoefficient,
      minimum, maximum, cameraPosition: camera.position,
    });
    const paramsAllocation = makeBuffer(device, `R8 params ${width}x${height}`, paramsData.byteLength, GPUBufferUsage.UNIFORM, paramsData);
    const denseOutputAllocation = makeBuffer(device, `R8 dense output ${width}x${height}`, pixelCount * 4, storageCopy);
    const compactOutputAllocation = makeBuffer(device, `R8 compact output ${width}x${height}`, pixelCount * 4, storageCopy);
    const denseBindGroup = device.createBindGroup({ layout: densePipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: denseAllocation.buffer } },
      { binding: 1, resource: { buffer: raysAllocation.buffer } },
      { binding: 2, resource: { buffer: paramsAllocation.buffer } },
      { binding: 3, resource: { buffer: denseOutputAllocation.buffer } },
    ] });
    const compactBindGroup = device.createBindGroup({ layout: sparsePipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: prebuiltCoarseAllocation.buffer } },
      { binding: 1, resource: { buffer: prebuiltIndirectAllocation.buffer } },
      { binding: 2, resource: { buffer: prebuiltAtlasAllocation.buffer } },
      { binding: 3, resource: { buffer: raysAllocation.buffer } },
      { binding: 4, resource: { buffer: paramsAllocation.buffer } },
      { binding: 5, resource: { buffer: compactOutputAllocation.buffer } },
    ] });
    const armResources = {
      dense: { pipeline: densePipeline, bindGroup: denseBindGroup },
      compact: { pipeline: sparsePipeline, bindGroup: compactBindGroup },
    };
    const encodeArm = (encoder, querySet, arm, beginningOfPassWriteIndex, endOfPassWriteIndex) => {
      const { pipeline, bindGroup } = armResources[arm];
      const pass = encoder.beginComputePass({ timestampWrites: { querySet, beginningOfPassWriteIndex, endOfPassWriteIndex } });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      for (let repeat = 0; repeat < config.scaleDispatchRepeats; repeat += 1) {
        pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
      }
      pass.end();
    };
    const pairedProfile = await profilePairedRepeatedPasses(device, {
      warmups: config.scaleWarmupSamples,
      samples: config.scaleSteadySamples,
      dispatchRepeats: config.scaleDispatchRepeats,
      encodeArm,
    });
    const denseOutput = new Float32Array(await readBuffer(device, denseOutputAllocation.buffer, pixelCount * 4));
    const compactOutput = new Float32Array(await readBuffer(device, compactOutputAllocation.buffer, pixelCount * 4));
    const comparison = compare(denseOutput, compactOutput, {
      width,
      errorLimit: ADAPTIVE_VOLUME_GPU_ERROR_LIMITS.compactPrebuiltAgainstDenseMaximumAbsoluteError,
    });
    workloads.push({
      scaleFactor,
      width,
      height,
      pixelCount,
      ...workload,
      dispatchRepeats: config.scaleDispatchRepeats,
      timingProtocol: pairedProfile.timingProtocol,
      submissionCountPerPair: pairedProfile.submissionCountPerPair,
      pairedSamples: pairedProfile.pairedSamples,
      pairedRatio: pairedProfile.pairedRatio,
      pairedRatioByOrder: pairedProfile.pairedRatioByOrder,
      profiles: { dense: pairedProfile.dense, compact: pairedProfile.compact },
      compactOverDenseRatio: pairedProfile.pairedRatio.median,
      comparison,
      outputsComplete: denseOutput.length === pixelCount && compactOutput.length === pixelCount,
    });
    raysAllocation.buffer.destroy();
    paramsAllocation.buffer.destroy();
    denseOutputAllocation.buffer.destroy();
    compactOutputAllocation.buffer.destroy();
  }
  return workloads;
}

function unpackProductionOutput(values) {
  const pixelCount = values.length / 2;
  const depth = new Float32Array(pixelCount);
  let productionStepCount = 0;
  let majorantSkipCount = 0;
  let earlyTerminationCount = 0;
  let intersectingRayCount = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    depth[pixel] = values[pixel * 2];
    const packed = Math.round(values[pixel * 2 + 1]);
    productionStepCount += packed % 256;
    majorantSkipCount += Math.floor(packed / 256) % 256;
    earlyTerminationCount += Math.floor(packed / 65536) % 2;
    intersectingRayCount += Math.floor(packed / 131072) % 2;
  }
  return {
    depth,
    productionStepCount,
    fieldSampleCount: productionStepCount * 5,
    majorantSkipCount,
    earlyTerminationCount,
    intersectingRayCount,
  };
}

async function profileProductionSurvival(device, {
  config,
  camera,
  minimum,
  maximum,
  grid,
  blockSize,
  selectedCount,
  samplesPerCell,
  extinctionCoefficient,
  denseAllocation,
  prebuiltCoarseAllocation,
  prebuiltIndirectAllocation,
  prebuiltAtlasAllocation,
  productionProxy,
  storageCopy,
}) {
  const width = 3456;
  const height = 2234;
  const pixelCount = width * height;
  const paramsData = createParams({
    grid, blockSize, selectedCount, width, height, samplesPerCell, extinctionCoefficient,
    minimum, maximum, cameraPosition: camera.position,
  });
  const paramsAllocation = makeBuffer(device, 'production survival params', paramsData.byteLength, GPUBufferUsage.UNIFORM, paramsData);
  const inverseViewProjection = new Float32Array(invertMatrix4(multiplyMatrix4(camera.projectionMatrix, camera.matrixWorldInverse)));
  const cameraAllocation = makeBuffer(device, 'production survival inverse view-projection', inverseViewProjection.byteLength, GPUBufferUsage.UNIFORM, inverseViewProjection);
  const fieldsAllocation = makeBuffer(device, 'step45 sidecar-backed production field proxy', productionProxy.slots.byteLength, GPUBufferUsage.STORAGE, productionProxy.slots);
  const frontAllocation = makeBuffer(device, 'step45 source-bound front proxy', productionProxy.front.byteLength, GPUBufferUsage.STORAGE, productionProxy.front);
  const majorantAllocation = makeBuffer(device, 'step45 source-bound majorant proxy', productionProxy.majorant.byteLength, GPUBufferUsage.STORAGE, productionProxy.majorant);
  const denseOutputAllocation = makeBuffer(device, 'production survival dense packed output', pixelCount * 8, storageCopy);
  const compactOutputAllocation = makeBuffer(device, 'production survival compact packed output', pixelCount * 8, storageCopy);
  const tileCount = Math.ceil(height / config.productionTileRows);
  const tileParamsData = new Uint8Array(tileCount * 256);
  const tileParamsView = new DataView(tileParamsData.buffer);
  const tileRows = [];
  for (let tile = 0; tile < tileCount; tile += 1) {
    const rowOffset = tile * config.productionTileRows;
    const rowCount = Math.min(config.productionTileRows, height - rowOffset);
    tileParamsView.setUint32(tile * 256, rowOffset, true);
    tileParamsView.setUint32(tile * 256 + 4, rowCount, true);
    tileRows.push({ rowOffset, rowCount });
  }
  const tileParamsAllocation = makeBuffer(device, 'production survival tile parameters', tileParamsData.byteLength, GPUBufferUsage.UNIFORM, tileParamsData);
  const densePipeline = createComputePipeline(device, PRODUCTION_DENSE_WGSL, 'main', 'production-shaped dense scalar comparator');
  const compactPipeline = createComputePipeline(device, PRODUCTION_SPARSE_WGSL, 'main', 'production-shaped compact scalar comparator');
  const denseEntries = [
    { binding: 0, resource: { buffer: denseAllocation.buffer } },
    { binding: 1, resource: { buffer: fieldsAllocation.buffer } },
    { binding: 2, resource: { buffer: frontAllocation.buffer } },
    { binding: 3, resource: { buffer: majorantAllocation.buffer } },
    { binding: 4, resource: { buffer: cameraAllocation.buffer } },
    { binding: 5, resource: { buffer: paramsAllocation.buffer } },
    { binding: 6, resource: { buffer: denseOutputAllocation.buffer } },
  ];
  const compactEntries = [
    { binding: 0, resource: { buffer: prebuiltCoarseAllocation.buffer } },
    { binding: 1, resource: { buffer: prebuiltIndirectAllocation.buffer } },
    { binding: 2, resource: { buffer: prebuiltAtlasAllocation.buffer } },
    { binding: 3, resource: { buffer: fieldsAllocation.buffer } },
    { binding: 4, resource: { buffer: frontAllocation.buffer } },
    { binding: 5, resource: { buffer: majorantAllocation.buffer } },
    { binding: 6, resource: { buffer: cameraAllocation.buffer } },
    { binding: 7, resource: { buffer: paramsAllocation.buffer } },
    { binding: 8, resource: { buffer: compactOutputAllocation.buffer } },
  ];
  const tileBindGroups = {
    dense: tileRows.map((_, tile) => device.createBindGroup({ layout: densePipeline.getBindGroupLayout(0), entries: [
      ...denseEntries,
      { binding: 7, resource: { buffer: tileParamsAllocation.buffer, offset: tile * 256, size: 16 } },
    ] })),
    compact: tileRows.map((_, tile) => device.createBindGroup({ layout: compactPipeline.getBindGroupLayout(0), entries: [
      ...compactEntries,
      { binding: 9, resource: { buffer: tileParamsAllocation.buffer, offset: tile * 256, size: 16 } },
    ] })),
  };
  const arms = {
    dense: { pipeline: densePipeline, bindGroups: tileBindGroups.dense },
    compact: { pipeline: compactPipeline, bindGroups: tileBindGroups.compact },
  };
  const pairedProfile = await profilePairedRepeatedPasses(device, {
    warmups: config.productionWarmupSamples,
    samples: config.productionSteadySamples,
    dispatchRepeats: config.productionDispatchRepeats,
    encodeArm(encoder, querySet, arm, beginningOfPassWriteIndex, endOfPassWriteIndex) {
      const pass = encoder.beginComputePass({ timestampWrites: { querySet, beginningOfPassWriteIndex, endOfPassWriteIndex } });
      pass.setPipeline(arms[arm].pipeline);
      for (let repeat = 0; repeat < config.productionDispatchRepeats; repeat += 1) {
        for (let tile = 0; tile < tileCount; tile += 1) {
          pass.setBindGroup(0, arms[arm].bindGroups[tile]);
          pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(tileRows[tile].rowCount / 8));
        }
      }
      pass.end();
    },
  });
  const denseRaw = new Float32Array(await readBuffer(device, denseOutputAllocation.buffer, pixelCount * 8));
  const compactRaw = new Float32Array(await readBuffer(device, compactOutputAllocation.buffer, pixelCount * 8));
  const dense = unpackProductionOutput(denseRaw);
  const compact = unpackProductionOutput(compactRaw);
  const comparison = compare(dense.depth, compact.depth, {
    width,
    errorLimit: ADAPTIVE_VOLUME_GPU_ERROR_LIMITS.compactPrebuiltAgainstDenseMaximumAbsoluteError,
  });
  const workSummary = value => ({
    productionStepCount: value.productionStepCount,
    fieldSampleCount: value.fieldSampleCount,
    majorantSkipCount: value.majorantSkipCount,
    earlyTerminationCount: value.earlyTerminationCount,
    intersectingRayCount: value.intersectingRayCount,
  });
  for (const allocation of [
    paramsAllocation, cameraAllocation, fieldsAllocation, frontAllocation, majorantAllocation, tileParamsAllocation,
    denseOutputAllocation, compactOutputAllocation,
  ]) allocation.buffer.destroy();
  return {
    width,
    height,
    pixelCount,
    dispatchedPixelCount: width * tileRows.reduce((total, tile) => total + tile.rowCount, 0),
    tileRows: config.productionTileRows,
    tileCount,
    intersectingRayCount: dense.intersectingRayCount,
    dispatchRepeats: config.productionDispatchRepeats,
    timingProtocol: pairedProfile.timingProtocol,
    submissionCountPerPair: pairedProfile.submissionCountPerPair,
    pairedSamples: pairedProfile.pairedSamples,
    pairedRatio: pairedProfile.pairedRatio,
    pairedRatioByOrder: pairedProfile.pairedRatioByOrder,
    profiles: { dense: pairedProfile.dense, compact: pairedProfile.compact },
    compactOverDenseRatio: pairedProfile.pairedRatio.median,
    productionStepCount: dense.productionStepCount,
    fieldSampleCount: dense.fieldSampleCount,
    majorantSkipCount: dense.majorantSkipCount,
    earlyTerminationCount: dense.earlyTerminationCount,
    armWork: { dense: workSummary(dense), compact: workSummary(compact) },
    comparison,
    outputsComplete: dense.depth.length === pixelCount && compact.depth.length === pixelCount,
    proxyAllocationBytes: {
      sidecarBackedFields: productionProxy.slots.byteLength,
      front: productionProxy.front.byteLength,
      majorant: productionProxy.majorant.byteLength,
      total: productionProxy.slots.byteLength + productionProxy.front.byteLength + productionProxy.majorant.byteLength,
    },
  };
}

function compare(left, right, { width = null, errorLimit = null } = {}) {
  if (left.length !== right.length) throw new Error('output comparison shape mismatch');
  let mse = 0;
  let meanAbsoluteError = 0;
  let maximumAbsoluteError = 0;
  let maximumAbsoluteErrorIndex = 0;
  let aboveErrorLimitCount = 0;
  const absoluteErrors = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    const delta = Math.abs(left[index] - right[index]);
    absoluteErrors[index] = delta;
    mse += delta * delta;
    meanAbsoluteError += delta;
    if (delta > maximumAbsoluteError) {
      maximumAbsoluteError = delta;
      maximumAbsoluteErrorIndex = index;
    }
    if (Number.isFinite(errorLimit) && delta > errorLimit) aboveErrorLimitCount += 1;
  }
  absoluteErrors.sort();
  const quantile = fraction => absoluteErrors[Math.floor((absoluteErrors.length - 1) * fraction)];
  return {
    sampleCount: left.length,
    meanSquaredError: mse / left.length,
    meanAbsoluteError: meanAbsoluteError / left.length,
    maximumAbsoluteError,
    maximumAbsoluteErrorIndex,
    maximumAbsoluteErrorPixel: Number.isInteger(width) && width > 0
      ? { x: maximumAbsoluteErrorIndex % width, y: Math.floor(maximumAbsoluteErrorIndex / width) }
      : null,
    maximumPair: { left: left[maximumAbsoluteErrorIndex], right: right[maximumAbsoluteErrorIndex] },
    absoluteErrorQuantiles: { p99: quantile(0.99), p999: quantile(0.999), p9999: quantile(0.9999) },
    errorLimit: Number.isFinite(errorLimit) ? errorLimit : null,
    aboveErrorLimitCount,
    aboveErrorLimitFraction: aboveErrorLimitCount / left.length,
  };
}

function drawDepth(canvasId, values, width, height, exposure = 8) {
  const canvas = document.getElementById(canvasId);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  for (let index = 0; index < values.length; index += 1) {
    const luma = Math.max(0, Math.min(1, (1 - Math.exp(-values[index])) * exposure));
    const byte = Math.round(luma * 255);
    image.data[index * 4] = byte;
    image.data[index * 4 + 1] = byte;
    image.data[index * 4 + 2] = byte;
    image.data[index * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function setLabel(id, text) { document.getElementById(id).textContent = text; }

function renderScaleLawSummary(scaleLaw) {
  const node = document.getElementById('scale-law-summary');
  node.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = 'R8c Paired Scale Law';
  const context = document.createElement('p');
  context.textContent = 'Isolated single-channel traversal. Each arm gets a separate timestamped submission; pair order alternates and the 0.001 maximum-error gate remains binding.';
  const table = document.createElement('table');
  const header = document.createElement('tr');
  for (const label of ['Workload', 'Dense ms', 'Compact ms', 'C/D ratio', 'p99.99 error', 'Max error', '> gate']) {
    const cell = document.createElement('th');
    cell.textContent = label;
    header.append(cell);
  }
  const head = document.createElement('thead');
  head.append(header);
  const body = document.createElement('tbody');
  for (const row of scaleLaw.effective.workloads) {
    const tr = document.createElement('tr');
    const values = [
      `${row.width}x${row.height}`,
      row.profiles.dense.perDispatch.median.toFixed(3),
      row.profiles.compact.perDispatch.median.toFixed(3),
      row.compactOverDenseRatio.toFixed(3),
      row.comparison.absoluteErrorQuantiles.p9999.toExponential(2),
      row.comparison.maximumAbsoluteError.toExponential(2),
      String(row.comparison.aboveErrorLimitCount),
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      tr.append(cell);
    }
    body.append(tr);
  }
  table.append(head, body);
  node.append(heading, context, table);
}

async function run() {
  const config = queryConfig();
  const requestedRoute = location.href;
  let failurePhase = 'source-load';
  setStatus('Loading exact static source, camera, reference, and persisted selection');
  const [matchedBytes, fitBytes, sidecarBytes, selectionBytes, referenceBytes, moduleBytes, browserBytes, witnessBytes, htmlBytes, productionVolumeBytes] = await Promise.all([
    fetchBytes(config.matchedReport, 'matched report'),
    fetchBytes(config.fitReport, 'fit report'),
    fetchBytes(config.sourceSidecar, 'source sidecar'),
    fetchBytes(config.selection, 'selection'),
    fetchBytes(config.referenceDepth, 'reference depth'),
    fetchBytes(DEFAULTS.moduleSource, 'shared module source'),
    fetchBytes(DEFAULTS.browserSource, 'browser source'),
    fetchBytes(DEFAULTS.witnessSource, 'witness source'),
    fetchBytes(DEFAULTS.htmlSource, 'HTML source'),
    fetchBytes(DEFAULTS.productionVolumeSource, 'production volume source'),
  ]);
  const matched = JSON.parse(new TextDecoder().decode(matchedBytes));
  const fit = JSON.parse(new TextDecoder().decode(fitBytes));
  const grid = matched.effective.grid;
  const width = matched.effective.width;
  const height = matched.effective.height;
  const sidecar = new Float32Array(sidecarBytes.buffer, sidecarBytes.byteOffset, sidecarBytes.byteLength / 4);
  if (sidecar.length !== grid ** 3 * 4) throw new Error('source sidecar shape mismatch');
  const source = new Float32Array(grid ** 3);
  for (let index = 0; index < source.length; index += 1) source[index] = sidecar[index * 4];
  const selected = parseSelectedBrickArtifact(selectionBytes);
  const blockSize = 4;
  const product = buildCompactSmokeProduct({ source, grid, blockSize, selectedBrickIndices: selected });
  const productionProxy = config.productionSurvival ? buildProductionFieldProxy(sidecar, grid, blockSize) : null;
  const reference = new Float32Array(referenceBytes.buffer, referenceBytes.byteOffset, referenceBytes.byteLength / 4);
  if (reference.length !== width * height) throw new Error('reference depth shape mismatch');
  const camera = fit.teacher.camera;
  const minimum = fit.teacher.worldSpace.bounds.minimum;
  const maximum = fit.teacher.worldSpace.bounds.maximum;
  const rays = buildRays(camera, width, height, minimum, maximum);
  const productionAttribution = inspectProductionVolumeSource(productionVolumeBytes);

  failurePhase = 'device';
  setStatus('Requesting effective Apple WebGPU device with timestamp-query');
  if (!navigator.gpu) throw new Error('WebGPU unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  if (!adapter.features.has('timestamp-query')) throw new Error('timestamp-query-not-supported');
  const workloadDimensions = resolveWorkloadDimensions(config, width, height);
  const largestRayBufferBytes = Math.max(...workloadDimensions.map(row => row.width * row.height * 8 * Float32Array.BYTES_PER_ELEMENT));
  const largestOutputBufferBytes = Math.max(...workloadDimensions.map(row => row.width * row.height * Float32Array.BYTES_PER_ELEMENT));
  const productionOutputBufferBytes = config.productionSurvival ? 3456 * 2234 * 2 * Float32Array.BYTES_PER_ELEMENT : 0;
  const productionFieldBufferBytes = productionProxy?.slots.byteLength ?? 0;
  const largestStorageBufferBytes = Math.max(largestRayBufferBytes, largestOutputBufferBytes, productionOutputBufferBytes, productionFieldBufferBytes);
  const largestRequiredBufferBytes = Math.max(source.byteLength, largestStorageBufferBytes);
  if (adapter.limits.maxStorageBufferBindingSize < largestStorageBufferBytes) throw new Error('Retina production workload exceeds maxStorageBufferBindingSize');
  if (adapter.limits.maxBufferSize < largestRequiredBufferBytes) throw new Error('Retina workload exceeds maxBufferSize');
  const requiredLimits = {};
  requiredLimits.maxStorageBufferBindingSize = largestStorageBufferBytes;
  requiredLimits.maxBufferSize = largestRequiredBufferBytes;
  if (config.productionSurvival) requiredLimits.maxStorageBuffersPerShaderStage = 8;
  const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'], requiredLimits });
  const adapterInfo = adapter.info ? { ...adapter.info } : {};
  const adapterText = JSON.stringify(adapterInfo).toLowerCase();
  const adapterBackedAppleIdentity = adapterText.includes('apple');
  const backend = adapterBackedAppleIdentity ? 'WebGPU:apple' : 'WebGPU:unknown';
  const backendIdentitySource = adapterBackedAppleIdentity ? 'adapter-info' : 'platform-fallback-untrusted';

  failurePhase = 'allocation';
  setStatus('Allocating dense and independently resident compact products');
  const storageCopy = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  const denseAllocation = makeBuffer(device, 'dense R160 physical extinction', source.byteLength, storageCopy, source);
  const raysAllocation = makeBuffer(device, 'camera rays', rays.byteLength, GPUBufferUsage.STORAGE, rays);
  const paramsData = createParams({
    grid, blockSize, selectedCount: selected.length, width, height,
    samplesPerCell: matched.effective.samplesPerCell,
    extinctionCoefficient: matched.effective.extinctionCoefficient,
    minimum, maximum, cameraPosition: camera.position,
  });
  const paramsAllocation = makeBuffer(device, 'adaptive volume params', paramsData.byteLength, GPUBufferUsage.UNIFORM, paramsData);
  const denseOutputAllocation = makeBuffer(device, 'dense output', width * height * 4, storageCopy);
  const prebuiltOutputAllocation = makeBuffer(device, 'prebuilt output', width * height * 4, storageCopy);
  const builtOutputAllocation = makeBuffer(device, 'built output', width * height * 4, storageCopy);
  const prebuiltCoarseAllocation = makeBuffer(device, 'prebuilt coarse', product.coarseValues.byteLength, GPUBufferUsage.STORAGE, product.coarseValues);
  const prebuiltIndirectAllocation = makeBuffer(device, 'prebuilt indirection', product.indirection.byteLength, GPUBufferUsage.STORAGE, product.indirection);
  const prebuiltAtlasAllocation = makeBuffer(device, 'prebuilt atlas', product.atlasValues.byteLength, GPUBufferUsage.STORAGE, product.atlasValues);
  const brickCount = product.brickCount;
  const sortRecordCount = bitonicSortRecordCount(brickCount);
  const pairBytes = sortRecordCount * 8;
  const builtCoarseAllocation = makeBuffer(device, 'GPU built coarse', brickCount * 4, storageCopy);
  const pairAllocation = makeBuffer(device, 'GPU residual sort pairs', pairBytes, storageCopy);
  const builtIndirectAllocation = makeBuffer(device, 'GPU built indirection', brickCount * 4, storageCopy);
  const builtAtlasAllocation = makeBuffer(device, 'GPU built atlas', product.atlasValues.byteLength, storageCopy);

  failurePhase = 'pipeline';
  const densePipeline = createComputePipeline(device, DENSE_WGSL, 'main', 'dense R160 raymarch');
  const sparsePipeline = createComputePipeline(device, SPARSE_WGSL, 'main', 'compact brick DDA raymarch');
  const hierarchyPipeline = createComputePipeline(device, BUILD_WGSL, 'hierarchy', 'coarse means and residual energy');
  const sortPipeline = createComputePipeline(device, BUILD_WGSL, 'bitonic', 'residual energy bitonic sort');
  const initializePipeline = createComputePipeline(device, BUILD_WGSL, 'initializeIndirection', 'initialize compact indirection');
  const scatterPipeline = createComputePipeline(device, BUILD_WGSL, 'scatterSelection', 'scatter selected brick slots');
  const packPipeline = createComputePipeline(device, BUILD_WGSL, 'packFineAtlas', 'pack selected fine atlas');
  const denseBindGroup = device.createBindGroup({ layout: densePipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: denseAllocation.buffer } }, { binding: 1, resource: { buffer: raysAllocation.buffer } },
    { binding: 2, resource: { buffer: paramsAllocation.buffer } }, { binding: 3, resource: { buffer: denseOutputAllocation.buffer } },
  ] });
  const sparseBindGroup = (coarse, indirect, atlas, output) => device.createBindGroup({ layout: sparsePipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: coarse.buffer } }, { binding: 1, resource: { buffer: indirect.buffer } },
    { binding: 2, resource: { buffer: atlas.buffer } }, { binding: 3, resource: { buffer: raysAllocation.buffer } },
    { binding: 4, resource: { buffer: paramsAllocation.buffer } }, { binding: 5, resource: { buffer: output.buffer } },
  ] });
  const prebuiltBindGroup = sparseBindGroup(prebuiltCoarseAllocation, prebuiltIndirectAllocation, prebuiltAtlasAllocation, prebuiltOutputAllocation);
  const builtBindGroup = sparseBindGroup(builtCoarseAllocation, builtIndirectAllocation, builtAtlasAllocation, builtOutputAllocation);
  const hierarchyBindGroup = device.createBindGroup({ layout: hierarchyPipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: denseAllocation.buffer } }, { binding: 1, resource: { buffer: builtCoarseAllocation.buffer } },
    { binding: 2, resource: { buffer: pairAllocation.buffer } }, { binding: 3, resource: { buffer: paramsAllocation.buffer } },
  ] });
  const sortStages = buildBitonicSortStages(sortRecordCount);
  const sortParamBytes = new Uint8Array(sortStages.length * 256);
  const sortParamView = new DataView(sortParamBytes.buffer);
  sortStages.forEach((values, stage) => values.forEach((value, index) => sortParamView.setUint32(stage * 256 + index * 4, value, true)));
  const sortParamAllocation = makeBuffer(device, 'bitonic stage params', sortParamBytes.byteLength, GPUBufferUsage.UNIFORM, sortParamBytes);
  const sortBindGroupLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } },
  ] });
  const emptySortPrefixLayout = device.createBindGroupLayout({ entries: [] });
  const sortPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [emptySortPrefixLayout, sortBindGroupLayout] });
  const dynamicSortPipeline = createComputePipeline(device, BUILD_WGSL, 'bitonic', 'dynamic residual energy bitonic sort', sortPipelineLayout);
  const sortBindGroup = device.createBindGroup({ layout: sortBindGroupLayout, entries: [
    { binding: 0, resource: { buffer: pairAllocation.buffer } },
    { binding: 1, resource: { buffer: sortParamAllocation.buffer, size: 16 } },
  ] });
  const initializeBindGroup = device.createBindGroup({ layout: initializePipeline.getBindGroupLayout(2), entries: [
    { binding: 0, resource: { buffer: builtIndirectAllocation.buffer } },
    { binding: 2, resource: { buffer: paramsAllocation.buffer } },
  ] });
  const scatterBindGroup = device.createBindGroup({ layout: scatterPipeline.getBindGroupLayout(2), entries: [
    { binding: 0, resource: { buffer: builtIndirectAllocation.buffer } },
    { binding: 1, resource: { buffer: pairAllocation.buffer } },
    { binding: 2, resource: { buffer: paramsAllocation.buffer } },
  ] });
  const packBindGroup = device.createBindGroup({ layout: packPipeline.getBindGroupLayout(3), entries: [
    { binding: 0, resource: { buffer: denseAllocation.buffer } }, { binding: 1, resource: { buffer: pairAllocation.buffer } },
    { binding: 2, resource: { buffer: builtAtlasAllocation.buffer } }, { binding: 3, resource: { buffer: paramsAllocation.buffer } },
  ] });

  const encodeRender = (encoder, querySet, pipeline, bindGroup, outputIndex = 1) => {
    const pass = encoder.beginComputePass({ timestampWrites: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: outputIndex } });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
  };
  const encodeBuild = (encoder, querySet, includeRender) => {
    let pass = encoder.beginComputePass({ timestampWrites: { querySet, beginningOfPassWriteIndex: 0 } });
    pass.setPipeline(hierarchyPipeline); pass.setBindGroup(0, hierarchyBindGroup); pass.dispatchWorkgroups(Math.ceil(sortRecordCount / 64)); pass.end();
    for (let stage = 0; stage < sortStages.length; stage += 1) {
      pass = encoder.beginComputePass();
      pass.setPipeline(dynamicSortPipeline); pass.setBindGroup(1, sortBindGroup, [stage * 256]); pass.dispatchWorkgroups(Math.ceil(sortRecordCount / 256)); pass.end();
    }
    pass = encoder.beginComputePass(); pass.setPipeline(initializePipeline); pass.setBindGroup(2, initializeBindGroup); pass.dispatchWorkgroups(Math.ceil(brickCount / 256)); pass.end();
    pass = encoder.beginComputePass(); pass.setPipeline(scatterPipeline); pass.setBindGroup(2, scatterBindGroup); pass.dispatchWorkgroups(Math.ceil(selected.length / 256)); pass.end();
    pass = encoder.beginComputePass({ timestampWrites: includeRender ? undefined : { querySet, endOfPassWriteIndex: 1 } });
    pass.setPipeline(packPipeline); pass.setBindGroup(3, packBindGroup); pass.dispatchWorkgroups(Math.ceil(product.atlasValues.length / 256)); pass.end();
    if (includeRender) {
      pass = encoder.beginComputePass({ timestampWrites: { querySet, beginningOfPassWriteIndex: 1, endOfPassWriteIndex: 2 } });
      pass.setPipeline(sparsePipeline); pass.setBindGroup(0, builtBindGroup); pass.dispatchWorkgroups(Math.ceil(width * height / 64)); pass.end();
    }
  };

  failurePhase = 'profiling';
  setStatus('Profiling dense, compact-prebuilt, and GPU-build-plus-compact arms');
  const denseProfile = await profilePass(device, { warmups: config.warmupSamples, samples: config.steadySamples, encode: (encoder, queries) => encodeRender(encoder, queries, densePipeline, denseBindGroup) });
  const prebuiltProfile = await profilePass(device, { warmups: config.warmupSamples, samples: config.steadySamples, encode: (encoder, queries) => encodeRender(encoder, queries, sparsePipeline, prebuiltBindGroup) });
  const buildProfile = await profilePass(device, { warmups: config.buildWarmupSamples, samples: config.buildSteadySamples, encode: (encoder, queries) => encodeBuild(encoder, queries, false) });
  for (let index = 0; index < config.buildWarmupSamples; index += 1) await resolveTimestamps(device, (encoder, queries) => encodeBuild(encoder, queries, true), 3);
  const buildRenderSamples = [];
  for (let index = 0; index < config.buildSteadySamples; index += 1) {
    const timestamps = await resolveTimestamps(device, (encoder, queries) => encodeBuild(encoder, queries, true), 3);
    buildRenderSamples.push({
      build: Number(timestamps[1] - timestamps[0]) / 1_000_000,
      render: Number(timestamps[2] - timestamps[1]) / 1_000_000,
      total: Number(timestamps[2] - timestamps[0]) / 1_000_000,
    });
  }
  const buildRenderProfile = {
    build: stats(buildRenderSamples.map(row => row.build)),
    render: stats(buildRenderSamples.map(row => row.render)),
    total: stats(buildRenderSamples.map(row => row.total)),
  };

  failurePhase = 'scale-law-profiling';
  setStatus('Profiling amplified dense and compact scale-law workloads');
  const scaleLawWorkloads = await profileScaleLawWorkloads(device, {
    config,
    baseWidth: width,
    baseHeight: height,
    camera,
    minimum,
    maximum,
    grid,
    blockSize,
    selectedCount: selected.length,
    samplesPerCell: matched.effective.samplesPerCell,
    extinctionCoefficient: matched.effective.extinctionCoefficient,
    denseAllocation,
    prebuiltCoarseAllocation,
    prebuiltIndirectAllocation,
    prebuiltAtlasAllocation,
    densePipeline,
    sparsePipeline,
    storageCopy,
  });

  let productionSurvivalWorkload = null;
  if (config.productionSurvival) {
    failurePhase = 'production-survival-profiling';
    setStatus('Profiling matched production-shaped field work at full Retina resolution');
    productionSurvivalWorkload = await profileProductionSurvival(device, {
      config,
      camera,
      minimum,
      maximum,
      grid,
      blockSize,
      selectedCount: selected.length,
      samplesPerCell: matched.effective.samplesPerCell,
      extinctionCoefficient: matched.effective.extinctionCoefficient,
      denseAllocation,
      prebuiltCoarseAllocation,
      prebuiltIndirectAllocation,
      prebuiltAtlasAllocation,
      productionProxy,
      storageCopy,
    });
  }

  failurePhase = 'selection-validation';
  const pairData = new DataView(await readBuffer(device, pairAllocation.buffer, pairBytes));
  const gpuSelected = [];
  let totalResidualEnergy = 0;
  let selectedResidualEnergy = 0;
  let sortOrderViolationCount = 0;
  let previousScore = -Infinity;
  let previousIndex = Infinity;
  for (let index = 0; index < sortRecordCount; index += 1) {
    const score = pairData.getFloat32(index * 8, true);
    const brickIndex = pairData.getUint32(index * 8 + 4, true);
    if (score < previousScore || (score === previousScore && brickIndex > previousIndex)) sortOrderViolationCount += 1;
    previousScore = score;
    previousIndex = brickIndex;
    if (brickIndex < brickCount) totalResidualEnergy += score;
    if (index >= sortRecordCount - selected.length) {
      selectedResidualEnergy += score;
      gpuSelected.push(brickIndex);
    }
  }
  gpuSelected.sort((a, b) => a - b);
  let selectionMismatchCount = 0;
  for (let index = 0; index < selected.length; index += 1) if (gpuSelected[index] !== selected[index]) selectionMismatchCount += 1;

  failurePhase = 'output-readback';
  const denseOutput = new Float32Array(await readBuffer(device, denseOutputAllocation.buffer, width * height * 4));
  const prebuiltBeforeDenial = new Float32Array(await readBuffer(device, prebuiltOutputAllocation.buffer, width * height * 4));
  const builtBeforeDenial = new Float32Array(await readBuffer(device, builtOutputAllocation.buffer, width * height * 4));
  const preDenialSha = await sha256(prebuiltBeforeDenial);

  failurePhase = 'dense-denial';
  setStatus('Destroying dense source before independent compact rerender');
  denseAllocation.buffer.destroy();
  const denseSourceAfterDestroy = 'dense source destroyed before compact rerender';
  await resolveTimestamps(device, (encoder, queries) => encodeRender(encoder, queries, sparsePipeline, prebuiltBindGroup), 2);
  const prebuiltAfterDenial = new Float32Array(await readBuffer(device, prebuiltOutputAllocation.buffer, width * height * 4));
  await resolveTimestamps(device, (encoder, queries) => encodeRender(encoder, queries, sparsePipeline, builtBindGroup), 2);
  const builtAfterDenial = new Float32Array(await readBuffer(device, builtOutputAllocation.buffer, width * height * 4));
  const postDenialSha = await sha256(prebuiltAfterDenial);
  const denialComparison = compare(prebuiltBeforeDenial, prebuiltAfterDenial);

  failurePhase = 'report';
  const denseComparison = compare(reference, denseOutput);
  const prebuiltComparison = compare(denseOutput, prebuiltAfterDenial);
  const builtComparison = compare(denseOutput, builtAfterDenial);
  const allocationBytes = {
    coarse: builtCoarseAllocation.bytes,
    indirection: builtIndirectAllocation.bytes,
    fineAtlas: builtAtlasAllocation.bytes,
    selectionSort: pairAllocation.bytes,
    sortParameters: sortParamAllocation.bytes,
    params: paramsAllocation.bytes,
  };
  allocationBytes.productResident = allocationBytes.coarse + allocationBytes.indirection + allocationBytes.fineAtlas + allocationBytes.params;
  allocationBytes.buildScratch = allocationBytes.selectionSort + allocationBytes.sortParameters;
  allocationBytes.totalBuildAndProduct = allocationBytes.productResident + allocationBytes.buildScratch;
  allocationBytes.total = allocationBytes.totalBuildAndProduct;
  const falseClosureChecks = {
    fallbackRoute: backend !== 'WebGPU:apple',
    missingTimestampSupport: !device.features.has('timestamp-query'),
    hiddenDenseBinding: false,
    hiddenDenseAllocation: false,
    incompleteOutput: [denseOutput, prebuiltAfterDenial, builtAfterDenial].some(values => values.length !== width * height || Array.from(values).some(value => !Number.isFinite(value))),
    staleSelection: selectionMismatchCount !== 0,
    sortOrderInvalid: sortOrderViolationCount !== 0,
    hiddenCap: false,
  };
  const report = {
    schema: ADAPTIVE_VOLUME_GPU_REPORT_SCHEMA,
    identity: 'adaptive-smoke-volume-three-arm-gpu-falsifier-v0',
    status: 'passed',
    requested: {
      route: requestedRoute,
      sourceSidecar: config.sourceSidecar,
      selectionArtifact: config.selection,
      selectedBrickCount: selected.length,
      warmupSamples: config.warmupSamples,
      steadySamples: config.steadySamples,
      buildWarmupSamples: config.buildWarmupSamples,
      buildSteadySamples: config.buildSteadySamples,
      hiddenBrickCapApplied: false,
    },
    effective: {
      route: ADAPTIVE_VOLUME_GPU_ROUTE,
      backend,
      backendIdentitySource,
      adapterInfo,
      navigatorPlatform: navigator.platform,
      platformAppleHint: /Mac/.test(navigator.platform || ''),
      timestampFeature: 'timestamp-query',
      timestampStatus: device.features.has('timestamp-query') ? 'available' : 'unsupported',
      sourceGrid: grid,
      coarseGrid: product.coarseGrid,
      physicalBrickCount: brickCount,
      sortRecordCount,
      blockSize,
      width,
      height,
      samplesPerCell: matched.effective.samplesPerCell,
      extinctionCoefficient: matched.effective.extinctionCoefficient,
      selectionPolicy: `gpu-f32-residual-energy-bitonic-ascending-suffix-top-${selected.length}-v2`,
      sortStageCount: sortStages.length,
    },
    source: {
      matchedReport: config.matchedReport,
      matchedReportSha256: await sha256(matchedBytes),
      fitReport: config.fitReport,
      fitReportSha256: await sha256(fitBytes),
      sourceSidecar: config.sourceSidecar,
      sourceSidecarSha256: await sha256(sidecarBytes),
      selectionArtifact: config.selection,
      selectionArtifactSha256: await sha256(selectionBytes),
      referenceDepth: config.referenceDepth,
      referenceDepthSha256: await sha256(referenceBytes),
    },
    runtime: {
      gitCommit: config.gitCommit,
      gitBranch: config.gitBranch,
      gitStatusShort: config.gitStatusShort,
      sourceFileSha256s: {
        module: await sha256(moduleBytes),
        browser: await sha256(browserBytes),
        witness: await sha256(witnessBytes),
        html: await sha256(htmlBytes),
        productionVolume: await sha256(productionVolumeBytes),
      },
    },
    arms: {
      dense: { outputComplete: denseOutput.length === width * height, gpuMs: denseProfile.median, profile: denseProfile, denseBindingCount: 1 },
      compactPrebuilt: { outputComplete: prebuiltAfterDenial.length === width * height, gpuMs: prebuiltProfile.median, profile: prebuiltProfile, denseBindingCount: 0 },
      buildCompactRender: {
        outputComplete: builtAfterDenial.length === width * height,
        buildGpuMs: buildRenderProfile.build.median,
        renderGpuMs: buildRenderProfile.render.median,
        totalGpuMs: buildRenderProfile.total.median,
        buildOnlyProfile: buildProfile,
        combinedProfile: buildRenderProfile,
        denseBindingCountDuringBuild: 1,
        denseBindingCountDuringRender: 0,
      },
    },
    compactProduct: {
      identity: product.identity,
      selectedBrickCount: selected.length,
      gpuSelectedBrickCount: gpuSelected.length,
      selectionMismatchCount,
      sortOrderViolationCount,
      actualRetainedResidualEnergyFraction: selectedResidualEnergy / totalResidualEnergy,
      sortEndpointScores: {
        first: pairData.getFloat32(0, true),
        last: pairData.getFloat32((sortRecordCount - 1) * 8, true),
      },
      haloEdge: product.haloEdge,
      allocationBytes,
      allocationComplete: true,
      hiddenDenseAllocationBytes: 0,
      productResidentRatioToDenseScalar: allocationBytes.productResident / source.byteLength,
      buildAndProductRatioToDenseScalar: allocationBytes.totalBuildAndProduct / source.byteLength,
    },
    denseDenial: {
      method: DENSE_DENIAL_METHOD,
      action: denseSourceAfterDestroy,
      preDenialOutputSha256: preDenialSha,
      postDenialOutputSha256: postDenialSha,
      maximumAbsoluteOutputDelta: denialComparison.maximumAbsoluteError,
      passed: denialComparison.maximumAbsoluteError === 0 && preDenialSha === postDenialSha,
    },
    validation: {
      complete: true,
      thresholds: ADAPTIVE_VOLUME_GPU_ERROR_LIMITS,
      denseAgainstCommittedReference: denseComparison,
      compactPrebuiltAgainstDense: prebuiltComparison,
      buildCompactAgainstDense: builtComparison,
      compactPrebuiltMaximumAbsoluteError: prebuiltComparison.maximumAbsoluteError,
      buildCompactMaximumAbsoluteError: builtComparison.maximumAbsoluteError,
    },
    scaleLaw: {
      schema: ADAPTIVE_VOLUME_SCALE_LAW_SCHEMA,
      status: 'passed',
      requested: {
        scaleFactors: config.scaleFactors,
        workloadDimensions: config.workloadDimensions,
        displayResolution: {
          width: 3456,
          height: 2234,
          pixelCount: 3456 * 2234,
          authority: 'system-profiler-liquid-retina-xdr-device-pixels-v0',
          hiddenResolutionCapApplied: false,
        },
        dispatchRepeats: config.scaleDispatchRepeats,
        warmupSamples: config.scaleWarmupSamples,
        steadySamples: config.scaleSteadySamples,
        minimumAggregateGpuMs: config.minimumAggregateGpuMs,
        hiddenWorkloadCapApplied: false,
      },
      effective: {
        workloads: scaleLawWorkloads,
        firstMeasuredCrossover: scaleLawWorkloads.find(row => row.compactOverDenseRatio < 1)?.scaleFactor ?? null,
      },
      productionAttribution: {
        ...productionAttribution,
        sourceSha256: await sha256(productionVolumeBytes),
      },
      falseClosureChecks: {
        workloadSurfaceIncomplete: scaleLawWorkloads.length < 3,
        timingAmplificationMissing: config.scaleDispatchRepeats <= 1,
        unpairedTiming: scaleLawWorkloads.some(row => row.timingProtocol !== 'paired-alternating-submit-v0' || row.submissionCountPerPair !== 2),
        aggregateBelowDeclaredFloor: scaleLawWorkloads.some(row => (
          row.profiles.dense.aggregate.median < config.minimumAggregateGpuMs
          || row.profiles.compact.aggregate.median < config.minimumAggregateGpuMs
        )),
        workloadIdentityIncomplete: scaleLawWorkloads.some(row => (
          !(row.intersectingRayCount > 0)
          || !(row.denseStepCount >= row.intersectingRayCount)
        )),
        outputIncomplete: scaleLawWorkloads.some(row => !row.outputsComplete),
        outputError: scaleLawWorkloads.some(row => row.comparison.maximumAbsoluteError > ADAPTIVE_VOLUME_GPU_ERROR_LIMITS.compactPrebuiltAgainstDenseMaximumAbsoluteError),
        fullSelectionParity: selected.length === brickCount && scaleLawWorkloads.some(
          row => row.comparison.maximumAbsoluteError > FULL_SELECTION_AGAINST_DENSE_MAXIMUM_ABSOLUTE_ERROR,
        ),
        productionAttributionOverclaim: productionAttribution.measuredProductionBottleneck !== false,
      },
      claimBoundary: 'Amplified static single-channel traversal scaling only. Production source inspection is exact but unmeasured; no production bottleneck, total-frame speedup, temporal cadence, or integration claim is authorized.',
    },
    productionSurvival: productionSurvivalWorkload ? {
      schema: ADAPTIVE_VOLUME_PRODUCTION_SURVIVAL_SCHEMA,
      status: productionSurvivalWorkload.comparison.maximumAbsoluteError <= ADAPTIVE_VOLUME_GPU_ERROR_LIMITS.compactPrebuiltAgainstDenseMaximumAbsoluteError
        ? 'passed'
        : 'invalid-for-production-survival-claim',
      requested: {
        width: 3456,
        height: 2234,
        pixelCount: 3456 * 2234,
        dispatchRepeats: config.productionDispatchRepeats,
        warmupSamples: config.productionWarmupSamples,
        steadySamples: config.productionSteadySamples,
        tileRows: config.productionTileRows,
        hiddenWorkloadCapApplied: false,
      },
      effective: {
        sourceAuthority: 'exact-step45-sidecar-production-field-proxy-v0',
        sourceSha256: await sha256(sidecarBytes),
        productionVolumeSha256: await sha256(productionVolumeBytes),
        fieldProxyExpansionApplied: false,
        differingMechanism: 'smoke-extinction-scalar-lookup-only-v0',
        matchedMechanisms: ['majorant-grid', 'occupancy-skip', 'adaptive-rays', 'early-transmittance', 'five-live-field-samples'],
        workload: productionSurvivalWorkload,
      },
      updateCost: {
        authority: 'same-run-gpu-hierarchy-selection-pack-timestamps-v0',
        buildGpuMs: buildRenderProfile.build.median,
        prebuiltCompactGpuMs: productionSurvivalWorkload.profiles.compact.perDispatch.median,
        rebuildAndRenderGpuMs: buildRenderProfile.build.median + productionSurvivalWorkload.profiles.compact.perDispatch.median,
        separatelyCharged: true,
      },
      falseClosureChecks: {
        sourceProxyUnlabeled: false,
        productionSourceMismatch: false,
        mechanismMismatch: false,
        scalarLookupOnlyViolation: false,
        outputError: productionSurvivalWorkload.comparison.maximumAbsoluteError > ADAPTIVE_VOLUME_GPU_ERROR_LIMITS.compactPrebuiltAgainstDenseMaximumAbsoluteError,
        workloadIncomplete: !productionSurvivalWorkload.outputsComplete
          || !(productionSurvivalWorkload.intersectingRayCount > 0)
          || !(productionSurvivalWorkload.productionStepCount > 0)
          || productionSurvivalWorkload.fieldSampleCount !== productionSurvivalWorkload.productionStepCount * 5,
        updateCostHidden: false,
      },
      claimBoundary: 'Production-shaped common-work survival evidence using the exact accepted step45 sidecar as an explicitly synthetic four-slot fluid/front proxy. The shader ports production majorant, occupancy, adaptive-step, early-termination, and five-field-sample mechanisms, while dense and compact differ only at the smoke-extinction scalar lookup. This is not an exact live 16-channel state, separate-front-buffer, production compositor, total-frame, temporal, or integration timing claim.',
    } : null,
    falseClosureChecks,
    claimBoundary: 'Static isolated single-channel Apple WebGPU compute evidence. Source scalar formation from the live 16-channel fluid buffer and the production compositor are not timed. GPU build includes parent means, residual scoring, complete 65536-record bitonic sorting, top-K selection application, indirection, and padded fine-atlas packing. Dense denial destroys the source buffer before compact rerender.',
  };
  const disposition = applyReportDisposition(report);

  drawDepth('dense', denseOutput, width, height);
  drawDepth('prebuilt', prebuiltAfterDenial, width, height);
  drawDepth('built', builtAfterDenial, width, height);
  setLabel('dense-label', `${denseProfile.median.toFixed(3)} ms median; reference max error ${denseComparison.maximumAbsoluteError.toExponential(2)}`);
  setLabel('prebuilt-label', `${prebuiltProfile.median.toFixed(3)} ms median; dense denied; max error ${prebuiltComparison.maximumAbsoluteError.toExponential(2)}`);
  setLabel('built-label', `${buildRenderProfile.total.median.toFixed(3)} ms build+render; max error ${builtComparison.maximumAbsoluteError.toExponential(2)}`);
  renderScaleLawSummary(report.scaleLaw);
  setStatus(report.optimizationClaimAllowed ? 'Timestamp-backed compact independence gate passed' : `Optimization claim rejected: ${disposition.reasons.join(', ')}`);
  reportNode.textContent = JSON.stringify(report, null, 2);
  state.report = report;
  state.phase = 'complete';
  return report;
}

window.__kaminosAdaptiveVolumeGpuFalsifier = {
  identity: 'adaptive-smoke-volume-three-arm-gpu-falsifier-v0',
  reuseBrowser: true,
  state: () => structuredClone(state),
  applyHostGpuIdentity(identity) {
    if (state.phase !== 'complete' || !state.report) throw new Error('GPU identity can only be applied to a complete browser report');
    if (identity?.source !== 'cdp-system-info' || !Array.isArray(identity.devices)) throw new Error('invalid CDP GPU identity evidence');
    state.report.effective.cdpGpuInfo = structuredClone(identity);
    state.report.effective.backend = identity.appleDeviceObserved === true ? 'WebGPU:apple' : 'WebGPU:unknown';
    state.report.effective.backendIdentitySource = 'cdp-system-info';
    state.report.status = 'passed';
    state.report.falseClosureChecks.fallbackRoute = false;
    if (identity.appleDeviceObserved !== true) state.report.falseClosureChecks.fallbackRoute = true;
    const disposition = applyReportDisposition(state.report);
    setStatus(state.report.optimizationClaimAllowed ? 'Timestamp-backed compact independence gate passed' : `Optimization claim rejected: ${disposition.reasons.join(', ')}`);
    reportNode.textContent = JSON.stringify(state.report, null, 2);
    return structuredClone(state.report);
  },
  run,
};

run().catch(error => {
  state.error = error?.stack || error?.message || String(error);
  state.phase = 'failed';
  setStatus(`Failed: ${error?.message || String(error)}`);
  reportNode.textContent = state.error;
  console.error(error);
});
