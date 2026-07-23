import {
  SELECTIVE_HEAD_LIVE_MODEL,
  SELECTIVE_HEAD_LIVE_MODEL_URL,
} from './models/selective-head-live/exact-basin-160-to-128-v0/model.generated.js';

export { SELECTIVE_HEAD_LIVE_MODEL, SELECTIVE_HEAD_LIVE_MODEL_URL };

export const SELECTIVE_HEAD_LIVE_ROUTE = 'exact-basin-selective-head-live-v0';
export const SELECTIVE_HEAD_LIVE_PAIR_AUTHORITY = 'downsampled-same-high-history-input-to-exact-high-target';
export const SELECTIVE_HEAD_LIVE_FLUID_DOWNSAMPLE = 'box-average-linear-field-v0';
export const SELECTIVE_HEAD_LIVE_FRONT_DOWNSAMPLE = 'max-pool-support-field-v0';
export const SELECTIVE_HEAD_LIVE_FEATURE_AUTHORITY = 'full-low-field-plus-spatial-rbf-features-v0';

const HIGH_GRID = 160;
const LOW_GRID = 128;
const SLOTS_PER_CELL = 4;
const FEATURE_COUNT = 185;
const HIDDEN_WIDTH = 48;

function output(channel) {
  const found = SELECTIVE_HEAD_LIVE_MODEL.outputs.find(item => item.channel === channel);
  if (!found) throw new Error(`selective live model omitted ${channel}`);
  return found;
}

function wgslOffsets(channel) {
  const offsets = output(channel).offsets;
  return [offsets.w1, offsets.b1, offsets.w2, offsets.b2, offsets.targetMean, offsets.targetStd].map(value => `${value}u`).join(', ');
}

const WGSL = `
const HIGH_GRID: u32 = ${HIGH_GRID}u;
const LOW_GRID: u32 = ${LOW_GRID}u;
const SLOTS_PER_CELL: u32 = ${SLOTS_PER_CELL}u;
const FEATURE_COUNT: u32 = ${FEATURE_COUNT}u;
const HIDDEN_WIDTH: u32 = ${HIDDEN_WIDTH}u;
const SUPPORT_THRESHOLD: f32 = ${SELECTIVE_HEAD_LIVE_MODEL.composition.supportThreshold};

@group(0) @binding(0) var<storage, read> highFluid: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> highFront: array<f32>;
@group(0) @binding(2) var<storage, read_write> lowFluid: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> lowFront: array<f32>;
@group(0) @binding(4) var<storage, read_write> predictedFluid: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> predictedFront: array<f32>;
@group(0) @binding(6) var<storage, read> model: array<f32>;
@group(0) @binding(7) var<storage, read_write> lowUpsampledFluid: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read_write> lowUpsampledFront: array<f32>;

fn index3(cell: vec3<u32>, grid: u32) -> u32 {
  return cell.x + cell.y * grid + cell.z * grid * grid;
}

fn overlapWeight(sourceIndex: u32, targetIndex: u32) -> f32 {
  let scale = f32(HIGH_GRID) / f32(LOW_GRID);
  let start = f32(targetIndex) * scale;
  let stop = f32(targetIndex + 1u) * scale;
  return max(0.0, min(stop, f32(sourceIndex + 1u)) - max(start, f32(sourceIndex))) / scale;
}

@compute @workgroup_size(4, 4, 4)
fn downsampleSameHighHistory(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(LOW_GRID))) { return; }
  let scale = f32(HIGH_GRID) / f32(LOW_GRID);
  let first = vec3<u32>(floor(vec3<f32>(gid) * scale));
  let last = min(vec3<u32>(HIGH_GRID), vec3<u32>(ceil(vec3<f32>(gid + vec3<u32>(1u)) * scale)));
  var sums: array<vec4<f32>, 4>;
  sums[0] = vec4<f32>(0.0);
  sums[1] = vec4<f32>(0.0);
  sums[2] = vec4<f32>(0.0);
  sums[3] = vec4<f32>(0.0);
  var frontMaximum = 0.0;
  for (var z = first.z; z < last.z; z += 1u) {
    for (var y = first.y; y < last.y; y += 1u) {
      for (var x = first.x; x < last.x; x += 1u) {
        let source = vec3<u32>(x, y, z);
        let weight = overlapWeight(x, gid.x) * overlapWeight(y, gid.y) * overlapWeight(z, gid.z);
        let sourceIndex = index3(source, HIGH_GRID);
        for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
          sums[slot] += highFluid[sourceIndex * SLOTS_PER_CELL + slot] * weight;
        }
        frontMaximum = max(frontMaximum, highFront[sourceIndex]);
      }
    }
  }
  let targetIndex = index3(gid, LOW_GRID);
  for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
    lowFluid[targetIndex * SLOTS_PER_CELL + slot] = sums[slot];
  }
  lowFront[targetIndex] = frontMaximum;
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
fn reconstructSelectiveFields(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(HIGH_GRID))) { return; }
  let lowCell = min(vec3<u32>(LOW_GRID - 1u), vec3<u32>(floor(vec3<f32>(gid) * f32(LOW_GRID) / f32(HIGH_GRID))));
  let lowIndex = index3(lowCell, LOW_GRID);
  let highIndex = index3(gid, HIGH_GRID);
  var lowValues: array<f32, 17>;
  for (var slot = 0u; slot < SLOTS_PER_CELL; slot += 1u) {
    let value = lowFluid[lowIndex * SLOTS_PER_CELL + slot];
    lowValues[slot * 4u + 0u] = value.x;
    lowValues[slot * 4u + 1u] = value.y;
    lowValues[slot * 4u + 2u] = value.z;
    lowValues[slot * 4u + 3u] = value.w;
    lowUpsampledFluid[highIndex * SLOTS_PER_CELL + slot] = value;
    predictedFluid[highIndex * SLOTS_PER_CELL + slot] = value;
  }
  lowValues[16] = lowFront[lowIndex];
  lowUpsampledFront[highIndex] = lowValues[16];
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
  let frontResidual = inferHead(features, ${wgslOffsets('frontTopology')});
  var material = predictedFluid[highIndex * SLOTS_PER_CELL + 1u];
  var fire = predictedFluid[highIndex * SLOTS_PER_CELL + 2u];
  var micro = predictedFluid[highIndex * SLOTS_PER_CELL + 3u];
  if (hardSupport > 0.5) {
    material.z += inferHead(features, ${wgslOffsets('fuel')});
    fire.z += inferHead(features, ${wgslOffsets('visibleFireCarrier')});
    micro.z += inferHead(features, ${wgslOffsets('fireLick')});
  }
  predictedFluid[highIndex * SLOTS_PER_CELL + 1u] = material;
  predictedFluid[highIndex * SLOTS_PER_CELL + 2u] = fire;
  predictedFluid[highIndex * SLOTS_PER_CELL + 3u] = micro;
  predictedFront[highIndex] = lowValues[16] + frontResidual;
}
`;

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export async function createSelectiveHeadLiveRuntime({ device, sourceFluidBuffers, sourceFrontBuffers }) {
  if (!device || sourceFluidBuffers?.length !== 2 || sourceFrontBuffers?.length !== 2) {
    throw new Error('selective live runtime requires one WebGPU device and two high-grid source buffer pairs');
  }
  const response = await fetch(SELECTIVE_HEAD_LIVE_MODEL_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`selective live model fetch failed: ${response.status}`);
  const modelBytes = await response.arrayBuffer();
  const modelSha256 = await sha256Hex(modelBytes);
  if (modelBytes.byteLength !== SELECTIVE_HEAD_LIVE_MODEL.packed.byteLength || modelSha256 !== SELECTIVE_HEAD_LIVE_MODEL.packed.sha256) {
    throw new Error(`selective live model checksum mismatch: ${modelSha256}`);
  }
  const highCells = HIGH_GRID ** 3;
  const lowCells = LOW_GRID ** 3;
  const makeBuffer = (label, size) => device.createBuffer({
    label,
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const lowFluid = makeBuffer('kaminos selective live low fluid 128^3', lowCells * SLOTS_PER_CELL * 16);
  const lowFront = makeBuffer('kaminos selective live low front 128^3', lowCells * 4);
  const lowUpsampledFluid = makeBuffer('kaminos selective live low-upsampled fluid 160^3', highCells * SLOTS_PER_CELL * 16);
  const lowUpsampledFront = makeBuffer('kaminos selective live low-upsampled front 160^3', highCells * 4);
  const predictedFluid = makeBuffer('kaminos selective live predicted fluid 160^3', highCells * SLOTS_PER_CELL * 16);
  const predictedFront = makeBuffer('kaminos selective live predicted front 160^3', highCells * 4);
  const modelBuffer = device.createBuffer({
    label: `kaminos selective live model ${SELECTIVE_HEAD_LIVE_MODEL.identity}`,
    size: modelBytes.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(modelBuffer, 0, modelBytes);
  const shader = device.createShaderModule({ label: `kaminos ${SELECTIVE_HEAD_LIVE_ROUTE} wgsl`, code: WGSL });
  const compilation = await shader.getCompilationInfo();
  const errors = compilation.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(`selective live WGSL compilation failed:\n${errors.map(error => `${error.lineNum}:${error.linePos} ${error.message}`).join('\n')}`);
  const layout = device.createBindGroupLayout({
    label: `kaminos ${SELECTIVE_HEAD_LIVE_ROUTE} layout`,
    entries: Array.from({ length: 9 }, (_, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: binding === 0 || binding === 1 || binding === 6 ? 'read-only-storage' : 'storage' },
    })),
  });
  const pipelineLayout = device.createPipelineLayout({ label: `kaminos ${SELECTIVE_HEAD_LIVE_ROUTE} pipeline layout`, bindGroupLayouts: [layout] });
  const downsamplePipeline = device.createComputePipeline({
    label: `kaminos ${SELECTIVE_HEAD_LIVE_FLUID_DOWNSAMPLE} 160-to-128`,
    layout: pipelineLayout,
    compute: { module: shader, entryPoint: 'downsampleSameHighHistory' },
  });
  const reconstructPipeline = device.createComputePipeline({
    label: `kaminos ${SELECTIVE_HEAD_LIVE_ROUTE} reconstruct`,
    layout: pipelineLayout,
    compute: { module: shader, entryPoint: 'reconstructSelectiveFields' },
  });
  const bindGroups = sourceFluidBuffers.map((sourceFluid, index) => device.createBindGroup({
    label: `kaminos ${SELECTIVE_HEAD_LIVE_ROUTE} source ${index}`,
    layout,
    entries: [
      { binding: 0, resource: { buffer: sourceFluid } },
      { binding: 1, resource: { buffer: sourceFrontBuffers[index] } },
      { binding: 2, resource: { buffer: lowFluid } },
      { binding: 3, resource: { buffer: lowFront } },
      { binding: 4, resource: { buffer: predictedFluid } },
      { binding: 5, resource: { buffer: predictedFront } },
      { binding: 6, resource: { buffer: modelBuffer } },
      { binding: 7, resource: { buffer: lowUpsampledFluid } },
      { binding: 8, resource: { buffer: lowUpsampledFront } },
    ],
  }));
  let frameCount = 0;
  return {
    identity: SELECTIVE_HEAD_LIVE_ROUTE,
    modelIdentity: SELECTIVE_HEAD_LIVE_MODEL.identity,
    modelSha256,
    buffers: { lowUpsampledFluid, lowUpsampledFront, predictedFluid, predictedFront },
    encode(encoder, sourceIndex) {
      const bindGroup = bindGroups[sourceIndex];
      if (!bindGroup) throw new Error(`missing selective live source bind group ${sourceIndex}`);
      const downsample = encoder.beginComputePass({ label: 'kaminos selective live same-high-history downsample' });
      downsample.setPipeline(downsamplePipeline);
      downsample.setBindGroup(0, bindGroup);
      downsample.dispatchWorkgroups(Math.ceil(LOW_GRID / 4), Math.ceil(LOW_GRID / 4), Math.ceil(LOW_GRID / 4));
      downsample.end();
      const reconstruct = encoder.beginComputePass({ label: 'kaminos selective live frozen-head reconstruction' });
      reconstruct.setPipeline(reconstructPipeline);
      reconstruct.setBindGroup(0, bindGroup);
      reconstruct.dispatchWorkgroups(Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4), Math.ceil(HIGH_GRID / 4));
      reconstruct.end();
      frameCount += 1;
    },
    debugState() {
      return {
        routeIdentity: SELECTIVE_HEAD_LIVE_ROUTE,
        modelIdentity: SELECTIVE_HEAD_LIVE_MODEL.identity,
        modelSha256,
        featureAuthority: SELECTIVE_HEAD_LIVE_FEATURE_AUTHORITY,
        pairAuthority: SELECTIVE_HEAD_LIVE_PAIR_AUTHORITY,
        fluidDownsample: SELECTIVE_HEAD_LIVE_FLUID_DOWNSAMPLE,
        frontDownsample: SELECTIVE_HEAD_LIVE_FRONT_DOWNSAMPLE,
        supportThreshold: SELECTIVE_HEAD_LIVE_MODEL.composition.supportThreshold,
        encodedFrameCount: frameCount,
      };
    },
    destroy() {
      lowFluid.destroy();
      lowFront.destroy();
      lowUpsampledFluid.destroy();
      lowUpsampledFront.destroy();
      predictedFluid.destroy();
      predictedFront.destroy();
      modelBuffer.destroy();
    },
  };
}
