import {
  createKernelProfileMetadata,
  createRouteKernelProfileMetadata,
} from './kernel-profile.js';
import {
  assertAuthoritativeRouteWorkerResult,
  createRouteWorkerResult,
  defineWebGpuRoute,
} from './route-boundary.js';
import { createWebGpuInferenceRuntime } from './inference-runtime.js';
import { WEBGPU_BUFFER_USAGE, WEBGPU_SHADER_STAGE, createLinearDispatch } from './runtime-primitives.js';
import {
  createRouteReceiptArtifacts,
  createRouteReceiptInputArtifact,
  createWebGpuRouteReceiptFromArtifacts,
} from './route-receipt-helper.js';
import {
  createWebGpuRouteBackpressureProfile,
  createWebGpuRouteSchedulerProfile,
} from './scheduler-backpressure.js';
import {
  MEMORY_ATTENTION_ADD_WGSL,
  MEMORY_ATTENTION_LAYERNORM_WGSL,
  MEMORY_ATTENTION_LINEAR_WGSL,
  MEMORY_ATTENTION_ONLINE_SOFTMAX_WGSL,
} from './sam31-memory-attention-phase-program.js';
import { SAM31_EXACT_GELU_FUNCTIONS_WGSL } from './sam31-memory-encoder-phase-program.js';

export const SAM31_INTERACTIVE_POINTER_PHASE_PROGRAM_ROUTE_ID = 'sam3.1.interactive-pointer.phase-program.webgpu-local.v0';

const MODEL_ID = 'facebook/sam3.1';
const REQUIRED_STAGES = [
  'interactive-pointer-mask-downsample',
  'interactive-pointer-prompt-encode',
  'interactive-pointer-two-way-transformer',
  'interactive-pointer-object-projection',
  'interactive-pointer-final-no-object-transition',
  'interactive-pointer-readback',
];
const INPUT_ROLES = ['source-frame', 'sam31-binary-mask-inputs', 'sam31-interactive-image-embedding', 'sam31-interactive-pointer-weights'];
const OUTPUT_ROLES = [{ key: 'objectPointers', role: 'sam31-interactive-object-pointers', required: true }];

function createDefaultScheduler() {
  const chunks = Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1]));
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: chunks, unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage.endsWith('readback') ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage.endsWith('readback') ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: !stage.endsWith('readback') })),
      notes: 'The SAM3.1 interactive pointer route yields after prompt encoding, each two-way transformer boundary, and both no-object transitions.',
    },
  });
}

function createDefaultBackpressure() {
  return createWebGpuRouteBackpressureProfile({ requestedBudget: 'visible-wait', effectiveBudget: 'visible-wait', memoryExclusivity: 'shared', warmCacheState: 'unknown' });
}

function array(value, name) {
  if (!(value instanceof Float32Array)) throw new Error(`${name} must be a Float32Array`);
  return value;
}

function weight(weights, key, length) {
  const value = array(weights[key], `weights.${key}`);
  if (length !== undefined && value.length !== length) throw new Error(`weights.${key} length ${value.length} != ${length}`);
  return value;
}

export function deriveSam31InteractivePointerGeometry(inputShape = {}) {
  const shape = { ...inputShape };
  const fixed = {
    batch: 16,
    queryTokens: 8,
    sparsePromptTokens: 2,
    channels: 256,
    heads: 8,
    attentionChannels: 128,
    mlpHidden: 2048,
    layerCount: 2,
  };
  for (const [key, expected] of Object.entries(fixed)) {
    if (shape[key] !== expected) throw new Error(`shape.${key} must equal ${expected}`);
  }
  for (const key of [
    'imageHeight', 'imageWidth', 'imageTokens',
    'sourceImageHeight', 'sourceImageWidth',
    'sourceMaskHeight', 'sourceMaskWidth',
    'promptMaskHeight', 'promptMaskWidth',
    'decoderMaskHeight', 'decoderMaskWidth',
  ]) {
    if (!Number.isInteger(shape[key]) || shape[key] <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  if (shape.imageTokens !== shape.imageHeight * shape.imageWidth) {
    throw new Error('shape.imageTokens must equal imageHeight * imageWidth');
  }
  if (shape.sourceImageHeight !== shape.imageHeight * 14 || shape.sourceImageWidth !== shape.imageWidth * 14) {
    throw new Error('source image geometry must be fourteen times feature geometry');
  }
  if (shape.sourceMaskHeight !== shape.imageHeight * 16 || shape.sourceMaskWidth !== shape.imageWidth * 16) {
    throw new Error('source mask geometry must be sixteen times feature geometry');
  }
  if (shape.promptMaskHeight !== shape.imageHeight * 4 || shape.promptMaskWidth !== shape.imageWidth * 4) {
    throw new Error('prompt mask geometry must be four times feature geometry');
  }
  if (shape.decoderMaskHeight !== shape.promptMaskHeight || shape.decoderMaskWidth !== shape.promptMaskWidth) {
    throw new Error('decoder mask geometry must equal prompt mask geometry');
  }
  const sourceMaskPixels = shape.sourceMaskHeight * shape.sourceMaskWidth;
  const promptMaskPixels = shape.promptMaskHeight * shape.promptMaskWidth;
  const promptIntermediateHeight = shape.promptMaskHeight / 2;
  const promptIntermediateWidth = shape.promptMaskWidth / 2;
  const promptIntermediatePixels = promptIntermediateHeight * promptIntermediateWidth;
  const batch = fixed.batch;
  const channels = fixed.channels;
  return Object.freeze({
    shape: Object.freeze({ ...shape }),
    ...fixed,
    imageHeight: shape.imageHeight,
    imageWidth: shape.imageWidth,
    imageTokens: shape.imageTokens,
    sourceImageHeight: shape.sourceImageHeight,
    sourceImageWidth: shape.sourceImageWidth,
    sourceMaskHeight: shape.sourceMaskHeight,
    sourceMaskWidth: shape.sourceMaskWidth,
    sourceMaskPixels,
    promptMaskHeight: shape.promptMaskHeight,
    promptMaskWidth: shape.promptMaskWidth,
    promptMaskPixels,
    decoderMaskHeight: shape.decoderMaskHeight,
    decoderMaskWidth: shape.decoderMaskWidth,
    promptIntermediateHeight,
    promptIntermediateWidth,
    promptIntermediatePixels,
    binaryMaskLength: batch * sourceMaskPixels,
    imageEmbeddingLength: shape.imageTokens * channels,
    maskDownsampleLength: batch * promptMaskPixels,
    promptConv0Length: batch * 4 * promptIntermediatePixels,
    promptConv1Length: batch * 16 * shape.imageTokens,
    denseEmbeddingLength: batch * channels * shape.imageTokens,
    imagePositionLength: batch * shape.imageTokens * channels,
    queryValueLength: batch * fixed.queryTokens * channels,
    keyValueLength: batch * shape.imageTokens * channels,
    queryAttentionLength: batch * fixed.queryTokens * fixed.attentionChannels,
    keyAttentionLength: batch * shape.imageTokens * fixed.attentionChannels,
    mlpLength: batch * fixed.queryTokens * fixed.mlpHidden,
    pointerLength: batch * channels,
  });
}

function projection(weights, prefix, inputChannels, outputChannels) {
  return {
    weight: weight(weights, `${prefix}.weight`, inputChannels * outputChannels),
    bias: weight(weights, `${prefix}.bias`, outputChannels),
    inputChannels,
    outputChannels,
  };
}

function add(left, right) {
  const output = new Float32Array(left.length);
  for (let index = 0; index < output.length; index += 1) output[index] = left[index] + right[index];
  return output;
}

function linear(values, spec, tokens, relu = false) {
  const output = new Float32Array(tokens * spec.outputChannels);
  for (let token = 0; token < tokens; token += 1) {
    const inputBase = token * spec.inputChannels;
    for (let out = 0; out < spec.outputChannels; out += 1) {
      let sum = spec.bias[out];
      const weightBase = out * spec.inputChannels;
      for (let input = 0; input < spec.inputChannels; input += 1) sum += values[inputBase + input] * spec.weight[weightBase + input];
      output[token * spec.outputChannels + out] = relu ? Math.max(0, sum) : sum;
    }
  }
  return output;
}

function layerNorm(values, weights, prefix, tokens, channels = 256) {
  const scale = weight(weights, `${prefix}.weight`, channels);
  const bias = weight(weights, `${prefix}.bias`, channels);
  const output = new Float32Array(values.length);
  for (let token = 0; token < tokens; token += 1) {
    const base = token * channels;
    let mean = 0;
    for (let channel = 0; channel < channels; channel += 1) mean += values[base + channel];
    mean /= channels;
    let variance = 0;
    for (let channel = 0; channel < channels; channel += 1) variance += (values[base + channel] - mean) ** 2;
    const inverse = 1 / Math.sqrt(variance / channels + 1e-5);
    for (let channel = 0; channel < channels; channel += 1) output[base + channel] = (values[base + channel] - mean) * inverse * scale[channel] + bias[channel];
  }
  return output;
}

function attention(query, key, value, queryTokens, keyTokens, channels, heads = 8) {
  const output = new Float32Array(queryTokens * channels);
  const headDim = channels / heads;
  const scale = 1 / Math.sqrt(headDim);
  for (let head = 0; head < heads; head += 1) {
    for (let queryToken = 0; queryToken < queryTokens; queryToken += 1) {
      const logits = new Float64Array(keyTokens);
      let maximum = -Infinity;
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

function attentionBlock({ queryInput, keyInput, valueInput, queryTokens, keyTokens, weights, prefix, internalChannels }) {
  const q = linear(queryInput, projection(weights, `${prefix}.q_proj`, 256, internalChannels), queryTokens);
  const k = linear(keyInput, projection(weights, `${prefix}.k_proj`, 256, internalChannels), keyTokens);
  const v = linear(valueInput, projection(weights, `${prefix}.v_proj`, 256, internalChannels), keyTokens);
  return linear(attention(q, k, v, queryTokens, keyTokens, internalChannels), projection(weights, `${prefix}.out_proj`, internalChannels, 256), queryTokens);
}

function mlp(values, tokens, weights, prefix, outputChannels = 256) {
  const first = linear(values, projection(weights, `${prefix}.layers.0`, 256, 256), tokens, true);
  const second = linear(first, projection(weights, `${prefix}.layers.1`, 256, 256), tokens, true);
  return linear(second, projection(weights, `${prefix}.layers.2`, 256, outputChannels), tokens);
}

function conv2dNchw(input, batch, inputChannels, inputHeight, inputWidth, outputChannels, kernel, stride, kernelWeight, bias) {
  const outputHeight = Math.floor((inputHeight - kernel) / stride) + 1;
  const outputWidth = Math.floor((inputWidth - kernel) / stride) + 1;
  const output = new Float32Array(batch * outputChannels * outputHeight * outputWidth);
  const inputSpatial = inputHeight * inputWidth;
  const outputSpatial = outputHeight * outputWidth;
  for (let item = 0; item < batch; item += 1) {
    for (let outputChannel = 0; outputChannel < outputChannels; outputChannel += 1) {
      for (let outputY = 0; outputY < outputHeight; outputY += 1) {
        for (let outputX = 0; outputX < outputWidth; outputX += 1) {
          let sum = bias[outputChannel];
          for (let inputChannel = 0; inputChannel < inputChannels; inputChannel += 1) {
            for (let kernelY = 0; kernelY < kernel; kernelY += 1) {
              for (let kernelX = 0; kernelX < kernel; kernelX += 1) {
                const inputIndex = ((item * inputChannels + inputChannel) * inputSpatial) + (outputY * stride + kernelY) * inputWidth + outputX * stride + kernelX;
                const weightIndex = ((outputChannel * inputChannels + inputChannel) * kernel + kernelY) * kernel + kernelX;
                sum += input[inputIndex] * kernelWeight[weightIndex];
              }
            }
          }
          output[(item * outputChannels + outputChannel) * outputSpatial + outputY * outputWidth + outputX] = sum;
        }
      }
    }
  }
  return { values: output, height: outputHeight, width: outputWidth };
}

function layerNorm2d(values, batch, channels, height, width, scale, bias) {
  const output = new Float32Array(values.length);
  const spatial = height * width;
  for (let item = 0; item < batch; item += 1) {
    for (let position = 0; position < spatial; position += 1) {
      let mean = 0;
      for (let channel = 0; channel < channels; channel += 1) mean += values[(item * channels + channel) * spatial + position];
      mean /= channels;
      let variance = 0;
      for (let channel = 0; channel < channels; channel += 1) variance += (values[(item * channels + channel) * spatial + position] - mean) ** 2;
      const inverse = 1 / Math.sqrt(variance / channels + 1e-6);
      for (let channel = 0; channel < channels; channel += 1) {
        const index = (item * channels + channel) * spatial + position;
        output[index] = (values[index] - mean) * inverse * scale[channel] + bias[channel];
      }
    }
  }
  return output;
}

function erfApprox(value) {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * magnitude);
  return sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-magnitude * magnitude));
}

function geluInPlace(values) {
  for (let index = 0; index < values.length; index += 1) values[index] = 0.5 * values[index] * (1 + erfApprox(values[index] * Math.SQRT1_2));
  return values;
}

function promptEncode(binaryMasks, weights, geometry) {
  const promptMasks = conv2dNchw(binaryMasks, geometry.batch, 1, geometry.sourceMaskHeight, geometry.sourceMaskWidth, 1, 4, 4,
    weight(weights, 'mask-downsample.weight', 16), weight(weights, 'mask-downsample.bias', 1));
  let dense = conv2dNchw(promptMasks.values, geometry.batch, 1, geometry.promptMaskHeight, geometry.promptMaskWidth, 4, 2, 2,
    weight(weights, 'prompt.mask_downscaling.0.weight', 16), weight(weights, 'prompt.mask_downscaling.0.bias', 4));
  dense.values = geluInPlace(layerNorm2d(dense.values, geometry.batch, 4, geometry.promptIntermediateHeight, geometry.promptIntermediateWidth,
    weight(weights, 'prompt.mask_downscaling.1.weight', 4), weight(weights, 'prompt.mask_downscaling.1.bias', 4)));
  dense = conv2dNchw(dense.values, geometry.batch, 4, geometry.promptIntermediateHeight, geometry.promptIntermediateWidth, 16, 2, 2,
    weight(weights, 'prompt.mask_downscaling.3.weight', 16 * 4 * 4), weight(weights, 'prompt.mask_downscaling.3.bias', 16));
  dense.values = geluInPlace(layerNorm2d(dense.values, geometry.batch, 16, geometry.imageHeight, geometry.imageWidth,
    weight(weights, 'prompt.mask_downscaling.4.weight', 16), weight(weights, 'prompt.mask_downscaling.4.bias', 16)));
  dense = conv2dNchw(dense.values, geometry.batch, 16, geometry.imageHeight, geometry.imageWidth, 256, 1, 1,
    weight(weights, 'prompt.mask_downscaling.6.weight', 256 * 16), weight(weights, 'prompt.mask_downscaling.6.bias', 256));
  const sparse = new Float32Array(geometry.batch * geometry.sparsePromptTokens * geometry.channels);
  const notPoint = weight(weights, 'prompt.not_a_point_embed.weight', 256);
  for (let item = 0; item < geometry.batch; item += 1) {
    sparse.set(notPoint, (item * 2) * 256);
    sparse.set(notPoint, (item * 2 + 1) * 256);
  }
  return { maskDownsample: promptMasks.values, sparseEmbeddings: sparse, denseEmbeddings: dense.values };
}

function densePosition(weights, geometry) {
  const matrix = weight(weights, 'prompt.pe_layer.positional_encoding_gaussian_matrix', 256);
  const output = new Float32Array(geometry.imageTokens * geometry.channels);
  for (let y = 0; y < geometry.imageHeight; y += 1) {
    for (let x = 0; x < geometry.imageWidth; x += 1) {
      const position = y * geometry.imageWidth + x;
      const nx = 2 * ((x + 0.5) / geometry.imageWidth) - 1;
      const ny = 2 * ((y + 0.5) / geometry.imageHeight) - 1;
      for (let feature = 0; feature < 128; feature += 1) {
        const angle = (nx * matrix[feature] + ny * matrix[128 + feature]) * 2 * Math.PI;
        output[position * 256 + feature] = Math.sin(angle);
        output[position * 256 + 128 + feature] = Math.cos(angle);
      }
    }
  }
  return output;
}

function pointEmbeddingForItem(sparse, item, weights) {
  const output = new Float32Array(8 * 256);
  output.set(weight(weights, 'decoder.obj_score_token.weight', 256), 0);
  output.set(weight(weights, 'decoder.iou_token.weight', 256), 256);
  output.set(weight(weights, 'decoder.mask_tokens.weight', 4 * 256), 2 * 256);
  output.set(sparse.subarray(item * 2 * 256, (item + 1) * 2 * 256), 6 * 256);
  return output;
}

function imageKeysForItem(imageEmbedding, dense, item, geometry) {
  const output = new Float32Array(geometry.imageTokens * geometry.channels);
  for (let position = 0; position < geometry.imageTokens; position += 1) {
    for (let channel = 0; channel < 256; channel += 1) {
      output[position * 256 + channel] = imageEmbedding[position * 256 + channel] + dense[(item * 256 + channel) * geometry.imageTokens + position];
    }
  }
  return output;
}

function runTransformerItem(point, initialKeys, imagePosition, weights, geometry) {
  let queries = new Float32Array(point);
  let keys = new Float32Array(initialKeys);
  const layerQueries = [];
  const layerKeys = [];
  for (let layer = 0; layer < 2; layer += 1) {
    const base = `decoder.transformer.layers.${layer}`;
    if (layer === 0) {
      queries = layerNorm(attentionBlock({ queryInput: queries, keyInput: queries, valueInput: queries, queryTokens: 8, keyTokens: 8, weights, prefix: `${base}.self_attn`, internalChannels: 256 }), weights, `${base}.norm1`, 8);
    } else {
      const positioned = add(queries, point);
      queries = layerNorm(add(queries, attentionBlock({ queryInput: positioned, keyInput: positioned, valueInput: queries, queryTokens: 8, keyTokens: 8, weights, prefix: `${base}.self_attn`, internalChannels: 256 })), weights, `${base}.norm1`, 8);
    }
    queries = layerNorm(add(queries, attentionBlock({ queryInput: add(queries, point), keyInput: add(keys, imagePosition), valueInput: keys, queryTokens: 8, keyTokens: geometry.imageTokens, weights, prefix: `${base}.cross_attn_token_to_image`, internalChannels: 128 })), weights, `${base}.norm2`, 8);
    const hidden = linear(queries, projection(weights, `${base}.mlp.lin1`, 256, 2048), 8, true);
    queries = layerNorm(add(queries, linear(hidden, projection(weights, `${base}.mlp.lin2`, 2048, 256), 8)), weights, `${base}.norm3`, 8);
    keys = layerNorm(add(keys, attentionBlock({ queryInput: add(keys, imagePosition), keyInput: add(queries, point), valueInput: queries, queryTokens: geometry.imageTokens, keyTokens: 8, weights, prefix: `${base}.cross_attn_image_to_token`, internalChannels: 128 })), weights, `${base}.norm4`, geometry.imageTokens);
    layerQueries.push(new Float32Array(queries));
    layerKeys.push(new Float32Array(keys));
  }
  queries = layerNorm(add(queries, attentionBlock({ queryInput: add(queries, point), keyInput: add(keys, imagePosition), valueInput: keys, queryTokens: 8, keyTokens: geometry.imageTokens, weights, prefix: 'decoder.transformer.final_attn_token_to_image', internalChannels: 128 })), weights, 'decoder.transformer.norm_final_attn', 8);
  return { queries, keys, layerQueries, layerKeys };
}

function normalizeInput(input = {}) {
  const shape = input.shape || {};
  const geometry = deriveSam31InteractivePointerGeometry(shape);
  const tensors = input.tensors || {};
  const binaryMasks = array(tensors.binaryMasks, 'tensors.binaryMasks');
  const imageEmbedding = array(tensors.imageEmbedding, 'tensors.imageEmbedding');
  if (binaryMasks.length !== geometry.binaryMaskLength || imageEmbedding.length !== geometry.imageEmbeddingLength) throw new Error('interactive pointer tensor length mismatch');
  const weights = {};
  for (const [key, value] of Object.entries(input.weights || {})) weights[key] = array(value, `weights.${key}`);
  return { shape, geometry, binaryMasks, imageEmbedding, weights };
}

export function createSam31InteractivePointerPhaseProgramCpuOracle(input = {}) {
  const { shape, geometry, binaryMasks, imageEmbedding, weights } = normalizeInput(input);
  const prompt = promptEncode(binaryMasks, weights, geometry);
  const imagePosition = densePosition(weights, geometry);
  const layerQueries = [new Float32Array(16 * 8 * 256), new Float32Array(16 * 8 * 256)];
  const layerKeys = [new Float32Array(geometry.keyValueLength), new Float32Array(geometry.keyValueLength)];
  const samOutputTokens = new Float32Array(16 * 256);
  const decoderObjectScores = new Float32Array(16);
  for (let item = 0; item < 16; item += 1) {
    const point = pointEmbeddingForItem(prompt.sparseEmbeddings, item, weights);
    const keys = imageKeysForItem(imageEmbedding, prompt.denseEmbeddings, item, geometry);
    const transformed = runTransformerItem(point, keys, imagePosition, weights, geometry);
    for (let layer = 0; layer < 2; layer += 1) {
      layerQueries[layer].set(transformed.layerQueries[layer], item * 8 * 256);
      layerKeys[layer].set(transformed.layerKeys[layer], item * geometry.imageTokens * 256);
    }
    samOutputTokens.set(transformed.queries.subarray(2 * 256, 3 * 256), item * 256);
    decoderObjectScores[item] = mlp(transformed.queries.subarray(0, 256), 1, weights, 'decoder.pred_obj_score_head', 1)[0];
  }
  const projectedPointers = mlp(samOutputTokens, 16, weights, 'interactive-pointer', 256);
  const firstNoObject = linear(projectedPointers, projection(weights, 'no-object-pointer', 256, 256), 16);
  const forwardObjectPointers = new Float32Array(projectedPointers.length);
  for (let item = 0; item < 16; item += 1) {
    const source = decoderObjectScores[item] > 0 ? projectedPointers : firstNoObject;
    forwardObjectPointers.set(source.subarray(item * 256, (item + 1) * 256), item * 256);
  }
  const finalNoObject = linear(forwardObjectPointers, projection(weights, 'no-object-pointer', 256, 256), 16);
  const finalObjectPointers = new Float32Array(projectedPointers.length);
  for (let item = 0; item < 16; item += 1) {
    let appearing = false;
    for (let pixel = 0; pixel < geometry.sourceMaskPixels; pixel += 1) {
      appearing ||= binaryMasks[item * geometry.sourceMaskPixels + pixel] > 0;
    }
    const source = appearing ? forwardObjectPointers : finalNoObject;
    finalObjectPointers.set(source.subarray(item * 256, (item + 1) * 256), item * 256);
  }
  return {
    shape,
    ...prompt,
    imagePosition,
    layerQueries,
    layerKeys,
    samOutputTokens,
    decoderObjectScores,
    projectedPointers,
    forwardObjectPointers,
    finalObjectPointers,
  };
}

export function createSam31InteractivePointerPhaseProgramRouteDefinition(input = {}) {
  const metadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: 'sam31-interactive-pointer-phase-program-v0',
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM31_INTERACTIVE_POINTER_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: MODEL_ID, revision: input.model?.revision || 'pinned-official-interactive-pointer', dtype: 'fp32' },
    kernel: metadata.kernel,
    inputs: ['source-frame', 'sam31-binary-mask-inputs', 'sam31-interactive-image-embedding', 'sam31-interactive-pointer-weights'].map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: [{ role: 'sam31-interactive-object-pointers', required: true, artifactRequired: true, hashRequired: true }],
    requiredFeatures: [],
    requiredStages: metadata.requiredStages,
    timingSource: metadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: { exportName: 'runSam31InteractivePointerPhaseProgramRoute', upstreamBoundary: 'binary-mask-to-interactive-prompt-decoder-to-final-object-pointer' },
  });
}

const CONV2D_WGSL = `
struct ConvDims {
  batch: u32, input_channels: u32, input_height: u32, input_width: u32,
  output_channels: u32, output_height: u32, output_width: u32,
  kernel: u32, stride: u32, total_output: u32,
};
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weights: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: ConvDims;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= dims.total_output) { return; }
  let x = index % dims.output_width;
  let y = (index / dims.output_width) % dims.output_height;
  let output_channel = (index / (dims.output_width * dims.output_height)) % dims.output_channels;
  let batch = index / (dims.output_channels * dims.output_width * dims.output_height);
  var sum = bias[output_channel];
  for (var input_channel = 0u; input_channel < dims.input_channels; input_channel = input_channel + 1u) {
    for (var kernel_y = 0u; kernel_y < dims.kernel; kernel_y = kernel_y + 1u) {
      for (var kernel_x = 0u; kernel_x < dims.kernel; kernel_x = kernel_x + 1u) {
        let input_y = y * dims.stride + kernel_y;
        let input_x = x * dims.stride + kernel_x;
        let input_index = ((batch * dims.input_channels + input_channel) * dims.input_height + input_y) * dims.input_width + input_x;
        let weight_index = ((output_channel * dims.input_channels + input_channel) * dims.kernel + kernel_y) * dims.kernel + kernel_x;
        sum = sum + input_values[input_index] * weights[weight_index];
      }
    }
  }
  output_values[index] = sum;
}
`;

const LAYERNORM2D_WGSL = `
struct Norm2dDims { batch: u32, channels: u32, height: u32, width: u32, total_spatial: u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> scale: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: Norm2dDims;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let spatial_index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (spatial_index >= dims.total_spatial) { return; }
  let plane = dims.height * dims.width;
  let batch = spatial_index / plane;
  let spatial = spatial_index % plane;
  var mean = 0.0;
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) { mean = mean + input_values[(batch * dims.channels + channel) * plane + spatial]; }
  mean = mean / f32(dims.channels);
  var variance = 0.0;
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) { let delta = input_values[(batch * dims.channels + channel) * plane + spatial] - mean; variance = variance + delta * delta; }
  let inverse = inverseSqrt(variance / f32(dims.channels) + 0.000001);
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    let index = (batch * dims.channels + channel) * plane + spatial;
    output_values[index] = (input_values[index] - mean) * inverse * scale[channel] + bias[channel];
  }
}
`;

const GELU_WGSL = `
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;
${SAM31_EXACT_GELU_FUNCTIONS_WGSL}
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= arrayLength(&output_values)) { return; }
  output_values[index] = gelu_exact_approx(input_values[index]);
}
`;

const IMAGE_POSITION_WGSL = `
struct ImagePositionDims { batch: u32, height: u32, width: u32, channels: u32, total: u32, };
@group(0) @binding(0) var<storage, read> matrix: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(2) var<uniform> dims: ImagePositionDims;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= dims.total) { return; }
  let channel = index % dims.channels;
  let position = (index / dims.channels) % (dims.height * dims.width);
  let x = position % dims.width; let y = position / dims.width;
  let nx = 2.0 * ((f32(x) + 0.5) / f32(dims.width)) - 1.0;
  let ny = 2.0 * ((f32(y) + 0.5) / f32(dims.height)) - 1.0;
  let feature = channel % 128u;
  let angle = (nx * matrix[feature] + ny * matrix[128u + feature]) * 6.283185307179586;
  output_values[index] = select(cos(angle), sin(angle), channel < 128u);
}
`;

const QUERY_SEED_WGSL = `
@group(0) @binding(0) var<storage, read> object_token: array<f32>;
@group(0) @binding(1) var<storage, read> iou_token: array<f32>;
@group(0) @binding(2) var<storage, read> mask_tokens: array<f32>;
@group(0) @binding(3) var<storage, read> not_point: array<f32>;
@group(0) @binding(4) var<storage, read_write> point_values: array<f32>;
@group(0) @binding(5) var<storage, read_write> hidden_values: array<f32>;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= arrayLength(&point_values)) { return; }
  let channel = index % 256u;
  let token = (index / 256u) % 8u;
  var value = not_point[channel];
  if (token == 0u) { value = object_token[channel]; }
  if (token == 1u) { value = iou_token[channel]; }
  if (token >= 2u && token < 6u) { value = mask_tokens[(token - 2u) * 256u + channel]; }
  point_values[index] = value;
  hidden_values[index] = value;
}
`;

const KEY_SEED_WGSL = `
struct KeySeedDims { batch: u32, image_tokens: u32, channels: u32, total: u32, };
@group(0) @binding(0) var<storage, read> image_values: array<f32>;
@group(0) @binding(1) var<storage, read> dense_values: array<f32>;
@group(0) @binding(2) var<storage, read_write> key_values: array<f32>;
@group(0) @binding(3) var<uniform> dims: KeySeedDims;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= dims.total) { return; }
  let channel = index % dims.channels;
  let position = (index / dims.channels) % dims.image_tokens;
  let batch = index / (dims.image_tokens * dims.channels);
  key_values[index] = image_values[position * dims.channels + channel] + dense_values[(batch * dims.channels + channel) * dims.image_tokens + position];
}
`;

const LINEAR_RELU_WGSL = `
struct LinearDims { input_channels: u32, output_channels: u32, total_output: u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight_values: array<f32>;
@group(0) @binding(2) var<storage, read> bias_values: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LinearDims;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= dims.total_output) { return; }
  let output_channel = index % dims.output_channels;
  let token = index / dims.output_channels;
  var value = bias_values[output_channel];
  for (var channel = 0u; channel < dims.input_channels; channel = channel + 1u) { value = value + input_values[token * dims.input_channels + channel] * weight_values[output_channel * dims.input_channels + channel]; }
  output_values[index] = max(0.0, value);
}
`;

const TOKEN_GATHER_WGSL = `
struct GatherDims { token_offset: u32, batch: u32, query_tokens: u32, channels: u32, total: u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(2) var<uniform> dims: GatherDims;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= dims.total) { return; }
  let channel = index % dims.channels;
  let batch = index / dims.channels;
  output_values[index] = input_values[(batch * dims.query_tokens + dims.token_offset) * dims.channels + channel];
}
`;

const SCORE_BLEND_WGSL = `
@group(0) @binding(0) var<storage, read> scores: array<f32>;
@group(0) @binding(1) var<storage, read> present_values: array<f32>;
@group(0) @binding(2) var<storage, read> absent_values: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= arrayLength(&output_values)) { return; }
  output_values[index] = select(absent_values[index], present_values[index], scores[index / 256u] > 0.0);
}
`;

const MASK_BLEND_WGSL = `
struct MaskBlendDims { batch: u32, channels: u32, mask_pixels: u32, total: u32, };
@group(0) @binding(0) var<storage, read> masks: array<f32>;
@group(0) @binding(1) var<storage, read> present_values: array<f32>;
@group(0) @binding(2) var<storage, read> absent_values: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: MaskBlendDims;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= dims.total) { return; }
  let batch = index / dims.channels;
  var appearing = false;
  for (var pixel = 0u; pixel < dims.mask_pixels; pixel = pixel + 1u) { appearing = appearing || masks[batch * dims.mask_pixels + pixel] > 0.0; }
  output_values[index] = select(absent_values[index], present_values[index], appearing);
}
`;

function roleArtifact(artifacts, role) {
  const artifact = Array.isArray(artifacts) ? artifacts.find(entry => entry?.role === role) : artifacts?.[role];
  if (!artifact) throw new Error(`${role} artifact is required`);
  return artifact;
}

function tensorBinding(name, access = 'read-only-storage') {
  return { name, resource: `tensor:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, access };
}

function uniformBinding(name) {
  return { name: 'dims', resource: `uniform:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' };
}

function gpuWeightName(key) {
  return `weight_${key.replaceAll('.', '_').replaceAll('-', '_')}`;
}

export function createSam31InteractivePointerLinearDispatch(totalInvocations, input = {}) {
  const maxWorkgroupsPerDimension = input.maxWorkgroupsPerDimension ?? 65_535;
  return {
    logicalInvocations: totalInvocations,
    dispatch: createLinearDispatch(totalInvocations, { workgroupSize: 64, maxWorkgroupsPerDimension }),
  };
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function createSam31InteractivePointerPhaseProgramRouteReceipt(input = {}) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM31_INTERACTIVE_POINTER_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM31_INTERACTIVE_POINTER_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-frame', input.sourceFrame),
      createRouteReceiptInputArtifact('sam31-binary-mask-inputs', input.binaryMasks),
      createRouteReceiptInputArtifact('sam31-interactive-image-embedding', input.imageEmbedding),
      createRouteReceiptInputArtifact('sam31-interactive-pointer-weights', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export async function runSam31InteractivePointerPhaseProgramRoute(input = {}) {
  if (!input.request) throw new Error('request is required');
  const normalized = normalizeInput(input.tensors || {});
  const { shape, geometry, binaryMasks, imageEmbedding, weights } = normalized;
  const route = input.route || createSam31InteractivePointerPhaseProgramRouteDefinition({ kernel: input.kernel, model: input.model });
  const runtime = await createWebGpuInferenceRuntime({
    routeId: route.routeId,
    runtimeLabel: 'sam31-interactive-pointer-phase-program',
    device: input.device,
    queue: input.queue,
    adapter: input.adapter,
    adapterName: input.adapterName,
    browser: input.browser,
    backendIdentity: input.backendIdentity,
    kernel: input.kernel || route.kernel,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
    waitForSubmittedWorkDone: true,
    yieldMs: 0,
    residentTensorResolver: input.residentTensorResolver,
  });
  const maxComputeWorkgroupsPerDimension = input.device?.limits?.maxComputeWorkgroupsPerDimension ?? 65_535;

  const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
  const readonly = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
  const attentionScratchLength = Math.max(geometry.queryAttentionLength, geometry.keyAttentionLength);
  const projectedScratchLength = Math.max(geometry.queryValueLength, geometry.keyValueLength);
  let gpu;
  await runtime.runStage('interactive-pointer-load-tensors', async stage => {
    const create = (name, length, tensorUsage = usage, sourceData = undefined) => stage.createTensor({ name: `sam31.interactive-pointer.${name}`, shape: [length], dtype: 'f32', usage: tensorUsage, ...(sourceData ? { sourceData } : {}) });
    gpu = {
      binaryMasks: create('binary-masks', geometry.binaryMaskLength, readonly),
      imageEmbedding: create('image-embedding', geometry.imageEmbeddingLength, readonly),
      maskDownsample: create('mask-downsample', geometry.maskDownsampleLength),
      promptConv0: create('prompt-conv-0', geometry.promptConv0Length),
      promptNorm0: create('prompt-norm-0', geometry.promptConv0Length),
      promptGelu0: create('prompt-gelu-0', geometry.promptConv0Length),
      promptConv1: create('prompt-conv-1', geometry.promptConv1Length),
      promptNorm1: create('prompt-norm-1', geometry.promptConv1Length),
      promptGelu1: create('prompt-gelu-1', geometry.promptConv1Length),
      denseEmbedding: create('dense-embedding', geometry.denseEmbeddingLength),
      imagePosition: create('image-position', geometry.imagePositionLength),
      point: create('point', geometry.queryValueLength),
      hiddenA: create('hidden-a', geometry.queryValueLength),
      hiddenB: create('hidden-b', geometry.queryValueLength),
      keyA: create('key-a', geometry.keyValueLength),
      keyB: create('key-b', geometry.keyValueLength),
      querySum: create('query-sum', geometry.queryValueLength),
      keySum: create('key-sum', geometry.keyValueLength),
      q: create('q', attentionScratchLength),
      k: create('k', attentionScratchLength),
      v: create('v', attentionScratchLength),
      attention: create('attention', attentionScratchLength),
      projected: create('projected', projectedScratchLength),
      mlp: create('mlp', geometry.mlpLength),
      samTokens: create('sam-tokens', geometry.pointerLength),
      objectTokens: create('object-tokens', geometry.pointerLength),
      objectHiddenA: create('object-hidden-a', geometry.pointerLength),
      objectHiddenB: create('object-hidden-b', geometry.pointerLength),
      objectScores: create('object-scores', geometry.batch),
      pointerA: create('pointer-a', geometry.pointerLength),
      pointerB: create('pointer-b', geometry.pointerLength),
      projectedPointers: create('projected-pointers', geometry.pointerLength),
      firstNoObject: create('first-no-object', geometry.pointerLength),
      forwardPointers: create('forward-pointers', geometry.pointerLength),
      finalNoObject: create('final-no-object', geometry.pointerLength),
      objectPointers: create('object-pointers', geometry.pointerLength),
      weights: {},
      uniforms: {},
    };
    stage.uploadTensor(gpu.binaryMasks, binaryMasks);
    stage.uploadTensor(gpu.imageEmbedding, imageEmbedding);
    for (const [key, value] of Object.entries(weights)) {
      gpu.weights[key] = create(gpuWeightName(key), value.length, readonly, value);
      stage.uploadTensor(gpu.weights[key], value);
    }
    const uniform = (name, schema, values) => stage.createUniformBuffer({ label: `sam31.interactive-pointer.${name}`, schema, values });
    const convSchema = [
      { name: 'batch', type: 'u32' }, { name: 'input_channels', type: 'u32' }, { name: 'input_height', type: 'u32' }, { name: 'input_width', type: 'u32' },
      { name: 'output_channels', type: 'u32' }, { name: 'output_height', type: 'u32' }, { name: 'output_width', type: 'u32' },
      { name: 'kernel', type: 'u32' }, { name: 'stride', type: 'u32' }, { name: 'total_output', type: 'u32' },
    ];
    const norm2dSchema = [{ name: 'batch', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'height', type: 'u32' }, { name: 'width', type: 'u32' }, { name: 'total_spatial', type: 'u32' }];
    const imagePositionSchema = [{ name: 'batch', type: 'u32' }, { name: 'height', type: 'u32' }, { name: 'width', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'total', type: 'u32' }];
    const keySeedSchema = [{ name: 'batch', type: 'u32' }, { name: 'image_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'total', type: 'u32' }];
    const maskBlendSchema = [{ name: 'batch', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'mask_pixels', type: 'u32' }, { name: 'total', type: 'u32' }];
    const linearSchema = [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }];
    const attentionSchema = [{ name: 'batch', type: 'u32' }, { name: 'query_tokens', type: 'u32' }, { name: 'key_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'heads', type: 'u32' }, { name: 'head_dim', type: 'u32' }];
    const normSchema = [{ name: 'total_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }];
    const addSchema = [{ name: 'total', type: 'u32' }, { name: 'scale', type: 'f32' }];
    const gatherSchema = [{ name: 'token_offset', type: 'u32' }, { name: 'batch', type: 'u32' }, { name: 'query_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'total', type: 'u32' }];
    gpu.uniforms = {
      outerConv: uniform('outer-conv', convSchema, { batch: geometry.batch, input_channels: 1, input_height: geometry.sourceMaskHeight, input_width: geometry.sourceMaskWidth, output_channels: 1, output_height: geometry.promptMaskHeight, output_width: geometry.promptMaskWidth, kernel: 4, stride: 4, total_output: geometry.maskDownsampleLength }),
      promptConv0: uniform('prompt-conv-0', convSchema, { batch: geometry.batch, input_channels: 1, input_height: geometry.promptMaskHeight, input_width: geometry.promptMaskWidth, output_channels: 4, output_height: geometry.promptIntermediateHeight, output_width: geometry.promptIntermediateWidth, kernel: 2, stride: 2, total_output: geometry.promptConv0Length }),
      promptConv1: uniform('prompt-conv-1', convSchema, { batch: geometry.batch, input_channels: 4, input_height: geometry.promptIntermediateHeight, input_width: geometry.promptIntermediateWidth, output_channels: 16, output_height: geometry.imageHeight, output_width: geometry.imageWidth, kernel: 2, stride: 2, total_output: geometry.promptConv1Length }),
      promptConv2: uniform('prompt-conv-2', convSchema, { batch: geometry.batch, input_channels: 16, input_height: geometry.imageHeight, input_width: geometry.imageWidth, output_channels: 256, output_height: geometry.imageHeight, output_width: geometry.imageWidth, kernel: 1, stride: 1, total_output: geometry.denseEmbeddingLength }),
      promptNorm0: uniform('prompt-norm-0', norm2dSchema, { batch: geometry.batch, channels: 4, height: geometry.promptIntermediateHeight, width: geometry.promptIntermediateWidth, total_spatial: geometry.batch * geometry.promptIntermediatePixels }),
      promptNorm1: uniform('prompt-norm-1', norm2dSchema, { batch: geometry.batch, channels: 16, height: geometry.imageHeight, width: geometry.imageWidth, total_spatial: geometry.batch * geometry.imageTokens }),
      imagePosition: uniform('image-position', imagePositionSchema, { batch: geometry.batch, height: geometry.imageHeight, width: geometry.imageWidth, channels: geometry.channels, total: geometry.imagePositionLength }),
      keySeed: uniform('key-seed', keySeedSchema, { batch: geometry.batch, image_tokens: geometry.imageTokens, channels: geometry.channels, total: geometry.keyValueLength }),
      maskBlend: uniform('mask-blend', maskBlendSchema, { batch: geometry.batch, channels: geometry.channels, mask_pixels: geometry.sourceMaskPixels, total: geometry.pointerLength }),
      addQueries: uniform('add-queries', addSchema, { total: geometry.queryValueLength, scale: 1 }),
      addKeys: uniform('add-keys', addSchema, { total: geometry.keyValueLength, scale: 1 }),
      normQueries: uniform('norm-queries', normSchema, { total_tokens: geometry.batch * geometry.queryTokens, channels: 256 }),
      normKeys: uniform('norm-keys', normSchema, { total_tokens: geometry.batch * geometry.imageTokens, channels: 256 }),
      linearQ256: uniform('linear-q-256', linearSchema, { input_channels: 256, output_channels: 256, total_output: geometry.queryValueLength }),
      linearK256: uniform('linear-k-256', linearSchema, { input_channels: 256, output_channels: 256, total_output: geometry.keyValueLength }),
      linearQ128: uniform('linear-q-128', linearSchema, { input_channels: 256, output_channels: 128, total_output: geometry.queryAttentionLength }),
      linearK128: uniform('linear-k-128', linearSchema, { input_channels: 256, output_channels: 128, total_output: geometry.keyAttentionLength }),
      linearQFrom128: uniform('linear-q-from-128', linearSchema, { input_channels: 128, output_channels: 256, total_output: geometry.queryValueLength }),
      linearKFrom128: uniform('linear-k-from-128', linearSchema, { input_channels: 128, output_channels: 256, total_output: geometry.keyValueLength }),
      mlpIn: uniform('mlp-in', linearSchema, { input_channels: 256, output_channels: 2048, total_output: geometry.mlpLength }),
      mlpOut: uniform('mlp-out', linearSchema, { input_channels: 2048, output_channels: 256, total_output: geometry.queryValueLength }),
      selfAttention: uniform('self-attention', attentionSchema, { batch: geometry.batch, query_tokens: geometry.queryTokens, key_tokens: geometry.queryTokens, channels: 256, heads: 8, head_dim: 32 }),
      tokenImageAttention: uniform('token-image-attention', attentionSchema, { batch: geometry.batch, query_tokens: geometry.queryTokens, key_tokens: geometry.imageTokens, channels: 128, heads: 8, head_dim: 16 }),
      imageTokenAttention: uniform('image-token-attention', attentionSchema, { batch: geometry.batch, query_tokens: geometry.imageTokens, key_tokens: geometry.queryTokens, channels: 128, heads: 8, head_dim: 16 }),
      gatherObject: uniform('gather-object', gatherSchema, { token_offset: 0, batch: geometry.batch, query_tokens: geometry.queryTokens, channels: geometry.channels, total: geometry.pointerLength }),
      gatherSam: uniform('gather-sam', gatherSchema, { token_offset: 2, batch: geometry.batch, query_tokens: geometry.queryTokens, channels: geometry.channels, total: geometry.pointerLength }),
      headHidden: uniform('head-hidden', linearSchema, { input_channels: geometry.channels, output_channels: geometry.channels, total_output: geometry.pointerLength }),
      scoreOut: uniform('score-out', linearSchema, { input_channels: geometry.channels, output_channels: 1, total_output: geometry.batch }),
      pointer: uniform('pointer', linearSchema, { input_channels: 256, output_channels: 256, total_output: geometry.pointerLength }),
    };
  });

  const programTensors = Object.fromEntries(Object.entries(gpu).filter(([name]) => !['weights', 'uniforms'].includes(name)));
  for (const [key, value] of Object.entries(gpu.weights)) programTensors[gpuWeightName(key)] = value;
  const kernels = {};
  const phases = [];
  const tb = (name, access = 'read-only-storage') => tensorBinding(name, access);
  const w = key => gpuWeightName(key);
  const addKernel = (name, code, bindings) => { kernels[name] = { code, bindings }; return name; };
  const linearKernel = (name, source, prefix, target, dims, code = MEMORY_ATTENTION_LINEAR_WGSL) => addKernel(name, code, [tb(source), tb(w(`${prefix}.weight`)), tb(w(`${prefix}.bias`)), tb(target, 'storage'), uniformBinding(dims)]);
  const normKernel = (name, source, prefix, target, dims) => addKernel(name, MEMORY_ATTENTION_LAYERNORM_WGSL, [tb(source), tb(w(`${prefix}.weight`)), tb(w(`${prefix}.bias`)), tb(target, 'storage'), uniformBinding(dims)]);
  const addOp = (name, left, right, target, dims) => addKernel(name, MEMORY_ATTENTION_ADD_WGSL, [tb(left), tb(right), tb(target, 'storage'), uniformBinding(dims)]);
  const attentionOp = (name, q, k, v, target, dims) => addKernel(name, MEMORY_ATTENTION_ONLINE_SOFTMAX_WGSL, [tb(q), tb(k), tb(v), tb(target, 'storage'), uniformBinding(dims)]);
  const dispatch = (name, kernel, total) => ({
    name,
    kernel,
    dispatch: createSam31InteractivePointerLinearDispatch(total, {
      maxWorkgroupsPerDimension: maxComputeWorkgroupsPerDimension,
    }).dispatch,
  });

  addKernel('outerMaskDownsample', CONV2D_WGSL, [tb('binaryMasks'), tb(w('mask-downsample.weight')), tb(w('mask-downsample.bias')), tb('maskDownsample', 'storage'), uniformBinding('outerConv')]);
  addKernel('promptConv0Kernel', CONV2D_WGSL, [tb('maskDownsample'), tb(w('prompt.mask_downscaling.0.weight')), tb(w('prompt.mask_downscaling.0.bias')), tb('promptConv0', 'storage'), uniformBinding('promptConv0')]);
  addKernel('promptNorm0Kernel', LAYERNORM2D_WGSL, [tb('promptConv0'), tb(w('prompt.mask_downscaling.1.weight')), tb(w('prompt.mask_downscaling.1.bias')), tb('promptNorm0', 'storage'), uniformBinding('promptNorm0')]);
  addKernel('promptGelu0Kernel', GELU_WGSL, [tb('promptNorm0'), tb('promptGelu0', 'storage')]);
  addKernel('promptConv1Kernel', CONV2D_WGSL, [tb('promptGelu0'), tb(w('prompt.mask_downscaling.3.weight')), tb(w('prompt.mask_downscaling.3.bias')), tb('promptConv1', 'storage'), uniformBinding('promptConv1')]);
  addKernel('promptNorm1Kernel', LAYERNORM2D_WGSL, [tb('promptConv1'), tb(w('prompt.mask_downscaling.4.weight')), tb(w('prompt.mask_downscaling.4.bias')), tb('promptNorm1', 'storage'), uniformBinding('promptNorm1')]);
  addKernel('promptGelu1Kernel', GELU_WGSL, [tb('promptNorm1'), tb('promptGelu1', 'storage')]);
  addKernel('promptConv2Kernel', CONV2D_WGSL, [tb('promptGelu1'), tb(w('prompt.mask_downscaling.6.weight')), tb(w('prompt.mask_downscaling.6.bias')), tb('denseEmbedding', 'storage'), uniformBinding('promptConv2')]);
  addKernel('imagePositionKernel', IMAGE_POSITION_WGSL, [tb(w('prompt.pe_layer.positional_encoding_gaussian_matrix')), tb('imagePosition', 'storage'), uniformBinding('imagePosition')]);
  addKernel('querySeedKernel', QUERY_SEED_WGSL, [tb(w('decoder.obj_score_token.weight')), tb(w('decoder.iou_token.weight')), tb(w('decoder.mask_tokens.weight')), tb(w('prompt.not_a_point_embed.weight')), tb('point', 'storage'), tb('hiddenA', 'storage')]);
  addKernel('keySeedKernel', KEY_SEED_WGSL, [tb('imageEmbedding'), tb('denseEmbedding'), tb('keyA', 'storage'), uniformBinding('keySeed')]);
  phases.push(
    dispatch('interactive-pointer-mask-downsample', 'outerMaskDownsample', geometry.maskDownsampleLength),
    dispatch('interactive-pointer-prompt-conv-0', 'promptConv0Kernel', geometry.promptConv0Length),
    dispatch('interactive-pointer-prompt-norm-0', 'promptNorm0Kernel', geometry.batch * geometry.promptIntermediatePixels),
    dispatch('interactive-pointer-prompt-gelu-0', 'promptGelu0Kernel', geometry.promptConv0Length),
    dispatch('interactive-pointer-prompt-conv-1', 'promptConv1Kernel', geometry.promptConv1Length),
    dispatch('interactive-pointer-prompt-norm-1', 'promptNorm1Kernel', geometry.batch * geometry.imageTokens),
    dispatch('interactive-pointer-prompt-gelu-1', 'promptGelu1Kernel', geometry.promptConv1Length),
    { ...dispatch('interactive-pointer-prompt-encode', 'promptConv2Kernel', geometry.denseEmbeddingLength), yieldAfter: true },
    dispatch('interactive-pointer-image-position', 'imagePositionKernel', geometry.imagePositionLength),
    dispatch('interactive-pointer-query-seed', 'querySeedKernel', geometry.queryValueLength),
    dispatch('interactive-pointer-key-seed', 'keySeedKernel', geometry.keyValueLength),
  );

  for (let layer = 0; layer < 2; layer += 1) {
    const base = `decoder.transformer.layers.${layer}`;
    const selfInput = layer === 0 ? 'hiddenA' : 'querySum';
    if (layer === 1) {
      addOp(`layer${layer}SelfPosition`, 'hiddenA', 'point', 'querySum', 'addQueries');
      phases.push(dispatch(`interactive-pointer-layer-${layer}-self-position`, `layer${layer}SelfPosition`, geometry.queryValueLength));
    }
    linearKernel(`layer${layer}SelfQ`, selfInput, `${base}.self_attn.q_proj`, 'q', 'linearQ256');
    linearKernel(`layer${layer}SelfK`, selfInput, `${base}.self_attn.k_proj`, 'k', 'linearQ256');
    linearKernel(`layer${layer}SelfV`, 'hiddenA', `${base}.self_attn.v_proj`, 'v', 'linearQ256');
    attentionOp(`layer${layer}SelfAttention`, 'q', 'k', 'v', 'attention', 'selfAttention');
    linearKernel(`layer${layer}SelfOut`, 'attention', `${base}.self_attn.out_proj`, 'projected', 'linearQ256');
    if (layer === 0) normKernel(`layer${layer}Norm1`, 'projected', `${base}.norm1`, 'hiddenA', 'normQueries');
    else {
      addOp(`layer${layer}SelfResidual`, 'hiddenA', 'projected', 'hiddenB', 'addQueries');
      normKernel(`layer${layer}Norm1`, 'hiddenB', `${base}.norm1`, 'hiddenA', 'normQueries');
    }
    phases.push(
      dispatch(`interactive-pointer-layer-${layer}-self-q`, `layer${layer}SelfQ`, geometry.queryValueLength),
      dispatch(`interactive-pointer-layer-${layer}-self-k`, `layer${layer}SelfK`, geometry.queryValueLength),
      dispatch(`interactive-pointer-layer-${layer}-self-v`, `layer${layer}SelfV`, geometry.queryValueLength),
      { name: `interactive-pointer-layer-${layer}-self-attention`, kernel: `layer${layer}SelfAttention`, dispatch: [geometry.queryTokens, geometry.heads, geometry.batch], yieldAfter: true },
      dispatch(`interactive-pointer-layer-${layer}-self-output`, `layer${layer}SelfOut`, geometry.queryValueLength),
      ...(layer === 0 ? [] : [dispatch(`interactive-pointer-layer-${layer}-self-residual`, `layer${layer}SelfResidual`, geometry.queryValueLength)]),
      dispatch(`interactive-pointer-layer-${layer}-norm-1`, `layer${layer}Norm1`, geometry.batch * geometry.queryTokens),
    );

    addOp(`layer${layer}QueryPosition`, 'hiddenA', 'point', 'querySum', 'addQueries');
    addOp(`layer${layer}KeyPosition`, 'keyA', 'imagePosition', 'keySum', 'addKeys');
    linearKernel(`layer${layer}TokenQ`, 'querySum', `${base}.cross_attn_token_to_image.q_proj`, 'q', 'linearQ128');
    linearKernel(`layer${layer}ImageK`, 'keySum', `${base}.cross_attn_token_to_image.k_proj`, 'k', 'linearK128');
    linearKernel(`layer${layer}ImageV`, 'keyA', `${base}.cross_attn_token_to_image.v_proj`, 'v', 'linearK128');
    attentionOp(`layer${layer}TokenImageAttention`, 'q', 'k', 'v', 'attention', 'tokenImageAttention');
    linearKernel(`layer${layer}TokenImageOut`, 'attention', `${base}.cross_attn_token_to_image.out_proj`, 'projected', 'linearQFrom128');
    addOp(`layer${layer}TokenImageResidual`, 'hiddenA', 'projected', 'hiddenB', 'addQueries');
    normKernel(`layer${layer}Norm2`, 'hiddenB', `${base}.norm2`, 'hiddenA', 'normQueries');
    phases.push(
      dispatch(`interactive-pointer-layer-${layer}-query-position`, `layer${layer}QueryPosition`, geometry.queryValueLength),
      dispatch(`interactive-pointer-layer-${layer}-key-position`, `layer${layer}KeyPosition`, geometry.keyValueLength),
      dispatch(`interactive-pointer-layer-${layer}-token-q`, `layer${layer}TokenQ`, geometry.queryAttentionLength), dispatch(`interactive-pointer-layer-${layer}-image-k`, `layer${layer}ImageK`, geometry.keyAttentionLength), dispatch(`interactive-pointer-layer-${layer}-image-v`, `layer${layer}ImageV`, geometry.keyAttentionLength),
      { name: `interactive-pointer-layer-${layer}-token-image-attention`, kernel: `layer${layer}TokenImageAttention`, dispatch: [geometry.queryTokens, geometry.heads, geometry.batch], yieldAfter: true },
      dispatch(`interactive-pointer-layer-${layer}-token-image-output`, `layer${layer}TokenImageOut`, geometry.queryValueLength),
      dispatch(`interactive-pointer-layer-${layer}-token-image-residual`, `layer${layer}TokenImageResidual`, geometry.queryValueLength),
      dispatch(`interactive-pointer-layer-${layer}-norm-2`, `layer${layer}Norm2`, geometry.batch * geometry.queryTokens),
    );

    linearKernel(`layer${layer}MlpIn`, 'hiddenA', `${base}.mlp.lin1`, 'mlp', 'mlpIn', LINEAR_RELU_WGSL);
    linearKernel(`layer${layer}MlpOut`, 'mlp', `${base}.mlp.lin2`, 'projected', 'mlpOut');
    addOp(`layer${layer}MlpResidual`, 'hiddenA', 'projected', 'hiddenB', 'addQueries');
    normKernel(`layer${layer}Norm3`, 'hiddenB', `${base}.norm3`, 'hiddenA', 'normQueries');
    phases.push(dispatch(`interactive-pointer-layer-${layer}-mlp-in`, `layer${layer}MlpIn`, geometry.mlpLength), dispatch(`interactive-pointer-layer-${layer}-mlp-out`, `layer${layer}MlpOut`, geometry.queryValueLength), dispatch(`interactive-pointer-layer-${layer}-mlp-residual`, `layer${layer}MlpResidual`, geometry.queryValueLength), { ...dispatch(`interactive-pointer-layer-${layer}-norm-3`, `layer${layer}Norm3`, geometry.batch * geometry.queryTokens), yieldAfter: true });

    addOp(`layer${layer}ImagePosition`, 'keyA', 'imagePosition', 'keySum', 'addKeys');
    addOp(`layer${layer}TokenPosition`, 'hiddenA', 'point', 'querySum', 'addQueries');
    linearKernel(`layer${layer}ImageQ`, 'keySum', `${base}.cross_attn_image_to_token.q_proj`, 'q', 'linearK128');
    linearKernel(`layer${layer}TokenK`, 'querySum', `${base}.cross_attn_image_to_token.k_proj`, 'k', 'linearQ128');
    linearKernel(`layer${layer}TokenV`, 'hiddenA', `${base}.cross_attn_image_to_token.v_proj`, 'v', 'linearQ128');
    attentionOp(`layer${layer}ImageTokenAttention`, 'q', 'k', 'v', 'attention', 'imageTokenAttention');
    linearKernel(`layer${layer}ImageTokenOut`, 'attention', `${base}.cross_attn_image_to_token.out_proj`, 'projected', 'linearKFrom128');
    addOp(`layer${layer}ImageTokenResidual`, 'keyA', 'projected', 'keyB', 'addKeys');
    normKernel(`layer${layer}Norm4`, 'keyB', `${base}.norm4`, 'keyA', 'normKeys');
    phases.push(
      dispatch(`interactive-pointer-layer-${layer}-image-position`, `layer${layer}ImagePosition`, geometry.keyValueLength),
      dispatch(`interactive-pointer-layer-${layer}-token-position`, `layer${layer}TokenPosition`, geometry.queryValueLength),
      dispatch(`interactive-pointer-layer-${layer}-image-q`, `layer${layer}ImageQ`, geometry.keyAttentionLength), dispatch(`interactive-pointer-layer-${layer}-token-k`, `layer${layer}TokenK`, geometry.queryAttentionLength), dispatch(`interactive-pointer-layer-${layer}-token-v`, `layer${layer}TokenV`, geometry.queryAttentionLength),
      { name: `interactive-pointer-layer-${layer}-image-token-attention`, kernel: `layer${layer}ImageTokenAttention`, dispatch: [geometry.imageTokens, geometry.heads, geometry.batch], yieldAfter: true },
      dispatch(`interactive-pointer-layer-${layer}-image-token-output`, `layer${layer}ImageTokenOut`, geometry.keyValueLength),
      dispatch(`interactive-pointer-layer-${layer}-image-token-residual`, `layer${layer}ImageTokenResidual`, geometry.keyValueLength),
      dispatch(`interactive-pointer-layer-${layer}-norm-4`, `layer${layer}Norm4`, geometry.batch * geometry.imageTokens),
      { name: `interactive-pointer-layer-${layer}-readback`, readbacks: [{ name: `layer${layer}Queries`, tensor: 'hiddenA' }, { name: `layer${layer}Keys`, tensor: 'keyA' }] },
    );
  }

  addOp('finalQueryPosition', 'hiddenA', 'point', 'querySum', 'addQueries');
  addOp('finalKeyPosition', 'keyA', 'imagePosition', 'keySum', 'addKeys');
  linearKernel('finalQ', 'querySum', 'decoder.transformer.final_attn_token_to_image.q_proj', 'q', 'linearQ128');
  linearKernel('finalK', 'keySum', 'decoder.transformer.final_attn_token_to_image.k_proj', 'k', 'linearK128');
  linearKernel('finalV', 'keyA', 'decoder.transformer.final_attn_token_to_image.v_proj', 'v', 'linearK128');
  attentionOp('finalAttention', 'q', 'k', 'v', 'attention', 'tokenImageAttention');
  linearKernel('finalOut', 'attention', 'decoder.transformer.final_attn_token_to_image.out_proj', 'projected', 'linearQFrom128');
  addOp('finalResidual', 'hiddenA', 'projected', 'hiddenB', 'addQueries');
  normKernel('finalNorm', 'hiddenB', 'decoder.transformer.norm_final_attn', 'hiddenA', 'normQueries');
  phases.push(
    dispatch('interactive-pointer-final-query-position', 'finalQueryPosition', geometry.queryValueLength),
    dispatch('interactive-pointer-final-key-position', 'finalKeyPosition', geometry.keyValueLength),
    dispatch('interactive-pointer-final-q', 'finalQ', geometry.queryAttentionLength), dispatch('interactive-pointer-final-k', 'finalK', geometry.keyAttentionLength), dispatch('interactive-pointer-final-v', 'finalV', geometry.keyAttentionLength),
    { name: 'interactive-pointer-final-attention', kernel: 'finalAttention', dispatch: [geometry.queryTokens, geometry.heads, geometry.batch], yieldAfter: true },
    dispatch('interactive-pointer-final-output', 'finalOut', geometry.queryValueLength),
    dispatch('interactive-pointer-final-residual', 'finalResidual', geometry.queryValueLength),
    { ...dispatch('interactive-pointer-two-way-transformer', 'finalNorm', geometry.batch * geometry.queryTokens), yieldAfter: true },
  );

  addKernel('gatherObjectToken', TOKEN_GATHER_WGSL, [tb('hiddenA'), tb('objectTokens', 'storage'), uniformBinding('gatherObject')]);
  addKernel('gatherSamToken', TOKEN_GATHER_WGSL, [tb('hiddenA'), tb('samTokens', 'storage'), uniformBinding('gatherSam')]);
  linearKernel('objectHead0', 'objectTokens', 'decoder.pred_obj_score_head.layers.0', 'objectHiddenA', 'headHidden', LINEAR_RELU_WGSL);
  linearKernel('objectHead1', 'objectHiddenA', 'decoder.pred_obj_score_head.layers.1', 'objectHiddenB', 'headHidden', LINEAR_RELU_WGSL);
  linearKernel('objectHead2', 'objectHiddenB', 'decoder.pred_obj_score_head.layers.2', 'objectScores', 'scoreOut');
  linearKernel('pointer0', 'samTokens', 'interactive-pointer.layers.0', 'pointerA', 'pointer', LINEAR_RELU_WGSL);
  linearKernel('pointer1', 'pointerA', 'interactive-pointer.layers.1', 'pointerB', 'pointer', LINEAR_RELU_WGSL);
  linearKernel('pointer2', 'pointerB', 'interactive-pointer.layers.2', 'projectedPointers', 'pointer');
  linearKernel('noObjectFirst', 'projectedPointers', 'no-object-pointer', 'firstNoObject', 'pointer');
  addKernel('scoreBlend', SCORE_BLEND_WGSL, [tb('objectScores'), tb('projectedPointers'), tb('firstNoObject'), tb('forwardPointers', 'storage')]);
  linearKernel('noObjectFinal', 'forwardPointers', 'no-object-pointer', 'finalNoObject', 'pointer');
  addKernel('maskBlend', MASK_BLEND_WGSL, [tb('binaryMasks'), tb('forwardPointers'), tb('finalNoObject'), tb('objectPointers', 'storage'), uniformBinding('maskBlend')]);
  phases.push(
    { name: 'interactive-pointer-gather-object-token', kernel: 'gatherObjectToken', dispatch: [64] },
    { name: 'interactive-pointer-gather-sam-token', kernel: 'gatherSamToken', dispatch: [64] },
    dispatch('interactive-pointer-object-head-0', 'objectHead0', geometry.pointerLength), dispatch('interactive-pointer-object-head-1', 'objectHead1', geometry.pointerLength), dispatch('interactive-pointer-object-head-2', 'objectHead2', geometry.batch),
    dispatch('interactive-pointer-projection-0', 'pointer0', geometry.pointerLength), dispatch('interactive-pointer-projection-1', 'pointer1', geometry.pointerLength),
    { ...dispatch('interactive-pointer-object-projection', 'pointer2', geometry.pointerLength), yieldAfter: true },
    dispatch('interactive-pointer-first-no-object-linear', 'noObjectFirst', geometry.pointerLength),
    dispatch('interactive-pointer-first-no-object-transition', 'scoreBlend', geometry.pointerLength),
    dispatch('interactive-pointer-final-no-object-linear', 'noObjectFinal', geometry.pointerLength),
    { ...dispatch('interactive-pointer-final-no-object-transition', 'maskBlend', geometry.pointerLength), yieldAfter: true },
    { name: 'interactive-pointer-readback', readbacks: [
      { name: 'maskDownsample', tensor: 'maskDownsample' },
      { name: 'denseEmbeddings', tensor: 'denseEmbedding' },
      { name: 'imagePosition', tensor: 'imagePosition' },
      { name: 'samOutputTokens', tensor: 'samTokens' },
      { name: 'decoderObjectScores', tensor: 'objectScores' },
      { name: 'projectedPointers', tensor: 'projectedPointers' },
      { name: 'forwardObjectPointers', tensor: 'forwardPointers' },
      { name: 'objectPointers', tensor: 'objectPointers' },
    ] },
  );

  const program = runtime.defineProgram({
    name: 'sam31.interactive-pointer-phase-program',
    tensors: programTensors,
    uniforms: gpu.uniforms,
    kernels,
    phases,
    metadata: {
      routeId: route.routeId,
      sourceBoundary: 'Meta _use_mask_as_output H*16 source mask -> interactive_mask_downsample H*4 prompt mask -> PromptEncoder H feature grid',
      batch: geometry.batch,
      queryTokens: geometry.queryTokens,
      imageTokens: geometry.imageTokens,
      imageHeight: geometry.imageHeight,
      imageWidth: geometry.imageWidth,
      sourceImageHeight: geometry.sourceImageHeight,
      sourceImageWidth: geometry.sourceImageWidth,
      sourceMaskHeight: geometry.sourceMaskHeight,
      sourceMaskWidth: geometry.sourceMaskWidth,
      promptMaskHeight: geometry.promptMaskHeight,
      promptMaskWidth: geometry.promptMaskWidth,
      decoderMaskHeight: geometry.decoderMaskHeight,
      decoderMaskWidth: geometry.decoderMaskWidth,
    },
  });
  const run = await runtime.runProgram(program);
  const objectPointers = run.outputs.objectPointers;
  const outputs = {
    objectPointers: {
      artifactId: roleArtifact(input.request.outputs, 'sam31-interactive-object-pointers').artifactId,
      sha256: await sha256Hex(objectPointers),
      shape: [geometry.batch, geometry.channels],
    },
  };
  const receipt = createSam31InteractivePointerPhaseProgramRouteReceipt({
    sourceFrame: roleArtifact(input.request.inputs, 'source-frame'),
    binaryMasks: roleArtifact(input.request.inputs, 'sam31-binary-mask-inputs'),
    imageEmbedding: roleArtifact(input.request.inputs, 'sam31-interactive-image-embedding'),
    weights: roleArtifact(input.request.inputs, 'sam31-interactive-pointer-weights'),
    outputs,
    backend: runtime.backendIdentity,
    model: { revision: input.model?.revision || route.model.revision, weightsHash: input.model?.weightsHash || roleArtifact(input.request.inputs, 'sam31-interactive-pointer-weights').sha256 },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  });
  const result = assertAuthoritativeRouteWorkerResult(createRouteWorkerResult(route, { request: input.request, receipt }), route);
  if (input.includeReadback) {
    result.debugReadback = {
      maskDownsample: Array.from(new Float32Array(run.outputs.maskDownsample)),
      denseEmbeddings: Array.from(new Float32Array(run.outputs.denseEmbeddings)),
      imagePosition: Array.from(new Float32Array(run.outputs.imagePosition)).slice(0, geometry.imageEmbeddingLength),
      layerQueries: [0, 1].map(layer => Array.from(new Float32Array(run.outputs[`layer${layer}Queries`]))),
      layerKeys: [0, 1].map(layer => Array.from(new Float32Array(run.outputs[`layer${layer}Keys`]))),
      samOutputTokens: Array.from(new Float32Array(run.outputs.samOutputTokens)),
      decoderObjectScores: Array.from(new Float32Array(run.outputs.decoderObjectScores)),
      projectedPointers: Array.from(new Float32Array(run.outputs.projectedPointers)),
      forwardObjectPointers: Array.from(new Float32Array(run.outputs.forwardObjectPointers)),
      objectPointers: Array.from(new Float32Array(objectPointers)),
    };
  }
  result.resourceDisposal = runtime.dispose();
  return result;
}
