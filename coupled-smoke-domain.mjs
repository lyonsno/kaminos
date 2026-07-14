export const COUPLED_SMOKE_ATTACHMENT_IDENTITY = 'coupled-near-far-raymarched-smoke-attachment-v0';
export const COUPLED_SMOKE_OVERLAP_AUTHORITY = 'near-authoritative-overlap-far-residual-v0';
export const COUPLED_SMOKE_DEPTH_CONTRACT = 'splat-depth-conditioned-front-back-near-far-smoke-intervals-v1';
export const COUPLED_PHASE_STATE_SOCKET_IDENTITY = 'coupled-near-far-phase-state-socket-v0';
export const COUPLED_PHASE_STATE_SCHEMA = 'kaminos.coupled-smoke.phase-state.v0';
export const COUPLED_PHASE_STATE_PRODUCER_IDENTITY = 'native-near-far-fluid-state-export-v0';
export const COUPLED_PHASE_STATE_NEAR_LAYOUT = 'fluid-4xvec4f-per-cell-v0';
export const COUPLED_PHASE_STATE_FAR_LAYOUT = 'velocity-density-extinction-proxy-vec4f-per-cell-v0';
export const COUPLED_PHASE_STATE_HISTORY_AUTHORITY = 'current-state-only-no-fabricated-phase-history-v0';
export const COUPLED_PHASE_STATE_RENDERER_AUTHORITY = 'renderer-neutral-state-only-v0';

const WORLD_CONTRACT = Object.freeze({
  identity: 'explicit-2x-world-bounds-upper-quarter-overlap-v0',
  near: Object.freeze({
    min: Object.freeze([-1, -1, -1]),
    max: Object.freeze([1, 1, 1]),
  }),
  far: Object.freeze({
    min: Object.freeze([-2, 0.5, -2]),
    max: Object.freeze([2, 4.5, 2]),
  }),
  overlap: Object.freeze({
    min: Object.freeze([-1, 0.5, -1]),
    max: Object.freeze([1, 1, 1]),
  }),
  farLinearExtentRatio: 2,
  farVolumeRatio: 8,
});

function positiveGrid(value, label) {
  const grid = Number(value);
  if (!Number.isFinite(grid) || grid <= 0) throw new Error(`${label} must be a positive finite number`);
  return grid;
}

function nonnegativeInteger(value, label) {
  const integer = Number(value);
  if (!Number.isInteger(integer) || integer < 0) throw new Error(`${label} must be a nonnegative integer`);
  return integer;
}

function assertExpectedVersion(expected, effective, label) {
  if (expected === null || expected === undefined) return;
  const normalizedExpected = nonnegativeInteger(expected, `expected ${label}`);
  if (normalizedExpected !== effective) {
    throw new Error(`coupled phase state stale ${label}: expected ${normalizedExpected}, effective ${effective}`);
  }
}

function unitFromWorld(bounds) {
  const scale = bounds.min.map((minimum, index) => 1 / (bounds.max[index] - minimum));
  return {
    scale,
    offset: bounds.min.map((minimum, index) => -minimum * scale[index]),
  };
}

export function smokeDomainWorldContract() {
  return {
    identity: WORLD_CONTRACT.identity,
    near: { min: [...WORLD_CONTRACT.near.min], max: [...WORLD_CONTRACT.near.max] },
    far: { min: [...WORLD_CONTRACT.far.min], max: [...WORLD_CONTRACT.far.max] },
    overlap: { min: [...WORLD_CONTRACT.overlap.min], max: [...WORLD_CONTRACT.overlap.max] },
    farLinearExtentRatio: WORLD_CONTRACT.farLinearExtentRatio,
    farVolumeRatio: WORLD_CONTRACT.farVolumeRatio,
  };
}

export function smokeDomainMetricVelocityScale(nearGrid, farGrid) {
  const near = positiveGrid(nearGrid, 'nearGrid');
  const far = positiveGrid(farGrid, 'farGrid');
  return far / (2 * near);
}

export function createCoupledSmokePhaseStateDescriptor({
  active,
  generation,
  retainedHistoryEpoch,
  writeTick,
  nearGrid,
  farGrid,
  nearBuffer,
  farBuffer,
  farBufferIndex,
  historyOffset = 0,
  expectedGeneration = null,
  expectedRetainedHistoryEpoch = null,
  expectedWriteTick = null,
} = {}) {
  if (!active) throw new Error('coupled phase state socket inactive');
  const effectiveGeneration = nonnegativeInteger(generation, 'generation');
  const effectiveRetainedHistoryEpoch = nonnegativeInteger(retainedHistoryEpoch, 'retainedHistoryEpoch');
  const effectiveWriteTick = nonnegativeInteger(writeTick, 'writeTick');
  const requestedHistoryOffset = nonnegativeInteger(historyOffset, 'historyOffset');
  if (requestedHistoryOffset !== 0) {
    throw new Error(`coupled phase state history offset ${requestedHistoryOffset} unavailable; retained slot count is 1`);
  }
  assertExpectedVersion(expectedGeneration, effectiveGeneration, 'generation');
  assertExpectedVersion(expectedRetainedHistoryEpoch, effectiveRetainedHistoryEpoch, 'retained-history epoch');
  assertExpectedVersion(expectedWriteTick, effectiveWriteTick, 'write tick');
  if (!nearBuffer) throw new Error('coupled phase state nearBuffer is unavailable');
  if (!farBuffer) throw new Error('coupled phase state farBuffer is unavailable');
  const effectiveFarBufferIndex = nonnegativeInteger(farBufferIndex, 'farBufferIndex');
  if (effectiveFarBufferIndex > 1) throw new Error('farBufferIndex must identify ping-pong state 0 or 1');
  const effectiveNearGrid = Math.round(positiveGrid(nearGrid, 'nearGrid'));
  const effectiveFarGrid = Math.round(positiveGrid(farGrid, 'farGrid'));
  const world = smokeDomainWorldContract();

  return {
    schema: COUPLED_PHASE_STATE_SCHEMA,
    socketIdentity: COUPLED_PHASE_STATE_SOCKET_IDENTITY,
    producerIdentity: COUPLED_PHASE_STATE_PRODUCER_IDENTITY,
    phase: {
      token: {
        generation: effectiveGeneration,
        retainedHistoryEpoch: effectiveRetainedHistoryEpoch,
        writeTick: effectiveWriteTick,
      },
      retainedHistoryAuthority: COUPLED_PHASE_STATE_HISTORY_AUTHORITY,
      writeTickAuthority: 'command-encoded-order-not-queue-completion-v0',
      retainedSlotCount: 1,
      historyOffset: requestedHistoryOffset,
      currentFarStateIndex: effectiveFarBufferIndex,
    },
    domains: {
      near: {
        role: 'near-fire-and-smoke-state',
        grid: effectiveNearGrid,
        worldBounds: world.near,
        unitFromWorld: unitFromWorld(world.near),
        buffer: nearBuffer,
        bufferLayout: {
          identity: COUPLED_PHASE_STATE_NEAR_LAYOUT,
          bytesPerCell: 64,
          slots: [
            { index: 0, channels: ['velocity-x', 'velocity-y', 'velocity-z', 'density'] },
            { index: 1, channels: ['smoke', 'heat', 'fuel', 'material-detail'] },
            { index: 2, channels: ['flame', 'ember', 'flame-detail', 'combustion-front'] },
            { index: 3, channels: ['micro-smoke', 'interface-shred', 'fire-lick', 'ember-fleck'] },
          ],
        },
        witnesses: {
          conservativeDensityExtinction: {
            authority: 'near-density-material-microdetail-source-fields-v0',
            availability: 'source-fields-present-derivation-consumer-owned',
          },
          transport: { authority: 'near-velocity-density-slot-v0', availability: 'source-fields-present' },
          materialTemperature: {
            authority: 'near-material-fire-microdetail-slots-v0',
            availability: 'source-fields-present',
            temperatureAuthority: 'normalized-simulation-heat-witness-not-kelvin-v0',
          },
        },
      },
      far: {
        role: 'far-smoke-transport-state',
        grid: effectiveFarGrid,
        worldBounds: world.far,
        unitFromWorld: unitFromWorld(world.far),
        buffer: farBuffer,
        bufferLayout: {
          identity: COUPLED_PHASE_STATE_FAR_LAYOUT,
          bytesPerCell: 16,
          channels: ['velocity-x', 'velocity-y', 'velocity-z', 'density-extinction-proxy'],
        },
        witnesses: {
          conservativeDensityExtinction: {
            authority: 'far-density-is-extinction-proxy-v0',
            availability: 'source-field-present',
          },
          transport: { authority: 'far-velocity-density-state-v0', availability: 'source-fields-present' },
          materialTemperature: {
            authority: 'not-carried-by-far-vec4-state-v0',
            availability: 'unavailable',
          },
        },
      },
    },
    overlap: {
      authority: COUPLED_SMOKE_OVERLAP_AUTHORITY,
      depthContract: COUPLED_SMOKE_DEPTH_CONTRACT,
      worldBounds: world.overlap,
      axisIntervals: {
        x: [world.overlap.min[0], world.overlap.max[0]],
        y: [world.overlap.min[1], world.overlap.max[1]],
        z: [world.overlap.min[2], world.overlap.max[2]],
      },
    },
    renderer: {
      authority: COUPLED_PHASE_STATE_RENDERER_AUTHORITY,
      ownsRasterization: false,
      ownsPhaseSlotCache: false,
      ownsHierarchyProduction: false,
      consumerSynchronization: 'same-device-queue-order-or-explicit-onSubmittedWorkDone-v0',
    },
  };
}

export function coupledSmokeDomainShaderWGSL(nearGrid, farGrid, fluidSlotsPerCell = 4) {
  const near = Math.round(positiveGrid(nearGrid, 'nearGrid'));
  const far = Math.round(positiveGrid(farGrid, 'farGrid'));
  const slots = Math.round(positiveGrid(fluidSlotsPerCell, 'fluidSlotsPerCell'));
  const metricVelocityScale = smokeDomainMetricVelocityScale(near, far);
  return `
const NEAR_GRID: u32 = ${near}u;
const FAR_GRID: u32 = ${far}u;
const FLUID_STRIDE: u32 = ${slots}u;
const METRIC_VELOCITY_SCALE: f32 = ${metricVelocityScale.toFixed(9)};

@group(0) @binding(0) var<storage, read> nearFluid: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> smokeDomainTransferBuffer: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> farStateSrc: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> farStateDst: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> transferCounters: array<atomic<u32>>;

struct SmokeDomainUniforms {
  invViewProj: mat4x4<f32>,
  cameraPos_time: vec4<f32>,
};

@group(0) @binding(5) var<uniform> smokeDomainUniforms: SmokeDomainUniforms;
@group(1) @binding(1) var hybridSplatDepthMoments: texture_2d<f32>;
@group(1) @binding(2) var hybridSplatDepthSampler: sampler;

fn farIndex(c: vec3<u32>) -> u32 {
  return c.x + c.y * FAR_GRID + c.z * FAR_GRID * FAR_GRID;
}

fn nearIndex(c: vec3<u32>) -> u32 {
  return (c.x + c.y * NEAR_GRID + c.z * NEAR_GRID * NEAR_GRID) * FLUID_STRIDE;
}

fn readFarState(c: vec3<i32>) -> vec4<f32> {
  let hi = i32(FAR_GRID) - 1;
  let clamped = vec3<u32>(clamp(c, vec3<i32>(0), vec3<i32>(hi)));
  return farStateSrc[farIndex(clamped)];
}

fn sampleFarStateTrilinear(p: vec3<f32>) -> vec4<f32> {
  let hi = f32(FAR_GRID - 1u);
  if (any(p < vec3<f32>(0.0)) || any(p > vec3<f32>(hi))) { return vec4<f32>(0.0); }
  let base = vec3<i32>(floor(p));
  let f = fract(p);
  let x00 = mix(readFarState(base), readFarState(base + vec3<i32>(1, 0, 0)), f.x);
  let x10 = mix(readFarState(base + vec3<i32>(0, 1, 0)), readFarState(base + vec3<i32>(1, 1, 0)), f.x);
  let x01 = mix(readFarState(base + vec3<i32>(0, 0, 1)), readFarState(base + vec3<i32>(1, 0, 1)), f.x);
  let x11 = mix(readFarState(base + vec3<i32>(0, 1, 1)), readFarState(base + vec3<i32>(1, 1, 1)), f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}

@compute @workgroup_size(4, 4, 4)
fn csSmokeDomainOutlet(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(FAR_GRID))) { return; }
  let dst = farIndex(gid);
  let injectionDepth = max(2u, FAR_GRID / 8u);
  let inletSpan = max(4u, FAR_GRID / 2u);
  let inletMin = (FAR_GRID - inletSpan) / 2u;
  let inletMax = inletMin + inletSpan;
  if (gid.y >= injectionDepth || gid.x < inletMin || gid.x >= inletMax || gid.z < inletMin || gid.z >= inletMax) {
    smokeDomainTransferBuffer[dst] = vec4<f32>(0.0);
    return;
  }
  let inletCell = vec2<u32>(gid.x - inletMin, gid.z - inletMin);
  let x = min(NEAR_GRID - 1u, (inletCell.x * NEAR_GRID + NEAR_GRID / 2u) / inletSpan);
  let z = min(NEAR_GRID - 1u, (inletCell.y * NEAR_GRID + NEAR_GRID / 2u) / inletSpan);
  let outletBase = (NEAR_GRID * 3u) / 4u;
  let outletSpan = max(1u, NEAR_GRID - outletBase - 1u);
  let y = min(NEAR_GRID - 1u, outletBase + (gid.y * outletSpan) / max(1u, injectionDepth - 1u));
  let base = nearIndex(vec3<u32>(x, y, z));
  let velocityDensity = nearFluid[base];
  let material = nearFluid[base + 1u];
  let smoke = max(velocityDensity.w * 0.72, material.x);
  smokeDomainTransferBuffer[dst] = vec4<f32>(velocityDensity.xyz * METRIC_VELOCITY_SCALE, smoke);
  if (smoke > 0.01) { atomicAdd(&transferCounters[0], 1u); }
}

@compute @workgroup_size(4, 4, 4)
fn csSmokeDomainFarInput(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(FAR_GRID))) { return; }
  let index = farIndex(gid);
  let previous = farStateSrc[index];
  let injection = smokeDomainTransferBuffer[index];
  let rise = 0.12 + max(0.0, previous.y) * 1.15 + previous.w * 0.05;
  let backtrace = vec3<f32>(gid) - vec3<f32>(previous.x * 1.15, rise, previous.z * 1.15);
  let advected = sampleFarStateTrilinear(backtrace);
  let smokeCandidate = max(advected.w * 0.996, injection.w);
  let smoke = select(0.0, smokeCandidate, smokeCandidate > 0.012);
  var velocity = mix(advected.xyz * 0.997, injection.xyz, clamp(injection.w * 0.65, 0.0, 0.72));
  velocity.y = velocity.y + smoke * 0.002;
  farStateDst[index] = vec4<f32>(velocity, smoke);
  if (smoke > 0.01) { atomicAdd(&transferCounters[1], 1u); }
  let injectionDepth = max(2u, FAR_GRID / 8u);
  if (smoke > 0.01 && gid.y >= injectionDepth) {
    atomicAdd(&transferCounters[2], 1u);
    atomicMax(&transferCounters[3], gid.y);
  }
  if (smoke > 0.01 && gid.y + 2u >= FAR_GRID) {
    atomicAdd(&transferCounters[4], 1u);
    if (velocity.y > 0.01) { atomicAdd(&transferCounters[5], 1u); }
  }
}

struct SmokeDomainVSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct SmokeDomainLayerOutput {
  @location(0) frontColor: vec4<f32>,
  @location(1) frontInterval: vec4<f32>,
  @location(2) backColor: vec4<f32>,
  @location(3) backInterval: vec4<f32>,
};

@vertex
fn vsSmokeDomainLayer(@builtin(vertex_index) i: u32) -> SmokeDomainVSOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(3.0, 1.0),
    vec2<f32>(-1.0, 1.0)
  );
  var out: SmokeDomainVSOut;
  out.pos = vec4<f32>(positions[i], 0.0, 1.0);
  out.uv = positions[i] * 0.5 + vec2<f32>(0.5);
  return out;
}

fn smokeDomainSlabAxis(origin: f32, direction: f32, lo: f32, hi: f32) -> vec2<f32> {
  if (abs(direction) < 0.000001) {
    if (origin < lo || origin > hi) { return vec2<f32>(1.0, -1.0); }
    return vec2<f32>(-1e20, 1e20);
  }
  let a = (lo - origin) / direction;
  let b = (hi - origin) / direction;
  return vec2<f32>(min(a, b), max(a, b));
}

fn smokeDomainBoxHit(ro: vec3<f32>, rd: vec3<f32>, lo: vec3<f32>, hi: vec3<f32>) -> vec2<f32> {
  let sx = smokeDomainSlabAxis(ro.x, rd.x, lo.x, hi.x);
  let sy = smokeDomainSlabAxis(ro.y, rd.y, lo.y, hi.y);
  let sz = smokeDomainSlabAxis(ro.z, rd.z, lo.z, hi.z);
  return vec2<f32>(max(max(sx.x, sy.x), sz.x), min(min(sx.y, sy.y), sz.y));
}

fn nearAuthoritativeOverlap(p: vec3<f32>) -> bool {
  return all(p >= vec3<f32>(-1.0)) && all(p <= vec3<f32>(1.0));
}

@fragment
fn fsSmokeDomainLayer(in: SmokeDomainVSOut) -> SmokeDomainLayerOutput {
  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0);
  let nearWorldRaw = smokeDomainUniforms.invViewProj * vec4<f32>(ndc, -1.0, 1.0);
  let farWorldRaw = smokeDomainUniforms.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let nearWorld = nearWorldRaw.xyz / nearWorldRaw.w;
  let farWorld = farWorldRaw.xyz / farWorldRaw.w;
  let ro = smokeDomainUniforms.cameraPos_time.xyz;
  let rd = normalize(farWorld - nearWorld);
  let boundsMin = vec3<f32>(-2.0, 0.5, -2.0);
  let boundsMax = vec3<f32>(2.0, 4.5, 2.0);
  let hit = smokeDomainBoxHit(ro, rd, boundsMin, boundsMax);
  let tStart = max(hit.x, 0.0);
  let hybridLayerUv = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
  let splatDepthMoments = textureSampleLevel(hybridSplatDepthMoments, hybridSplatDepthSampler, hybridLayerUv, 0.0);
  let hybridSplatPresent = splatDepthMoments.y > 0.000001;
  let hybridSplatDepth = splatDepthMoments.x / max(splatDepthMoments.y, 0.000001);
  var out: SmokeDomainLayerOutput;
  if (hit.y <= tStart) {
    out.frontColor = vec4<f32>(0.0);
    out.frontInterval = vec4<f32>(0.0);
    out.backColor = vec4<f32>(0.0);
    out.backInterval = vec4<f32>(0.0);
    return out;
  }
  let stepCount = 64.0;
  let stepLength = (hit.y - tStart) / stepCount;
  var frontColor = vec3<f32>(0.0);
  var frontTransmittance = 1.0;
  var frontDepthMoment = 0.0;
  var frontDepthWeight = 0.0;
  var frontNearDepth = 1e9;
  var frontFarDepth = 0.0;
  var backColor = vec3<f32>(0.0);
  var backTransmittance = 1.0;
  var backDepthMoment = 0.0;
  var backDepthWeight = 0.0;
  var backNearDepth = 1e9;
  var backFarDepth = 0.0;
  for (var i = 0u; i < 64u; i = i + 1u) {
    let t = tStart + (f32(i) + 0.5) * stepLength;
    let p = ro + rd * t;
    if (nearAuthoritativeOverlap(p)) { continue; }
    let uv = clamp((p - boundsMin) / (boundsMax - boundsMin), vec3<f32>(0.0), vec3<f32>(1.0));
    let sample = sampleFarStateTrilinear(uv * f32(FAR_GRID - 1u));
    let smoke = max(0.0, sample.w);
    let extinctionStep = clamp(smoke * stepLength * 1.35, 0.0, 0.28);
    let stepOpacity = 1.0 - exp(-extinctionStep);
    let speed = clamp(length(sample.xyz) * 4.0, 0.0, 1.0);
    let smokeColor = mix(vec3<f32>(0.18, 0.27, 0.30), vec3<f32>(0.30, 0.34, 0.33), speed);
    let isBack = hybridSplatPresent && t > hybridSplatDepth;
    if (isBack) {
      let weight = backTransmittance * stepOpacity;
      backColor = backColor + weight * smokeColor;
      backDepthMoment = backDepthMoment + weight * t;
      backDepthWeight = backDepthWeight + weight;
      if (weight > 0.000001) {
        backNearDepth = min(backNearDepth, t);
        backFarDepth = max(backFarDepth, t);
      }
      backTransmittance = backTransmittance * exp(-extinctionStep);
    } else {
      let weight = frontTransmittance * stepOpacity;
      frontColor = frontColor + weight * smokeColor;
      frontDepthMoment = frontDepthMoment + weight * t;
      frontDepthWeight = frontDepthWeight + weight;
      if (weight > 0.000001) {
        frontNearDepth = min(frontNearDepth, t);
        frontFarDepth = max(frontFarDepth, t);
      }
      frontTransmittance = frontTransmittance * exp(-extinctionStep);
    }
  }
  out.frontColor = vec4<f32>(frontColor, clamp(1.0 - frontTransmittance, 0.0, 1.0));
  out.frontInterval = vec4<f32>(frontDepthMoment, frontDepthWeight, select(frontNearDepth, 0.0, frontDepthWeight <= 0.000001), frontFarDepth);
  out.backColor = vec4<f32>(backColor, clamp(1.0 - backTransmittance, 0.0, 1.0));
  out.backInterval = vec4<f32>(backDepthMoment, backDepthWeight, select(backNearDepth, 0.0, backDepthWeight <= 0.000001), backFarDepth);
  return out;
}
`;
}
