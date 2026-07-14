import {
  COUPLED_PHASE_STATE_FAR_LAYOUT,
  COUPLED_PHASE_STATE_HISTORY_AUTHORITY,
  COUPLED_PHASE_STATE_NEAR_LAYOUT,
  COUPLED_PHASE_STATE_PRODUCER_IDENTITY,
  COUPLED_PHASE_STATE_RENDERER_AUTHORITY,
  COUPLED_PHASE_STATE_SCHEMA,
  COUPLED_PHASE_STATE_SOCKET_IDENTITY,
} from './coupled-smoke-domain.mjs';

export const COUPLED_LIVE_SMOKE_HIERARCHY_AUTHORITY = 'live-coupled-dense-state-owned-hierarchy-v0';
export const COUPLED_LIVE_SMOKE_PRODUCT_OWNERSHIP = 'renderer-owned-destroy-on-evict-v0';
export const COUPLED_LIVE_SMOKE_COMPILER_IDENTITY = 'same-device-dense-to-packed-spatial-strata-v0';
export const COUPLED_LIVE_SMOKE_ARCHIVE_IDENTITY = 'consecutive-owned-smoke-product-archive-v0';
export const COUPLED_LIVE_SMOKE_NEAR_OCCUPANCY_THRESHOLD = 0.0025;

const PACKED_SPLAT_BYTES = 16 * Float32Array.BYTES_PER_ELEMENT;
const WORKGROUP_SIZE = 64;

export function summarizePackedLiveSmokeProduct(packed, { coarseCount, fineCount } = {}) {
  if (!(packed instanceof Float32Array) || packed.length % 16 !== 0) {
    throw new TypeError('packed live smoke product length must be a complete float32x16 sequence');
  }
  const expectedCoarseCount = nonnegativeInteger(coarseCount, 'coarseCount');
  const expectedFineCount = nonnegativeInteger(fineCount, 'fineCount');
  if (packed.length !== (expectedCoarseCount + expectedFineCount) * 16) {
    throw new Error('packed live smoke product length does not match hierarchy counts');
  }
  const roleCounts = { coarse: 0, fine: 0, total: packed.length / 16 };
  const nonzeroCounts = { coarse: 0, fine: 0, total: 0 };
  const extinctionMass = { coarse: 0, fine: 0, total: 0 };
  const occupiedBounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
  let maxDensityWitness = 0;
  let maxTemperatureWitness = 0;
  let maxExtinctionMass = 0;
  const positiveDensity = [];
  const positiveExtinctionMass = [];
  for (let offset = 0; offset < packed.length; offset += 16) {
    const roleCode = packed[offset + 15];
    if (roleCode !== 0 && roleCode !== 1) throw new Error(`packed live smoke hierarchy role is invalid at ${offset / 16}`);
    const role = roleCode === 0 ? 'coarse' : 'fine';
    roleCounts[role] += 1;
    const mass = packed[offset + 9];
    const density = packed[offset + 10];
    const temperature = packed[offset + 11];
    if (![mass, density, temperature].every(Number.isFinite) || mass < 0 || density < 0 || temperature < 0) {
      throw new Error(`packed live smoke witnesses are invalid at ${offset / 16}`);
    }
    extinctionMass[role] += mass;
    extinctionMass.total += mass;
    maxExtinctionMass = Math.max(maxExtinctionMass, mass);
    maxDensityWitness = Math.max(maxDensityWitness, density);
    maxTemperatureWitness = Math.max(maxTemperatureWitness, temperature);
    if (mass <= 0) continue;
    positiveDensity.push(density);
    positiveExtinctionMass.push(mass);
    nonzeroCounts[role] += 1;
    nonzeroCounts.total += 1;
    for (let axis = 0; axis < 3; axis += 1) {
      const position = packed[offset + axis];
      if (!Number.isFinite(position)) throw new Error(`packed live smoke position is invalid at ${offset / 16}`);
      occupiedBounds.min[axis] = Math.min(occupiedBounds.min[axis], position);
      occupiedBounds.max[axis] = Math.max(occupiedBounds.max[axis], position);
    }
  }
  if (roleCounts.coarse !== expectedCoarseCount || roleCounts.fine !== expectedFineCount) {
    throw new Error(`packed live smoke hierarchy count mismatch: ${roleCounts.coarse}/${roleCounts.fine}`);
  }
  if (nonzeroCounts.total === 0) {
    occupiedBounds.min = null;
    occupiedBounds.max = null;
  }
  positiveDensity.sort((left, right) => left - right);
  positiveExtinctionMass.sort((left, right) => left - right);
  const quantiles = values => ({
    p50: values.length ? values[Math.floor((values.length - 1) * 0.50)] : 0,
    p90: values.length ? values[Math.floor((values.length - 1) * 0.90)] : 0,
    p99: values.length ? values[Math.floor((values.length - 1) * 0.99)] : 0,
    p999: values.length ? values[Math.floor((values.length - 1) * 0.999)] : 0,
  });
  return {
    identity: 'packed-live-smoke-product-telemetry-v0',
    totalSplats: roleCounts.total,
    roleCounts,
    nonzeroCounts,
    extinctionMass,
    maxExtinctionMass,
    maxDensityWitness,
    maxTemperatureWitness,
    positiveDensityQuantiles: quantiles(positiveDensity),
    positiveExtinctionMassQuantiles: quantiles(positiveExtinctionMass),
    occupiedBounds,
  };
}

export function assessCoupledLiveSmokeFarEvidence({
  products,
  domainTelemetry = null,
  nearDomainMaxY = 1,
} = {}) {
  if (!Array.isArray(products) || products.length !== 2) {
    throw new TypeError('far evidence requires exactly two consecutive packed product summaries');
  }
  const ceiling = Number(nearDomainMaxY);
  if (!Number.isFinite(ceiling)) throw new TypeError('nearDomainMaxY must be finite');
  const coarseCounts = products.map((product, index) => {
    const count = Number(product?.nonzeroCounts?.coarse);
    if (!Number.isInteger(count) || count < 0) throw new TypeError(`product ${index} coarse support count is invalid`);
    return count;
  });
  if (coarseCounts.some(count => count <= 0)) {
    throw new Error(`current packed products have no coarse support: ${coarseCounts.join(',')}`);
  }
  const maxOccupiedY = products.map((product, index) => {
    const value = Number(product?.occupiedBounds?.max?.[1]);
    if (!Number.isFinite(value)) throw new TypeError(`product ${index} occupied max y is invalid`);
    return value;
  });
  if (maxOccupiedY.some(value => !(value > ceiling))) {
    throw new Error(`coarse support has not advected beyond the near domain: ${maxOccupiedY.join(',')} <= ${ceiling}`);
  }
  const frameCount = Number(domainTelemetry?.frameCount);
  const readbackFrame = Number(domainTelemetry?.smokeDomainTransferLastReadbackFrame);
  const counterAgeFrames = Number.isFinite(frameCount) && Number.isFinite(readbackFrame)
    ? Math.max(0, frameCount - readbackFrame)
    : null;
  return {
    status: 'passed',
    authority: 'exact-packed-coarse-support-beyond-near-domain-v0',
    coarseCounts,
    maxOccupiedY,
    nearDomainMaxY: ceiling,
    counterAgeFrames,
    counterTelemetryFreshness: counterAgeFrames === 0 ? 'current-supporting' : 'stale-supporting-only',
  };
}

export async function inspectCoupledLiveSmokeProducts({ device, products } = {}) {
  if (!device?.queue || typeof device.createCommandEncoder !== 'function') throw new TypeError('a WebGPU device is required');
  if (!Array.isArray(products) || products.length === 0) throw new TypeError('live smoke products must be non-empty');
  const staging = products.map((product, index) => {
    if (!product?.packedBuffer || !Number.isInteger(product.packedByteLength) || product.packedByteLength <= 0) {
      throw new Error(`live smoke product ${index} is not readable`);
    }
    return device.createBuffer({
      label: `kaminos live smoke telemetry readback ${product.identity}`,
      size: product.packedByteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  });
  try {
    const encoder = device.createCommandEncoder({ label: 'kaminos live smoke telemetry copy' });
    products.forEach((product, index) => {
      encoder.copyBufferToBuffer(product.packedBuffer, 0, staging[index], 0, product.packedByteLength);
    });
    device.queue.submit([encoder.finish()]);
    await Promise.all(staging.map(buffer => buffer.mapAsync(GPUMapMode.READ)));
    return products.map((product, index) => {
      const packed = new Float32Array(staging[index].getMappedRange().slice(0));
      return {
        productIdentity: product.identity,
        phaseToken: { ...product.phaseToken },
        ...summarizePackedLiveSmokeProduct(packed, {
          coarseCount: product.hierarchyCounts.coarse,
          fineCount: product.hierarchyCounts.fine,
        }),
      };
    });
  } finally {
    staging.forEach(buffer => {
      try { buffer.unmap(); } catch {}
      buffer.destroy();
    });
  }
}

function nonnegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} must be a nonnegative integer`);
  return number;
}

function positiveInteger(value, label) {
  const number = nonnegativeInteger(value, label);
  if (number === 0) throw new Error(`${label} must be positive`);
  return number;
}

function nonnegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be finite and nonnegative`);
  return number;
}

function failure(message, failurePhase, details = {}) {
  const error = new Error(message);
  error.name = 'CoupledLiveSmokeHierarchyError';
  error.report = {
    identity: 'coupled-live-smoke-hierarchy-failure-v0',
    status: 'failed',
    failurePhase,
    ...details,
  };
  return error;
}

function normalizeToken(candidate, label = 'phase token') {
  if (!candidate || typeof candidate !== 'object') throw failure(`${label} is unavailable`, 'socket-validation');
  return {
    generation: nonnegativeInteger(candidate.generation, `${label} generation`),
    retainedHistoryEpoch: nonnegativeInteger(candidate.retainedHistoryEpoch, `${label} retainedHistoryEpoch`),
    writeTick: nonnegativeInteger(candidate.writeTick, `${label} writeTick`),
  };
}

function tokenIdentity(token) {
  return `${token.generation}:${token.retainedHistoryEpoch}:${token.writeTick}`;
}

function sameToken(left, right) {
  return left.generation === right.generation
    && left.retainedHistoryEpoch === right.retainedHistoryEpoch
    && left.writeTick === right.writeTick;
}

function validateDescriptor(descriptor, device) {
  if (!descriptor || typeof descriptor !== 'object') throw failure('coupled phase descriptor is unavailable', 'socket-validation');
  if (descriptor.schema !== COUPLED_PHASE_STATE_SCHEMA) throw failure('coupled phase descriptor schema mismatch', 'socket-validation');
  if (descriptor.socketIdentity !== COUPLED_PHASE_STATE_SOCKET_IDENTITY) throw failure('coupled phase socket identity mismatch', 'socket-validation');
  if (descriptor.producerIdentity !== COUPLED_PHASE_STATE_PRODUCER_IDENTITY) throw failure('coupled phase producer identity mismatch', 'socket-validation');
  if (descriptor.gpu?.ownership !== 'borrowed-producer-owned-do-not-destroy-v0') {
    throw failure('coupled phase input must remain explicitly producer-owned', 'socket-validation');
  }
  if (descriptor.gpu.device !== device || descriptor.gpu.queue !== device.queue) {
    throw failure('coupled phase state belongs to a different GPU device or queue', 'socket-validation');
  }
  if (descriptor.phase?.retainedHistoryAuthority !== COUPLED_PHASE_STATE_HISTORY_AUTHORITY
      || descriptor.phase?.retainedSlotCount !== 1
      || descriptor.phase?.historyOffset !== 0) {
    throw failure('coupled phase descriptor must expose current state only', 'socket-validation');
  }
  if (descriptor.renderer?.authority !== COUPLED_PHASE_STATE_RENDERER_AUTHORITY) {
    throw failure('coupled phase renderer authority mismatch', 'socket-validation');
  }
  const near = descriptor.domains?.near;
  const far = descriptor.domains?.far;
  if (!near?.buffer || !far?.buffer) throw failure('coupled phase dense buffers are incomplete', 'socket-validation');
  if (near.bufferLayout?.identity && near.bufferLayout.identity !== COUPLED_PHASE_STATE_NEAR_LAYOUT) {
    throw failure('coupled near-state layout mismatch', 'socket-validation');
  }
  if (far.bufferLayout?.identity && far.bufferLayout.identity !== COUPLED_PHASE_STATE_FAR_LAYOUT) {
    throw failure('coupled far-state layout mismatch', 'socket-validation');
  }
  positiveInteger(near.grid, 'near grid');
  positiveInteger(far.grid, 'far grid');
  return normalizeToken(descriptor.phase.token);
}

function compilerShader({ nearGrid, farGrid, nearOutputGrid, farOutputGrid, nearOccupancyThreshold }) {
  return `
struct PackedSplat { a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, d: vec4<f32> };
@group(0) @binding(0) var<storage, read> nearFluid: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> farState: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputSplats: array<PackedSplat>;

const NEAR_GRID: u32 = ${nearGrid}u;
const FAR_GRID: u32 = ${farGrid}u;
const NEAR_OUTPUT_GRID: u32 = ${nearOutputGrid}u;
const FAR_OUTPUT_GRID: u32 = ${farOutputGrid}u;
const FAR_OUTPUT_OFFSET: u32 = ${nearOutputGrid ** 3}u;
const NEAR_OCCUPANCY_THRESHOLD: f32 = ${nearOccupancyThreshold};

fn coord(index: u32, grid: u32) -> vec3<u32> {
  let z = index / (grid * grid);
  let remainder = index - z * grid * grid;
  let y = remainder / grid;
  return vec3<u32>(remainder - y * grid, y, z);
}

fn sourceRange(component: u32, sourceGrid: u32, outputGrid: u32) -> vec2<u32> {
  return vec2<u32>(component * sourceGrid / outputGrid, (component + 1u) * sourceGrid / outputGrid);
}

fn axisFromVelocity(velocity: vec3<f32>) -> vec3<f32> {
  let speed = length(velocity);
  return select(vec3<f32>(0.0, 1.0, 0.0), velocity / speed, speed > 0.000001);
}

fn packed(
  position: vec3<f32>,
  velocity: vec3<f32>,
  radii: vec3<f32>,
  extinctionMass: f32,
  densityWitness: f32,
  temperatureWitness: f32,
  role: f32,
) -> PackedSplat {
  let axis = axisFromVelocity(velocity);
  return PackedSplat(
    vec4<f32>(position, axis.x),
    vec4<f32>(axis.yz, radii.xy),
    vec4<f32>(radii.z, extinctionMass, densityWitness, temperatureWitness),
    vec4<f32>(velocity, role)
  );
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn compileNear(@builtin(global_invocation_id) id: vec3<u32>) {
  let outputIndex = id.x;
  if (outputIndex >= NEAR_OUTPUT_GRID * NEAR_OUTPUT_GRID * NEAR_OUTPUT_GRID) { return; }
  let outputCoord = coord(outputIndex, NEAR_OUTPUT_GRID);
  let rangeX = sourceRange(outputCoord.x, NEAR_GRID, NEAR_OUTPUT_GRID);
  let rangeY = sourceRange(outputCoord.y, NEAR_GRID, NEAR_OUTPUT_GRID);
  let rangeZ = sourceRange(outputCoord.z, NEAR_GRID, NEAR_OUTPUT_GRID);
  let cellSize = 2.0 / f32(NEAR_GRID);
  let cellVolume = cellSize * cellSize * cellSize;
  var mass = 0.0;
  var densityMass = 0.0;
  var temperatureMass = 0.0;
  var positionMass = vec3<f32>(0.0);
  var velocityMass = vec3<f32>(0.0);
  for (var z = rangeZ.x; z < rangeZ.y; z += 1u) {
    for (var y = rangeY.x; y < rangeY.y; y += 1u) {
      for (var x = rangeX.x; x < rangeX.y; x += 1u) {
        let cellIndex = x + NEAR_GRID * (y + NEAR_GRID * z);
        let velocityDensity = nearFluid[cellIndex * 4u];
        let smokeHeat = nearFluid[cellIndex * 4u + 1u];
        let microSmoke = nearFluid[cellIndex * 4u + 3u].x;
        let rawDensity = max(max(smokeHeat.x, velocityDensity.w * 0.35) + max(microSmoke, 0.0) * 0.25, 0.0);
        let density = select(0.0, rawDensity, rawDensity >= NEAR_OCCUPANCY_THRESHOLD);
        let cellMass = density * cellVolume;
        let position = (vec3<f32>(f32(x), f32(y), f32(z)) + vec3<f32>(0.5)) * cellSize - vec3<f32>(1.0);
        mass += cellMass;
        densityMass += density * cellMass;
        temperatureMass += max(smokeHeat.y, 0.0) * cellMass;
        positionMass += position * cellMass;
        velocityMass += velocityDensity.xyz * cellMass;
      }
    }
  }
  let fallbackPosition = (vec3<f32>(outputCoord) + vec3<f32>(0.5)) * (2.0 / f32(NEAR_OUTPUT_GRID)) - vec3<f32>(1.0);
  let position = select(fallbackPosition, positionMass / mass, mass > 0.0);
  let velocity = select(vec3<f32>(0.0), velocityMass / mass, mass > 0.0);
  let density = select(0.0, densityMass / mass, mass > 0.0);
  let temperature = select(0.0, temperatureMass / mass, mass > 0.0);
  let radius = 1.0 / f32(NEAR_OUTPUT_GRID);
  let speed = length(velocity);
  outputSplats[outputIndex] = packed(
    position,
    velocity,
    vec3<f32>(radius * 0.64, radius * (0.82 + min(speed, 2.0) * 0.14), radius * 0.64),
    mass,
    density,
    temperature,
    1.0
  );
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn compileFar(@builtin(global_invocation_id) id: vec3<u32>) {
  let localOutputIndex = id.x;
  if (localOutputIndex >= FAR_OUTPUT_GRID * FAR_OUTPUT_GRID * FAR_OUTPUT_GRID) { return; }
  let outputCoord = coord(localOutputIndex, FAR_OUTPUT_GRID);
  let rangeX = sourceRange(outputCoord.x, FAR_GRID, FAR_OUTPUT_GRID);
  let rangeY = sourceRange(outputCoord.y, FAR_GRID, FAR_OUTPUT_GRID);
  let rangeZ = sourceRange(outputCoord.z, FAR_GRID, FAR_OUTPUT_GRID);
  let cellSize = 4.0 / f32(FAR_GRID);
  let cellVolume = cellSize * cellSize * cellSize;
  var mass = 0.0;
  var densityMass = 0.0;
  var positionMass = vec3<f32>(0.0);
  var velocityMass = vec3<f32>(0.0);
  for (var z = rangeZ.x; z < rangeZ.y; z += 1u) {
    for (var y = rangeY.x; y < rangeY.y; y += 1u) {
      for (var x = rangeX.x; x < rangeX.y; x += 1u) {
        let cellIndex = x + FAR_GRID * (y + FAR_GRID * z);
        let state = farState[cellIndex];
        let position = vec3<f32>(
          -2.0 + (f32(x) + 0.5) * cellSize,
          0.5 + (f32(y) + 0.5) * cellSize,
          -2.0 + (f32(z) + 0.5) * cellSize
        );
        let inNearOverlap = abs(position.x) <= 1.0
          && position.y <= 1.0
          && abs(position.z) <= 1.0;
        let density = select(max(state.w, 0.0), 0.0, inNearOverlap);
        let cellMass = density * cellVolume;
        mass += cellMass;
        densityMass += density * cellMass;
        positionMass += position * cellMass;
        velocityMass += state.xyz * cellMass;
      }
    }
  }
  let fallbackPosition = vec3<f32>(
    -2.0 + (f32(outputCoord.x) + 0.5) * (4.0 / f32(FAR_OUTPUT_GRID)),
    0.5 + (f32(outputCoord.y) + 0.5) * (4.0 / f32(FAR_OUTPUT_GRID)),
    -2.0 + (f32(outputCoord.z) + 0.5) * (4.0 / f32(FAR_OUTPUT_GRID))
  );
  let position = select(fallbackPosition, positionMass / mass, mass > 0.0);
  let velocity = select(vec3<f32>(0.0), velocityMass / mass, mass > 0.0);
  let density = select(0.0, densityMass / mass, mass > 0.0);
  let radius = 2.0 / f32(FAR_OUTPUT_GRID);
  let speed = length(velocity);
  outputSplats[FAR_OUTPUT_OFFSET + localOutputIndex] = packed(
    position,
    velocity,
    vec3<f32>(radius * 0.68, radius * (0.88 + min(speed, 2.0) * 0.18), radius * 0.68),
    mass,
    density,
    0.0,
    0.0
  );
}
`;
}

export function createCoupledLiveSmokeHierarchyCompiler({
  device,
  nearOutputGrid = 40,
  farOutputGrid = 20,
  nearOccupancyThreshold = COUPLED_LIVE_SMOKE_NEAR_OCCUPANCY_THRESHOLD,
} = {}) {
  if (!device?.queue || typeof device.createBuffer !== 'function') throw new TypeError('a WebGPU device is required');
  const effectiveNearOutputGrid = positiveInteger(nearOutputGrid, 'nearOutputGrid');
  const effectiveFarOutputGrid = positiveInteger(farOutputGrid, 'farOutputGrid');
  const effectiveNearOccupancyThreshold = nonnegativeNumber(nearOccupancyThreshold, 'nearOccupancyThreshold');
  const pipelineCache = new Map();
  let disposed = false;

  function pipelinesFor(descriptor) {
    const nearGrid = positiveInteger(descriptor.domains.near.grid, 'near grid');
    const farGrid = positiveInteger(descriptor.domains.far.grid, 'far grid');
    if (effectiveNearOutputGrid > nearGrid || effectiveFarOutputGrid > farGrid) {
      throw failure('hierarchy output grids must not exceed their dense source grids', 'compiler-configuration');
    }
    const key = `${nearGrid}:${farGrid}:${effectiveNearOutputGrid}:${effectiveFarOutputGrid}`;
    let cached = pipelineCache.get(key);
    if (cached) return cached;
    const module = device.createShaderModule({
      label: `kaminos ${COUPLED_LIVE_SMOKE_COMPILER_IDENTITY} ${key}`,
      code: compilerShader({
        nearGrid,
        farGrid,
        nearOutputGrid: effectiveNearOutputGrid,
        farOutputGrid: effectiveFarOutputGrid,
        nearOccupancyThreshold: effectiveNearOccupancyThreshold,
      }),
    });
    cached = {
      near: device.createComputePipeline({
        label: 'kaminos live smoke near hierarchy compiler',
        layout: 'auto',
        compute: { module, entryPoint: 'compileNear' },
      }),
      far: device.createComputePipeline({
        label: 'kaminos live smoke far hierarchy compiler',
        layout: 'auto',
        compute: { module, entryPoint: 'compileFar' },
      }),
      key,
    };
    pipelineCache.set(key, cached);
    return cached;
  }

  function compileCurrent(descriptor, { commandEncoder = null } = {}) {
    if (disposed) throw failure('live smoke hierarchy compiler is disposed', 'hierarchy-compilation');
    const phaseToken = validateDescriptor(descriptor, device);
    const pipelines = pipelinesFor(descriptor);
    const fineCount = effectiveNearOutputGrid ** 3;
    const coarseCount = effectiveFarOutputGrid ** 3;
    const splatCount = fineCount + coarseCount;
    const packedBuffer = device.createBuffer({
      label: `kaminos owned live smoke hierarchy ${tokenIdentity(phaseToken)}`,
      size: splatCount * PACKED_SPLAT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    try {
      const nearResources = [
        { binding: 0, resource: { buffer: descriptor.domains.near.buffer } },
        { binding: 2, resource: { buffer: packedBuffer } },
      ];
      const farResources = [
        { binding: 1, resource: { buffer: descriptor.domains.far.buffer } },
        { binding: 2, resource: { buffer: packedBuffer } },
      ];
      const nearBindGroup = device.createBindGroup({
        label: 'kaminos live smoke near hierarchy compiler bind group',
        layout: pipelines.near.getBindGroupLayout(0),
        entries: nearResources,
      });
      const farBindGroup = device.createBindGroup({
        label: 'kaminos live smoke far hierarchy compiler bind group',
        layout: pipelines.far.getBindGroupLayout(0),
        entries: farResources,
      });
      const encoder = commandEncoder
        ?? device.createCommandEncoder({ label: 'kaminos live smoke hierarchy compile' });
      const pass = encoder.beginComputePass({ label: 'kaminos live smoke hierarchy compile pass' });
      pass.setPipeline(pipelines.near);
      pass.setBindGroup(0, nearBindGroup);
      pass.dispatchWorkgroups(Math.ceil(fineCount / WORKGROUP_SIZE));
      pass.setPipeline(pipelines.far);
      pass.setBindGroup(0, farBindGroup);
      pass.dispatchWorkgroups(Math.ceil(coarseCount / WORKGROUP_SIZE));
      pass.end();
      if (!commandEncoder) device.queue.submit([encoder.finish()]);
    } catch (cause) {
      packedBuffer.destroy();
      throw failure('live smoke hierarchy compilation failed', 'hierarchy-compilation', {
        token: phaseToken,
        cause: cause?.message || String(cause),
      });
    }

    return {
      identity: `coupled-live-smoke-product:${tokenIdentity(phaseToken)}:${pipelines.key}`,
      schema: 'kaminos.coupled-live-smoke-hierarchy-product.v0',
      authority: COUPLED_LIVE_SMOKE_HIERARCHY_AUTHORITY,
      producerAuthority: COUPLED_LIVE_SMOKE_HIERARCHY_AUTHORITY,
      compilerIdentity: COUPLED_LIVE_SMOKE_COMPILER_IDENTITY,
      ownership: COUPLED_LIVE_SMOKE_PRODUCT_OWNERSHIP,
      device,
      phaseToken,
      slotIdentity: {
        simulatorGeneration: phaseToken.generation,
        historySlot: phaseToken.writeTick % 2,
        slotWriteTick: phaseToken.writeTick,
        modelIdentity: COUPLED_LIVE_SMOKE_HIERARCHY_AUTHORITY,
      },
      packedBuffer,
      packedByteLength: splatCount * PACKED_SPLAT_BYTES,
      splatCount,
      hierarchyCounts: { coarse: coarseCount, fine: fineCount, total: splatCount },
      representation: {
        nearOutputGrid: effectiveNearOutputGrid,
        farOutputGrid: effectiveFarOutputGrid,
        outputWasTruncated: false,
        sourceBuffersRetained: false,
        overlapAuthority: 'near-authoritative-far-overlap-suppressed-v0',
        nearOccupancyThreshold: effectiveNearOccupancyThreshold,
      },
    };
  }

  return {
    compileCurrent,
    debugState() {
      return {
        identity: COUPLED_LIVE_SMOKE_COMPILER_IDENTITY,
        status: disposed ? 'disposed' : 'active',
        nearOutputGrid: effectiveNearOutputGrid,
        farOutputGrid: effectiveFarOutputGrid,
        nearOccupancyThreshold: effectiveNearOccupancyThreshold,
        pipelineVariantCount: pipelineCache.size,
      };
    },
    dispose() {
      disposed = true;
      pipelineCache.clear();
    },
  };
}

function destroyProduct(product) {
  product?.packedBuffer?.destroy?.();
}

function validateProduct(product, device, token) {
  if (!product || typeof product !== 'object') throw new Error('compiler returned no product');
  if (product.authority !== COUPLED_LIVE_SMOKE_HIERARCHY_AUTHORITY) throw new Error('compiled product authority mismatch');
  if (product.ownership !== COUPLED_LIVE_SMOKE_PRODUCT_OWNERSHIP) throw new Error('compiled product ownership mismatch');
  if (product.device !== device) throw new Error('compiled product device mismatch');
  if (!sameToken(normalizeToken(product.phaseToken, 'compiled product phase token'), token)) {
    throw new Error('compiled product phase token mismatch');
  }
  if (!product.packedBuffer?.destroy) throw new Error('compiled product has no owned packed buffer');
  const total = positiveInteger(product.splatCount, 'compiled product splatCount');
  if (product.hierarchyCounts?.total !== total) throw new Error('compiled product hierarchy count mismatch');
  return product;
}

export function createCoupledLiveSmokeHierarchyArchive({ device, compileCurrent } = {}) {
  if (!device?.queue) throw new TypeError('a WebGPU device is required');
  if (typeof compileCurrent !== 'function') throw new TypeError('compileCurrent must be a function');
  let products = [];
  let status = 'empty';
  let disposed = false;
  let lastFailure = null;

  function latestToken() {
    return products.at(-1)?.phaseToken ?? null;
  }

  function clearProducts() {
    products.forEach(destroyProduct);
    products = [];
  }

  function report() {
    return {
      identity: COUPLED_LIVE_SMOKE_ARCHIVE_IDENTITY,
      authority: COUPLED_LIVE_SMOKE_HIERARCHY_AUTHORITY,
      status,
      consecutiveProductCount: products.length,
      productTokens: products.map(product => ({ ...product.phaseToken })),
      newestToken: latestToken() ? { ...latestToken() } : null,
      lastFailure,
    };
  }

  function capture(descriptor, compileOptions = {}) {
    if (disposed) throw failure('live smoke hierarchy archive is disposed', 'archive-lifecycle');
    let token;
    try {
      token = validateDescriptor(descriptor, device);
    } catch (error) {
      lastFailure = error.report ?? { failurePhase: 'socket-validation', cause: error.message };
      throw error;
    }
    const latest = latestToken();
    if (latest && sameToken(token, latest)) {
      status = 'duplicate-current-noop';
      return report();
    }
    if (latest
        && token.generation === latest.generation
        && token.retainedHistoryEpoch === latest.retainedHistoryEpoch
        && token.writeTick < latest.writeTick) {
      const error = failure('coupled phase state token moved backwards', 'current-token-ordering', {
        currentToken: token,
        lastTrustworthyToken: { ...latest },
      });
      lastFailure = error.report;
      throw error;
    }

    let candidate = null;
    let product;
    try {
      candidate = compileCurrent(descriptor, compileOptions);
      product = validateProduct(candidate, device, token);
    } catch (cause) {
      if (candidate?.packedBuffer && candidate.ownership === COUPLED_LIVE_SMOKE_PRODUCT_OWNERSHIP) {
        destroyProduct(candidate);
      }
      const error = cause?.report?.failurePhase === 'hierarchy-compilation'
        ? cause
        : failure('coupled live smoke hierarchy compiler failed', 'hierarchy-compilation', {
            token,
            lastTrustworthyToken: latest ? { ...latest } : null,
            cause: cause?.message || String(cause),
          });
      if (!Object.hasOwn(error.report, 'lastTrustworthyToken')) {
        error.report.lastTrustworthyToken = latest ? { ...latest } : null;
      }
      lastFailure = error.report;
      throw error;
    }

    let nextStatus = 'warming';
    if (!latest) {
      products = [product];
    } else if (token.generation !== latest.generation) {
      clearProducts();
      products = [product];
      nextStatus = 'warming-after-generation-reset';
    } else if (token.retainedHistoryEpoch !== latest.retainedHistoryEpoch) {
      clearProducts();
      products = [product];
      nextStatus = 'warming-after-retained-history-reset';
    } else if (token.writeTick !== latest.writeTick + 1) {
      clearProducts();
      products = [product];
      nextStatus = 'warming-after-write-gap';
    } else {
      products.push(product);
      if (products.length > 2) destroyProduct(products.shift());
      nextStatus = products.length === 2 ? 'consecutive-history-available' : 'warming';
    }
    status = nextStatus;
    lastFailure = null;
    return report();
  }

  function getConsecutiveProducts() {
    if (disposed) throw failure('live smoke hierarchy archive is disposed', 'archive-lifecycle');
    if (products.length !== 2
        || products[0].phaseToken.generation !== products[1].phaseToken.generation
        || products[0].phaseToken.retainedHistoryEpoch !== products[1].phaseToken.retainedHistoryEpoch
        || products[0].phaseToken.writeTick + 1 !== products[1].phaseToken.writeTick) {
      throw failure('two consecutive owned smoke products are unavailable', 'consecutive-history-resolution', {
        lastTrustworthyToken: latestToken() ? { ...latestToken() } : null,
        availableTokens: products.map(product => ({ ...product.phaseToken })),
      });
    }
    return [...products];
  }

  return {
    capture,
    getConsecutiveProducts,
    inspectConsecutiveProductTelemetry() {
      const consecutive = getConsecutiveProducts();
      return inspectCoupledLiveSmokeProducts({ device, products: consecutive });
    },
    debugState: report,
    dispose() {
      if (disposed) return;
      clearProducts();
      disposed = true;
      status = 'disposed';
    },
  };
}
