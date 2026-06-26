export const LERMS_WORLD_FINGER_JUICE_EMITTERS_SCHEMA = 'lerms.world-finger-juice-emitters.v0';
export const LERMS_WORLD_FINGER_JUICE_ROUTE = 'world-space-ballistic-surface-flow-particles-v0';
export const LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT = 'hill-of-hills-heightfield-collision-v0';
export const LERMS_WORLD_FINGER_JUICE_ARC_CONTRACT = 'finger-aim-ballistic-arc-range-v0';

const DEFAULT_FINGER_IDS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const DEFAULT_CHEMISTRY = {
  thumb: 'splash',
  index: 'knockback',
  middle: 'pooling',
  ring: 'weird',
  pinky: 'weird',
};
const DEFAULT_TIP_INDEX = {
  thumb: 4,
  index: 8,
  middle: 12,
  ring: 16,
  pinky: 20,
};

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
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

function axisVec3(value) {
  const out = value.map(component => round(component, 4));
  out.x = out[0];
  out.y = out[1];
  out.z = out[2];
  return out;
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
  const viscosity = chemistry === 'pooling' ? 0.66 : chemistry === 'weird' ? 0.77 : 0.84;
  const downhill = normalize3([normal[0], 0, normal[2]], [0, 0, 1]);
  return add(mul(tangent, viscosity), mul(downhill, chemistry === 'pooling' ? 0.1 : 0.04));
}

function normalizeEmitter(raw = {}, index = 0) {
  const id = String(raw.id || DEFAULT_FINGER_IDS[index] || `finger-${index}`);
  const aim = normalize3(raw.aim_world || raw.aimWorld || raw.aim, [0, 0.34, 0.94]);
  const chemistry = String(raw.chemistry || DEFAULT_CHEMISTRY[id] || 'knockback');
  const extension = clamp(raw.extension ?? 1, 0, 1);
  const stale = Boolean(raw.stale_visual_only || raw.visual_only || raw.staleVisualOnly);
  const active = raw.active !== false && extension > 0.08 && !stale;
  const strength = clamp(raw.strength ?? raw.dye_strength ?? 1, 0, 4);
  return {
    id,
    tip_index: Math.round(finite(raw.tip_index ?? raw.tipIndex, DEFAULT_TIP_INDEX[id] ?? index)),
    origin_world: vec3(raw.origin_world || raw.originWorld || raw.origin, [index * 0.08 - 0.16, 0.34, -0.82]),
    aim_world: axisVec3(aim),
    motion_world: vec3(raw.motion_world || raw.motionWorld || raw.motion, [0, 0, 0]).map(value => round(value, 4)),
    extension: round(extension, 4),
    emission_state: String(raw.emission_state || raw.emissionState || (extension > 0.72 ? 'jet' : extension > 0.28 ? 'dribble' : 'off')),
    chemistry,
    radius: round(clamp(raw.radius ?? 0.045, 0.01, 0.18), 4),
    strength: round(strength, 4),
    active,
    stale_visual_only: stale,
  };
}

export function normalizeWorldFingerJuiceEmitterPacket(packet = {}) {
  const emitters = (Array.isArray(packet) ? packet : packet.emitters || [])
    .slice(0, 5)
    .map(normalizeEmitter);
  while (emitters.length < 5) emitters.push(normalizeEmitter({ active: false, extension: 0 }, emitters.length));
  const stale = Boolean(packet.stale_visual_only || packet.visual_only || packet.authority?.stale_visual_only);
  return {
    schema: LERMS_WORLD_FINGER_JUICE_EMITTERS_SCHEMA,
    source_backend: String(packet.source_backend || packet.sourceBackend || 'unknown'),
    sample_age_ms: Math.max(0, finite(packet.sample_age_ms ?? packet.sampleAgeMs, 0)),
    timestamp_ms: finite(packet.timestamp_ms ?? packet.timestampMs ?? Date.now(), Date.now()),
    route_identity: packet.route_identity || packet.routeIdentity || null,
    terrain_frame: {
      id: packet.terrain_frame?.id || packet.terrainFrame?.id || 'kaminos-hill-of-hills-local-v0',
      units: packet.terrain_frame?.units || packet.terrainFrame?.units || 'normalized_world',
      height_contract: LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT,
    },
    authority: {
      stale_visual_only: stale,
      simulation_safe: !stale,
    },
    active_emitter_count: emitters.filter(emitter => emitter.active).length,
    emitters,
  };
}

function makeRng(seed = 1) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export function createWorldFingerJuiceTransportPrototype(options = {}) {
  const maxParticles = Math.max(16, Math.floor(options.maxParticles || 768));
  const rng = makeRng(options.seed || 1);
  let emitters = normalizeWorldFingerJuiceEmitterPacket();
  let particles = [];
  const lerms = (options.lerms || []).map(target => ({ ...target, impulse: [0, 0, 0], hits: 0 }));
  const goins = (options.goins || []).map(target => ({ ...target, impulse: [0, 0, 0], hits: 0 }));
  let stepCount = 0;
  let lermImpulseCount = 0;
  let goinImpulseCount = 0;
  let maxRangeZ = 0;
  let eventLog = [];

  function spawnParticles(dt) {
    if (!emitters.authority.simulation_safe) return;
    for (const emitter of emitters.emitters) {
      if (!emitter.active || emitter.emission_state === 'off') continue;
      const rate = emitter.emission_state === 'jet' ? 4 : 2;
      for (let i = 0; i < rate && particles.length < maxParticles; i += 1) {
        const jitter = [(rng() - 0.5) * emitter.radius, (rng() - 0.5) * emitter.radius, (rng() - 0.5) * emitter.radius];
        const aim = normalize3(emitter.aim_world);
        const motion = vec3(emitter.motion_world);
        const arcBoost = 0.42 + Math.max(0, aim[1]) * 1.6;
        const speed = (emitter.emission_state === 'jet' ? 2.15 : 1.18) * (0.35 + emitter.strength * 0.65);
        const velocity = add(add(mul(aim, speed), motion), [0, arcBoost, 0]);
        const particle = {
          id: `fj-${stepCount}-${particles.length}-${i}`,
          emitter_id: emitter.id,
          chemistry: emitter.chemistry,
          radius: emitter.radius,
          strength: emitter.strength,
          age: 0,
          life: emitter.chemistry === 'pooling' ? 2.9 : 2.15,
          phase: 'airborne',
          position: add(emitter.origin_world, jitter),
          velocity,
          surface_flow: false,
          pooling: false,
          hitTargets: new Set(),
        };
        particles.push(particle);
      }
    }
  }

  function applyTargetImpulses(particle) {
    for (const target of lerms) {
      const position = vec3(target.position);
      const delta = sub(position, particle.position);
      const distance = length3(delta);
      const radius = finite(target.radius, 0.16) + particle.radius;
      if (distance > radius) continue;
      const hitKey = `lerm:${target.id}`;
      if (particle.hitTargets?.has(hitKey)) continue;
      particle.hitTargets?.add(hitKey);
      const direction = normalize3(sub(particle.position, position), [0, 0, -1]);
      const impulse = mul(direction, particle.strength * (particle.chemistry === 'knockback' ? 1.2 : 0.54));
      target.impulse = add(target.impulse, impulse);
      target.hits += 1;
      lermImpulseCount += 1;
      eventLog.push({ type: 'lerm_impulse', id: target.id, emitter_id: particle.emitter_id, impulse: impulse.map(value => round(value, 3)) });
    }
    for (const target of goins) {
      const position = vec3(target.position);
      const delta = sub(position, particle.position);
      const distance = length3(delta);
      const radius = finite(target.radius, 0.13) + particle.radius;
      if (distance > radius) continue;
      const hitKey = `goin:${target.id}`;
      if (particle.hitTargets?.has(hitKey)) continue;
      particle.hitTargets?.add(hitKey);
      const direction = normalize3(sub(particle.position, position), [0, 0, -1]);
      const impulse = mul(direction, particle.strength * (particle.chemistry === 'pooling' ? 0.42 : 0.72));
      target.impulse = add(target.impulse, impulse);
      target.hits += 1;
      goinImpulseCount += 1;
      eventLog.push({ type: 'goin_impulse', id: target.id, emitter_id: particle.emitter_id, impulse: impulse.map(value => round(value, 3)) });
    }
    if (eventLog.length > 32) eventLog = eventLog.slice(-32);
  }

  function step(dt = 1 / 60) {
    const safeDt = clamp(dt, 1 / 240, 1 / 20);
    stepCount += 1;
    spawnParticles(safeDt);
    const next = [];
    for (const particle of particles) {
      particle.age += safeDt;
      if (particle.age >= particle.life) continue;
      const terrain = terrainHeightAt(particle.position[0], particle.position[2]);
      if (particle.phase === 'airborne') {
        particle.velocity[1] -= 5.2 * safeDt;
        particle.position = add(particle.position, mul(particle.velocity, safeDt));
        const ground = terrainHeightAt(particle.position[0], particle.position[2]) + particle.radius * 0.35;
        if (particle.position[1] <= ground) {
          particle.position[1] = ground;
          particle.phase = 'surface_flow';
          particle.surface_flow = true;
          particle.velocity = slideVelocityOnTerrain(particle.velocity, terrainNormalAt(particle.position[0], particle.position[2]), particle.chemistry);
        }
      } else {
        particle.surface_flow = true;
        particle.pooling = particle.chemistry === 'pooling' || length3(particle.velocity) < 0.18;
        particle.velocity = slideVelocityOnTerrain(particle.velocity, terrainNormalAt(particle.position[0], particle.position[2]), particle.chemistry);
        particle.position = add(particle.position, mul(particle.velocity, safeDt));
        particle.position[1] = terrainHeightAt(particle.position[0], particle.position[2]) + particle.radius * 0.25;
      }
      maxRangeZ = Math.max(maxRangeZ, particle.position[2] + 0.82);
      applyTargetImpulses(particle);
      next.push(particle);
    }
    particles = next.slice(-maxParticles);
    return debugState();
  }

  function debugState() {
    const airborneCount = particles.filter(particle => particle.phase === 'airborne').length;
    const surfaceFlowCount = particles.filter(particle => particle.surface_flow).length;
    const poolingCount = particles.filter(particle => particle.pooling || particle.chemistry === 'pooling' && particle.surface_flow).length;
    return {
      schema: 'lerms.world-finger-juice-debug.v0',
      effectiveRoute: LERMS_WORLD_FINGER_JUICE_ROUTE,
      emitterSchema: LERMS_WORLD_FINGER_JUICE_EMITTERS_SCHEMA,
      terrainContract: LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT,
      arcContract: LERMS_WORLD_FINGER_JUICE_ARC_CONTRACT,
      stepCount,
      particleCount: particles.length,
      airborneCount,
      surfaceFlowCount,
      poolingCount,
      lermImpulseCount,
      goinImpulseCount,
      maxRangeZ: round(maxRangeZ, 4),
      terrain_frame: emitters.terrain_frame,
      authority: emitters.authority,
      activeEmitterCount: emitters.active_emitter_count,
      heightfieldSamples: [-0.75, -0.35, 0, 0.35, 0.75].map(x => ({ x, z: 0, y: round(terrainHeightAt(x, 0), 4) })),
      particles: particles.slice(0, 96).map(particle => ({
        id: particle.id,
        emitter_id: particle.emitter_id,
        chemistry: particle.chemistry,
        phase: particle.phase,
        surface_flow: particle.surface_flow,
        pooling: particle.pooling,
        position: particle.position.map(value => round(value, 4)),
        velocity: particle.velocity.map(value => round(value, 4)),
      })),
      targets: {
        lerms: lerms.map(target => ({
          id: target.id,
          position: vec3(target.position).map(value => round(value, 4)),
          radius: round(target.radius ?? 0.16, 4),
          hits: target.hits,
          impulse: target.impulse.map(value => round(value, 4)),
        })),
        goins: goins.map(target => ({
          id: target.id,
          position: vec3(target.position).map(value => round(value, 4)),
          radius: round(target.radius ?? 0.13, 4),
          hits: target.hits,
          impulse: target.impulse.map(value => round(value, 4)),
        })),
      },
      recentEvents: eventLog.slice(-12),
    };
  }

  return {
    setEmitters(packet) {
      emitters = normalizeWorldFingerJuiceEmitterPacket(packet);
      return emitters;
    },
    step,
    debugState,
    terrainHeightAt,
  };
}
