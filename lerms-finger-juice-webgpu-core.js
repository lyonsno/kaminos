import {
  createFingerJuiceSupportFrame,
  createReservoirDomainDiagnostics,
  normalizeHillSupportFramePayload,
  normalizeHillTerrainSamplePacket,
} from './lerms-finger-juice-core.js';

export const LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE = 'webgpu_particle_solver_v0';
export const LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE = 'wgsl-ballistic-heightfield-surface-v0';
export const LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE = 'webgpu_particle_splat_renderer_v0';
export const LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE = 'wgsl-particle-splat-renderer-v0';
export const LERMS_FINGER_JUICE_WEBGPU_CANVAS_EXTENT_CONTRACT = 'nonzero_webgpu_canvas_extent_v0';
export const LERMS_FINGER_JUICE_ORBIT_CAMERA_PROJECTION_CONTRACT = 'orbit-perspective-camera-projection-v1';
export const LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE = 'webgpu_emitter_buffer_v0';
export const LERMS_FINGER_JUICE_WEBGPU_RESPAWN_CONTRACT = 'wgsl-gpu-emitter-respawn-v0';
export const LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT = 'wgsl-local-density-pressure-v0';
export const LERMS_FINGER_JUICE_WEBGPU_SPATIAL_PRESSURE_CONTRACT = 'wgsl-spatial-cell-pressure-v0';
export const LERMS_FINGER_JUICE_WEBGPU_FLUID_DEPTH_CONTRACT = 'wgsl-spatial-viscosity-pressure-v0';
export const LERMS_FINGER_JUICE_WEBGPU_SURFACE_COHESION_CONTRACT = 'wgsl-same-chemistry-surface-cohesion-v0';
export const LERMS_FINGER_JUICE_WEBGPU_SURFACE_RELAXATION_CONTRACT = 'wgsl-spatial-surface-relaxation-v0';
export const LERMS_FINGER_JUICE_WEBGPU_STABILITY_CONTRACT = 'wgsl-stability-damped-relaxation-v0';
export const LERMS_FINGER_JUICE_WEBGPU_VISUAL_DAMPING_CONTRACT = 'wgsl-visual-streak-bead-damping-v0';
export const LERMS_FINGER_JUICE_WEBGPU_DENSITY_POSITION_SOLVE_CONTRACT = 'wgsl-density-position-solve-v0';
export const LERMS_FINGER_JUICE_WEBGPU_SUPPORT_BUDGET_CONTRACT = 'wgsl-particle-support-budget-v0';
export const LERMS_FINGER_JUICE_WEBGPU_DENSITY_CONTINUITY_CONTRACT = 'wgsl-density-continuity-projection-v0';
export const LERMS_FINGER_JUICE_WEBGPU_SAMPLED_NEIGHBORHOOD_DENSITY_CONTRACT = 'wgsl-sampled-neighborhood-density-v0';
export const LERMS_FINGER_JUICE_WEBGPU_DEEP_DENSITY_CONTINUITY_CONTRACT = 'wgsl-deep-density-continuity-projection-v0';
export const LERMS_FINGER_JUICE_WEBGPU_LOCAL_PAIR_DENSITY_CONTRACT = 'wgsl-local-pair-density-projection-v0';
export const LERMS_FINGER_JUICE_WEBGPU_NEIGHBOR_SUPPORT_SUBSTRATE_CONTRACT = 'wgsl-neighbor-support-substrate-v0';
export const LERMS_FINGER_JUICE_WEBGPU_SUBSTRATE_DENSITY_CONSTRAINT_CONTRACT = 'wgsl-substrate-density-constraint-solve-v0';
export const LERMS_FINGER_JUICE_WEBGPU_ITERATIVE_DENSITY_CONTINUITY_CONTRACT = 'wgsl-iterative-density-continuity-projection-v0';
export const LERMS_SOURCE_TRUTH_SCHEMA = 'lerms.source-truth.v0';
export const LERMS_JUICE_HIT_EVENT_SCHEMA = 'lerms.juice-hit-event.v0';
export const LERMS_FINGER_JUICE_LIVE_LIGHTWEIGHT_READBACK_MODE = 'live_lightweight_readback_v0';

const PARTICLE_FLOATS = 16;
const EMITTER_FLOATS = 16;
const WORKGROUP_SIZE = 64;
const DEFAULT_PARTICLE_SUPPORT_BUDGET = 36000;
const BASELINE_PARTICLE_SUPPORT_BUDGET = 2400;
const MIN_PARTICLE_SUPPORT_SCALE = 0.26;
const PRESSURE_NEIGHBOR_WINDOW = 6;
const PRESSURE_RADIUS = 0.105;
const SURFACE_VISCOSITY_RADIUS = PRESSURE_RADIUS * 1.35;
const SPATIAL_PRESSURE_ITERATIONS = 2;
const SPATIAL_PRESSURE_GRID_X = 80;
const SPATIAL_PRESSURE_GRID_Z = 120;
const SPATIAL_PRESSURE_CELL_COUNT = SPATIAL_PRESSURE_GRID_X * SPATIAL_PRESSURE_GRID_Z;
const SPATIAL_PRESSURE_MIN_X = -0.75;
const SPATIAL_PRESSURE_MAX_X = 0.75;
const SPATIAL_PRESSURE_MIN_Z = -0.95;
const SPATIAL_PRESSURE_MAX_Z = 2.25;
const DENSITY_POSITION_SOLVE_TARGET_OCCUPANCY = 18;
const DENSITY_CONTINUITY_TARGET_OCCUPANCY = 96;
const CONTINUITY_BIN_REFRESH_CHUNK = 16;
const SAMPLED_NEIGHBORHOOD_SAMPLE_COUNT = 16;
const LOCAL_PAIR_DENSITY_SAMPLE_COUNT = 8;
const NEIGHBOR_SUPPORT_SUBSTRATE_SAMPLE_COUNT = 32;
const SUBSTRATE_DENSITY_TARGET_SUPPORT = 3.25;
const ITERATIVE_DENSITY_CONTINUITY_ITERATIONS = 3;
const DENSITY_POSITION_SOLVE_REST_DISTANCE = PRESSURE_RADIUS * 0.62;
const PARTICLE_BUDGET_RENDER_SCALE_CONTRACT = 'particle_budget_render_scale_v0';
const SPAWN_JITTER_HASH_CONTRACT = 'spawn_jitter_hash_v0';
const SOURCE_TERRAIN_GPU_COLLISION_MODE = 'source_height_samples_gpu_storage_v0';
const LOCAL_PROCEDURAL_GPU_COLLISION_MODE = 'local_procedural_heightfield_gpu_v0';

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function resolveNonzeroWebGPUCanvasExtent(canvas, {
  width = 0,
  height = 0,
  pixelRatio = globalThis.devicePixelRatio || 1,
} = {}) {
  const ratio = Math.max(1, finite(pixelRatio, globalThis.devicePixelRatio || 1));
  const rect = canvas?.getBoundingClientRect?.();
  const cssWidth = finite(width, 0)
    || finite(canvas?.clientWidth, 0)
    || finite(rect?.width, 0)
    || finite(canvas?.width, 0) / ratio;
  const cssHeight = finite(height, 0)
    || finite(canvas?.clientHeight, 0)
    || finite(rect?.height, 0)
    || finite(canvas?.height, 0) / ratio;
  if (cssWidth <= 0 || cssHeight <= 0) return null;
  return {
    extentContract: LERMS_FINGER_JUICE_WEBGPU_CANVAS_EXTENT_CONTRACT,
    cssWidth,
    cssHeight,
    ratio,
    targetWidth: Math.max(1, Math.floor(cssWidth * ratio)),
    targetHeight: Math.max(1, Math.floor(cssHeight * ratio)),
  };
}

function round(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
}

function particleSupportScale(particleBudget = DEFAULT_PARTICLE_SUPPORT_BUDGET) {
  return Math.max(
    MIN_PARTICLE_SUPPORT_SCALE,
    Math.min(1, Math.sqrt(BASELINE_PARTICLE_SUPPORT_BUDGET / Math.max(1, finite(particleBudget, 1)))),
  );
}

function particleRadiusForBudget(sourceRadius, particleBudget = DEFAULT_PARTICLE_SUPPORT_BUDGET) {
  return Math.max(0.012, finite(sourceRadius, 0.045) * particleSupportScale(particleBudget));
}

function pressureRadiusForBudget(particleBudget = DEFAULT_PARTICLE_SUPPORT_BUDGET) {
  return PRESSURE_RADIUS * particleSupportScale(particleBudget);
}

function viscosityRadiusForBudget(particleBudget = DEFAULT_PARTICLE_SUPPORT_BUDGET) {
  return SURFACE_VISCOSITY_RADIUS * particleSupportScale(particleBudget);
}

function densityRestDistanceForBudget(particleBudget = DEFAULT_PARTICLE_SUPPORT_BUDGET) {
  return DENSITY_POSITION_SOLVE_REST_DISTANCE * particleSupportScale(particleBudget);
}

function vec3(value, fallback = [0, 0, 0]) {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? [value.x, value.y, value.z]
      : fallback;
  return [
    finite(raw[0], fallback[0] || 0),
    finite(raw[1], fallback[1] || 0),
    finite(raw[2], fallback[2] || 0),
  ];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mul(a, scalar) {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

function length3(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize3(value, fallback = [0, 0.34, 0.94]) {
  const source = vec3(value, fallback);
  const len = length3(source);
  if (len < 0.00001) return normalize3(fallback, [0, 0, 1]);
  return [source[0] / len, source[1] / len, source[2] / len];
}

function terrainHeightAt(x, z) {
  const bowl = -0.08 + 0.11 * x * x + 0.035 * Math.cos(z * 1.65);
  const hillA = 0.11 * Math.exp(-((x - 0.46) ** 2 + (z - 0.28) ** 2) / 0.18);
  const hillB = 0.09 * Math.exp(-((x + 0.36) ** 2 + (z + 0.1) ** 2) / 0.11);
  const valley = -0.08 * Math.exp(-((x - 0.05) ** 2 + (z + 0.08) ** 2) / 0.08);
  return bowl + hillA + hillB + valley;
}

function terrainNormalAt(x, z) {
  const eps = 0.015;
  const dx = (terrainHeightAt(x + eps, z) - terrainHeightAt(x - eps, z)) / (eps * 2);
  const dz = (terrainHeightAt(x, z + eps) - terrainHeightAt(x, z - eps)) / (eps * 2);
  return normalize3([-dx, 1, -dz], [0, 1, 0]);
}

function createWebGPUTerrainSampleBufferData(surface = null) {
  const grid = surface?.grid || {};
  const channels = surface?.channels || {};
  const columns = Math.max(1, Math.floor(finite(grid.columns, 1)));
  const rows = Math.max(1, Math.floor(finite(grid.rows, 1)));
  const sampleCount = Math.max(1, columns * rows);
  if (!surface || !channels.height || channels.height.length < sampleCount) {
    return {
      mode: 0,
      terrainSampleGpuCollisionMode: LOCAL_PROCEDURAL_GPU_COLLISION_MODE,
      data: new Float32Array([0, 0, 1, 0]),
      columns: 1,
      rows: 1,
      worldBounds: { x: { min: -1, max: 1 }, z: { min: -1, max: 1 } },
      sampleChecksum: null,
      channelChecksum: null,
    };
  }
  const data = new Float32Array(sampleCount * 4);
  for (let index = 0; index < sampleCount; index += 1) {
    const offset = index * 4;
    data[offset] = finite(channels.height[index], 0);
    if (channels.normal && channels.normal.length >= (index + 1) * 3) {
      data[offset + 1] = finite(channels.normal[index * 3], 0);
      data[offset + 2] = finite(channels.normal[index * 3 + 1], 1);
      data[offset + 3] = finite(channels.normal[index * 3 + 2], 0);
    } else {
      const normal = surface.sampleNormalAt?.(
        finite(surface.worldBounds?.x?.min, -1),
        finite(surface.worldBounds?.z?.min, -1),
      ) || [0, 1, 0];
      data[offset + 1] = finite(normal[0], 0);
      data[offset + 2] = finite(normal[1], 1);
      data[offset + 3] = finite(normal[2], 0);
    }
  }
  return {
    mode: 1,
    terrainSampleGpuCollisionMode: SOURCE_TERRAIN_GPU_COLLISION_MODE,
    data,
    columns,
    rows,
    worldBounds: surface.worldBounds || { x: { min: -1, max: 1 }, z: { min: -1, max: 1 } },
    sampleChecksum: surface.checksums?.sample || null,
    channelChecksum: surface.checksums?.channels || null,
  };
}

function slideVelocityOnTerrain(velocity, normal, chemistry) {
  const normalComponent = normal[0] * velocity[0] + normal[1] * velocity[1] + normal[2] * velocity[2];
  const tangent = sub(velocity, mul(normal, normalComponent));
  const viscosity = chemistry === 2 ? 0.66 : chemistry === 3 ? 0.77 : 0.84;
  const downhill = normalize3([normal[0], 0, normal[2]], [0, 0, 1]);
  return add(mul(tangent, viscosity), mul(downhill, chemistry === 2 ? 0.1 : 0.04));
}

function chemistryCode(chemistry) {
  if (chemistry === 'pooling') return 2;
  if (chemistry === 'weird') return 3;
  return 1;
}

function chemistryName(code) {
  if (code === 2) return 'pooling';
  if (code === 3) return 'weird';
  return 'knockback';
}

function lermsChemistryName(code) {
  if (code === 2) return 'middle_adhesive_gunk';
  if (code === 3) return 'ring_fertilizer';
  return 'index_knockback';
}

function emitterLife(chemistry) {
  return chemistry === 'pooling' ? 8.0 : 7.2;
}

function emitterVelocity(emitter, aim = normalize3(emitter.aim_world, [0, 0.34, 0.94])) {
  const motion = vec3(emitter.motion_world, [0, 0, 0]);
  const arcBoost = 0.42 + Math.max(0, aim[1]) * 1.6;
  const speed = (emitter.emission_state === 'jet' ? 2.15 : 1.18) * (0.35 + finite(emitter.strength, 1) * 0.65);
  return add(add(mul(aim, speed), motion), [0, arcBoost, 0]);
}

function makeRng(seed = 1) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function hash01(seed) {
  let value = (Math.floor(seed) || 1) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return (value & 0x00ffffff) / 0x00ffffff;
}

function spawnJitter(index, emitterIndex, respawnCount, stepSeed, radius) {
  const base = ((index + 1) * 374761393) ^ ((emitterIndex + 7) * 668265263) ^ ((respawnCount + 11) * 2246822519) ^ ((stepSeed + 13) * 3266489917);
  return [
    (hash01(base) - 0.5) * radius,
    (hash01(base + 0x9e3779b9) - 0.5) * radius * 0.55,
    (hash01(base + 0x85ebca6b) - 0.5) * radius,
  ];
}

export function createLermsSourceTruth(emitterPacket = {}, options = {}) {
  const authority = ['live_simulation', 'synthetic_fixture', 'visual_only', 'stale_hold', 'invalid', 'fallback']
    .includes(emitterPacket.simulation_authority)
    ? emitterPacket.simulation_authority
    : 'synthetic_fixture';
  return {
    schema: LERMS_SOURCE_TRUTH_SCHEMA,
    authority,
    route: emitterPacket.source_route || 'kaminos.lerms-finger-juice.synthetic-caster',
    frameId: emitterPacket.source_frame_id || emitterPacket.packet_id || options.frameId || 'kaminos-finger-juice-frame',
    timestampMs: finite(options.timestampMs, 0),
    sampleAgeMs: finite(emitterPacket.sample_age_ms, 0),
    backend: emitterPacket.source_backend || 'kaminos.webgpu-finger-juice',
    configId: emitterPacket.route_identity || emitterPacket.lerms_world_frame?.id || 'kaminos-finger-juice-webgpu-v0',
  };
}

function createSourceDiagnostics(emitterPacket = {}, sourceTruth, sources = []) {
  return {
    sourceTruthSchema: sourceTruth.schema,
    authority: sourceTruth.authority,
    route: sourceTruth.route,
    frameId: sourceTruth.frameId,
    sampleAgeMs: sourceTruth.sampleAgeMs,
    backend: sourceTruth.backend || null,
    configId: sourceTruth.configId || null,
    sourcePacketId: emitterPacket.packet_id || sourceTruth.frameId,
    emitterCount: sources.length,
    terrainFrameId: emitterPacket.terrain_frame?.id || emitterPacket.lerms_world_frame?.terrain_frame_id || emitterPacket.lerms_world_frame?.id || null,
    worldFromHandSample: emitterPacket.lerms_world_frame?.world_from_hand_sample || null,
  };
}

function createEmitterDiagnostics(sources = [], particlesPerEmitter = {}, ringEmitterLateralDrift = null) {
  return sources.map(source => ({
    emitter_id: source.emitter_id,
    emitterIndex: source.emitterIndex,
    chemistry: source.chemistry,
    lermsChemistry: lermsChemistryName(source.chemistryCode),
    origin: source.origin.map(value => round(value, 4)),
    aim: source.aim.map(value => round(value, 4)),
    motion: source.motion.map(value => round(value, 4)),
    radius: round(source.radius, 4),
    strength: round(source.strength, 4),
    activeParticleCount: particlesPerEmitter[source.emitter_id] || 0,
    lateralDrift: ringEmitterLateralDrift?.emitter_id === source.emitter_id ? ringEmitterLateralDrift : null,
  }));
}

function writeParticle(buffer, index, particle) {
  const offset = index * PARTICLE_FLOATS;
  buffer[offset + 0] = particle.position[0];
  buffer[offset + 1] = particle.position[1];
  buffer[offset + 2] = particle.position[2];
  buffer[offset + 3] = particle.phase;
  buffer[offset + 4] = particle.velocity[0];
  buffer[offset + 5] = particle.velocity[1];
  buffer[offset + 6] = particle.velocity[2];
  buffer[offset + 7] = particle.chemistry;
  buffer[offset + 8] = particle.radius;
  buffer[offset + 9] = particle.strength;
  buffer[offset + 10] = particle.age;
  buffer[offset + 11] = particle.life;
  buffer[offset + 12] = particle.emitterIndex;
  buffer[offset + 13] = particle.active === false ? 0 : 1;
  buffer[offset + 14] = particle.impacted ? 1 : 0;
  buffer[offset + 15] = finite(particle.respawnCount, 0);
}

function readParticle(buffer, index) {
  const offset = index * PARTICLE_FLOATS;
  return {
    position: [buffer[offset + 0], buffer[offset + 1], buffer[offset + 2]],
    phase: buffer[offset + 3],
    velocity: [buffer[offset + 4], buffer[offset + 5], buffer[offset + 6]],
    chemistry: buffer[offset + 7],
    radius: buffer[offset + 8],
    strength: buffer[offset + 9],
    age: buffer[offset + 10],
    life: buffer[offset + 11],
    emitterIndex: buffer[offset + 12],
    active: buffer[offset + 13] > 0.5,
    impacted: buffer[offset + 14] > 0.5,
    respawnCount: buffer[offset + 15],
  };
}

export function createWebGPUEmitterBufferData(emitterPacket) {
  const packetEmitters = emitterPacket?.emitters || [];
  const activeEmitters = packetEmitters
    .map((emitter, packetIndex) => ({ emitter, packetIndex }))
    .filter(item => item.emitter?.active);
  const emitterCount = activeEmitters.length;
  const data = new Float32Array(Math.max(1, emitterCount) * EMITTER_FLOATS);
  const sources = [];
  for (let i = 0; i < activeEmitters.length; i += 1) {
    const { emitter, packetIndex } = activeEmitters[i];
    const offset = i * EMITTER_FLOATS;
    const origin = vec3(emitter.origin_world, [0, 0.36, -0.84]);
    const aim = normalize3(emitter.aim_world, [0, 0.34, 0.94]);
    const motion = vec3(emitter.motion_world, [0, 0, 0]);
    const radius = finite(emitter.radius, 0.045);
    const strength = finite(emitter.strength, 1);
    const chemistry = chemistryCode(emitter.chemistry);
    const velocity = emitterVelocity(emitter, aim);
    data[offset + 0] = origin[0];
    data[offset + 1] = origin[1];
    data[offset + 2] = origin[2];
    data[offset + 3] = 1;
    data[offset + 4] = aim[0];
    data[offset + 5] = aim[1];
    data[offset + 6] = aim[2];
    data[offset + 7] = chemistry;
    data[offset + 8] = motion[0];
    data[offset + 9] = motion[1];
    data[offset + 10] = motion[2];
    data[offset + 11] = radius;
    data[offset + 12] = strength;
    data[offset + 13] = emitter.emission_state === 'jet' ? 1 : 0;
    data[offset + 14] = Math.max(0, packetIndex);
    data[offset + 15] = emitterLife(emitter.chemistry);
    sources.push({
      emitterIndex: Math.max(0, packetIndex),
      emitterSlot: i,
      emitter_id: emitter.id || `emitter-${packetIndex}`,
      chemistry: emitter.chemistry,
      chemistryCode: chemistry,
      position: origin,
      origin,
      aim,
      motion,
      velocity,
      radius,
      strength,
      life: emitterLife(emitter.chemistry),
    });
  }
  return {
    data,
    sources,
    emitterCount,
    emitterBufferRoute: LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE,
    respawnContract: LERMS_FINGER_JUICE_WEBGPU_RESPAWN_CONTRACT,
  };
}

function respawnParticleFromSource(particle, source, index, stepSeed = 0) {
  const respawnCount = finite(particle.respawnCount, 0) + 1;
  const jitter = spawnJitter(index, source.emitterIndex, respawnCount, stepSeed, source.radius);
  const lifeScale = 0.55 + hash01((index + 1) * 2246822519 + (respawnCount + 3) * 3266489917) * 0.45;
  const particleBudget = Math.max(1, Math.floor(finite(source.particleBudget, DEFAULT_PARTICLE_SUPPORT_BUDGET)));
  return {
    position: add(source.origin || source.position, jitter),
    phase: 0,
    velocity: source.velocity,
    chemistry: source.chemistryCode,
    radius: particleRadiusForBudget(source.radius, particleBudget),
    strength: source.strength,
    age: 0,
    life: source.life * lifeScale,
    emitterIndex: source.emitterIndex,
    active: true,
    impacted: false,
    respawnCount,
  };
}

export function createInitialWebGPUParticles(emitterPacket, options = {}) {
  const maxParticles = Math.max(16, Math.floor(options.maxParticles || DEFAULT_PARTICLE_SUPPORT_BUDGET));
  const seed = options.seed || 11;
  const rng = makeRng(seed);
  const data = new Float32Array(maxParticles * PARTICLE_FLOATS);
  const emitterData = createWebGPUEmitterBufferData(emitterPacket);
  const sources = emitterData.sources;
  for (let i = 0; i < maxParticles; i += 1) {
    const source = sources[i % Math.max(1, sources.length)];
    if (!source) continue;
    source.particleBudget = maxParticles;
    const radius = source.radius;
    const particleRadius = particleRadiusForBudget(radius, maxParticles);
    const jitter = [(rng() - 0.5) * radius, (rng() - 0.5) * radius, (rng() - 0.5) * radius];
    const start = add(source.origin, jitter);
    writeParticle(data, i, {
      position: start,
      phase: 0,
      velocity: source.velocity,
      chemistry: source.chemistryCode,
      radius: particleRadius,
      strength: source.strength,
      age: (i % 96) * -0.025,
      life: source.life * (0.55 + rng() * 0.45),
      emitterIndex: source.emitterIndex,
      impacted: false,
      respawnCount: 0,
    });
  }
  return { data, sources, maxParticles, emitterData };
}

export function runCpuFingerJuiceOracle(initialParticles, options = {}) {
  const data = new Float32Array(initialParticles);
  const steps = Math.max(0, Math.floor(options.steps || 180));
  const dt = Math.max(1 / 240, Math.min(1 / 20, finite(options.dt, 1 / 60)));
  const terrainSampleSurface = options.terrainSampleSurface || null;
  const sampleHeightAt = terrainSampleSurface?.sampleHeightAt || terrainHeightAt;
  const sampleNormalAt = terrainSampleSurface?.sampleNormalAt || terrainNormalAt;
  const sampleSurfaceVelocityAt = terrainSampleSurface?.sampleSurfaceVelocityAt || (() => [0, 0, 0]);
  for (let step = 0; step < steps; step += 1) {
    for (let i = 0; i < data.length / PARTICLE_FLOATS; i += 1) {
      const particle = readParticle(data, i);
      if (!particle.active) continue;
      particle.age += dt;
      if (particle.age < 0) {
        writeParticle(data, i, particle);
        continue;
      }
      if (particle.age >= particle.life) {
        const source = options.sources?.find(item => item.emitterIndex === particle.emitterIndex)
          || options.sources?.[i % Math.max(1, options.sources.length)];
        if (!source) continue;
        writeParticle(data, i, respawnParticleFromSource(particle, source, i, step));
        continue;
      }
      if (particle.phase < 0.5) {
        particle.velocity[1] -= 5.2 * dt;
        particle.position = add(particle.position, mul(particle.velocity, dt));
        const ground = sampleHeightAt(particle.position[0], particle.position[2]) + particle.radius * 0.35;
        if (particle.position[1] <= ground) {
          particle.position[1] = ground;
          particle.phase = 1;
          particle.impacted = true;
          particle.velocity = add(
            slideVelocityOnTerrain(particle.velocity, sampleNormalAt(particle.position[0], particle.position[2]), particle.chemistry),
            mul(sampleSurfaceVelocityAt(particle.position[0], particle.position[2]), 0.18),
          );
        }
      } else {
        particle.velocity = add(
          slideVelocityOnTerrain(particle.velocity, sampleNormalAt(particle.position[0], particle.position[2]), particle.chemistry),
          mul(sampleSurfaceVelocityAt(particle.position[0], particle.position[2]), 0.12),
        );
        particle.position = add(particle.position, mul(particle.velocity, dt));
        particle.position[1] = sampleHeightAt(particle.position[0], particle.position[2]) + particle.radius * 0.25;
      }
      writeParticle(data, i, particle);
    }
  }
  return summarizeWebGPUParticles(data, {
    sources: options.sources || [],
    emitterPacket: options.emitterPacket || {},
    stepCount: steps,
    lerms: options.lerms || [],
    goins: options.goins || [],
    solver_backend: 'cpu_oracle',
    hillSupportFramePayload: options.hillSupportFramePayload || options.supportFramePayload || null,
    terrainSampleSurface,
  });
}

function targetHits(particles, targets, kind, options = {}) {
  let count = 0;
  const out = targets.map(target => ({ ...target, hits: 0, impulse: [0, 0, 0] }));
  const hitEvents = [];
  for (const particle of particles) {
    for (const target of out) {
      const delta = sub(vec3(target.position), particle.position);
      const distance = length3(delta);
      const contactRadius = Math.max(particle.radius, kind === 'goin' ? 0.06 : 0.052);
      if (distance <= finite(target.radius, kind === 'goin' ? 0.13 : 0.16) + contactRadius) {
        const impulseScale = particle.strength * (kind === 'goin' ? 0.16 : 0.22);
        const impulse = particle.velocity.map(value => round(value * impulseScale, 4));
        target.hits += 1;
        target.impulse = target.impulse.map((value, index) => round(value + impulse[index], 4));
        count += 1;
        hitEvents.push({
          schema: LERMS_JUICE_HIT_EVENT_SCHEMA,
          id: `juice-hit-${kind}-${target.id}-${particle.id}`,
          source: options.sourceTruth,
          chemistry: lermsChemistryName(particle.chemistry),
          targetKind: kind,
          targetId: target.id,
          contactWorld: particle.position.map(value => round(value, 4)),
          impulse,
          sourcePacketId: options.sourcePacketId,
          strength: round(particle.strength, 4),
        });
      }
    }
  }
  return { count, targets: out, hitEvents };
}

function pressureDensityStats(particles) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  const pressureRadius = pressureRadiusForBudget(particles.length);
  if (!surfaceParticles.length) {
    return {
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT,
      pressureNeighborWindow: PRESSURE_NEIGHBOR_WINDOW,
      pressureRadius,
      surfaceParticleCount: 0,
      averageNeighborDensity: 0,
      maxNeighborDensity: 0,
      pressureAffectedCount: 0,
    };
  }
  const densities = surfaceParticles.map((particle, index) => {
    let density = 0;
    for (let offset = 1; offset <= PRESSURE_NEIGHBOR_WINDOW; offset += 1) {
      for (const neighbor of [
        surfaceParticles[(index + offset) % surfaceParticles.length],
        surfaceParticles[(index + surfaceParticles.length - offset) % surfaceParticles.length],
      ]) {
        if (!neighbor || neighbor.id === particle.id) continue;
        const distance = length3(sub(particle.position, neighbor.position));
        if (distance > 0.0001 && distance < pressureRadius) density += (pressureRadius - distance) / pressureRadius;
      }
    }
    return density;
  });
  const totalDensity = densities.reduce((sum, value) => sum + value, 0);
  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT,
    pressureNeighborWindow: PRESSURE_NEIGHBOR_WINDOW,
    pressureRadius: round(pressureRadius, 4),
    surfaceParticleCount: surfaceParticles.length,
    averageNeighborDensity: round(totalDensity / surfaceParticles.length, 4),
    maxNeighborDensity: round(Math.max(...densities), 4),
    pressureAffectedCount: densities.filter(value => value > 0).length,
  };
}

function spatialCellIndex(position) {
  const xRange = Math.max(0.0001, SPATIAL_PRESSURE_MAX_X - SPATIAL_PRESSURE_MIN_X);
  const zRange = Math.max(0.0001, SPATIAL_PRESSURE_MAX_Z - SPATIAL_PRESSURE_MIN_Z);
  const xCell = Math.max(0, Math.min(
    SPATIAL_PRESSURE_GRID_X - 1,
    Math.floor(((position[0] - SPATIAL_PRESSURE_MIN_X) / xRange) * SPATIAL_PRESSURE_GRID_X),
  ));
  const zCell = Math.max(0, Math.min(
    SPATIAL_PRESSURE_GRID_Z - 1,
    Math.floor(((position[2] - SPATIAL_PRESSURE_MIN_Z) / zRange) * SPATIAL_PRESSURE_GRID_Z),
  ));
  return zCell * SPATIAL_PRESSURE_GRID_X + xCell;
}

function spatialCellCoords(position) {
  const xRange = Math.max(0.0001, SPATIAL_PRESSURE_MAX_X - SPATIAL_PRESSURE_MIN_X);
  const zRange = Math.max(0.0001, SPATIAL_PRESSURE_MAX_Z - SPATIAL_PRESSURE_MIN_Z);
  return {
    x: Math.max(0, Math.min(
      SPATIAL_PRESSURE_GRID_X - 1,
      Math.floor(((position[0] - SPATIAL_PRESSURE_MIN_X) / xRange) * SPATIAL_PRESSURE_GRID_X),
    )),
    z: Math.max(0, Math.min(
      SPATIAL_PRESSURE_GRID_Z - 1,
      Math.floor(((position[2] - SPATIAL_PRESSURE_MIN_Z) / zRange) * SPATIAL_PRESSURE_GRID_Z),
    )),
  };
}

function spatialPressureStats(particles) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  const bins = new Uint32Array(SPATIAL_PRESSURE_CELL_COUNT);
  for (const particle of surfaceParticles) {
    bins[spatialCellIndex(particle.position)] += 1;
  }
  let occupiedCellCount = 0;
  let maxCellOccupancy = 0;
  let occupiedParticleCount = 0;
  for (const count of bins) {
    if (count <= 0) continue;
    occupiedCellCount += 1;
    occupiedParticleCount += count;
    maxCellOccupancy = Math.max(maxCellOccupancy, count);
  }
  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_SPATIAL_PRESSURE_CONTRACT,
    spatialPressureMode: 'gpu_cell_occupancy_gradient_v0',
    spatialPressureRefresh: 'per_submitted_compute_pass',
    spatialCellCount: SPATIAL_PRESSURE_CELL_COUNT,
    occupiedCellCount,
    maxCellOccupancy,
    averageOccupiedCellOccupancy: occupiedCellCount ? round(occupiedParticleCount / occupiedCellCount, 4) : 0,
    surfaceParticleCount: surfaceParticles.length,
    spatialPressureGrid: {
      x: SPATIAL_PRESSURE_GRID_X,
      z: SPATIAL_PRESSURE_GRID_Z,
    },
    spatialPressureBounds: {
      minX: SPATIAL_PRESSURE_MIN_X,
      maxX: SPATIAL_PRESSURE_MAX_X,
      minZ: SPATIAL_PRESSURE_MIN_Z,
      maxZ: SPATIAL_PRESSURE_MAX_Z,
    },
  };
}

function fluidDepthStats(particles) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  const viscosityRadius = viscosityRadiusForBudget(particles.length);
  if (!surfaceParticles.length) {
    return {
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_FLUID_DEPTH_CONTRACT,
      spatialPressureIterations: SPATIAL_PRESSURE_ITERATIONS,
      viscosityRadius: round(viscosityRadius, 4),
      viscosityNeighborWindow: PRESSURE_NEIGHBOR_WINDOW,
      surfaceParticleCount: 0,
      viscosityAffectedCount: 0,
      averageSurfaceSpeed: 0,
      averageVelocityDelta: 0,
      maxVelocityDelta: 0,
    };
  }
  let totalSurfaceSpeed = 0;
  let totalVelocityDelta = 0;
  let maxVelocityDelta = 0;
  let viscosityAffectedCount = 0;
  for (let index = 0; index < surfaceParticles.length; index += 1) {
    const particle = surfaceParticles[index];
    totalSurfaceSpeed += length3(particle.velocity);
    let neighborVelocity = [0, 0, 0];
    let weightTotal = 0;
    for (let offset = 1; offset <= PRESSURE_NEIGHBOR_WINDOW; offset += 1) {
      for (const neighbor of [
        surfaceParticles[(index + offset) % surfaceParticles.length],
        surfaceParticles[(index + surfaceParticles.length - offset) % surfaceParticles.length],
      ]) {
        if (!neighbor || neighbor.id === particle.id) continue;
        const distance = length3(sub(particle.position, neighbor.position));
        if (distance <= 0.0001 || distance >= viscosityRadius) continue;
        const weight = (viscosityRadius - distance) / viscosityRadius;
        neighborVelocity = add(neighborVelocity, mul(neighbor.velocity, weight));
        weightTotal += weight;
      }
    }
    if (weightTotal > 0) {
      const averageVelocity = mul(neighborVelocity, 1 / weightTotal);
      const velocityDelta = length3(sub(averageVelocity, particle.velocity));
      totalVelocityDelta += velocityDelta;
      maxVelocityDelta = Math.max(maxVelocityDelta, velocityDelta);
      viscosityAffectedCount += 1;
    }
  }
  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_FLUID_DEPTH_CONTRACT,
    spatialPressureIterations: SPATIAL_PRESSURE_ITERATIONS,
    viscosityRadius: round(viscosityRadius, 4),
    viscosityNeighborWindow: PRESSURE_NEIGHBOR_WINDOW,
    surfaceParticleCount: surfaceParticles.length,
    viscosityAffectedCount,
    averageSurfaceSpeed: round(totalSurfaceSpeed / surfaceParticles.length, 4),
    averageVelocityDelta: viscosityAffectedCount ? round(totalVelocityDelta / viscosityAffectedCount, 4) : 0,
    maxVelocityDelta: round(maxVelocityDelta, 4),
  };
}

function surfaceCohesionStats(particles) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  const cohesionRadius = viscosityRadiusForBudget(particles.length) * 1.7;
  if (!surfaceParticles.length) {
    return {
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_SURFACE_COHESION_CONTRACT,
      cohesionRadius: round(cohesionRadius, 4),
      cohesionNeighborWindow: PRESSURE_NEIGHBOR_WINDOW,
      surfaceParticleCount: 0,
      cohesionAffectedCount: 0,
      cohesionNeighborCount: 0,
      averageCohesionNeighbors: 0,
      ribbonAlignment: 0,
    };
  }
  let cohesionAffectedCount = 0;
  let cohesionNeighborCount = 0;
  let totalAlignment = 0;
  for (let index = 0; index < surfaceParticles.length; index += 1) {
    const particle = surfaceParticles[index];
    const particleSpeed = length3(particle.velocity);
    let localNeighborCount = 0;
    let localAlignment = 0;
    for (let offset = 1; offset <= PRESSURE_NEIGHBOR_WINDOW; offset += 1) {
      for (const neighbor of [
        surfaceParticles[(index + offset) % surfaceParticles.length],
        surfaceParticles[(index + surfaceParticles.length - offset) % surfaceParticles.length],
      ]) {
        if (!neighbor || neighbor.id === particle.id || neighbor.chemistry !== particle.chemistry) continue;
        const distance = length3(sub(particle.position, neighbor.position));
        if (distance <= 0.0001 || distance >= cohesionRadius) continue;
        localNeighborCount += 1;
        const neighborSpeed = length3(neighbor.velocity);
        if (particleSpeed > 0.0001 && neighborSpeed > 0.0001) {
          const dot =
            particle.velocity[0] * neighbor.velocity[0] +
            particle.velocity[1] * neighbor.velocity[1] +
            particle.velocity[2] * neighbor.velocity[2];
          localAlignment += Math.max(0, dot / (particleSpeed * neighborSpeed));
        }
      }
    }
    if (localNeighborCount > 0) {
      cohesionAffectedCount += 1;
      cohesionNeighborCount += localNeighborCount;
      totalAlignment += localAlignment / localNeighborCount;
    }
  }

  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_SURFACE_COHESION_CONTRACT,
    cohesionRadius: round(cohesionRadius, 4),
    cohesionNeighborWindow: PRESSURE_NEIGHBOR_WINDOW,
    surfaceParticleCount: surfaceParticles.length,
    cohesionAffectedCount,
    cohesionNeighborCount,
    averageCohesionNeighbors: cohesionAffectedCount ? round(cohesionNeighborCount / cohesionAffectedCount, 4) : 0,
    ribbonAlignment: cohesionAffectedCount ? round(totalAlignment / cohesionAffectedCount, 4) : 0,
  };
}

function spatialSurfaceRelaxationStats(particles) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  if (!surfaceParticles.length) {
    return {
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_SURFACE_RELAXATION_CONTRACT,
      relaxationMode: 'gpu_cell_density_position_relaxation_v0',
      relaxationIterations: 1,
      surfaceParticleCount: 0,
      relaxedParticleCount: 0,
      denseCellCount: 0,
      occupiedNeighborCellCount: 0,
      sheetConnectedParticleCount: 0,
      averageRelaxedCellOccupancy: 0,
      maxRelaxedCellOccupancy: 0,
      sheetContinuityRatio: 0,
    };
  }

  const bins = new Uint32Array(SPATIAL_PRESSURE_CELL_COUNT);
  for (const particle of surfaceParticles) {
    bins[spatialCellIndex(particle.position)] += 1;
  }

  let relaxedParticleCount = 0;
  let denseCellCount = 0;
  let occupiedNeighborCellCount = 0;
  let sheetConnectedParticleCount = 0;
  let relaxedCellOccupancyTotal = 0;
  let maxRelaxedCellOccupancy = 0;
  const occupiedCellIndices = [];
  for (let index = 0; index < bins.length; index += 1) {
    if (bins[index] <= 0) continue;
    occupiedCellIndices.push(index);
    if (bins[index] >= 4) denseCellCount += 1;
  }

  const occupiedSet = new Set(occupiedCellIndices);
  for (const particle of surfaceParticles) {
    const cellIndex = spatialCellIndex(particle.position);
    const occupancy = bins[cellIndex] || 0;
    const cellX = cellIndex % SPATIAL_PRESSURE_GRID_X;
    const cellZ = Math.floor(cellIndex / SPATIAL_PRESSURE_GRID_X);
    const neighborCells = [
      [cellX - 1, cellZ],
      [cellX + 1, cellZ],
      [cellX, cellZ - 1],
      [cellX, cellZ + 1],
    ].filter(([x, z]) => x >= 0 && z >= 0 && x < SPATIAL_PRESSURE_GRID_X && z < SPATIAL_PRESSURE_GRID_Z);
    const occupiedNeighbors = neighborCells.filter(([x, z]) => occupiedSet.has(z * SPATIAL_PRESSURE_GRID_X + x)).length;
    if (occupancy >= 2 || occupiedNeighbors > 0) {
      relaxedParticleCount += 1;
      occupiedNeighborCellCount += occupiedNeighbors;
      relaxedCellOccupancyTotal += occupancy;
      maxRelaxedCellOccupancy = Math.max(maxRelaxedCellOccupancy, occupancy);
    }
    if (occupiedNeighbors > 0) {
      sheetConnectedParticleCount += 1;
    }
  }

  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_SURFACE_RELAXATION_CONTRACT,
    relaxationMode: 'gpu_cell_density_position_relaxation_v0',
    relaxationIterations: 1,
    surfaceParticleCount: surfaceParticles.length,
    relaxedParticleCount,
    denseCellCount,
    occupiedNeighborCellCount,
    sheetConnectedParticleCount,
    averageRelaxedCellOccupancy: relaxedParticleCount ? round(relaxedCellOccupancyTotal / relaxedParticleCount, 4) : 0,
    maxRelaxedCellOccupancy,
    sheetContinuityRatio: surfaceParticles.length ? round(sheetConnectedParticleCount / surfaceParticles.length, 4) : 0,
  };
}

function densityPositionSolveStats(particles) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  const restDistance = densityRestDistanceForBudget(particles.length);
  if (!surfaceParticles.length) {
    return {
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_POSITION_SOLVE_CONTRACT,
      solveMode: 'bounded_pair_and_cell_position_correction_v0',
      solveIterations: 1,
      targetCellOccupancy: DENSITY_POSITION_SOLVE_TARGET_OCCUPANCY,
      restDistance: round(restDistance, 4),
      surfaceParticleCount: 0,
      correctionCandidateCount: 0,
      closePairCount: 0,
      denseSolveCellCount: 0,
      densitySolveCoverageRatio: 0,
      averageConstraintError: 0,
      maxConstraintError: 0,
    };
  }

  const bins = new Uint32Array(SPATIAL_PRESSURE_CELL_COUNT);
  for (const particle of surfaceParticles) {
    bins[spatialCellIndex(particle.position)] += 1;
  }

  let denseSolveCellCount = 0;
  for (const count of bins) {
    if (count >= DENSITY_POSITION_SOLVE_TARGET_OCCUPANCY) denseSolveCellCount += 1;
  }

  let correctionCandidateCount = 0;
  let closePairCount = 0;
  let totalConstraintError = 0;
  let maxConstraintError = 0;
  for (let index = 0; index < surfaceParticles.length; index += 1) {
    const particle = surfaceParticles[index];
    const occupancy = bins[spatialCellIndex(particle.position)] || 0;
    let localConstraintErrorSum = 0;
    let localClosePairCount = 0;
    for (let offset = 1; offset <= PRESSURE_NEIGHBOR_WINDOW; offset += 1) {
      for (const neighbor of [
        surfaceParticles[(index + offset) % surfaceParticles.length],
        surfaceParticles[(index + surfaceParticles.length - offset) % surfaceParticles.length],
      ]) {
        if (!neighbor || neighbor.id === particle.id || neighbor.chemistry !== particle.chemistry) continue;
        const distance = length3(sub(particle.position, neighbor.position));
        if (distance <= 0.0001 || distance >= restDistance) continue;
        closePairCount += 1;
        localClosePairCount += 1;
        localConstraintErrorSum += (restDistance - distance) / restDistance;
      }
    }
    const localConstraintError = localClosePairCount ? localConstraintErrorSum / localClosePairCount : 0;
    if (localConstraintError > 0 || occupancy >= DENSITY_POSITION_SOLVE_TARGET_OCCUPANCY) {
      correctionCandidateCount += 1;
      totalConstraintError += localConstraintError;
      maxConstraintError = Math.max(maxConstraintError, localConstraintError);
    }
  }

  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_POSITION_SOLVE_CONTRACT,
    solveMode: 'bounded_pair_and_cell_position_correction_v0',
    solveIterations: 1,
    targetCellOccupancy: DENSITY_POSITION_SOLVE_TARGET_OCCUPANCY,
    restDistance: round(restDistance, 4),
    surfaceParticleCount: surfaceParticles.length,
    correctionCandidateCount,
    closePairCount,
    denseSolveCellCount,
    densitySolveCoverageRatio: round(correctionCandidateCount / surfaceParticles.length, 4),
    averageConstraintError: correctionCandidateCount ? round(totalConstraintError / correctionCandidateCount, 4) : 0,
    maxConstraintError: round(maxConstraintError, 4),
  };
}

function densityContinuityProjectionStats(particles) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  const bins = new Uint32Array(SPATIAL_PRESSURE_CELL_COUNT);
  for (const particle of surfaceParticles) {
    bins[spatialCellIndex(particle.position)] += 1;
  }
  if (!surfaceParticles.length) {
    return {
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_CONTINUITY_CONTRACT,
      projectionMode: 'fresh_bin_neighbor_outflow_projection_v0',
      continuityBinRefreshChunk: CONTINUITY_BIN_REFRESH_CHUNK,
      continuityTargetCellOccupancy: DENSITY_CONTINUITY_TARGET_OCCUPANCY,
      surfaceParticleCount: 0,
      continuityProjectionCandidateCount: 0,
      continuityDenseCellCount: 0,
      continuityOccupiedCellCount: 0,
      continuityMaxCellOccupancy: 0,
      continuityAverageDenseCellOccupancy: 0,
      continuityPeakOccupancyRatio: 0,
      continuityRedistributionPressure: 0,
    };
  }

  let continuityDenseCellCount = 0;
  let continuityOccupiedCellCount = 0;
  let continuityMaxCellOccupancy = 0;
  let denseOccupancyTotal = 0;
  let excessOccupancyTotal = 0;
  for (const count of bins) {
    if (count <= 0) continue;
    continuityOccupiedCellCount += 1;
    continuityMaxCellOccupancy = Math.max(continuityMaxCellOccupancy, count);
    if (count >= DENSITY_CONTINUITY_TARGET_OCCUPANCY) {
      continuityDenseCellCount += 1;
      denseOccupancyTotal += count;
      excessOccupancyTotal += count - DENSITY_CONTINUITY_TARGET_OCCUPANCY;
    }
  }

  let continuityProjectionCandidateCount = 0;
  for (const particle of surfaceParticles) {
    if ((bins[spatialCellIndex(particle.position)] || 0) >= DENSITY_CONTINUITY_TARGET_OCCUPANCY) {
      continuityProjectionCandidateCount += 1;
    }
  }

  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_CONTINUITY_CONTRACT,
    projectionMode: 'fresh_bin_neighbor_outflow_projection_v0',
    continuityBinRefreshChunk: CONTINUITY_BIN_REFRESH_CHUNK,
    continuityTargetCellOccupancy: DENSITY_CONTINUITY_TARGET_OCCUPANCY,
    surfaceParticleCount: surfaceParticles.length,
    continuityProjectionCandidateCount,
    continuityDenseCellCount,
    continuityOccupiedCellCount,
    continuityMaxCellOccupancy,
    continuityAverageDenseCellOccupancy: continuityDenseCellCount ? round(denseOccupancyTotal / continuityDenseCellCount, 4) : 0,
    continuityPeakOccupancyRatio: round(continuityMaxCellOccupancy / DENSITY_CONTINUITY_TARGET_OCCUPANCY, 4),
    continuityRedistributionPressure: round(excessOccupancyTotal / surfaceParticles.length, 4),
  };
}

function sampledNeighborhoodDensityStats(particles) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  const sampleRadius = Math.max(0.036, densityRestDistanceForBudget(particles.length) * 1.7);
  const restDistance = Math.max(0.024, densityRestDistanceForBudget(particles.length) * 1.08);
  const cellParticleIndices = Array.from({ length: SPATIAL_PRESSURE_CELL_COUNT }, () => []);
  for (let index = 0; index < surfaceParticles.length; index += 1) {
    cellParticleIndices[spatialCellIndex(surfaceParticles[index].position)].push(index);
  }
  if (!surfaceParticles.length) {
    return {
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_SAMPLED_NEIGHBORHOOD_DENSITY_CONTRACT,
      neighborhoodMode: 'bounded_sampled_particle_distance_density_v0',
      sampledNeighborProbeCount: SAMPLED_NEIGHBORHOOD_SAMPLE_COUNT,
      sampleRadius: round(sampleRadius, 4),
      restDistance: round(restDistance, 4),
      surfaceParticleCount: 0,
      neighborhoodDensityCorrectionCandidateCount: 0,
      closeSamplePairCount: 0,
      averageSampledNeighborCount: 0,
      maxSampledNeighborCount: 0,
      averageClosePairError: 0,
    };
  }

  let neighborTotal = 0;
  let maxSampledNeighborCount = 0;
  let closePairCount = 0;
  let closePairErrorTotal = 0;
  let candidateCount = 0;
  for (let index = 0; index < surfaceParticles.length; index += 1) {
    const particle = surfaceParticles[index];
    const coords = spatialCellCoords(particle.position);
    let sampledNeighborCount = 0;
    let localClosePairCount = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      const neighborZ = coords.z + dz;
      if (neighborZ < 0 || neighborZ >= SPATIAL_PRESSURE_GRID_Z) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const neighborX = coords.x + dx;
        if (neighborX < 0 || neighborX >= SPATIAL_PRESSURE_GRID_X) continue;
        const neighborIndices = cellParticleIndices[neighborZ * SPATIAL_PRESSURE_GRID_X + neighborX];
        for (const neighborIndex of neighborIndices) {
          const neighbor = surfaceParticles[neighborIndex];
          if (!neighbor || neighbor.id === particle.id || neighbor.chemistry !== particle.chemistry) continue;
          const distance = length3(sub(particle.position, neighbor.position));
          if (distance <= 0.0001 || distance >= sampleRadius) continue;
          sampledNeighborCount += 1;
          if (distance < restDistance) {
            localClosePairCount += 1;
            closePairCount += 1;
            closePairErrorTotal += (restDistance - distance) / restDistance;
          }
        }
      }
    }
    if (sampledNeighborCount >= 4 || localClosePairCount > 0) candidateCount += 1;
    neighborTotal += sampledNeighborCount;
    maxSampledNeighborCount = Math.max(maxSampledNeighborCount, sampledNeighborCount);
  }

  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_SAMPLED_NEIGHBORHOOD_DENSITY_CONTRACT,
    neighborhoodMode: 'bounded_sampled_particle_distance_density_v0',
    sampledNeighborProbeCount: SAMPLED_NEIGHBORHOOD_SAMPLE_COUNT,
    sampleRadius: round(sampleRadius, 4),
    restDistance: round(restDistance, 4),
    surfaceParticleCount: surfaceParticles.length,
    neighborhoodDensityCorrectionCandidateCount: candidateCount,
    closeSamplePairCount: closePairCount,
    averageSampledNeighborCount: round(neighborTotal / surfaceParticles.length, 4),
    maxSampledNeighborCount,
    averageClosePairError: closePairCount ? round(closePairErrorTotal / closePairCount, 4) : 0,
  };
}

function localPairDensityStats(particles, sampledNeighborhoodStats = null) {
  const surfaceParticleCount = sampledNeighborhoodStats?.surfaceParticleCount
    ?? particles.filter(particle => particle.surface_flow).length;
  const pairRadius = Math.max(0.032, densityRestDistanceForBudget(particles.length) * 1.42);
  const restDistance = Math.max(0.022, densityRestDistanceForBudget(particles.length) * 0.96);
  if (!surfaceParticleCount) {
    return {
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_LOCAL_PAIR_DENSITY_CONTRACT,
      projectionMode: 'derived_same_chemistry_cell_pair_projection_v0',
      localPairProbeCount: LOCAL_PAIR_DENSITY_SAMPLE_COUNT,
      pairRadius: round(pairRadius, 4),
      restDistance: round(restDistance, 4),
      surfaceParticleCount: 0,
      localPairProjectionCandidateCount: 0,
      localPairClosePairCount: 0,
      averageLocalPairNeighbors: 0,
      maxLocalPairNeighbors: 0,
      averageLocalPairOverlap: 0,
      maxLocalPairOverlap: 0,
    };
  }

  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_LOCAL_PAIR_DENSITY_CONTRACT,
    projectionMode: 'derived_same_chemistry_cell_pair_projection_v0',
    localPairProbeCount: LOCAL_PAIR_DENSITY_SAMPLE_COUNT,
    pairRadius: round(pairRadius, 4),
    restDistance: round(restDistance, 4),
    surfaceParticleCount,
    localPairProjectionCandidateCount: sampledNeighborhoodStats?.neighborhoodDensityCorrectionCandidateCount ?? 0,
    localPairClosePairCount: sampledNeighborhoodStats?.closeSamplePairCount ?? 0,
    averageLocalPairNeighbors: sampledNeighborhoodStats?.averageSampledNeighborCount ?? 0,
    maxLocalPairNeighbors: sampledNeighborhoodStats?.maxSampledNeighborCount ?? 0,
    averageLocalPairOverlap: sampledNeighborhoodStats?.averageClosePairError ?? 0,
    maxLocalPairOverlap: sampledNeighborhoodStats?.averageClosePairError ?? 0,
  };
}

function neighborSupportSubstrateStats(particles, substrateData = null) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  const supportRadius = Math.max(0.036, viscosityRadiusForBudget(particles.length) * 0.95);
  const closeRadius = Math.max(0.024, densityRestDistanceForBudget(particles.length) * 1.04);
  const base = {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_NEIGHBOR_SUPPORT_SUBSTRATE_CONTRACT,
    neighborSupportSubstrateMode: 'gpu_hash_sampled_same_chemistry_support_buffer_v0',
    substrateReadbackMode: substrateData ? 'gpu_neighbor_support_buffer_readback_v0' : 'missing_neighbor_support_buffer_readback_v0',
    substrateSampleCount: NEIGHBOR_SUPPORT_SUBSTRATE_SAMPLE_COUNT,
    supportRadius: round(supportRadius, 4),
    closeRadius: round(closeRadius, 4),
    particleCount: particles.length,
    surfaceParticleCount: surfaceParticles.length,
  };
  if (!surfaceParticles.length || !substrateData) {
    return {
      ...base,
      averageSubstrateNeighborSupport: 0,
      maxSubstrateNeighborSupport: 0,
      p95SubstrateNeighborSupport: 0,
      supportedSubstrateParticleCount: 0,
      unsupportedSubstrateParticleCount: surfaceParticles.length,
      substrateAdequacyRatio: 0,
    };
  }

  const supportValues = surfaceParticles
    .map(particle => Math.max(0, finite(substrateData[Number(String(particle.id).replace('wgpu-', ''))], 0)))
    .sort((a, b) => a - b);
  const supportTotal = supportValues.reduce((sum, value) => sum + value, 0);
  const supportedSubstrateParticleCount = supportValues.filter(value => value >= 2).length;
  const unsupportedSubstrateParticleCount = supportValues.length - supportedSubstrateParticleCount;
  return {
    ...base,
    averageSubstrateNeighborSupport: round(supportTotal / supportValues.length, 4),
    maxSubstrateNeighborSupport: round(supportValues[supportValues.length - 1] || 0, 4),
    p95SubstrateNeighborSupport: round(percentile(supportValues, 0.95), 4),
    supportedSubstrateParticleCount,
    unsupportedSubstrateParticleCount,
    substrateAdequacyRatio: round(supportedSubstrateParticleCount / supportValues.length, 4),
  };
}

function substrateDensityConstraintStats(particles, substrateData = null) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  const base = {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_SUBSTRATE_DENSITY_CONSTRAINT_CONTRACT,
    substrateDensityConstraintMode: 'bounded_support_lambda_sheet_projection_v0',
    substrateDensityTargetSupport: SUBSTRATE_DENSITY_TARGET_SUPPORT,
    surfaceParticleCount: surfaceParticles.length,
  };
  if (!surfaceParticles.length || !substrateData) {
    return {
      ...base,
      substrateConstraintCandidateCount: 0,
      lowSupportConstraintCount: 0,
      highDensityConstraintCount: 0,
      averageSubstrateConstraintError: 0,
      maxSubstrateConstraintError: 0,
      unsupportedSubstrateConstraintRatio: 0,
      substrateSheetPullRatio: 0,
    };
  }

  const bins = new Uint32Array(SPATIAL_PRESSURE_CELL_COUNT);
  for (const particle of surfaceParticles) {
    bins[spatialCellIndex(particle.position)] += 1;
  }

  let substrateConstraintCandidateCount = 0;
  let lowSupportConstraintCount = 0;
  let highDensityConstraintCount = 0;
  let unsupportedConstraintCount = 0;
  let sheetPullCount = 0;
  let errorTotal = 0;
  let maxSubstrateConstraintError = 0;
  for (const particle of surfaceParticles) {
    const particleIndex = Number(String(particle.id).replace('wgpu-', ''));
    const support = Math.max(0, finite(substrateData[particleIndex], 0));
    const cellIndex = spatialCellIndex(particle.position);
    const cellX = cellIndex % SPATIAL_PRESSURE_GRID_X;
    const cellZ = Math.floor(cellIndex / SPATIAL_PRESSURE_GRID_X);
    const center = bins[cellIndex] || 0;
    const neighborIndices = [
      [cellX - 1, cellZ],
      [cellX + 1, cellZ],
      [cellX, cellZ - 1],
      [cellX, cellZ + 1],
      [cellX - 1, cellZ - 1],
      [cellX + 1, cellZ - 1],
      [cellX - 1, cellZ + 1],
      [cellX + 1, cellZ + 1],
    ].filter(([x, z]) => x >= 0 && z >= 0 && x < SPATIAL_PRESSURE_GRID_X && z < SPATIAL_PRESSURE_GRID_Z)
      .map(([x, z]) => z * SPATIAL_PRESSURE_GRID_X + x);
    const maxNeighbor = neighborIndices.reduce((maxCount, index) => Math.max(maxCount, bins[index] || 0), 0);
    const lowSupport = support < SUBSTRATE_DENSITY_TARGET_SUPPORT;
    const highDensity = center >= DENSITY_POSITION_SOLVE_TARGET_OCCUPANCY || center >= DENSITY_CONTINUITY_TARGET_OCCUPANCY * 0.55;
    const hasSheetPull = lowSupport && maxNeighbor > center + 2;
    if (!lowSupport && !highDensity && !hasSheetPull) continue;
    substrateConstraintCandidateCount += 1;
    if (lowSupport) lowSupportConstraintCount += 1;
    if (highDensity) highDensityConstraintCount += 1;
    if (support < 1.0) unsupportedConstraintCount += 1;
    if (hasSheetPull) sheetPullCount += 1;
    const supportError = Math.max(0, SUBSTRATE_DENSITY_TARGET_SUPPORT - support) / SUBSTRATE_DENSITY_TARGET_SUPPORT;
    const densityError = Math.max(0, center - DENSITY_POSITION_SOLVE_TARGET_OCCUPANCY) / Math.max(1, DENSITY_CONTINUITY_TARGET_OCCUPANCY);
    const error = Math.max(supportError, densityError);
    errorTotal += error;
    maxSubstrateConstraintError = Math.max(maxSubstrateConstraintError, error);
  }

  return {
    ...base,
    substrateConstraintCandidateCount,
    lowSupportConstraintCount,
    highDensityConstraintCount,
    averageSubstrateConstraintError: substrateConstraintCandidateCount ? round(errorTotal / substrateConstraintCandidateCount, 4) : 0,
    maxSubstrateConstraintError: round(maxSubstrateConstraintError, 4),
    unsupportedSubstrateConstraintRatio: substrateConstraintCandidateCount ? round(unsupportedConstraintCount / substrateConstraintCandidateCount, 4) : 0,
    substrateSheetPullRatio: substrateConstraintCandidateCount ? round(sheetPullCount / substrateConstraintCandidateCount, 4) : 0,
  };
}

function iterativeDensityContinuityStats(particles, substrateData = null) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  const target = Math.floor(DENSITY_CONTINUITY_TARGET_OCCUPANCY * 0.58);
  const base = {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_ITERATIVE_DENSITY_CONTINUITY_CONTRACT,
    projectionMode: 'fixed_iteration_support_residual_projection_v0',
    iterativeDensityContinuityIterationCount: ITERATIVE_DENSITY_CONTINUITY_ITERATIONS,
    iterativeDensityTargetCellOccupancy: target,
    surfaceParticleCount: surfaceParticles.length,
  };
  if (!surfaceParticles.length) {
    return {
      ...base,
      iterativeDensityContinuityCandidateCount: 0,
      averageIterativeDensityResidual: 0,
      maxIterativeDensityResidual: 0,
      iterativeDensityConvergenceRatio: 1,
      iterativeDensityClampCount: 0,
      iterativeDensitySupportedCandidateRatio: 0,
    };
  }

  const bins = new Uint32Array(SPATIAL_PRESSURE_CELL_COUNT);
  for (const particle of surfaceParticles) {
    bins[spatialCellIndex(particle.position)] += 1;
  }

  let iterativeDensityContinuityCandidateCount = 0;
  let residualTotal = 0;
  let maxIterativeDensityResidual = 0;
  let iterativeDensityClampCount = 0;
  let supportedCandidateCount = 0;
  for (const particle of surfaceParticles) {
    const particleIndex = Number(String(particle.id).replace('wgpu-', ''));
    const support = substrateData ? Math.max(0, finite(substrateData[particleIndex], 0)) : 0;
    const cellIndex = spatialCellIndex(particle.position);
    const count = bins[cellIndex] || 0;
    const densityResidual = Math.max(0, count - target) / Math.max(1, target);
    const supportResidual = substrateData
      ? Math.max(0, SUBSTRATE_DENSITY_TARGET_SUPPORT - support) / SUBSTRATE_DENSITY_TARGET_SUPPORT
      : 0;
    const residual = Math.max(densityResidual, supportResidual * 0.65);
    if (residual <= 0.015) continue;
    iterativeDensityContinuityCandidateCount += 1;
    residualTotal += residual;
    maxIterativeDensityResidual = Math.max(maxIterativeDensityResidual, residual);
    if (residual > 1.2 || count > target * 3.2) iterativeDensityClampCount += 1;
    if (support >= SUBSTRATE_DENSITY_TARGET_SUPPORT * 0.55) supportedCandidateCount += 1;
  }

  const averageResidual = iterativeDensityContinuityCandidateCount
    ? residualTotal / iterativeDensityContinuityCandidateCount
    : 0;
  const convergenceRatio = iterativeDensityContinuityCandidateCount
    ? Math.max(0, Math.min(1, 1 - averageResidual / Math.max(maxIterativeDensityResidual, averageResidual, 1)))
    : 1;

  return {
    ...base,
    iterativeDensityContinuityCandidateCount,
    averageIterativeDensityResidual: round(averageResidual, 4),
    maxIterativeDensityResidual: round(maxIterativeDensityResidual, 4),
    iterativeDensityConvergenceRatio: round(convergenceRatio, 4),
    iterativeDensityClampCount,
    iterativeDensitySupportedCandidateRatio: iterativeDensityContinuityCandidateCount
      ? round(supportedCandidateCount / iterativeDensityContinuityCandidateCount, 4)
      : 0,
  };
}

function deepDensityContinuityStats(particles) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  const bins = new Uint32Array(SPATIAL_PRESSURE_CELL_COUNT);
  for (const particle of surfaceParticles) {
    bins[spatialCellIndex(particle.position)] += 1;
  }
  if (!surfaceParticles.length) {
    return {
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_DEEP_DENSITY_CONTINUITY_CONTRACT,
      projectionMode: 'two_ring_low_occupancy_continuity_projection_v0',
      deepContinuityTargetCellOccupancy: Math.floor(DENSITY_CONTINUITY_TARGET_OCCUPANCY * 0.72),
      surfaceParticleCount: 0,
      deepContinuityProjectionCandidateCount: 0,
      deepContinuityOccupiedCellCount: 0,
      deepContinuityDenseCellCount: 0,
      deepContinuityMaxCellOccupancy: 0,
      deepContinuityPeakOccupancyRatio: 0,
      deepContinuityRedistributionPressure: 0,
    };
  }

  const target = Math.floor(DENSITY_CONTINUITY_TARGET_OCCUPANCY * 0.72);
  let deepContinuityOccupiedCellCount = 0;
  let deepContinuityDenseCellCount = 0;
  let deepContinuityMaxCellOccupancy = 0;
  let excessTotal = 0;
  for (const count of bins) {
    if (count <= 0) continue;
    deepContinuityOccupiedCellCount += 1;
    deepContinuityMaxCellOccupancy = Math.max(deepContinuityMaxCellOccupancy, count);
    if (count >= target) {
      deepContinuityDenseCellCount += 1;
      excessTotal += count - target;
    }
  }

  let deepContinuityProjectionCandidateCount = 0;
  for (const particle of surfaceParticles) {
    const coords = spatialCellCoords(particle.position);
    const center = bins[coords.z * SPATIAL_PRESSURE_GRID_X + coords.x] || 0;
    let ringPressure = 0;
    for (let dz = -2; dz <= 2; dz += 1) {
      const neighborZ = coords.z + dz;
      if (neighborZ < 0 || neighborZ >= SPATIAL_PRESSURE_GRID_Z) continue;
      for (let dx = -2; dx <= 2; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        const neighborX = coords.x + dx;
        if (neighborX < 0 || neighborX >= SPATIAL_PRESSURE_GRID_X) continue;
        ringPressure += Math.max(0, center - (bins[neighborZ * SPATIAL_PRESSURE_GRID_X + neighborX] || 0));
      }
    }
    if (center >= target || ringPressure > target * 3) deepContinuityProjectionCandidateCount += 1;
  }

  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_DEEP_DENSITY_CONTINUITY_CONTRACT,
    projectionMode: 'two_ring_low_occupancy_continuity_projection_v0',
    deepContinuityTargetCellOccupancy: target,
    surfaceParticleCount: surfaceParticles.length,
    deepContinuityProjectionCandidateCount,
    deepContinuityOccupiedCellCount,
    deepContinuityDenseCellCount,
    deepContinuityMaxCellOccupancy,
    deepContinuityPeakOccupancyRatio: round(deepContinuityMaxCellOccupancy / Math.max(1, target), 4),
    deepContinuityRedistributionPressure: round(excessTotal / surfaceParticles.length, 4),
  };
}

function particleSupportBudgetStats(particles) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  const supportScale = particleSupportScale(particles.length);
  const supportRadius = viscosityRadiusForBudget(particles.length);
  const restDistance = densityRestDistanceForBudget(particles.length);
  const bins = new Uint32Array(SPATIAL_PRESSURE_CELL_COUNT);
  const cellParticleIndices = Array.from({ length: SPATIAL_PRESSURE_CELL_COUNT }, () => []);
  for (let index = 0; index < surfaceParticles.length; index += 1) {
    const cellIndex = spatialCellIndex(surfaceParticles[index].position);
    bins[cellIndex] += 1;
    cellParticleIndices[cellIndex].push(index);
  }
  if (!surfaceParticles.length) {
    return {
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_SUPPORT_BUDGET_CONTRACT,
      supportMeasurementMode: 'spatial_cell_radius_support_v0',
      particleBudget: particles.length,
      supportBudgetTarget: DEFAULT_PARTICLE_SUPPORT_BUDGET,
      supportGridCellCount: SPATIAL_PRESSURE_CELL_COUNT,
      supportGridX: SPATIAL_PRESSURE_GRID_X,
      supportGridZ: SPATIAL_PRESSURE_GRID_Z,
      supportNeighborWindow: PRESSURE_NEIGHBOR_WINDOW,
      supportRadius: round(supportRadius, 4),
      supportScale: round(supportScale, 4),
      surfaceParticleCount: 0,
      averageSupportNeighborCount: 0,
      minSupportNeighborCount: 0,
      unsupportedParticleCount: 0,
      unsupportedCorrectionRatio: 0,
      supportAdequacyRatio: 0,
    };
  }

  let supportNeighborTotal = 0;
  let minSupportNeighborCount = Infinity;
  let unsupportedParticleCount = 0;
  let correctionCandidateCount = 0;
  let unsupportedCorrectionCount = 0;
  for (let index = 0; index < surfaceParticles.length; index += 1) {
    const particle = surfaceParticles[index];
    const coords = spatialCellCoords(particle.position);
    const occupancy = bins[coords.z * SPATIAL_PRESSURE_GRID_X + coords.x] || 0;
    let supportNeighborCount = 0;
    let closePairCandidate = false;
    for (let dz = -1; dz <= 1; dz += 1) {
      const neighborZ = coords.z + dz;
      if (neighborZ < 0 || neighborZ >= SPATIAL_PRESSURE_GRID_Z) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const neighborX = coords.x + dx;
        if (neighborX < 0 || neighborX >= SPATIAL_PRESSURE_GRID_X) continue;
        const neighborIndices = cellParticleIndices[neighborZ * SPATIAL_PRESSURE_GRID_X + neighborX];
        for (const neighborIndex of neighborIndices) {
          const neighbor = surfaceParticles[neighborIndex];
          if (!neighbor || neighbor.id === particle.id || neighbor.chemistry !== particle.chemistry) continue;
          const distance = length3(sub(particle.position, neighbor.position));
          if (distance > 0.0001 && distance < supportRadius) supportNeighborCount += 1;
          if (distance > 0.0001 && distance < restDistance) closePairCandidate = true;
        }
      }
    }
    const isCorrectionCandidate = closePairCandidate || occupancy >= DENSITY_POSITION_SOLVE_TARGET_OCCUPANCY;
    if (isCorrectionCandidate) correctionCandidateCount += 1;
    if (supportNeighborCount < 2) {
      unsupportedParticleCount += 1;
      if (isCorrectionCandidate) unsupportedCorrectionCount += 1;
    }
    supportNeighborTotal += supportNeighborCount;
    minSupportNeighborCount = Math.min(minSupportNeighborCount, supportNeighborCount);
  }

  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_SUPPORT_BUDGET_CONTRACT,
    supportMeasurementMode: 'spatial_cell_radius_support_v0',
    particleBudget: particles.length,
    supportBudgetTarget: DEFAULT_PARTICLE_SUPPORT_BUDGET,
    supportGridCellCount: SPATIAL_PRESSURE_CELL_COUNT,
    supportGridX: SPATIAL_PRESSURE_GRID_X,
    supportGridZ: SPATIAL_PRESSURE_GRID_Z,
    supportNeighborWindow: PRESSURE_NEIGHBOR_WINDOW,
    supportRadius: round(supportRadius, 4),
    supportScale: round(supportScale, 4),
    surfaceParticleCount: surfaceParticles.length,
    averageSupportNeighborCount: round(supportNeighborTotal / surfaceParticles.length, 4),
    minSupportNeighborCount: Number.isFinite(minSupportNeighborCount) ? minSupportNeighborCount : 0,
    unsupportedParticleCount,
    unsupportedCorrectionRatio: correctionCandidateCount ? round(unsupportedCorrectionCount / correctionCandidateCount, 4) : 0,
    supportAdequacyRatio: round(1 - unsupportedParticleCount / surfaceParticles.length, 4),
  };
}

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * ratio)));
  return sortedValues[index];
}

function settleRestEnergyStats(particles) {
  const settledSurfaceSpeeds = particles
    .filter(particle => particle.surface_flow && particle.age >= 2.5)
    .map(particle => Math.hypot(particle.velocity[0], particle.velocity[2]))
    .sort((a, b) => a - b);
  if (!settledSurfaceSpeeds.length) {
    return {
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_SUPPORT_BUDGET_CONTRACT,
      restEnergyMode: 'settled_surface_speed_distribution_v0',
      settledSurfaceParticleCount: 0,
      averageSettledSurfaceSpeed: 0,
      p95SettledSurfaceSpeed: 0,
      maxSettledSurfaceSpeed: 0,
      restEnergyScore: 0,
    };
  }
  const averageSpeed = settledSurfaceSpeeds.reduce((sum, speed) => sum + speed, 0) / settledSurfaceSpeeds.length;
  const p95Speed = percentile(settledSurfaceSpeeds, 0.95);
  const maxSpeed = settledSurfaceSpeeds[settledSurfaceSpeeds.length - 1];
  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_SUPPORT_BUDGET_CONTRACT,
    restEnergyMode: 'settled_surface_speed_distribution_v0',
    settledSurfaceParticleCount: settledSurfaceSpeeds.length,
    averageSettledSurfaceSpeed: round(averageSpeed, 4),
    p95SettledSurfaceSpeed: round(p95Speed, 4),
    maxSettledSurfaceSpeed: round(maxSpeed, 4),
    restEnergyScore: round(Math.min(1, p95Speed / 0.95), 4),
  };
}

function stabilityStats(particles, spatialStats, depthStats) {
  const surfaceParticles = particles.filter(particle => particle.surface_flow);
  if (!surfaceParticles.length) {
    return {
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_STABILITY_CONTRACT,
      stabilityMode: 'damped_cell_relaxation_velocity_clamp_v0',
      surfaceParticleCount: 0,
      highSpeedParticleCount: 0,
      maxSurfaceSpeed: 0,
      averageSurfaceSpeed: 0,
      maxVelocityDelta: 0,
      denseCellSaturation: 0,
      maxCellOccupancy: 0,
      occupiedCellCount: 0,
      stabilityRiskScore: 0,
    };
  }

  const speeds = surfaceParticles.map(particle => Math.hypot(particle.velocity[0], particle.velocity[2]));
  const highSpeedParticleCount = speeds.filter(speed => speed > 0.92).length;
  const maxSurfaceSpeed = Math.max(...speeds);
  const averageSurfaceSpeed = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
  const maxCellOccupancy = spatialStats?.maxCellOccupancy || 0;
  const occupiedCellCount = spatialStats?.occupiedCellCount || 0;
  const denseCellSaturation = surfaceParticles.length ? maxCellOccupancy / surfaceParticles.length : 0;
  const maxVelocityDelta = depthStats?.maxVelocityDelta || 0;
  const highSpeedRatio = highSpeedParticleCount / surfaceParticles.length;
  const saturationRisk = Math.min(1, denseCellSaturation * 3.8);
  const velocityRisk = Math.min(1, maxVelocityDelta / 1.6);
  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_STABILITY_CONTRACT,
    stabilityMode: 'damped_cell_relaxation_velocity_clamp_v0',
    surfaceParticleCount: surfaceParticles.length,
    highSpeedParticleCount,
    maxSurfaceSpeed: round(maxSurfaceSpeed, 4),
    averageSurfaceSpeed: round(averageSurfaceSpeed, 4),
    maxVelocityDelta: round(maxVelocityDelta, 4),
    denseCellSaturation: round(denseCellSaturation, 4),
    maxCellOccupancy,
    occupiedCellCount,
    stabilityRiskScore: round(Math.min(1, highSpeedRatio * 2.2 + saturationRisk * 0.35 + velocityRisk * 0.25), 4),
  };
}

function visualStreakBeadStats(particles) {
  const activeParticles = particles.filter(particle => particle.active !== false);
  const surfaceParticles = activeParticles.filter(particle => particle.surface_flow);
  const bins = new Uint32Array(SPATIAL_PRESSURE_CELL_COUNT);
  for (const particle of surfaceParticles) {
    bins[spatialCellIndex(particle.position)] += 1;
  }
  let sparseSurfaceCellCount = 0;
  let detachedBeadParticleCount = 0;
  let longStreakParticleCount = 0;
  let olderAirborneStreakCount = 0;
  for (const particle of activeParticles) {
    const horizontalSpeed = Math.hypot(particle.velocity[0], particle.velocity[2]);
    if (!particle.surface_flow) {
      if (particle.age > 1.05 && horizontalSpeed > 0.7) olderAirborneStreakCount += 1;
      continue;
    }
    const cellIndex = spatialCellIndex(particle.position);
    const cellX = cellIndex % SPATIAL_PRESSURE_GRID_X;
    const cellZ = Math.floor(cellIndex / SPATIAL_PRESSURE_GRID_X);
    const center = bins[cellIndex] || 0;
    const neighborIndices = [
      [cellX - 1, cellZ],
      [cellX + 1, cellZ],
      [cellX, cellZ - 1],
      [cellX, cellZ + 1],
    ].filter(([x, z]) => x >= 0 && z >= 0 && x < SPATIAL_PRESSURE_GRID_X && z < SPATIAL_PRESSURE_GRID_Z)
      .map(([x, z]) => z * SPATIAL_PRESSURE_GRID_X + x);
    const occupiedNeighborCount = neighborIndices.filter(index => bins[index] > 0).length;
    if (center > 0 && center <= 2) sparseSurfaceCellCount += 1;
    if (center <= 2 && occupiedNeighborCount <= 1) detachedBeadParticleCount += 1;
    if (center <= 3 && occupiedNeighborCount <= 1 && horizontalSpeed > 0.42) longStreakParticleCount += 1;
  }
  const visualFailureRiskScore = Math.min(
    1,
    detachedBeadParticleCount / Math.max(1, surfaceParticles.length) * 1.8
      + longStreakParticleCount / Math.max(1, surfaceParticles.length) * 1.2
      + olderAirborneStreakCount / Math.max(1, activeParticles.length) * 0.8
  );
  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_VISUAL_DAMPING_CONTRACT,
    visualDampingMode: 'isolated_cell_and_old_airborne_drag_v0',
    activeParticleCount: activeParticles.length,
    surfaceParticleCount: surfaceParticles.length,
    sparseSurfaceCellCount,
    detachedBeadParticleCount,
    longStreakParticleCount,
    olderAirborneStreakCount,
    visualFailureRiskScore: round(visualFailureRiskScore, 4),
  };
}

function supportFrameForSummary(options = {}) {
  if (options.terrainSampleSurface?.supportFrame) return options.terrainSampleSurface.supportFrame;
  return normalizeHillSupportFramePayload(options.hillSupportFramePayload || options.supportFramePayload, {
    stepCount: options.stepCount || 0,
  }) || createFingerJuiceSupportFrame({ stepCount: options.stepCount || 0 });
}

function terrainSampleDiagnosticsForSummary(options = {}) {
  const surface = options.terrainSampleSurface;
  if (!surface) {
    return {
      schema: 'big-papa-finger-juice.terrain-sample-diagnostics.v0',
      terrainSampleCouplingMode: 'local_procedural_heightfield_v0',
      terrainSampleGpuCollisionMode: options.terrainSampleGpuCollisionMode || LOCAL_PROCEDURAL_GPU_COLLISION_MODE,
      terrainSampleStatus: 'missing',
    };
  }
  const diagnostics = surface.diagnostics || {
    schema: 'big-papa-finger-juice.terrain-sample-diagnostics.v0',
    terrainSampleCouplingMode: 'source_height_samples_v0',
    terrainSampleStatus: surface.status || 'loaded',
    sourceAuthority: surface.sourceAuthority || null,
    sampleChecksum: surface.checksums?.sample || null,
    channelChecksum: surface.checksums?.channels || null,
  };
  return {
    ...diagnostics,
    terrainSampleGpuCollisionMode: options.terrainSampleGpuCollisionMode || SOURCE_TERRAIN_GPU_COLLISION_MODE,
  };
}

export function summarizeWebGPUParticles(buffer, options = {}) {
  if (options.summaryMode === LERMS_FINGER_JUICE_LIVE_LIGHTWEIGHT_READBACK_MODE) {
    const sourceTruth = createLermsSourceTruth(options.emitterPacket || {}, {
      frameId: options.frameId || `kaminos-finger-juice-step-${Math.max(0, Math.floor(options.stepCount || 0))}`,
      timestampMs: options.timestampMs || 0,
    });
    const particlesPerEmitter = {};
    const liveParticles = [];
    let activeParticleCount = 0;
    let surfaceFlowCount = 0;
    let maxParticleAge = 0;
    let gpuRespawnCount = 0;
    const substrateSupportValues = [];
    for (let i = 0; i < buffer.length / PARTICLE_FLOATS; i += 1) {
      const particle = readParticle(buffer, i);
      gpuRespawnCount += finite(particle.respawnCount, 0);
      if (!particle.active || particle.age < 0 || particle.age >= particle.life) continue;
      activeParticleCount += 1;
      if (particle.phase >= 0.5) {
        surfaceFlowCount += 1;
        if (options.neighborSupportData) {
          substrateSupportValues.push(Math.max(0, finite(options.neighborSupportData[i], 0)));
        }
      }
      maxParticleAge = Math.max(maxParticleAge, finite(particle.age, 0));
      const source = options.sources?.find(item => item.emitterIndex === particle.emitterIndex);
      const emitterId = source?.emitter_id || `emitter-${particle.emitterIndex}`;
      particlesPerEmitter[emitterId] = (particlesPerEmitter[emitterId] || 0) + 1;
      liveParticles.push({
        id: `wgpu-live-${i}`,
        emitter_id: emitterId,
        chemistry: chemistryName(particle.chemistry),
        phase: particle.phase >= 0.5 ? 'surface_flow' : 'airborne',
        surface_flow: particle.phase >= 0.5,
        pooling: particle.chemistry === 2 && particle.phase >= 0.5,
        position: particle.position.map(value => round(value, 4)),
        velocity: particle.velocity.map(value => round(value, 4)),
        radius: round(particle.radius, 4),
        strength: round(particle.strength, 4),
      });
    }
    substrateSupportValues.sort((a, b) => a - b);
    const substrateSupportTotal = substrateSupportValues.reduce((sum, value) => sum + value, 0);
    const substrateSupportedCount = substrateSupportValues.filter(value => value >= 2).length;
    const supportFrame = supportFrameForSummary(options);
    const terrainSampleDiagnostics = terrainSampleDiagnosticsForSummary(options);
    const substrateReservoirDiagnostics = createReservoirDomainDiagnostics(liveParticles, supportFrame);
    return {
      solver_backend: options.solver_backend || 'webgpu_compute',
      solverRoute: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
      shaderRoute: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
      emitterBufferRoute: LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE,
      respawnContract: LERMS_FINGER_JUICE_WEBGPU_RESPAWN_CONTRACT,
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT,
      spatialPressureContract: LERMS_FINGER_JUICE_WEBGPU_SPATIAL_PRESSURE_CONTRACT,
      fluidDepthContract: LERMS_FINGER_JUICE_WEBGPU_FLUID_DEPTH_CONTRACT,
      surfaceRelaxationContract: LERMS_FINGER_JUICE_WEBGPU_SURFACE_RELAXATION_CONTRACT,
      densityPositionSolveContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_POSITION_SOLVE_CONTRACT,
      densityContinuityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_CONTINUITY_CONTRACT,
      sampledNeighborhoodDensityContract: LERMS_FINGER_JUICE_WEBGPU_SAMPLED_NEIGHBORHOOD_DENSITY_CONTRACT,
      localPairDensityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_LOCAL_PAIR_DENSITY_CONTRACT,
      deepDensityContinuityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_DEEP_DENSITY_CONTINUITY_CONTRACT,
      neighborSupportSubstrateContract: LERMS_FINGER_JUICE_WEBGPU_NEIGHBOR_SUPPORT_SUBSTRATE_CONTRACT,
      substrateDensityConstraintContract: LERMS_FINGER_JUICE_WEBGPU_SUBSTRATE_DENSITY_CONSTRAINT_CONTRACT,
      iterativeDensityContinuityContract: LERMS_FINGER_JUICE_WEBGPU_ITERATIVE_DENSITY_CONTINUITY_CONTRACT,
      particleSupportBudgetContract: LERMS_FINGER_JUICE_WEBGPU_SUPPORT_BUDGET_CONTRACT,
      stabilityContract: LERMS_FINGER_JUICE_WEBGPU_STABILITY_CONTRACT,
      visualDampingContract: LERMS_FINGER_JUICE_WEBGPU_VISUAL_DAMPING_CONTRACT,
      summaryMode: LERMS_FINGER_JUICE_LIVE_LIGHTWEIGHT_READBACK_MODE,
      sourceTruth,
      sourceDiagnostics: createSourceDiagnostics(options.emitterPacket || {}, sourceTruth, options.sources || []),
      emitterDiagnostics: createEmitterDiagnostics(options.sources || [], particlesPerEmitter, null),
      supportFrame,
      supportFrameChecksum: supportFrame.supportFrameChecksum,
      terrainSampleDiagnostics,
      terrainSampleGpuCollisionMode: terrainSampleDiagnostics.terrainSampleGpuCollisionMode,
      substrateReservoirDiagnostics,
      activeReservoirDomains: substrateReservoirDiagnostics.activeReservoirDomains,
      neighborSupportSubstrateStats: {
        pressureContract: LERMS_FINGER_JUICE_WEBGPU_NEIGHBOR_SUPPORT_SUBSTRATE_CONTRACT,
        neighborSupportSubstrateMode: 'gpu_hash_sampled_same_chemistry_support_buffer_v0',
        substrateReadbackMode: options.neighborSupportData ? 'gpu_neighbor_support_buffer_readback_v0' : 'missing_neighbor_support_buffer_readback_v0',
        substrateSampleCount: NEIGHBOR_SUPPORT_SUBSTRATE_SAMPLE_COUNT,
        surfaceParticleCount: substrateSupportValues.length,
        averageSubstrateNeighborSupport: substrateSupportValues.length ? round(substrateSupportTotal / substrateSupportValues.length, 4) : 0,
        maxSubstrateNeighborSupport: round(substrateSupportValues[substrateSupportValues.length - 1] || 0, 4),
        p95SubstrateNeighborSupport: round(percentile(substrateSupportValues, 0.95), 4),
        supportedSubstrateParticleCount: substrateSupportedCount,
        unsupportedSubstrateParticleCount: substrateSupportValues.length - substrateSupportedCount,
        substrateAdequacyRatio: substrateSupportValues.length ? round(substrateSupportedCount / substrateSupportValues.length, 4) : 0,
      },
      substrateDensityConstraintStats: {
        pressureContract: LERMS_FINGER_JUICE_WEBGPU_SUBSTRATE_DENSITY_CONSTRAINT_CONTRACT,
        substrateDensityConstraintMode: 'bounded_support_lambda_sheet_projection_v0',
        substrateDensityTargetSupport: SUBSTRATE_DENSITY_TARGET_SUPPORT,
        surfaceParticleCount: substrateSupportValues.length,
        substrateConstraintCandidateCount: substrateSupportValues.filter(value => value < SUBSTRATE_DENSITY_TARGET_SUPPORT).length,
        lowSupportConstraintCount: substrateSupportValues.filter(value => value < SUBSTRATE_DENSITY_TARGET_SUPPORT).length,
        highDensityConstraintCount: 0,
        averageSubstrateConstraintError: substrateSupportValues.length
          ? round(substrateSupportValues.reduce((sum, value) => sum + Math.max(0, SUBSTRATE_DENSITY_TARGET_SUPPORT - value) / SUBSTRATE_DENSITY_TARGET_SUPPORT, 0) / substrateSupportValues.length, 4)
          : 0,
        maxSubstrateConstraintError: substrateSupportValues.length
          ? round(Math.max(...substrateSupportValues.map(value => Math.max(0, SUBSTRATE_DENSITY_TARGET_SUPPORT - value) / SUBSTRATE_DENSITY_TARGET_SUPPORT)), 4)
          : 0,
        unsupportedSubstrateConstraintRatio: substrateSupportValues.length
          ? round(substrateSupportValues.filter(value => value < 1).length / substrateSupportValues.length, 4)
          : 0,
        substrateSheetPullRatio: 0,
      },
      iterativeDensityContinuityStats: {
        pressureContract: LERMS_FINGER_JUICE_WEBGPU_ITERATIVE_DENSITY_CONTINUITY_CONTRACT,
        projectionMode: 'fixed_iteration_support_residual_projection_v0',
        iterativeDensityContinuityIterationCount: ITERATIVE_DENSITY_CONTINUITY_ITERATIONS,
        iterativeDensityTargetCellOccupancy: Math.floor(DENSITY_CONTINUITY_TARGET_OCCUPANCY * 0.58),
        surfaceParticleCount: substrateSupportValues.length,
        iterativeDensityContinuityCandidateCount: substrateSupportValues.filter(value => value < SUBSTRATE_DENSITY_TARGET_SUPPORT).length,
        averageIterativeDensityResidual: substrateSupportValues.length
          ? round(substrateSupportValues.reduce((sum, value) => sum + Math.max(0, SUBSTRATE_DENSITY_TARGET_SUPPORT - value) / SUBSTRATE_DENSITY_TARGET_SUPPORT * 0.65, 0) / substrateSupportValues.length, 4)
          : 0,
        maxIterativeDensityResidual: substrateSupportValues.length
          ? round(Math.max(...substrateSupportValues.map(value => Math.max(0, SUBSTRATE_DENSITY_TARGET_SUPPORT - value) / SUBSTRATE_DENSITY_TARGET_SUPPORT * 0.65)), 4)
          : 0,
        iterativeDensityConvergenceRatio: substrateSupportValues.length ? 0.35 : 1,
        iterativeDensityClampCount: 0,
        iterativeDensitySupportedCandidateRatio: 0,
      },
      particleCount: activeParticleCount,
      surfaceFlowCount,
      maxParticleAge: round(maxParticleAge, 4),
      gpuRespawnCount: Math.floor(gpuRespawnCount),
      particlesPerEmitter,
      particles: liveParticles.slice(0, 128),
      frameId: options.frameId || `kaminos-finger-juice-step-${Math.max(0, Math.floor(options.stepCount || 0))}`,
      stepCount: Math.max(0, Math.floor(options.stepCount || 0)),
    };
  }

  const particles = [];
  const rawParticles = [];
  const sourceTruth = createLermsSourceTruth(options.emitterPacket || {}, {
    frameId: options.frameId || `kaminos-finger-juice-step-${Math.max(0, Math.floor(options.stepCount || 0))}`,
    timestampMs: options.timestampMs || 0,
  });
  const sourcePacketId = options.emitterPacket?.packet_id || sourceTruth.frameId;
  for (let i = 0; i < buffer.length / PARTICLE_FLOATS; i += 1) {
    const particle = readParticle(buffer, i);
    rawParticles.push(particle);
    if (!particle.active || particle.age < 0 || particle.age >= particle.life) continue;
    const source = options.sources?.find(item => item.emitterIndex === particle.emitterIndex);
    particles.push({
      id: `wgpu-${i}`,
      emitter_id: source?.emitter_id || `emitter-${particle.emitterIndex}`,
      chemistry: chemistryName(particle.chemistry),
      phase: particle.phase >= 0.5 ? 'surface_flow' : 'airborne',
      surface_flow: particle.phase >= 0.5,
      pooling: particle.chemistry === 2 && particle.phase >= 0.5,
      position: particle.position.map(value => round(value, 4)),
      velocity: particle.velocity.map(value => round(value, 4)),
      radius: round(particle.radius, 4),
      strength: round(particle.strength, 4),
      age: round(particle.age, 4),
      life: round(particle.life, 4),
      emitterIndex: particle.emitterIndex,
      impacted: particle.impacted,
      respawnCount: Math.floor(finite(particle.respawnCount, 0)),
    });
  }
  const lermHits = targetHits(particles, options.lerms || [], 'lerm', { sourceTruth, sourcePacketId });
  const goinHits = targetHits(particles, options.goins || [], 'goin', { sourceTruth, sourcePacketId });
  const trailsByEmitter = new Map();
  for (const particle of particles.slice(-162)) {
    const source = options.sources?.find(item => item.emitterIndex === particle.emitterIndex);
    const trail = {
      id: `${particle.id}-trail`,
      emitter_id: particle.emitter_id,
      chemistry: particle.chemistry,
      phase: particle.phase,
      surface_flow: particle.surface_flow,
      source_anchor: source ? {
        position: source.position.map(value => round(value, 4)),
        phase: 'source_anchor',
        velocity_hint: source.velocity.map(value => round(value, 4)),
      } : null,
      phase_markers: [
        source ? {
          position: source.position.map(value => round(value, 4)),
          phase: 'airborne',
          velocity_hint: source.velocity.map(value => round(value, 4)),
        } : null,
        particle.impacted ? {
          position: particle.position.map(value => round(value, 4)),
          phase: 'impact',
          velocity_hint: particle.velocity.map(value => round(value, 4)),
        } : null,
      ].filter(Boolean),
      samples: [
        {
          position: add(particle.position, mul(particle.velocity, -0.016)).map(value => round(value, 4)),
          phase: particle.phase,
          velocity_hint: particle.velocity.map(value => round(value, 4)),
        },
        {
          position: particle.position.map(value => round(value, 4)),
          phase: particle.phase,
          velocity_hint: particle.velocity.map(value => round(value, 4)),
        },
      ],
    };
    const list = trailsByEmitter.get(trail.emitter_id) || [];
    list.push(trail);
    trailsByEmitter.set(trail.emitter_id, list);
  }
  const trails = [...trailsByEmitter.values()].flatMap(list => list.slice(-54));
  const trailSamples = trails.flatMap(trail => trail.samples);
  const phaseMarkers = trails.flatMap(trail => trail.phase_markers || []);
  const segmentLengths = trails.map(trail => length3(sub(trail.samples[1].position, trail.samples[0].position)));
  const zValues = trailSamples.map(sample => sample.position[2]);
  const particlesPerEmitter = {};
  for (const particle of particles) {
    particlesPerEmitter[particle.emitter_id] = (particlesPerEmitter[particle.emitter_id] || 0) + 1;
  }
  const ringSource = options.sources?.find(source => source.emitter_id === 'ring')
    || options.sources?.find(source => source.chemistry === 'weird');
  const ringParticles = ringSource
    ? particles.filter(particle => particle.emitterIndex === ringSource.emitterIndex)
    : [];
  const ringDeltas = ringParticles.map(particle => particle.position[0] - ringSource.origin[0]);
  const ringEmitterLateralDrift = ringSource ? {
    emitter_id: ringSource.emitter_id,
    source_x: round(ringSource.origin[0], 4),
    aim_x: round(ringSource.aim[0], 4),
    motion_x: round(ringSource.motion[0], 4),
    particle_count: ringParticles.length,
    average_x_delta: ringDeltas.length ? round(ringDeltas.reduce((sum, value) => sum + value, 0) / ringDeltas.length, 4) : 0,
    min_x_delta: ringDeltas.length ? round(Math.min(...ringDeltas), 4) : 0,
    max_x_delta: ringDeltas.length ? round(Math.max(...ringDeltas), 4) : 0,
  } : null;
  const pressureStats = pressureDensityStats(particles);
  const spatialStats = spatialPressureStats(particles);
  const depthStats = fluidDepthStats(particles);
  const cohesionStats = surfaceCohesionStats(particles);
  const relaxationStats = spatialSurfaceRelaxationStats(particles);
  const densitySolveStats = densityPositionSolveStats(particles);
  const densityContinuityStats = densityContinuityProjectionStats(particles);
  const sampledNeighborhoodStats = sampledNeighborhoodDensityStats(particles);
  const localPairStats = localPairDensityStats(particles, sampledNeighborhoodStats);
  const neighborSupportStats = neighborSupportSubstrateStats(particles, options.neighborSupportData || null);
  const substrateDensityStats = substrateDensityConstraintStats(particles, options.neighborSupportData || null);
  const iterativeDensityStats = iterativeDensityContinuityStats(particles, options.neighborSupportData || null);
  const deepDensityStats = deepDensityContinuityStats(particles);
  const supportBudgetStats = particleSupportBudgetStats(particles);
  const restEnergyStats = settleRestEnergyStats(particles);
  const solverStabilityStats = stabilityStats(particles, spatialStats, depthStats);
  const visualStats = visualStreakBeadStats(particles);
  const supportFrame = supportFrameForSummary(options);
  const terrainSampleDiagnostics = terrainSampleDiagnosticsForSummary(options);
  const substrateReservoirDiagnostics = createReservoirDomainDiagnostics(particles, supportFrame);
  const juiceHitEvents = [...lermHits.hitEvents, ...goinHits.hitEvents].slice(0, 256);
  const emitterDiagnostics = createEmitterDiagnostics(options.sources || [], particlesPerEmitter, ringEmitterLateralDrift);
  const sourceDiagnostics = createSourceDiagnostics(options.emitterPacket || {}, sourceTruth, options.sources || []);
  return {
    solver_backend: options.solver_backend || 'webgpu_compute',
    solverRoute: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
    shaderRoute: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
    emitterBufferRoute: LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE,
    respawnContract: LERMS_FINGER_JUICE_WEBGPU_RESPAWN_CONTRACT,
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT,
    spatialPressureContract: LERMS_FINGER_JUICE_WEBGPU_SPATIAL_PRESSURE_CONTRACT,
    fluidDepthContract: LERMS_FINGER_JUICE_WEBGPU_FLUID_DEPTH_CONTRACT,
    surfaceRelaxationContract: LERMS_FINGER_JUICE_WEBGPU_SURFACE_RELAXATION_CONTRACT,
    densityPositionSolveContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_POSITION_SOLVE_CONTRACT,
    densityContinuityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_CONTINUITY_CONTRACT,
    sampledNeighborhoodDensityContract: LERMS_FINGER_JUICE_WEBGPU_SAMPLED_NEIGHBORHOOD_DENSITY_CONTRACT,
    localPairDensityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_LOCAL_PAIR_DENSITY_CONTRACT,
    deepDensityContinuityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_DEEP_DENSITY_CONTINUITY_CONTRACT,
    neighborSupportSubstrateContract: LERMS_FINGER_JUICE_WEBGPU_NEIGHBOR_SUPPORT_SUBSTRATE_CONTRACT,
    substrateDensityConstraintContract: LERMS_FINGER_JUICE_WEBGPU_SUBSTRATE_DENSITY_CONSTRAINT_CONTRACT,
    iterativeDensityContinuityContract: LERMS_FINGER_JUICE_WEBGPU_ITERATIVE_DENSITY_CONTINUITY_CONTRACT,
    particleSupportBudgetContract: LERMS_FINGER_JUICE_WEBGPU_SUPPORT_BUDGET_CONTRACT,
    stabilityContract: LERMS_FINGER_JUICE_WEBGPU_STABILITY_CONTRACT,
    visualDampingContract: LERMS_FINGER_JUICE_WEBGPU_VISUAL_DAMPING_CONTRACT,
    sourceTruth,
    sourceDiagnostics,
    emitterDiagnostics,
    supportFrame,
    supportFrameChecksum: supportFrame.supportFrameChecksum,
    terrainSampleDiagnostics,
    terrainSampleGpuCollisionMode: terrainSampleDiagnostics.terrainSampleGpuCollisionMode,
    substrateReservoirDiagnostics,
    activeReservoirDomains: substrateReservoirDiagnostics.activeReservoirDomains,
    pressureDensityStats: pressureStats,
    spatialPressureStats: spatialStats,
    fluidDepthStats: depthStats,
    surfaceCohesionStats: cohesionStats,
    spatialSurfaceRelaxationStats: relaxationStats,
    densityPositionSolveStats: densitySolveStats,
    densityContinuityProjectionStats: densityContinuityStats,
    sampledNeighborhoodDensityStats: sampledNeighborhoodStats,
    localPairDensityStats: localPairStats,
    neighborSupportSubstrateStats: neighborSupportStats,
    substrateDensityConstraintStats: substrateDensityStats,
    iterativeDensityContinuityStats: iterativeDensityStats,
    deepDensityContinuityStats: deepDensityStats,
    particleSupportBudgetStats: supportBudgetStats,
    settleRestEnergyStats: restEnergyStats,
    stabilityStats: solverStabilityStats,
    visualStreakBeadStats: visualStats,
    juiceHitEvents,
    juiceHitEventCount: lermHits.hitEvents.length + goinHits.hitEvents.length,
    particleCount: particles.length,
    maxParticleAge: rawParticles.length ? round(Math.max(...rawParticles.map(particle => finite(particle.age, 0))), 4) : 0,
    gpuRespawnCount: Math.floor(rawParticles.reduce((sum, particle) => sum + finite(particle.respawnCount, 0), 0)),
    particlesPerEmitter,
    ringEmitterLateralDrift,
    airborneCount: particles.filter(particle => !particle.surface_flow).length,
    surfaceFlowCount: particles.filter(particle => particle.surface_flow).length,
    poolingCount: particles.filter(particle => particle.pooling).length,
    trailSampleCount: trailSamples.length,
    trailEmitterCount: new Set(trails.map(trail => trail.emitter_id)).size,
    surfaceStreakCount: trails.filter(trail => trail.surface_flow).length,
    trailSpanZ: zValues.length ? round(Math.max(...zValues) - Math.min(...zValues), 4) : 0,
    flowExtentX: particles.length ? round(Math.max(...particles.map(particle => particle.position[0])) - Math.min(...particles.map(particle => particle.position[0])), 4) : 0,
    flowExtentZ: particles.length ? round(Math.max(...particles.map(particle => particle.position[2])) - Math.min(...particles.map(particle => particle.position[2])), 4) : 0,
    sourceAnchorCount: new Set(trails.filter(trail => trail.source_anchor).map(trail => trail.emitter_id)).size,
    maxTrailSegmentLength: segmentLengths.length ? round(Math.max(...segmentLengths), 4) : 0,
    airborneBreadcrumbCount: [...trailSamples, ...phaseMarkers].filter(sample => sample.phase === 'airborne').length,
    impactRingCount: [...trailSamples, ...phaseMarkers].filter(sample => sample.phase === 'impact').length,
    surfaceSmearCount: trailSamples.filter(sample => sample.phase === 'surface_flow').length,
    lermImpulseCount: lermHits.count,
    goinImpulseCount: goinHits.count,
    maxRangeZ: particles.length ? round(Math.max(...particles.map(particle => particle.position[2] + 0.82)), 4) : 0,
    particles: particles.slice(0, 128),
    trails,
    targets: {
      lerms: lermHits.targets.map(target => ({
        id: target.id,
        position: vec3(target.position).map(value => round(value, 4)),
        radius: round(target.radius ?? 0.16, 4),
        hits: target.hits,
        impulse: target.impulse,
      })),
      goins: goinHits.targets.map(target => ({
        id: target.id,
        position: vec3(target.position).map(value => round(value, 4)),
        radius: round(target.radius ?? 0.13, 4),
        hits: target.hits,
        impulse: target.impulse,
      })),
    },
  };
}

const COMPUTE_SHADER = `
struct Particle {
  posPhase: vec4f,
  velChem: vec4f,
  misc: vec4f,
  flags: vec4f,
};

struct Emitter {
  originActive: vec4f,
  aimChem: vec4f,
  motionRadius: vec4f,
  strengthExtensionIndexLife: vec4f,
};

struct Params {
  dt: f32,
  particleCount: u32,
  steps: u32,
  emitterCount: u32,
  stepCount: u32,
  terrainMode: u32,
  terrainColumns: u32,
  terrainRows: u32,
  terrainMinX: f32,
  terrainMaxX: f32,
  terrainMinZ: f32,
  terrainMaxZ: f32,
  pad0: vec4f,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read> emitters: array<Emitter>;
@group(0) @binding(3) var<storage, read_write> pressureBins: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> neighborSupportBuffer: array<f32>;
@group(0) @binding(5) var<storage, read> terrainSamples: array<vec4f>;

const SPATIAL_PRESSURE_GRID_X: u32 = ${SPATIAL_PRESSURE_GRID_X}u;
const SPATIAL_PRESSURE_GRID_Z: u32 = ${SPATIAL_PRESSURE_GRID_Z}u;
const SPATIAL_PRESSURE_CELL_COUNT: u32 = ${SPATIAL_PRESSURE_CELL_COUNT}u;
const SPATIAL_PRESSURE_MIN_X: f32 = ${SPATIAL_PRESSURE_MIN_X.toFixed(4)};
const SPATIAL_PRESSURE_MAX_X: f32 = ${SPATIAL_PRESSURE_MAX_X.toFixed(4)};
const SPATIAL_PRESSURE_MIN_Z: f32 = ${SPATIAL_PRESSURE_MIN_Z.toFixed(4)};
const SPATIAL_PRESSURE_MAX_Z: f32 = ${SPATIAL_PRESSURE_MAX_Z.toFixed(4)};
const DENSITY_POSITION_SOLVE_TARGET_OCCUPANCY: f32 = ${DENSITY_POSITION_SOLVE_TARGET_OCCUPANCY.toFixed(1)};
const DENSITY_CONTINUITY_TARGET_OCCUPANCY: f32 = ${DENSITY_CONTINUITY_TARGET_OCCUPANCY.toFixed(1)};
const SAMPLED_NEIGHBORHOOD_SAMPLE_COUNT: u32 = ${SAMPLED_NEIGHBORHOOD_SAMPLE_COUNT}u;
const LOCAL_PAIR_DENSITY_SAMPLE_COUNT: u32 = ${LOCAL_PAIR_DENSITY_SAMPLE_COUNT}u;
const NEIGHBOR_SUPPORT_SUBSTRATE_SAMPLE_COUNT: u32 = ${NEIGHBOR_SUPPORT_SUBSTRATE_SAMPLE_COUNT}u;
const SUBSTRATE_DENSITY_TARGET_SUPPORT: f32 = ${SUBSTRATE_DENSITY_TARGET_SUPPORT.toFixed(4)};
const ITERATIVE_DENSITY_CONTINUITY_ITERATIONS: u32 = ${ITERATIVE_DENSITY_CONTINUITY_ITERATIONS}u;
const DENSITY_POSITION_SOLVE_REST_DISTANCE: f32 = ${DENSITY_POSITION_SOLVE_REST_DISTANCE.toFixed(4)};
const BASELINE_PARTICLE_SUPPORT_BUDGET: f32 = ${BASELINE_PARTICLE_SUPPORT_BUDGET.toFixed(1)};
const MIN_PARTICLE_SUPPORT_SCALE: f32 = ${MIN_PARTICLE_SUPPORT_SCALE.toFixed(4)};
const PRESSURE_RADIUS_BASE: f32 = ${PRESSURE_RADIUS.toFixed(4)};
const SURFACE_VISCOSITY_RADIUS_BASE: f32 = ${SURFACE_VISCOSITY_RADIUS.toFixed(4)};

fn particleSupportScale() -> f32 {
  return clamp(sqrt(BASELINE_PARTICLE_SUPPORT_BUDGET / max(1.0, f32(params.particleCount))), MIN_PARTICLE_SUPPORT_SCALE, 1.0);
}

fn proceduralTerrainHeightAt(x: f32, z: f32) -> f32 {
  let bowl = -0.08 + 0.11 * x * x + 0.035 * cos(z * 1.65);
  let hillA = 0.11 * exp(-((x - 0.46) * (x - 0.46) + (z - 0.28) * (z - 0.28)) / 0.18);
  let hillB = 0.09 * exp(-((x + 0.36) * (x + 0.36) + (z + 0.1) * (z + 0.1)) / 0.11);
  let valley = -0.08 * exp(-((x - 0.05) * (x - 0.05) + (z + 0.08) * (z + 0.08)) / 0.08);
  return bowl + hillA + hillB + valley;
}

fn terrainSampleIndex(column: u32, row: u32) -> u32 {
  let safeColumn = min(column, max(1u, params.terrainColumns) - 1u);
  let safeRow = min(row, max(1u, params.terrainRows) - 1u);
  return safeRow * max(1u, params.terrainColumns) + safeColumn;
}

fn terrainSampleUv(x: f32, z: f32) -> vec2f {
  let spanX = max(0.0001, params.terrainMaxX - params.terrainMinX);
  let spanZ = max(0.0001, params.terrainMaxZ - params.terrainMinZ);
  return vec2f(
    clamp((x - params.terrainMinX) / spanX, 0.0, 1.0),
    clamp((z - params.terrainMinZ) / spanZ, 0.0, 1.0)
  );
}

fn terrainSampleLerp(x: f32, z: f32) -> vec4f {
  if (params.terrainMode == 0u || params.terrainColumns <= 1u || params.terrainRows <= 1u) {
    return vec4f(proceduralTerrainHeightAt(x, z), 0.0, 1.0, 0.0);
  }
  let uv = terrainSampleUv(x, z);
  let gx = uv.x * f32(params.terrainColumns - 1u);
  let gz = uv.y * f32(params.terrainRows - 1u);
  let x0 = u32(floor(gx));
  let z0 = u32(floor(gz));
  let x1 = min(x0 + 1u, params.terrainColumns - 1u);
  let z1 = min(z0 + 1u, params.terrainRows - 1u);
  let tx = gx - f32(x0);
  let tz = gz - f32(z0);
  let a = terrainSamples[terrainSampleIndex(x0, z0)];
  let b = terrainSamples[terrainSampleIndex(x1, z0)];
  let c = terrainSamples[terrainSampleIndex(x0, z1)];
  let d = terrainSamples[terrainSampleIndex(x1, z1)];
  return mix(mix(a, b, tx), mix(c, d, tx), tz);
}

fn terrainHeightAt(x: f32, z: f32) -> f32 {
  return terrainSampleLerp(x, z).x;
}

fn proceduralTerrainNormalAt(x: f32, z: f32) -> vec3f {
  let eps = 0.015;
  let dx = (terrainHeightAt(x + eps, z) - terrainHeightAt(x - eps, z)) / (eps * 2.0);
  let dz = (terrainHeightAt(x, z + eps) - terrainHeightAt(x, z - eps)) / (eps * 2.0);
  return normalize(vec3f(-dx, 1.0, -dz));
}

fn terrainNormalAt(x: f32, z: f32) -> vec3f {
  if (params.terrainMode == 0u) {
    return proceduralTerrainNormalAt(x, z);
  }
  let sample = terrainSampleLerp(x, z);
  let normal = sample.yzw;
  return select(vec3f(0.0, 1.0, 0.0), normalize(normal), length(normal) > 0.0001);
}

fn slideVelocityOnTerrain(velocity: vec3f, normal: vec3f, chemistry: f32) -> vec3f {
  let normalComponent = dot(normal, velocity);
  let tangent = velocity - normal * normalComponent;
  let viscosity = select(select(0.84, 0.77, chemistry > 2.5), 0.66, chemistry > 1.5 && chemistry < 2.5);
  let downhill = normalize(vec3f(normal.x, 0.0, normal.z) + vec3f(0.0001, 0.0, 0.0001));
  let slide = select(0.04, 0.1, chemistry > 1.5 && chemistry < 2.5);
  return tangent * viscosity + downhill * slide;
}

fn applyLocalDensityPressure(index: u32, position: vec3f, velocity: vec3f, radius: f32, chemistry: f32) -> vec3f {
  var correction = vec3f(0.0, 0.0, 0.0);
  let pressureRadius = max(PRESSURE_RADIUS_BASE * particleSupportScale(), radius * 2.35);
  for (var offset: u32 = 1u; offset <= ${PRESSURE_NEIGHBOR_WINDOW}u; offset = offset + 1u) {
    let forwardIndex = (index + offset) % params.particleCount;
    let backIndex = (index + params.particleCount - offset) % params.particleCount;
    let forward = particles[forwardIndex];
    let back = particles[backIndex];
    if (forward.flags.y > 0.5 && forward.posPhase.w >= 0.5 && forward.misc.z >= 0.0 && forward.misc.z < forward.misc.w) {
      let delta = position - forward.posPhase.xyz;
      let distance = length(delta);
      if (distance > 0.0001 && distance < pressureRadius) {
        correction = correction + normalize(delta) * ((pressureRadius - distance) / pressureRadius);
      }
    }
    if (back.flags.y > 0.5 && back.posPhase.w >= 0.5 && back.misc.z >= 0.0 && back.misc.z < back.misc.w) {
      let delta = position - back.posPhase.xyz;
      let distance = length(delta);
      if (distance > 0.0001 && distance < pressureRadius) {
        correction = correction + normalize(delta) * ((pressureRadius - distance) / pressureRadius);
      }
    }
  }
  let pressureScale = select(0.021, 0.033, chemistry > 1.5 && chemistry < 2.5);
  return velocity + vec3f(correction.x, 0.0, correction.z) * pressureScale;
}

fn pressureCellAxis(value: f32, minValue: f32, maxValue: f32, cells: u32) -> u32 {
  let span = max(0.0001, maxValue - minValue);
  let normalized = clamp((value - minValue) / span, 0.0, 0.9999);
  return min(u32(floor(normalized * f32(cells))), cells - 1u);
}

fn pressureCellIndex(position: vec3f) -> u32 {
  let cellX = pressureCellAxis(position.x, SPATIAL_PRESSURE_MIN_X, SPATIAL_PRESSURE_MAX_X, SPATIAL_PRESSURE_GRID_X);
  let cellZ = pressureCellAxis(position.z, SPATIAL_PRESSURE_MIN_Z, SPATIAL_PRESSURE_MAX_Z, SPATIAL_PRESSURE_GRID_Z);
  return cellZ * SPATIAL_PRESSURE_GRID_X + cellX;
}

fn pressureCellCountAt(cellX: i32, cellZ: i32) -> f32 {
  if (cellX < 0 || cellZ < 0 || cellX >= i32(SPATIAL_PRESSURE_GRID_X) || cellZ >= i32(SPATIAL_PRESSURE_GRID_Z)) {
    return 0.0;
  }
  let index = u32(cellZ) * SPATIAL_PRESSURE_GRID_X + u32(cellX);
  return f32(atomicLoad(&pressureBins[index]));
}

fn particleIsLiveSurface(particle: Particle) -> bool {
  return particle.flags.y > 0.5 && particle.posPhase.w >= 0.5 && particle.misc.z >= 0.0 && particle.misc.z < particle.misc.w;
}

fn substrateNeighborSupport(index: u32) -> f32 {
  if (index >= params.particleCount) {
    return 0.0;
  }
  return neighborSupportBuffer[index];
}

fn pressureCellCenter(cellX: i32, cellZ: i32) -> vec3f {
  let cellSizeX = (SPATIAL_PRESSURE_MAX_X - SPATIAL_PRESSURE_MIN_X) / f32(SPATIAL_PRESSURE_GRID_X);
  let cellSizeZ = (SPATIAL_PRESSURE_MAX_Z - SPATIAL_PRESSURE_MIN_Z) / f32(SPATIAL_PRESSURE_GRID_Z);
  return vec3f(
    SPATIAL_PRESSURE_MIN_X + (f32(cellX) + 0.5) * cellSizeX,
    0.0,
    SPATIAL_PRESSURE_MIN_Z + (f32(cellZ) + 0.5) * cellSizeZ
  );
}

fn applySpatialCellPressure(position: vec3f, velocity: vec3f, chemistry: f32) -> vec3f {
  let cellX = i32(pressureCellAxis(position.x, SPATIAL_PRESSURE_MIN_X, SPATIAL_PRESSURE_MAX_X, SPATIAL_PRESSURE_GRID_X));
  let cellZ = i32(pressureCellAxis(position.z, SPATIAL_PRESSURE_MIN_Z, SPATIAL_PRESSURE_MAX_Z, SPATIAL_PRESSURE_GRID_Z));
  let center = pressureCellCountAt(cellX, cellZ);
  if (center <= 1.0) {
    return velocity;
  }
  let left = pressureCellCountAt(cellX - 1, cellZ);
  let right = pressureCellCountAt(cellX + 1, cellZ);
  let back = pressureCellCountAt(cellX, cellZ - 1);
  let front = pressureCellCountAt(cellX, cellZ + 1);
  let neighborGradient = vec3f(left - right, 0.0, back - front);
  let cellCenter = pressureCellCenter(cellX, cellZ);
  let localOutward = vec3f(position.x - cellCenter.x, 0.0, position.z - cellCenter.z);
  let gradient = neighborGradient + localOutward * center * 0.35;
  let gradientLength = length(gradient);
  let direction = select(normalize(localOutward + vec3f(0.0007, 0.0, 0.0003)), normalize(gradient), gradientLength >= 0.0001);
  let chemistryScale = select(select(0.0022, 0.0018, chemistry > 2.5), 0.0027, chemistry > 1.5 && chemistry < 2.5);
  let occupancyScale = min(center, 9.0);
  return velocity + direction * chemistryScale * occupancyScale;
}

fn applySurfaceViscosity(index: u32, position: vec3f, velocity: vec3f, radius: f32, chemistry: f32) -> vec3f {
  var neighborVelocity = vec3f(0.0, 0.0, 0.0);
  var weightTotal = 0.0;
  let viscosityRadius = max(SURFACE_VISCOSITY_RADIUS_BASE * particleSupportScale(), radius * 3.0);
  for (var offset: u32 = 1u; offset <= ${PRESSURE_NEIGHBOR_WINDOW}u; offset = offset + 1u) {
    let forwardIndex = (index + offset) % params.particleCount;
    let backIndex = (index + params.particleCount - offset) % params.particleCount;
    let forward = particles[forwardIndex];
    let back = particles[backIndex];
    if (forward.flags.y > 0.5 && forward.posPhase.w >= 0.5 && forward.misc.z >= 0.0 && forward.misc.z < forward.misc.w) {
      let delta = position - forward.posPhase.xyz;
      let distance = length(delta);
      if (distance > 0.0001 && distance < viscosityRadius) {
        let weight = (viscosityRadius - distance) / viscosityRadius;
        neighborVelocity = neighborVelocity + forward.velChem.xyz * weight;
        weightTotal = weightTotal + weight;
      }
    }
    if (back.flags.y > 0.5 && back.posPhase.w >= 0.5 && back.misc.z >= 0.0 && back.misc.z < back.misc.w) {
      let delta = position - back.posPhase.xyz;
      let distance = length(delta);
      if (distance > 0.0001 && distance < viscosityRadius) {
        let weight = (viscosityRadius - distance) / viscosityRadius;
        neighborVelocity = neighborVelocity + back.velChem.xyz * weight;
        weightTotal = weightTotal + weight;
      }
    }
  }
  if (weightTotal <= 0.0001) {
    return velocity;
  }
  let averageVelocity = neighborVelocity / weightTotal;
  let viscosityBlend = select(select(0.014, 0.019, chemistry > 2.5), 0.028, chemistry > 1.5 && chemistry < 2.5);
  let blend = min(viscosityBlend * weightTotal, 0.3);
  let horizontal = velocity.xz + (averageVelocity.xz - velocity.xz) * blend;
  return vec3f(horizontal.x, velocity.y, horizontal.y);
}

fn applySameChemistrySurfaceCohesion(index: u32, position: vec3f, velocity: vec3f, radius: f32, chemistry: f32) -> vec3f {
  var neighborPosition = vec3f(0.0, 0.0, 0.0);
  var neighborVelocity = vec3f(0.0, 0.0, 0.0);
  var weightTotal = 0.0;
  let cohesionRadius = max(SURFACE_VISCOSITY_RADIUS_BASE * 1.7 * particleSupportScale(), radius * 4.8);
  for (var offset: u32 = 1u; offset <= ${PRESSURE_NEIGHBOR_WINDOW}u; offset = offset + 1u) {
    let forwardIndex = (index + offset) % params.particleCount;
    let backIndex = (index + params.particleCount - offset) % params.particleCount;
    let forward = particles[forwardIndex];
    let back = particles[backIndex];
    if (forward.flags.y > 0.5 && forward.posPhase.w >= 0.5 && forward.misc.z >= 0.0 && forward.misc.z < forward.misc.w && abs(forward.velChem.w - chemistry) < 0.25) {
      let delta = forward.posPhase.xyz - position;
      let distance = length(delta);
      if (distance > radius * 0.9 && distance < cohesionRadius) {
        let weight = (cohesionRadius - distance) / cohesionRadius;
        neighborPosition = neighborPosition + forward.posPhase.xyz * weight;
        neighborVelocity = neighborVelocity + forward.velChem.xyz * weight;
        weightTotal = weightTotal + weight;
      }
    }
    if (back.flags.y > 0.5 && back.posPhase.w >= 0.5 && back.misc.z >= 0.0 && back.misc.z < back.misc.w && abs(back.velChem.w - chemistry) < 0.25) {
      let delta = back.posPhase.xyz - position;
      let distance = length(delta);
      if (distance > radius * 0.9 && distance < cohesionRadius) {
        let weight = (cohesionRadius - distance) / cohesionRadius;
        neighborPosition = neighborPosition + back.posPhase.xyz * weight;
        neighborVelocity = neighborVelocity + back.velChem.xyz * weight;
        weightTotal = weightTotal + weight;
      }
    }
  }
  if (weightTotal <= 0.0001) {
    return velocity;
  }
  let averagePosition = neighborPosition / weightTotal;
  let averageVelocity = neighborVelocity / weightTotal;
  let toward = averagePosition - position;
  let towardHorizontal = vec3f(toward.x, 0.0, toward.z);
  let towardLength = length(towardHorizontal);
  let cohesionDirection = select(vec3f(0.0, 0.0, 0.0), towardHorizontal / towardLength, towardLength > 0.0001);
  let velocityHorizontal = vec3f(velocity.x, 0.0, velocity.z);
  let averageHorizontal = vec3f(averageVelocity.x, 0.0, averageVelocity.z);
  let ribbonBlend = min(0.22, 0.026 * weightTotal);
  let cohesionStrength = select(select(0.012, 0.016, chemistry > 2.5), 0.019, chemistry > 1.5 && chemistry < 2.5);
  let ribbonVelocity = velocityHorizontal + (averageHorizontal - velocityHorizontal) * ribbonBlend + cohesionDirection * cohesionStrength * min(weightTotal, 8.0);
  return vec3f(ribbonVelocity.x, velocity.y, ribbonVelocity.z);
}

fn applySpatialSurfaceRelaxation(position: vec3f, velocity: vec3f, radius: f32, chemistry: f32) -> vec3f {
  let cellX = i32(pressureCellAxis(position.x, SPATIAL_PRESSURE_MIN_X, SPATIAL_PRESSURE_MAX_X, SPATIAL_PRESSURE_GRID_X));
  let cellZ = i32(pressureCellAxis(position.z, SPATIAL_PRESSURE_MIN_Z, SPATIAL_PRESSURE_MAX_Z, SPATIAL_PRESSURE_GRID_Z));
  let center = pressureCellCountAt(cellX, cellZ);
  if (center <= 1.0) {
    return position;
  }
  let left = pressureCellCountAt(cellX - 1, cellZ);
  let right = pressureCellCountAt(cellX + 1, cellZ);
  let back = pressureCellCountAt(cellX, cellZ - 1);
  let front = pressureCellCountAt(cellX, cellZ + 1);
  let neighborOccupied = select(0.0, 1.0, left > 0.0) + select(0.0, 1.0, right > 0.0) + select(0.0, 1.0, back > 0.0) + select(0.0, 1.0, front > 0.0);
  let densityGradient = vec3f(left - right, 0.0, back - front);
  let cellCenter = pressureCellCenter(cellX, cellZ);
  let localOutward = vec3f(position.x - cellCenter.x, 0.0, position.z - cellCenter.z);
  let travel = vec3f(velocity.x, 0.0, velocity.z);
  let travelLength = length(travel);
  let travelDirection = select(vec3f(0.0, 0.0, 0.0), travel / travelLength, travelLength > 0.0001);
  let spread = densityGradient * 0.42 + localOutward * min(center, 12.0) * 0.13 + travelDirection * neighborOccupied * 0.08;
  let spreadLength = length(spread);
  if (spreadLength <= 0.0001) {
    return position;
  }
  let chemistryScale = select(select(0.0012, 0.0010, chemistry > 2.5), 0.0015, chemistry > 1.5 && chemistry < 2.5);
  let densityScale = min(max(center - 1.0, 0.0), 10.0);
  let relaxationStep = min(radius * 0.2, chemistryScale * densityScale * (1.0 + neighborOccupied * 0.08));
  let relaxed = position + normalize(spread) * relaxationStep;
  return vec3f(relaxed.x, position.y, relaxed.z);
}

fn applyDensityPositionSolve(index: u32, position: vec3f, velocity: vec3f, radius: f32, chemistry: f32, substrateSupport: f32) -> vec3f {
  var pairCorrection = vec3f(0.0, 0.0, 0.0);
  var pairWeight = 0.0;
  let restDistance = max(DENSITY_POSITION_SOLVE_REST_DISTANCE * particleSupportScale(), radius * 0.62);
  for (var offset: u32 = 1u; offset <= ${PRESSURE_NEIGHBOR_WINDOW}u; offset = offset + 1u) {
    let forwardIndex = (index + offset) % params.particleCount;
    let backIndex = (index + params.particleCount - offset) % params.particleCount;
    let forward = particles[forwardIndex];
    let back = particles[backIndex];
    if (forward.flags.y > 0.5 && forward.posPhase.w >= 0.5 && forward.misc.z >= 0.0 && forward.misc.z < forward.misc.w && abs(forward.velChem.w - chemistry) < 0.25) {
      let delta = position - forward.posPhase.xyz;
      let distance = length(delta);
      if (distance > 0.0001 && distance < restDistance) {
        let overlap = (restDistance - distance) / restDistance;
        pairCorrection = pairCorrection + normalize(delta) * overlap;
        pairWeight = pairWeight + overlap;
      }
    }
    if (back.flags.y > 0.5 && back.posPhase.w >= 0.5 && back.misc.z >= 0.0 && back.misc.z < back.misc.w && abs(back.velChem.w - chemistry) < 0.25) {
      let delta = position - back.posPhase.xyz;
      let distance = length(delta);
      if (distance > 0.0001 && distance < restDistance) {
        let overlap = (restDistance - distance) / restDistance;
        pairCorrection = pairCorrection + normalize(delta) * overlap;
        pairWeight = pairWeight + overlap;
      }
    }
  }

  let cellX = i32(pressureCellAxis(position.x, SPATIAL_PRESSURE_MIN_X, SPATIAL_PRESSURE_MAX_X, SPATIAL_PRESSURE_GRID_X));
  let cellZ = i32(pressureCellAxis(position.z, SPATIAL_PRESSURE_MIN_Z, SPATIAL_PRESSURE_MAX_Z, SPATIAL_PRESSURE_GRID_Z));
  let center = pressureCellCountAt(cellX, cellZ);
  let left = pressureCellCountAt(cellX - 1, cellZ);
  let right = pressureCellCountAt(cellX + 1, cellZ);
  let back = pressureCellCountAt(cellX, cellZ - 1);
  let front = pressureCellCountAt(cellX, cellZ + 1);
  let cellCenter = pressureCellCenter(cellX, cellZ);
  let localOutward = vec3f(position.x - cellCenter.x, 0.0, position.z - cellCenter.z);
  let localOutwardLength = length(localOutward);
  let densityGradient = vec3f(left - right, 0.0, back - front);
  let densityGradientLength = length(densityGradient);
  let cellDirection = select(
    select(vec3f(0.0, 0.0, 0.0), localOutward / localOutwardLength, localOutwardLength > 0.0001),
    densityGradient / densityGradientLength,
    densityGradientLength > 0.0001
  );
  let overDensity = max(0.0, center - DENSITY_POSITION_SOLVE_TARGET_OCCUPANCY);
  let pairDirection = select(vec3f(0.0, 0.0, 0.0), pairCorrection / max(pairWeight, 0.0001), pairWeight > 0.0001);
  let substrateScale = clamp(substrateSupport / 8.0, 0.0, 1.0);
  let pairStep = min(radius * 0.38, pairWeight * select(select(0.0018, 0.0015, chemistry > 2.5), 0.0022, chemistry > 1.5 && chemistry < 2.5) * (0.82 + substrateScale * 0.38));
  let cellStep = min(radius * 0.45, overDensity * select(select(0.00024, 0.00020, chemistry > 2.5), 0.00028, chemistry > 1.5 && chemistry < 2.5) * (0.88 + substrateScale * 0.28));
  let correction = pairDirection * pairStep + cellDirection * cellStep;
  let correctionLength = length(correction);
  if (correctionLength <= 0.00001) {
    return position;
  }
  let maxStep = radius * 0.58;
  let limitedCorrection = correction / correctionLength * min(correctionLength, maxStep);
  return vec3f(position.x + limitedCorrection.x, position.y, position.z + limitedCorrection.z);
}

fn applyDensityContinuityProjection(index: u32, position: vec3f, radius: f32, chemistry: f32) -> vec3f {
  let cellX = i32(pressureCellAxis(position.x, SPATIAL_PRESSURE_MIN_X, SPATIAL_PRESSURE_MAX_X, SPATIAL_PRESSURE_GRID_X));
  let cellZ = i32(pressureCellAxis(position.z, SPATIAL_PRESSURE_MIN_Z, SPATIAL_PRESSURE_MAX_Z, SPATIAL_PRESSURE_GRID_Z));
  let center = pressureCellCountAt(cellX, cellZ);
  if (center <= DENSITY_CONTINUITY_TARGET_OCCUPANCY) {
    return position;
  }

  let left = pressureCellCountAt(cellX - 1, cellZ);
  let right = pressureCellCountAt(cellX + 1, cellZ);
  let back = pressureCellCountAt(cellX, cellZ - 1);
  let front = pressureCellCountAt(cellX, cellZ + 1);
  let backLeft = pressureCellCountAt(cellX - 1, cellZ - 1);
  let backRight = pressureCellCountAt(cellX + 1, cellZ - 1);
  let frontLeft = pressureCellCountAt(cellX - 1, cellZ + 1);
  let frontRight = pressureCellCountAt(cellX + 1, cellZ + 1);
  let averageNeighbor = (left + right + back + front + backLeft + backRight + frontLeft + frontRight) * 0.125;

  let lowLeft = max(0.0, center - left);
  let lowRight = max(0.0, center - right);
  let lowBack = max(0.0, center - back);
  let lowFront = max(0.0, center - front);
  let lowBackLeft = max(0.0, center - backLeft);
  let lowBackRight = max(0.0, center - backRight);
  let lowFrontLeft = max(0.0, center - frontLeft);
  let lowFrontRight = max(0.0, center - frontRight);
  let neighborOutflow = vec3f(
    lowRight - lowLeft + (lowBackRight + lowFrontRight - lowBackLeft - lowFrontLeft) * 0.62,
    0.0,
    lowFront - lowBack + (lowFrontLeft + lowFrontRight - lowBackLeft - lowBackRight) * 0.62
  );

  let cellCenter = pressureCellCenter(cellX, cellZ);
  let localOutward = vec3f(position.x - cellCenter.x, 0.0, position.z - cellCenter.z);
  let seed = hash01(((index + 1u) * 1103515245u) ^ ((params.stepCount + 17u) * 12345u));
  let angle = seed * 6.2831853;
  let fallbackOutflow = vec3f(cos(angle), 0.0, sin(angle));
  let neighborLength = length(neighborOutflow);
  let localLength = length(localOutward);
  let baseDirection = select(
    select(fallbackOutflow, localOutward / localLength, localLength > 0.0001),
    neighborOutflow / neighborLength,
    neighborLength > 0.0001
  );
  let overTarget = max(0.0, center - DENSITY_CONTINUITY_TARGET_OCCUPANCY);
  let neighborVoid = max(0.0, center - averageNeighbor);
  let chemistryScale = select(select(0.86, 0.78, chemistry > 2.5), 0.68, chemistry > 1.5 && chemistry < 2.5);
  let projectedStep = min(
    radius * 1.55,
    (sqrt(overTarget) * 0.00115 + neighborVoid * 0.000035) * chemistryScale
  );
  return vec3f(position.x + baseDirection.x * projectedStep, position.y, position.z + baseDirection.z * projectedStep);
}

fn applySampledNeighborhoodDensity(index: u32, position: vec3f, radius: f32, chemistry: f32, substrateSupport: f32) -> vec3f {
  var correction = vec3f(0.0, 0.0, 0.0);
  var closeWeight = 0.0;
  var supportWeight = 0.0;
  let sampleRadius = max(radius * 2.45, DENSITY_POSITION_SOLVE_REST_DISTANCE * particleSupportScale() * 1.72);
  let restDistance = max(radius * 1.24, DENSITY_POSITION_SOLVE_REST_DISTANCE * particleSupportScale() * 1.08);
  for (var sampleOffset: u32 = 1u; sampleOffset <= SAMPLED_NEIGHBORHOOD_SAMPLE_COUNT; sampleOffset = sampleOffset + 1u) {
    let stride = sampleOffset * sampleOffset * 7u + sampleOffset * 13u + 3u;
    let phaseSeed = (params.stepCount + 1u) * (sampleOffset * 2654435761u + 97u);
    let forwardIndex = (index + stride + (phaseSeed % max(1u, params.particleCount))) % params.particleCount;
    let backwardIndex = (index + params.particleCount - (stride % max(1u, params.particleCount))) % params.particleCount;
    let forward = particles[forwardIndex];
    let backward = particles[backwardIndex];
    if (forward.flags.y > 0.5 && forward.posPhase.w >= 0.5 && forward.misc.z >= 0.0 && forward.misc.z < forward.misc.w && abs(forward.velChem.w - chemistry) < 0.25) {
      let delta = position - forward.posPhase.xyz;
      let distance = length(delta);
      if (distance > 0.0001 && distance < sampleRadius) {
        supportWeight = supportWeight + 1.0;
        let overlap = max(0.0, restDistance - distance) / restDistance;
        correction = correction + normalize(delta) * overlap;
        closeWeight = closeWeight + overlap;
      }
    }
    if (backward.flags.y > 0.5 && backward.posPhase.w >= 0.5 && backward.misc.z >= 0.0 && backward.misc.z < backward.misc.w && abs(backward.velChem.w - chemistry) < 0.25) {
      let delta = position - backward.posPhase.xyz;
      let distance = length(delta);
      if (distance > 0.0001 && distance < sampleRadius) {
        supportWeight = supportWeight + 1.0;
        let overlap = max(0.0, restDistance - distance) / restDistance;
        correction = correction + normalize(delta) * overlap;
        closeWeight = closeWeight + overlap;
      }
    }
  }
  let correctionLength = length(correction);
  if (correctionLength <= 0.00001) {
    return position;
  }
  let crowdScale = min(1.0, max(supportWeight, substrateSupport * 0.72) / 8.0);
  let chemistryScale = select(select(0.76, 0.70, chemistry > 2.5), 0.62, chemistry > 1.5 && chemistry < 2.5);
  let projectedStep = min(radius * 0.42, (closeWeight * 0.0022 + crowdScale * 0.0012) * chemistryScale);
  return vec3f(position.x + correction.x / correctionLength * projectedStep, position.y, position.z + correction.z / correctionLength * projectedStep);
}

fn applyLocalPairDensityProjection(index: u32, position: vec3f, radius: f32, chemistry: f32, substrateSupport: f32) -> vec3f {
  let cellX = i32(pressureCellAxis(position.x, SPATIAL_PRESSURE_MIN_X, SPATIAL_PRESSURE_MAX_X, SPATIAL_PRESSURE_GRID_X));
  let cellZ = i32(pressureCellAxis(position.z, SPATIAL_PRESSURE_MIN_Z, SPATIAL_PRESSURE_MAX_Z, SPATIAL_PRESSURE_GRID_Z));
  let center = pressureCellCountAt(cellX, cellZ);
  if (center <= 2.0) {
    return position;
  }

  var correction = vec3f(0.0, 0.0, 0.0);
  var closeWeight = 0.0;
  var supportWeight = 0.0;
  let pairRadius = max(radius * 2.05, DENSITY_POSITION_SOLVE_REST_DISTANCE * particleSupportScale() * 1.42);
  let restDistance = max(radius * 1.02, DENSITY_POSITION_SOLVE_REST_DISTANCE * particleSupportScale() * 0.96);
  let particleCount = max(1u, params.particleCount);
  for (var sampleOffset: u32 = 1u; sampleOffset <= LOCAL_PAIR_DENSITY_SAMPLE_COUNT; sampleOffset = sampleOffset + 1u) {
    let phaseSeed = ((params.stepCount + 17u) * 747796405u) ^ ((index + 3u) * 2891336453u) ^ (sampleOffset * 277803737u);
    let stride = 1u + (phaseSeed % max(1u, particleCount - 1u));
    let neighborIndex = (index + stride) % particleCount;
    let neighbor = particles[neighborIndex];
    if (neighbor.flags.y <= 0.5 || neighbor.posPhase.w < 0.5 || neighbor.misc.z < 0.0 || neighbor.misc.z >= neighbor.misc.w || abs(neighbor.velChem.w - chemistry) >= 0.25) {
      continue;
    }
    let delta = position - neighbor.posPhase.xyz;
    let distance = length(delta);
    if (distance <= 0.0001 || distance >= pairRadius) {
      continue;
    }
    supportWeight = supportWeight + 1.0;
    let overlap = max(0.0, restDistance - distance) / restDistance;
    if (overlap <= 0.0) {
      continue;
    }
    correction = correction + normalize(delta) * overlap;
    closeWeight = closeWeight + overlap;
  }

  let correctionLength = length(correction);
  if (correctionLength <= 0.00001) {
    return position;
  }
  let crowdScale = min(1.0, max(0.0, center - 1.0) / 18.0);
  let supportScale = min(1.0, max(supportWeight, substrateSupport * 0.62) / 10.0);
  let chemistryScale = select(select(0.66, 0.72, chemistry > 2.5), 0.54, chemistry > 1.5 && chemistry < 2.5);
  let projectedStep = min(radius * 0.34, (closeWeight * 0.00155 + crowdScale * supportScale * 0.00095) * chemistryScale);
  return vec3f(position.x + correction.x / correctionLength * projectedStep, position.y, position.z + correction.z / correctionLength * projectedStep);
}

fn applySubstrateDensityConstraintSolve(index: u32, position: vec3f, velocity: vec3f, radius: f32, chemistry: f32, substrateSupport: f32) -> vec3f {
  let cellX = i32(pressureCellAxis(position.x, SPATIAL_PRESSURE_MIN_X, SPATIAL_PRESSURE_MAX_X, SPATIAL_PRESSURE_GRID_X));
  let cellZ = i32(pressureCellAxis(position.z, SPATIAL_PRESSURE_MIN_Z, SPATIAL_PRESSURE_MAX_Z, SPATIAL_PRESSURE_GRID_Z));
  let center = pressureCellCountAt(cellX, cellZ);
  let left = pressureCellCountAt(cellX - 1, cellZ);
  let right = pressureCellCountAt(cellX + 1, cellZ);
  let back = pressureCellCountAt(cellX, cellZ - 1);
  let front = pressureCellCountAt(cellX, cellZ + 1);
  let backLeft = pressureCellCountAt(cellX - 1, cellZ - 1);
  let backRight = pressureCellCountAt(cellX + 1, cellZ - 1);
  let frontLeft = pressureCellCountAt(cellX - 1, cellZ + 1);
  let frontRight = pressureCellCountAt(cellX + 1, cellZ + 1);
  let supportDeficit = clamp((SUBSTRATE_DENSITY_TARGET_SUPPORT - substrateSupport) / SUBSTRATE_DENSITY_TARGET_SUPPORT, 0.0, 1.0);
  let overDensity = max(0.0, center - DENSITY_POSITION_SOLVE_TARGET_OCCUPANCY) / max(1.0, DENSITY_CONTINUITY_TARGET_OCCUPANCY);
  if (supportDeficit <= 0.0001 && overDensity <= 0.0001) {
    return position;
  }

  let sheetPull = vec3f(
    right - left + (backRight + frontRight - backLeft - frontLeft) * 0.55,
    0.0,
    front - back + (frontLeft + frontRight - backLeft - backRight) * 0.55
  );
  let lowLeft = max(0.0, center - left);
  let lowRight = max(0.0, center - right);
  let lowBack = max(0.0, center - back);
  let lowFront = max(0.0, center - front);
  let densityOutflow = vec3f(lowRight - lowLeft, 0.0, lowFront - lowBack);
  let basinTether = vec3f(-position.x, 0.0, 0.36 - position.z);
  let basinTetherLength = length(basinTether);
  let travel = vec3f(velocity.x, 0.0, velocity.z);
  let travelLength = length(travel);
  let seeded = hash01(((index + 31u) * 747796405u) ^ ((params.stepCount + 41u) * 2891336453u));
  let seededDirection = vec3f(cos(seeded * 6.2831853), 0.0, sin(seeded * 6.2831853));
  let pullDirectionLength = length(sheetPull);
  let outflowLength = length(densityOutflow);
  var direction = select(
    select(seededDirection, basinTether / basinTetherLength, basinTetherLength > 0.0001),
    sheetPull / pullDirectionLength,
    pullDirectionLength > 0.0001
  ) * supportDeficit;
  if (outflowLength > 0.0001) {
    direction = direction + densityOutflow / outflowLength * min(0.75, overDensity * 2.6);
  }
  if (travelLength > 0.0001 && supportDeficit > 0.15) {
    direction = direction - travel / travelLength * supportDeficit * 0.18;
  }
  let directionLength = length(direction);
  if (directionLength <= 0.0001) {
    return position;
  }
  let chemistryScale = select(select(0.82, 0.92, chemistry > 2.5), 0.76, chemistry > 1.5 && chemistry < 2.5);
  let sideTailBoost = select(1.0, 1.34, abs(position.x) > 0.48 || position.z > 1.38);
  let projectedStep = min(radius * 0.72, (supportDeficit * 0.0068 + overDensity * 0.0042) * chemistryScale * sideTailBoost);
  let correction = direction / directionLength * projectedStep;
  return vec3f(position.x + correction.x, position.y, position.z + correction.z);
}

fn applyIterativeDensityContinuityProjection(index: u32, position: vec3f, velocity: vec3f, radius: f32, chemistry: f32, substrateSupport: f32) -> vec3f {
  var projected = position;
  let targetOccupancy = DENSITY_CONTINUITY_TARGET_OCCUPANCY * 0.58;
  let supportDeficit = clamp((SUBSTRATE_DENSITY_TARGET_SUPPORT - substrateSupport) / SUBSTRATE_DENSITY_TARGET_SUPPORT, 0.0, 1.0);
  let travel = vec3f(velocity.x, 0.0, velocity.z);
  let travelLength = length(travel);
  for (var iteration: u32 = 0u; iteration < ITERATIVE_DENSITY_CONTINUITY_ITERATIONS; iteration = iteration + 1u) {
    let cellX = i32(pressureCellAxis(projected.x, SPATIAL_PRESSURE_MIN_X, SPATIAL_PRESSURE_MAX_X, SPATIAL_PRESSURE_GRID_X));
    let cellZ = i32(pressureCellAxis(projected.z, SPATIAL_PRESSURE_MIN_Z, SPATIAL_PRESSURE_MAX_Z, SPATIAL_PRESSURE_GRID_Z));
    let center = pressureCellCountAt(cellX, cellZ);
    let densityResidual = max(0.0, center - targetOccupancy) / max(1.0, targetOccupancy);
    let residual = max(densityResidual, supportDeficit * 0.65);
    if (residual <= 0.015) {
      continue;
    }

    var lowOutflow = vec3f(0.0, 0.0, 0.0);
    var lowWeight = 0.0;
    var supportPull = vec3f(0.0, 0.0, 0.0);
    var supportWeight = 0.0;
    for (var dz: i32 = -1; dz <= 1; dz = dz + 1) {
      for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
        if (dx == 0 && dz == 0) {
          continue;
        }
        let count = pressureCellCountAt(cellX + dx, cellZ + dz);
        let direction = normalize(vec3f(f32(dx), 0.0, f32(dz)) + vec3f(0.0002, 0.0, 0.0005));
        let lower = max(0.0, center - count);
        lowOutflow = lowOutflow + direction * lower;
        lowWeight = lowWeight + lower;
        if (count > 0.0) {
          supportPull = supportPull + direction * count;
          supportWeight = supportWeight + count;
        }
      }
    }

    let cellCenter = pressureCellCenter(cellX, cellZ);
    let localOutward = vec3f(projected.x - cellCenter.x, 0.0, projected.z - cellCenter.z);
    let localLength = length(localOutward);
    let outflowLength = length(lowOutflow);
    let pullLength = length(supportPull);
    let seeded = hash01(((index + 67u + iteration * 17u) * 747796405u) ^ ((params.stepCount + 59u) * 2891336453u));
    let seededDirection = vec3f(cos(seeded * 6.2831853), 0.0, sin(seeded * 6.2831853));
    var direction = select(
      select(seededDirection, localOutward / localLength, localLength > 0.0001),
      lowOutflow / outflowLength,
      outflowLength > 0.0001 && densityResidual > 0.02
    );
    if (supportDeficit > 0.04 && pullLength > 0.0001 && supportWeight > center * 0.55) {
      direction = normalize(direction * (1.0 - supportDeficit * 0.34) + supportPull / pullLength * supportDeficit * 0.34);
    }
    if (travelLength > 0.0001 && residual > 0.32) {
      direction = normalize(direction - travel / travelLength * min(0.18, residual * 0.05));
    }
    let chemistryScale = select(select(0.74, 0.82, chemistry > 2.5), 0.62, chemistry > 1.5 && chemistry < 2.5);
    let iterationScale = 1.0 / f32(iteration + 1u);
    let clampStep = radius * (0.34 + supportDeficit * 0.18);
    let projectedStep = min(clampStep, (residual * 0.0038 + min(lowWeight, center * 8.0) * 0.0000032) * chemistryScale * iterationScale);
    projected = vec3f(projected.x + direction.x * projectedStep, projected.y, projected.z + direction.z * projectedStep);
  }
  return projected;
}

fn applyDeepDensityContinuityProjection(index: u32, position: vec3f, radius: f32, chemistry: f32) -> vec3f {
  let cellX = i32(pressureCellAxis(position.x, SPATIAL_PRESSURE_MIN_X, SPATIAL_PRESSURE_MAX_X, SPATIAL_PRESSURE_GRID_X));
  let cellZ = i32(pressureCellAxis(position.z, SPATIAL_PRESSURE_MIN_Z, SPATIAL_PRESSURE_MAX_Z, SPATIAL_PRESSURE_GRID_Z));
  let center = pressureCellCountAt(cellX, cellZ);
  let targetOccupancy = DENSITY_CONTINUITY_TARGET_OCCUPANCY * 0.72;
  if (center <= targetOccupancy) {
    return position;
  }

  var lowOutflow = vec3f(0.0, 0.0, 0.0);
  var lowWeight = 0.0;
  var ringOccupied = 0.0;
  for (var dz: i32 = -2; dz <= 2; dz = dz + 1) {
    for (var dx: i32 = -2; dx <= 2; dx = dx + 1) {
      if (dx == 0 && dz == 0) {
        continue;
      }
      let count = pressureCellCountAt(cellX + dx, cellZ + dz);
      let lower = max(0.0, center - count);
      if (count > 0.0) {
        ringOccupied = ringOccupied + 1.0;
      }
      if (lower <= 0.0) {
        continue;
      }
      let direction = normalize(vec3f(f32(dx), 0.0, f32(dz)) + vec3f(0.0003, 0.0, 0.0007));
      let distanceWeight = select(1.0, 0.62, abs(dx) > 1 || abs(dz) > 1);
      lowOutflow = lowOutflow + direction * lower * distanceWeight;
      lowWeight = lowWeight + lower * distanceWeight;
    }
  }

  let cellCenter = pressureCellCenter(cellX, cellZ);
  let localOutward = vec3f(position.x - cellCenter.x, 0.0, position.z - cellCenter.z);
  let localLength = length(localOutward);
  let seeded = hash01(((index + 5u) * 747796405u) ^ ((params.stepCount + 23u) * 2891336453u));
  let seededDirection = vec3f(cos(seeded * 6.2831853), 0.0, sin(seeded * 6.2831853));
  let outflowLength = length(lowOutflow);
  let direction = select(
    select(seededDirection, localOutward / localLength, localLength > 0.0001),
    lowOutflow / outflowLength,
    outflowLength > 0.0001
  );
  let overTarget = max(0.0, center - targetOccupancy);
  let ringOpenness = max(0.0, 24.0 - ringOccupied) / 24.0;
  let chemistryScale = select(select(0.72, 0.80, chemistry > 2.5), 0.58, chemistry > 1.5 && chemistry < 2.5);
  let projectedStep = min(
    radius * 1.05,
    (sqrt(overTarget) * 0.00072 + min(lowWeight, center * 18.0) * 0.0000045 + ringOpenness * 0.0022) * chemistryScale
  );
  return vec3f(position.x + direction.x * projectedStep, position.y, position.z + direction.z * projectedStep);
}

fn applySurfaceBasinContainment(position: vec3f, radius: f32, chemistry: f32) -> vec3f {
  var correction = vec2f(0.0, 0.0);
  let lateralExcess = max(0.0, abs(position.x) - 0.48);
  let forwardExcess = max(0.0, position.z - 1.54);
  let backExcess = max(0.0, -0.72 - position.z);
  correction.x = correction.x - sign(position.x) * lateralExcess * 0.34;
  correction.y = correction.y - forwardExcess * 0.24 + backExcess * 0.18;
  let correctionLength = length(correction);
  if (correctionLength <= 0.0001) {
    return position;
  }
  let chemistryScale = select(select(0.82, 0.92, chemistry > 2.5), 0.74, chemistry > 1.5 && chemistry < 2.5);
  let step = min(radius * 0.82, correctionLength * chemistryScale);
  let contained = position.xz + correction / correctionLength * step;
  return vec3f(contained.x, position.y, contained.y);
}

fn applySurfaceStabilityDamping(position: vec3f, velocity: vec3f, chemistry: f32) -> vec3f {
  let cellX = i32(pressureCellAxis(position.x, SPATIAL_PRESSURE_MIN_X, SPATIAL_PRESSURE_MAX_X, SPATIAL_PRESSURE_GRID_X));
  let cellZ = i32(pressureCellAxis(position.z, SPATIAL_PRESSURE_MIN_Z, SPATIAL_PRESSURE_MAX_Z, SPATIAL_PRESSURE_GRID_Z));
  let center = pressureCellCountAt(cellX, cellZ);
  let horizontal = vec2f(velocity.x, velocity.z);
  let speed = length(horizontal);
  if (speed <= 0.0001) {
    return velocity;
  }
  let densityDamping = 1.0 - min(0.34, max(center - 6.0, 0.0) * 0.011);
  let chemistryDamping = select(select(0.972, 0.964, chemistry > 2.5), 0.952, chemistry > 1.5 && chemistry < 2.5);
  let maxSpeed = select(select(0.62, 0.56, chemistry > 2.5), 0.48, chemistry > 1.5 && chemistry < 2.5);
  let sideChannelDamping = 1.0 - min(0.46, max(abs(position.x) - 0.40, 0.0) * 1.16);
  var clamped = normalize(horizontal) * min(speed * densityDamping * chemistryDamping, maxSpeed);
  clamped = clamped * sideChannelDamping;
  let lateralExcess = max(0.0, abs(position.x) - 0.38);
  clamped.x = clamped.x - sign(position.x) * min(0.38, lateralExcess * 0.82);
  let forwardExcess = max(0.0, position.z - 1.42);
  clamped.y = clamped.y - min(0.24, forwardExcess * 0.42);
  let tetheredSpeed = length(clamped);
  if (tetheredSpeed > maxSpeed) {
    clamped = normalize(clamped) * maxSpeed;
  }
  return vec3f(clamped.x, velocity.y, clamped.y);
}

fn applyVisualStreakBeadDamping(index: u32, position: vec3f, velocity: vec3f, radius: f32, chemistry: f32, phase: f32, age: f32) -> vec3f {
  let horizontal = vec2f(velocity.x, velocity.z);
  let speed = length(horizontal);
  if (speed <= 0.0001) {
    return velocity;
  }
  if (phase < 0.5) {
    let oldFastAirborne = age > 1.05 && speed > 0.7;
    let airborneDrag = select(1.0, 0.72, oldFastAirborne);
    let airborneHorizontal = horizontal * airborneDrag;
    let vertical = select(velocity.y, min(velocity.y, -0.38), oldFastAirborne);
    return vec3f(airborneHorizontal.x, vertical, airborneHorizontal.y);
  }
  let cellX = i32(pressureCellAxis(position.x, SPATIAL_PRESSURE_MIN_X, SPATIAL_PRESSURE_MAX_X, SPATIAL_PRESSURE_GRID_X));
  let cellZ = i32(pressureCellAxis(position.z, SPATIAL_PRESSURE_MIN_Z, SPATIAL_PRESSURE_MAX_Z, SPATIAL_PRESSURE_GRID_Z));
  let center = pressureCellCountAt(cellX, cellZ);
  let left = pressureCellCountAt(cellX - 1, cellZ);
  let right = pressureCellCountAt(cellX + 1, cellZ);
  let back = pressureCellCountAt(cellX, cellZ - 1);
  let front = pressureCellCountAt(cellX, cellZ + 1);
  let neighborOccupied = select(0.0, 1.0, left > 0.0) + select(0.0, 1.0, right > 0.0) + select(0.0, 1.0, back > 0.0) + select(0.0, 1.0, front > 0.0);
  let isolatedBead = center <= 2.0 && neighborOccupied <= 1.0;
  let sideRailBead = abs(position.x) > 0.50 || position.z > 1.42;
  let sparseStreak = center <= 3.0 && neighborOccupied <= 1.0 && speed > 0.42;
  let beadDrag = select(1.0, select(0.36, 0.22, chemistry > 1.5 && chemistry < 2.5), isolatedBead);
  let streakDrag = select(1.0, 0.42, sparseStreak);
  let maximum = select(select(0.30, 0.32, chemistry > 2.5), 0.25, chemistry > 1.5 && chemistry < 2.5);
  let dampedSpeed = min(speed * beadDrag * streakDrag, maximum);
  var damped = normalize(horizontal) * dampedSpeed;
  let neighborDirection = vec2f(right - left, front - back);
  let neighborLength = length(neighborDirection);
  let centerDirection = vec2f(-position.x, 0.28 - position.z);
  let centerLength = length(centerDirection);
  let tetherDirection = select(
    select(vec2f(0.0, 0.0), centerDirection / centerLength, centerLength > 0.0001),
    neighborDirection / neighborLength,
    neighborLength > 0.0001
  );
  let railTether = select(0.0, select(0.13, 0.20, chemistry > 1.5 && chemistry < 2.5), sparseStreak || sideRailBead);
  let isolatedTether = select(0.0, select(0.24, 0.34, chemistry > 1.5 && chemistry < 2.5), isolatedBead);
  let tetherStrength = max(railTether, isolatedTether);
  damped = damped + tetherDirection * tetherStrength;
  return vec3f(damped.x, velocity.y, damped.y);
}

fn hash01(seed: u32) -> f32 {
  var value = seed;
  value = value ^ (value >> 16u);
  value = value * 0x7feb352du;
  value = value ^ (value >> 15u);
  value = value * 0x846ca68bu;
  value = value ^ (value >> 16u);
  return f32(value & 0x00ffffffu) / 16777215.0;
}

fn respawnParticle(particle: Particle, index: u32, stepSeed: u32) -> Particle {
  var out = particle;
  if (params.emitterCount == 0u) {
    out.flags.y = 0.0;
    return out;
  }
  let hintedEmitterIndex = u32(max(0.0, particle.flags.x));
  let fallbackSlot = index % params.emitterCount;
  let emitterSlot = select(fallbackSlot, hintedEmitterIndex, hintedEmitterIndex < params.emitterCount);
  let emitter = emitters[emitterSlot];
  let origin = emitter.originActive.xyz;
  let aim = normalize(emitter.aimChem.xyz + vec3f(0.00001, 0.00001, 0.00001));
  let chemistry = emitter.aimChem.w;
  let motion = emitter.motionRadius.xyz;
  let radius = emitter.motionRadius.w;
  let particleRadius = max(0.018, radius * particleSupportScale());
  let strength = emitter.strengthExtensionIndexLife.x;
  let extension = emitter.strengthExtensionIndexLife.y;
  let sourceEmitterIndex = emitter.strengthExtensionIndexLife.z;
  let life = emitter.strengthExtensionIndexLife.w;
  let respawnCount = particle.flags.w + 1.0;
  let seed = ((index + 1u) * 374761393u)
    ^ ((u32(sourceEmitterIndex) + 7u) * 668265263u)
    ^ ((u32(respawnCount) + 11u) * 2246822519u)
    ^ ((stepSeed + 13u) * 3266489917u);
  let jitter = vec3f(
    hash01(seed) - 0.5,
    (hash01(seed + 0x9e3779b9u) - 0.5) * 0.55,
    hash01(seed + 0x85ebca6bu) - 0.5
  ) * radius;
  let speedBase = select(1.18, 2.15, extension > 0.5);
  let speed = speedBase * (0.35 + strength * 0.65);
  let arcBoost = 0.42 + max(0.0, aim.y) * 1.6;
  let lifeScale = 0.55 + hash01(seed + 0xc2b2ae35u) * 0.45;
  out.posPhase = vec4f(origin + jitter, 0.0);
  out.velChem = vec4f(aim * speed + motion + vec3f(0.0, arcBoost, 0.0), chemistry);
  out.misc = vec4f(particleRadius, strength, 0.0, life * lifeScale);
  out.flags = vec4f(sourceEmitterIndex, emitter.originActive.w, 0.0, respawnCount);
  return out;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn clear_pressure_bins(@builtin(global_invocation_id) global_id: vec3u) {
  let index = global_id.x;
  if (index >= SPATIAL_PRESSURE_CELL_COUNT) {
    return;
  }
  atomicStore(&pressureBins[index], 0u);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn accumulate_pressure_bins(@builtin(global_invocation_id) global_id: vec3u) {
  let index = global_id.x;
  if (index >= params.particleCount) {
    return;
  }
  let particle = particles[index];
  if (particle.flags.y > 0.5 && particle.posPhase.w >= 0.5 && particle.misc.z >= 0.0 && particle.misc.z < particle.misc.w) {
    atomicAdd(&pressureBins[pressureCellIndex(particle.posPhase.xyz)], 1u);
  }
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn build_neighbor_support_substrate(@builtin(global_invocation_id) global_id: vec3u) {
  let index = global_id.x;
  if (index >= params.particleCount) {
    return;
  }
  let particle = particles[index];
  if (!particleIsLiveSurface(particle)) {
    neighborSupportBuffer[index] = 0.0;
    return;
  }

  let position = particle.posPhase.xyz;
  let chemistry = particle.velChem.w;
  let radius = particle.misc.x;
  let supportRadius = max(radius * 2.65, SURFACE_VISCOSITY_RADIUS_BASE * particleSupportScale() * 0.95);
  let closeRadius = max(radius * 1.12, DENSITY_POSITION_SOLVE_REST_DISTANCE * particleSupportScale() * 1.04);
  let cellX = i32(pressureCellAxis(position.x, SPATIAL_PRESSURE_MIN_X, SPATIAL_PRESSURE_MAX_X, SPATIAL_PRESSURE_GRID_X));
  let cellZ = i32(pressureCellAxis(position.z, SPATIAL_PRESSURE_MIN_Z, SPATIAL_PRESSURE_MAX_Z, SPATIAL_PRESSURE_GRID_Z));
  let center = pressureCellCountAt(cellX, cellZ);
  let localOccupancyBias = clamp((center - 1.0) / 24.0, 0.0, 2.0);
  var support = localOccupancyBias;
  var closeSupport = 0.0;
  let particleCount = max(1u, params.particleCount);
  for (var sampleOffset: u32 = 1u; sampleOffset <= NEIGHBOR_SUPPORT_SUBSTRATE_SAMPLE_COUNT; sampleOffset = sampleOffset + 1u) {
    let phaseSeed = ((params.stepCount + 29u) * 747796405u) ^ ((index + 19u) * 2891336453u) ^ (sampleOffset * 1597334677u);
    let stride = 1u + (phaseSeed % max(1u, particleCount - 1u));
    let neighborIndex = (index + stride) % particleCount;
    let neighbor = particles[neighborIndex];
    if (!particleIsLiveSurface(neighbor) || abs(neighbor.velChem.w - chemistry) >= 0.25) {
      continue;
    }
    let delta = position - neighbor.posPhase.xyz;
    let distance = length(delta);
    if (distance <= 0.0001 || distance >= supportRadius) {
      continue;
    }
    let supportWeight = (supportRadius - distance) / supportRadius;
    support = support + supportWeight;
    if (distance < closeRadius) {
      closeSupport = closeSupport + (closeRadius - distance) / closeRadius;
    }
  }
  neighborSupportBuffer[index] = support + closeSupport * 0.72;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  let index = global_id.x;
  if (index >= params.particleCount) {
    return;
  }
  var particle = particles[index];
  if (particle.flags.y < 0.5) {
    return;
  }
  for (var s: u32 = 0u; s < params.steps; s = s + 1u) {
    var position = particle.posPhase.xyz;
    var phase = particle.posPhase.w;
    var velocity = particle.velChem.xyz;
    var chemistry = particle.velChem.w;
    var radius = particle.misc.x;
    var age = particle.misc.z + params.dt;
    var life = particle.misc.w;
    if (age < 0.0) {
      particle.misc.z = age;
      continue;
    }
    if (age >= life) {
      particle = respawnParticle(particle, index, params.stepCount + s);
      position = particle.posPhase.xyz;
      phase = particle.posPhase.w;
      velocity = particle.velChem.xyz;
      chemistry = particle.velChem.w;
      radius = particle.misc.x;
      age = particle.misc.z;
      life = particle.misc.w;
    }
    if (phase < 0.5) {
      velocity.y = velocity.y - 5.2 * params.dt;
      velocity = applyVisualStreakBeadDamping(index, position, velocity, radius, chemistry, phase, age);
      position = position + velocity * params.dt;
      let ground = terrainHeightAt(position.x, position.z) + radius * 0.35;
      if (position.y <= ground) {
        position.y = ground;
        phase = 1.0;
        particle.flags.z = 1.0;
        velocity = slideVelocityOnTerrain(velocity, terrainNormalAt(position.x, position.z), chemistry);
      }
    } else {
      let substrateSupport = substrateNeighborSupport(index);
      velocity = slideVelocityOnTerrain(velocity, terrainNormalAt(position.x, position.z), chemistry);
      velocity = applyLocalDensityPressure(index, position, velocity, radius, chemistry);
      velocity = applySpatialCellPressure(position, velocity, chemistry);
      velocity = applySurfaceViscosity(index, position, velocity, radius, chemistry);
      velocity = applySameChemistrySurfaceCohesion(index, position, velocity, radius, chemistry);
      velocity = applySpatialCellPressure(position + velocity * params.dt * 0.5, velocity, chemistry);
      velocity = applySurfaceStabilityDamping(position, velocity, chemistry);
      velocity = applyVisualStreakBeadDamping(index, position, velocity, radius, chemistry, phase, age);
      position = position + velocity * params.dt;
      position = applySpatialSurfaceRelaxation(position, velocity, radius, chemistry);
      position = applyDensityPositionSolve(index, position, velocity, radius, chemistry, substrateSupport);
      position = applyDensityContinuityProjection(index, position, radius, chemistry);
      position = applySampledNeighborhoodDensity(index, position, radius, chemistry, substrateSupport);
      position = applyLocalPairDensityProjection(index, position, radius, chemistry, substrateSupport);
      position = applySubstrateDensityConstraintSolve(index, position, velocity, radius, chemistry, substrateSupport);
      position = applyIterativeDensityContinuityProjection(index, position, velocity, radius, chemistry, substrateSupport);
      position = applyDeepDensityContinuityProjection(index, position, radius, chemistry);
      position = applySurfaceBasinContainment(position, radius, chemistry);
      velocity = applySurfaceStabilityDamping(position, velocity, chemistry);
      velocity = applyVisualStreakBeadDamping(index, position, velocity, radius, chemistry, phase, age);
      position.y = terrainHeightAt(position.x, position.z) + radius * 0.25;
    }
    particle.posPhase = vec4f(position, phase);
    particle.velChem = vec4f(velocity, chemistry);
    particle.misc.z = age;
  }
  particles[index] = particle;
}
`;

const RENDER_SHADER = `
// ${LERMS_FINGER_JUICE_ORBIT_CAMERA_PROJECTION_CONTRACT}
struct Particle {
  posPhase: vec4f,
  velChem: vec4f,
  misc: vec4f,
  flags: vec4f,
};

struct RenderParams {
  viewport: vec4f,
  camera: vec4f,
  cameraPan: vec4f,
};

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) local: vec2f,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: RenderParams;

fn quadCorner(vertexIndex: u32) -> vec2f {
  let corner = vertexIndex % 6u;
  if (corner == 0u) { return vec2f(-1.0, -1.0); }
  if (corner == 1u) { return vec2f(1.0, -1.0); }
  if (corner == 2u) { return vec2f(-1.0, 1.0); }
  if (corner == 3u) { return vec2f(-1.0, 1.0); }
  if (corner == 4u) { return vec2f(1.0, -1.0); }
  return vec2f(1.0, 1.0);
}

fn chemistryColor(chemistry: f32, surface: bool) -> vec4f {
  let alpha = select(0.72, 0.48, surface);
  if (chemistry > 2.5) {
    return vec4f(0.84, 0.62, 1.0, alpha);
  }
  if (chemistry > 1.5) {
    return vec4f(0.28, 0.87, 0.78, alpha);
  }
  return vec4f(1.0, 0.4, 0.34, alpha);
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let particle = particles[instanceIndex];
  let corner = quadCorner(vertexIndex);
  let world = particle.posPhase.xyz;
  let phase = particle.posPhase.w;
  let chemistry = particle.velChem.w;
  let age = particle.misc.z;
  let life = particle.misc.w;
  let enabled = particle.flags.y > 0.5 && age >= 0.0 && age < life;
  let width = params.viewport.x;
  let height = params.viewport.y;
  let orbitCameraYaw = params.camera.x;
  let orbitCameraPitch = params.camera.y;
  let orbitCameraZoom = max(0.1, params.camera.z);
  let orbitCameraPan = params.cameraPan.xy;
  let yawSin = sin(orbitCameraYaw);
  let yawCos = cos(orbitCameraYaw);
  let pitchSin = sin(orbitCameraPitch);
  let pitchCos = cos(orbitCameraPitch);
  let orbitTarget = vec3f(0.0, 0.64, -0.2);
  let relativeWorld = world - orbitTarget;
  let yawedX = relativeWorld.x * yawCos - relativeWorld.z * yawSin;
  let yawedZ = relativeWorld.x * yawSin + relativeWorld.z * yawCos;
  let pitchedY = relativeWorld.y * pitchCos - yawedZ * pitchSin;
  let pitchedZ = relativeWorld.y * pitchSin + yawedZ * pitchCos;
  let cameraWorld = vec3f(yawedX, pitchedY, pitchedZ);
  let depth = 2.4 + cameraWorld.z;
  let responsiveProjectionScale = min(width * 0.82, height * 1.22);
  let scale = responsiveProjectionScale * orbitCameraZoom / max(0.58, depth);
  let responsiveParticleScale = clamp(responsiveProjectionScale / 390.0, 1.0, 2.2);
  let screen = vec2f(
    width * (0.5 + orbitCameraPan.x) + cameraWorld.x * scale,
    height * (0.64 + orbitCameraPan.y) - cameraWorld.y * scale
  );
  let particleBudgetScale = clamp(sqrt(2400.0 / max(1.0, params.viewport.w)), 0.84, 1.0);
  let radius = (select(4.8, 6.8, phase >= 0.5) + particle.misc.x * 42.0) * responsiveParticleScale * particleBudgetScale;
  let finalScreen = screen + corner * radius;
  var out: VertexOut;
  out.position = select(
    vec4f(2.0, 2.0, 0.0, 1.0),
    vec4f(finalScreen.x / width * 2.0 - 1.0, 1.0 - finalScreen.y / height * 2.0, 0.0, 1.0),
    enabled
  );
  out.color = select(vec4f(0.0, 0.0, 0.0, 0.0), chemistryColor(chemistry, phase >= 0.5), enabled);
  out.local = corner;
  return out;
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4f {
  let dist = dot(input.local, input.local);
  if (dist > 1.0) {
    discard;
  }
  let falloff = 1.0 - smoothstep(0.35, 1.0, dist);
  return vec4f(input.color.rgb, input.color.a * falloff);
}
`;

function unavailableSolver(reason, context = {}) {
  return {
    solver_backend: 'webgpu_unavailable',
    solverRoute: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
    shaderRoute: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
    adapterInfo: null,
    reason,
    async stepAndRead() {
      return {
        solver_backend: 'webgpu_unavailable',
        solverRoute: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
        shaderRoute: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
        adapterInfo: null,
        reason,
        cpuOracleMode: 'cpu_oracle_unavailable_v0',
        cpuOracle: context.cpuOracle || null,
      };
    },
  };
}

export async function createWebGPUFingerJuiceSolver(options = {}) {
  const maxParticles = Math.max(16, Math.floor(options.maxParticles || DEFAULT_PARTICLE_SUPPORT_BUDGET));
  const { data, sources, emitterData } = createInitialWebGPUParticles(options.emitterPacket, {
    maxParticles,
    seed: options.seed || 11,
  });
  let currentSources = sources;
  let currentEmitterData = emitterData;
  let currentEmitterPacket = options.emitterPacket || {};
  let currentHillSupportFramePayload = options.hillSupportFramePayload || options.supportFramePayload || null;
  let currentTerrainSampleSurface = options.terrainSampleSurface || normalizeHillTerrainSamplePacket(
    options.terrainSamplePacket || null,
    options.terrainSampleData || null,
    { stepCount: 0 },
  );
  let currentTerrainSampleBufferData = createWebGPUTerrainSampleBufferData(currentTerrainSampleSurface);
  const cpuOracleBase = options.cpuOracle === false ? null : runCpuFingerJuiceOracle(data, {
    steps: options.oracleSteps || 180,
    dt: options.oracleDt || 1 / 60,
    sources: currentSources,
    emitterPacket: currentEmitterPacket,
    lerms: options.lerms || [],
    goins: options.goins || [],
    hillSupportFramePayload: currentHillSupportFramePayload,
    terrainSampleSurface: currentTerrainSampleSurface,
  });
  if (!globalThis.navigator?.gpu) {
    return unavailableSolver('navigator.gpu unavailable', { cpuOracle: cpuOracleBase });
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    return unavailableSolver('WebGPU adapter unavailable', { cpuOracle: cpuOracleBase });
  }
  const device = await adapter.requestDevice();
  const adapterInfo = adapter.info ? {
    vendor: adapter.info.vendor || null,
    architecture: adapter.info.architecture || null,
    device: adapter.info.device || null,
    description: adapter.info.description || null,
  } : { vendor: 'unknown', architecture: null, device: null, description: null };
  const byteLength = data.byteLength;
  const particleBuffer = device.createBuffer({
    label: 'lerms-finger-juice-particles',
    size: byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  let emitterBufferByteLength = emitterData.data.byteLength;
  let emitterBuffer = device.createBuffer({
    label: 'lerms-finger-juice-emitters',
    size: emitterBufferByteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const pressureBinBuffer = device.createBuffer({
    label: 'lerms-finger-juice-pressureBins',
    size: SPATIAL_PRESSURE_CELL_COUNT * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const neighborSupportBuffer = device.createBuffer({
    label: 'lerms-finger-juice-neighborSupportBuffer',
    size: maxParticles * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  let terrainSampleBuffer = device.createBuffer({
    label: 'lerms-finger-juice-terrain-samples',
    size: currentTerrainSampleBufferData.data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  let terrainSampleBufferByteLength = currentTerrainSampleBufferData.data.byteLength;
  const readbackBuffer = device.createBuffer({
    label: 'lerms-finger-juice-particle-readback',
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const neighborSupportReadbackBuffer = device.createBuffer({
    label: 'lerms-finger-juice-neighbor-support-readback',
    size: maxParticles * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const paramsBuffer = device.createBuffer({
    label: 'lerms-finger-juice-params',
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(particleBuffer, 0, data);
  device.queue.writeBuffer(emitterBuffer, 0, emitterData.data);
  device.queue.writeBuffer(terrainSampleBuffer, 0, currentTerrainSampleBufferData.data);
  const shaderModule = device.createShaderModule({
    label: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
    code: COMPUTE_SHADER,
  });
  const computeBindGroupLayout = device.createBindGroupLayout({
    label: 'lerms-finger-juice-compute-bindgroup-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ],
  });
  const computePipelineLayout = device.createPipelineLayout({
    label: 'lerms-finger-juice-compute-pipeline-layout',
    bindGroupLayouts: [computeBindGroupLayout],
  });
  let pipeline;
  let clearPressurePipeline;
  let accumulatePressurePipeline;
  let neighborSupportPipeline;
  try {
    clearPressurePipeline = await device.createComputePipelineAsync({
      label: `${LERMS_FINGER_JUICE_WEBGPU_SPATIAL_PRESSURE_CONTRACT}:clear_pressure_bins`,
      layout: computePipelineLayout,
      compute: { module: shaderModule, entryPoint: 'clear_pressure_bins' },
    });
    accumulatePressurePipeline = await device.createComputePipelineAsync({
      label: `${LERMS_FINGER_JUICE_WEBGPU_SPATIAL_PRESSURE_CONTRACT}:accumulate_pressure_bins`,
      layout: computePipelineLayout,
      compute: { module: shaderModule, entryPoint: 'accumulate_pressure_bins' },
    });
    neighborSupportPipeline = await device.createComputePipelineAsync({
      label: `${LERMS_FINGER_JUICE_WEBGPU_NEIGHBOR_SUPPORT_SUBSTRATE_CONTRACT}:build_neighbor_support_substrate`,
      layout: computePipelineLayout,
      compute: { module: shaderModule, entryPoint: 'build_neighbor_support_substrate' },
    });
    pipeline = await device.createComputePipelineAsync({
      label: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
      layout: computePipelineLayout,
      compute: { module: shaderModule, entryPoint: 'main' },
    });
  } catch (error) {
    return unavailableSolver(`WebGPU pipeline validation failed: ${error.message || String(error)}`, { cpuOracle: cpuOracleBase });
  }
  function createComputeBindGroup() {
    return device.createBindGroup({
      label: 'lerms-finger-juice-bindgroup',
      layout: computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: particleBuffer } },
        { binding: 1, resource: { buffer: paramsBuffer } },
        { binding: 2, resource: { buffer: emitterBuffer } },
        { binding: 3, resource: { buffer: pressureBinBuffer } },
        { binding: 4, resource: { buffer: neighborSupportBuffer } },
        { binding: 5, resource: { buffer: terrainSampleBuffer } },
      ],
    });
  }
  let bindGroup = createComputeBindGroup();
  let stepCount = 0;
  let operationQueue = Promise.resolve();
  function uploadTerrainSampleSurface(surface = null) {
    currentTerrainSampleSurface = surface;
    currentTerrainSampleBufferData = createWebGPUTerrainSampleBufferData(surface);
    if (currentTerrainSampleBufferData.data.byteLength !== terrainSampleBufferByteLength) {
      terrainSampleBuffer.destroy?.();
      terrainSampleBuffer = device.createBuffer({
        label: 'lerms-finger-juice-terrain-samples',
        size: currentTerrainSampleBufferData.data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      terrainSampleBufferByteLength = currentTerrainSampleBufferData.data.byteLength;
      bindGroup = createComputeBindGroup();
    }
    device.queue.writeBuffer(terrainSampleBuffer, 0, currentTerrainSampleBufferData.data);
    return currentTerrainSampleBufferData;
  }
  function encodeCompute(encoder, safeSteps, safeDt, stepBase = stepCount, label = 'lerms-finger-juice-step') {
    const params = new ArrayBuffer(64);
    const paramsView = new DataView(params);
    paramsView.setFloat32(0, safeDt, true);
    paramsView.setUint32(4, maxParticles, true);
    paramsView.setUint32(8, safeSteps, true);
    paramsView.setUint32(12, currentEmitterData.emitterCount, true);
    paramsView.setUint32(16, stepBase, true);
    paramsView.setUint32(20, currentTerrainSampleBufferData.mode, true);
    paramsView.setUint32(24, currentTerrainSampleBufferData.columns, true);
    paramsView.setUint32(28, currentTerrainSampleBufferData.rows, true);
    paramsView.setFloat32(32, finite(currentTerrainSampleBufferData.worldBounds?.x?.min, -1), true);
    paramsView.setFloat32(36, finite(currentTerrainSampleBufferData.worldBounds?.x?.max, 1), true);
    paramsView.setFloat32(40, finite(currentTerrainSampleBufferData.worldBounds?.z?.min, -1), true);
    paramsView.setFloat32(44, finite(currentTerrainSampleBufferData.worldBounds?.z?.max, 1), true);
    device.queue.writeBuffer(paramsBuffer, 0, params);
    const pass = encoder.beginComputePass({ label });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(clearPressurePipeline);
    pass.dispatchWorkgroups(Math.ceil(SPATIAL_PRESSURE_CELL_COUNT / WORKGROUP_SIZE));
    pass.setPipeline(accumulatePressurePipeline);
    pass.dispatchWorkgroups(Math.ceil(maxParticles / WORKGROUP_SIZE));
    pass.setPipeline(neighborSupportPipeline);
    pass.dispatchWorkgroups(Math.ceil(maxParticles / WORKGROUP_SIZE));
    pass.setPipeline(pipeline);
    pass.dispatchWorkgroups(Math.ceil(maxParticles / WORKGROUP_SIZE));
    pass.end();
  }
  async function runComputeChunks(safeSteps, safeDt, label = LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE) {
    let submittedSteps = 0;
    let chunkCount = 0;
    while (submittedSteps < safeSteps) {
      const chunkSteps = Math.min(CONTINUITY_BIN_REFRESH_CHUNK, safeSteps - submittedSteps);
      const encoder = device.createCommandEncoder({ label: `${label}:continuity-bin-refresh-${chunkCount}` });
      encodeCompute(encoder, chunkSteps, safeDt, stepCount + submittedSteps, label);
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      submittedSteps += chunkSteps;
      chunkCount += 1;
    }
    return chunkCount;
  }
  async function runStep(steps = 1, dt = 1 / 60) {
    const safeSteps = Math.max(0, Math.floor(Number(steps) || 0));
    const safeDt = Math.max(1 / 240, Math.min(1 / 20, finite(dt, 1 / 60)));
    if (safeSteps <= 0) {
      return {
        solver_backend: 'webgpu_compute',
        solverRoute: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
        shaderRoute: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
        emitterBufferRoute: LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE,
        respawnContract: LERMS_FINGER_JUICE_WEBGPU_RESPAWN_CONTRACT,
        pressureContract: LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT,
        spatialPressureContract: LERMS_FINGER_JUICE_WEBGPU_SPATIAL_PRESSURE_CONTRACT,
        fluidDepthContract: LERMS_FINGER_JUICE_WEBGPU_FLUID_DEPTH_CONTRACT,
        visualDampingContract: LERMS_FINGER_JUICE_WEBGPU_VISUAL_DAMPING_CONTRACT,
        densityPositionSolveContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_POSITION_SOLVE_CONTRACT,
        densityContinuityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_CONTINUITY_CONTRACT,
        sampledNeighborhoodDensityContract: LERMS_FINGER_JUICE_WEBGPU_SAMPLED_NEIGHBORHOOD_DENSITY_CONTRACT,
        localPairDensityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_LOCAL_PAIR_DENSITY_CONTRACT,
        deepDensityContinuityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_DEEP_DENSITY_CONTINUITY_CONTRACT,
        neighborSupportSubstrateContract: LERMS_FINGER_JUICE_WEBGPU_NEIGHBOR_SUPPORT_SUBSTRATE_CONTRACT,
        substrateDensityConstraintContract: LERMS_FINGER_JUICE_WEBGPU_SUBSTRATE_DENSITY_CONSTRAINT_CONTRACT,
        iterativeDensityContinuityContract: LERMS_FINGER_JUICE_WEBGPU_ITERATIVE_DENSITY_CONTINUITY_CONTRACT,
        particleSupportBudgetContract: LERMS_FINGER_JUICE_WEBGPU_SUPPORT_BUDGET_CONTRACT,
        terrainSampleGpuCollisionMode: currentTerrainSampleBufferData.terrainSampleGpuCollisionMode,
        continuityBinRefreshChunk: CONTINUITY_BIN_REFRESH_CHUNK,
        stepCount,
      };
    }
    const continuityBinRefreshCount = await runComputeChunks(safeSteps, safeDt, LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE);
    stepCount += safeSteps;
    return {
      solver_backend: 'webgpu_compute',
      solverRoute: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
      shaderRoute: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
      emitterBufferRoute: LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE,
      respawnContract: LERMS_FINGER_JUICE_WEBGPU_RESPAWN_CONTRACT,
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT,
      spatialPressureContract: LERMS_FINGER_JUICE_WEBGPU_SPATIAL_PRESSURE_CONTRACT,
      fluidDepthContract: LERMS_FINGER_JUICE_WEBGPU_FLUID_DEPTH_CONTRACT,
      visualDampingContract: LERMS_FINGER_JUICE_WEBGPU_VISUAL_DAMPING_CONTRACT,
      densityPositionSolveContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_POSITION_SOLVE_CONTRACT,
      densityContinuityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_CONTINUITY_CONTRACT,
      sampledNeighborhoodDensityContract: LERMS_FINGER_JUICE_WEBGPU_SAMPLED_NEIGHBORHOOD_DENSITY_CONTRACT,
      localPairDensityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_LOCAL_PAIR_DENSITY_CONTRACT,
      deepDensityContinuityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_DEEP_DENSITY_CONTINUITY_CONTRACT,
      neighborSupportSubstrateContract: LERMS_FINGER_JUICE_WEBGPU_NEIGHBOR_SUPPORT_SUBSTRATE_CONTRACT,
      substrateDensityConstraintContract: LERMS_FINGER_JUICE_WEBGPU_SUBSTRATE_DENSITY_CONSTRAINT_CONTRACT,
      iterativeDensityContinuityContract: LERMS_FINGER_JUICE_WEBGPU_ITERATIVE_DENSITY_CONTINUITY_CONTRACT,
      particleSupportBudgetContract: LERMS_FINGER_JUICE_WEBGPU_SUPPORT_BUDGET_CONTRACT,
      terrainSampleGpuCollisionMode: currentTerrainSampleBufferData.terrainSampleGpuCollisionMode,
      continuityBinRefreshChunk: CONTINUITY_BIN_REFRESH_CHUNK,
      continuityBinRefreshCount,
      stepCount,
    };
  }
  async function runStepAndRead(steps = 1, dt = 1 / 60, readOptions = {}) {
    const safeSteps = Math.max(0, Math.floor(Number(steps) || 0));
    const safeDt = Math.max(1 / 240, Math.min(1 / 20, finite(dt, 1 / 60)));
    const shouldRunCpuOracle = readOptions.cpuOracle !== false;
    const cpuOracleMode = shouldRunCpuOracle
      ? 'cpu_oracle_replayed_v0'
      : 'skip_cpu_oracle_live_readback_v0';
    if (safeSteps > 0) {
      await runComputeChunks(safeSteps, safeDt, LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE);
    }
    const encoder = device.createCommandEncoder({ label: 'lerms-finger-juice-step-readback' });
    encoder.copyBufferToBuffer(particleBuffer, 0, readbackBuffer, 0, byteLength);
    encoder.copyBufferToBuffer(neighborSupportBuffer, 0, neighborSupportReadbackBuffer, 0, maxParticles * 4);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readbackBuffer.getMappedRange()).slice();
    readbackBuffer.unmap();
    await neighborSupportReadbackBuffer.mapAsync(GPUMapMode.READ);
    const neighborSupportData = new Float32Array(neighborSupportReadbackBuffer.getMappedRange()).slice();
    neighborSupportReadbackBuffer.unmap();
    stepCount += safeSteps;
    const cpuOracle = shouldRunCpuOracle
      ? runCpuFingerJuiceOracle(data, {
          steps: stepCount,
          dt: safeDt,
          sources: currentSources,
          emitterPacket: currentEmitterPacket,
          lerms: options.lerms || [],
          goins: options.goins || [],
          hillSupportFramePayload: currentHillSupportFramePayload,
          terrainSampleSurface: currentTerrainSampleSurface,
        })
      : null;
    const summary = summarizeWebGPUParticles(result, {
      sources: currentSources,
      emitterPacket: currentEmitterPacket,
      stepCount,
      lerms: options.lerms || [],
      goins: options.goins || [],
      solver_backend: 'webgpu_compute',
      summaryMode: readOptions.summaryMode || null,
      neighborSupportData,
      hillSupportFramePayload: currentHillSupportFramePayload,
      terrainSampleSurface: currentTerrainSampleSurface,
      terrainSampleGpuCollisionMode: currentTerrainSampleBufferData.terrainSampleGpuCollisionMode,
    });
    return {
      ...summary,
      solver_backend: 'webgpu_compute',
      solverRoute: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
      shaderRoute: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
      emitterBufferRoute: LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE,
      respawnContract: LERMS_FINGER_JUICE_WEBGPU_RESPAWN_CONTRACT,
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT,
      spatialPressureContract: LERMS_FINGER_JUICE_WEBGPU_SPATIAL_PRESSURE_CONTRACT,
      fluidDepthContract: LERMS_FINGER_JUICE_WEBGPU_FLUID_DEPTH_CONTRACT,
      visualDampingContract: LERMS_FINGER_JUICE_WEBGPU_VISUAL_DAMPING_CONTRACT,
      densityPositionSolveContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_POSITION_SOLVE_CONTRACT,
      densityContinuityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_CONTINUITY_CONTRACT,
      sampledNeighborhoodDensityContract: LERMS_FINGER_JUICE_WEBGPU_SAMPLED_NEIGHBORHOOD_DENSITY_CONTRACT,
      localPairDensityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_LOCAL_PAIR_DENSITY_CONTRACT,
      deepDensityContinuityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_DEEP_DENSITY_CONTINUITY_CONTRACT,
      neighborSupportSubstrateContract: LERMS_FINGER_JUICE_WEBGPU_NEIGHBOR_SUPPORT_SUBSTRATE_CONTRACT,
      substrateDensityConstraintContract: LERMS_FINGER_JUICE_WEBGPU_SUBSTRATE_DENSITY_CONSTRAINT_CONTRACT,
      iterativeDensityContinuityContract: LERMS_FINGER_JUICE_WEBGPU_ITERATIVE_DENSITY_CONTINUITY_CONTRACT,
      particleSupportBudgetContract: LERMS_FINGER_JUICE_WEBGPU_SUPPORT_BUDGET_CONTRACT,
      terrainSampleGpuCollisionMode: currentTerrainSampleBufferData.terrainSampleGpuCollisionMode,
      continuityBinRefreshChunk: CONTINUITY_BIN_REFRESH_CHUNK,
      continuityBinRefreshCount: safeSteps > 0 ? Math.ceil(safeSteps / CONTINUITY_BIN_REFRESH_CHUNK) : 0,
      adapterInfo,
      workgroupSize: WORKGROUP_SIZE,
      maxParticles,
      stepCount,
      readbackParticleFloats: result.length,
      emitterCount: currentEmitterData.emitterCount,
      cpuOracleMode,
      cpuOracleReason: readOptions.reason || null,
      cpuOracle: cpuOracle ? {
        solver_backend: cpuOracle.solver_backend,
        particleCount: cpuOracle.particleCount,
        surfaceFlowCount: cpuOracle.surfaceFlowCount,
        maxRangeZ: cpuOracle.maxRangeZ,
        gpuRespawnCount: cpuOracle.gpuRespawnCount,
      } : null,
    };
  }
  function setEmitterPacket(emitterPacket = {}) {
    const nextEmitterData = createWebGPUEmitterBufferData(emitterPacket);
    if (nextEmitterData.data.byteLength > emitterBufferByteLength) {
      emitterBuffer.destroy?.();
      emitterBuffer = device.createBuffer({
        label: 'lerms-finger-juice-emitters',
        size: nextEmitterData.data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      emitterBufferByteLength = nextEmitterData.data.byteLength;
      bindGroup = createComputeBindGroup();
    }
    currentEmitterData = nextEmitterData;
    currentSources = nextEmitterData.sources;
    currentEmitterPacket = emitterPacket;
    device.queue.writeBuffer(emitterBuffer, 0, nextEmitterData.data);
    return {
      emitterBufferRoute: LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE,
      emitterCount: currentEmitterData.emitterCount,
      sourcePacketId: currentEmitterPacket.packet_id || null,
      configId: currentEmitterPacket.route_identity || null,
    };
  }
  function setHillSupportFramePayload(payloadReport = null) {
    const normalized = normalizeHillSupportFramePayload(payloadReport, { stepCount });
    if (!normalized) {
      currentHillSupportFramePayload = null;
      return {
        supportFramePayloadStatus: 'invalid',
        supportFrameSource: 'local_procedural_support_frame_v0',
        supportFrameChecksum: createFingerJuiceSupportFrame({ stepCount }).supportFrameChecksum,
      };
    }
    currentHillSupportFramePayload = payloadReport;
    return {
      supportFramePayloadStatus: 'loaded',
      supportFrameSource: normalized.supportFrameSource,
      sourceAuthority: normalized.sourceAuthority,
      sourceRoute: normalized.sourceRoute,
      supportFrameChecksum: normalized.supportFrameChecksum,
      supportFrameIngestionContract: normalized.supportFrameIngestionContract,
      heightfieldCouplingMode: normalized.heightfieldCouplingMode,
    };
  }
  function setTerrainSampleSurface(surface = null) {
    const terrainBufferData = uploadTerrainSampleSurface(surface);
    if (!surface) {
      return {
        terrainSampleStatus: 'missing',
        terrainSampleGpuCollisionMode: terrainBufferData.terrainSampleGpuCollisionMode,
        heightfieldCouplingMode: supportFrameForSummary({ hillSupportFramePayload: currentHillSupportFramePayload, stepCount }).heightfieldCouplingMode,
      };
    }
    return {
      terrainSampleStatus: surface.status || 'loaded',
      terrainSampleCouplingMode: 'source_height_samples_v0',
      terrainSampleGpuCollisionMode: terrainBufferData.terrainSampleGpuCollisionMode,
      heightfieldCouplingMode: surface.supportFrame?.heightfieldCouplingMode || 'source_height_samples_v0',
      terrainSampleChecksum: surface.checksums?.sample || null,
      terrainChannelChecksum: surface.checksums?.channels || null,
      supportFrameChecksum: surface.supportFrame?.supportFrameChecksum || null,
    };
  }
  function setHillTerrainSamplePacket(packetReport = null, dataReport = null) {
    return setTerrainSampleSurface(normalizeHillTerrainSamplePacket(packetReport, dataReport, { stepCount }));
  }
  function step(steps = 1, dt = 1 / 60) {
    const run = () => runStep(steps, dt);
    operationQueue = operationQueue.then(run, run);
    return operationQueue;
  }
  function stepAndRead(steps = 1, dt = 1 / 60, readOptions = {}) {
    const run = () => runStepAndRead(steps, dt, readOptions);
    operationQueue = operationQueue.then(run, run);
    return operationQueue;
  }
  async function createRenderer(canvas) {
    if (!canvas?.getContext) {
      return {
        render_backend: 'webgpu_render_unavailable',
        renderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE,
        renderShaderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE,
        reason: 'missing render canvas',
      };
    }
    /** @type {GPUCanvasContext} */
    const context = canvas.getContext('webgpu');
    if (!context) {
      return {
        render_backend: 'webgpu_render_unavailable',
        renderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE,
        renderShaderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE,
        reason: 'GPUCanvasContext unavailable',
      };
    }
    const format = navigator.gpu.getPreferredCanvasFormat();
    let configuredCanvasExtent = null;
    function configureCanvasContextForExtent(extent) {
      if (!extent || extent.targetWidth <= 0 || extent.targetHeight <= 0) return false;
      if (canvas.width !== extent.targetWidth) canvas.width = extent.targetWidth;
      if (canvas.height !== extent.targetHeight) canvas.height = extent.targetHeight;
      const nextKey = `${extent.targetWidth}x${extent.targetHeight}`;
      if (configuredCanvasExtent !== nextKey) {
        context.configure({
          device,
          format,
          alphaMode: 'premultiplied',
        });
        configuredCanvasExtent = nextKey;
      }
      return true;
    }
    configureCanvasContextForExtent(resolveNonzeroWebGPUCanvasExtent(canvas, { width: canvas.width, height: canvas.height, pixelRatio: 1 }));
    const renderParamsBuffer = device.createBuffer({
      label: 'lerms-finger-juice-render-params',
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const renderShaderModule = device.createShaderModule({
      label: LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE,
      code: RENDER_SHADER,
    });
    let renderPipeline;
    try {
      renderPipeline = await device.createRenderPipelineAsync({
        label: LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE,
        layout: 'auto',
        vertex: { module: renderShaderModule, entryPoint: 'vs_main' },
        fragment: {
          module: renderShaderModule,
          entryPoint: 'fs_main',
          targets: [{
            format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          }],
        },
        primitive: { topology: 'triangle-list' },
      });
    } catch (error) {
      return {
        render_backend: 'webgpu_render_unavailable',
        renderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE,
        renderShaderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE,
        reason: `WebGPU render pipeline validation failed: ${error.message || String(error)}`,
      };
    }
    const renderBindGroup = device.createBindGroup({
      label: 'lerms-finger-juice-render-bindgroup',
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: particleBuffer } },
        { binding: 1, resource: { buffer: renderParamsBuffer } },
      ],
    });
    let renderFrameCount = 0;
    function render({
      width = canvas.clientWidth || 1,
      height = canvas.clientHeight || 1,
      pixelRatio = globalThis.devicePixelRatio || 1,
      camera = {},
    } = {}) {
      const extent = resolveNonzeroWebGPUCanvasExtent(canvas, { width, height, pixelRatio });
      if (!configureCanvasContextForExtent(extent)) {
        return {
          render_backend: 'webgpu_render_deferred',
          renderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE,
          renderShaderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE,
          renderExtentContract: LERMS_FINGER_JUICE_WEBGPU_CANVAS_EXTENT_CONTRACT,
          renderDeferReason: 'empty_canvas_extent_deferred_v0',
          renderFrameCount,
        };
      }
      const params = new Float32Array([
        extent.cssWidth,
        extent.cssHeight,
        extent.ratio,
        maxParticles,
        finite(camera.yaw, 0),
        finite(camera.pitch, 0),
        finite(camera.zoom, 1),
        0,
        finite(camera.panX, 0),
        finite(camera.panY, 0),
        0,
        0,
      ]);
      device.queue.writeBuffer(renderParamsBuffer, 0, params);
      const encoder = device.createCommandEncoder({ label: 'lerms-finger-juice-direct-render' });
      try {
        const pass = encoder.beginRenderPass({
          label: LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE,
          colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        pass.setPipeline(renderPipeline);
        pass.setBindGroup(0, renderBindGroup);
        pass.draw(6, maxParticles);
        pass.end();
        device.queue.submit([encoder.finish()]);
        renderFrameCount += 1;
      } catch (error) {
        configuredCanvasExtent = null;
        return {
          render_backend: 'webgpu_render_deferred',
          renderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE,
          renderShaderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE,
          renderExtentContract: LERMS_FINGER_JUICE_WEBGPU_CANVAS_EXTENT_CONTRACT,
          renderDeferReason: 'empty_canvas_extent_deferred_v0',
          reason: error.message || String(error),
          renderFrameCount,
        };
      }
      return {
        render_backend: 'webgpu_direct_render',
        renderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE,
        renderShaderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE,
        renderScaleContract: PARTICLE_BUDGET_RENDER_SCALE_CONTRACT,
        renderExtentContract: LERMS_FINGER_JUICE_WEBGPU_CANVAS_EXTENT_CONTRACT,
        renderCanvasWidth: extent.targetWidth,
        renderCanvasHeight: extent.targetHeight,
        renderFrameCount,
      };
    }
    return {
      render_backend: 'webgpu_direct_render',
      renderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE,
      renderShaderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE,
      render,
    };
  }
  return {
    solver_backend: 'webgpu_compute',
    solverRoute: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
    shaderRoute: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
    emitterBufferRoute: LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE,
    respawnContract: LERMS_FINGER_JUICE_WEBGPU_RESPAWN_CONTRACT,
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT,
    spatialPressureContract: LERMS_FINGER_JUICE_WEBGPU_SPATIAL_PRESSURE_CONTRACT,
    fluidDepthContract: LERMS_FINGER_JUICE_WEBGPU_FLUID_DEPTH_CONTRACT,
    visualDampingContract: LERMS_FINGER_JUICE_WEBGPU_VISUAL_DAMPING_CONTRACT,
    densityPositionSolveContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_POSITION_SOLVE_CONTRACT,
    densityContinuityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_DENSITY_CONTINUITY_CONTRACT,
    sampledNeighborhoodDensityContract: LERMS_FINGER_JUICE_WEBGPU_SAMPLED_NEIGHBORHOOD_DENSITY_CONTRACT,
    localPairDensityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_LOCAL_PAIR_DENSITY_CONTRACT,
    deepDensityContinuityProjectionContract: LERMS_FINGER_JUICE_WEBGPU_DEEP_DENSITY_CONTINUITY_CONTRACT,
    neighborSupportSubstrateContract: LERMS_FINGER_JUICE_WEBGPU_NEIGHBOR_SUPPORT_SUBSTRATE_CONTRACT,
    substrateDensityConstraintContract: LERMS_FINGER_JUICE_WEBGPU_SUBSTRATE_DENSITY_CONSTRAINT_CONTRACT,
    iterativeDensityContinuityContract: LERMS_FINGER_JUICE_WEBGPU_ITERATIVE_DENSITY_CONTINUITY_CONTRACT,
    particleSupportBudgetContract: LERMS_FINGER_JUICE_WEBGPU_SUPPORT_BUDGET_CONTRACT,
    render_backend: 'webgpu_direct_render',
    renderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE,
    renderShaderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE,
    adapterInfo,
    workgroupSize: WORKGROUP_SIZE,
    maxParticles,
    emitterCount: currentEmitterData.emitterCount,
    step,
    stepAndRead,
    setEmitterPacket,
    setHillSupportFramePayload,
    setTerrainSampleSurface,
    setHillTerrainSamplePacket,
    createRenderer,
  };
}
