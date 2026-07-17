export const COMBUSTIBLE_OBJECT_SOURCE_MAGIC = 0x4b434f42;
export const COMBUSTIBLE_OBJECT_SOURCE_VERSION = 0;
export const COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES = 80;
export const COMBUSTIBLE_OBJECT_SOURCE_RECORD_BYTES = 128;
export const COMBUSTIBLE_OBJECT_SOURCE_RECORD_FLOATS = 32;
export const COMBUSTIBLE_OBJECT_FIRE_ROUTE = 'same-device-combustible-object-source-to-native-pyro-v0';
export const COMBUSTIBLE_OBJECT_FIRE_FIXED_POINT_SCALE = 65536;

const CONSUMER_STATS_WORDS = 20;
const CONSUMER_PARAMS_BYTES = 112;
const ACCUMULATION_WORDS = 5;

function nonnegativeInteger(value, label) {
  const integer = Number(value);
  if (!Number.isInteger(integer) || integer < 0) throw new Error(`${label} must be a nonnegative integer`);
  return integer;
}

function finiteVector(value, length, label) {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${label} must contain ${length} finite values`);
  const result = value.map(Number);
  if (result.some(component => !Number.isFinite(component))) throw new Error(`${label} must contain ${length} finite values`);
  return result;
}

function fixedPoint(value) {
  return Math.max(0, Math.min(0xffffffff, Math.round((Number(value) || 0) * COMBUSTIBLE_OBJECT_FIRE_FIXED_POINT_SCALE))) >>> 0;
}

function multiplyMatrix4(a, b) {
  const result = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      result[column * 4 + row] =
        a[row] * b[column * 4]
        + a[4 + row] * b[column * 4 + 1]
        + a[8 + row] * b[column * 4 + 2]
        + a[12 + row] * b[column * 4 + 3];
    }
  }
  return result;
}

function receiverMatrix(transform) {
  const scale = finiteVector(transform?.scale, 3, 'Combustible object receiver scale');
  const offset = finiteVector(transform?.offset, 3, 'Combustible object receiver offset');
  return [
    scale[0], 0, 0, 0,
    0, scale[1], 0, 0,
    0, 0, scale[2], 0,
    offset[0], offset[1], offset[2], 1,
  ];
}

function packRecord(record, target, offset) {
  const fields = [
    ['localPositionRadius', 4],
    ['localNormalExtent', 4],
    ['velocityAngular', 4],
    ['emission', 4],
    ['material', 4],
    ['sourceGenerationEpochTick', 4],
    ['support', 4],
    ['reserved', 4],
  ];
  let cursor = offset;
  for (const [name, length] of fields) {
    const values = finiteVector(record?.[name], length, `Combustible object source record ${name}`);
    target.set(values, cursor);
    cursor += length;
  }
}

function packHeader(frame, complete) {
  const header = new Uint32Array(COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES / Uint32Array.BYTES_PER_ELEMENT);
  header[0] = COMBUSTIBLE_OBJECT_SOURCE_MAGIC;
  header[1] = COMBUSTIBLE_OBJECT_SOURCE_VERSION;
  header[2] = frame.allocationGeneration >>> 0;
  header[3] = frame.topologyEpoch >>> 0;
  header[4] = frame.writeTick >>> 0;
  header[5] = complete ? 1 : 0;
  header[6] = complete ? 1 : 0;
  header[7] = frame.sourceFrameHash >>> 0;
  header[8] = frame.sourceCount >>> 0;
  header[9] = frame.packedCount >>> 0;
  header[10] = frame.rejectedCount >>> 0;
  header[11] = frame.overflowCount >>> 0;
  header[12] = frame.malformedCount >>> 0;
  header[13] = COMBUSTIBLE_OBJECT_SOURCE_RECORD_FLOATS;
  header[14] = fixedPoint(frame.emittedVolatileMass);
  header[15] = fixedPoint(frame.emittedFuelMass);
  header[16] = fixedPoint(frame.emittedSootMass);
  header[17] = fixedPoint(frame.emittedHeat);
  header[18] = frame.materialStep >>> 0;
  header[19] = 0;
  return header;
}

export function createCombustibleObjectSourceProducer({
  device,
  capacity,
  allocationGeneration = 1,
  topologyEpoch = 0,
  label = 'kaminos combustible object source',
} = {}) {
  if (!device?.queue) throw new Error('Combustible object source producer requires a GPUDevice and GPUQueue');
  const recordCapacity = nonnegativeInteger(capacity, 'Combustible object source producer capacity');
  if (recordCapacity < 1) throw new Error('Combustible object source producer capacity must be positive');
  const generation = nonnegativeInteger(allocationGeneration, 'Combustible object source producer generation');
  const epoch = nonnegativeInteger(topologyEpoch, 'Combustible object source producer topology epoch');
  const headerBuffer = device.createBuffer({
    label: `${label} header`,
    size: COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const recordsBuffer = device.createBuffer({
    label: `${label} records ${recordCapacity}`,
    size: recordCapacity * COMBUSTIBLE_OBJECT_SOURCE_RECORD_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  let destroyed = false;
  let lastFrame = null;

  function descriptorOptions() {
    if (destroyed) throw new Error('Combustible object source producer is destroyed');
    return {
      device,
      queue: device.queue,
      headerBuffer,
      recordsBuffer,
      capacity: recordCapacity,
      allocationGeneration: generation,
      topologyEpoch: epoch,
    };
  }

  function writeFrame(frame) {
    if (destroyed) throw new Error('Combustible object source producer is destroyed');
    if (frame?.device !== device || frame?.queue !== device.queue) throw new Error('Combustible object source frame changed GPU identity');
    if (frame.headerBuffer !== headerBuffer || frame.recordsBuffer !== recordsBuffer) throw new Error('Combustible object source frame changed producer buffer ownership');
    if (frame.capacity !== recordCapacity || frame.allocationGeneration !== generation || frame.topologyEpoch !== epoch) {
      throw new Error('Combustible object source frame changed allocation identity');
    }
    if (frame.overflowCount > 0 || frame.malformedCount > 0) {
      device.queue.writeBuffer(headerBuffer, 0, packHeader(frame, false));
      throw new Error(`Combustible object source publication rejected overflow=${frame.overflowCount} malformed=${frame.malformedCount}`);
    }
    if (!Array.isArray(frame.records) || frame.records.length !== frame.packedCount) {
      throw new Error('Combustible object source publication record count mismatch');
    }
    const records = new Float32Array(recordCapacity * COMBUSTIBLE_OBJECT_SOURCE_RECORD_FLOATS);
    frame.records.forEach((record, index) => packRecord(record, records, index * COMBUSTIBLE_OBJECT_SOURCE_RECORD_FLOATS));
    device.queue.writeBuffer(headerBuffer, 0, packHeader(frame, false));
    if (frame.packedCount > 0) {
      device.queue.writeBuffer(recordsBuffer, 0, records, 0, frame.packedCount * COMBUSTIBLE_OBJECT_SOURCE_RECORD_FLOATS);
    }
    device.queue.writeBuffer(headerBuffer, 0, packHeader(frame, true));
    lastFrame = frame;
    return frame;
  }

  return {
    descriptorOptions,
    writeFrame,
    debug() {
      return {
        routeIdentity: COMBUSTIBLE_OBJECT_FIRE_ROUTE,
        capacity: recordCapacity,
        allocationGeneration: generation,
        topologyEpoch: epoch,
        lastWriteTick: lastFrame?.writeTick ?? null,
        lastSourceCount: lastFrame?.sourceCount ?? 0,
        lastPackedCount: lastFrame?.packedCount ?? 0,
        lastOverflowCount: lastFrame?.overflowCount ?? 0,
        ownsHeaderBuffer: !destroyed,
        ownsRecordsBuffer: !destroyed,
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      headerBuffer.destroy();
      recordsBuffer.destroy();
      lastFrame = null;
    },
  };
}

function createConsumerShader(gridSize) {
  const grid = nonnegativeInteger(gridSize, 'Combustible object receiver grid');
  if (grid < 4) throw new Error('Combustible object receiver grid must be at least 4');
  return /* wgsl */`
const GRID: u32 = ${grid}u;
const GRID_CELLS: u32 = ${grid * grid * grid}u;
const SOURCE_MAGIC: u32 = ${COMBUSTIBLE_OBJECT_SOURCE_MAGIC}u;
const SOURCE_VERSION: u32 = ${COMBUSTIBLE_OBJECT_SOURCE_VERSION}u;
const FIXED_POINT_SCALE: f32 = ${COMBUSTIBLE_OBJECT_FIRE_FIXED_POINT_SCALE}.0;

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

struct Accumulation {
  touched: atomic<u32>,
  heat: atomic<u32>,
  fuel: atomic<u32>,
  soot: atomic<u32>,
  smoke: atomic<u32>,
};

struct ConsumerStats {
  lastConsumedTick: atomic<u32>,
  status: atomic<u32>,
  acceptedRecords: atomic<u32>,
  rejectedRecords: atomic<u32>,
  touchedCells: atomic<u32>,
  injectedHeat: atomic<u32>,
  injectedFuel: atomic<u32>,
  injectedSoot: atomic<u32>,
  injectedSmoke: atomic<u32>,
  sourceGeneration: atomic<u32>,
  topologyEpoch: atomic<u32>,
  sourceFrameHash: atomic<u32>,
  sourceCount: atomic<u32>,
  packedCount: atomic<u32>,
  overflowCount: atomic<u32>,
  acceptedCellX: atomic<u32>,
  acceptedCellY: atomic<u32>,
  acceptedCellZ: atomic<u32>,
  materialStep: atomic<u32>,
  reserved: atomic<u32>,
};

struct ConsumerParams {
  expectedIdentity: vec4<u32>,
  objectToReceiver: mat4x4<f32>,
  transfer: vec4<f32>,
  sourceMass: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> sourceHeader: array<u32>;
@group(0) @binding(1) var<storage, read> sourceRecords: array<SourceRecord>;
@group(0) @binding(2) var<storage, read_write> accumulation: array<Accumulation>;
@group(0) @binding(3) var<storage, read_write> stats: ConsumerStats;
@group(0) @binding(4) var<uniform> params: ConsumerParams;
@group(0) @binding(5) var<storage, read_write> fluid: array<vec4<f32>>;

fn fixedPoint(value: f32) -> u32 {
  return u32(clamp(value, 0.0, 65535.0) * FIXED_POINT_SCALE + 0.5);
}

fn floatPoint(value: u32) -> f32 {
  return f32(value) / FIXED_POINT_SCALE;
}

fn headerConsumable() -> bool {
  return sourceHeader[0] == SOURCE_MAGIC
    && sourceHeader[1] == SOURCE_VERSION
    && sourceHeader[5] == 1u
    && sourceHeader[6] == 1u
    && sourceHeader[2] == params.expectedIdentity.x
    && sourceHeader[3] == params.expectedIdentity.y
    && sourceHeader[7] == params.expectedIdentity.z
    && sourceHeader[11] == 0u
    && sourceHeader[12] == 0u
    && sourceHeader[13] == 32u
    && sourceHeader[8] == sourceHeader[9] + sourceHeader[10] + sourceHeader[11];
}

@compute @workgroup_size(1)
fn clearStats() {
  atomicStore(&stats.status, 0u);
  atomicStore(&stats.acceptedRecords, 0u);
  atomicStore(&stats.rejectedRecords, sourceHeader[10]);
  atomicStore(&stats.touchedCells, 0u);
  atomicStore(&stats.injectedHeat, 0u);
  atomicStore(&stats.injectedFuel, 0u);
  atomicStore(&stats.injectedSoot, 0u);
  atomicStore(&stats.injectedSmoke, 0u);
  atomicStore(&stats.sourceGeneration, sourceHeader[2]);
  atomicStore(&stats.topologyEpoch, sourceHeader[3]);
  atomicStore(&stats.sourceFrameHash, sourceHeader[7]);
  atomicStore(&stats.sourceCount, sourceHeader[8]);
  atomicStore(&stats.packedCount, sourceHeader[9]);
  atomicStore(&stats.overflowCount, sourceHeader[11]);
  atomicStore(&stats.acceptedCellX, 0u);
  atomicStore(&stats.acceptedCellY, 0u);
  atomicStore(&stats.acceptedCellZ, 0u);
  atomicStore(&stats.materialStep, sourceHeader[18]);
}

@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) gid: vec3<u32>) {
  let sourceIndex = gid.x;
  if (!headerConsumable()) {
    if (sourceIndex == 0u) { atomicStore(&stats.status, 2u); }
    return;
  }
  let writeTick = sourceHeader[4];
  if (writeTick <= atomicLoad(&stats.lastConsumedTick)) {
    if (sourceIndex == 0u) { atomicStore(&stats.status, 3u); }
    return;
  }
  if (sourceIndex == 0u) { atomicStore(&stats.status, 4u); }
  if (sourceIndex >= sourceHeader[9]) { return; }
  let record = sourceRecords[sourceIndex];
  if (u32(record.sourceGenerationEpochTick.x + 0.5) != params.expectedIdentity.x
    || u32(record.sourceGenerationEpochTick.y + 0.5) != params.expectedIdentity.y
    || u32(record.sourceGenerationEpochTick.z + 0.5) != writeTick) {
    atomicAdd(&stats.rejectedRecords, 1u);
    return;
  }
  let receiver = params.objectToReceiver * vec4<f32>(record.localPositionRadius.xyz, 1.0);
  if (any(receiver.xyz < vec3<f32>(0.0)) || any(receiver.xyz > vec3<f32>(1.0))) {
    atomicAdd(&stats.rejectedRecords, 1u);
    return;
  }
  let cell = min(vec3<u32>(receiver.xyz * f32(GRID)), vec3<u32>(GRID - 1u));
  let radiusScale = max(
    max(length(params.objectToReceiver[0].xyz), length(params.objectToReceiver[1].xyz)),
    length(params.objectToReceiver[2].xyz)
  );
  let receiverRadius = max(0.0, record.localPositionRadius.w) * radiusScale;
  let supportRadius = max(receiverRadius * 1.8, 1.5 / f32(GRID));
  let sigma = max(receiverRadius, 0.75 / f32(GRID));
  let lower = vec3<u32>(floor(clamp(
    (receiver.xyz - vec3<f32>(supportRadius)) * f32(GRID),
    vec3<f32>(0.0),
    vec3<f32>(f32(GRID - 1u))
  )));
  let upper = vec3<u32>(floor(clamp(
    (receiver.xyz + vec3<f32>(supportRadius)) * f32(GRID),
    vec3<f32>(0.0),
    vec3<f32>(f32(GRID - 1u))
  )));
  var weightSum = 0.0;
  for (var z = lower.z; z <= upper.z; z += 1u) {
    for (var y = lower.y; y <= upper.y; y += 1u) {
      for (var x = lower.x; x <= upper.x; x += 1u) {
        let center = (vec3<f32>(f32(x), f32(y), f32(z)) + vec3<f32>(0.5)) / f32(GRID);
        let distanceSquared = dot(center - receiver.xyz, center - receiver.xyz);
        if (distanceSquared <= supportRadius * supportRadius) {
          weightSum += exp(-distanceSquared / (sigma * sigma));
        }
      }
    }
  }
  if (!(weightSum > 0.0)) {
    atomicAdd(&stats.rejectedRecords, 1u);
    return;
  }
  for (var z = lower.z; z <= upper.z; z += 1u) {
    for (var y = lower.y; y <= upper.y; y += 1u) {
      for (var x = lower.x; x <= upper.x; x += 1u) {
        let kernelCell = vec3<u32>(x, y, z);
        let center = (vec3<f32>(f32(x), f32(y), f32(z)) + vec3<f32>(0.5)) / f32(GRID);
        let distanceSquared = dot(center - receiver.xyz, center - receiver.xyz);
        if (distanceSquared <= supportRadius * supportRadius) {
          let weight = exp(-distanceSquared / (sigma * sigma)) / weightSum;
          let cellIndex = kernelCell.x + kernelCell.y * GRID + kernelCell.z * GRID * GRID;
          if (atomicExchange(&accumulation[cellIndex].touched, 1u) == 0u) {
            atomicAdd(&stats.touchedCells, 1u);
          }
          atomicAdd(&accumulation[cellIndex].heat, fixedPoint(max(0.0, record.emission.x) * params.transfer.x * weight));
          atomicAdd(&accumulation[cellIndex].fuel, fixedPoint(max(0.0, record.emission.y) * params.transfer.y * weight));
          atomicAdd(&accumulation[cellIndex].soot, fixedPoint(max(0.0, record.emission.z) * params.transfer.z * weight));
          atomicAdd(&accumulation[cellIndex].smoke, fixedPoint(max(0.0, record.emission.w) * params.transfer.w * weight));
        }
      }
    }
  }
  if (atomicAdd(&stats.acceptedRecords, 1u) == 0u) {
    atomicStore(&stats.acceptedCellX, cell.x);
    atomicStore(&stats.acceptedCellY, cell.y);
    atomicStore(&stats.acceptedCellZ, cell.z);
  }
}

@compute @workgroup_size(64)
fn apply(@builtin(global_invocation_id) gid: vec3<u32>) {
  let cellIndex = gid.x;
  if (atomicLoad(&stats.status) != 4u) { return; }
  if (cellIndex < GRID_CELLS) {
    let wasTouched = atomicExchange(&accumulation[cellIndex].touched, 0u);
    let requestedHeat = floatPoint(atomicExchange(&accumulation[cellIndex].heat, 0u));
    let requestedFuel = floatPoint(atomicExchange(&accumulation[cellIndex].fuel, 0u));
    let requestedSoot = floatPoint(atomicExchange(&accumulation[cellIndex].soot, 0u));
    let requestedSmoke = floatPoint(atomicExchange(&accumulation[cellIndex].smoke, 0u));
    if (wasTouched > 0u) {
      let base = cellIndex * 4u;
      var material = fluid[base + 1u];
      var fire = fluid[base + 2u];
      var micro = fluid[base + 3u];
      let nextHeat = min(4.0, material.y + requestedHeat);
      let nextFuel = min(4.0, material.z + requestedFuel);
      let nextSmoke = min(4.0, material.x + requestedSmoke + requestedSoot * 0.35);
      let nextMicroSmoke = min(4.0, micro.x + requestedSoot + requestedSmoke * 0.25);
      let appliedHeat = nextHeat - material.y;
      let appliedFuel = nextFuel - material.z;
      let appliedSoot = nextMicroSmoke - micro.x;
      let appliedSmoke = nextSmoke - material.x;
      material.x = nextSmoke;
      material.y = nextHeat;
      material.z = nextFuel;
      let visibleFire = appliedFuel * 0.82 + appliedHeat * 0.28;
      fire.x = min(4.0, fire.x + visibleFire);
      fire.y = min(4.0, fire.y + appliedHeat * 0.42);
      fire.z = min(4.0, fire.z + visibleFire * 0.72);
      fire.w = min(4.0, fire.w + visibleFire * 0.48);
      micro.x = nextMicroSmoke;
      micro.z = min(4.0, micro.z + visibleFire * 0.68);
      fluid[base + 1u] = material;
      fluid[base + 2u] = fire;
      fluid[base + 3u] = micro;
      atomicAdd(&stats.injectedHeat, fixedPoint(appliedHeat));
      atomicAdd(&stats.injectedFuel, fixedPoint(appliedFuel));
      atomicAdd(&stats.injectedSoot, fixedPoint(appliedSoot));
      atomicAdd(&stats.injectedSmoke, fixedPoint(appliedSmoke));
    }
  }
  if (cellIndex == 0u) {
    atomicStore(&stats.lastConsumedTick, sourceHeader[4]);
    if (atomicLoad(&stats.acceptedRecords) > 0u) {
      atomicStore(&stats.status, 1u);
    } else {
      atomicStore(&stats.status, 5u);
    }
  }
}
`;
}

export async function createCombustibleObjectFireReceiver({
  device,
  gridSize,
  validateDescriptor,
  transformIdentity,
} = {}) {
  if (!device?.queue) throw new Error('Combustible object fire receiver requires a GPUDevice and GPUQueue');
  if (typeof validateDescriptor !== 'function') throw new Error('Combustible object fire receiver requires descriptor validation');
  const grid = nonnegativeInteger(gridSize, 'Combustible object receiver grid');
  const shader = device.createShaderModule({ label: 'kaminos combustible object fire receiver', code: createConsumerShader(grid) });
  const compilation = await shader.getCompilationInfo();
  const errors = compilation.messages.filter(message => message.type === 'error');
  if (errors.length > 0) {
    throw new Error(`Combustible object fire receiver WGSL compilation failed:\n${errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n')}`);
  }
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'kaminos combustible object fire receiver bind group',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ label: 'kaminos combustible object fire receiver pipeline', bindGroupLayouts: [bindGroupLayout] });
  const [clearPipeline, scatterPipeline, applyPipeline] = await Promise.all([
    device.createComputePipelineAsync({ label: 'kaminos combustible object clear stats', layout: pipelineLayout, compute: { module: shader, entryPoint: 'clearStats' } }),
    device.createComputePipelineAsync({ label: 'kaminos combustible object scatter', layout: pipelineLayout, compute: { module: shader, entryPoint: 'scatter' } }),
    device.createComputePipelineAsync({ label: 'kaminos combustible object apply', layout: pipelineLayout, compute: { module: shader, entryPoint: 'apply' } }),
  ]);
  const accumulationBuffer = device.createBuffer({
    label: `kaminos combustible object accumulation ${grid}^3`,
    size: grid * grid * grid * ACCUMULATION_WORDS * Uint32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const statsBuffer = device.createBuffer({
    label: 'kaminos combustible object receiver stats',
    size: CONSUMER_STATS_WORDS * Uint32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const paramsBuffer = device.createBuffer({
    label: 'kaminos combustible object receiver params',
    size: CONSUMER_PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const readbackBuffer = device.createBuffer({
    label: 'kaminos combustible object receiver stats readback',
    size: CONSUMER_STATS_WORDS * Uint32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  device.queue.writeBuffer(accumulationBuffer, 0, new Uint32Array(grid * grid * grid * ACCUMULATION_WORDS));
  device.queue.writeBuffer(statsBuffer, 0, new Uint32Array(CONSUMER_STATS_WORDS));
  let descriptor = null;
  let transform = null;
  let transfer = [1, 1, 1, 1];
  let bindGroups = new Map();
  let dispatchCount = 0;
  let lastScheduledIdentity = null;
  let lastReceipt = null;
  let readbackPending = false;
  let destroyed = false;

  function setSource(nextDescriptor, nextTransform, nextTransfer = [1, 1, 1, 1]) {
    if (destroyed) throw new Error('Combustible object fire receiver is destroyed');
    validateDescriptor(nextDescriptor, {
      device,
      expectedGeneration: nextDescriptor.allocationGeneration,
      expectedTopologyEpoch: nextDescriptor.topologyEpoch,
    });
    if (nextTransform?.id !== transformIdentity) {
      throw new Error(`Combustible object receiver transform identity mismatch: ${String(nextTransform?.id || 'missing')}`);
    }
    const fieldTransfer = finiteVector(nextTransfer, 4, 'Combustible object field transfer');
    if (fieldTransfer.some(component => component < 0)) throw new Error('Combustible object field transfer must be nonnegative');
    const objectToReceiver = multiplyMatrix4(receiverMatrix(nextTransform), finiteVector(nextDescriptor.objectToWorld, 16, 'Combustible object object-to-world transform'));
    const params = new ArrayBuffer(CONSUMER_PARAMS_BYTES);
    const paramsU32 = new Uint32Array(params);
    const paramsF32 = new Float32Array(params);
    paramsU32.set([
      nextDescriptor.allocationGeneration >>> 0,
      nextDescriptor.topologyEpoch >>> 0,
      nextDescriptor.sourceFrameHash >>> 0,
      0,
    ], 0);
    paramsF32.set(objectToReceiver, 4);
    paramsF32.set(fieldTransfer, 20);
    paramsF32.set([
      nextDescriptor.emittedVolatileMass,
      nextDescriptor.emittedFuelMass,
      nextDescriptor.emittedSootMass,
      nextDescriptor.emittedHeat,
    ], 24);
    device.queue.writeBuffer(paramsBuffer, 0, params);
    if (descriptor?.headerBuffer !== nextDescriptor.headerBuffer || descriptor?.recordsBuffer !== nextDescriptor.recordsBuffer) {
      bindGroups = new Map();
    }
    descriptor = nextDescriptor;
    transform = { id: nextTransform.id, scale: [...nextTransform.scale], offset: [...nextTransform.offset] };
    transfer = fieldTransfer;
    return debug();
  }

  function bindGroupFor(fluidBuffer) {
    let bindGroup = bindGroups.get(fluidBuffer);
    if (bindGroup) return bindGroup;
    bindGroup = device.createBindGroup({
      label: 'kaminos combustible object source to current Pyro field',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: descriptor.headerBuffer } },
        { binding: 1, resource: { buffer: descriptor.recordsBuffer } },
        { binding: 2, resource: { buffer: accumulationBuffer } },
        { binding: 3, resource: { buffer: statsBuffer } },
        { binding: 4, resource: { buffer: paramsBuffer } },
        { binding: 5, resource: { buffer: fluidBuffer } },
      ],
    });
    bindGroups.set(fluidBuffer, bindGroup);
    return bindGroup;
  }

  function encode(encoder, fluidBuffer) {
    if (!descriptor || destroyed) return false;
    const dynamicSource = descriptor.gpuAuthoredDynamic === true;
    const scheduledIdentity = dynamicSource
      ? `${descriptor.allocationGeneration}:${descriptor.topologyEpoch}:gpu-dispatch-${dispatchCount + 1}:${descriptor.sourceFrameHash}`
      : `${descriptor.allocationGeneration}:${descriptor.topologyEpoch}:${descriptor.writeTick}:${descriptor.sourceFrameHash}`;
    if (lastScheduledIdentity === scheduledIdentity) return false;
    const pass = encoder.beginComputePass({ label: 'kaminos combustible object source injection' });
    pass.setBindGroup(0, bindGroupFor(fluidBuffer));
    pass.setPipeline(clearPipeline);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(scatterPipeline);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(descriptor.capacity / 64)));
    pass.setPipeline(applyPipeline);
    pass.dispatchWorkgroups(Math.ceil((grid * grid * grid) / 64));
    pass.end();
    dispatchCount += 1;
    lastScheduledIdentity = scheduledIdentity;
    return true;
  }

  async function readReceipt() {
    if (!descriptor) return null;
    if (readbackPending) throw new Error('Combustible object receiver stats readback is already pending');
    readbackPending = true;
    try {
      const encoder = device.createCommandEncoder({ label: 'kaminos combustible object receiver stats copy' });
      encoder.copyBufferToBuffer(statsBuffer, 0, readbackBuffer, 0, CONSUMER_STATS_WORDS * Uint32Array.BYTES_PER_ELEMENT);
      device.queue.submit([encoder.finish()]);
      await readbackBuffer.mapAsync(GPUMapMode.READ);
      const words = new Uint32Array(readbackBuffer.getMappedRange().slice(0));
      readbackBuffer.unmap();
      const statusNames = ['idle', 'applied', 'invalid-source-header', 'stale-source-tick', 'scattering', 'fresh-no-contact'];
      lastReceipt = {
        schema: 'kaminos.pyro-combustible-object-source-consumer-receipt.v0',
        routeIdentity: COMBUSTIBLE_OBJECT_FIRE_ROUTE,
        status: statusNames[words[1]] || `unknown-${words[1]}`,
        lastConsumedTick: words[0],
        acceptedRecords: words[2],
        rejectedRecords: words[3],
        touchedCells: words[4],
        injectedHeat: words[5] / COMBUSTIBLE_OBJECT_FIRE_FIXED_POINT_SCALE,
        injectedFuel: words[6] / COMBUSTIBLE_OBJECT_FIRE_FIXED_POINT_SCALE,
        injectedSoot: words[7] / COMBUSTIBLE_OBJECT_FIRE_FIXED_POINT_SCALE,
        injectedSmoke: words[8] / COMBUSTIBLE_OBJECT_FIRE_FIXED_POINT_SCALE,
        sourceGeneration: words[9],
        topologyEpoch: words[10],
        sourceFrameHash: words[11],
        sourceCount: words[12],
        packedCount: words[13],
        overflowCount: words[14],
        acceptedCell: words[2] > 0 ? [words[15], words[16], words[17]] : null,
        materialStep: words[18],
        sameDevice: descriptor.device === device && descriptor.queue === device.queue,
        transformIdentity: transform.id,
        fieldTransfer: [...transfer],
      };
      return { ...lastReceipt };
    } finally {
      readbackPending = false;
    }
  }

  function debug() {
    return {
      schema: 'kaminos.pyro-combustible-object-source-consumer.v0',
      routeIdentity: COMBUSTIBLE_OBJECT_FIRE_ROUTE,
      status: descriptor ? 'bound' : 'off',
      gridSize: grid,
      sourceSchema: descriptor?.schema ?? null,
      sourceFrameId: descriptor?.sourceFrameId ?? null,
      sourceFrameHash: descriptor?.sourceFrameHash ?? null,
      allocationGeneration: descriptor?.allocationGeneration ?? null,
      topologyEpoch: descriptor?.topologyEpoch ?? null,
      materialStep: descriptor?.materialStep ?? null,
      writeTick: descriptor?.writeTick ?? null,
      sourceCount: descriptor?.sourceCount ?? 0,
      packedCount: descriptor?.packedCount ?? 0,
      rejectedCount: descriptor?.rejectedCount ?? 0,
      overflowCount: descriptor?.overflowCount ?? 0,
      emittedVolatileMass: descriptor?.emittedVolatileMass ?? 0,
      sameDevice: descriptor ? descriptor.device === device && descriptor.queue === device.queue : null,
      transformIdentity: transform?.id ?? null,
      fieldTransfer: [...transfer],
      dispatchCount,
      lastScheduledIdentity,
      lastReceipt: lastReceipt ? { ...lastReceipt } : null,
      fallback: null,
      gpuAuthoredDynamic: descriptor?.gpuAuthoredDynamic === true,
    };
  }

  return {
    gridSize: grid,
    setSource,
    encode,
    readReceipt,
    debug,
    clearSource() {
      descriptor = null;
      transform = null;
      transfer = [1, 1, 1, 1];
      lastScheduledIdentity = null;
      bindGroups = new Map();
      return debug();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      descriptor = null;
      transform = null;
      bindGroups.clear();
      accumulationBuffer.destroy();
      statsBuffer.destroy();
      paramsBuffer.destroy();
      readbackBuffer.destroy();
    },
  };
}
