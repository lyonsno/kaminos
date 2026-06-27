export const LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE = 'webgpu_particle_solver_v0';
export const LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE = 'wgsl-ballistic-heightfield-surface-v0';
export const LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE = 'webgpu_particle_splat_renderer_v0';
export const LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE = 'wgsl-particle-splat-renderer-v0';
export const LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE = 'webgpu_emitter_buffer_v0';
export const LERMS_FINGER_JUICE_WEBGPU_RESPAWN_CONTRACT = 'wgsl-gpu-emitter-respawn-v0';
export const LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT = 'wgsl-local-density-pressure-v0';
export const LERMS_SOURCE_TRUTH_SCHEMA = 'lerms.source-truth.v0';
export const LERMS_JUICE_HIT_EVENT_SCHEMA = 'lerms.juice-hit-event.v0';

const PARTICLE_FLOATS = 16;
const EMITTER_FLOATS = 16;
const WORKGROUP_SIZE = 64;
const PRESSURE_NEIGHBOR_WINDOW = 6;
const PRESSURE_RADIUS = 0.105;
const SPAWN_JITTER_HASH_CONTRACT = 'spawn_jitter_hash_v0';

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
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
  return {
    position: add(source.origin || source.position, jitter),
    phase: 0,
    velocity: source.velocity,
    chemistry: source.chemistryCode,
    radius: source.radius,
    strength: source.strength,
    age: 0,
    life: source.life,
    emitterIndex: source.emitterIndex,
    active: true,
    impacted: false,
    respawnCount,
  };
}

export function createInitialWebGPUParticles(emitterPacket, options = {}) {
  const maxParticles = Math.max(16, Math.floor(options.maxParticles || 900));
  const seed = options.seed || 11;
  const rng = makeRng(seed);
  const data = new Float32Array(maxParticles * PARTICLE_FLOATS);
  const emitterData = createWebGPUEmitterBufferData(emitterPacket);
  const sources = emitterData.sources;
  for (let i = 0; i < maxParticles; i += 1) {
    const source = sources[i % Math.max(1, sources.length)];
    if (!source) continue;
    const radius = source.radius;
    const jitter = [(rng() - 0.5) * radius, (rng() - 0.5) * radius, (rng() - 0.5) * radius];
    const start = add(source.origin, jitter);
    writeParticle(data, i, {
      position: start,
      phase: 0,
      velocity: source.velocity,
      chemistry: source.chemistryCode,
      radius,
      strength: source.strength,
      age: (i % 18) * -0.012,
      life: source.life,
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
        const ground = terrainHeightAt(particle.position[0], particle.position[2]) + particle.radius * 0.35;
        if (particle.position[1] <= ground) {
          particle.position[1] = ground;
          particle.phase = 1;
          particle.impacted = true;
          particle.velocity = slideVelocityOnTerrain(particle.velocity, terrainNormalAt(particle.position[0], particle.position[2]), particle.chemistry);
        }
      } else {
        particle.velocity = slideVelocityOnTerrain(particle.velocity, terrainNormalAt(particle.position[0], particle.position[2]), particle.chemistry);
        particle.position = add(particle.position, mul(particle.velocity, dt));
        particle.position[1] = terrainHeightAt(particle.position[0], particle.position[2]) + particle.radius * 0.25;
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
      if (distance <= finite(target.radius, kind === 'goin' ? 0.13 : 0.16) + particle.radius) {
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
  if (!surfaceParticles.length) {
    return {
      pressureContract: LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT,
      pressureNeighborWindow: PRESSURE_NEIGHBOR_WINDOW,
      pressureRadius: PRESSURE_RADIUS,
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
        if (distance > 0.0001 && distance < PRESSURE_RADIUS) density += (PRESSURE_RADIUS - distance) / PRESSURE_RADIUS;
      }
    }
    return density;
  });
  const totalDensity = densities.reduce((sum, value) => sum + value, 0);
  return {
    pressureContract: LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT,
    pressureNeighborWindow: PRESSURE_NEIGHBOR_WINDOW,
    pressureRadius: PRESSURE_RADIUS,
    surfaceParticleCount: surfaceParticles.length,
    averageNeighborDensity: round(totalDensity / surfaceParticles.length, 4),
    maxNeighborDensity: round(Math.max(...densities), 4),
    pressureAffectedCount: densities.filter(value => value > 0).length,
  };
}

export function summarizeWebGPUParticles(buffer, options = {}) {
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
    sourceTruth,
    sourceDiagnostics,
    emitterDiagnostics,
    pressureDensityStats: pressureStats,
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
  pad0: u32,
  pad1: u32,
  pad2: u32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read> emitters: array<Emitter>;

fn terrainHeightAt(x: f32, z: f32) -> f32 {
  let bowl = -0.08 + 0.11 * x * x + 0.035 * cos(z * 1.65);
  let hillA = 0.11 * exp(-((x - 0.46) * (x - 0.46) + (z - 0.28) * (z - 0.28)) / 0.18);
  let hillB = 0.09 * exp(-((x + 0.36) * (x + 0.36) + (z + 0.1) * (z + 0.1)) / 0.11);
  let valley = -0.08 * exp(-((x - 0.05) * (x - 0.05) + (z + 0.08) * (z + 0.08)) / 0.08);
  return bowl + hillA + hillB + valley;
}

fn terrainNormalAt(x: f32, z: f32) -> vec3f {
  let eps = 0.015;
  let dx = (terrainHeightAt(x + eps, z) - terrainHeightAt(x - eps, z)) / (eps * 2.0);
  let dz = (terrainHeightAt(x, z + eps) - terrainHeightAt(x, z - eps)) / (eps * 2.0);
  return normalize(vec3f(-dx, 1.0, -dz));
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
  let pressureRadius = max(${PRESSURE_RADIUS.toFixed(4)}, radius * 2.35);
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
  out.posPhase = vec4f(origin + jitter, 0.0);
  out.velChem = vec4f(aim * speed + motion + vec3f(0.0, arcBoost, 0.0), chemistry);
  out.misc = vec4f(radius, strength, 0.0, life);
  out.flags = vec4f(sourceEmitterIndex, emitter.originActive.w, 0.0, respawnCount);
  return out;
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
      position = position + velocity * params.dt;
      let ground = terrainHeightAt(position.x, position.z) + radius * 0.35;
      if (position.y <= ground) {
        position.y = ground;
        phase = 1.0;
        particle.flags.z = 1.0;
        velocity = slideVelocityOnTerrain(velocity, terrainNormalAt(position.x, position.z), chemistry);
      }
    } else {
      velocity = slideVelocityOnTerrain(velocity, terrainNormalAt(position.x, position.z), chemistry);
      velocity = applyLocalDensityPressure(index, position, velocity, radius, chemistry);
      position = position + velocity * params.dt;
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
struct Particle {
  posPhase: vec4f,
  velChem: vec4f,
  misc: vec4f,
  flags: vec4f,
};

struct RenderParams {
  viewport: vec4f,
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
  let depth = 1.45 + world.z;
  let scale = 390.0 / max(0.42, depth);
  let screen = vec2f(
    width * 0.5 + world.x * scale,
    height * 0.78 - world.z * 122.0 - world.y * scale * 0.52
  );
  let radius = select(4.8, 6.8, phase >= 0.5) + particle.misc.x * 42.0;
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
        cpuOracle: context.cpuOracle || null,
      };
    },
  };
}

export async function createWebGPUFingerJuiceSolver(options = {}) {
  const maxParticles = Math.max(16, Math.floor(options.maxParticles || 900));
  const { data, sources, emitterData } = createInitialWebGPUParticles(options.emitterPacket, {
    maxParticles,
    seed: options.seed || 11,
  });
  const cpuOracleBase = runCpuFingerJuiceOracle(data, {
    steps: options.oracleSteps || 180,
    dt: options.oracleDt || 1 / 60,
    sources,
    emitterPacket: options.emitterPacket || {},
    lerms: options.lerms || [],
    goins: options.goins || [],
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
  const emitterBuffer = device.createBuffer({
    label: 'lerms-finger-juice-emitters',
    size: emitterData.data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const readbackBuffer = device.createBuffer({
    label: 'lerms-finger-juice-particle-readback',
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const paramsBuffer = device.createBuffer({
    label: 'lerms-finger-juice-params',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(particleBuffer, 0, data);
  device.queue.writeBuffer(emitterBuffer, 0, emitterData.data);
  const shaderModule = device.createShaderModule({
    label: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
    code: COMPUTE_SHADER,
  });
  let pipeline;
  try {
    pipeline = await device.createComputePipelineAsync({
      label: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' },
    });
  } catch (error) {
    return unavailableSolver(`WebGPU pipeline validation failed: ${error.message || String(error)}`, { cpuOracle: cpuOracleBase });
  }
  const bindGroup = device.createBindGroup({
    label: 'lerms-finger-juice-bindgroup',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: particleBuffer } },
      { binding: 1, resource: { buffer: paramsBuffer } },
      { binding: 2, resource: { buffer: emitterBuffer } },
    ],
  });
  let stepCount = 0;
  let operationQueue = Promise.resolve();
  function encodeCompute(encoder, safeSteps, safeDt, label = 'lerms-finger-juice-step') {
    const params = new ArrayBuffer(32);
    const paramsView = new DataView(params);
    paramsView.setFloat32(0, safeDt, true);
    paramsView.setUint32(4, maxParticles, true);
    paramsView.setUint32(8, safeSteps, true);
    paramsView.setUint32(12, emitterData.emitterCount, true);
    paramsView.setUint32(16, stepCount, true);
    paramsView.setUint32(20, 0, true);
    paramsView.setUint32(24, 0, true);
    paramsView.setUint32(28, 0, true);
    device.queue.writeBuffer(paramsBuffer, 0, params);
    const pass = encoder.beginComputePass({ label });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(maxParticles / WORKGROUP_SIZE));
    pass.end();
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
        stepCount,
      };
    }
    const encoder = device.createCommandEncoder({ label: 'lerms-finger-juice-step' });
    encodeCompute(encoder, safeSteps, safeDt, LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    stepCount += safeSteps;
    return {
      solver_backend: 'webgpu_compute',
      solverRoute: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
      shaderRoute: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
      emitterBufferRoute: LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE,
      respawnContract: LERMS_FINGER_JUICE_WEBGPU_RESPAWN_CONTRACT,
      stepCount,
    };
  }
  async function runStepAndRead(steps = 1, dt = 1 / 60) {
    const safeSteps = Math.max(0, Math.floor(Number(steps) || 0));
    const safeDt = Math.max(1 / 240, Math.min(1 / 20, finite(dt, 1 / 60)));
    const encoder = device.createCommandEncoder({ label: 'lerms-finger-juice-step-readback' });
    if (safeSteps > 0) {
      encodeCompute(encoder, safeSteps, safeDt, LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE);
    }
    encoder.copyBufferToBuffer(particleBuffer, 0, readbackBuffer, 0, byteLength);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readbackBuffer.getMappedRange()).slice();
    readbackBuffer.unmap();
    stepCount += safeSteps;
    const cpuOracle = runCpuFingerJuiceOracle(data, {
      steps: stepCount,
      dt: safeDt,
      sources,
      emitterPacket: options.emitterPacket || {},
      lerms: options.lerms || [],
      goins: options.goins || [],
    });
    const summary = summarizeWebGPUParticles(result, {
      sources,
      emitterPacket: options.emitterPacket || {},
      stepCount,
      lerms: options.lerms || [],
      goins: options.goins || [],
      solver_backend: 'webgpu_compute',
    });
    return {
      ...summary,
      solver_backend: 'webgpu_compute',
      solverRoute: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
      shaderRoute: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
      emitterBufferRoute: LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE,
      respawnContract: LERMS_FINGER_JUICE_WEBGPU_RESPAWN_CONTRACT,
      adapterInfo,
      workgroupSize: WORKGROUP_SIZE,
      maxParticles,
      stepCount,
      readbackParticleFloats: result.length,
      emitterCount: emitterData.emitterCount,
      cpuOracle: {
        solver_backend: cpuOracle.solver_backend,
        particleCount: cpuOracle.particleCount,
        surfaceFlowCount: cpuOracle.surfaceFlowCount,
        maxRangeZ: cpuOracle.maxRangeZ,
        gpuRespawnCount: cpuOracle.gpuRespawnCount,
      },
    };
  }
  function step(steps = 1, dt = 1 / 60) {
    const run = () => runStep(steps, dt);
    operationQueue = operationQueue.then(run, run);
    return operationQueue;
  }
  function stepAndRead(steps = 1, dt = 1 / 60) {
    const run = () => runStepAndRead(steps, dt);
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
    context.configure({
      device,
      format,
      alphaMode: 'premultiplied',
    });
    const renderParamsBuffer = device.createBuffer({
      label: 'lerms-finger-juice-render-params',
      size: 16,
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
    function render({ width = canvas.clientWidth || 1, height = canvas.clientHeight || 1, pixelRatio = globalThis.devicePixelRatio || 1 } = {}) {
      const cssWidth = Math.max(1, finite(width, 1));
      const cssHeight = Math.max(1, finite(height, 1));
      const ratio = Math.max(1, finite(pixelRatio, 1));
      const targetWidth = Math.max(1, Math.floor(cssWidth * ratio));
      const targetHeight = Math.max(1, Math.floor(cssHeight * ratio));
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
      const params = new Float32Array([cssWidth, cssHeight, ratio, maxParticles]);
      device.queue.writeBuffer(renderParamsBuffer, 0, params);
      const encoder = device.createCommandEncoder({ label: 'lerms-finger-juice-direct-render' });
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
      return {
        render_backend: 'webgpu_direct_render',
        renderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE,
        renderShaderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE,
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
    render_backend: 'webgpu_direct_render',
    renderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE,
    renderShaderRoute: LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE,
    adapterInfo,
    workgroupSize: WORKGROUP_SIZE,
    maxParticles,
    emitterCount: emitterData.emitterCount,
    step,
    stepAndRead,
    createRenderer,
  };
}
