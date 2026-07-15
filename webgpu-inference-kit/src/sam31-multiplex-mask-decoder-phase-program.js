import {
  assertAuthoritativeRouteWorkerResult,
  createRouteWorkerResult,
  defineWebGpuRoute,
} from './route-boundary.js';
import { createWebGpuInferenceRuntime } from './inference-runtime.js';
import { WEBGPU_BUFFER_USAGE, WEBGPU_SHADER_STAGE } from './runtime-primitives.js';
import { createKernelProfileMetadata, createRouteKernelProfileMetadata } from './kernel-profile.js';
import {
  createRouteReceiptArtifacts,
  createRouteReceiptInputArtifact,
  createWebGpuRouteReceiptFromArtifacts,
} from './route-receipt-helper.js';
import { createWebGpuRouteBackpressureProfile, createWebGpuRouteSchedulerProfile } from './scheduler-backpressure.js';
import {
  MEMORY_ATTENTION_ADD_WGSL,
  MEMORY_ATTENTION_LAYERNORM_WGSL,
  MEMORY_ATTENTION_LINEAR_WGSL,
  MEMORY_ATTENTION_ONLINE_SOFTMAX_WGSL,
} from './sam31-memory-attention-phase-program.js';
import { SAM31_EXACT_GELU_FUNCTIONS_WGSL } from './sam31-memory-encoder-phase-program.js';

export const SAM31_MULTIPLEX_MASK_DECODER_PHASE_PROGRAM_ROUTE_ID = 'sam3.1.multiplex-mask-decoder.phase-program.webgpu-local.v0';

const MODEL_ID = 'facebook/sam3.1';
const DEFAULT_KERNEL_PROFILE = 'sam31-multiplex-mask-decoder-phase-program-v0';
const INPUT_ROLES = ['source-frame', 'sam31-multiplex-decoder-tensors', 'sam31-multiplex-decoder-weights'];
const OUTPUT_ROLES = [
  { key: 'samTokens', role: 'sam31-multiplex-sam-output-tokens', required: true },
  { key: 'maskLogits', role: 'sam31-multiplex-mask-logits', required: true },
  { key: 'selectedMasks', role: 'sam31-multiplex-selected-masks', required: true },
  { key: 'objectScores', role: 'sam31-multiplex-object-scores', required: true },
  { key: 'objectPointers', role: 'sam31-multiplex-object-pointers', required: true },
];

function requiredStages() {
  const stages = ['multiplex-decoder-load-tensors'];
  for (let layer = 0; layer < 2; layer += 1) {
    stages.push(
      `multiplex-decoder-layer-${layer}-self-attention`,
      `multiplex-decoder-layer-${layer}-token-to-image`,
      `multiplex-decoder-layer-${layer}-mlp`,
      `multiplex-decoder-layer-${layer}-image-to-token`,
      `multiplex-decoder-layer-${layer}-readback`,
    );
  }
  stages.push(
    'multiplex-decoder-final-token-to-image',
    'multiplex-decoder-mask-upscaling',
    'multiplex-decoder-mask-hypernetworks',
    'multiplex-decoder-attribute-heads',
    'multiplex-decoder-object-pointer-projection',
    'multiplex-decoder-readback',
  );
  return stages;
}

function createDefaultScheduler() {
  const stages = requiredStages();
  const chunks = Object.fromEntries(stages.map(stage => [stage, 1]));
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks, unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: stages.map(stage => ({ name: `${stage}-phase`, stage, kind: stage.endsWith('readback') ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: stages.map(stage => ({ name: `after-${stage}`, kind: stage.endsWith('readback') ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: !stage.endsWith('readback') })),
      notes: 'The SAM3.1 multiplex decoder yields between every two-way attention block, attribute head, and object-pointer projection boundary.',
    },
  });
}

function createDefaultBackpressure() {
  return createWebGpuRouteBackpressureProfile({ requestedBudget: 'visible-wait', effectiveBudget: 'visible-wait', memoryExclusivity: 'shared', warmCacheState: 'unknown' });
}

function ensureFloat32Array(value, name) {
  if (!(value instanceof Float32Array)) throw new Error(`${name} must be a Float32Array`);
  return value;
}

function normalizeInputs(input = {}) {
  const shape = input.shape || {};
  const expectedShape = {
    batch: 1, multiplexCount: 16, maskOutputsPerObject: 3, attributeTokens: 32,
    maskTokens: 48, queryTokens: 80, channels: 256,
    heads: 8, attentionChannels: 128, mlpHidden: 2048, layerCount: 2,
  };
  for (const [key, expected] of Object.entries(expectedShape)) {
    if (shape[key] !== expected) throw new Error(`shape.${key} must equal ${expected}`);
  }
  for (const key of ['imageHeight', 'imageWidth', 'imageTokens', 'maskHeight', 'maskWidth']) {
    if (!Number.isInteger(shape[key]) || shape[key] <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  if (shape.imageTokens !== shape.imageHeight * shape.imageWidth) throw new Error('shape.imageTokens must equal imageHeight * imageWidth');
  if (shape.maskHeight !== shape.imageHeight * 4 || shape.maskWidth !== shape.imageWidth * 4) throw new Error('mask dimensions must be four times the image feature dimensions');
  const tensors = input.tensors || {};
  const imageEmbedding = ensureFloat32Array(tensors.imageEmbedding, 'tensors.imageEmbedding');
  const imagePosition = ensureFloat32Array(tensors.imagePosition, 'tensors.imagePosition');
  const highResolutionS0 = ensureFloat32Array(tensors.highResolutionS0, 'tensors.highResolutionS0');
  const highResolutionS1 = ensureFloat32Array(tensors.highResolutionS1, 'tensors.highResolutionS1');
  const extraPerObjectEmbedding = ensureFloat32Array(tensors.extraPerObjectEmbedding, 'tensors.extraPerObjectEmbedding');
  if (imageEmbedding.length !== shape.imageTokens * 256 || imagePosition.length !== shape.imageTokens * 256) throw new Error('image embedding and position length mismatch');
  if (highResolutionS0.length !== 32 * shape.maskHeight * shape.maskWidth || highResolutionS1.length !== 64 * shape.imageHeight * 2 * shape.imageWidth * 2) throw new Error('high-resolution decoder feature length mismatch');
  if (extraPerObjectEmbedding.length !== 16 * 256) throw new Error('extra per-object embedding length mismatch');
  if (!input.weights || typeof input.weights !== 'object') throw new Error('weights are required');
  const weights = {};
  for (const [key, value] of Object.entries(input.weights)) weights[key] = ensureFloat32Array(value, `weights.${key}`);
  return { shape: { ...shape, ...expectedShape }, imageEmbedding, imagePosition, highResolutionS0, highResolutionS1, extraPerObjectEmbedding, weights };
}

function weight(weights, key, expectedLength) {
  const value = weights[key];
  if (!(value instanceof Float32Array)) throw new Error(`missing checkpoint weight ${key}`);
  if (expectedLength !== undefined && value.length !== expectedLength) throw new Error(`checkpoint weight ${key} length mismatch: ${value.length} != ${expectedLength}`);
  return value;
}

function projection(weights, prefix, inputChannels, outputChannels) {
  return {
    weight: weight(weights, `${prefix}.weight`, inputChannels * outputChannels),
    bias: weight(weights, `${prefix}.bias`, outputChannels),
    inputChannels,
    outputChannels,
  };
}

function norm(weights, prefix) {
  return { weight: weight(weights, `${prefix}.weight`, 256), bias: weight(weights, `${prefix}.bias`, 256) };
}

function add(left, right) {
  const output = new Float32Array(left.length);
  for (let index = 0; index < output.length; index += 1) output[index] = left[index] + right[index];
  return output;
}

function layerNorm(values, spec, tokens, channels = 256) {
  const output = new Float32Array(values.length);
  for (let token = 0; token < tokens; token += 1) {
    const base = token * channels;
    let mean = 0;
    for (let channel = 0; channel < channels; channel += 1) mean += values[base + channel];
    mean /= channels;
    let variance = 0;
    for (let channel = 0; channel < channels; channel += 1) variance += (values[base + channel] - mean) ** 2;
    variance /= channels;
    const inverse = 1 / Math.sqrt(variance + 1e-5);
    for (let channel = 0; channel < channels; channel += 1) output[base + channel] = (values[base + channel] - mean) * inverse * spec.weight[channel] + spec.bias[channel];
  }
  return output;
}

function linear(values, spec, tokens, relu = false) {
  const output = new Float32Array(tokens * spec.outputChannels);
  for (let token = 0; token < tokens; token += 1) {
    for (let out = 0; out < spec.outputChannels; out += 1) {
      let sum = spec.bias[out];
      const inputBase = token * spec.inputChannels;
      const weightBase = out * spec.inputChannels;
      for (let input = 0; input < spec.inputChannels; input += 1) sum += values[inputBase + input] * spec.weight[weightBase + input];
      output[token * spec.outputChannels + out] = relu ? Math.max(0, sum) : sum;
    }
  }
  return output;
}

function attention(query, key, value, queryTokens, keyTokens, channels, heads) {
  const output = new Float32Array(queryTokens * channels);
  const headDim = channels / heads;
  const scale = 1 / Math.sqrt(headDim);
  for (let head = 0; head < heads; head += 1) {
    for (let queryToken = 0; queryToken < queryTokens; queryToken += 1) {
      let maximum = -Infinity;
      const logits = new Float64Array(keyTokens);
      for (let keyToken = 0; keyToken < keyTokens; keyToken += 1) {
        let dot = 0;
        for (let channel = 0; channel < headDim; channel += 1) {
          const offset = head * headDim + channel;
          dot += query[queryToken * channels + offset] * key[keyToken * channels + offset];
        }
        logits[keyToken] = dot * scale;
        maximum = Math.max(maximum, logits[keyToken]);
      }
      let denominator = 0;
      for (let keyToken = 0; keyToken < keyTokens; keyToken += 1) denominator += Math.exp(logits[keyToken] - maximum);
      for (let channel = 0; channel < headDim; channel += 1) {
        let sum = 0;
        for (let keyToken = 0; keyToken < keyTokens; keyToken += 1) {
          sum += Math.exp(logits[keyToken] - maximum) / denominator * value[keyToken * channels + head * headDim + channel];
        }
        output[queryToken * channels + head * headDim + channel] = sum;
      }
    }
  }
  return output;
}

function buildPointEmbedding(weights, extra) {
  const objectTokens = weight(weights, 'obj_score_token.weight', 16 * 256);
  const iouTokens = weight(weights, 'iou_token.weight', 16 * 256);
  const maskTokens = weight(weights, 'mask_tokens.weight', 48 * 256);
  const output = new Float32Array(80 * 256);
  output.set(objectTokens, 0);
  output.set(iouTokens, 16 * 256);
  for (let object = 0; object < 16; object += 1) {
    for (let mask = 0; mask < 3; mask += 1) {
      const token = object * 3 + mask;
      for (let channel = 0; channel < 256; channel += 1) {
        output[(32 + token) * 256 + channel] = maskTokens[token * 256 + channel] + extra[object * 256 + channel];
      }
    }
  }
  return output;
}

function attentionCpu({ queryInput, keyInput, valueInput, queryTokens, keyTokens, weights, prefix, internalChannels }) {
  const q = linear(queryInput, projection(weights, `${prefix}.q_proj`, 256, internalChannels), queryTokens);
  const k = linear(keyInput, projection(weights, `${prefix}.k_proj`, 256, internalChannels), keyTokens);
  const v = linear(valueInput, projection(weights, `${prefix}.v_proj`, 256, internalChannels), keyTokens);
  return linear(attention(q, k, v, queryTokens, keyTokens, internalChannels, 8), projection(weights, `${prefix}.out_proj`, internalChannels, 256), queryTokens);
}

function mlpCpu(values, tokens, weights, prefix, outputChannels = 256) {
  const first = linear(values, projection(weights, `${prefix}.layers.0`, 256, 256), tokens, true);
  const second = linear(first, projection(weights, `${prefix}.layers.1`, 256, 256), tokens, true);
  return linear(second, projection(weights, `${prefix}.layers.2`, 256, outputChannels), tokens);
}

function convTranspose2dNchw(input, inputChannels, inputHeight, inputWidth, outputChannels, kernelWeight, bias) {
  const outputHeight = inputHeight * 2;
  const outputWidth = inputWidth * 2;
  const output = new Float32Array(outputChannels * outputHeight * outputWidth);
  for (let outputChannel = 0; outputChannel < outputChannels; outputChannel += 1) {
    for (let outputY = 0; outputY < outputHeight; outputY += 1) {
      for (let outputX = 0; outputX < outputWidth; outputX += 1) {
        let sum = bias[outputChannel];
        for (let kernelY = 0; kernelY < 2; kernelY += 1) {
          const inputYDelta = outputY - kernelY;
          if (inputYDelta < 0 || inputYDelta % 2 !== 0) continue;
          const inputY = inputYDelta / 2;
          if (inputY >= inputHeight) continue;
          for (let kernelX = 0; kernelX < 2; kernelX += 1) {
            const inputXDelta = outputX - kernelX;
            if (inputXDelta < 0 || inputXDelta % 2 !== 0) continue;
            const inputX = inputXDelta / 2;
            if (inputX >= inputWidth) continue;
            for (let inputChannel = 0; inputChannel < inputChannels; inputChannel += 1) {
              const inputIndex = (inputChannel * inputHeight + inputY) * inputWidth + inputX;
              const weightIndex = ((inputChannel * outputChannels + outputChannel) * 2 + kernelY) * 2 + kernelX;
              sum += input[inputIndex] * kernelWeight[weightIndex];
            }
          }
        }
        output[(outputChannel * outputHeight + outputY) * outputWidth + outputX] = sum;
      }
    }
  }
  return output;
}

function layerNorm2dNchw(input, channels, height, width, normWeight, normBias) {
  const output = new Float32Array(input.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let mean = 0;
      for (let channel = 0; channel < channels; channel += 1) mean += input[(channel * height + y) * width + x];
      mean /= channels;
      let variance = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        const delta = input[(channel * height + y) * width + x] - mean;
        variance += delta * delta;
      }
      const inverse = 1 / Math.sqrt(variance / channels + 1e-6);
      for (let channel = 0; channel < channels; channel += 1) {
        const index = (channel * height + y) * width + x;
        output[index] = (input[index] - mean) * inverse * normWeight[channel] + normBias[channel];
      }
    }
  }
  return output;
}

function geluExactApprox(value) {
  if (value < -10) return 0;
  if (value > 10) return value;
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value / Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * magnitude);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-magnitude * magnitude));
  return 0.5 * value * (1 + erf);
}

function tokenMajorToNchw(input, channels, height, width) {
  const output = new Float32Array(input.length);
  const spatial = height * width;
  for (let position = 0; position < spatial; position += 1) {
    for (let channel = 0; channel < channels; channel += 1) output[channel * spatial + position] = input[position * channels + channel];
  }
  return output;
}

function decoderMasksCpu(finalQueries, finalKeys, highResolutionS0, highResolutionS1, weights, shape) {
  const intermediateHeight = shape.imageHeight * 2;
  const intermediateWidth = shape.imageWidth * 2;
  const maskSpatial = shape.maskHeight * shape.maskWidth;
  let upscaled = convTranspose2dNchw(
    tokenMajorToNchw(finalKeys, 256, shape.imageHeight, shape.imageWidth),
    256, shape.imageHeight, shape.imageWidth, 64,
    weight(weights, 'output_upscaling.0.weight', 256 * 64 * 2 * 2),
    weight(weights, 'output_upscaling.0.bias', 64),
  );
  upscaled = add(upscaled, highResolutionS1);
  upscaled = layerNorm2dNchw(upscaled, 64, intermediateHeight, intermediateWidth, weight(weights, 'output_upscaling.1.weight', 64), weight(weights, 'output_upscaling.1.bias', 64));
  for (let index = 0; index < upscaled.length; index += 1) upscaled[index] = geluExactApprox(upscaled[index]);
  upscaled = convTranspose2dNchw(upscaled, 64, intermediateHeight, intermediateWidth, 32, weight(weights, 'output_upscaling.3.weight', 64 * 32 * 2 * 2), weight(weights, 'output_upscaling.3.bias', 32));
  upscaled = add(upscaled, highResolutionS0);
  for (let index = 0; index < upscaled.length; index += 1) upscaled[index] = geluExactApprox(upscaled[index]);

  const masks = new Float32Array(16 * 3 * maskSpatial);
  for (let mask = 0; mask < 3; mask += 1) {
    const tokens = new Float32Array(16 * 256);
    for (let object = 0; object < 16; object += 1) {
      const sourceToken = 32 + object * 3 + mask;
      tokens.set(finalQueries.subarray(sourceToken * 256, (sourceToken + 1) * 256), object * 256);
    }
    const hyper = mlpCpu(tokens, 16, weights, `output_hypernetworks_mlps.${mask}`, 32);
    for (let object = 0; object < 16; object += 1) {
      for (let spatial = 0; spatial < maskSpatial; spatial += 1) {
        let sum = 0;
        for (let channel = 0; channel < 32; channel += 1) sum += hyper[object * 32 + channel] * upscaled[channel * maskSpatial + spatial];
        masks[(object * 3 + mask) * maskSpatial + spatial] = sum;
      }
    }
  }
  return masks;
}

export function createSam31MultiplexMaskDecoderPhaseProgramCpuOracle(input = {}) {
  const { shape, imageEmbedding, imagePosition, highResolutionS0, highResolutionS1, extraPerObjectEmbedding, weights } = normalizeInputs(input);
  const pointEmbedding = buildPointEmbedding(weights, extraPerObjectEmbedding);
  const maskSpatial = shape.maskHeight * shape.maskWidth;
  let queries = new Float32Array(pointEmbedding);
  let keys = new Float32Array(imageEmbedding);
  const layerQueries = [];
  const layerKeys = [];
  for (let layer = 0; layer < 2; layer += 1) {
    const base = `transformer.layers.${layer}`;
    if (layer === 0) {
      queries = layerNorm(attentionCpu({ queryInput: queries, keyInput: queries, valueInput: queries, queryTokens: 80, keyTokens: 80, weights, prefix: `${base}.self_attn`, internalChannels: 256 }), norm(weights, `${base}.norm1`), 80);
    } else {
      const queryWithPosition = add(queries, pointEmbedding);
      queries = layerNorm(add(queries, attentionCpu({ queryInput: queryWithPosition, keyInput: queryWithPosition, valueInput: queries, queryTokens: 80, keyTokens: 80, weights, prefix: `${base}.self_attn`, internalChannels: 256 })), norm(weights, `${base}.norm1`), 80);
    }
    queries = layerNorm(add(queries, attentionCpu({ queryInput: add(queries, pointEmbedding), keyInput: add(keys, imagePosition), valueInput: keys, queryTokens: 80, keyTokens: shape.imageTokens, weights, prefix: `${base}.cross_attn_token_to_image`, internalChannels: 128 })), norm(weights, `${base}.norm2`), 80);
    const mlp = linear(linear(queries, projection(weights, `${base}.mlp.lin1`, 256, 2048), 80, true), projection(weights, `${base}.mlp.lin2`, 2048, 256), 80);
    queries = layerNorm(add(queries, mlp), norm(weights, `${base}.norm3`), 80);
    keys = layerNorm(add(keys, attentionCpu({ queryInput: add(keys, imagePosition), keyInput: add(queries, pointEmbedding), valueInput: queries, queryTokens: shape.imageTokens, keyTokens: 80, weights, prefix: `${base}.cross_attn_image_to_token`, internalChannels: 128 })), norm(weights, `${base}.norm4`), shape.imageTokens);
    layerQueries.push(new Float32Array(queries));
    layerKeys.push(new Float32Array(keys));
  }
  queries = layerNorm(add(queries, attentionCpu({ queryInput: add(queries, pointEmbedding), keyInput: add(keys, imagePosition), valueInput: keys, queryTokens: 80, keyTokens: shape.imageTokens, weights, prefix: 'transformer.final_attn_token_to_image', internalChannels: 128 })), norm(weights, 'transformer.norm_final_attn'), 80);
  const objectTokens = queries.slice(0, 16 * 256);
  const iouTokens = queries.slice(16 * 256, 32 * 256);
  const samTokens = queries.slice(32 * 256);
  const iou = mlpCpu(iouTokens, 16, weights, 'iou_prediction_head', 3);
  const objectScores = mlpCpu(objectTokens, 16, weights, 'pred_obj_score_head', 1);
  const masks = decoderMasksCpu(queries, keys, highResolutionS0, highResolutionS1, weights, shape);
  const selectedTokens = new Float32Array(16 * 256);
  const selectedMasks = new Float32Array(16 * maskSpatial);
  const bestMaskIndices = new Float32Array(16);
  for (let object = 0; object < 16; object += 1) {
    let best = 0;
    for (let mask = 1; mask < 3; mask += 1) if (iou[object * 3 + mask] > iou[object * 3 + best]) best = mask;
    bestMaskIndices[object] = best;
    selectedTokens.set(samTokens.subarray((object * 3 + best) * 256, (object * 3 + best + 1) * 256), object * 256);
    selectedMasks.set(masks.subarray((object * 3 + best) * maskSpatial, (object * 3 + best + 1) * maskSpatial), object * maskSpatial);
  }
  const projectedPointers = mlpCpu(selectedTokens, 16, weights, 'object-pointer', 256);
  const noObjectPointers = linear(projectedPointers, projection(weights, 'no-object-pointer', 256, 256), 16);
  const objectPointers = new Float32Array(projectedPointers.length);
  for (let object = 0; object < 16; object += 1) objectPointers.set((objectScores[object] > 0 ? projectedPointers : noObjectPointers).subarray(object * 256, (object + 1) * 256), object * 256);
  return { shape, pointEmbedding, layerQueries, layerKeys, finalQueries: queries, finalKeys: keys, samTokens, masks, iou, objectScores, bestMaskIndices, selectedMasks, projectedPointers, objectPointers };
}

export function createSam31MultiplexMaskDecoderPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, { defaultProfile: DEFAULT_KERNEL_PROFILE, requiredStages: requiredStages(), timingSource: 'queue-submit-wait' });
  return defineWebGpuRoute({
    routeId: SAM31_MULTIPLEX_MASK_DECODER_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: MODEL_ID, revision: input.model?.revision || 'sam31-official-multiplex-decoder', dtype: 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(({ role }) => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    requiredFeatures: [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: { exportName: 'runSam31MultiplexMaskDecoderPhaseProgramRoute', upstreamBoundary: 'sam31-propagation-features-to-object-pointers' },
  });
}

function roleArtifact(artifacts, role) {
  const artifact = Array.isArray(artifacts) ? artifacts.find(entry => entry?.role === role) : artifacts?.[role];
  if (!artifact) throw new Error(`${role} artifact is required`);
  return artifact;
}

function createReceipt(input = {}) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM31_MULTIPLEX_MASK_DECODER_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: SAM31_MULTIPLEX_MASK_DECODER_PHASE_PROGRAM_ROUTE_ID,
    status: 'real', fallbackReason: null, backend: input.backend,
    model: { id: MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-frame', input.sourceFrame),
      createRouteReceiptInputArtifact('sam31-multiplex-decoder-tensors', input.decoderTensors),
      createRouteReceiptInputArtifact('sam31-multiplex-decoder-weights', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

const LINEAR_RELU_WGSL = `
struct LinearDims { input_channels: u32, output_channels: u32, total_output: u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LinearDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let output_channel = index % dims.output_channels;
  let token = index / dims.output_channels;
  var value = bias[output_channel];
  for (var channel = 0u; channel < dims.input_channels; channel = channel + 1u) {
    value += input_values[token * dims.input_channels + channel] * weight[output_channel * dims.input_channels + channel];
  }
  output_values[index] = max(value, 0.0);
}
`;

const LINEAR_OFFSET_WGSL = `
struct LinearOffsetDims { input_channels: u32, output_channels: u32, total_output: u32, input_token_offset: u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LinearOffsetDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let output_channel = index % dims.output_channels;
  let token = index / dims.output_channels;
  var value = bias[output_channel];
  for (var channel = 0u; channel < dims.input_channels; channel = channel + 1u) {
    value += input_values[(token + dims.input_token_offset) * dims.input_channels + channel] * weight[output_channel * dims.input_channels + channel];
  }
  output_values[index] = max(value, 0.0);
}
`;

const MASK_TRANSPOSE_CONV2D_NCHW_WGSL = `
struct ConvDims {
  input_channels: u32, input_height: u32, input_width: u32,
  output_channels: u32, output_height: u32, output_width: u32,
  kernel_height: u32, kernel_width: u32, total_output: u32,
};
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: ConvDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let output_x = index % dims.output_width;
  let output_y = (index / dims.output_width) % dims.output_height;
  let output_channel = (index / (dims.output_width * dims.output_height)) % dims.output_channels;
  let batch = index / (dims.output_channels * dims.output_width * dims.output_height);
  var sum = bias[output_channel];
  for (var kernel_y = 0u; kernel_y < dims.kernel_height; kernel_y = kernel_y + 1u) {
    if (output_y < kernel_y || ((output_y - kernel_y) % 2u) != 0u) { continue; }
    let input_y = (output_y - kernel_y) / 2u;
    if (input_y >= dims.input_height) { continue; }
    for (var kernel_x = 0u; kernel_x < dims.kernel_width; kernel_x = kernel_x + 1u) {
      if (output_x < kernel_x || ((output_x - kernel_x) % 2u) != 0u) { continue; }
      let input_x = (output_x - kernel_x) / 2u;
      if (input_x >= dims.input_width) { continue; }
      for (var input_channel = 0u; input_channel < dims.input_channels; input_channel = input_channel + 1u) {
        let input_index = ((batch * dims.input_channels + input_channel) * dims.input_height + input_y) * dims.input_width + input_x;
        let weight_index = ((input_channel * dims.output_channels + output_channel) * dims.kernel_height + kernel_y) * dims.kernel_width + kernel_x;
        sum += input_values[input_index] * weight[weight_index];
      }
    }
  }
  output_values[index] = sum;
}
`;

const MASK_LAYERNORM2D_NCHW_WGSL = `
struct NormDims { channels: u32, height: u32, width: u32, total_spatial: u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> norm_weight: array<f32>;
@group(0) @binding(2) var<storage, read> norm_bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: NormDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let spatial_index = gid.x;
  if (spatial_index >= dims.total_spatial) { return; }
  let plane = dims.height * dims.width;
  let batch = spatial_index / plane;
  let spatial = spatial_index % plane;
  var mean = 0.0;
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    mean += input_values[(batch * dims.channels + channel) * plane + spatial];
  }
  mean /= f32(dims.channels);
  var variance = 0.0;
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    let delta = input_values[(batch * dims.channels + channel) * plane + spatial] - mean;
    variance += delta * delta;
  }
  let inverse = inverseSqrt(variance / f32(dims.channels) + 0.000001);
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    let index = (batch * dims.channels + channel) * plane + spatial;
    output_values[index] = (input_values[index] - mean) * inverse * norm_weight[channel] + norm_bias[channel];
  }
}
`;

const MASK_GELU_WGSL = `
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;
${SAM31_EXACT_GELU_FUNCTIONS_WGSL}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= arrayLength(&output_values)) { return; }
  output_values[gid.x] = gelu_exact_approx(input_values[gid.x]);
}
`;

const TOKEN_MAJOR_TO_NCHW_WGSL = `
struct TransposeDims { channels: u32, spatial: u32, total: u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(2) var<uniform> dims: TransposeDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total) { return; }
  let channel = index / dims.spatial;
  let position = index % dims.spatial;
  output_values[index] = input_values[position * dims.channels + channel];
}
`;

const MASK_TOKEN_GATHER_WGSL = `
struct MaskDims { mask_index: u32, mask_spatial: u32, };
@group(0) @binding(0) var<storage, read> query_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> selected_tokens: array<f32>;
@group(0) @binding(2) var<uniform> dims: MaskDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= 4096u) { return; }
  let object = index / 256u;
  let channel = index % 256u;
  let source_token = 32u + object * 3u + dims.mask_index;
  selected_tokens[index] = query_values[source_token * 256u + channel];
}
`;

const MASK_DOT_WGSL = `
struct MaskDims { mask_index: u32, mask_spatial: u32, };
@group(0) @binding(0) var<storage, read> hyper_values: array<f32>;
@group(0) @binding(1) var<storage, read> upscaled_values: array<f32>;
@group(0) @binding(2) var<storage, read_write> mask_values: array<f32>;
@group(0) @binding(3) var<uniform> dims: MaskDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= 16u * dims.mask_spatial) { return; }
  let object = index / dims.mask_spatial;
  let spatial = index % dims.mask_spatial;
  var sum = 0.0;
  for (var channel = 0u; channel < 32u; channel = channel + 1u) {
    sum += hyper_values[object * 32u + channel] * upscaled_values[channel * dims.mask_spatial + spatial];
  }
  mask_values[(object * 3u + dims.mask_index) * dims.mask_spatial + spatial] = sum;
}
`;

const SELECT_MASK_WGSL = `
struct MaskDims { mask_index: u32, mask_spatial: u32, };
@group(0) @binding(0) var<storage, read> mask_values: array<f32>;
@group(0) @binding(1) var<storage, read> best_indices: array<f32>;
@group(0) @binding(2) var<storage, read_write> selected_masks: array<f32>;
@group(0) @binding(3) var<uniform> dims: MaskDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= 16u * dims.mask_spatial) { return; }
  let object = index / dims.mask_spatial;
  let spatial = index % dims.mask_spatial;
  let best = u32(best_indices[object]);
  selected_masks[index] = mask_values[(object * 3u + best) * dims.mask_spatial + spatial];
}
`;

const ARGMAX_GATHER_WGSL = `
@group(0) @binding(0) var<storage, read> iou_values: array<f32>;
@group(0) @binding(1) var<storage, read> mask_tokens: array<f32>;
@group(0) @binding(2) var<storage, read_write> best_indices: array<f32>;
@group(0) @binding(3) var<storage, read_write> selected_tokens: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= 4096u) { return; }
  let object = index / 256u;
  let channel = index % 256u;
  var best = 0u;
  if (iou_values[object * 3u + 1u] > iou_values[object * 3u + best]) { best = 1u; }
  if (iou_values[object * 3u + 2u] > iou_values[object * 3u + best]) { best = 2u; }
  if (channel == 0u) { best_indices[object] = f32(best); }
  selected_tokens[index] = mask_tokens[(32u + object * 3u + best) * 256u + channel];
}
`;

const POINTER_BLEND_WGSL = `
@group(0) @binding(0) var<storage, read> object_scores: array<f32>;
@group(0) @binding(1) var<storage, read> projected: array<f32>;
@group(0) @binding(2) var<storage, read> no_object: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= 4096u) { return; }
  output_values[index] = select(no_object[index], projected[index], object_scores[index / 256u] > 0.0);
}
`;

function tensorBinding(name, access = 'read-only-storage') { return { name, resource: `tensor:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, access }; }
function uniformBinding(name) { return { name: 'dims', resource: `uniform:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }; }
function workgroups(total) { return Math.ceil(total / 64); }
async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
function gpuWeightName(key) { return `weight_${key.replaceAll('.', '_').replaceAll('-', '_')}`; }

export async function runSam31MultiplexMaskDecoderPhaseProgramRoute(input = {}) {
  if (!input.request) throw new Error('request is required');
  const normalized = normalizeInputs(input.tensors || {});
  const { shape, imageEmbedding, imagePosition, highResolutionS0, highResolutionS1, extraPerObjectEmbedding, weights } = normalized;
  const route = input.route || createSam31MultiplexMaskDecoderPhaseProgramRouteDefinition({ kernel: input.kernel, model: input.model });
  const runtime = await createWebGpuInferenceRuntime({
    routeId: route.routeId,
    runtimeLabel: 'sam31-multiplex-mask-decoder-phase-program',
    device: input.device, queue: input.queue, adapter: input.adapter, adapterName: input.adapterName,
    browser: input.browser, backendIdentity: input.backendIdentity, kernel: input.kernel || route.kernel,
    requiredStages: requiredStages(), timingSource: 'queue-submit-wait', waitForSubmittedWorkDone: true, yieldMs: 0,
    residentTensorResolver: input.residentTensorResolver,
  });
  const pointEmbedding = buildPointEmbedding(weights, extraPerObjectEmbedding);
  const imageValues = shape.imageTokens * 256;
  const intermediateHeight = shape.imageHeight * 2;
  const intermediateWidth = shape.imageWidth * 2;
  const intermediateSpatial = intermediateHeight * intermediateWidth;
  const maskSpatial = shape.maskHeight * shape.maskWidth;
  const attentionStorageValues = Math.max(80, shape.imageTokens) * 256;
  const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
  const readonly = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
  let gpu;
  const allWeightKeys = Object.keys(weights);
  await runtime.runStage('multiplex-decoder-load-tensors', async stage => {
    const create = (name, length, tensorUsage = usage, sourceData = undefined) => stage.createTensor({ name: `sam31.multiplex-decoder.${name}`, shape: [length], dtype: 'f32', usage: tensorUsage, ...(sourceData ? { sourceData } : {}) });
    gpu = {
      point: create('point-embedding', 80 * 256, readonly), image: create('image', imageValues, readonly), imagePosition: create('image-position', imageValues, readonly),
      highResolutionS0: create('high-resolution-s0', 32 * maskSpatial, readonly), highResolutionS1: create('high-resolution-s1', 64 * intermediateSpatial, readonly),
      hiddenA: create('hidden-a', 80 * 256), hiddenB: create('hidden-b', 80 * 256), keyA: create('key-a', imageValues), keyB: create('key-b', imageValues),
      querySum: create('query-sum', 80 * 256), keySum: create('key-sum', imageValues), q: create('q', attentionStorageValues), k: create('k', attentionStorageValues), v: create('v', attentionStorageValues),
      attention: create('attention', attentionStorageValues), projected: create('projected', attentionStorageValues), mlp: create('mlp', 80 * 2048),
      iouHiddenA: create('iou-hidden-a', 16 * 256), iouHiddenB: create('iou-hidden-b', 16 * 256), iou: create('iou', 16 * 3),
      objectHiddenA: create('object-hidden-a', 16 * 256), objectHiddenB: create('object-hidden-b', 16 * 256), objectScores: create('object-scores', 16),
      samTokens: create('sam-tokens', 48 * 256), bestIndices: create('best-indices', 16), selectedTokens: create('selected-tokens', 16 * 256),
      maskImageNchw: create('mask-image-nchw', imageValues), upscaled64: create('upscaled-64', 64 * intermediateSpatial), upscaled64Skip: create('upscaled-64-skip', 64 * intermediateSpatial), upscaled64Norm: create('upscaled-64-norm', 64 * intermediateSpatial),
      upscaled32: create('upscaled-32', 32 * maskSpatial), upscaled32Skip: create('upscaled-32-skip', 32 * maskSpatial), upscaledFinal: create('upscaled-final', 32 * maskSpatial),
      hyperA: create('hyper-a', 16 * 256), hyperB: create('hyper-b', 16 * 256), hyperOut: create('hyper-out', 16 * 32), masks: create('masks', 16 * 3 * maskSpatial), selectedMasks: create('selected-masks', 16 * maskSpatial),
      pointerA: create('pointer-a', 16 * 256), pointerB: create('pointer-b', 16 * 256), projectedPointers: create('projected-pointers', 16 * 256), noObjectPointers: create('no-object-pointers', 16 * 256), objectPointers: create('object-pointers', 16 * 256),
      weights: {}, uniforms: {},
    };
    stage.uploadTensor(gpu.point, pointEmbedding);
    stage.uploadTensor(gpu.image, imageEmbedding);
    stage.uploadTensor(gpu.keyA, imageEmbedding);
    stage.uploadTensor(gpu.imagePosition, imagePosition);
    stage.uploadTensor(gpu.highResolutionS0, highResolutionS0);
    stage.uploadTensor(gpu.highResolutionS1, highResolutionS1);
    for (const key of allWeightKeys) {
      gpu.weights[key] = create(gpuWeightName(key), weights[key].length, readonly, weights[key]);
      stage.uploadTensor(gpu.weights[key], weights[key]);
    }
    const uniform = (name, schema, values) => stage.createUniformBuffer({ label: `sam31.multiplex-decoder.${name}`, schema, values });
    const linearSchema = [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }];
    const offsetSchema = [...linearSchema, { name: 'input_token_offset', type: 'u32' }];
    const attentionSchema = [{ name: 'batch', type: 'u32' }, { name: 'query_tokens', type: 'u32' }, { name: 'key_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'heads', type: 'u32' }, { name: 'head_dim', type: 'u32' }];
    const normSchema = [{ name: 'total_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }];
    const addSchema = [{ name: 'total', type: 'u32' }, { name: 'scale', type: 'f32' }];
    const convSchema = [
      { name: 'input_channels', type: 'u32' }, { name: 'input_height', type: 'u32' }, { name: 'input_width', type: 'u32' },
      { name: 'output_channels', type: 'u32' }, { name: 'output_height', type: 'u32' }, { name: 'output_width', type: 'u32' },
      { name: 'kernel_height', type: 'u32' }, { name: 'kernel_width', type: 'u32' }, { name: 'total_output', type: 'u32' },
    ];
    const norm2dSchema = [{ name: 'channels', type: 'u32' }, { name: 'height', type: 'u32' }, { name: 'width', type: 'u32' }, { name: 'total_spatial', type: 'u32' }];
    const transposeSchema = [{ name: 'channels', type: 'u32' }, { name: 'spatial', type: 'u32' }, { name: 'total', type: 'u32' }];
    const maskSchema = [{ name: 'mask_index', type: 'u32' }, { name: 'mask_spatial', type: 'u32' }];
    gpu.uniforms = {
      add80: uniform('add80', addSchema, { total: 80 * 256, scale: 1 }), addImage: uniform('addImage', addSchema, { total: imageValues, scale: 1 }), seed80: uniform('seed80', addSchema, { total: 80 * 256, scale: 0 }),
      norm80: uniform('norm80', normSchema, { total_tokens: 80, channels: 256 }), normImage: uniform('normImage', normSchema, { total_tokens: shape.imageTokens, channels: 256 }),
      linear80x256: uniform('linear80x256', linearSchema, { input_channels: 256, output_channels: 256, total_output: 80 * 256 }),
      linear80x128: uniform('linear80x128', linearSchema, { input_channels: 256, output_channels: 128, total_output: 80 * 128 }),
      linearImagex128: uniform('linearImagex128', linearSchema, { input_channels: 256, output_channels: 128, total_output: shape.imageTokens * 128 }),
      linear80From128: uniform('linear80From128', linearSchema, { input_channels: 128, output_channels: 256, total_output: 80 * 256 }),
      linearImageFrom128: uniform('linearImageFrom128', linearSchema, { input_channels: 128, output_channels: 256, total_output: imageValues }),
      mlp80In: uniform('mlp80In', linearSchema, { input_channels: 256, output_channels: 2048, total_output: 80 * 2048 }),
      mlp80Out: uniform('mlp80Out', linearSchema, { input_channels: 2048, output_channels: 256, total_output: 80 * 256 }),
      selfAttention: uniform('selfAttention', attentionSchema, { batch: 1, query_tokens: 80, key_tokens: 80, channels: 256, heads: 8, head_dim: 32 }),
      tokenImageAttention: uniform('tokenImageAttention', attentionSchema, { batch: 1, query_tokens: 80, key_tokens: shape.imageTokens, channels: 128, heads: 8, head_dim: 16 }),
      imageTokenAttention: uniform('imageTokenAttention', attentionSchema, { batch: 1, query_tokens: shape.imageTokens, key_tokens: 80, channels: 128, heads: 8, head_dim: 16 }),
      iouOffset: uniform('iouOffset', offsetSchema, { input_channels: 256, output_channels: 256, total_output: 16 * 256, input_token_offset: 16 }),
      objectOffset: uniform('objectOffset', offsetSchema, { input_channels: 256, output_channels: 256, total_output: 16 * 256, input_token_offset: 0 }),
      headHidden: uniform('headHidden', linearSchema, { input_channels: 256, output_channels: 256, total_output: 16 * 256 }),
      iouOut: uniform('iouOut', linearSchema, { input_channels: 256, output_channels: 3, total_output: 16 * 3 }),
      objectOut: uniform('objectOut', linearSchema, { input_channels: 256, output_channels: 1, total_output: 16 }),
      pointer: uniform('pointer', linearSchema, { input_channels: 256, output_channels: 256, total_output: 16 * 256 }),
      hyperOut: uniform('hyperOut', linearSchema, { input_channels: 256, output_channels: 32, total_output: 16 * 32 }),
      maskConv0: uniform('maskConv0', convSchema, { input_channels: 256, input_height: shape.imageHeight, input_width: shape.imageWidth, output_channels: 64, output_height: intermediateHeight, output_width: intermediateWidth, kernel_height: 2, kernel_width: 2, total_output: 64 * intermediateSpatial }),
      maskConv1: uniform('maskConv1', convSchema, { input_channels: 64, input_height: intermediateHeight, input_width: intermediateWidth, output_channels: 32, output_height: shape.maskHeight, output_width: shape.maskWidth, kernel_height: 2, kernel_width: 2, total_output: 32 * maskSpatial }),
      maskNorm: uniform('maskNorm', norm2dSchema, { channels: 64, height: intermediateHeight, width: intermediateWidth, total_spatial: intermediateSpatial }),
      maskImageTranspose: uniform('maskImageTranspose', transposeSchema, { channels: 256, spatial: shape.imageTokens, total: imageValues }),
      mask0: uniform('mask0', maskSchema, { mask_index: 0, mask_spatial: maskSpatial }), mask1: uniform('mask1', maskSchema, { mask_index: 1, mask_spatial: maskSpatial }), mask2: uniform('mask2', maskSchema, { mask_index: 2, mask_spatial: maskSpatial }),
      addIntermediate: uniform('addIntermediate', addSchema, { total: 64 * intermediateSpatial, scale: 1 }), addMask: uniform('addMask', addSchema, { total: 32 * maskSpatial, scale: 1 }),
    };
  });

  const programTensors = Object.fromEntries(Object.entries(gpu).filter(([name]) => !['weights', 'uniforms'].includes(name)));
  for (const [key, tensor] of Object.entries(gpu.weights)) programTensors[gpuWeightName(key)] = tensor;
  const kernels = {};
  const phases = [];
  const tb = (name, access = 'read-only-storage') => tensorBinding(name, access);
  const w = key => gpuWeightName(key);
  const addKernel = (name, code, bindings) => { kernels[name] = { code, bindings }; };
  const linearBindings = (source, prefix, target, dims, code = MEMORY_ATTENTION_LINEAR_WGSL) => {
    const name = `${target}_${prefix.replaceAll('.', '_')}`;
    addKernel(name, code, [tb(source), tb(w(`${prefix}.weight`)), tb(w(`${prefix}.bias`)), tb(target, 'storage'), uniformBinding(dims)]);
    return name;
  };
  const normKernel = (name, source, prefix, target, dims) => addKernel(name, MEMORY_ATTENTION_LAYERNORM_WGSL, [tb(source), tb(w(`${prefix}.weight`)), tb(w(`${prefix}.bias`)), tb(target, 'storage'), uniformBinding(dims)]);
  const addOp = (name, left, right, target, dims) => addKernel(name, MEMORY_ATTENTION_ADD_WGSL, [tb(left), tb(right), tb(target, 'storage'), uniformBinding(dims)]);
  const attentionOp = (name, q, k, v, target, dims) => addKernel(name, MEMORY_ATTENTION_ONLINE_SOFTMAX_WGSL, [tb(q), tb(k), tb(v), tb(target, 'storage'), uniformBinding(dims)]);
  const dispatchLinear = (name, total) => ({ name, kernel: name, dispatch: [workgroups(total)] });

  for (let layer = 0; layer < 2; layer += 1) {
    const base = `transformer.layers.${layer}`;
    const selfInput = layer === 0 ? 'hiddenA' : 'querySum';
    if (layer === 0) phases.push({ name: 'multiplex-decoder-seed-queries', kernel: (() => { addOp('seedQueries', 'point', 'point', 'hiddenA', 'seed80'); return 'seedQueries'; })(), dispatch: [workgroups(80 * 256)] });
    else {
      addOp(`layer${layer}SelfPosition`, 'hiddenA', 'point', 'querySum', 'add80');
      phases.push({ name: `multiplex-decoder-layer-${layer}-self-position`, kernel: `layer${layer}SelfPosition`, dispatch: [workgroups(80 * 256)] });
    }
    const selfQ = linearBindings(selfInput, `${base}.self_attn.q_proj`, 'q', 'linear80x256');
    const selfK = linearBindings(selfInput, `${base}.self_attn.k_proj`, 'k', 'linear80x256');
    const selfV = linearBindings('hiddenA', `${base}.self_attn.v_proj`, 'v', 'linear80x256');
    attentionOp(`layer${layer}SelfAttention`, 'q', 'k', 'v', 'attention', 'selfAttention');
    const selfOut = linearBindings('attention', `${base}.self_attn.out_proj`, 'projected', 'linear80x256');
    if (layer === 0) normKernel(`layer${layer}Norm1`, 'projected', `${base}.norm1`, 'hiddenA', 'norm80');
    else {
      addOp(`layer${layer}SelfResidual`, 'hiddenA', 'projected', 'hiddenB', 'add80');
      normKernel(`layer${layer}Norm1`, 'hiddenB', `${base}.norm1`, 'hiddenA', 'norm80');
    }
    phases.push(
      { name: `multiplex-decoder-layer-${layer}-self-q`, kernel: selfQ, dispatch: [workgroups(80 * 256)] },
      { name: `multiplex-decoder-layer-${layer}-self-k`, kernel: selfK, dispatch: [workgroups(80 * 256)] },
      { name: `multiplex-decoder-layer-${layer}-self-v`, kernel: selfV, dispatch: [workgroups(80 * 256)] },
      { name: `multiplex-decoder-layer-${layer}-self-attention`, kernel: `layer${layer}SelfAttention`, dispatch: [80, 8, 1], yieldAfter: true },
      { name: `multiplex-decoder-layer-${layer}-self-output`, kernel: selfOut, dispatch: [workgroups(80 * 256)] },
      ...(layer === 0 ? [] : [{ name: `multiplex-decoder-layer-${layer}-self-residual`, kernel: `layer${layer}SelfResidual`, dispatch: [workgroups(80 * 256)] }]),
      { name: `multiplex-decoder-layer-${layer}-self-norm`, kernel: `layer${layer}Norm1`, dispatch: [workgroups(80)] },
    );

    addOp(`layer${layer}TokenQueryPosition`, 'hiddenA', 'point', 'querySum', 'add80');
    addOp(`layer${layer}ImageKeyPosition`, 'keyA', 'imagePosition', 'keySum', 'addImage');
    const tokenQ = linearBindings('querySum', `${base}.cross_attn_token_to_image.q_proj`, 'q', 'linear80x128');
    const imageK = linearBindings('keySum', `${base}.cross_attn_token_to_image.k_proj`, 'k', 'linearImagex128');
    const imageV = linearBindings('keyA', `${base}.cross_attn_token_to_image.v_proj`, 'v', 'linearImagex128');
    attentionOp(`layer${layer}TokenImageAttention`, 'q', 'k', 'v', 'attention', 'tokenImageAttention');
    const tokenImageOut = linearBindings('attention', `${base}.cross_attn_token_to_image.out_proj`, 'projected', 'linear80From128');
    addOp(`layer${layer}TokenImageResidual`, 'hiddenA', 'projected', 'hiddenB', 'add80');
    normKernel(`layer${layer}Norm2`, 'hiddenB', `${base}.norm2`, 'hiddenA', 'norm80');
    phases.push(
      { name: `multiplex-decoder-layer-${layer}-token-query-position`, kernel: `layer${layer}TokenQueryPosition`, dispatch: [workgroups(80 * 256)] },
      { name: `multiplex-decoder-layer-${layer}-image-key-position`, kernel: `layer${layer}ImageKeyPosition`, dispatch: [workgroups(imageValues)] },
      dispatchLinear(tokenQ, 80 * 128), dispatchLinear(imageK, shape.imageTokens * 128), dispatchLinear(imageV, shape.imageTokens * 128),
      { name: `multiplex-decoder-layer-${layer}-token-to-image`, kernel: `layer${layer}TokenImageAttention`, dispatch: [80, 8, 1], yieldAfter: true },
      dispatchLinear(tokenImageOut, 80 * 256),
      { name: `multiplex-decoder-layer-${layer}-token-image-residual`, kernel: `layer${layer}TokenImageResidual`, dispatch: [workgroups(80 * 256)] },
      { name: `multiplex-decoder-layer-${layer}-norm2`, kernel: `layer${layer}Norm2`, dispatch: [workgroups(80)] },
    );

    const mlp1 = linearBindings('hiddenA', `${base}.mlp.lin1`, 'mlp', 'mlp80In', LINEAR_RELU_WGSL);
    const mlp2 = linearBindings('mlp', `${base}.mlp.lin2`, 'projected', 'mlp80Out');
    addOp(`layer${layer}MlpResidual`, 'hiddenA', 'projected', 'hiddenB', 'add80');
    normKernel(`layer${layer}Norm3`, 'hiddenB', `${base}.norm3`, 'hiddenA', 'norm80');
    phases.push(dispatchLinear(mlp1, 80 * 2048), dispatchLinear(mlp2, 80 * 256),
      { name: `multiplex-decoder-layer-${layer}-mlp`, kernel: `layer${layer}MlpResidual`, dispatch: [workgroups(80 * 256)], yieldAfter: true },
      { name: `multiplex-decoder-layer-${layer}-norm3`, kernel: `layer${layer}Norm3`, dispatch: [workgroups(80)] });

    addOp(`layer${layer}ImageQueryPosition`, 'keyA', 'imagePosition', 'keySum', 'addImage');
    addOp(`layer${layer}TokenKeyPosition`, 'hiddenA', 'point', 'querySum', 'add80');
    const imageQ = linearBindings('keySum', `${base}.cross_attn_image_to_token.q_proj`, 'q', 'linearImagex128');
    const tokenK = linearBindings('querySum', `${base}.cross_attn_image_to_token.k_proj`, 'k', 'linear80x128');
    const tokenV = linearBindings('hiddenA', `${base}.cross_attn_image_to_token.v_proj`, 'v', 'linear80x128');
    attentionOp(`layer${layer}ImageTokenAttention`, 'q', 'k', 'v', 'attention', 'imageTokenAttention');
    const imageTokenOut = linearBindings('attention', `${base}.cross_attn_image_to_token.out_proj`, 'projected', 'linearImageFrom128');
    addOp(`layer${layer}ImageTokenResidual`, 'keyA', 'projected', 'keyB', 'addImage');
    normKernel(`layer${layer}Norm4`, 'keyB', `${base}.norm4`, 'keyA', 'normImage');
    phases.push(
      { name: `multiplex-decoder-layer-${layer}-image-query-position`, kernel: `layer${layer}ImageQueryPosition`, dispatch: [workgroups(imageValues)] },
      { name: `multiplex-decoder-layer-${layer}-token-key-position`, kernel: `layer${layer}TokenKeyPosition`, dispatch: [workgroups(80 * 256)] },
      dispatchLinear(imageQ, shape.imageTokens * 128), dispatchLinear(tokenK, 80 * 128), dispatchLinear(tokenV, 80 * 128),
      { name: `multiplex-decoder-layer-${layer}-image-to-token`, kernel: `layer${layer}ImageTokenAttention`, dispatch: [shape.imageTokens, 8, 1], yieldAfter: true },
      dispatchLinear(imageTokenOut, imageValues),
      { name: `multiplex-decoder-layer-${layer}-image-token-residual`, kernel: `layer${layer}ImageTokenResidual`, dispatch: [workgroups(imageValues)] },
      { name: `multiplex-decoder-layer-${layer}-norm4`, kernel: `layer${layer}Norm4`, dispatch: [workgroups(shape.imageTokens)] },
      { name: `multiplex-decoder-layer-${layer}-readback`, readbacks: [{ name: `layer${layer}Queries`, tensor: 'hiddenA' }, { name: `layer${layer}Keys`, tensor: 'keyA' }] },
    );
  }

  addOp('finalQueryPosition', 'hiddenA', 'point', 'querySum', 'add80');
  addOp('finalKeyPosition', 'keyA', 'imagePosition', 'keySum', 'addImage');
  const finalQ = linearBindings('querySum', 'transformer.final_attn_token_to_image.q_proj', 'q', 'linear80x128');
  const finalK = linearBindings('keySum', 'transformer.final_attn_token_to_image.k_proj', 'k', 'linearImagex128');
  const finalV = linearBindings('keyA', 'transformer.final_attn_token_to_image.v_proj', 'v', 'linearImagex128');
  attentionOp('finalTokenImageAttention', 'q', 'k', 'v', 'attention', 'tokenImageAttention');
  const finalOut = linearBindings('attention', 'transformer.final_attn_token_to_image.out_proj', 'projected', 'linear80From128');
  addOp('finalResidual', 'hiddenA', 'projected', 'hiddenB', 'add80');
  normKernel('finalNorm', 'hiddenB', 'transformer.norm_final_attn', 'hiddenA', 'norm80');
  phases.push(
    { name: 'multiplex-decoder-final-query-position', kernel: 'finalQueryPosition', dispatch: [workgroups(80 * 256)] },
    { name: 'multiplex-decoder-final-key-position', kernel: 'finalKeyPosition', dispatch: [workgroups(imageValues)] },
    dispatchLinear(finalQ, 80 * 128), dispatchLinear(finalK, shape.imageTokens * 128), dispatchLinear(finalV, shape.imageTokens * 128),
    { name: 'multiplex-decoder-final-token-to-image', kernel: 'finalTokenImageAttention', dispatch: [80, 8, 1], yieldAfter: true },
    dispatchLinear(finalOut, 80 * 256),
    { name: 'multiplex-decoder-final-residual', kernel: 'finalResidual', dispatch: [workgroups(80 * 256)] },
    { name: 'multiplex-decoder-final-norm', kernel: 'finalNorm', dispatch: [workgroups(80)] },
  );

  addKernel('maskImageTranspose', TOKEN_MAJOR_TO_NCHW_WGSL, [tb('keyA'), tb('maskImageNchw', 'storage'), uniformBinding('maskImageTranspose')]);
  addKernel('maskConv0', MASK_TRANSPOSE_CONV2D_NCHW_WGSL, [tb('maskImageNchw'), tb(w('output_upscaling.0.weight')), tb(w('output_upscaling.0.bias')), tb('upscaled64', 'storage'), uniformBinding('maskConv0')]);
  addOp('maskSkipS1', 'upscaled64', 'highResolutionS1', 'upscaled64Skip', 'addIntermediate');
  addKernel('maskNormS1', MASK_LAYERNORM2D_NCHW_WGSL, [tb('upscaled64Skip'), tb(w('output_upscaling.1.weight')), tb(w('output_upscaling.1.bias')), tb('upscaled64Norm', 'storage'), uniformBinding('maskNorm')]);
  addKernel('maskGeluS1', MASK_GELU_WGSL, [tb('upscaled64Norm'), tb('upscaled64', 'storage')]);
  addKernel('maskConv1', MASK_TRANSPOSE_CONV2D_NCHW_WGSL, [tb('upscaled64'), tb(w('output_upscaling.3.weight')), tb(w('output_upscaling.3.bias')), tb('upscaled32', 'storage'), uniformBinding('maskConv1')]);
  addOp('maskSkipS0', 'upscaled32', 'highResolutionS0', 'upscaled32Skip', 'addMask');
  addKernel('maskGeluS0', MASK_GELU_WGSL, [tb('upscaled32Skip'), tb('upscaledFinal', 'storage')]);
  phases.push(
    { name: 'multiplex-decoder-mask-image-transpose', kernel: 'maskImageTranspose', dispatch: [workgroups(imageValues)] },
    { name: 'multiplex-decoder-mask-upscale-conv0', kernel: 'maskConv0', dispatch: [workgroups(64 * intermediateSpatial)] },
    { name: 'multiplex-decoder-mask-s1-residual', kernel: 'maskSkipS1', dispatch: [workgroups(64 * intermediateSpatial)] },
    { name: 'multiplex-decoder-mask-s1-norm', kernel: 'maskNormS1', dispatch: [workgroups(intermediateSpatial)] },
    { name: 'multiplex-decoder-mask-s1-gelu', kernel: 'maskGeluS1', dispatch: [workgroups(64 * intermediateSpatial)] },
    { name: 'multiplex-decoder-mask-upscale-conv1', kernel: 'maskConv1', dispatch: [workgroups(32 * maskSpatial)] },
    { name: 'multiplex-decoder-mask-s0-residual', kernel: 'maskSkipS0', dispatch: [workgroups(32 * maskSpatial)] },
    { name: 'multiplex-decoder-mask-upscaling', kernel: 'maskGeluS0', dispatch: [workgroups(32 * maskSpatial)], yieldAfter: true },
  );

  for (let mask = 0; mask < 3; mask += 1) {
    const gather = `maskTokenGather${mask}`;
    const dot = `maskDot${mask}`;
    addKernel(gather, MASK_TOKEN_GATHER_WGSL, [tb('hiddenA'), tb('selectedTokens', 'storage'), uniformBinding(`mask${mask}`)]);
    const hyper0 = linearBindings('selectedTokens', `output_hypernetworks_mlps.${mask}.layers.0`, 'hyperA', 'pointer', LINEAR_RELU_WGSL);
    const hyper1 = linearBindings('hyperA', `output_hypernetworks_mlps.${mask}.layers.1`, 'hyperB', 'pointer', LINEAR_RELU_WGSL);
    const hyper2 = linearBindings('hyperB', `output_hypernetworks_mlps.${mask}.layers.2`, 'hyperOut', 'hyperOut');
    addKernel(dot, MASK_DOT_WGSL, [tb('hyperOut'), tb('upscaledFinal'), tb('masks', 'storage'), uniformBinding(`mask${mask}`)]);
    phases.push(
      { name: `multiplex-decoder-mask-${mask}-token-gather`, kernel: gather, dispatch: [workgroups(16 * 256)] },
      dispatchLinear(hyper0, 16 * 256), dispatchLinear(hyper1, 16 * 256), dispatchLinear(hyper2, 16 * 32),
      { name: mask === 2 ? 'multiplex-decoder-mask-hypernetworks' : `multiplex-decoder-mask-${mask}-dot`, kernel: dot, dispatch: [workgroups(16 * maskSpatial)], ...(mask === 2 ? { yieldAfter: true } : {}) },
    );
  }

  addKernel('iouLayer0', LINEAR_OFFSET_WGSL, [tb('hiddenA'), tb(w('iou_prediction_head.layers.0.weight')), tb(w('iou_prediction_head.layers.0.bias')), tb('iouHiddenA', 'storage'), uniformBinding('iouOffset')]);
  const iou1 = linearBindings('iouHiddenA', 'iou_prediction_head.layers.1', 'iouHiddenB', 'headHidden', LINEAR_RELU_WGSL);
  const iou2 = linearBindings('iouHiddenB', 'iou_prediction_head.layers.2', 'iou', 'iouOut');
  addKernel('objectLayer0', LINEAR_OFFSET_WGSL, [tb('hiddenA'), tb(w('pred_obj_score_head.layers.0.weight')), tb(w('pred_obj_score_head.layers.0.bias')), tb('objectHiddenA', 'storage'), uniformBinding('objectOffset')]);
  const object1 = linearBindings('objectHiddenA', 'pred_obj_score_head.layers.1', 'objectHiddenB', 'headHidden', LINEAR_RELU_WGSL);
  const object2 = linearBindings('objectHiddenB', 'pred_obj_score_head.layers.2', 'objectScores', 'objectOut');
  addKernel('argmaxGather', ARGMAX_GATHER_WGSL, [tb('iou'), tb('hiddenA'), tb('bestIndices', 'storage'), tb('selectedTokens', 'storage')]);
  addKernel('selectMasks', SELECT_MASK_WGSL, [tb('masks'), tb('bestIndices'), tb('selectedMasks', 'storage'), uniformBinding('mask0')]);
  const pointer0 = linearBindings('selectedTokens', 'object-pointer.layers.0', 'pointerA', 'pointer', LINEAR_RELU_WGSL);
  const pointer1 = linearBindings('pointerA', 'object-pointer.layers.1', 'pointerB', 'pointer', LINEAR_RELU_WGSL);
  const pointer2 = linearBindings('pointerB', 'object-pointer.layers.2', 'projectedPointers', 'pointer');
  const noObject = linearBindings('projectedPointers', 'no-object-pointer', 'noObjectPointers', 'pointer');
  addKernel('pointerBlend', POINTER_BLEND_WGSL, [tb('objectScores'), tb('projectedPointers'), tb('noObjectPointers'), tb('objectPointers', 'storage')]);
  phases.push(
    { name: 'multiplex-decoder-iou-head-0', kernel: 'iouLayer0', dispatch: [workgroups(16 * 256)] },
    dispatchLinear(iou1, 16 * 256), dispatchLinear(iou2, 16 * 3),
    { name: 'multiplex-decoder-object-head-0', kernel: 'objectLayer0', dispatch: [workgroups(16 * 256)] },
    dispatchLinear(object1, 16 * 256), dispatchLinear(object2, 16),
    { name: 'multiplex-decoder-attribute-heads', kernel: 'argmaxGather', dispatch: [workgroups(16 * 256)], yieldAfter: true },
    { name: 'multiplex-decoder-mask-selection', kernel: 'selectMasks', dispatch: [workgroups(16 * maskSpatial)] },
    dispatchLinear(pointer0, 16 * 256), dispatchLinear(pointer1, 16 * 256), dispatchLinear(pointer2, 16 * 256), dispatchLinear(noObject, 16 * 256),
    { name: 'multiplex-decoder-object-pointer-projection', kernel: 'pointerBlend', dispatch: [workgroups(16 * 256)], yieldAfter: true },
    { name: 'multiplex-decoder-readback', readbacks: [
      { name: 'finalQueries', tensor: 'hiddenA' }, { name: 'finalKeys', tensor: 'keyA' },
      { name: 'iou', tensor: 'iou' }, { name: 'objectScores', tensor: 'objectScores' },
      { name: 'bestMaskIndices', tensor: 'bestIndices' }, { name: 'samTokens', tensor: 'hiddenA' }, { name: 'maskLogits', tensor: 'masks' }, { name: 'selectedMasks', tensor: 'selectedMasks' },
      { name: 'projectedPointers', tensor: 'projectedPointers' }, { name: 'objectPointers', tensor: 'objectPointers' },
    ] },
  );

  const program = runtime.defineProgram({ name: 'sam31.multiplex-mask-decoder-phase-program', tensors: programTensors, uniforms: gpu.uniforms, kernels, phases, metadata: { routeId: route.routeId, sourceBoundary: 'Meta MultiplexMaskDecoder + object pointer MLP', queryTokens: 80 } });
  const run = await runtime.runProgram(program);
  const fullQueries = new Float32Array(run.outputs.finalQueries);
  const samTokens = fullQueries.slice(32 * 256).buffer;
  const maskLogits = run.outputs.maskLogits;
  const selectedMasks = run.outputs.selectedMasks;
  const objectScores = run.outputs.objectScores;
  const objectPointers = run.outputs.objectPointers;
  const outputs = {
    samTokens: { artifactId: roleArtifact(input.request.outputs, 'sam31-multiplex-sam-output-tokens').artifactId, sha256: await sha256Hex(samTokens), shape: [1, 16, 3, 256] },
    maskLogits: { artifactId: roleArtifact(input.request.outputs, 'sam31-multiplex-mask-logits').artifactId, sha256: await sha256Hex(maskLogits), shape: [16, 3, shape.maskHeight, shape.maskWidth] },
    selectedMasks: { artifactId: roleArtifact(input.request.outputs, 'sam31-multiplex-selected-masks').artifactId, sha256: await sha256Hex(selectedMasks), shape: [16, 1, shape.maskHeight, shape.maskWidth] },
    objectScores: { artifactId: roleArtifact(input.request.outputs, 'sam31-multiplex-object-scores').artifactId, sha256: await sha256Hex(objectScores), shape: [16, 1] },
    objectPointers: { artifactId: roleArtifact(input.request.outputs, 'sam31-multiplex-object-pointers').artifactId, sha256: await sha256Hex(objectPointers), shape: [16, 256] },
  };
  const receipt = createReceipt({
    sourceFrame: roleArtifact(input.request.inputs, 'source-frame'), decoderTensors: roleArtifact(input.request.inputs, 'sam31-multiplex-decoder-tensors'), weights: roleArtifact(input.request.inputs, 'sam31-multiplex-decoder-weights'),
    outputs, backend: runtime.backendIdentity, model: { revision: input.model?.revision || route.model.revision, weightsHash: input.model?.weightsHash }, kernel: input.kernel || runtime.kernel, profile: runtime.profile,
  });
  const authoritative = assertAuthoritativeRouteWorkerResult(createRouteWorkerResult(route, { request: input.request, receipt }), route);
  if (input.includeReadback) authoritative.debugReadback = {
    finalQueries: Array.from(fullQueries), finalKeys: Array.from(new Float32Array(run.outputs.finalKeys)),
    layerQueries: [0, 1].map(index => Array.from(new Float32Array(run.outputs[`layer${index}Queries`]))),
    layerKeys: [0, 1].map(index => Array.from(new Float32Array(run.outputs[`layer${index}Keys`]))),
    samTokens: Array.from(new Float32Array(samTokens)), maskLogits: Array.from(new Float32Array(maskLogits)), selectedMasks: Array.from(new Float32Array(selectedMasks)), iou: Array.from(new Float32Array(run.outputs.iou)), objectScores: Array.from(new Float32Array(run.outputs.objectScores)),
    bestMaskIndices: Array.from(new Float32Array(run.outputs.bestMaskIndices)), projectedPointers: Array.from(new Float32Array(run.outputs.projectedPointers)), objectPointers: Array.from(new Float32Array(objectPointers)),
  };
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}
