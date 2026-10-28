import { WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';

export const PIXAL3D_NAF_ROUTE = 'pixal3d.naf.webgpu.v0';

const f = Math.fround;

export function nattenWindowIndices(length, kernel, dilation = 1) {
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new RangeError('length must be a positive integer');
  }
  if (!Number.isSafeInteger(kernel) || kernel < 1 || kernel % 2 === 0) {
    throw new RangeError('neighborhood kernel must be a positive odd integer');
  }
  if (!Number.isSafeInteger(dilation) || dilation < 1) {
    throw new RangeError('dilation must be a positive integer');
  }
  const out = new Int32Array(length * kernel);
  const half = Math.floor(kernel / 2);
  for (let i = 0; i < length; i++) {
    const group = i % dilation;
    const a = Math.floor(i / dilation);
    const groupLen = Math.floor((length - group + dilation - 1) / dilation);
    if (groupLen < kernel) {
      throw new RangeError(
        `neighborhood kernel ${kernel} with dilation ${dilation} needs length >= ${kernel * dilation}, got ${length}`,
      );
    }
    const start = Math.max(0, Math.min(groupLen - kernel, a - half));
    for (let k = 0; k < kernel; k++) {
      out[i * kernel + k] = group + (start + k) * dilation;
    }
  }
  return out;
}

export function buildPixal3dNafPlan({
  dim = 256,
  headsAttn = 4,
  headsRope = 4,
  kernelSize = 9,
  imgLayers = 2,
  numGroups = 8,
  ropeBase = 100.0,
  imageHeight = 512,
  imageWidth = 512,
  featureHeight = 32,
  featureWidth = 32,
  featureChannels = 1024,
  outputHeight = 512,
  outputWidth = 512,
  prefixTokens = 5,
} = {}) {
  for (const [name, value] of Object.entries({
    dim,
    headsAttn,
    headsRope,
    kernelSize,
    imgLayers,
    numGroups,
    imageHeight,
    imageWidth,
    featureHeight,
    featureWidth,
    featureChannels,
    outputHeight,
    outputWidth,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer`);
    }
  }
  if (!Number.isSafeInteger(prefixTokens) || prefixTokens < 0) {
    throw new RangeError('prefixTokens must be a non-negative integer');
  }
  if (!Number.isFinite(ropeBase) || ropeBase <= 0) {
    throw new RangeError('ropeBase must be a finite positive number');
  }
  if (dim % 2 !== 0 || (dim / 2) % numGroups !== 0) {
    throw new RangeError('dim / 2 must be divisible by numGroups');
  }
  if (dim % headsAttn !== 0 || featureChannels % headsAttn !== 0) {
    throw new RangeError('dim and featureChannels must be divisible by headsAttn');
  }
  if (dim % (4 * headsRope) !== 0) {
    throw new RangeError('dim must be divisible by 4 * headsRope');
  }
  if (kernelSize % 2 === 0) {
    throw new RangeError('kernelSize must be odd');
  }
  if (
    outputHeight < featureHeight ||
    outputWidth < featureWidth ||
    outputHeight % featureHeight !== 0 ||
    outputWidth % featureWidth !== 0
  ) {
    throw new RangeError('output spatial size must be an integer multiple of feature spatial size');
  }
  if (imageHeight < outputHeight || imageWidth < outputWidth || imageHeight % outputHeight !== 0 || imageWidth % outputWidth !== 0) {
    throw new RangeError('image spatial size must be an integer multiple of output spatial size');
  }
  const dilationH = outputHeight / featureHeight;
  const dilationW = outputWidth / featureWidth;
  nattenWindowIndices(outputHeight, kernelSize, dilationH);
  nattenWindowIndices(outputWidth, kernelSize, dilationW);

  const branchChannels = dim / 2;
  const stages = ['naf-encoder-1x1-0', 'naf-encoder-3x3-0'];
  for (let i = 1; i <= imgLayers; i++) {
    stages.push(
      `naf-encoder-1x1-${i}-norm1-silu`,
      `naf-encoder-1x1-${i}-conv1`,
      `naf-encoder-1x1-${i}-norm2-silu`,
      `naf-encoder-1x1-${i}-conv2`,
      `naf-encoder-3x3-${i}-norm1-silu`,
      `naf-encoder-3x3-${i}-conv1`,
      `naf-encoder-3x3-${i}-norm2-silu`,
      `naf-encoder-3x3-${i}-conv2`,
    );
  }
  stages.push('naf-concat-pool-rope', 'naf-keys-pool', 'naf-neighborhood-cross-attention');

  return Object.freeze({
    dim,
    branchChannels,
    headsAttn,
    headsRope,
    headDimAttn: dim / headsAttn,
    headDimValue: featureChannels / headsAttn,
    headDimRope: dim / headsRope,
    kernelSize,
    imgLayers,
    numGroups,
    ropeBase,
    imageHeight,
    imageWidth,
    featureHeight,
    featureWidth,
    featureChannels,
    outputHeight,
    outputWidth,
    dilationH,
    dilationW,
    prefixTokens,
    conditioningTokens: prefixTokens + featureHeight * featureWidth,
    scale: Math.pow(dim / headsAttn, -0.5),
    imageShape: Object.freeze([1, imageHeight, imageWidth, 3]),
    outputShape: Object.freeze([1, featureChannels, outputHeight, outputWidth]),
    stages: Object.freeze(stages),
    weightLayout: 'source-checkpoint-OIHW',
    normEpsilon: 1e-5,
  });
}

export function pixal3dNafWeightShapes(plan = buildPixal3dNafPlan()) {
  const c = plan.branchChannels;
  const shapes = {
    'image_encoder.encoder.0.weight': [c, 3, 1, 1],
    'image_encoder.encoder.0.bias': [c],
    'image_encoder.sem_encoder.0.weight': [c, 3, 3, 3],
    'image_encoder.sem_encoder.0.bias': [c],
    'image_encoder.rope.periods': [plan.headDimRope / 4],
  };
  for (let i = 1; i <= plan.imgLayers; i++) {
    for (const [prefix, ks] of [
      ['image_encoder.encoder', 1],
      ['image_encoder.sem_encoder', 3],
    ]) {
      shapes[`${prefix}.${i}.norm1.weight`] = [c];
      shapes[`${prefix}.${i}.norm1.bias`] = [c];
      shapes[`${prefix}.${i}.conv1.weight`] = [c, c, ks, ks];
      shapes[`${prefix}.${i}.conv1.bias`] = [c];
      shapes[`${prefix}.${i}.norm2.weight`] = [c];
      shapes[`${prefix}.${i}.norm2.bias`] = [c];
      shapes[`${prefix}.${i}.conv2.weight`] = [c, c, ks, ks];
      shapes[`${prefix}.${i}.conv2.bias`] = [c];
    }
  }
  return shapes;
}

export function validatePixal3dNafWeights(plan, weights) {
  const shapes = pixal3dNafWeightShapes(plan);
  for (const [key, shape] of Object.entries(shapes)) {
    const count = shape.reduce((a, b) => a * b, 1);
    const tensor = weights?.[key];
    if (!(tensor instanceof Float32Array) || tensor.length !== count) {
      throw new TypeError(`${key} requires Float32Array of length ${count}`);
    }
    if (!tensor.every(Number.isFinite)) {
      throw new TypeError(`${key} contains non-finite values`);
    }
  }
  return shapes;
}

function reflectIndex(coord, length) {
  if (coord < 0) return -coord;
  if (coord >= length) return 2 * length - 2 - coord;
  return coord;
}

function conv2dBchw(input, inC, H, W, weight, bias, outC, ks) {
  const out = new Float32Array(outC * H * W);
  const pad = Math.floor(ks / 2);
  const hw = H * W;
  for (let oc = 0; oc < outC; oc++) {
    const b = bias[oc];
    const wOutBase = oc * inC * ks * ks;
    const outPlane = oc * hw;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = b;
        for (let ic = 0; ic < inC; ic++) {
          const inPlane = ic * hw;
          const wInBase = wOutBase + ic * ks * ks;
          if (ks === 1) {
            sum = f(sum + f(input[inPlane + y * W + x] * weight[wInBase]));
          } else {
            for (let ky = 0; ky < ks; ky++) {
              const ry = reflectIndex(y + ky - pad, H);
              for (let kx = 0; kx < ks; kx++) {
                const rx = reflectIndex(x + kx - pad, W);
                sum = f(sum + f(input[inPlane + ry * W + rx] * weight[wInBase + ky * ks + kx]));
              }
            }
          }
        }
        out[outPlane + y * W + x] = sum;
      }
    }
  }
  return out;
}

function groupNormSiluBchw(input, C, H, W, numGroups, weight, bias, eps = 1e-5) {
  const out = new Float32Array(C * H * W);
  const channelsPerGroup = C / numGroups;
  const hw = H * W;
  const groupSize = channelsPerGroup * hw;
  for (let g = 0; g < numGroups; g++) {
    const cStart = g * channelsPerGroup;
    let sum = 0.0;
    for (let c = cStart; c < cStart + channelsPerGroup; c++) {
      const plane = c * hw;
      for (let i = 0; i < hw; i++) sum += input[plane + i];
    }
    const mean = f(sum / groupSize);
    let varSum = 0.0;
    for (let c = cStart; c < cStart + channelsPerGroup; c++) {
      const plane = c * hw;
      for (let i = 0; i < hw; i++) {
        const d = input[plane + i] - mean;
        varSum += d * d;
      }
    }
    const invStd = f(1.0 / Math.sqrt(varSum / groupSize + eps));
    for (let c = cStart; c < cStart + channelsPerGroup; c++) {
      const plane = c * hw;
      const w = weight[c];
      const b = bias[c];
      for (let i = 0; i < hw; i++) {
        const norm = f(f(f(input[plane + i] - mean) * invStd) * w + b);
        out[plane + i] = f(norm / f(1.0 + f(Math.exp(-norm))));
      }
    }
  }
  return out;
}

function avgPool2dBchw(input, C, H, W, outH, outW) {
  if (H === outH && W === outW) return input.slice();
  const out = new Float32Array(C * outH * outW);
  const sh = H / outH;
  const sw = W / outW;
  const invCount = 1.0 / (sh * sw);
  for (let c = 0; c < C; c++) {
    const inPlane = c * H * W;
    const outPlane = c * outH * outW;
    for (let oy = 0; oy < outH; oy++) {
      for (let ox = 0; ox < outW; ox++) {
        let sum = 0.0;
        for (let dy = 0; dy < sh; dy++) {
          const rowBase = inPlane + (oy * sh + dy) * W + ox * sw;
          for (let dx = 0; dx < sw; dx++) {
            sum += input[rowBase + dx];
          }
        }
        out[outPlane + oy * outW + ox] = f(sum * invCount);
      }
    }
  }
  return out;
}

function applyNafRopeBchw(input, C, H, W, headsRope, periods) {
  const out = new Float32Array(C * H * W);
  const d = C / headsRope;
  const half = d / 2;
  const quarter = d / 4;
  const hw = H * W;
  const cosTable = new Float32Array(hw * d);
  const sinTable = new Float32Array(hw * d);
  for (let y = 0; y < H; y++) {
    const ch = f(((y + 0.5) / H) * 2.0 - 1.0);
    for (let x = 0; x < W; x++) {
      const cw = f(((x + 0.5) / W) * 2.0 - 1.0);
      const pos = y * W + x;
      for (let p = 0; p < quarter; p++) {
        const ah = f((2.0 * Math.PI * ch) / periods[p]);
        const aw = f((2.0 * Math.PI * cw) / periods[p]);
        const chCos = f(Math.cos(ah));
        const chSin = f(Math.sin(ah));
        const cwCos = f(Math.cos(aw));
        const cwSin = f(Math.sin(aw));
        cosTable[pos * d + p] = chCos;
        sinTable[pos * d + p] = chSin;
        cosTable[pos * d + quarter + p] = cwCos;
        sinTable[pos * d + quarter + p] = cwSin;
        cosTable[pos * d + half + p] = chCos;
        sinTable[pos * d + half + p] = chSin;
        cosTable[pos * d + half + quarter + p] = cwCos;
        sinTable[pos * d + half + quarter + p] = cwSin;
      }
    }
  }
  for (let h = 0; h < headsRope; h++) {
    const headBase = h * d;
    for (let pos = 0; pos < hw; pos++) {
      for (let c = 0; c < d; c++) {
        const mate = c < half ? c + half : c - half;
        const val = input[(headBase + c) * hw + pos];
        const mateVal = input[(headBase + mate) * hw + pos];
        const rotated = c < half ? -mateVal : mateVal;
        const idx = pos * d + c;
        out[(headBase + c) * hw + pos] = f(f(val * cosTable[idx]) + f(rotated * sinTable[idx]));
      }
    }
  }
  return out;
}

export function runPixal3dNafCpu({
  plan = buildPixal3dNafPlan(),
  weights,
  image,
  imageLayout = 'nhwc',
  features,
  featureLayout = 'tokens',
} = {}) {
  validatePixal3dNafWeights(plan, weights);
  const H = plan.imageHeight;
  const W = plan.imageWidth;
  const hw = H * W;
  if (!(image instanceof Float32Array) || image.length !== 3 * hw || !image.every(Number.isFinite)) {
    throw new TypeError(`image must be finite Float32Array of length ${3 * hw}`);
  }
  let imageBchw;
  if (imageLayout === 'bchw') {
    imageBchw = image;
  } else if (imageLayout === 'nhwc') {
    imageBchw = new Float32Array(3 * hw);
    for (let pos = 0; pos < hw; pos++) {
      imageBchw[pos] = image[pos * 3];
      imageBchw[hw + pos] = image[pos * 3 + 1];
      imageBchw[2 * hw + pos] = image[pos * 3 + 2];
    }
  } else {
    throw new TypeError('imageLayout must be nhwc or bchw');
  }

  const Hf = plan.featureHeight;
  const Wf = plan.featureWidth;
  const fhw = Hf * Wf;
  const Cv = plan.featureChannels;
  let valuesBchw;
  if (featureLayout === 'bchw') {
    if (!(features instanceof Float32Array) || features.length !== Cv * fhw || !features.every(Number.isFinite)) {
      throw new TypeError(`features must be finite Float32Array of length ${Cv * fhw}`);
    }
    valuesBchw = features;
  } else if (featureLayout === 'tokens') {
    const expectedLen = plan.conditioningTokens * Cv;
    if (!(features instanceof Float32Array) || features.length !== expectedLen || !features.every(Number.isFinite)) {
      throw new TypeError(`features must be finite Float32Array of length ${expectedLen}`);
    }
    valuesBchw = new Float32Array(Cv * fhw);
    const offset = plan.prefixTokens * Cv;
    for (let pos = 0; pos < fhw; pos++) {
      for (let c = 0; c < Cv; c++) {
        valuesBchw[c * fhw + pos] = features[offset + pos * Cv + c];
      }
    }
  } else {
    throw new TypeError('featureLayout must be tokens or bchw');
  }

  const bc = plan.branchChannels;
  let x1 = conv2dBchw(
    imageBchw,
    3,
    H,
    W,
    weights['image_encoder.encoder.0.weight'],
    weights['image_encoder.encoder.0.bias'],
    bc,
    1,
  );
  let x3 = conv2dBchw(
    imageBchw,
    3,
    H,
    W,
    weights['image_encoder.sem_encoder.0.weight'],
    weights['image_encoder.sem_encoder.0.bias'],
    bc,
    3,
  );
  for (let i = 1; i <= plan.imgLayers; i++) {
    x1 = groupNormSiluBchw(
      x1,
      bc,
      H,
      W,
      plan.numGroups,
      weights[`image_encoder.encoder.${i}.norm1.weight`],
      weights[`image_encoder.encoder.${i}.norm1.bias`],
    );
    x1 = conv2dBchw(
      x1,
      bc,
      H,
      W,
      weights[`image_encoder.encoder.${i}.conv1.weight`],
      weights[`image_encoder.encoder.${i}.conv1.bias`],
      bc,
      1,
    );
    x1 = groupNormSiluBchw(
      x1,
      bc,
      H,
      W,
      plan.numGroups,
      weights[`image_encoder.encoder.${i}.norm2.weight`],
      weights[`image_encoder.encoder.${i}.norm2.bias`],
    );
    x1 = conv2dBchw(
      x1,
      bc,
      H,
      W,
      weights[`image_encoder.encoder.${i}.conv2.weight`],
      weights[`image_encoder.encoder.${i}.conv2.bias`],
      bc,
      1,
    );

    x3 = groupNormSiluBchw(
      x3,
      bc,
      H,
      W,
      plan.numGroups,
      weights[`image_encoder.sem_encoder.${i}.norm1.weight`],
      weights[`image_encoder.sem_encoder.${i}.norm1.bias`],
    );
    x3 = conv2dBchw(
      x3,
      bc,
      H,
      W,
      weights[`image_encoder.sem_encoder.${i}.conv1.weight`],
      weights[`image_encoder.sem_encoder.${i}.conv1.bias`],
      bc,
      3,
    );
    x3 = groupNormSiluBchw(
      x3,
      bc,
      H,
      W,
      plan.numGroups,
      weights[`image_encoder.sem_encoder.${i}.norm2.weight`],
      weights[`image_encoder.sem_encoder.${i}.norm2.bias`],
    );
    x3 = conv2dBchw(
      x3,
      bc,
      H,
      W,
      weights[`image_encoder.sem_encoder.${i}.conv2.weight`],
      weights[`image_encoder.sem_encoder.${i}.conv2.bias`],
      bc,
      3,
    );
  }

  const concat = new Float32Array(plan.dim * hw);
  concat.set(x1, 0);
  concat.set(x3, bc * hw);

  const Hq = plan.outputHeight;
  const Wq = plan.outputWidth;
  const qhw = Hq * Wq;
  const pooled = avgPool2dBchw(concat, plan.dim, H, W, Hq, Wq);
  const queries = applyNafRopeBchw(
    pooled,
    plan.dim,
    Hq,
    Wq,
    plan.headsRope,
    weights['image_encoder.rope.periods'],
  );
  const keys = avgPool2dBchw(queries, plan.dim, Hq, Wq, Hf, Wf);

  const idxH = nattenWindowIndices(Hq, plan.kernelSize, plan.dilationH);
  const idxW = nattenWindowIndices(Wq, plan.kernelSize, plan.dilationW);
  const K = plan.kernelSize;
  const K2 = K * K;
  const dq = plan.headDimAttn;
  const dv = plan.headDimValue;
  const scale = f(plan.scale);
  const out = new Float32Array(Cv * qhw);
  const scores = new Float32Array(K2);

  for (let head = 0; head < plan.headsAttn; head++) {
    const qHeadBase = head * dq;
    const vHeadBase = head * dv;
    for (let yq = 0; yq < Hq; yq++) {
      for (let xq = 0; xq < Wq; xq++) {
        const qPos = yq * Wq + xq;
        let maxScore = -Infinity;
        for (let di = 0; di < K; di++) {
          const ny = Math.floor(idxH[yq * K + di] / plan.dilationH);
          for (let dj = 0; dj < K; dj++) {
            const nx = Math.floor(idxW[xq * K + dj] / plan.dilationW);
            const kPos = ny * Wf + nx;
            let dot = 0.0;
            for (let c = 0; c < dq; c++) {
              dot = f(dot + f(queries[(qHeadBase + c) * qhw + qPos] * keys[(qHeadBase + c) * fhw + kPos]));
            }
            const s = f(dot * scale);
            scores[di * K + dj] = s;
            if (s > maxScore) maxScore = s;
          }
        }
        let sumExp = 0.0;
        for (let m = 0; m < K2; m++) {
          const e = f(Math.exp(f(scores[m] - maxScore)));
          scores[m] = e;
          sumExp = f(sumExp + e);
        }
        for (let m = 0; m < K2; m++) {
          scores[m] = f(scores[m] / sumExp);
        }
        for (let c = 0; c < dv; c++) {
          const vPlane = (vHeadBase + c) * fhw;
          let acc = 0.0;
          for (let di = 0; di < K; di++) {
            const ny = Math.floor(idxH[yq * K + di] / plan.dilationH);
            for (let dj = 0; dj < K; dj++) {
              const nx = Math.floor(idxW[xq * K + dj] / plan.dilationW);
              acc = f(acc + f(scores[di * K + dj] * valuesBchw[vPlane + ny * Wf + nx]));
            }
          }
          out[(vHeadBase + c) * qhw + qPos] = acc;
        }
      }
    }
  }
  return out;
}

function dispatch1D(count, workgroupSize, limit) {
  const groups = Math.ceil(count / workgroupSize);
  const x = Math.min(groups, limit);
  const y = Math.ceil(groups / x);
  if (y > limit) throw new RangeError('requested NAF tensor exceeds device dispatch capacity');
  return [x, y, 1];
}

function convShader({ inC, outC, H, W, ks, inputIsNhwc = false }) {
  const total = outC * H * W;
  const pad = Math.floor(ks / 2);
  return `
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output: array<f32>;
fn reflect_idx(coord: i32, length: i32) -> u32 {
  if (coord < 0) { return u32(-coord); }
  if (coord >= length) { return u32(2 * length - 2 - coord); }
  return u32(coord);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) grid: vec3<u32>) {
  let index = gid.x + gid.y * grid.x * 64u;
  if (index >= ${total}u) { return; }
  let hw = ${H * W}u;
  let oc = index / hw;
  let rem = index % hw;
  let y = i32(rem / ${W}u);
  let x = i32(rem % ${W}u);
  var sum = bias[oc];
  for (var ic = 0u; ic < ${inC}u; ic = ic + 1u) {
    let w_base = (oc * ${inC}u + ic) * ${ks * ks}u;
    ${ks === 1 ? `
    let in_val = ${inputIsNhwc ? `input[rem * ${inC}u + ic]` : `input[ic * hw + rem]`};
    sum = sum + in_val * weight[w_base];
    ` : `
    for (var ky = 0; ky < ${ks}; ky = ky + 1) {
      let ry = reflect_idx(y + ky - ${pad}, ${H});
      for (var kx = 0; kx < ${ks}; kx = kx + 1) {
        let rx = reflect_idx(x + kx - ${pad}, ${W});
        let pos = ry * ${W}u + rx;
        let in_val = ${inputIsNhwc ? `input[pos * ${inC}u + ic]` : `input[ic * hw + pos]`};
        sum = sum + in_val * weight[w_base + u32(ky * ${ks} + kx)];
      }
    }
    `}
  }
  output[index] = sum;
}`;
}

function groupNormSiluShader({ C, H, W, numGroups, eps = 1e-5 }) {
  const cPerG = C / numGroups;
  const hw = H * W;
  const groupSize = cPerG * hw;
  return `
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output: array<f32>;
var<workgroup> scratch: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_id) local: vec3<u32>, @builtin(workgroup_id) group: vec3<u32>) {
  let g = group.x;
  let lane = local.x;
  let base = g * ${groupSize}u;
  var sum = 0.0;
  for (var i = lane; i < ${groupSize}u; i = i + 64u) {
    sum = sum + input[base + i];
  }
  scratch[lane] = sum;
  workgroupBarrier();
  for (var stride = 32u; stride > 0u; stride = stride / 2u) {
    if (lane < stride) { scratch[lane] = scratch[lane] + scratch[lane + stride]; }
    workgroupBarrier();
  }
  let mean = scratch[0] / f32(${groupSize});
  workgroupBarrier();
  var vsum = 0.0;
  for (var i = lane; i < ${groupSize}u; i = i + 64u) {
    let d = input[base + i] - mean;
    vsum = vsum + d * d;
  }
  scratch[lane] = vsum;
  workgroupBarrier();
  for (var stride = 32u; stride > 0u; stride = stride / 2u) {
    if (lane < stride) { scratch[lane] = scratch[lane] + scratch[lane + stride]; }
    workgroupBarrier();
  }
  let inv_std = inverseSqrt(scratch[0] / f32(${groupSize}) + ${eps});
  for (var i = lane; i < ${groupSize}u; i = i + 64u) {
    let c = g * ${cPerG}u + (i / ${hw}u);
    let norm = (input[base + i] - mean) * inv_std * weight[c] + bias[c];
    output[base + i] = norm / (1.0 + exp(-norm));
  }
}`;
}

function concatPoolRopeShader(plan) {
  const { dim, branchChannels, imageHeight: H, imageWidth: W, outputHeight: Hq, outputWidth: Wq, headsRope, headDimRope: d } = plan;
  const total = dim * Hq * Wq;
  const sh = H / Hq;
  const sw = W / Wq;
  const half = d / 2;
  const quarter = d / 4;
  return `
@group(0) @binding(0) var<storage, read> enc1: array<f32>;
@group(0) @binding(1) var<storage, read> enc3: array<f32>;
@group(0) @binding(2) var<storage, read> periods: array<f32>;
@group(0) @binding(3) var<storage, read_write> queries: array<f32>;
fn pool_channel(c: u32, oy: u32, ox: u32) -> f32 {
  var sum = 0.0;
  let hw = ${H * W}u;
  for (var dy = 0u; dy < ${sh}u; dy = dy + 1u) {
    let y = oy * ${sh}u + dy;
    for (var dx = 0u; dx < ${sw}u; dx = dx + 1u) {
      let x = ox * ${sw}u + dx;
      let idx = y * ${W}u + x;
      if (c < ${branchChannels}u) {
        sum = sum + enc1[c * hw + idx];
      } else {
        sum = sum + enc3[(c - ${branchChannels}u) * hw + idx];
      }
    }
  }
  return sum / f32(${sh * sw});
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) grid: vec3<u32>) {
  let index = gid.x + gid.y * grid.x * 64u;
  if (index >= ${total}u) { return; }
  let qhw = ${Hq * Wq}u;
  let c = index / qhw;
  let pos = index % qhw;
  let oy = pos / ${Wq}u;
  let ox = pos % ${Wq}u;
  let head = c / ${d}u;
  let dim_in_head = c % ${d}u;
  let mate_dim = select(dim_in_head - ${half}u, dim_in_head + ${half}u, dim_in_head < ${half}u);
  let val = pool_channel(c, oy, ox);
  let mate_val = pool_channel(head * ${d}u + mate_dim, oy, ox);
  let rotated = select(mate_val, -mate_val, dim_in_head < ${half}u);
  let half_dim = dim_in_head % ${half}u;
  let p = half_dim % ${quarter}u;
  let coord = select((f32(ox) + 0.5) / f32(${Wq}) * 2.0 - 1.0, (f32(oy) + 0.5) / f32(${Hq}) * 2.0 - 1.0, half_dim < ${quarter}u);
  let angle = 6.283185307179586 * coord / periods[p];
  queries[index] = val * cos(angle) + rotated * sin(angle);
}`;
}

function keysPoolShader(plan) {
  const { dim, outputHeight: Hq, outputWidth: Wq, featureHeight: Hf, featureWidth: Wf, dilationH: sh, dilationW: sw } = plan;
  const total = dim * Hf * Wf;
  return `
@group(0) @binding(0) var<storage, read> queries: array<f32>;
@group(0) @binding(1) var<storage, read_write> keys: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) grid: vec3<u32>) {
  let index = gid.x + gid.y * grid.x * 64u;
  if (index >= ${total}u) { return; }
  let fhw = ${Hf * Wf}u;
  let qhw = ${Hq * Wq}u;
  let c = index / fhw;
  let pos = index % fhw;
  let fy = pos / ${Wf}u;
  let fx = pos % ${Wf}u;
  var sum = 0.0;
  for (var dy = 0u; dy < ${sh}u; dy = dy + 1u) {
    let qy = fy * ${sh}u + dy;
    for (var dx = 0u; dx < ${sw}u; dx = dx + 1u) {
      let qx = fx * ${sw}u + dx;
      sum = sum + queries[c * qhw + qy * ${Wq}u + qx];
    }
  }
  keys[index] = sum / f32(${sh * sw});
}`;
}

function nattenCrossAttentionShader(plan) {
  const {
    headsAttn,
    headDimAttn: dq,
    headDimValue: dv,
    featureChannels: Cv,
    outputHeight: Hq,
    outputWidth: Wq,
    featureHeight: Hf,
    featureWidth: Wf,
    kernelSize: K,
    dilationH,
    dilationW,
    prefixTokens,
    scale,
  } = plan;
  const qhw = Hq * Wq;
  const fhw = Hf * Wf;
  const K2 = K * K;
  const halfK = Math.floor(K / 2);
  const total = headsAttn * qhw;
  return `
@group(0) @binding(0) var<storage, read> queries: array<f32>;
@group(0) @binding(1) var<storage, read> keys: array<f32>;
@group(0) @binding(2) var<storage, read> conditioning: array<f32>;
@group(0) @binding(3) var<storage, read_write> output: array<f32>;
fn natten_start(pos: u32, group_len: u32, dilation: u32) -> u32 {
  let a = i32(pos / dilation);
  return u32(clamp(a - ${halfK}, 0, i32(group_len) - ${K}));
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) grid: vec3<u32>) {
  let index = gid.x + gid.y * grid.x * 64u;
  if (index >= ${total}u) { return; }
  let head = index / ${qhw}u;
  let q_pos = index % ${qhw}u;
  let yq = q_pos / ${Wq}u;
  let xq = q_pos % ${Wq}u;
  let start_y = natten_start(yq, ${Hf}u, ${dilationH}u);
  let start_x = natten_start(xq, ${Wf}u, ${dilationW}u);
  let q_head_base = head * ${dq}u;
  let v_head_base = head * ${dv}u;
  var scores: array<f32, ${K2}>;
  var max_score = -1e30;
  for (var di = 0u; di < ${K}u; di = di + 1u) {
    let ny = start_y + di;
    for (var dj = 0u; dj < ${K}u; dj = dj + 1u) {
      let nx = start_x + dj;
      let k_pos = ny * ${Wf}u + nx;
      var dot = 0.0;
      for (var c = 0u; c < ${dq}u; c = c + 1u) {
        dot = dot + queries[(q_head_base + c) * ${qhw}u + q_pos] * keys[(q_head_base + c) * ${fhw}u + k_pos];
      }
      let s = dot * ${scale};
      let m = di * ${K}u + dj;
      scores[m] = s;
      max_score = max(max_score, s);
    }
  }
  var sum_exp = 0.0;
  for (var m = 0u; m < ${K2}u; m = m + 1u) {
    let e = exp(scores[m] - max_score);
    scores[m] = e;
    sum_exp = sum_exp + e;
  }
  for (var m = 0u; m < ${K2}u; m = m + 1u) {
    scores[m] = scores[m] / sum_exp;
  }
  for (var c = 0u; c < ${dv}u; c = c + 1u) {
    let out_c = v_head_base + c;
    var acc = 0.0;
    for (var di = 0u; di < ${K}u; di = di + 1u) {
      let ny = start_y + di;
      for (var dj = 0u; dj < ${K}u; dj = dj + 1u) {
        let nx = start_x + dj;
        let k_pos = ny * ${Wf}u + nx;
        let v_val = conditioning[(${prefixTokens}u + k_pos) * ${Cv}u + out_c];
        acc = acc + scores[di * ${K}u + dj] * v_val;
      }
    }
    output[out_c * ${qhw}u + q_pos] = acc;
  }
}`;
}

export function createPixal3dNafAdapter({
  route,
  config = {},
  weights,
  imageTensor,
  conditioningTensor,
} = {}) {
  const runtime = route?.runtime;
  if (!runtime?.createTensor || !runtime?.uploadTensor || !runtime?.defineComputeKernel || !runtime?.runKernel) {
    throw new TypeError('registered WebGPU route runtime required for Pixal3D NAF');
  }
  const plan = config?.stages && config?.outputShape ? config : buildPixal3dNafPlan(config);
  const weightShapes = validatePixal3dNafWeights(plan, weights);

  const expectedImageShapes = [
    JSON.stringify([1, plan.imageHeight, plan.imageWidth, 3]),
    JSON.stringify([plan.imageHeight, plan.imageWidth, 3]),
  ];
  const expectedImageBytes = plan.imageHeight * plan.imageWidth * 3 * 4;
  if (
    !imageTensor?.buffer ||
    imageTensor.dtype !== 'f32' ||
    !(imageTensor.usage & U.storage) ||
    !expectedImageShapes.includes(JSON.stringify(imageTensor.shape)) ||
    (imageTensor.byteLength !== undefined && imageTensor.byteLength !== expectedImageBytes)
  ) {
    throw new TypeError('complete resident F32 NHWC imageTensor in [0,1] required for NAF');
  }

  const expectedCondShapes = [
    JSON.stringify([1, plan.conditioningTokens, plan.featureChannels]),
    JSON.stringify([plan.conditioningTokens, plan.featureChannels]),
  ];
  const expectedCondBytes = plan.conditioningTokens * plan.featureChannels * 4;
  if (
    !conditioningTensor?.buffer ||
    conditioningTensor.dtype !== 'f32' ||
    !(conditioningTensor.usage & U.storage) ||
    !expectedCondShapes.includes(JSON.stringify(conditioningTensor.shape)) ||
    (conditioningTensor.byteLength !== undefined && conditioningTensor.byteLength !== expectedCondBytes)
  ) {
    throw new TypeError('complete resident F32 DINO conditioningTensor required for NAF');
  }

  const maxBinding = runtime.device?.limits?.maxStorageBufferBindingSize ?? 134217728;
  const outputBytes = plan.outputShape.reduce((a, b) => a * b, 4);
  if (outputBytes > maxBinding) {
    throw new RangeError('NAF output tensor exceeds device maxStorageBufferBindingSize');
  }
  const wgLimit = runtime.device?.limits?.maxComputeWorkgroupsPerDimension ?? 65535;
  const owned = [];
  let highResFeatures;
  let disposed = false;
  let parametersRetired = false;
  let running = false;

  const allocate = (name, shape) => {
    const t = runtime.createTensor({
      name: `pixal3d.naf.${name}`,
      shape,
      dtype: 'f32',
      usage: U.storage | U.copyDst | U.copySrc,
    });
    owned.push(t);
    return t;
  };
  const releaseParameters = () => {
    if (disposed || parametersRetired) return;
    if (running) throw new Error('Pixal3D NAF adapter in use');
    for (const t of owned) {
      if (t !== highResFeatures) t.buffer?.destroy?.();
    }
    parametersRetired = true;
  };
  const cleanup = () => {
    releaseParameters();
    highResFeatures?.buffer?.destroy?.();
  };

  try {
    const w = {};
    for (const [key, shape] of Object.entries(weightShapes)) {
      w[key] = allocate(key, [shape.reduce((a, b) => a * b, 1)]);
      runtime.uploadTensor(w[key], weights[key]);
    }
    const H = plan.imageHeight;
    const W = plan.imageWidth;
    const bc = plan.branchChannels;
    const enc1A = allocate('enc1.a', [1, bc, H, W]);
    const enc1B = allocate('enc1.b', [1, bc, H, W]);
    const enc3A = allocate('enc3.a', [1, bc, H, W]);
    const enc3B = allocate('enc3.b', [1, bc, H, W]);
    const queries = allocate('queries', [1, plan.dim, plan.outputHeight, plan.outputWidth]);
    const keys = allocate('keys', [1, plan.dim, plan.featureHeight, plan.featureWidth]);
    highResFeatures = allocate('high-res-features', plan.outputShape);

    const operations = [];
    const add = (stage, code, resources, dispatch) => {
      operations.push({
        stage,
        dispatch,
        kernel: runtime.defineComputeKernel({
          name: `pixal3d.${stage}`,
          code,
          bindings: resources.map(([resource, access], i) => ({ name: `b${i}`, resource, access })),
        }),
      });
    };
    const R = 'read-only-storage';
    const W_ACCESS = 'storage';
    const branchDispatch = dispatch1D(bc * H * W, 64, wgLimit);

    add(
      'naf-encoder-1x1-0',
      convShader({ inC: 3, outC: bc, H, W, ks: 1, inputIsNhwc: true }),
      [
        [imageTensor, R],
        [w['image_encoder.encoder.0.weight'], R],
        [w['image_encoder.encoder.0.bias'], R],
        [enc1A, W_ACCESS],
      ],
      branchDispatch,
    );
    add(
      'naf-encoder-3x3-0',
      convShader({ inC: 3, outC: bc, H, W, ks: 3, inputIsNhwc: true }),
      [
        [imageTensor, R],
        [w['image_encoder.sem_encoder.0.weight'], R],
        [w['image_encoder.sem_encoder.0.bias'], R],
        [enc3A, W_ACCESS],
      ],
      branchDispatch,
    );

    const normShaderCode = groupNormSiluShader({
      C: bc,
      H,
      W,
      numGroups: plan.numGroups,
      eps: plan.normEpsilon,
    });
    const conv1x1Code = convShader({ inC: bc, outC: bc, H, W, ks: 1, inputIsNhwc: false });
    const conv3x3Code = convShader({ inC: bc, outC: bc, H, W, ks: 3, inputIsNhwc: false });

    for (let i = 1; i <= plan.imgLayers; i++) {
      add(
        `naf-encoder-1x1-${i}-norm1-silu`,
        normShaderCode,
        [
          [enc1A, R],
          [w[`image_encoder.encoder.${i}.norm1.weight`], R],
          [w[`image_encoder.encoder.${i}.norm1.bias`], R],
          [enc1B, W_ACCESS],
        ],
        [plan.numGroups, 1, 1],
      );
      add(
        `naf-encoder-1x1-${i}-conv1`,
        conv1x1Code,
        [
          [enc1B, R],
          [w[`image_encoder.encoder.${i}.conv1.weight`], R],
          [w[`image_encoder.encoder.${i}.conv1.bias`], R],
          [enc1A, W_ACCESS],
        ],
        branchDispatch,
      );
      add(
        `naf-encoder-1x1-${i}-norm2-silu`,
        normShaderCode,
        [
          [enc1A, R],
          [w[`image_encoder.encoder.${i}.norm2.weight`], R],
          [w[`image_encoder.encoder.${i}.norm2.bias`], R],
          [enc1B, W_ACCESS],
        ],
        [plan.numGroups, 1, 1],
      );
      add(
        `naf-encoder-1x1-${i}-conv2`,
        conv1x1Code,
        [
          [enc1B, R],
          [w[`image_encoder.encoder.${i}.conv2.weight`], R],
          [w[`image_encoder.encoder.${i}.conv2.bias`], R],
          [enc1A, W_ACCESS],
        ],
        branchDispatch,
      );

      add(
        `naf-encoder-3x3-${i}-norm1-silu`,
        normShaderCode,
        [
          [enc3A, R],
          [w[`image_encoder.sem_encoder.${i}.norm1.weight`], R],
          [w[`image_encoder.sem_encoder.${i}.norm1.bias`], R],
          [enc3B, W_ACCESS],
        ],
        [plan.numGroups, 1, 1],
      );
      add(
        `naf-encoder-3x3-${i}-conv1`,
        conv3x3Code,
        [
          [enc3B, R],
          [w[`image_encoder.sem_encoder.${i}.conv1.weight`], R],
          [w[`image_encoder.sem_encoder.${i}.conv1.bias`], R],
          [enc3A, W_ACCESS],
        ],
        branchDispatch,
      );
      add(
        `naf-encoder-3x3-${i}-norm2-silu`,
        normShaderCode,
        [
          [enc3A, R],
          [w[`image_encoder.sem_encoder.${i}.norm2.weight`], R],
          [w[`image_encoder.sem_encoder.${i}.norm2.bias`], R],
          [enc3B, W_ACCESS],
        ],
        [plan.numGroups, 1, 1],
      );
      add(
        `naf-encoder-3x3-${i}-conv2`,
        conv3x3Code,
        [
          [enc3B, R],
          [w[`image_encoder.sem_encoder.${i}.conv2.weight`], R],
          [w[`image_encoder.sem_encoder.${i}.conv2.bias`], R],
          [enc3A, W_ACCESS],
        ],
        branchDispatch,
      );
    }

    add(
      'naf-concat-pool-rope',
      concatPoolRopeShader(plan),
      [
        [enc1A, R],
        [enc3A, R],
        [w['image_encoder.rope.periods'], R],
        [queries, W_ACCESS],
      ],
      dispatch1D(plan.dim * plan.outputHeight * plan.outputWidth, 64, wgLimit),
    );
    add(
      'naf-keys-pool',
      keysPoolShader(plan),
      [
        [queries, R],
        [keys, W_ACCESS],
      ],
      dispatch1D(plan.dim * plan.featureHeight * plan.featureWidth, 64, wgLimit),
    );
    add(
      'naf-neighborhood-cross-attention',
      nattenCrossAttentionShader(plan),
      [
        [queries, R],
        [keys, R],
        [conditioningTensor, R],
        [highResFeatures, W_ACCESS],
      ],
      dispatch1D(plan.headsAttn * plan.outputHeight * plan.outputWidth, 64, wgLimit),
    );

    const outputs = Object.freeze({ highResFeatures });
    return Object.freeze({
      plan,
      runtime,
      routeId: route.routeId,
      inputs: Object.freeze({ image: imageTensor, conditioning: conditioningTensor }),
      outputs,
      async run(invocation) {
        if (disposed) throw new Error('Pixal3D NAF adapter disposed');
        if (parametersRetired) throw new Error('Pixal3D NAF parameters retired');
        if (running) throw new Error('Pixal3D NAF adapter in use');
        running = true;
        try {
          for (let i = 0; i < operations.length; i++) {
            const op = operations[i];
            await runtime.runKernel(op.kernel, {
              stage: op.stage,
              dispatch: op.dispatch,
              schedulerInvocation: invocation,
              yieldAfter: i === operations.length - 1,
            });
          }
          return outputs;
        } finally {
          running = false;
        }
      },
      releaseParameters,
      dispose() {
        if (running) throw new Error('Pixal3D NAF adapter in use');
        if (disposed) return;
        cleanup();
        disposed = true;
      },
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}
