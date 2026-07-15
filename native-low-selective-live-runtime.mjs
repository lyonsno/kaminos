import {
  SELECTIVE_HEAD_LIVE_MODEL,
  SELECTIVE_HEAD_LIVE_MODEL_URL,
} from './models/selective-head-live/exact-basin-160-to-128-v0/model.generated.js';

export { SELECTIVE_HEAD_LIVE_MODEL, SELECTIVE_HEAD_LIVE_MODEL_URL };

export const NATIVE_LOW_SELECTIVE_LIVE_ROUTE = 'native-low-live-browser-webgpu-inference-v0';
export const NATIVE_LOW_SHARED_DEVICE_ROUTE = 'native-low-shared-device-buffer-inference-v0';
export const NATIVE_LOW_INPUT_AUTHORITY = 'native-low-simulator-state-no-synthetic-downsample-v0';
export const NATIVE_LOW_FEATURE_AUTHORITY = 'full-low-field-plus-spatial-rbf-features-v0';
export const NATIVE_LOW_TRANSPORT_MODE = 'shared-device-gpu-buffers-no-readback-import-v0';

const LOW_GRID = 128;
const HIGH_GRID = 160;
const SLOTS_PER_CELL = 4;
const FEATURE_COUNT = 185;
const HIDDEN_WIDTH = 48;
const STATS_BYTES = 16;

function output(channel) {
  const found = SELECTIVE_HEAD_LIVE_MODEL.outputs.find(item => item.channel === channel);
  if (!found) throw new Error(`native-low selective model omitted ${channel}`);
  return found;
}

function wgslOffsets(channel) {
  const offsets = output(channel).offsets;
  return [offsets.w1, offsets.b1, offsets.w2, offsets.b2, offsets.targetMean, offsets.targetStd].map(value => `${value}u`).join(', ');
}

const WGSL = `
const LOW_GRID: u32 = ${LOW_GRID}u;
const HIGH_GRID: u32 = ${HIGH_GRID}u;
const SLOTS_PER_CELL: u32 = ${SLOTS_PER_CELL}u;
const FEATURE_COUNT: u32 = ${FEATURE_COUNT}u;
const HIDDEN_WIDTH: u32 = ${HIDDEN_WIDTH}u;
const SUPPORT_THRESHOLD: f32 = ${SELECTIVE_HEAD_LIVE_MODEL.composition.supportThreshold};

@group(0) @binding(0) var<storage, read> lowFluid: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> lowFront: array<f32>;
@group(0) @binding(2) var<storage, read_write> predictedFluid: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> predictedFront: array<f32>;
@group(0) @binding(4) var<storage, read> model: array<f32>;
@group(0) @binding(5) var<storage, read_write> stats: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> lowSnapshotFluid: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> lowSnapshotFront: array<f32>;

fn index3(cell: vec3<u32>, grid: u32) -> u32 {
  return cell.x + cell.y * grid + cell.z * grid * grid;
}

fn standardize(raw: f32, featureIndex: u32) -> f32 {
  return (raw - model[featureIndex]) / model[${SELECTIVE_HEAD_LIVE_MODEL.normalization.featureStd.offset}u + featureIndex];
}

fn inferHead(
  features: array<f32, ${FEATURE_COUNT}>,
  w1Offset: u32,
  b1Offset: u32,
  w2Offset: u32,
  b2Offset: u32,
  targetMeanOffset: u32,
  targetStdOffset: u32,
) -> f32 {
  var hidden: array<f32, ${HIDDEN_WIDTH}>;
  for (var hiddenIndex = 0u; hiddenIndex < HIDDEN_WIDTH; hiddenIndex += 1u) {
    var value = model[b1Offset + hiddenIndex];
    for (var featureIndex = 0u; featureIndex < FEATURE_COUNT; featureIndex += 1u) {
      value += features[featureIndex] * model[w1Offset + featureIndex * HIDDEN_WIDTH + hiddenIndex];
    }
    hidden[hiddenIndex] = tanh(value);
  }
  var result = model[b2Offset];
  for (var hiddenIndex = 0u; hiddenIndex < HIDDEN_WIDTH; hiddenIndex += 1u) {
    result += hidden[hiddenIndex] * model[w2Offset + hiddenIndex];
  }
  return result * model[targetStdOffset] + model[targetMeanOffset];
}

@compute @workgroup_size(4, 4, 4)
fn reconstructNativeLow(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(HIGH_GRID))) { return; }
  let lowCell = min(vec3<u32>(LOW_GRID - 1u), vec3<u32>(floor(vec3<f32>(gid) * f32(LOW_GRID) / f32(HIGH_GRID))));
  let lowIndex = index3(lowCell, LOW_GRID);
  let highIndex = index3(gid, HIGH_GRID);
  if (highIndex < LOW_GRID * LOW_GRID * LOW_GRID) {
    for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
      lowSnapshotFluid[highIndex * SLOTS_PER_CELL + slot] = lowFluid[highIndex * SLOTS_PER_CELL + slot];
    }
    lowSnapshotFront[highIndex] = lowFront[highIndex];
  }
  var lowValues: array<f32, 17>;
  for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
    let value = lowFluid[lowIndex * SLOTS_PER_CELL + slot];
    lowValues[slot * 4u + 0u] = value.x;
    lowValues[slot * 4u + 1u] = value.y;
    lowValues[slot * 4u + 2u] = value.z;
    lowValues[slot * 4u + 3u] = value.w;
    predictedFluid[highIndex * SLOTS_PER_CELL + slot] = value;
  }
  lowValues[16] = lowFront[lowIndex];
  var features: array<f32, ${FEATURE_COUNT}>;
  for (var i = 0u; i < 17u; i += 1u) {
    features[i] = standardize(lowValues[i], i);
    features[17u + i] = standardize(lowValues[i] * lowValues[i], 17u + i);
  }
  let normalized = vec3<f32>(gid) / f32(HIGH_GRID - 1u) * 2.0 - vec3<f32>(1.0);
  let radial = length(normalized.xz);
  let positionFeatures = array<f32, 5>(normalized.x, normalized.y, normalized.z, radial, normalized.y * radial);
  for (var i = 0u; i < 5u; i += 1u) {
    features[34u + i] = standardize(positionFeatures[i], 34u + i);
  }
  var featureIndex = 39u;
  for (var frequencyIndex = 0u; frequencyIndex < 3u; frequencyIndex += 1u) {
    let frequency = select(select(1.0, 2.0, frequencyIndex == 1u), 4.0, frequencyIndex == 2u);
    for (var axis = 0u; axis < 3u; axis += 1u) {
      let phase = 3.141592653589793 * frequency * normalized[axis];
      features[featureIndex] = standardize(sin(phase), featureIndex);
      featureIndex += 1u;
      features[featureIndex] = standardize(cos(phase), featureIndex);
      featureIndex += 1u;
    }
  }
  for (var cyIndex = 0u; cyIndex < 8u; cyIndex += 1u) {
    let cy = -0.95 + f32(cyIndex) * (1.8 / 7.0);
    for (var czIndex = 0u; czIndex < 4u; czIndex += 1u) {
      let cz = -0.75 + f32(czIndex) * 0.5;
      for (var cxIndex = 0u; cxIndex < 4u; cxIndex += 1u) {
        let cx = -0.75 + f32(cxIndex) * 0.5;
        let delta = normalized - vec3<f32>(cx, cy, cz);
        let rbf = exp(-dot(delta, delta) / (2.0 * 0.30 * 0.30));
        features[featureIndex] = standardize(rbf, featureIndex);
        featureIndex += 1u;
      }
    }
  }
  let classifierLogit = inferHead(features, ${wgslOffsets('supportProbability')});
  let probability = 1.0 / (1.0 + exp(-clamp(classifierLogit, -30.0, 30.0)));
  let hardSupport = select(0.0, 1.0, probability >= SUPPORT_THRESHOLD);
  var material = predictedFluid[highIndex * SLOTS_PER_CELL + 1u];
  var fire = predictedFluid[highIndex * SLOTS_PER_CELL + 2u];
  var micro = predictedFluid[highIndex * SLOTS_PER_CELL + 3u];
  if (hardSupport > 0.5) {
    atomicAdd(&stats[0], 1u);
    material.z += inferHead(features, ${wgslOffsets('fuel')});
    fire.z += inferHead(features, ${wgslOffsets('visibleFireCarrier')});
    micro.z += inferHead(features, ${wgslOffsets('fireLick')});
  }
  predictedFluid[highIndex * SLOTS_PER_CELL + 1u] = material;
  predictedFluid[highIndex * SLOTS_PER_CELL + 2u] = fire;
  predictedFluid[highIndex * SLOTS_PER_CELL + 3u] = micro;
  predictedFront[highIndex] = lowValues[16] + inferHead(features, ${wgslOffsets('frontTopology')});
}
`;

async function sha256Hex(bytes) {
  const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

async function readU32Buffer(device, source, byteLength, label) {
  const readback = device.createBuffer({
    label,
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: `${label} encoder` });
  encoder.copyBufferToBuffer(source, 0, readback, 0, byteLength);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const values = new Uint32Array(readback.getMappedRange()).slice();
  readback.unmap();
  readback.destroy();
  return values;
}

export async function createNativeLowSelectiveSharedDeviceRuntime({ device }) {
  if (!device) throw new Error('shared-device native-low runtime requires the renderer WebGPU device');
  const response = await fetch(SELECTIVE_HEAD_LIVE_MODEL_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`modelFetchFailed:${response.status}`);
  const modelBytes = await response.arrayBuffer();
  const modelSha256 = await sha256Hex(modelBytes);
  if (modelBytes.byteLength !== SELECTIVE_HEAD_LIVE_MODEL.packed.byteLength || modelSha256 !== SELECTIVE_HEAD_LIVE_MODEL.packed.sha256) {
    throw new Error(`modelChecksumMismatch:${modelSha256}`);
  }
  const lowCells = LOW_GRID ** 3;
  const highCells = HIGH_GRID ** 3;
  const lowFluidBytes = lowCells * SLOTS_PER_CELL * 4 * Float32Array.BYTES_PER_ELEMENT;
  const lowFrontBytes = lowCells * Float32Array.BYTES_PER_ELEMENT;
  const highFluidBytes = highCells * SLOTS_PER_CELL * 4 * Float32Array.BYTES_PER_ELEMENT;
  const highFrontBytes = highCells * Float32Array.BYTES_PER_ELEMENT;
  const makeBuffer = (label, size, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST) => device.createBuffer({ label, size, usage });
  const lowSnapshotFluid = makeBuffer('native-low shared-device low snapshot fluid 128^3', lowFluidBytes);
  const lowSnapshotFront = makeBuffer('native-low shared-device low snapshot front 128^3', lowFrontBytes);
  const predictedFluid = makeBuffer('native-low shared-device predicted fluid 160^3', highFluidBytes);
  const predictedFront = makeBuffer('native-low shared-device predicted front 160^3', highFrontBytes);
  const stats = makeBuffer('native-low shared-device support stats', STATS_BYTES);
  const model = makeBuffer(`native-low shared-device model ${SELECTIVE_HEAD_LIVE_MODEL.identity}`, modelBytes.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(model, 0, modelBytes);
  const shader = device.createShaderModule({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} WGSL`, code: WGSL });
  const compilation = await shader.getCompilationInfo();
  const errors = compilation.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(`native-low shared-device WGSL failed:${errors.map(error => `${error.lineNum}:${error.linePos} ${error.message}`).join('; ')}`);
  const layout = device.createBindGroupLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} layout`,
    entries: Array.from({ length: 8 }, (_, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: binding === 0 || binding === 1 || binding === 4 ? 'read-only-storage' : 'storage' },
    })),
  });
  const pipeline = device.createComputePipeline({
    label: NATIVE_LOW_SHARED_DEVICE_ROUTE,
    layout: device.createPipelineLayout({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} pipeline layout`, bindGroupLayouts: [layout] }),
    compute: { module: shader, entryPoint: 'reconstructNativeLow' },
  });
  let encodedFrameCount = 0;
  let lastStats = {
    supportPositiveCount: 0,
    supportPrevalence: 0,
    highCellCount: highCells,
  };
  return {
    identity: NATIVE_LOW_SHARED_DEVICE_ROUTE,
    transportMode: NATIVE_LOW_TRANSPORT_MODE,
    requestedBackend: 'WebGPU',
    effectiveBackend: 'WebGPU',
    fallbackBackend: null,
    modelIdentity: SELECTIVE_HEAD_LIVE_MODEL.identity,
    modelSha256,
    featureAuthority: NATIVE_LOW_FEATURE_AUTHORITY,
    inputAuthority: NATIVE_LOW_INPUT_AUTHORITY,
    effectiveFeatureCount: SELECTIVE_HEAD_LIVE_MODEL.features.featureCount,
    noHiddenCaps: true,
    buffers: { lowSnapshotFluid, lowSnapshotFront, predictedFluid, predictedFront },
    encodeFromNativeLow(encoder, sourceFluid, sourceFront, options = {}) {
      device.queue.writeBuffer(stats, 0, new Uint32Array(4));
      const bindGroup = device.createBindGroup({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} bind group`,
        layout,
        entries: [
          { binding: 0, resource: { buffer: sourceFluid } },
          { binding: 1, resource: { buffer: sourceFront } },
          { binding: 2, resource: { buffer: predictedFluid } },
          { binding: 3, resource: { buffer: predictedFront } },
          { binding: 4, resource: { buffer: model } },
          { binding: 5, resource: { buffer: stats } },
          { binding: 6, resource: { buffer: lowSnapshotFluid } },
          { binding: 7, resource: { buffer: lowSnapshotFront } },
        ],
      });
      const pass = encoder.beginComputePass({
        label: NATIVE_LOW_SHARED_DEVICE_ROUTE,
        ...(options.timestampWrites ? { timestampWrites: options.timestampWrites } : {}),
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4));
      pass.end();
      encodedFrameCount += 1;
    },
    async sampleSupportStats() {
      const values = await readU32Buffer(device, stats, STATS_BYTES, 'native-low shared-device support stats readback');
      lastStats = {
        supportPositiveCount: Number(values[0] || 0),
        supportPrevalence: Number(values[0] || 0) / highCells,
        highCellCount: highCells,
      };
      return { ...lastStats };
    },
    debugState() {
      return {
        routeIdentity: NATIVE_LOW_SHARED_DEVICE_ROUTE,
        transportMode: NATIVE_LOW_TRANSPORT_MODE,
        requestedBackend: 'WebGPU',
        effectiveBackend: 'WebGPU',
        fallbackBackend: null,
        modelIdentity: SELECTIVE_HEAD_LIVE_MODEL.identity,
        modelSha256,
        inputAuthority: NATIVE_LOW_INPUT_AUTHORITY,
        featureAuthority: NATIVE_LOW_FEATURE_AUTHORITY,
        effectiveFeatureCount: SELECTIVE_HEAD_LIVE_MODEL.features.featureCount,
        noHiddenCaps: true,
        encodedFrameCount,
        ...lastStats,
      };
    },
    destroy() {
      lowSnapshotFluid.destroy();
      lowSnapshotFront.destroy();
      predictedFluid.destroy();
      predictedFront.destroy();
      stats.destroy();
      model.destroy();
    },
  };
}

export async function createNativeLowSelectiveLiveRuntime(options = {}) {
  return createNativeLowSelectiveSharedDeviceRuntime(options);
}
