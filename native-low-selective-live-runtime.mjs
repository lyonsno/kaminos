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
export const NATIVE_LOW_SUPPORT_POSITIVE_RESIDUAL_DISPATCH = 'native-low-support-positive-residual-dispatch-v0';
export const NATIVE_LOW_SOURCE_PROXIMAL_TILE_CANDIDATE = 'native-low-source-proximal-tile-candidate-v0';

const LOW_GRID = 128;
const HIGH_GRID = 160;
const SLOTS_PER_CELL = 4;
const FEATURE_COUNT = 185;
const HIDDEN_WIDTH = 48;
const STATS_BYTES = 16;
const RESIDUAL_WORKGROUP_SIZE = 64;

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
const RESIDUAL_WORKGROUP_SIZE: u32 = ${RESIDUAL_WORKGROUP_SIZE}u;
const SUPPORT_THRESHOLD: f32 = ${SELECTIVE_HEAD_LIVE_MODEL.composition.supportThreshold};

@group(0) @binding(0) var<storage, read> lowFluid: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> lowFront: array<f32>;
@group(0) @binding(2) var<storage, read_write> predictedFluid: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> predictedFront: array<f32>;
@group(0) @binding(4) var<storage, read> model: array<f32>;
@group(0) @binding(5) var<storage, read_write> stats: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> lowSnapshotFluid: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> lowSnapshotFrontAndSupport: array<u32>;

struct FeatureBundle {
  features: array<f32, ${FEATURE_COUNT}>,
  frontValue: f32,
};

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

fn makeFeatureBundle(gid: vec3<u32>, writeBase: bool) -> FeatureBundle {
  let lowCell = min(vec3<u32>(LOW_GRID - 1u), vec3<u32>(floor(vec3<f32>(gid) * f32(LOW_GRID) / f32(HIGH_GRID))));
  let lowIndex = index3(lowCell, LOW_GRID);
  let highIndex = index3(gid, HIGH_GRID);
  if (writeBase && highIndex < LOW_GRID * LOW_GRID * LOW_GRID) {
    for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
      lowSnapshotFluid[highIndex * SLOTS_PER_CELL + slot] = lowFluid[highIndex * SLOTS_PER_CELL + slot];
    }
    lowSnapshotFrontAndSupport[highIndex] = bitcast<u32>(lowFront[highIndex]);
  }
  var lowValues: array<f32, 17>;
  for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
    let value = lowFluid[lowIndex * SLOTS_PER_CELL + slot];
    lowValues[slot * 4u + 0u] = value.x;
    lowValues[slot * 4u + 1u] = value.y;
    lowValues[slot * 4u + 2u] = value.z;
    lowValues[slot * 4u + 3u] = value.w;
    if (writeBase) {
      predictedFluid[highIndex * SLOTS_PER_CELL + slot] = value;
    }
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
  return FeatureBundle(features, lowValues[16]);
}

@compute @workgroup_size(4, 4, 4)
fn reconstructSupportAndFront(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(HIGH_GRID))) { return; }
  let highIndex = index3(gid, HIGH_GRID);
  let bundle = makeFeatureBundle(gid, true);
  let classifierLogit = inferHead(bundle.features, ${wgslOffsets('supportProbability')});
  let probability = 1.0 / (1.0 + exp(-clamp(classifierLogit, -30.0, 30.0)));
  let hardSupport = select(0.0, 1.0, probability >= SUPPORT_THRESHOLD);
  if (hardSupport > 0.5) {
    let compactIndex = atomicAdd(&stats[0], 1u);
    lowSnapshotFrontAndSupport[LOW_GRID * LOW_GRID * LOW_GRID + compactIndex] = highIndex;
  }
  predictedFront[highIndex] = bundle.frontValue + inferHead(bundle.features, ${wgslOffsets('frontTopology')});
}

@compute @workgroup_size(${RESIDUAL_WORKGROUP_SIZE})
fn reconstructSupportResiduals(@builtin(global_invocation_id) gid: vec3<u32>) {
  let supportCount = atomicLoad(&stats[0]);
  let compactIndex = gid.x;
  if (compactIndex >= supportCount) { return; }
  let highIndex = lowSnapshotFrontAndSupport[LOW_GRID * LOW_GRID * LOW_GRID + compactIndex];
  let z = highIndex / (HIGH_GRID * HIGH_GRID);
  let y = (highIndex - z * HIGH_GRID * HIGH_GRID) / HIGH_GRID;
  let x = highIndex - z * HIGH_GRID * HIGH_GRID - y * HIGH_GRID;
  let highCell = vec3<u32>(x, y, z);
  let bundle = makeFeatureBundle(highCell, false);
  var material = predictedFluid[highIndex * SLOTS_PER_CELL + 1u];
  var fire = predictedFluid[highIndex * SLOTS_PER_CELL + 2u];
  var micro = predictedFluid[highIndex * SLOTS_PER_CELL + 3u];
  material.z += inferHead(bundle.features, ${wgslOffsets('fuel')});
  fire.z += inferHead(bundle.features, ${wgslOffsets('visibleFireCarrier')});
  micro.z += inferHead(bundle.features, ${wgslOffsets('fireLick')});
  predictedFluid[highIndex * SLOTS_PER_CELL + 1u] = material;
  predictedFluid[highIndex * SLOTS_PER_CELL + 2u] = fire;
  predictedFluid[highIndex * SLOTS_PER_CELL + 3u] = micro;
}
`;

const FRONT_UPSAMPLE_WGSL = `
const LOW_GRID: u32 = ${LOW_GRID}u;
const HIGH_GRID: u32 = ${HIGH_GRID}u;

@group(0) @binding(0) var<storage, read> lowFront: array<f32>;
@group(0) @binding(1) var<storage, read_write> nativeUpsampleFront: array<f32>;

fn index3(cell: vec3<u32>, grid: u32) -> u32 {
  return cell.x + cell.y * grid + cell.z * grid * grid;
}

@compute @workgroup_size(4, 4, 4)
fn upsampleNativeFront(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(HIGH_GRID))) { return; }
  let lowCell = min(vec3<u32>(LOW_GRID - 1u), vec3<u32>(floor(vec3<f32>(gid) * f32(LOW_GRID) / f32(HIGH_GRID))));
  nativeUpsampleFront[index3(gid, HIGH_GRID)] = lowFront[index3(lowCell, LOW_GRID)];
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

async function readU32BufferRange(device, source, sourceOffset, byteLength, label) {
  if (byteLength <= 0) return new Uint32Array(0);
  const readback = device.createBuffer({
    label,
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: `${label} encoder` });
  encoder.copyBufferToBuffer(source, sourceOffset, readback, 0, byteLength);
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
  const lowFrontSnapshotAndSupportBytes = lowFrontBytes + highCells * Uint32Array.BYTES_PER_ELEMENT;
  const highFluidBytes = highCells * SLOTS_PER_CELL * 4 * Float32Array.BYTES_PER_ELEMENT;
  const highFrontBytes = highCells * Float32Array.BYTES_PER_ELEMENT;
  const makeBuffer = (label, size, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST) => device.createBuffer({ label, size, usage });
  const lowSnapshotFluid = makeBuffer('native-low shared-device low snapshot fluid 128^3', lowFluidBytes);
  const lowSnapshotFront = makeBuffer('native-low shared-device low snapshot front 128^3 plus support indices', lowFrontSnapshotAndSupportBytes);
  const predictedFluid = makeBuffer('native-low shared-device predicted fluid 160^3', highFluidBytes);
  const predictedFront = makeBuffer('native-low shared-device predicted front 160^3', highFrontBytes);
  const nativeUpsampleFront = makeBuffer('native-low shared-device native-upsample front 160^3', highFrontBytes);
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
  const pipelineLayout = device.createPipelineLayout({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} pipeline layout`, bindGroupLayouts: [layout] });
  const supportPipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} support+front`,
    layout: pipelineLayout,
    compute: { module: shader, entryPoint: 'reconstructSupportAndFront' },
  });
  const residualPipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} support-positive residuals`,
    layout: pipelineLayout,
    compute: { module: shader, entryPoint: 'reconstructSupportResiduals' },
  });
  const frontUpsampleShader = device.createShaderModule({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native front upsample WGSL`, code: FRONT_UPSAMPLE_WGSL });
  const frontUpsampleLayout = device.createBindGroupLayout({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native front upsample layout`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const frontUpsamplePipeline = device.createComputePipeline({
    label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native front upsample`,
    layout: device.createPipelineLayout({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native front upsample pipeline layout`, bindGroupLayouts: [frontUpsampleLayout] }),
    compute: { module: frontUpsampleShader, entryPoint: 'upsampleNativeFront' },
  });
  let encodedFrameCount = 0;
  let lastStats = {
    supportPositiveCount: 0,
    supportPrevalence: 0,
    highCellCount: highCells,
  };
  const makeInferenceWorkProfile = stats => {
    const supportPositiveCount = Number(stats?.supportPositiveCount || 0);
    const residualDispatchWorkgroups = Math.ceil(highCells / RESIDUAL_WORKGROUP_SIZE);
    const residualDispatchThreadCount = residualDispatchWorkgroups * RESIDUAL_WORKGROUP_SIZE;
    return {
      identity: 'native-low-shared-device-inference-work-profile-v0',
      supportCompactionActive: true,
      supportCompactionIdentity: NATIVE_LOW_SUPPORT_POSITIVE_RESIDUAL_DISPATCH,
      supportClassifierCoverage: 'full-grid-160^3',
      modelEvaluatedCellCount: highCells + supportPositiveCount,
      modelHeadEvaluationCount: highCells * 2 + supportPositiveCount * 3,
      supportClassifierEvaluatedCount: highCells,
      frontTopologyEvaluatedCount: highCells,
      supportPositiveCount,
      supportPrevalence: supportPositiveCount / highCells,
      supportCompactedCount: supportPositiveCount,
      residualHeadEvaluatedCount: supportPositiveCount * 3,
      residualHeadPolicy: 'frontTopology-full-grid+fuel-visibleFireCarrier-fireLick-support-positive-v0',
      residualDispatchMode: 'support-positive-direct-covered-dispatch-v0',
      residualDispatchWorkgroups,
      residualDispatchThreadCount,
      residualWorkgroupSize: RESIDUAL_WORKGROUP_SIZE,
      dispatchWorkgroups: [Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4)],
      featureCount: SELECTIVE_HEAD_LIVE_MODEL.features.featureCount,
      outputHeadCount: SELECTIVE_HEAD_LIVE_MODEL.outputs.length,
      hiddenSupportCap: false,
      droppedInputChannels: false,
    };
  };
  const makeEmptySupportTileProfile = (tileProfileReadbackMs = 0) => {
    const tileSize = 16;
    const tileGrid = Math.ceil(HIGH_GRID / tileSize);
    return {
      identity: 'native-low-support-proximal-tile-profile-v0',
      authority: 'diagnostic-compacted-support-index-readback-v0',
      diagnosticFullSupportPassRequired: true,
      tileProfileReadbackMs,
      tileSize,
      tileGrid,
      highCellCount: highCells,
      supportMass: 0,
      supportCentroid: null,
      supportExtent: null,
      activeTileCount: 0,
      activeTileCoverage: 0,
      projectedSupportFrontCellCount: 0,
      projectedCellReduction: 1,
      hiddenSupportCap: false,
      droppedInputChannels: false,
    };
  };
  const makeEmptySourceTileCandidate = (candidateReadbackMs = 0) => {
    const tileSize = 16;
    const tileGrid = Math.ceil(HIGH_GRID / tileSize);
    return {
      identity: NATIVE_LOW_SOURCE_PROXIMAL_TILE_CANDIDATE,
      authority: 'current-source-low-front-tile-prior-compared-to-frozen-dense-support-v0',
      candidateEvaluationMode: 'diagnostic-dense-route-comparison-not-active-treatment-v0',
      diagnosticFullDenseSupportPassRequired: true,
      denseRouteRetained: true,
      candidateReadbackMs,
      sourceFrontThreshold: 1e-6,
      sourceTileDilation: 1,
      tileSize,
      tileGrid,
      lowCellCount: lowCells,
      highCellCount: highCells,
      sourceActiveLowCellCount: 0,
      candidateTileCount: 0,
      candidateTileCoverage: 0,
      projectedCandidateCellCount: 0,
      projectedCellReduction: 1,
      denseSupportCount: 0,
      supportCoveredByCandidateCount: 0,
      supportMissedByCandidateCount: 0,
      supportMissRate: 0,
      candidateCapturesAllDenseSupport: true,
      hiddenSupportCap: false,
      droppedInputChannels: false,
    };
  };
  let lastSupportTileProfile = makeEmptySupportTileProfile();
  let lastSourceTileCandidate = makeEmptySourceTileCandidate();
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
    supportCompactionIdentity: NATIVE_LOW_SUPPORT_POSITIVE_RESIDUAL_DISPATCH,
    buffers: { lowSnapshotFluid, lowSnapshotFront, predictedFluid, predictedFront, nativeUpsampleFront },
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
      const supportTimestampWrites = options.stageTimestampWrites?.supportFront
        ? options.stageTimestampWrites.supportFront
        : options.timestampWrites
        ? { querySet: options.timestampWrites.querySet, beginningOfPassWriteIndex: options.timestampWrites.beginningOfPassWriteIndex }
        : null;
      const residualTimestampWrites = options.stageTimestampWrites?.supportPositiveResidual
        ? options.stageTimestampWrites.supportPositiveResidual
        : options.timestampWrites
        ? { querySet: options.timestampWrites.querySet, endOfPassWriteIndex: options.timestampWrites.endOfPassWriteIndex }
        : null;
      const supportPass = encoder.beginComputePass({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} support+front`,
        ...(supportTimestampWrites ? { timestampWrites: supportTimestampWrites } : {}),
      });
      supportPass.setPipeline(supportPipeline);
      supportPass.setBindGroup(0, bindGroup);
      supportPass.dispatchWorkgroups(Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4));
      supportPass.end();
      const residualPass = encoder.beginComputePass({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} support-positive residuals`,
        ...(residualTimestampWrites ? { timestampWrites: residualTimestampWrites } : {}),
      });
      residualPass.setPipeline(residualPipeline);
      residualPass.setBindGroup(0, bindGroup);
      residualPass.dispatchWorkgroups(Math.ceil((HIGH_GRID ** 3) / RESIDUAL_WORKGROUP_SIZE));
      residualPass.end();
      const upsampleBindGroup = device.createBindGroup({
        label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native front upsample bind group`,
        layout: frontUpsampleLayout,
        entries: [
          { binding: 0, resource: { buffer: sourceFront } },
          { binding: 1, resource: { buffer: nativeUpsampleFront } },
        ],
      });
      const upsamplePass = encoder.beginComputePass({ label: `${NATIVE_LOW_SHARED_DEVICE_ROUTE} native front upsample` });
      upsamplePass.setPipeline(frontUpsamplePipeline);
      upsamplePass.setBindGroup(0, upsampleBindGroup);
      upsamplePass.dispatchWorkgroups(Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4));
      upsamplePass.end();
      encodedFrameCount += 1;
    },
    async sampleSupportStats() {
      const values = await readU32Buffer(device, stats, STATS_BYTES, 'native-low shared-device support stats readback');
      lastStats = {
        supportPositiveCount: Number(values[0] || 0),
        supportPrevalence: Number(values[0] || 0) / highCells,
        residualDispatchWorkgroups: Math.ceil(highCells / RESIDUAL_WORKGROUP_SIZE),
        residualDispatchThreadCount: Math.ceil(highCells / RESIDUAL_WORKGROUP_SIZE) * RESIDUAL_WORKGROUP_SIZE,
        highCellCount: highCells,
      };
      lastStats.nativeLowInferenceWorkProfile = makeInferenceWorkProfile(lastStats);
      return { ...lastStats };
    },
    async sampleSupportTileProfile() {
      const started = performance.now();
      const supportMass = Number(lastStats.supportPositiveCount || 0);
      if (supportMass <= 0) {
        lastSupportTileProfile = makeEmptySupportTileProfile(performance.now() - started);
        return { ...lastSupportTileProfile };
      }
      const supportIndices = await readU32BufferRange(
        device,
        lowSnapshotFront,
        lowFrontBytes,
        supportMass * Uint32Array.BYTES_PER_ELEMENT,
        'native-low shared-device support-proximal tile profile readback',
      );
      const tileSize = 16;
      const tileGrid = Math.ceil(HIGH_GRID / tileSize);
      const activeTiles = new Set();
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let minX = HIGH_GRID;
      let minY = HIGH_GRID;
      let minZ = HIGH_GRID;
      let maxX = 0;
      let maxY = 0;
      let maxZ = 0;
      for (const highIndex of supportIndices) {
        const z = Math.floor(highIndex / (HIGH_GRID * HIGH_GRID));
        const y = Math.floor((highIndex - z * HIGH_GRID * HIGH_GRID) / HIGH_GRID);
        const x = highIndex - z * HIGH_GRID * HIGH_GRID - y * HIGH_GRID;
        sumX += x;
        sumY += y;
        sumZ += z;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
        const tx = Math.floor(x / tileSize);
        const ty = Math.floor(y / tileSize);
        const tz = Math.floor(z / tileSize);
        activeTiles.add(tx + ty * tileGrid + tz * tileGrid * tileGrid);
      }
      const activeTileCount = activeTiles.size;
      const tileCellCount = tileSize ** 3;
      const projectedSupportFrontCellCount = Math.min(highCells, activeTileCount * tileCellCount);
      lastSupportTileProfile = {
        identity: 'native-low-support-proximal-tile-profile-v0',
        authority: 'diagnostic-compacted-support-index-readback-v0',
        diagnosticFullSupportPassRequired: true,
        tileProfileReadbackMs: performance.now() - started,
        tileSize,
        tileGrid,
        highCellCount: highCells,
        supportMass,
        supportCentroid: {
          cell: { x: sumX / supportMass, y: sumY / supportMass, z: sumZ / supportMass },
          normalized: {
            x: (sumX / supportMass) / Math.max(1, HIGH_GRID - 1),
            y: (sumY / supportMass) / Math.max(1, HIGH_GRID - 1),
            z: (sumZ / supportMass) / Math.max(1, HIGH_GRID - 1),
          },
        },
        supportExtent: {
          minCell: { x: minX, y: minY, z: minZ },
          maxCell: { x: maxX, y: maxY, z: maxZ },
          sizeCells: { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 },
        },
        activeTileCount,
        activeTileCoverage: activeTileCount / (tileGrid ** 3),
        projectedSupportFrontCellCount,
        projectedCellReduction: 1 - projectedSupportFrontCellCount / highCells,
        hiddenSupportCap: false,
        droppedInputChannels: false,
      };
      return { ...lastSupportTileProfile };
    },
    async sampleSourceProximalTileCandidate(options = {}) {
      const started = performance.now();
      const sourceFrontThreshold = Number.isFinite(options.sourceFrontThreshold) ? Math.max(0, options.sourceFrontThreshold) : 1e-6;
      const sourceTileDilation = Number.isFinite(options.sourceTileDilation) ? Math.max(0, Math.floor(options.sourceTileDilation)) : 1;
      const tileSize = 16;
      const tileGrid = Math.ceil(HIGH_GRID / tileSize);
      const tileCellCount = tileSize ** 3;
      const candidateTiles = new Set();
      const addCandidateTile = (tx, ty, tz) => {
        if (tx < 0 || ty < 0 || tz < 0 || tx >= tileGrid || ty >= tileGrid || tz >= tileGrid) return;
        candidateTiles.add(tx + ty * tileGrid + tz * tileGrid * tileGrid);
      };
      const sourceBits = await readU32BufferRange(
        device,
        lowSnapshotFront,
        0,
        lowFrontBytes,
        'native-low shared-device source-proximal tile candidate low-front readback',
      );
      const sourceFront = new Float32Array(sourceBits.buffer);
      let sourceActiveLowCellCount = 0;
      for (let lowIndex = 0; lowIndex < sourceFront.length; lowIndex += 1) {
        const value = sourceFront[lowIndex];
        if (!Number.isFinite(value) || Math.abs(value) <= sourceFrontThreshold) continue;
        sourceActiveLowCellCount += 1;
        const z = Math.floor(lowIndex / (LOW_GRID * LOW_GRID));
        const y = Math.floor((lowIndex - z * LOW_GRID * LOW_GRID) / LOW_GRID);
        const x = lowIndex - z * LOW_GRID * LOW_GRID - y * LOW_GRID;
        const hx = Math.min(HIGH_GRID - 1, Math.floor(x * HIGH_GRID / LOW_GRID));
        const hy = Math.min(HIGH_GRID - 1, Math.floor(y * HIGH_GRID / LOW_GRID));
        const hz = Math.min(HIGH_GRID - 1, Math.floor(z * HIGH_GRID / LOW_GRID));
        const tx = Math.floor(hx / tileSize);
        const ty = Math.floor(hy / tileSize);
        const tz = Math.floor(hz / tileSize);
        for (let dz = -sourceTileDilation; dz <= sourceTileDilation; dz += 1) {
          for (let dy = -sourceTileDilation; dy <= sourceTileDilation; dy += 1) {
            for (let dx = -sourceTileDilation; dx <= sourceTileDilation; dx += 1) {
              addCandidateTile(tx + dx, ty + dy, tz + dz);
            }
          }
        }
      }
      const denseSupportCount = Number(lastStats.supportPositiveCount || 0);
      let supportMissedByCandidateCount = 0;
      if (denseSupportCount > 0) {
        const supportIndices = await readU32BufferRange(
          device,
          lowSnapshotFront,
          lowFrontBytes,
          denseSupportCount * Uint32Array.BYTES_PER_ELEMENT,
          'native-low shared-device source-proximal candidate support comparison readback',
        );
        for (const highIndex of supportIndices) {
          const z = Math.floor(highIndex / (HIGH_GRID * HIGH_GRID));
          const y = Math.floor((highIndex - z * HIGH_GRID * HIGH_GRID) / HIGH_GRID);
          const x = highIndex - z * HIGH_GRID * HIGH_GRID - y * HIGH_GRID;
          const tx = Math.floor(x / tileSize);
          const ty = Math.floor(y / tileSize);
          const tz = Math.floor(z / tileSize);
          const tileId = tx + ty * tileGrid + tz * tileGrid * tileGrid;
          if (!candidateTiles.has(tileId)) supportMissedByCandidateCount += 1;
        }
      }
      const candidateTileCount = candidateTiles.size;
      const projectedCandidateCellCount = Math.min(highCells, candidateTileCount * tileCellCount);
      const supportCoveredByCandidateCount = Math.max(0, denseSupportCount - supportMissedByCandidateCount);
      lastSourceTileCandidate = {
        identity: NATIVE_LOW_SOURCE_PROXIMAL_TILE_CANDIDATE,
        authority: 'current-source-low-front-tile-prior-compared-to-frozen-dense-support-v0',
        candidateEvaluationMode: 'diagnostic-dense-route-comparison-not-active-treatment-v0',
        diagnosticFullDenseSupportPassRequired: true,
        denseRouteRetained: true,
        candidateReadbackMs: performance.now() - started,
        sourceFrontThreshold,
        sourceTileDilation,
        tileSize,
        tileGrid,
        lowCellCount: lowCells,
        highCellCount: highCells,
        sourceActiveLowCellCount,
        candidateTileCount,
        candidateTileCoverage: candidateTileCount / (tileGrid ** 3),
        projectedCandidateCellCount,
        projectedCellReduction: 1 - projectedCandidateCellCount / highCells,
        denseSupportCount,
        supportCoveredByCandidateCount,
        supportMissedByCandidateCount,
        supportMissRate: denseSupportCount > 0 ? supportMissedByCandidateCount / denseSupportCount : 0,
        candidateCapturesAllDenseSupport: supportMissedByCandidateCount === 0,
        hiddenSupportCap: false,
        droppedInputChannels: false,
      };
      return { ...lastSourceTileCandidate };
    },
    debugState() {
      const nativeLowInferenceWorkProfile = lastStats.nativeLowInferenceWorkProfile || makeInferenceWorkProfile(lastStats);
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
        nativeLowInferenceWorkProfile,
        nativeLowSupportTileProfile: lastSupportTileProfile,
        nativeLowSourceTileCandidate: lastSourceTileCandidate,
        ...lastStats,
      };
    },
    destroy() {
      lowSnapshotFluid.destroy();
      lowSnapshotFront.destroy();
      predictedFluid.destroy();
      predictedFront.destroy();
      nativeUpsampleFront.destroy();
      stats.destroy();
      model.destroy();
    },
  };
}

export async function createNativeLowSelectiveLiveRuntime(options = {}) {
  return createNativeLowSelectiveSharedDeviceRuntime(options);
}
