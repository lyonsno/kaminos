import {
  COMBUSTIBLE_OBJECT_FIRE_FIXED_POINT_SCALE,
  COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES,
  COMBUSTIBLE_OBJECT_SOURCE_MAGIC,
  COMBUSTIBLE_OBJECT_SOURCE_RECORD_BYTES,
  COMBUSTIBLE_OBJECT_SOURCE_VERSION,
} from './combustible-object-fire-gpu.mjs';

export const GPU_COMBUSTIBLE_OBJECT_LOOP_SCHEMA = 'kaminos.gpu-combustible-object-loop.v0';
export const GPU_COMBUSTIBLE_OBJECT_LOOP_AUTHORITY = 'same-device-pyro-material-emission-mechanics-v0';
export const GPU_COMBUSTIBLE_OBJECT_TERMINAL_SCHEMA = 'kaminos.gpu-combustible-object-terminal-receipt.v0';

const MATERIAL_RECORD_BYTES = 128;
const MATERIAL_COUNT = 3;
const EVENT_CAPACITY = 64;
const EVENT_HEADER_BYTES = 16;
const EVENT_RECORD_BYTES = 32;
const EVENT_BUFFER_BYTES = EVENT_HEADER_BYTES + EVENT_CAPACITY * EVENT_RECORD_BYTES;
const PARAMS_BYTES = 64;
const SOURCE_FRAME_HASH = 0x4750554f;
const REQUIRED_VERDICT_BITS = 0x1ff;

const OBJECT_DONOR = 1;
const OBJECT_TARGET = 2;
const OBJECT_CONTROL = 3;
const EVENT_DONOR_ACTIVE = 1;
const EVENT_TARGET_EXPOSED = 2;
const EVENT_TARGET_IGNITED = 3;
const EVENT_TARGET_EMITTED = 4;
const EVENT_TARGET_SUPPORT_LOST = 5;
const EVENT_TARGET_IMPACTED = 6;

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return number;
}

function makeInitialMaterials() {
  const bytes = new ArrayBuffer(MATERIAL_COUNT * MATERIAL_RECORD_BYTES);
  const view = new DataView(bytes);
  const objects = [
    {
      id: OBJECT_DONOR,
      phase: 1,
      flags: 2,
      probe: [0.37, 0.42, 0.50, 0.055],
      thermal: [1.0, 1.0, 0.0, 1.0],
      screen: [-0.46, 0.27, 0.25, 0.043],
      color: [0.66, 0.29, 0.09, 1.0],
    },
    {
      id: OBJECT_TARGET,
      phase: 0,
      flags: 0,
      probe: [0.46, 0.47, 0.50, 0.065],
      thermal: [0.08, 1.0, 0.0, 1.0],
      screen: [-0.06, -0.18, 0.31, 0.050],
      color: [0.72, 0.39, 0.15, 1.0],
    },
    {
      id: OBJECT_CONTROL,
      phase: 0,
      flags: 1,
      probe: [0.82, 0.76, 0.50, 0.050],
      thermal: [0.08, 1.0, 0.0, 1.0],
      screen: [0.46, 0.31, 0.25, 0.043],
      color: [0.55, 0.43, 0.23, 1.0],
    },
  ];
  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index];
    const base = index * MATERIAL_RECORD_BYTES;
    view.setUint32(base, object.id, true);
    view.setUint32(base + 4, 1, true);
    view.setUint32(base + 8, object.phase, true);
    view.setUint32(base + 12, object.flags, true);
    object.probe.forEach((value, offset) => view.setFloat32(base + 16 + offset * 4, value, true));
    object.thermal.forEach((value, offset) => view.setFloat32(base + 32 + offset * 4, value, true));
    object.screen.forEach((value, offset) => view.setFloat32(base + 96 + offset * 4, value, true));
    object.color.forEach((value, offset) => view.setFloat32(base + 112 + offset * 4, value, true));
  }
  return bytes;
}

function createSimulationShader(gridSize) {
  return /* wgsl */`
const GRID: u32 = ${gridSize}u;
const MATERIAL_COUNT: u32 = ${MATERIAL_COUNT}u;
const EVENT_CAPACITY: u32 = ${EVENT_CAPACITY}u;
const SOURCE_MAGIC: u32 = ${COMBUSTIBLE_OBJECT_SOURCE_MAGIC}u;
const SOURCE_VERSION: u32 = ${COMBUSTIBLE_OBJECT_SOURCE_VERSION}u;

struct MaterialState {
  identity: vec4<u32>,
  probe: vec4<f32>,
  thermal: vec4<f32>,
  rates: vec4<f32>,
  motion: vec4<f32>,
  events: vec4<u32>,
  screen: vec4<f32>,
  color: vec4<f32>,
};

struct SourceRecord {
  localPositionRadius: vec4<f32>,
  localNormalExtent: vec4<f32>,
  velocityAngular: vec4<f32>,
  emission: vec4<f32>,
  material: vec4<f32>,
  sourceGenerationEpochTick: vec4<f32>,
  support: vec4<f32>,
  reserved: vec4<f32>,
};

struct EventRecord {
  kind: u32,
  objectId: u32,
  sourceStep: u32,
  sequence: u32,
  value: f32,
  phase: u32,
  sourceGeneration: u32,
  reserved: u32,
};

struct EventLog {
  count: atomic<u32>,
  overflow: atomic<u32>,
  verdict: atomic<u32>,
  step: atomic<u32>,
  records: array<EventRecord, ${EVENT_CAPACITY}>,
};

struct Params {
  identity: vec4<u32>,
  thermal: vec4<f32>,
  support: vec4<f32>,
  emission: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> fluid: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> materials: array<MaterialState>;
@group(0) @binding(2) var<storage, read_write> sourceHeader: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> sourceRecords: array<SourceRecord>;
@group(0) @binding(4) var<storage, read_write> eventLog: EventLog;
@group(0) @binding(5) var<uniform> params: Params;

fn appendEvent(kind: u32, objectId: u32, step: u32, value: f32, phase: u32) {
  let sequence = atomicAdd(&eventLog.count, 1u);
  if (sequence >= EVENT_CAPACITY) {
    atomicStore(&eventLog.overflow, 1u);
    return;
  }
  eventLog.records[sequence] = EventRecord(
    kind, objectId, step, sequence, value, phase, params.identity.x, 0u
  );
}

fn sampleExposure(probe: vec4<f32>) -> f32 {
  let center = min(vec3<u32>(probe.xyz * f32(GRID)), vec3<u32>(GRID - 1u));
  let cellRadius = max(1u, u32(ceil(probe.w * f32(GRID))));
  let lower = vec3<u32>(
    select(center.x - cellRadius, 0u, center.x < cellRadius),
    select(center.y - cellRadius, 0u, center.y < cellRadius),
    select(center.z - cellRadius, 0u, center.z < cellRadius)
  );
  let upper = min(center + vec3<u32>(cellRadius), vec3<u32>(GRID - 1u));
  var exposure = 0.0;
  var samples = 0.0;
  for (var z = lower.z; z <= upper.z; z += 1u) {
    for (var y = lower.y; y <= upper.y; y += 1u) {
      for (var x = lower.x; x <= upper.x; x += 1u) {
        let cellIndex = x + y * GRID + z * GRID * GRID;
        let base = cellIndex * 4u;
        exposure += max(0.0, fluid[base + 1u].y) + max(0.0, fluid[base + 2u].x) * 0.20;
        samples += 1.0;
      }
    }
  }
  return exposure / max(samples, 1.0);
}

@compute @workgroup_size(1)
fn clearSource() {
  let step = atomicAdd(&eventLog.step, 1u) + 1u;
  atomicStore(&sourceHeader[0], SOURCE_MAGIC);
  atomicStore(&sourceHeader[1], SOURCE_VERSION);
  atomicStore(&sourceHeader[2], params.identity.x);
  atomicStore(&sourceHeader[3], params.identity.y);
  atomicStore(&sourceHeader[4], step);
  atomicStore(&sourceHeader[5], 0u);
  atomicStore(&sourceHeader[6], 0u);
  atomicStore(&sourceHeader[7], params.identity.z);
  atomicStore(&sourceHeader[8], 0u);
  atomicStore(&sourceHeader[9], 0u);
  atomicStore(&sourceHeader[10], 0u);
  atomicStore(&sourceHeader[11], 0u);
  atomicStore(&sourceHeader[12], 0u);
  atomicStore(&sourceHeader[13], 32u);
  atomicStore(&sourceHeader[14], 0u);
  atomicStore(&sourceHeader[15], 0u);
  atomicStore(&sourceHeader[16], 0u);
  atomicStore(&sourceHeader[17], 0u);
  atomicStore(&sourceHeader[18], step);
  atomicStore(&sourceHeader[19], 0u);
}

@compute @workgroup_size(1)
fn updateMaterial(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= MATERIAL_COUNT) { return; }
  let step = atomicLoad(&eventLog.step);
  var state = materials[index];
  let objectId = state.identity.x;
  let isControl = (state.identity.w & 1u) != 0u;
  let isSeededDonor = (state.identity.w & 2u) != 0u;
  var phase = state.identity.z;
  var temperature = state.thermal.x;
  var fuel = state.thermal.y;
  var charMass = state.thermal.z;
  var support = state.thermal.w;
  let exposure = sampleExposure(state.probe);

  if (isSeededDonor) {
    temperature = max(temperature, 0.92);
    if (step == 1u) {
      appendEvent(${EVENT_DONOR_ACTIVE}u, objectId, step, temperature, phase);
      atomicOr(&eventLog.verdict, 1u);
    }
  } else if (phase == 0u) {
    temperature = clamp(
      temperature + exposure * params.thermal.x - max(0.0, temperature - 0.08) * params.thermal.y,
      0.08,
      2.0
    );
    if (!isControl && exposure > 0.01 && state.events.w == 0u) {
      state.events.w = step;
      appendEvent(${EVENT_TARGET_EXPOSED}u, objectId, step, exposure, phase);
      atomicOr(&eventLog.verdict, 2u);
    }
    if (temperature >= params.thermal.z) {
      if (isControl) {
        atomicOr(&eventLog.verdict, 0x80000000u);
      } else {
        phase = 1u;
        state.events.x = step;
        appendEvent(${EVENT_TARGET_IGNITED}u, objectId, step, temperature, phase);
        atomicOr(&eventLog.verdict, 4u);
      }
    }
  }

  if (phase >= 1u && fuel > 0.0) {
    fuel = max(0.0, fuel - params.thermal.w);
    charMass = 1.0 - fuel;
    if (!isSeededDonor) {
      support = fuel;
      if (state.rates.y == 0.0) {
        appendEvent(${EVENT_TARGET_EMITTED}u, objectId, step, temperature, phase);
        atomicOr(&eventLog.verdict, 8u);
      }
      if (support < params.support.x && phase == 1u) {
        phase = 2u;
        state.events.y = step;
        appendEvent(${EVENT_TARGET_SUPPORT_LOST}u, objectId, step, support, phase);
        atomicOr(&eventLog.verdict, 16u);
      }
    }
    let sourceIndex = atomicAdd(&sourceHeader[9], 1u);
    if (sourceIndex < ${MATERIAL_COUNT}u) {
      var position = state.probe.xyz;
      if (!isSeededDonor) {
        position.x += sin(state.motion.x) * 0.045;
        position.y = max(0.05, position.y - state.motion.z * 0.32);
      }
      let emission = params.emission * vec4<f32>(0.55 + temperature, 1.0, 1.0, 1.0);
      sourceRecords[sourceIndex] = SourceRecord(
        vec4<f32>(position, state.probe.w),
        vec4<f32>(0.0, 1.0, 0.0, 0.12),
        vec4<f32>(0.0, -state.motion.w, 0.0, state.motion.y),
        emission,
        vec4<f32>(temperature, fuel, charMass, support),
        vec4<f32>(f32(params.identity.x), f32(params.identity.y), f32(step), f32(objectId)),
        vec4<f32>(support, params.support.x, state.motion.x, state.motion.z),
        vec4<f32>(0.0)
      );
      state.rates.x = exposure;
      state.rates.y += emission.x;
      state.rates.z += emission.y;
      state.rates.w += emission.z;
    } else {
      atomicAdd(&sourceHeader[11], 1u);
      atomicStore(&eventLog.overflow, 1u);
    }
  }

  if (phase >= 2u && phase < 3u) {
    state.motion.y += params.support.z;
    state.motion.x += state.motion.y;
    state.motion.w += params.support.y;
    state.motion.z += state.motion.w;
    if (state.motion.z >= params.support.w) {
      phase = 3u;
      state.events.z = step;
      appendEvent(${EVENT_TARGET_IMPACTED}u, objectId, step, state.motion.z, phase);
      atomicOr(&eventLog.verdict, 32u);
    }
  }

  if (isControl && phase == 0u) {
    atomicOr(&eventLog.verdict, 64u);
  }
  if (objectId == ${OBJECT_TARGET}u && (state.identity.w & 4u) == 0u) {
    atomicOr(&eventLog.verdict, 256u);
  }
  state.identity.z = phase;
  state.thermal = vec4<f32>(temperature, fuel, charMass, support);
  materials[index] = state;
}

@compute @workgroup_size(1)
fn finalizeSource() {
  let packed = atomicLoad(&sourceHeader[9]);
  let rejected = atomicLoad(&sourceHeader[10]);
  let overflow = atomicLoad(&sourceHeader[11]);
  atomicStore(&sourceHeader[8], packed + rejected + overflow);
  atomicStore(&sourceHeader[5], select(1u, 0u, overflow > 0u));
  atomicStore(&sourceHeader[6], select(1u, 0u, overflow > 0u));
  if (overflow > 0u || atomicLoad(&eventLog.overflow) > 0u) {
    atomicOr(&eventLog.verdict, 0x80000000u);
  }
  let verdict = atomicLoad(&eventLog.verdict);
  if ((verdict & 0x7fu) == 0x7fu) {
    atomicOr(&eventLog.verdict, 128u);
  }
}
`;
}

const PRESENTATION_WGSL = /* wgsl */`
struct MaterialState {
  identity: vec4<u32>,
  probe: vec4<f32>,
  thermal: vec4<f32>,
  rates: vec4<f32>,
  motion: vec4<f32>,
  events: vec4<u32>,
  screen: vec4<f32>,
  color: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) local: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> materials: array<MaterialState>;

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
  );
  let state = materials[instanceIndex];
  let local = corners[vertexIndex];
  let scaled = local * state.screen.zw;
  let c = cos(-state.motion.x);
  let s = sin(-state.motion.x);
  let rotated = vec2<f32>(c * scaled.x - s * scaled.y, s * scaled.x + c * scaled.y);
  let center = state.screen.xy - vec2<f32>(0.0, state.motion.z * 0.72);
  let charMix = clamp(state.thermal.z * 1.15, 0.0, 0.90);
  let burning = select(0.0, 1.0, state.identity.z >= 1u && state.thermal.y > 0.0);
  let base = mix(state.color.rgb, vec3<f32>(0.055, 0.036, 0.024), charMix);
  let hot = vec3<f32>(1.0, 0.31, 0.055) * burning * (1.0 - charMix) * 0.20;
  var output: VertexOutput;
  output.position = vec4<f32>(center + rotated, 0.0, 1.0);
  output.color = vec4<f32>(base + hot, 0.98);
  output.local = local;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let edge = max(abs(input.local.x), abs(input.local.y));
  let bevel = 1.0 - smoothstep(0.82, 1.0, edge) * 0.24;
  return vec4<f32>(input.color.rgb * bevel, input.color.a);
}
`;

function decodeMaterial(view, index) {
  const base = index * MATERIAL_RECORD_BYTES;
  const u32 = offset => view.getUint32(base + offset, true);
  const f32 = offset => view.getFloat32(base + offset, true);
  return {
    objectId: u32(0),
    generation: u32(4),
    phase: u32(8),
    flags: u32(12),
    probe: [f32(16), f32(20), f32(24), f32(28)],
    temperature: f32(32),
    remainingFuel: f32(36),
    charMass: f32(40),
    supportCapacity: f32(44),
    exposure: f32(48),
    emittedHeat: f32(52),
    emittedFuel: f32(56),
    emittedSoot: f32(60),
    angleRad: f32(64),
    angularVelocity: f32(68),
    verticalDrop: f32(72),
    verticalVelocity: f32(76),
    ignitionStep: u32(80),
    supportLossStep: u32(84),
    impactStep: u32(88),
    firstExposureStep: u32(92),
  };
}

function decodeEvents(view) {
  const count = Math.min(view.getUint32(0, true), EVENT_CAPACITY);
  const events = [];
  for (let index = 0; index < count; index += 1) {
    const base = EVENT_HEADER_BYTES + index * EVENT_RECORD_BYTES;
    events.push({
      kind: view.getUint32(base, true),
      objectId: view.getUint32(base + 4, true),
      sourceStep: view.getUint32(base + 8, true),
      sequence: view.getUint32(base + 12, true),
      value: view.getFloat32(base + 16, true),
      phase: view.getUint32(base + 20, true),
      sourceGeneration: view.getUint32(base + 24, true),
    });
  }
  return {
    count,
    overflow: view.getUint32(4, true),
    verdictBits: view.getUint32(8, true),
    sourceStep: view.getUint32(12, true),
    events,
  };
}

export function validateGpuCombustibleObjectTerminalReceipt(receipt) {
  if (receipt?.schema !== GPU_COMBUSTIBLE_OBJECT_TERMINAL_SCHEMA) throw new Error('GPU combustible terminal schema mismatch');
  if (receipt.authority !== GPU_COMBUSTIBLE_OBJECT_LOOP_AUTHORITY) throw new Error('GPU combustible terminal authority mismatch');
  if (receipt.status !== 'frozen-terminal-readback') throw new Error('GPU combustible receipt is not terminal and frozen');
  if (receipt.hostCausalFeedbackCount !== 0) throw new Error('GPU combustible loop contains host causal feedback');
  if (receipt.runtimeReadbackCount !== 1) throw new Error('GPU combustible loop must have exactly one terminal readback');
  if (receipt.eventLog?.overflow !== 0 || receipt.sourceHeader?.overflowCount !== 0) throw new Error('GPU combustible loop overflowed');
  if ((receipt.eventLog.verdictBits & REQUIRED_VERDICT_BITS) !== REQUIRED_VERDICT_BITS) {
    throw new Error(`GPU combustible verdict incomplete: 0x${receipt.eventLog.verdictBits.toString(16)}`);
  }
  if ((receipt.eventLog.verdictBits & 0x80000000) !== 0) throw new Error('GPU combustible verdict contains an invalid-state bit');
  const donor = receipt.materials.find(material => material.objectId === OBJECT_DONOR);
  const target = receipt.materials.find(material => material.objectId === OBJECT_TARGET);
  const control = receipt.materials.find(material => material.objectId === OBJECT_CONTROL);
  if (!donor || !target || !control) throw new Error('GPU combustible terminal material identities are incomplete');
  if ((target.flags & 4) !== 0) throw new Error('GPU target carried external ignition permission');
  if (target.firstExposureStep < 1 || target.ignitionStep <= target.firstExposureStep) throw new Error('GPU target ignition did not follow exposure');
  if (target.supportLossStep <= target.ignitionStep) throw new Error('GPU target support loss did not follow ignition');
  if (target.impactStep <= target.supportLossStep) throw new Error('GPU target impact did not follow support loss');
  if (!(target.emittedHeat > 0) || !(target.remainingFuel < 0.56) || !(target.verticalDrop > 0.20)) {
    throw new Error('GPU target did not emit, consume fuel, and fall');
  }
  if (control.phase !== 0 || control.ignitionStep !== 0 || control.emittedHeat !== 0 || control.supportCapacity !== 1) {
    throw new Error('GPU matched control changed combustion or support state');
  }
  const targetKinds = receipt.eventLog.events.filter(event => event.objectId === OBJECT_TARGET).map(event => event.kind);
  for (const kind of [EVENT_TARGET_EXPOSED, EVENT_TARGET_IGNITED, EVENT_TARGET_EMITTED, EVENT_TARGET_SUPPORT_LOST, EVENT_TARGET_IMPACTED]) {
    if (!targetKinds.includes(kind)) throw new Error(`GPU target event ${kind} is missing`);
  }
  const ordered = [EVENT_TARGET_EXPOSED, EVENT_TARGET_IGNITED, EVENT_TARGET_EMITTED, EVENT_TARGET_SUPPORT_LOST, EVENT_TARGET_IMPACTED]
    .map(kind => receipt.eventLog.events.find(event => event.objectId === OBJECT_TARGET && event.kind === kind)?.sequence ?? -1);
  if (ordered.some((sequence, index) => sequence < 0 || (index > 0 && sequence <= ordered[index - 1]))) {
    throw new Error(`GPU target event order is invalid: ${ordered.join(',')}`);
  }
  return receipt;
}

export async function createGpuCombustibleObjectLoop({ device, gridSize, format } = {}) {
  if (!device?.queue) throw new Error('GPU combustible-object loop requires a GPUDevice and queue');
  const grid = positiveInteger(gridSize, 'GPU combustible-object grid');
  if (!format) throw new Error('GPU combustible-object loop requires a presentation format');
  const materialBuffer = device.createBuffer({
    label: 'kaminos GPU combustible material state',
    size: MATERIAL_COUNT * MATERIAL_RECORD_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const sourceHeaderBuffer = device.createBuffer({
    label: 'kaminos GPU combustible source header',
    size: COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const sourceRecordsBuffer = device.createBuffer({
    label: 'kaminos GPU combustible source records',
    size: MATERIAL_COUNT * COMBUSTIBLE_OBJECT_SOURCE_RECORD_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const eventBuffer = device.createBuffer({
    label: 'kaminos GPU combustible event and verdict ledger',
    size: EVENT_BUFFER_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const paramsBuffer = device.createBuffer({
    label: 'kaminos GPU combustible parameters',
    size: PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(materialBuffer, 0, makeInitialMaterials());
  device.queue.writeBuffer(eventBuffer, 0, new Uint8Array(EVENT_BUFFER_BYTES));
  const params = new ArrayBuffer(PARAMS_BYTES);
  const paramsU32 = new Uint32Array(params);
  const paramsF32 = new Float32Array(params);
  paramsU32.set([1, 0, SOURCE_FRAME_HASH, MATERIAL_COUNT], 0);
  paramsF32.set([0.040, 0.010, 0.34, 0.0060], 4);
  paramsF32.set([0.56, 0.0025, 0.0040, 0.32], 8);
  paramsF32.set([0.018, 0.014, 0.004, 0.006], 12);
  device.queue.writeBuffer(paramsBuffer, 0, params);

  const simulationModule = device.createShaderModule({ label: 'kaminos GPU combustible simulation', code: createSimulationShader(grid) });
  const presentationModule = device.createShaderModule({ label: 'kaminos GPU combustible presentation', code: PRESENTATION_WGSL });
  const [simulationInfo, presentationInfo] = await Promise.all([
    simulationModule.getCompilationInfo(),
    presentationModule.getCompilationInfo(),
  ]);
  const compilationErrors = [...simulationInfo.messages, ...presentationInfo.messages].filter(message => message.type === 'error');
  if (compilationErrors.length) {
    throw new Error(`GPU combustible-object WGSL compilation failed:\n${compilationErrors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n')}`);
  }

  const simulationLayout = device.createBindGroupLayout({
    label: 'kaminos GPU combustible simulation layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });
  const simulationPipelineLayout = device.createPipelineLayout({ label: 'kaminos GPU combustible simulation pipeline layout', bindGroupLayouts: [simulationLayout] });
  const [clearPipeline, updatePipeline, finalizePipeline] = await Promise.all([
    device.createComputePipelineAsync({ label: 'kaminos GPU combustible clear source', layout: simulationPipelineLayout, compute: { module: simulationModule, entryPoint: 'clearSource' } }),
    device.createComputePipelineAsync({ label: 'kaminos GPU combustible update material', layout: simulationPipelineLayout, compute: { module: simulationModule, entryPoint: 'updateMaterial' } }),
    device.createComputePipelineAsync({ label: 'kaminos GPU combustible finalize source', layout: simulationPipelineLayout, compute: { module: simulationModule, entryPoint: 'finalizeSource' } }),
  ]);
  const presentationLayout = device.createBindGroupLayout({
    label: 'kaminos GPU combustible presentation layout',
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
  });
  const presentationPipeline = device.createRenderPipeline({
    label: 'kaminos GPU combustible object presentation',
    layout: device.createPipelineLayout({ label: 'kaminos GPU combustible presentation pipeline layout', bindGroupLayouts: [presentationLayout] }),
    vertex: { module: presentationModule, entryPoint: 'vertexMain' },
    fragment: {
      module: presentationModule,
      entryPoint: 'fragmentMain',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        },
      }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  });
  const presentationBindGroup = device.createBindGroup({
    label: 'kaminos GPU combustible presentation state',
    layout: presentationLayout,
    entries: [{ binding: 0, resource: { buffer: materialBuffer } }],
  });
  const simulationBindGroups = new Map();
  let dispatchCount = 0;
  let presentationCount = 0;
  let runtimeReadbackCount = 0;
  let frozen = false;
  let destroyed = false;

  function simulationBindGroup(fluidBuffer) {
    let bindGroup = simulationBindGroups.get(fluidBuffer);
    if (bindGroup) return bindGroup;
    bindGroup = device.createBindGroup({
      label: 'kaminos GPU combustible current Pyro field',
      layout: simulationLayout,
      entries: [
        { binding: 0, resource: { buffer: fluidBuffer } },
        { binding: 1, resource: { buffer: materialBuffer } },
        { binding: 2, resource: { buffer: sourceHeaderBuffer } },
        { binding: 3, resource: { buffer: sourceRecordsBuffer } },
        { binding: 4, resource: { buffer: eventBuffer } },
        { binding: 5, resource: { buffer: paramsBuffer } },
      ],
    });
    simulationBindGroups.set(fluidBuffer, bindGroup);
    return bindGroup;
  }

  function encode(encoder, fluidBuffer) {
    if (destroyed || frozen) return false;
    const pass = encoder.beginComputePass({ label: 'kaminos GPU combustible material and source update' });
    pass.setBindGroup(0, simulationBindGroup(fluidBuffer));
    pass.setPipeline(clearPipeline);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(updatePipeline);
    pass.dispatchWorkgroups(MATERIAL_COUNT);
    pass.setPipeline(finalizePipeline);
    pass.dispatchWorkgroups(1);
    pass.end();
    dispatchCount += 1;
    return true;
  }

  function encodePresentation(encoder, view) {
    if (destroyed) return false;
    const pass = encoder.beginRenderPass({
      label: 'kaminos GPU combustible object overlay',
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(presentationPipeline);
    pass.setBindGroup(0, presentationBindGroup);
    pass.draw(6, MATERIAL_COUNT);
    pass.end();
    presentationCount += 1;
    return true;
  }

  function sourceDescriptor() {
    return {
      schema: 'kaminos.combustible-object-source-descriptor.v0',
      packing: 'gpu-sparse-combustible-object-source-vec4x8-v0',
      device,
      queue: device.queue,
      headerBuffer: sourceHeaderBuffer,
      recordsBuffer: sourceRecordsBuffer,
      headerBytes: COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES,
      recordBytes: COMBUSTIBLE_OBJECT_SOURCE_RECORD_BYTES,
      recordFloats: COMBUSTIBLE_OBJECT_SOURCE_RECORD_BYTES / Float32Array.BYTES_PER_ELEMENT,
      capacity: MATERIAL_COUNT,
      allocationGeneration: 1,
      topologyEpoch: 0,
      materialStep: 0,
      writeTick: 1,
      sourceFrameId: 'gpu-combustible-object-loop',
      sourceFrameHash: SOURCE_FRAME_HASH,
      transformId: 'gpu-material-unit-domain-v0',
      objectToWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      sourceCount: MATERIAL_COUNT,
      packedCount: MATERIAL_COUNT,
      rejectedCount: 0,
      overflowCount: 0,
      malformedCount: 0,
      emittedVolatileMass: 0,
      emittedFuelMass: 0,
      emittedSootMass: 0,
      emittedHeat: 0,
      accountingResidual: 0,
      gpuAuthoredDynamic: true,
    };
  }

  async function readBuffer(buffer, size, label) {
    const readback = device.createBuffer({ label, size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder({ label: `${label} copy` });
    encoder.copyBufferToBuffer(buffer, 0, readback, 0, size);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const copy = readback.getMappedRange().slice(0);
    readback.unmap();
    readback.destroy();
    return copy;
  }

  async function readTerminalReceipt() {
    if (!frozen) throw new Error('GPU combustible terminal readback requires a frozen runtime');
    if (runtimeReadbackCount !== 0) throw new Error('GPU combustible terminal receipt was already read');
    runtimeReadbackCount += 1;
    const [materialBytes, eventBytes, headerBytes] = await Promise.all([
      readBuffer(materialBuffer, MATERIAL_COUNT * MATERIAL_RECORD_BYTES, 'kaminos GPU combustible terminal materials'),
      readBuffer(eventBuffer, EVENT_BUFFER_BYTES, 'kaminos GPU combustible terminal events'),
      readBuffer(sourceHeaderBuffer, COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES, 'kaminos GPU combustible terminal source header'),
    ]);
    const materialView = new DataView(materialBytes);
    const eventLog = decodeEvents(new DataView(eventBytes));
    const header = new DataView(headerBytes);
    const receipt = {
      schema: GPU_COMBUSTIBLE_OBJECT_TERMINAL_SCHEMA,
      authority: GPU_COMBUSTIBLE_OBJECT_LOOP_AUTHORITY,
      status: 'frozen-terminal-readback',
      routeIdentity: GPU_COMBUSTIBLE_OBJECT_LOOP_SCHEMA,
      hostCausalFeedbackCount: 0,
      runtimeReadbackCount,
      dispatchCount,
      presentationCount,
      gridSize: grid,
      materials: Array.from({ length: MATERIAL_COUNT }, (_, index) => decodeMaterial(materialView, index)),
      eventLog,
      sourceHeader: {
        magic: header.getUint32(0, true),
        version: header.getUint32(4, true),
        allocationGeneration: header.getUint32(8, true),
        topologyEpoch: header.getUint32(12, true),
        writeTick: header.getUint32(16, true),
        complete: header.getUint32(20, true),
        ready: header.getUint32(24, true),
        sourceFrameHash: header.getUint32(28, true),
        sourceCount: header.getUint32(32, true),
        packedCount: header.getUint32(36, true),
        rejectedCount: header.getUint32(40, true),
        overflowCount: header.getUint32(44, true),
      },
    };
    return validateGpuCombustibleObjectTerminalReceipt(receipt);
  }

  return {
    schema: GPU_COMBUSTIBLE_OBJECT_LOOP_SCHEMA,
    authority: GPU_COMBUSTIBLE_OBJECT_LOOP_AUTHORITY,
    gridSize: grid,
    encode,
    encodePresentation,
    sourceDescriptor,
    freeze() { frozen = true; },
    readTerminalReceipt,
    debugState() {
      return {
        schema: GPU_COMBUSTIBLE_OBJECT_LOOP_SCHEMA,
        authority: GPU_COMBUSTIBLE_OBJECT_LOOP_AUTHORITY,
        status: destroyed ? 'destroyed' : frozen ? 'frozen' : 'active',
        dispatchCount,
        presentationCount,
        hostCausalFeedbackCount: 0,
        runtimeReadbackCount,
        sourceFrameHash: SOURCE_FRAME_HASH,
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      materialBuffer.destroy();
      sourceHeaderBuffer.destroy();
      sourceRecordsBuffer.destroy();
      eventBuffer.destroy();
      paramsBuffer.destroy();
      simulationBindGroups.clear();
    },
  };
}
