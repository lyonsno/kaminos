export const LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE = 'webgpu_particle_solver_v0';
export const LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE = 'wgsl-ballistic-heightfield-surface-v0';

const PARTICLE_FLOATS = 16;
const WORKGROUP_SIZE = 64;

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

function makeRng(seed = 1) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
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
  buffer[offset + 13] = 1;
  buffer[offset + 14] = particle.impacted ? 1 : 0;
  buffer[offset + 15] = 0;
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
  };
}

export function createInitialWebGPUParticles(emitterPacket, options = {}) {
  const maxParticles = Math.max(16, Math.floor(options.maxParticles || 900));
  const seed = options.seed || 11;
  const rng = makeRng(seed);
  const data = new Float32Array(maxParticles * PARTICLE_FLOATS);
  const sources = [];
  const activeEmitters = (emitterPacket.emitters || []).filter(emitter => emitter.active);
  for (let i = 0; i < maxParticles; i += 1) {
    const emitter = activeEmitters[i % Math.max(1, activeEmitters.length)];
    if (!emitter) continue;
    const radius = finite(emitter.radius, 0.045);
    const jitter = [(rng() - 0.5) * radius, (rng() - 0.5) * radius, (rng() - 0.5) * radius];
    const origin = vec3(emitter.origin_world, [0, 0.36, -0.84]);
    const start = add(origin, jitter);
    const aim = normalize3(emitter.aim_world, [0, 0.34, 0.94]);
    const motion = vec3(emitter.motion_world, [0, 0, 0]);
    const arcBoost = 0.42 + Math.max(0, aim[1]) * 1.6;
    const speed = (emitter.emission_state === 'jet' ? 2.15 : 1.18) * (0.35 + finite(emitter.strength, 1) * 0.65);
    const velocity = add(add(mul(aim, speed), motion), [0, arcBoost, 0]);
    const emitterIndex = Math.max(0, (emitterPacket.emitters || []).findIndex(item => item.id === emitter.id));
    writeParticle(data, i, {
      position: start,
      phase: 0,
      velocity,
      chemistry: chemistryCode(emitter.chemistry),
      radius,
      strength: finite(emitter.strength, 1),
      age: (i % 18) * -0.012,
      life: emitter.chemistry === 'pooling' ? 8.0 : 7.2,
      emitterIndex,
      impacted: false,
    });
    sources.push({ emitterIndex, emitter_id: emitter.id, chemistry: emitter.chemistry, position: start, velocity });
  }
  return { data, sources, maxParticles };
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
      if (particle.age >= particle.life) particle.age = particle.life - dt;
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
    lerms: options.lerms || [],
    goins: options.goins || [],
    solver_backend: 'cpu_oracle',
  });
}

function targetHits(particles, targets, kind) {
  let count = 0;
  const out = targets.map(target => ({ ...target, hits: 0, impulse: [0, 0, 0] }));
  for (const particle of particles) {
    for (const target of out) {
      const delta = sub(vec3(target.position), particle.position);
      const distance = length3(delta);
      if (distance <= finite(target.radius, kind === 'goin' ? 0.13 : 0.16) + particle.radius) {
        target.hits += 1;
        count += 1;
      }
    }
  }
  return { count, targets: out };
}

export function summarizeWebGPUParticles(buffer, options = {}) {
  const particles = [];
  for (let i = 0; i < buffer.length / PARTICLE_FLOATS; i += 1) {
    const particle = readParticle(buffer, i);
    if (!particle.active || particle.age < 0 || particle.age >= particle.life) continue;
    particles.push({
      id: `wgpu-${i}`,
      emitter_id: options.sources?.find(source => source.emitterIndex === particle.emitterIndex)?.emitter_id || `emitter-${particle.emitterIndex}`,
      chemistry: particle.chemistry === 2 ? 'pooling' : particle.chemistry === 3 ? 'weird' : 'knockback',
      phase: particle.phase >= 0.5 ? 'surface_flow' : 'airborne',
      surface_flow: particle.phase >= 0.5,
      pooling: particle.chemistry === 2 && particle.phase >= 0.5,
      position: particle.position.map(value => round(value, 4)),
      velocity: particle.velocity.map(value => round(value, 4)),
      radius: round(particle.radius, 4),
      strength: round(particle.strength, 4),
      emitterIndex: particle.emitterIndex,
      impacted: particle.impacted,
    });
  }
  const lermHits = targetHits(particles, options.lerms || [], 'lerm');
  const goinHits = targetHits(particles, options.goins || [], 'goin');
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
  return {
    solver_backend: options.solver_backend || 'webgpu_compute',
    solverRoute: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
    shaderRoute: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
    particleCount: particles.length,
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

struct Params {
  dt: f32,
  particleCount: u32,
  steps: u32,
  pad: u32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: Params;

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
    let chemistry = particle.velChem.w;
    let radius = particle.misc.x;
    var age = particle.misc.z + params.dt;
    let life = particle.misc.w;
    if (age < 0.0) {
      particle.misc.z = age;
      continue;
    }
    if (age >= life) {
      age = life - params.dt;
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
  const { data, sources } = createInitialWebGPUParticles(options.emitterPacket, {
    maxParticles,
    seed: options.seed || 11,
  });
  const cpuOracleBase = runCpuFingerJuiceOracle(data, {
    steps: options.oracleSteps || 180,
    dt: options.oracleDt || 1 / 60,
    sources,
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
  const readbackBuffer = device.createBuffer({
    label: 'lerms-finger-juice-particle-readback',
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const paramsBuffer = device.createBuffer({
    label: 'lerms-finger-juice-params',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(particleBuffer, 0, data);
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
    ],
  });
  let stepCount = 0;
  async function stepAndRead(steps = 1, dt = 1 / 60) {
    const safeSteps = Math.max(0, Math.min(720, Math.floor(Number(steps) || 0)));
    const safeDt = Math.max(1 / 240, Math.min(1 / 20, finite(dt, 1 / 60)));
    const params = new ArrayBuffer(16);
    const paramsView = new DataView(params);
    paramsView.setFloat32(0, safeDt, true);
    paramsView.setUint32(4, maxParticles, true);
    paramsView.setUint32(8, safeSteps, true);
    paramsView.setUint32(12, 0, true);
    device.queue.writeBuffer(paramsBuffer, 0, params);
    const encoder = device.createCommandEncoder({ label: 'lerms-finger-juice-step-readback' });
    const pass = encoder.beginComputePass({ label: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(maxParticles / WORKGROUP_SIZE));
    pass.end();
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
      lerms: options.lerms || [],
      goins: options.goins || [],
    });
    const summary = summarizeWebGPUParticles(result, {
      sources,
      lerms: options.lerms || [],
      goins: options.goins || [],
      solver_backend: 'webgpu_compute',
    });
    return {
      ...summary,
      solver_backend: 'webgpu_compute',
      solverRoute: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
      shaderRoute: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
      adapterInfo,
      workgroupSize: WORKGROUP_SIZE,
      maxParticles,
      stepCount,
      readbackParticleFloats: result.length,
      cpuOracle: {
        solver_backend: cpuOracle.solver_backend,
        particleCount: cpuOracle.particleCount,
        surfaceFlowCount: cpuOracle.surfaceFlowCount,
        maxRangeZ: cpuOracle.maxRangeZ,
      },
    };
  }
  return {
    solver_backend: 'webgpu_compute',
    solverRoute: LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE,
    shaderRoute: LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE,
    adapterInfo,
    workgroupSize: WORKGROUP_SIZE,
    maxParticles,
    stepAndRead,
  };
}
