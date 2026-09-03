/**
 * WebGPU initialization and device management.
 */

const INFERENCE_LIMIT_KEYS = [
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxComputeWorkgroupSizeY',
];

function featureList(features) {
  if (!features) return [];
  return Array.from(features).map(String).sort();
}

function inferenceLimits(limits) {
  const out = {};
  for (const key of INFERENCE_LIMIT_KEYS) {
    if (Number.isFinite(limits?.[key])) out[key] = limits[key];
  }
  return out;
}

function adapterName(adapter) {
  const info = adapter.info || {};
  return info.description
    || [info.vendor, info.architecture, info.device].filter(Boolean).join(' ')
    || 'unknown-webgpu-adapter';
}

async function initGPU() {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not supported in this browser. Try Chrome 113+ or Edge 113+.');
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('No WebGPU adapter found. Your GPU may not support WebGPU.');
  }

  const requiredFeatures = [];
  if (adapter.features.has('timestamp-query')) {
    requiredFeatures.push('timestamp-query');
  }
  const requiredLimits = inferenceLimits(adapter.limits);

  // Request max limits for large model inference
  const device = await adapter.requestDevice({
    requiredFeatures,
    requiredLimits,
  });

  device.lost.then((info) => {
    console.error('WebGPU device lost:', info.message);
    if (info.reason !== 'destroyed') ;
  });

  const deviceFeatures = featureList(device.features || adapter.features);
  return {
    adapter,
    device,
    backendIdentity: {
      kind: 'webgpu-local',
      runtime: 'browser',
      adapterName: adapterName(adapter),
      browser: navigator.userAgent || 'unknown-browser',
      requestedFeatures: [...requiredFeatures],
      features: deviceFeatures,
      limits: requiredLimits,
      timestampQuery: requiredFeatures.includes('timestamp-query') ? 'requested' : 'unavailable',
    },
  };
}

/**
 * Create a storage buffer initialized with data.
 */
function createStorageBuffer(device, data, usage = 0) {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | usage,
    mappedAtCreation: true,
  });
  new (data.constructor)(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}

/**
 * Create an empty storage buffer.
 */
function createEmptyBuffer(device, size, usage = 0) {
  return device.createBuffer({
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | usage,
    mappedAtCreation: false,
  });
}

/**
 * Read back buffer contents to CPU.
 */
async function readBuffer(device, buffer, size) {
  const staging = device.createBuffer({
    size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, staging, 0, size);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const result = new Float32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return result;
}

const conv2dWGSL = "// conv2d.wgsl — 2D convolution compute shader\n//\n// Standard conv2d with:\n//   - Arbitrary kernel size (1x1, 3x3, etc.)\n//   - Input tiling with halo in workgroup shared memory for 3x3\n//   - Replicate padding (matching PyTorch padding_mode='replicate')\n//   - Optional bias\n//   - Supports batched execution (one dispatch per output channel group)\n//\n// Memory layout (all NCHW, row-major):\n//   input:   [C_in, H, W]       — f32\n//   weight:  [C_out, C_in, kH, kW] — f32\n//   bias:    [C_out]             — f32\n//   output:  [C_out, H_out, W_out] — f32\n//\n// Uniforms:\n//   inC, inH, inW: input dimensions\n//   outC, outH, outW: output dimensions\n//   kH, kW: kernel size\n//   padH, padW: padding\n//   strideH, strideW: stride\n//   hasBias: 0 or 1\n\nstruct ConvParams {\n  inC: u32,\n  inH: u32,\n  inW: u32,\n  outC: u32,\n  outH: u32,\n  outW: u32,\n  kH: u32,\n  kW: u32,\n  padH: u32,\n  padW: u32,\n  strideH: u32,\n  strideW: u32,\n  hasBias: u32,\n};\n\n@group(0) @binding(0) var<uniform> params: ConvParams;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> weight: array<f32>;\n@group(0) @binding(3) var<storage, read> bias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\n// Workgroup tile for output spatial positions\n// 16x16 output tile per workgroup\nconst TILE_W: u32 = 16;\nconst TILE_H: u32 = 16;\n\n@compute @workgroup_size(TILE_W, TILE_H, 1)\nfn conv2d_main(\n  @builtin(global_invocation_id) gid: vec3<u32>,\n  @builtin(workgroup_id) wgid: vec3<u32>,\n) {\n  let outX = gid.x;\n  let outY = gid.y;\n  let outCh = wgid.z; // one output channel per z-workgroup\n\n  if (outX >= params.outW || outY >= params.outH || outCh >= params.outC) {\n    return;\n  }\n\n  var sum: f32 = 0.0;\n\n  // Loop over input channels and kernel\n  for (var ic: u32 = 0; ic < params.inC; ic++) {\n    for (var ky: u32 = 0; ky < params.kH; ky++) {\n      for (var kx: u32 = 0; kx < params.kW; kx++) {\n        // Input coordinate with stride and padding\n        let inY_raw = i32(outY * params.strideH + ky) - i32(params.padH);\n        let inX_raw = i32(outX * params.strideW + kx) - i32(params.padW);\n\n        // Replicate padding: clamp to valid range\n        let inY = u32(clamp(inY_raw, 0, i32(params.inH) - 1));\n        let inX = u32(clamp(inX_raw, 0, i32(params.inW) - 1));\n\n        let inputIdx = ic * params.inH * params.inW + inY * params.inW + inX;\n        let weightIdx = outCh * params.inC * params.kH * params.kW\n                      + ic * params.kH * params.kW\n                      + ky * params.kW\n                      + kx;\n\n        sum += input[inputIdx] * weight[weightIdx];\n      }\n    }\n  }\n\n  // Add bias\n  if (params.hasBias != 0) {\n    sum += bias[outCh];\n  }\n\n  let outputIdx = outCh * params.outH * params.outW + outY * params.outW + outX;\n  output[outputIdx] = sum;\n}\n";

const reluConv2dWGSL = "// relu_conv2d.wgsl — fused ReLU(input) -> 2D convolution.\n//\n// Matches dispatchActivation(op=ReLU) followed by conv2d.wgsl.\n// Memory layout is NCHW, row-major.\n\nstruct ConvParams {\n  inC: u32,\n  inH: u32,\n  inW: u32,\n  outC: u32,\n  outH: u32,\n  outW: u32,\n  kH: u32,\n  kW: u32,\n  padH: u32,\n  padW: u32,\n  strideH: u32,\n  strideW: u32,\n  hasBias: u32,\n};\n\n@group(0) @binding(0) var<uniform> params: ConvParams;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> weight: array<f32>;\n@group(0) @binding(3) var<storage, read> bias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nconst TILE_W: u32 = 16;\nconst TILE_H: u32 = 16;\n\n@compute @workgroup_size(TILE_W, TILE_H, 1)\nfn relu_conv2d_main(\n  @builtin(global_invocation_id) gid: vec3<u32>,\n  @builtin(workgroup_id) wgid: vec3<u32>,\n) {\n  let outX = gid.x;\n  let outY = gid.y;\n  let outCh = wgid.z;\n\n  if (outX >= params.outW || outY >= params.outH || outCh >= params.outC) {\n    return;\n  }\n\n  var sum: f32 = 0.0;\n\n  for (var ic: u32 = 0; ic < params.inC; ic++) {\n    for (var ky: u32 = 0; ky < params.kH; ky++) {\n      for (var kx: u32 = 0; kx < params.kW; kx++) {\n        let inYRaw = i32(outY * params.strideH + ky) - i32(params.padH);\n        let inXRaw = i32(outX * params.strideW + kx) - i32(params.padW);\n        let inY = u32(clamp(inYRaw, 0, i32(params.inH) - 1));\n        let inX = u32(clamp(inXRaw, 0, i32(params.inW) - 1));\n\n        let inputIdx = ic * params.inH * params.inW + inY * params.inW + inX;\n        let weightIdx = outCh * params.inC * params.kH * params.kW\n                      + ic * params.kH * params.kW\n                      + ky * params.kW\n                      + kx;\n\n        sum += max(input[inputIdx], 0.0) * weight[weightIdx];\n      }\n    }\n  }\n\n  if (params.hasBias != 0) {\n    sum += bias[outCh];\n  }\n\n  let outputIdx = outCh * params.outH * params.outW + outY * params.outW + outX;\n  output[outputIdx] = sum;\n}\n";

const conv1x1WGSL = "// conv1x1.wgsl — Pointwise (1x1) convolution compute shader\n//\n// Optimized for the extremely common 1x1 conv case in ConvStack:\n//   - input_blocks: project feature dims\n//   - output_blocks: project to output dims\n//   - DINOv2 output projections\n//\n// This is effectively a batched matrix multiply over spatial positions.\n// Each thread computes one output element (outCh, y, x).\n//\n// Memory layout (CHW, row-major):\n//   input:   [C_in, H, W]     — f32\n//   weight:  [C_out, C_in]    — f32 (kH=kW=1, no spatial dims)\n//   bias:    [C_out]          — f32\n//   output:  [C_out, H, W]   — f32\n\nstruct Conv1x1Params {\n  inC: u32,\n  outC: u32,\n  H: u32,\n  W: u32,\n  hasBias: u32,\n  numWorkgroupsX: u32,\n};\n\n@group(0) @binding(0) var<uniform> params: Conv1x1Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> weight: array<f32>;\n@group(0) @binding(3) var<storage, read> bias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn conv1x1_main(\n  @builtin(global_invocation_id) gid: vec3<u32>,\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  // 2D dispatch: linearize from workgroup_id.x + workgroup_id.y * numWorkgroupsX\n  let spatialSize = params.H * params.W;\n  let totalWork = params.outC * spatialSize;\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  if (idx >= totalWork) {\n    return;\n  }\n\n  let oc = idx / spatialSize;\n  let sp = idx % spatialSize;\n\n  var sum: f32 = 0.0;\n\n  // Dot product over input channels\n  for (var ic: u32 = 0; ic < params.inC; ic++) {\n    let inputVal = input[ic * spatialSize + sp];\n    let weightVal = weight[oc * params.inC + ic];\n    sum += inputVal * weightVal;\n  }\n\n  if (params.hasBias != 0) {\n    sum += bias[oc];\n  }\n\n  output[oc * spatialSize + sp] = sum;\n}\n";

const convTranspose2dWGSL = "// conv_transpose2d.wgsl — Transposed 2D convolution (deconvolution) compute shader\n//\n// Implements nn.ConvTranspose2d(inC, outC, kernel_size=stride, stride=stride)\n// which is the primary upsampling method in MoGe-2's ConvStack.\n//\n// For stride=kernel_size=2 (the MoGe-2 case), this is equivalent to:\n//   - Each input pixel maps to a 2x2 output patch\n//   - Output[oy, ox] = sum over inC of weight[ic, oc, oy%s, ox%s] * input[ic, oy/s, ox/s]\n//\n// Memory layout (CHW, row-major):\n//   input:   [C_in, H, W]              — f32\n//   weight:  [C_in, C_out, kH, kW]     — f32 (note: transposed conv weight layout)\n//   bias:    [C_out]                    — f32\n//   output:  [C_out, H*stride, W*stride] — f32\n\nstruct ConvTransposeParams {\n  inC: u32,\n  inH: u32,\n  inW: u32,\n  outC: u32,\n  outH: u32,\n  outW: u32,\n  kH: u32,\n  kW: u32,\n  strideH: u32,\n  strideW: u32,\n  hasBias: u32,\n  numWorkgroupsX: u32,\n};\n\n@group(0) @binding(0) var<uniform> params: ConvTransposeParams;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> weight: array<f32>;\n@group(0) @binding(3) var<storage, read> bias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn conv_transpose2d_main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let totalOut = params.outC * params.outH * params.outW;\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  if (idx >= totalOut) {\n    return;\n  }\n\n  let outSpatial = params.outH * params.outW;\n  let oc = idx / outSpatial;\n  let rem = idx % outSpatial;\n  let oy = rem / params.outW;\n  let ox = rem % params.outW;\n\n  var sum: f32 = 0.0;\n\n  // For each input channel, find which input pixel(s) contribute to this output pixel\n  // With stride=kernel_size, each output pixel is influenced by exactly one input pixel\n  // oy = iy * stride + ky  =>  iy = (oy - ky) / stride, must be integer and in bounds\n  for (var ic: u32 = 0; ic < params.inC; ic++) {\n    for (var ky: u32 = 0; ky < params.kH; ky++) {\n      if (oy < ky) { continue; }\n      let iy_check = oy - ky;\n      if (iy_check % params.strideH != 0) { continue; }\n      let iy = iy_check / params.strideH;\n      if (iy >= params.inH) { continue; }\n\n      for (var kx: u32 = 0; kx < params.kW; kx++) {\n        if (ox < kx) { continue; }\n        let ix_check = ox - kx;\n        if (ix_check % params.strideW != 0) { continue; }\n        let ix = ix_check / params.strideW;\n        if (ix >= params.inW) { continue; }\n\n        let inputIdx = ic * params.inH * params.inW + iy * params.inW + ix;\n        // Weight layout for ConvTranspose2d: [C_in, C_out, kH, kW]\n        let weightIdx = ic * params.outC * params.kH * params.kW\n                      + oc * params.kH * params.kW\n                      + ky * params.kW\n                      + kx;\n        sum += input[inputIdx] * weight[weightIdx];\n      }\n    }\n  }\n\n  if (params.hasBias != 0) {\n    sum += bias[oc];\n  }\n\n  output[idx] = sum;\n}\n";

const convTranspose2dStride2WGSL = "// conv_transpose2d_stride2.wgsl — specialized k=2, stride=2 transposed conv\n//\n// MoGe-2's ConvStack deconv resamplers use kernel_size=stride=2. In that case\n// each output pixel maps to exactly one input pixel and one 2x2 kernel phase, so\n// the general modulo/loop path can be collapsed to a single phase lookup.\n\nstruct ConvTransposeStride2Params {\n  inC: u32,\n  inH: u32,\n  inW: u32,\n  outC: u32,\n  outH: u32,\n  outW: u32,\n  hasBias: u32,\n  numWorkgroupsX: u32,\n};\n\n@group(0) @binding(0) var<uniform> params: ConvTransposeStride2Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> weight: array<f32>;\n@group(0) @binding(3) var<storage, read> bias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256u;\n\n@compute @workgroup_size(WG_SIZE)\nfn conv_transpose2d_stride2_main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let totalOut = params.outC * params.outH * params.outW;\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  if (idx >= totalOut) {\n    return;\n  }\n\n  let outSpatial = params.outH * params.outW;\n  let oc = idx / outSpatial;\n  let rem = idx % outSpatial;\n  let oy = rem / params.outW;\n  let ox = rem % params.outW;\n\n  let iy = oy >> 1u;\n  let ix = ox >> 1u;\n  let ky = oy & 1u;\n  let kx = ox & 1u;\n  let kernelPhase = ky * 2u + kx;\n  let inputSpatial = params.inH * params.inW;\n\n  var sum: f32 = 0.0;\n  for (var ic: u32 = 0u; ic < params.inC; ic++) {\n    let inputIdx = ic * inputSpatial + iy * params.inW + ix;\n    let weightIdx = ic * params.outC * 4u + oc * 4u + kernelPhase;\n    sum += input[inputIdx] * weight[weightIdx];\n  }\n\n  if (params.hasBias != 0u) {\n    sum += bias[oc];\n  }\n\n  output[idx] = sum;\n}\n";

const activationsWGSL = "// activations.wgsl — Element-wise activation functions\n//\n// ReLU, SiLU, and element-wise add (for skip connections).\n// Each function operates in-place or writes to a separate output buffer.\n\nstruct ActivationParams {\n  count: u32,     // total number of elements\n  op: u32,        // 0=relu, 1=silu, 2=add, 3=add_relu, 4=sigmoid\n  numWorkgroupsX: u32,\n};\n\n@group(0) @binding(0) var<uniform> params: ActivationParams;\n@group(0) @binding(1) var<storage, read> input_a: array<f32>;\n@group(0) @binding(2) var<storage, read> input_b: array<f32>;  // used for add ops\n@group(0) @binding(3) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn activation_main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n  if (idx >= params.count) {\n    return;\n  }\n\n  let a = input_a[idx];\n\n  switch params.op {\n    case 0u: { // ReLU\n      output[idx] = max(a, 0.0);\n    }\n    case 1u: { // SiLU (x * sigmoid(x))\n      output[idx] = a / (1.0 + exp(-a));\n    }\n    case 2u: { // Add (skip connection)\n      output[idx] = a + input_b[idx];\n    }\n    case 3u: { // Add + ReLU\n      output[idx] = max(a + input_b[idx], 0.0);\n    }\n    case 4u: { // Sigmoid\n      output[idx] = 1.0 / (1.0 + exp(-a));\n    }\n    default: {\n      output[idx] = a;\n    }\n  }\n}\n";

const groupnormWGSL = "// groupnorm.wgsl — Group Normalization compute shader\n//\n// Implements nn.GroupNorm: divide channels into groups, normalize each group\n// independently over (C/num_groups, H, W), then apply learnable scale+bias.\n//\n// Special case: num_groups=1 → LayerNorm over spatial+channel\n// Special case: num_groups=C → InstanceNorm\n//\n// MoGe-2 uses:\n//   - GroupNorm(C//32, C) → 32 channels per group\n//   - GroupNorm(1, C) → \"layer norm\" mode (all channels in one group)\n//\n// Two-pass approach:\n//   Pass 1: compute mean and variance per group\n//   Pass 2: normalize and apply scale+bias\n//\n// Memory layout (CHW, row-major):\n//   input:   [C, H, W]      — f32\n//   scale:   [C]             — f32 (learnable gamma)\n//   bias:    [C]             — f32 (learnable beta)\n//   output:  [C, H, W]      — f32\n\nstruct GroupNormParams {\n  C: u32,\n  H: u32,\n  W: u32,\n  numGroups: u32,\n  eps: f32,\n  numWorkgroupsX: u32,\n};\n\n@group(0) @binding(0) var<uniform> params: GroupNormParams;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> scale: array<f32>;\n@group(0) @binding(3) var<storage, read> gnbias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\n// Intermediate buffer for per-group mean and variance\n// Layout: [numGroups * 2] — first numGroups entries are means, next are vars\n@group(0) @binding(5) var<storage, read_write> stats: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\n// Pass 1: Compute mean and variance for each group\n@compute @workgroup_size(WG_SIZE)\nfn groupnorm_stats(\n  @builtin(global_invocation_id) gid: vec3<u32>,\n) {\n  let groupIdx = gid.x;\n  if (groupIdx >= params.numGroups) {\n    return;\n  }\n\n  let channelsPerGroup = params.C / params.numGroups;\n  let spatialSize = params.H * params.W;\n  let groupSize = channelsPerGroup * spatialSize;\n\n  let startCh = groupIdx * channelsPerGroup;\n\n  // Compute mean\n  var sum: f32 = 0.0;\n  for (var c: u32 = 0; c < channelsPerGroup; c++) {\n    let ch = startCh + c;\n    for (var sp: u32 = 0; sp < spatialSize; sp++) {\n      sum += input[ch * spatialSize + sp];\n    }\n  }\n  let mean = sum / f32(groupSize);\n  stats[groupIdx] = mean;\n\n  // Compute variance\n  var varSum: f32 = 0.0;\n  for (var c: u32 = 0; c < channelsPerGroup; c++) {\n    let ch = startCh + c;\n    for (var sp: u32 = 0; sp < spatialSize; sp++) {\n      let diff = input[ch * spatialSize + sp] - mean;\n      varSum += diff * diff;\n    }\n  }\n  stats[params.numGroups + groupIdx] = varSum / f32(groupSize);\n}\n\n// Pass 2: Normalize each element using group stats, apply scale+bias\n@compute @workgroup_size(WG_SIZE)\nfn groupnorm_normalize(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n  let totalSize = params.C * params.H * params.W;\n  if (idx >= totalSize) {\n    return;\n  }\n\n  let spatialSize = params.H * params.W;\n  let ch = idx / spatialSize;\n  let channelsPerGroup = params.C / params.numGroups;\n  let groupIdx = ch / channelsPerGroup;\n\n  let mean = stats[groupIdx];\n  let variance = stats[params.numGroups + groupIdx];\n  let invStd = 1.0 / sqrt(variance + params.eps);\n\n  let normalized = (input[idx] - mean) * invStd;\n  output[idx] = normalized * scale[ch] + gnbias[ch];\n}\n";

const upsampleWGSL = "// upsample.wgsl — Bilinear/Nearest upsampling compute shader\n//\n// Used in Resampler when type='bilinear' or 'nearest'.\n// Also used for final F.interpolate to resize output to original image dims.\n//\n// PyTorch: nn.Upsample(scale_factor=2, mode='bilinear', align_corners=False)\n// PyTorch: F.interpolate(x, (h, w), mode='bilinear', align_corners=False)\n//\n// Memory layout (CHW, row-major):\n//   input:   [C, inH, inW]  — f32\n//   output:  [C, outH, outW] — f32\n\nstruct UpsampleParams {\n  C: u32,\n  inH: u32,\n  inW: u32,\n  outH: u32,\n  outW: u32,\n  mode: u32,    // 0=nearest, 1=bilinear\n  numWorkgroupsX: u32,\n};\n\n@group(0) @binding(0) var<uniform> params: UpsampleParams;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn upsample_main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let totalOut = params.C * params.outH * params.outW;\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  if (idx >= totalOut) {\n    return;\n  }\n\n  let outSpatial = params.outH * params.outW;\n  let ch = idx / outSpatial;\n  let rem = idx % outSpatial;\n  let oy = rem / params.outW;\n  let ox = rem % params.outW;\n\n  let inBase = ch * params.inH * params.inW;\n\n  if (params.mode == 0u) {\n    // Nearest\n    let iy = oy * params.inH / params.outH;\n    let ix = ox * params.inW / params.outW;\n    output[idx] = input[inBase + iy * params.inW + ix];\n  } else {\n    // Bilinear (align_corners=False, matching PyTorch F.interpolate)\n    // Source coordinate, clamped to valid range before computing fractional part\n    let srcY_raw = (f32(oy) + 0.5) * f32(params.inH) / f32(params.outH) - 0.5;\n    let srcX_raw = (f32(ox) + 0.5) * f32(params.inW) / f32(params.outW) - 0.5;\n    let srcY = clamp(srcY_raw, 0.0, f32(params.inH - 1u));\n    let srcX = clamp(srcX_raw, 0.0, f32(params.inW - 1u));\n\n    let y0 = u32(floor(srcY));\n    let x0 = u32(floor(srcX));\n    let y1 = min(y0 + 1u, params.inH - 1u);\n    let x1 = min(x0 + 1u, params.inW - 1u);\n\n    let fy = srcY - f32(y0);\n    let fx = srcX - f32(x0);\n\n    let v00 = input[inBase + y0 * params.inW + x0];\n    let v01 = input[inBase + y0 * params.inW + x1];\n    let v10 = input[inBase + y1 * params.inW + x0];\n    let v11 = input[inBase + y1 * params.inW + x1];\n\n    let top = v00 * (1.0 - fx) + v01 * fx;\n    let bot = v10 * (1.0 - fx) + v11 * fx;\n    output[idx] = top * (1.0 - fy) + bot * fy;\n  }\n}\n";

/**
 * shader_ops.js — WebGPU compute dispatch wrappers for each shader.
 *
 * Each function creates a pipeline, binds buffers, and dispatches.
 * Pipelines are cached by device for reuse.
 */


const pipelineCaches = new WeakMap();
const uniformCaches = new WeakMap();
const dummyBiasBuffers = new WeakMap();
const MAX_WG_DIM = 65535;

function cacheFor(device, caches) {
  let cache = caches.get(device);
  if (!cache) {
    cache = new Map();
    caches.set(device, cache);
  }
  return cache;
}

function byteView$1(data) {
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

function cachedUniform(device, data) {
  const bytes = byteView$1(data);
  let h = 0;
  for (let i = 0; i < bytes.length; i++) h = (h * 31 + bytes[i]) | 0;
  const key = `u_${bytes.length}_${h}`;
  const uniformCache = cacheFor(device, uniformCaches);
  if (uniformCache.has(key)) return uniformCache.get(key);
  const buf = device.createBuffer({
    size: Math.max(bytes.byteLength, 16),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint8Array(buf.getMappedRange()).set(bytes);
  buf.unmap();
  uniformCache.set(key, buf);
  return buf;
}

// Cache for dummy bias buffers (one per device)
function getDummyBias(device) {
  let dummyBiasBuf = dummyBiasBuffers.get(device);
  if (!dummyBiasBuf) {
    dummyBiasBuf = createStorageBuffer(device, new Float32Array([0]));
    dummyBiasBuffers.set(device, dummyBiasBuf);
  }
  return dummyBiasBuf;
}

/**
 * Split a total workgroup count into 2D dispatch (x, y) to stay within limits.
 * Returns [wgX, wgY] where wgX * wgY >= totalWG and wgX <= MAX_WG_DIM.
 */
function splitWorkgroups(totalWG) {
  if (totalWG <= MAX_WG_DIM) return [totalWG, 1];
  const wgX = MAX_WG_DIM;
  const wgY = Math.ceil(totalWG / MAX_WG_DIM);
  return [wgX, wgY];
}

function getOrCreatePipeline(device, key, code, entryPoint) {
  const pipelineCache = cacheFor(device, pipelineCaches);
  if (pipelineCache.has(key)) return pipelineCache.get(key);
  const module = device.createShaderModule({ code });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint },
  });
  pipelineCache.set(key, pipeline);
  return pipeline;
}

function ceil(a, b) { return Math.ceil(a / b); }

/**
 * Dispatch conv2d (3x3 or arbitrary kernel).
 * Returns output buffer [outC, outH, outW].
 */
function dispatchConv2d(device, encoder, inputBuf, weightBuf, biasBuf, params) {
  const { inC, inH, inW, outC, kH, kW, padH, padW, strideH, strideW } = params;
  const outH = Math.floor((inH + 2 * padH - kH) / strideH) + 1;
  const outW = Math.floor((inW + 2 * padW - kW) / strideW) + 1;
  const hasBias = biasBuf ? 1 : 0;

  const pipeline = getOrCreatePipeline(device, 'conv2d', conv2dWGSL, 'conv2d_main');

  const uniformData = new Uint32Array([inC, inH, inW, outC, outH, outW, kH, kW, padH, padW, strideH, strideW, hasBias]);
  const uniformBuf = cachedUniform(device, uniformData);

  const dummyBias = biasBuf || getDummyBias(device);
  const outputBuf = createEmptyBuffer(device, outC * outH * outW * 4);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: inputBuf } },
      { binding: 2, resource: { buffer: weightBuf } },
      { binding: 3, resource: { buffer: dummyBias } },
      { binding: 4, resource: { buffer: outputBuf } },
    ],
  });

  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(ceil(outW, 16), ceil(outH, 16), outC);
  pass.end();

  return { buffer: outputBuf, outC, outH, outW };
}

/**
 * Dispatch fused ReLU(input) -> conv2d.
 * Returns output buffer [outC, outH, outW].
 */
function dispatchReluConv2d(device, encoder, inputBuf, weightBuf, biasBuf, params) {
  const { inC, inH, inW, outC, kH, kW, padH, padW, strideH, strideW } = params;
  const outH = Math.floor((inH + 2 * padH - kH) / strideH) + 1;
  const outW = Math.floor((inW + 2 * padW - kW) / strideW) + 1;
  const hasBias = biasBuf ? 1 : 0;

  const pipeline = getOrCreatePipeline(device, 'relu_conv2d', reluConv2dWGSL, 'relu_conv2d_main');

  const uniformData = new Uint32Array([inC, inH, inW, outC, outH, outW, kH, kW, padH, padW, strideH, strideW, hasBias]);
  const uniformBuf = cachedUniform(device, uniformData);

  const dummyBias = biasBuf || getDummyBias(device);
  const outputBuf = createEmptyBuffer(device, outC * outH * outW * 4);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: inputBuf } },
      { binding: 2, resource: { buffer: weightBuf } },
      { binding: 3, resource: { buffer: dummyBias } },
      { binding: 4, resource: { buffer: outputBuf } },
    ],
  });

  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(ceil(outW, 16), ceil(outH, 16), outC);
  pass.end();

  return { buffer: outputBuf, outC, outH, outW };
}

/**
 * Dispatch 1x1 conv.
 */
function dispatchConv1x1(device, encoder, inputBuf, weightBuf, biasBuf, params) {
  const { inC, outC, H, W } = params;
  const hasBias = biasBuf ? 1 : 0;

  const pipeline = getOrCreatePipeline(device, 'conv1x1', conv1x1WGSL, 'conv1x1_main');

  const totalWG = ceil(outC * H * W, 256);
  const [wgX, wgY] = splitWorkgroups(totalWG);
  const uniformData = new Uint32Array([inC, outC, H, W, hasBias, wgX]);
  const uniformBuf = cachedUniform(device, uniformData);

  const dummyBias = biasBuf || getDummyBias(device);
  const outputBuf = createEmptyBuffer(device, outC * H * W * 4);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: inputBuf } },
      { binding: 2, resource: { buffer: weightBuf } },
      { binding: 3, resource: { buffer: dummyBias } },
      { binding: 4, resource: { buffer: outputBuf } },
    ],
  });

  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(wgX, wgY);
  pass.end();

  return { buffer: outputBuf, C: outC, H, W };
}

/**
 * Dispatch element-wise activation.
 * op: 0=relu, 1=silu, 2=add, 3=add_relu, 4=sigmoid
 */
function dispatchActivation(device, encoder, inputA, inputB, count, op) {
  const pipeline = getOrCreatePipeline(device, 'activation', activationsWGSL, 'activation_main');

  const totalWG = ceil(count, 256);
  const [wgX, wgY] = splitWorkgroups(totalWG);
  const uniformData = new Uint32Array([count, op, wgX]);
  const uniformBuf = cachedUniform(device, uniformData);

  const dummyB = inputB || getDummyBias(device);
  const outputBuf = createEmptyBuffer(device, count * 4);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: inputA } },
      { binding: 2, resource: { buffer: dummyB } },
      { binding: 3, resource: { buffer: outputBuf } },
    ],
  });

  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(wgX, wgY);
  pass.end();

  return outputBuf;
}

/**
 * Dispatch GroupNorm (two-pass: stats then normalize).
 */
function dispatchGroupNorm(device, encoder, inputBuf, scaleBuf, biasBuf, params) {
  const { C, H, W, numGroups, eps = 1e-5 } = params;

  const statsPipeline = getOrCreatePipeline(device, 'gn_stats', groupnormWGSL, 'groupnorm_stats');
  const normPipeline = getOrCreatePipeline(device, 'gn_norm', groupnormWGSL, 'groupnorm_normalize');

  // Uniform: C, H, W, numGroups, eps (f32), numWorkgroupsX (u32)
  const normTotalWG = ceil(C * H * W, 256);
  const [normWgX, normWgY] = splitWorkgroups(normTotalWG);
  const uniformArr = new ArrayBuffer(24);
  const u32View = new Uint32Array(uniformArr);
  const f32View = new Float32Array(uniformArr);
  u32View[0] = C; u32View[1] = H; u32View[2] = W; u32View[3] = numGroups;
  f32View[4] = eps;
  u32View[5] = normWgX;

  const uniformBuf = cachedUniform(device, new Uint8Array(uniformArr));

  const statsBuf = createEmptyBuffer(device, numGroups * 2 * 4);
  const outputBuf = createEmptyBuffer(device, C * H * W * 4);

  // Pass 1: compute stats
  const statsBindGroup = device.createBindGroup({
    layout: statsPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: inputBuf } },
      { binding: 2, resource: { buffer: scaleBuf } },
      { binding: 3, resource: { buffer: biasBuf } },
      { binding: 4, resource: { buffer: outputBuf } },
      { binding: 5, resource: { buffer: statsBuf } },
    ],
  });

  const pass1 = encoder.beginComputePass();
  pass1.setPipeline(statsPipeline);
  pass1.setBindGroup(0, statsBindGroup);
  pass1.dispatchWorkgroups(ceil(numGroups, 256));
  pass1.end();

  // Pass 2: normalize
  const normBindGroup = device.createBindGroup({
    layout: normPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: inputBuf } },
      { binding: 2, resource: { buffer: scaleBuf } },
      { binding: 3, resource: { buffer: biasBuf } },
      { binding: 4, resource: { buffer: outputBuf } },
      { binding: 5, resource: { buffer: statsBuf } },
    ],
  });

  const pass2 = encoder.beginComputePass();
  pass2.setPipeline(normPipeline);
  pass2.setBindGroup(0, normBindGroup);
  pass2.dispatchWorkgroups(normWgX, normWgY);
  pass2.end();

  return outputBuf;
}

/**
 * Dispatch bilinear/nearest upsample.
 */
function dispatchUpsample(device, encoder, inputBuf, params) {
  const { C, inH, inW, outH, outW, mode = 1 } = params; // mode: 0=nearest, 1=bilinear

  const pipeline = getOrCreatePipeline(device, 'upsample', upsampleWGSL, 'upsample_main');

  const totalWG = ceil(C * outH * outW, 256);
  const [wgX, wgY] = splitWorkgroups(totalWG);
  const uniformData = new Uint32Array([C, inH, inW, outH, outW, mode, wgX]);
  const uniformBuf = cachedUniform(device, uniformData);

  const outputBuf = createEmptyBuffer(device, C * outH * outW * 4);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: inputBuf } },
      { binding: 2, resource: { buffer: outputBuf } },
    ],
  });

  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(wgX, wgY);
  pass.end();

  return { buffer: outputBuf, C, H: outH, W: outW };
}

/**
 * Dispatch transposed 2D convolution (deconvolution).
 * ConvTranspose2d(inC, outC, kernel_size=stride, stride=stride)
 */
function dispatchConvTranspose2d(device, encoder, inputBuf, weightBuf, biasBuf, params) {
  const { inC, inH, inW, outC, stride } = params;
  const kH = stride, kW = stride;
  const outH = inH * stride;
  const outW = inW * stride;
  const hasBias = biasBuf ? 1 : 0;
  const dummyBias = biasBuf || getDummyBias(device);
  const outputBuf = createEmptyBuffer(device, outC * outH * outW * 4);

  if (stride === 2) {
    const pipeline = getOrCreatePipeline(device, 'conv_transpose2d_stride2', convTranspose2dStride2WGSL, 'conv_transpose2d_stride2_main');
    const totalWG = ceil(outC * outH * outW, 256);
    const [wgX, wgY] = splitWorkgroups(totalWG);
    const uniformData = new Uint32Array([inC, inH, inW, outC, outH, outW, hasBias, wgX]);
    const uniformBuf = cachedUniform(device, uniformData);

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: { buffer: inputBuf } },
        { binding: 2, resource: { buffer: weightBuf } },
        { binding: 3, resource: { buffer: dummyBias } },
        { binding: 4, resource: { buffer: outputBuf } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();

    return { buffer: outputBuf, C: outC, H: outH, W: outW, kernel: 'conv_transpose2d_stride2' };
  }

  const pipeline = getOrCreatePipeline(device, 'conv_transpose2d', convTranspose2dWGSL, 'conv_transpose2d_main');

  const totalWG = ceil(outC * outH * outW, 256);
  const [wgX, wgY] = splitWorkgroups(totalWG);
  const uniformData = new Uint32Array([inC, inH, inW, outC, outH, outW, kH, kW, stride, stride, hasBias, wgX]);
  const uniformBuf = cachedUniform(device, uniformData);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: inputBuf } },
      { binding: 2, resource: { buffer: weightBuf } },
      { binding: 3, resource: { buffer: dummyBias } },
      { binding: 4, resource: { buffer: outputBuf } },
    ],
  });

  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(wgX, wgY);
  pass.end();

  return { buffer: outputBuf, C: outC, H: outH, W: outW, kernel: 'conv_transpose2d_general' };
}

/**
 * weights.js — Load MoGe-2 weights from flat binary format.
 *
 * Binary format (from convert_weights.py):
 *   Header: 4 (magic) + 4 (version) + 4 (num_tensors) + 4 (header_size) = 16 bytes
 *   Tensor table: num_tensors × 96 bytes each
 *     64 bytes: name (null-padded ASCII)
 *     4 bytes: dtype (0=fp32, 1=fp16)
 *     4 bytes: ndim
 *     16 bytes: shape (4 x u32)
 *     4 bytes: offset
 *     4 bytes: size
 *   Weight data: packed tensors
 *
 * Maps PyTorch state_dict names to the dispatch chain's weight structure.
 */


const MAGIC = 0x45474F4D; // "MOGE" in little-endian
const ENTRY_SIZE = 96;

/**
 * Parse the binary header and tensor table.
 * Returns { tensors: Map<name, { dtype, shape, offset, size }> }
 */
function parseHeader(buffer) {
  const view = new DataView(buffer);

  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(`Invalid weight file magic: 0x${magic.toString(16)}`);
  }

  const version = view.getUint32(4, true);
  if (version !== 1) {
    throw new Error(`Unsupported weight file version: ${version}`);
  }

  const numTensors = view.getUint32(8, true);
  const headerSize = view.getUint32(12, true);

  const expectedHeaderSize = 16 + numTensors * ENTRY_SIZE;
  if (expectedHeaderSize > buffer.byteLength) {
    throw new Error(`Corrupt weight file: header claims ${numTensors} tensors (${expectedHeaderSize} bytes) but file is only ${buffer.byteLength} bytes`);
  }

  const tensors = new Map();
  for (let i = 0; i < numTensors; i++) {
    const entryOffset = 16 + i * ENTRY_SIZE;

    // Name (64 bytes, null-terminated ASCII)
    const nameBytes = new Uint8Array(buffer, entryOffset, 64);
    let nameEnd = nameBytes.indexOf(0);
    if (nameEnd === -1) nameEnd = 64;
    const name = new TextDecoder().decode(nameBytes.slice(0, nameEnd));

    const dtype = view.getUint32(entryOffset + 64, true);
    const ndim = view.getUint32(entryOffset + 68, true);
    const shape = [];
    for (let d = 0; d < ndim; d++) {
      shape.push(view.getUint32(entryOffset + 72 + d * 4, true));
    }
    const offset = view.getUint32(entryOffset + 88, true);
    const size = view.getUint32(entryOffset + 92, true);

    tensors.set(name, { dtype, shape, offset, size });
  }

  return { tensors, headerSize };
}

/**
 * Extract a tensor from the binary buffer as a GPU storage buffer.
 * Converts fp16 → fp32 on CPU before uploading (WebGPU storage buffers are fp32).
 */
function extractTensor(device, buffer, tensorInfo) {
  const { dtype, offset, size } = tensorInfo;

  if (offset + size > buffer.byteLength) {
    throw new Error(`Tensor at offset ${offset} with size ${size} exceeds buffer length ${buffer.byteLength}`);
  }

  if (dtype === 0) {
    // fp32
    const data = new Float32Array(buffer, offset, size / 4);
    return createStorageBuffer(device, data);
  } else {
    // fp16 → fp32
    const fp16 = new Uint16Array(buffer, offset, size / 2);
    const fp32 = new Float32Array(fp16.length);
    for (let i = 0; i < fp16.length; i++) {
      fp32[i] = fp16ToFp32(fp16[i]);
    }
    return createStorageBuffer(device, fp32);
  }
}

/**
 * Convert fp16 (as uint16) to fp32.
 */
function fp16ToFp32(h) {
  const sign = (h >> 15) & 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;

  if (exp === 0) {
    if (mant === 0) return sign ? -0 : 0.0;
    // Subnormal
    let val = mant / 1024.0 * Math.pow(2, -14);
    return sign ? -val : val;
  }
  if (exp === 31) {
    return mant === 0 ? (sign ? -Infinity : Infinity) : NaN;
  }

  const val = Math.pow(2, exp - 15) * (1 + mant / 1024.0);
  return sign ? -val : val;
}

/**
 * Extract tensor data as CPU Float32Array (no GPU upload).
 */
function extractTensorCPU(buffer, tensorInfo) {
  const { dtype, offset, size } = tensorInfo;
  if (offset + size > buffer.byteLength) {
    throw new Error(`Tensor at offset ${offset} with size ${size} exceeds buffer length ${buffer.byteLength}`);
  }
  if (dtype === 0) {
    return new Float32Array(buffer.slice(offset, offset + size));
  } else {
    const fp16 = new Uint16Array(buffer, offset, size / 2);
    const fp32 = new Float32Array(fp16.length);
    for (let i = 0; i < fp16.length; i++) {
      fp32[i] = fp16ToFp32(fp16[i]);
    }
    return fp32;
  }
}

/**
 * Get a tensor by name, or return null if not found.
 */
function getTensor(device, buffer, tensors, name) {
  const info = tensors.get(name);
  if (!info) return null;
  return extractTensor(device, buffer, info);
}

/**
 * Build the full weight structure from the binary file.
 * Maps PyTorch state_dict names to the dispatch chain's expected format.
 */
async function loadWeights(device, url, onProgress) {
  // Fetch the binary file
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch weights: ${response.status}`);
  }

  const contentLength = parseInt(response.headers.get('content-length') || '0');
  const reader = response.body.getReader();

  // Read with progress
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) {
      onProgress(received, contentLength);
    }
  }

  // Concatenate chunks
  const buffer = new ArrayBuffer(received);
  const uint8 = new Uint8Array(buffer);
  let pos = 0;
  for (const chunk of chunks) {
    uint8.set(chunk, pos);
    pos += chunk.length;
  }

  const { tensors } = parseHeader(buffer);

  // Helper: get tensor info or throw (for CPU extraction)
  const getInfo = (name) => {
    const info = tensors.get(name);
    if (!info) throw new Error(`Missing weight: ${name}`);
    return info;
  };

  // Helper: get tensor or throw
  const get = (name) => {
    const buf = getTensor(device, buffer, tensors, name);
    if (!buf) throw new Error(`Missing weight: ${name}`);
    return buf;
  };

  // Build ConvStack weights for a given prefix (neck, points_head, etc.)
  function buildConvStackWeights(prefix, config) {
    const { dimIn, dimResBlocks, dimOut, numResBlocks, resamplers } = config;

    return {
      levels: dimResBlocks.map((dimRB, i) => {
        // input_block: 1x1 conv
        const inputWeight = dimIn[i] != null
          ? get(`${prefix}.input_blocks.${i}.weight`)
          : null;
        const inputBias = dimIn[i] != null
          ? get(`${prefix}.input_blocks.${i}.bias`)
          : null;

        // res_blocks
        const resBlocks = [];
        for (let j = 0; j < numResBlocks[i]; j++) {
          // ResidualConvBlock layers: [norm0, act1, conv2, norm3, act4, conv5]
          // With norm='none', layers.0 and layers.3 are Identity (no weights)
          resBlocks.push({
            norm1_scale: null, // norm='none'
            norm1_bias: null,
            conv1_weight: get(`${prefix}.res_blocks.${i}.${j}.layers.2.weight`),
            conv1_bias: get(`${prefix}.res_blocks.${i}.${j}.layers.2.bias`),
            norm2_scale: null,
            norm2_bias: null,
            conv2_weight: get(`${prefix}.res_blocks.${i}.${j}.layers.5.weight`),
            conv2_bias: get(`${prefix}.res_blocks.${i}.${j}.layers.5.bias`),
            skip_weight: null, // in_channels == out_channels for all MoGe-2 res blocks
          });
        }

        // output_block: 1x1 conv (only at final level with dimOut != null)
        const outputWeight = dimOut[i] != null
          ? get(`${prefix}.output_blocks.${i}.weight`)
          : null;
        const outputBias = dimOut[i] != null
          ? get(`${prefix}.output_blocks.${i}.bias`)
          : null;

        // resampler
        let resampler = null;
        if (i < dimResBlocks.length - 1 && resamplers[i]) {
          if (resamplers[i] === 'conv_transpose') {
            resampler = {
              deconv_weight: get(`${prefix}.resamplers.${i}.0.weight`),
              deconv_bias: get(`${prefix}.resamplers.${i}.0.bias`),
              conv_weight: get(`${prefix}.resamplers.${i}.1.weight`),
              conv_bias: get(`${prefix}.resamplers.${i}.1.bias`),
            };
          } else if (resamplers[i] === 'bilinear') {
            // Bilinear resampler: no .0 (upsample is parameterfree), only .1 (conv)
            resampler = {
              conv_weight: get(`${prefix}.resamplers.${i}.1.weight`),
              conv_bias: get(`${prefix}.resamplers.${i}.1.bias`),
            };
          }
        }

        return {
          input_weight: inputWeight,
          input_bias: inputBias,
          res_blocks: resBlocks,
          output_weight: outputWeight,
          output_bias: outputBias,
          resampler,
        };
      }),
    };
  }

  // Build encoder weights (for when ViT backbone is implemented)
  // For now, just extract the output projections and image normalization
  const encoder = {
    imageMean: get('encoder.image_mean'),
    imageStd: get('encoder.image_std'),
    outputProjections: [0, 1, 2, 3].map(i => ({
      weight: get(`encoder.output_projections.${i}.weight`),
      bias: get(`encoder.output_projections.${i}.bias`),
    })),
    patchEmbed: {
      weight: get('encoder.backbone.patch_embed.proj.weight'),
      bias: get('encoder.backbone.patch_embed.proj.bias'),
    },
    posEmbed: get('encoder.backbone.pos_embed'),
    clsToken: get('encoder.backbone.cls_token'),
    norm: {
      weight: get('encoder.backbone.norm.weight'),
      bias: get('encoder.backbone.norm.bias'),
    },
    blockWeights: {},
  };

  // Load all 24 transformer block weights
  for (let l = 0; l < 24; l++) {
    const prefix = `encoder.backbone.blocks.${l}`;
    for (const name of [
      'attn.qkv.weight', 'attn.qkv.bias',
      'attn.proj.weight', 'attn.proj.bias',
      'norm1.weight', 'norm1.bias',
      'norm2.weight', 'norm2.bias',
      'ls1.gamma', 'ls2.gamma',
      'mlp.fc1.weight', 'mlp.fc1.bias',
      'mlp.fc2.weight', 'mlp.fc2.bias',
    ]) {
      const fullName = `${prefix}.${name}`;
      const buf = getTensor(device, buffer, tensors, fullName);
      if (buf) {
        encoder.blockWeights[fullName] = buf;
      }
    }
  }

  // Build all ConvStack weights
  // Import config directly
  const neckConfig = {
    dimIn: [1026, 2, 2, 2, 2],
    dimResBlocks: [1024, 256, 128, 64, 32],
    dimOut: [null, null, null, null, null],
    numResBlocks: [0, 2, 2, 2, 0],
    resamplers: ['conv_transpose', 'conv_transpose', 'conv_transpose', 'bilinear'],
  };

  const headConfig = {
    dimIn: [1024, 256, 128, 64, 32],
    dimResBlocks: [1024, 256, 128, 64, 32],
    numResBlocks: [0, 1, 1, 1, 0],
    resamplers: ['conv_transpose', 'conv_transpose', 'conv_transpose', 'bilinear'],
  };

  const weights = {
    encoder,
    neck: buildConvStackWeights('neck', neckConfig),
    pointsHead: buildConvStackWeights('points_head', {
      ...headConfig,
      dimOut: [null, null, null, null, 3],
    }),
    normalHead: buildConvStackWeights('normal_head', {
      ...headConfig,
      dimOut: [null, null, null, null, 3],
    }),
    maskHead: buildConvStackWeights('mask_head', {
      ...headConfig,
      dimOut: [null, null, null, null, 1],
    }),
    scaleHead: {
      layers: [
        { weight: extractTensorCPU(buffer, getInfo('scale_head.0.weight')), bias: extractTensorCPU(buffer, getInfo('scale_head.0.bias')), inDim: 1024, outDim: 1024 },
        { weight: extractTensorCPU(buffer, getInfo('scale_head.2.weight')), bias: extractTensorCPU(buffer, getInfo('scale_head.2.bias')), inDim: 1024, outDim: 1024 },
        { weight: extractTensorCPU(buffer, getInfo('scale_head.4.weight')), bias: extractTensorCPU(buffer, getInfo('scale_head.4.bias')), inDim: 1024, outDim: 1 },
      ],
    },
  };

  console.log(`Loaded ${tensors.size} tensors from weight file`);
  return weights;
}

/**
 * scheduler_receipt.js — cooperative scheduler config, event capture, and the
 * scheduler verification receipt.
 *
 * Pure JS, no browser/WebGPU/vite dependencies, so the receipt authority logic
 * is unit-testable in plain Node (tools/test_scheduler_receipt_unit.mjs).
 *
 * Authority boundary (adjudicated in the e4f794f scheduler-proof review and
 * preserved here): observed queue/readback stage boundaries are NOT proof of
 * cooperative yielding, and a trace synthesized from stage timings is NOT an
 * observation. `status: "verified"` / `classification: "observed-boundary"`
 * require a genuinely observed event trace (provenance "observed"), and when
 * the scheduler requests yields, observed yield events.
 */

const SCHEDULER_VERIFICATION_RECEIPT_SCHEMA = 'kaminos.webgpu-scheduler-verification-receipt.v0';
const SCHEDULER_EVENT_TRACE_SCHEMA = 'kaminos.webgpu-scheduler-event-trace.v0';
const MOGE_DEPTH_NORMAL_ROUTE_ID$3 = 'moge.depth-normal.webgpu-local.v0';

const OBSERVED_PROVENANCE = 'observed';
const SYNTHESIZED_PROVENANCE = 'synthesized-from-stage-timings';

function cloneJson$1(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

// --- Cooperative scheduling (model-owned, aligned to the kit's declared
// moge scheduler profile: per-phase chunked submits with browser yields) ---

function resolveCooperativeScheduler(requested) {
  if (!requested || requested.mode !== 'cooperative') return null;
  return {
    mode: 'cooperative',
    yieldMs: Math.max(0, Number.isFinite(Number(requested.yieldMs)) ? Number(requested.yieldMs) : 4),
    vitBlockChunkSize: Math.max(1, Math.floor(Number(requested.vitBlockChunkSize) || 1)),
    // Fine granularity: split inside vit blocks (attention/MLP segments) and
    // inside decoder ConvStack levels (per res block), keeping each GPU
    // submission near a frame budget for shared-device hosts.
    splitVitBlocks: requested.splitVitBlocks === true,
    splitDecoderResBlocks: requested.splitDecoderResBlocks === true,
    waitForSubmittedWorkDone: requested.waitForSubmittedWorkDone !== false,
    events: [],
  };
}

function coopEvent(coop, phase, kind, extra = {}) {
  coop.events.push({
    tMs: performance.now(),
    phase,
    boundary: `moge-stage:${phase}`,
    kind,
    source: 'moge-webgpu-runtime',
    provenance: OBSERVED_PROVENANCE,
    ...extra,
  });
}

async function coopYield(coop, phase) {
  if (!coop) return;
  coopEvent(coop, phase, 'yield-start');
  await new Promise(resolve => setTimeout(resolve, coop.yieldMs));
  coopEvent(coop, phase, 'yield-end', { yieldMs: coop.yieldMs });
}

/**
 * Scheduler descriptor for the route request. `backboneTotalItems` bounds the
 * effective backbone chunk size: a requested chunk larger than the block count
 * collapses to a single submit, and the effective descriptor must say so
 * rather than echo a granularity the run did not deliver.
 */
function cooperativeSchedulerDescriptor(coop, { backboneTotalItems } = {}) {
  const requestedChunks = {
    backbone: coop.vitBlockChunkSize,
    'decoder-heads': 1,
    'output-readback': 1,
  };
  const effectiveChunks = {
    ...requestedChunks,
    backbone: Number.isFinite(backboneTotalItems)
      ? Math.min(coop.vitBlockChunkSize, backboneTotalItems)
      : coop.vitBlockChunkSize,
  };
  const base = {
    mode: 'cooperative',
    yieldMs: coop.yieldMs,
    waitForSubmittedWorkDone: coop.waitForSubmittedWorkDone,
  };
  return {
    requestedScheduler: { ...base, phaseChunkSize: requestedChunks },
    effectiveScheduler: { ...base, phaseChunkSize: effectiveChunks, unsupportedFields: [] },
  };
}

function createMogeSchedulerEventTrace(stagedStages, observedEvents) {
  if (Array.isArray(observedEvents) && observedEvents.length > 0) {
    return {
      schema: SCHEDULER_EVENT_TRACE_SCHEMA,
      clock: 'performance.now',
      timingAuthority: 'queue-submit-wait',
      eventProvenance: OBSERVED_PROVENANCE,
      events: observedEvents.map(event => ({ provenance: OBSERVED_PROVENANCE, ...event })),
    };
  }
  let cursorMs = 0;
  const events = [];
  for (const [index, stage] of (stagedStages || []).entries()) {
    if (!stage?.name || !Number.isFinite(stage.ms)) continue;
    const boundary = `moge-stage:${stage.name}`;
    const waitKind = stage.name === 'output-readback' ? 'readback-wait' : 'queue-work-done';
    events.push({
      tMs: cursorMs,
      phase: stage.name,
      boundary,
      kind: `${waitKind}-start`,
      index,
      source: 'moge-webgpu-runtime',
      provenance: SYNTHESIZED_PROVENANCE,
    });
    cursorMs += Math.max(0, stage.ms);
    events.push({
      tMs: cursorMs,
      phase: stage.name,
      boundary,
      kind: `${waitKind}-end`,
      index,
      waitMs: stage.ms,
      source: 'moge-webgpu-runtime',
      provenance: SYNTHESIZED_PROVENANCE,
    });
  }
  return {
    schema: SCHEDULER_EVENT_TRACE_SCHEMA,
    clock: 'performance.now',
    timingAuthority: stagedStages ? 'queue-submit-wait' : 'not-observed',
    eventProvenance: events.length ? SYNTHESIZED_PROVENANCE : 'none',
    events,
  };
}

function createMogeBoundaryAssertions(scheduler, events) {
  const requested = scheduler?.requestedScheduler?.phaseChunkSize || {};
  const effective = scheduler?.effectiveScheduler?.phaseChunkSize || {};
  const unsupportedFields = scheduler?.effectiveScheduler?.unsupportedFields || [];
  return Object.entries(requested).map(([phase, requestedValue]) => {
    const field = `phaseChunkSize.${phase}`;
    const boundary = `moge-stage:${phase}`;
    const boundaryEvents = events.filter(event => event.boundary === boundary);
    const observedBoundaryEvents = boundaryEvents.filter(event => event.provenance === OBSERVED_PROVENANCE);
    const unsupported = unsupportedFields.includes(field) || unsupportedFields.includes('phaseChunkSize');
    // Observation counts come only from genuinely observed events; a trace
    // synthesized from stage timings must not masquerade as observation.
    const observedQueueWaitCount = observedBoundaryEvents.filter(event =>
      event.kind === 'queue-work-done-end' || event.kind === 'readback-wait-end'
    ).length;
    const observedYieldCount = observedBoundaryEvents.filter(event => event.kind === 'yield-end').length;
    const observedStart = observedBoundaryEvents.some(event => String(event.kind || '').endsWith('-start'));
    const observedEnd = observedBoundaryEvents.some(event => String(event.kind || '').endsWith('-end'));
    const observedCount = Math.max(observedQueueWaitCount, observedStart && observedEnd ? 1 : 0);
    // A trace synthesized from stage timings carries real queue-submit-wait
    // measurements but is not event observation: it earns "timing-only",
    // never "verified".
    const synthesizedStart = boundaryEvents.some(event =>
      event.provenance !== OBSERVED_PROVENANCE && String(event.kind || '').endsWith('-start'));
    const synthesizedEnd = boundaryEvents.some(event =>
      event.provenance !== OBSERVED_PROVENANCE && String(event.kind || '').endsWith('-end'));
    const status = unsupported
      ? 'unsupported'
      : (observedCount > 0 ? 'verified' : (synthesizedStart && synthesizedEnd ? 'timing-only' : 'unverified'));
    return {
      field,
      requested: requestedValue,
      effective: Number.isFinite(effective[phase]) ? effective[phase] : null,
      status,
      observedBoundary: boundary,
      observedCount,
      expectedMinimumCount: 1,
      observedQueueWaitCount,
      observedYieldCount,
      unsupportedReason: unsupported ? 'effective scheduler declared this field unsupported' : null,
    };
  });
}

function schedulerRequestsYield(scheduler = {}) {
  const requested = scheduler.requestedScheduler || {};
  const effective = scheduler.effectiveScheduler || {};
  return Number(requested.yieldMs || 0) > 0 || Number(effective.yieldMs || 0) > 0;
}

function createMogeSchedulerVerificationReceipt({ routeRequest, scheduler, backpressure, stagedStages, observedEvents }) {
  const eventTrace = createMogeSchedulerEventTrace(stagedStages, observedEvents);
  const boundaryAssertions = createMogeBoundaryAssertions(scheduler, eventTrace.events);
  const traceObserved = eventTrace.eventProvenance === OBSERVED_PROVENANCE;
  const yieldObserved = boundaryAssertions.some(assertion => assertion.observedYieldCount > 0);
  const downgrades = [];
  const falseAuthorityChecks = {
    eventTraceMissing: false,
    verifiedWithoutObservedBoundary: false,
    timingProxyOnly: false,
    queueWaitEventsMissing: false,
    boundaryAssertionEventMismatch: false,
    requestedBoundaryAssertionMissing: false,
    requestedFieldDroppedWithoutUnsupported: false,
  };

  if (!eventTrace.events.length) {
    downgrades.push('event-trace-missing');
    falseAuthorityChecks.eventTraceMissing = true;
  }
  if (!traceObserved && eventTrace.events.length) {
    // Stage-timing-derived trace: a timing proxy, never observation authority.
    downgrades.push('event-trace-synthesized');
    falseAuthorityChecks.timingProxyOnly = true;
  }
  if (schedulerRequestsYield(scheduler) && !yieldObserved) downgrades.push('yield-events-missing');

  const requestedPhases = Object.keys(scheduler?.requestedScheduler?.phaseChunkSize || {});
  const verifiedPhases = new Set(
    boundaryAssertions
      .filter(assertion => assertion.status === 'verified')
      .map(assertion => assertion.field.replace(/^phaseChunkSize\./, ''))
  );
  // A timing-only assertion is present evidence (real stage waits), so it does
  // not count as a missing boundary assertion — it just cannot verify.
  const presentPhases = new Set(
    boundaryAssertions
      .filter(assertion => assertion.status === 'verified' || assertion.status === 'timing-only')
      .map(assertion => assertion.field.replace(/^phaseChunkSize\./, ''))
  );
  for (const phase of requestedPhases) {
    if (!presentPhases.has(phase)) {
      downgrades.push('requested-boundary-assertion-missing');
      falseAuthorityChecks.requestedBoundaryAssertionMissing = true;
      break;
    }
  }

  const unsupported = boundaryAssertions.some(assertion => assertion.status === 'unsupported');
  const verified = traceObserved
    && eventTrace.events.length > 0
    && requestedPhases.length > 0
    && requestedPhases.every(phase => verifiedPhases.has(phase))
    && (!schedulerRequestsYield(scheduler) || yieldObserved)
    && !unsupported;
  const status = unsupported ? 'unsupported' : (verified ? 'verified' : 'scheduler-unverified');

  return {
    schema: SCHEDULER_VERIFICATION_RECEIPT_SCHEMA,
    status,
    classification: status === 'verified'
      ? 'observed-boundary'
      : (status === 'unsupported' ? 'unsupported' : 'config-only'),
    observationClass: boundaryAssertions.some(assertion => assertion.status === 'verified')
      ? 'observed-stage-boundary'
      : (boundaryAssertions.some(assertion => assertion.status === 'timing-only') ? 'stage-timing-proxy' : 'none'),
    route: {
      requestedRouteId: routeRequest?.routeId || MOGE_DEPTH_NORMAL_ROUTE_ID$3,
      effectiveRouteId: MOGE_DEPTH_NORMAL_ROUTE_ID$3,
      backendClass: 'browser-webgpu',
      requestId: routeRequest?.requestId || null,
    },
    scheduler: cloneJson$1(scheduler),
    backpressure: cloneJson$1(backpressure),
    eventTrace,
    boundaryAssertions,
    frameTail: {
      evidenceSource: eventTrace.timingAuthority,
      disclaimer: 'not-gpu-exclusive-or-present-latency',
      rafFps: null,
      frameP95Ms: null,
      queueDoneP95Ms: null,
    },
    downgrades: [...new Set(downgrades)],
    falseAuthorityChecks,
  };
}

const patchEmbedWGSL = "// DINOv2 patch embedding compute shader.\n// Takes an image [3, H, W] and produces (N+1, D) token embeddings:\n//   N patches (tokenH x tokenW grid of 14x14 patches) + 1 CLS token.\n//   Each patch is flattened (14*14*3 = 588) then linearly projected to D.\n//   Position embeddings are interpolated from the pretrained (1+370, D) table.\n//\n// DINOv2 differences from DeiT:\n//   - 14x14 patches (not 16x16)\n//   - Variable spatial dimensions (not fixed 224x224)\n//   - Position embedding interpolation for arbitrary token counts\n\nstruct Params {\n  imgH: u32,      // image height (tokenH * 14)\n  imgW: u32,      // image width (tokenW * 14)\n  patchSize: u32,  // 14\n  tokenH: u32,\n  tokenW: u32,\n  channels: u32,   // 3\n  D: u32,          // model dim (1024)\n  numTokens: u32,  // tokenH * tokenW + 1 (including CLS)\n  numWorkgroupsX: u32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> image: array<f32>;       // [3, imgH, imgW] CHW\n@group(0) @binding(2) var<storage, read> projWeight: array<f32>;  // [D, 3, 14, 14] = [D, 588]\n@group(0) @binding(3) var<storage, read> projBias: array<f32>;    // [D]\n@group(0) @binding(4) var<storage, read> clsToken: array<f32>;    // [1, 1, D]\n@group(0) @binding(5) var<storage, read> posEmbed: array<f32>;    // [1, 1+numPatchesPretrained, D]\n@group(0) @binding(6) var<storage, read_write> output: array<f32>; // [numTokens, D]\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n  let totalElements = params.numTokens * params.D;\n\n  if (idx >= totalElements) { return; }\n\n  let token = idx / params.D;\n  let d = idx % params.D;\n\n  var val = 0.0;\n\n  if (token == 0u) {\n    // CLS token\n    val = clsToken[d];\n  } else {\n    // Patch embedding\n    let patchIdx = token - 1u;\n    let patchRow = patchIdx / params.tokenW;\n    let patchCol = patchIdx % params.tokenW;\n    let startY = patchRow * params.patchSize;\n    let startX = patchCol * params.patchSize;\n\n    // Conv2d-style patch projection: weight is [D, 3, 14, 14]\n    val = projBias[d];\n    for (var c = 0u; c < params.channels; c++) {\n      for (var py = 0u; py < params.patchSize; py++) {\n        for (var px = 0u; px < params.patchSize; px++) {\n          let imgY = startY + py;\n          let imgX = startX + px;\n          // Image is CHW\n          let pixelVal = image[c * params.imgH * params.imgW + imgY * params.imgW + imgX];\n          // Weight is [D, C, pH, pW] → index [d, c, py, px]\n          let wIdx = d * params.channels * params.patchSize * params.patchSize\n                   + c * params.patchSize * params.patchSize\n                   + py * params.patchSize + px;\n          val += pixelVal * projWeight[wIdx];\n        }\n      }\n    }\n  }\n\n  // Add position embedding (CLS pos is at index 0, patch pos follow)\n  // For now: use position embedding directly if token count matches,\n  // otherwise skip (interpolation would need a separate pass)\n  val += posEmbed[idx];\n\n  output[idx] = val;\n}\n";

const layerNormWGSL = "// Layer normalization for ViT backbone.\n// Each workgroup normalizes one row (token).\n// Thread 0 computes mean/variance serially, then all threads normalize in parallel.\n// Adapted from webgpu-samples visionTransformer with 2D dispatch support.\n\nstruct Params {\n  N: u32,       // number of rows (tokens)\n  D: u32,       // dimension per row\n  eps: f32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> gamma: array<f32>;\n@group(0) @binding(3) var<storage, read> beta: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nvar<workgroup> shared_mean: f32;\nvar<workgroup> shared_inv_std: f32;\n\n@compute @workgroup_size(256)\nfn main(\n  @builtin(workgroup_id) wg_id: vec3u,\n  @builtin(local_invocation_id) local_id: vec3u,\n) {\n  let row = wg_id.x;\n  let tid = local_id.x;\n  let D = params.D;\n  let base = row * D;\n\n  if (row >= params.N) { return; }\n\n  // Thread 0 computes mean and variance (two-pass for numerical stability).\n  // The one-pass formula E[x²]-E[x]² suffers catastrophic cancellation when\n  // values are large (±20 common in ViT), losing significant precision.\n  if (tid == 0u) {\n    var sum = 0.0;\n    for (var i = 0u; i < D; i++) {\n      sum += input[base + i];\n    }\n    let mean = sum / f32(D);\n    var var_sum = 0.0;\n    for (var i = 0u; i < D; i++) {\n      let diff = input[base + i] - mean;\n      var_sum += diff * diff;\n    }\n    let variance = var_sum / f32(D);\n    shared_mean = mean;\n    shared_inv_std = 1.0 / sqrt(variance + params.eps);\n  }\n  workgroupBarrier();\n\n  let mean = shared_mean;\n  let inv_std = shared_inv_std;\n\n  // All threads normalize and apply affine transform in parallel\n  for (var i = tid; i < D; i += 256u) {\n    let val = input[base + i];\n    output[base + i] = (val - mean) * inv_std * gamma[i] + beta[i];\n  }\n}\n";

const attentionWGSL = "// Multi-head self-attention compute shaders for DINOv2 ViT.\n// Adapted from webgpu-samples visionTransformer with 2D dispatch.\n//\n// Three entry points:\n//   computeScores: Q·K^T scaled dot product → scores\n//   softmax: row-wise numerically stable softmax\n//   applyAttn: scores @ V → output\n\nstruct ScoreParams {\n  N: u32,        // number of tokens\n  D: u32,        // model dimension\n  numHeads: u32,\n  headDim: u32,\n  scale: f32,\n  numWorkgroupsX: u32,\n}\n\nstruct SoftmaxParams {\n  N: u32,\n  numHeads: u32,\n  numWorkgroupsX: u32,\n}\n\nstruct ApplyParams {\n  N: u32,\n  D: u32,\n  numHeads: u32,\n  headDim: u32,\n  numWorkgroupsX: u32,\n}\n\n// --- Attention scores ---\n@group(0) @binding(0) var<uniform> scoreParams: ScoreParams;\n@group(0) @binding(1) var<storage, read> qBuf: array<f32>;\n@group(0) @binding(2) var<storage, read> kBuf: array<f32>;\n@group(0) @binding(3) var<storage, read_write> scoreBuf: array<f32>;\n\n@compute @workgroup_size(256)\nfn computeScores(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * scoreParams.numWorkgroupsX;\n  let idx = linearWG * 256u + lid.x;\n\n  let N = scoreParams.N;\n  let numHeads = scoreParams.numHeads;\n  let headDim = scoreParams.headDim;\n  let D = scoreParams.D;\n  let totalScores = numHeads * N * N;\n\n  if (idx >= totalScores) { return; }\n\n  let head = idx / (N * N);\n  let remainder = idx % (N * N);\n  let qi = remainder / N;\n  let ki = remainder % N;\n  let headOffset = head * headDim;\n\n  // headDim is 64, so 4-way split gives 16-element chains.\n  var d0 = 0.0;\n  var d1 = 0.0;\n  var d2 = 0.0;\n  var d3 = 0.0;\n  let qBase = qi * D + headOffset;\n  let kBase = ki * D + headOffset;\n  let hd4 = (headDim / 4u) * 4u;\n  for (var d = 0u; d < hd4; d += 4u) {\n    d0 += qBuf[qBase + d]      * kBuf[kBase + d];\n    d1 += qBuf[qBase + d + 1u] * kBuf[kBase + d + 1u];\n    d2 += qBuf[qBase + d + 2u] * kBuf[kBase + d + 2u];\n    d3 += qBuf[qBase + d + 3u] * kBuf[kBase + d + 3u];\n  }\n  for (var d = hd4; d < headDim; d++) {\n    d0 += qBuf[qBase + d] * kBuf[kBase + d];\n  }\n\n  scoreBuf[idx] = ((d0 + d1) + (d2 + d3)) * scoreParams.scale;\n}\n\n// --- Softmax ---\n// Uses separate bind group with SoftmaxParams\n@group(0) @binding(0) var<uniform> softmaxParams: SoftmaxParams;\n@group(0) @binding(1) var<storage, read_write> softmaxScoreBuf: array<f32>;\n\n@compute @workgroup_size(256)\nfn softmax(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * softmaxParams.numWorkgroupsX;\n  let idx = linearWG * 256u + lid.x;\n\n  let N = softmaxParams.N;\n  let totalRows = softmaxParams.numHeads * N;\n\n  if (idx >= totalRows) { return; }\n\n  let base = idx * N;\n\n  // Find max\n  var m = -1e30;\n  for (var i = 0u; i < N; i++) {\n    m = max(m, softmaxScoreBuf[base + i]);\n  }\n\n  // Exp and sum\n  var s = 0.0;\n  for (var i = 0u; i < N; i++) {\n    let e = exp(softmaxScoreBuf[base + i] - m);\n    softmaxScoreBuf[base + i] = e;\n    s += e;\n  }\n\n  // Normalize\n  for (var i = 0u; i < N; i++) {\n    softmaxScoreBuf[base + i] = softmaxScoreBuf[base + i] / s;\n  }\n}\n\n// --- Apply attention ---\n@group(0) @binding(0) var<uniform> applyParams: ApplyParams;\n@group(0) @binding(1) var<storage, read> applyScoreBuf: array<f32>;\n@group(0) @binding(2) var<storage, read> vBuf: array<f32>;\n@group(0) @binding(3) var<storage, read_write> attnOutput: array<f32>;\n\n@compute @workgroup_size(256)\nfn applyAttn(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * applyParams.numWorkgroupsX;\n  let idx = linearWG * 256u + lid.x;\n\n  let N = applyParams.N;\n  let D = applyParams.D;\n  let numHeads = applyParams.numHeads;\n  let headDim = applyParams.headDim;\n\n  if (idx >= N * D) { return; }\n\n  let row = idx / D;\n  let col = idx % D;\n  let head = col / headDim;\n  let d = col % headDim;\n\n  // N is ~1370 tokens, 4-way split gives ~342-element chains.\n  var v0 = 0.0;\n  var v1 = 0.0;\n  var v2 = 0.0;\n  var v3 = 0.0;\n  let scoreBase = head * N * N + row * N;\n  let vCol = head * headDim + d;\n  let n4 = (N / 4u) * 4u;\n  for (var j = 0u; j < n4; j += 4u) {\n    v0 += applyScoreBuf[scoreBase + j]      * vBuf[(j)      * D + vCol];\n    v1 += applyScoreBuf[scoreBase + j + 1u] * vBuf[(j + 1u) * D + vCol];\n    v2 += applyScoreBuf[scoreBase + j + 2u] * vBuf[(j + 2u) * D + vCol];\n    v3 += applyScoreBuf[scoreBase + j + 3u] * vBuf[(j + 3u) * D + vCol];\n  }\n  for (var j = n4; j < N; j++) {\n    v0 += applyScoreBuf[scoreBase + j] * vBuf[j * D + vCol];\n  }\n  attnOutput[idx] = (v0 + v1) + (v2 + v3);\n}\n";

const linearWGSL = "// Linear projection: output = input @ weight + bias\n// Adapted from webgpu-samples visionTransformer mlp.wgsl with 2D dispatch.\n// Weight layout: [inDim, outDim] (row-major, transposed from PyTorch convention)\n\nstruct Params {\n  numRows: u32,\n  inDim: u32,\n  outDim: u32,\n  numWorkgroupsX: u32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> weight: array<f32>;\n@group(0) @binding(3) var<storage, read> bias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  if (idx >= params.numRows * params.outDim) { return; }\n\n  let row = idx / params.outDim;\n  let col = idx % params.outDim;\n\n  // 4-way split accumulation for better fp32 precision on large dot products.\n  // Bias added at end to match PyTorch accumulation order.\n  var s0 = 0.0;\n  var s1 = 0.0;\n  var s2 = 0.0;\n  var s3 = 0.0;\n  let inBase = row * params.inDim;\n  let wBase = col;\n  let stride = params.outDim;\n  let len4 = (params.inDim / 4u) * 4u;\n  for (var k = 0u; k < len4; k += 4u) {\n    s0 += input[inBase + k]      * weight[(k)      * stride + wBase];\n    s1 += input[inBase + k + 1u] * weight[(k + 1u) * stride + wBase];\n    s2 += input[inBase + k + 2u] * weight[(k + 2u) * stride + wBase];\n    s3 += input[inBase + k + 3u] * weight[(k + 3u) * stride + wBase];\n  }\n  for (var k = len4; k < params.inDim; k++) {\n    s0 += input[inBase + k] * weight[k * stride + wBase];\n  }\n  output[idx] = (s0 + s1) + (s2 + s3) + bias[col];\n}\n";

const linearGeluWGSL = "// Linear projection + GELU activation: output = GELU(input @ weight + bias)\n// Used for MLP fc1 in DINOv2 ViT blocks.\n// NaN guard: Apple Metal may produce NaN from finite accumulations; sanitized via bitcast.\n\nstruct Params {\n  numRows: u32,\n  inDim: u32,\n  outDim: u32,\n  numWorkgroupsX: u32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> weight: array<f32>;\n@group(0) @binding(3) var<storage, read> bias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\nfn gelu(x: f32) -> f32 {\n  // GELU via erf approximation (Abramowitz & Stegun 7.1.26, max error ~1.5e-7).\n  // Avoids tanh() which has precision issues on Apple Metal fast-math.\n  if (x > 10.0) { return x; }\n  if (x < -10.0) { return 0.0; }\n  let a = x * 0.7071067811865476; // x / sqrt(2)\n  let s = sign(a);\n  let t_abs = abs(a);\n  let p = 0.3275911;\n  let t = 1.0 / (1.0 + p * t_abs);\n  let t2 = t * t;\n  let t3 = t2 * t;\n  let t4 = t3 * t;\n  let t5 = t4 * t;\n  let erf_abs = 1.0 - (0.254829592 * t - 0.284496736 * t2 + 1.421413741 * t3 - 1.453152027 * t4 + 1.061405429 * t5) * exp(-t_abs * t_abs);\n  let erf_val = s * erf_abs;\n  return 0.5 * x * (1.0 + erf_val);\n}\n\n@compute @workgroup_size(WG_SIZE)\nfn main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  if (idx >= params.numRows * params.outDim) { return; }\n\n  let row = idx / params.outDim;\n  let col = idx % params.outDim;\n\n  // Split accumulation (see linear.wgsl for rationale).\n  var s0 = 0.0;\n  var s1 = 0.0;\n  var s2 = 0.0;\n  var s3 = 0.0;\n  let inBase = row * params.inDim;\n  let wBase = col;\n  let stride = params.outDim;\n  let len4 = (params.inDim / 4u) * 4u;\n  for (var k = 0u; k < len4; k += 4u) {\n    s0 += input[inBase + k]      * weight[(k)      * stride + wBase];\n    s1 += input[inBase + k + 1u] * weight[(k + 1u) * stride + wBase];\n    s2 += input[inBase + k + 2u] * weight[(k + 2u) * stride + wBase];\n    s3 += input[inBase + k + 3u] * weight[(k + 3u) * stride + wBase];\n  }\n  for (var k = len4; k < params.inDim; k++) {\n    s0 += input[inBase + k] * weight[k * stride + wBase];\n  }\n  output[idx] = gelu((s0 + s1) + (s2 + s3) + bias[col]);\n}\n";

const layerscaleWGSL = "// LayerScale: element-wise multiply by learned gamma, then add residual.\n// DINOv2 applies this after attention and after FFN:\n//   x = x + gamma * sublayer(norm(x))\n//\n// This shader does: output[i] = residual[i] + gamma[i % D] * input[i]\n\nstruct Params {\n  count: u32,   // total elements (N * D)\n  D: u32,       // model dim (for gamma indexing)\n  numWorkgroupsX: u32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;      // sublayer output\n@group(0) @binding(2) var<storage, read> gamma: array<f32>;       // [D] learned scale\n@group(0) @binding(3) var<storage, read> residual: array<f32>;    // pre-sublayer x\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  if (idx >= params.count) { return; }\n\n  let d = idx % params.D;\n  output[idx] = residual[idx] + gamma[d] * input[idx];\n}\n";

const transposeWGSL = "// Transpose [N, D] → [D, N] (or equivalently [D, H, W] from [H*W, D])\n// Used to convert backbone output from token-major to channel-major layout.\n\nstruct Params {\n  rows: u32,  // N (tokens)\n  cols: u32,  // D (dimension)\n  numWorkgroupsX: u32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;   // [rows, cols]\n@group(0) @binding(2) var<storage, read_write> output: array<f32>; // [cols, rows]\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n  let total = params.rows * params.cols;\n\n  if (idx >= total) { return; }\n\n  let row = idx / params.cols;\n  let col = idx % params.cols;\n\n  // input[row, col] → output[col, row]\n  output[col * params.rows + row] = input[row * params.cols + col];\n}\n";

/**
 * backbone.js — DINOv2 ViT-Large backbone dispatch for MoGe-2.
 *
 * Architecture:
 *   1. Patch embedding: image → [N+1, 1024] tokens (14×14 patches + CLS)
 *   2. 24 transformer blocks, each:
 *      a. LayerNorm1 → Attention (QKV → scores → softmax → apply → proj) → LayerScale1 + residual
 *      b. LayerNorm2 → GELU MLP (fc1 → GELU → fc2) → LayerScale2 + residual
 *   3. Extract intermediate features at layers [5, 11, 17, 23]
 *   4. Project each intermediate feature with 1x1 conv and sum
 *
 * Produces: [1024, tokenH, tokenW] feature map + [1024] CLS token
 */


const MAX_WG = 65535;
function splitWG(total) {
  if (total <= MAX_WG) return [total, 1];
  return [MAX_WG, Math.ceil(total / MAX_WG)];
}
function ceilDiv(a, b) { return Math.ceil(a / b); }

function byteView(data) {
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

function makeUniform(device, data) {
  const bytes = byteView(data);
  const buf = device.createBuffer({
    size: Math.max(bytes.byteLength, 16),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint8Array(buf.getMappedRange()).set(bytes);
  buf.unmap();
  return buf;
}

// Cache key from typed array contents
function uniformKey(data) {
  const bytes = byteView(data);
  let h = 0;
  for (let i = 0; i < bytes.length; i++) h = (h * 31 + bytes[i]) | 0;
  return `u_${bytes.length}_${h}`;
}

const bindGroupBufferIds = new WeakMap();
let nextBindGroupBufferId = 1;

function bindGroupBufferId(buffer) {
  let id = bindGroupBufferIds.get(buffer);
  if (!id) {
    id = nextBindGroupBufferId++;
    bindGroupBufferIds.set(buffer, id);
  }
  return id;
}

// DINOv2 ViT-Large config
const VIT_CONFIG = {
  dim: 1024,
  numHeads: 16,
  headDim: 64,
  numLayers: 24,
  patchSize: 14,
  intermediateLayers: [5, 11, 17, 23],
  // Standard GELU MLP (not SwiGLU — verified from checkpoint weights)
  mlpHiddenDim: 4096,
  scale: 1.0 / Math.sqrt(64),
  eps: 1e-6,
};

const VIT_BLOCK_COUNT = VIT_CONFIG.numLayers;

class DINOv2Backbone {
  constructor(device) {
    this.device = device;
    this.pipelines = {};
    this._uniformCache = new Map();
    this._bindGroupCache = new Map();
  }

  init() {
    const device = this.device;
    const make = (code, entry) => device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code }), entryPoint: entry },
    });

    this.pipelines.patchEmbed = make(patchEmbedWGSL, 'main');
    this.pipelines.layerNorm = make(layerNormWGSL, 'main');
    this.pipelines.attnScores = make(attentionWGSL, 'computeScores');
    this.pipelines.attnSoftmax = make(attentionWGSL, 'softmax');
    this.pipelines.attnApply = make(attentionWGSL, 'applyAttn');
    this.pipelines.linear = make(linearWGSL, 'main');
    this.pipelines.linearGelu = make(linearGeluWGSL, 'main');
    this.pipelines.layerScale = make(layerscaleWGSL, 'main');
    this.pipelines.transpose = make(transposeWGSL, 'main');

    // QKV split shader
    const splitModule = device.createShaderModule({
      code: `
        struct P { N: u32, D: u32, numWgX: u32 }
        @group(0) @binding(0) var<uniform> p: P;
        @group(0) @binding(1) var<storage, read> qkv: array<f32>;
        @group(0) @binding(2) var<storage, read_write> q: array<f32>;
        @group(0) @binding(3) var<storage, read_write> k: array<f32>;
        @group(0) @binding(4) var<storage, read_write> v: array<f32>;

        @compute @workgroup_size(256)
        fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
          let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
          if (idx >= p.N * p.D) { return; }
          let row = idx / p.D;
          let col = idx % p.D;
          let D3 = p.D * 3u;
          q[idx] = qkv[row * D3 + col];
          k[idx] = qkv[row * D3 + p.D + col];
          v[idx] = qkv[row * D3 + 2u * p.D + col];
        }
      `,
    });
    this.pipelines.splitQKV = device.createComputePipeline({
      layout: 'auto',
      compute: { module: splitModule, entryPoint: 'main' },
    });

    // Element-wise add shader (for summing intermediate feature projections)
    const addModule = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read_write> dst: array<f32>;
        @group(0) @binding(1) var<storage, read> src: array<f32>;
        struct P { count: u32, numWgX: u32 }
        @group(0) @binding(2) var<uniform> p: P;

        @compute @workgroup_size(256)
        fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
          let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
          if (idx >= p.count) { return; }
          dst[idx] = dst[idx] + src[idx];
        }
      `,
    });
    this.pipelines.add = device.createComputePipeline({
      layout: 'auto',
      compute: { module: addModule, entryPoint: 'main' },
    });
  }

  /**
   * Run the DINOv2 backbone.
   * @param {GPUCommandEncoder} encoder
   * @param {GPUBuffer} imageBuf - [3, imgH, imgW] normalized CHW image
   * @param {Object} weights - encoder weights from weight loader
   * @param {number} tokenH
   * @param {number} tokenW
   * @returns {{ featureBuf: GPUBuffer, clsTokenBuf: GPUBuffer }}
   */
  _ensureWorkBuffers(tokenH, tokenW) {
    if (this._workBufs && this._workTokenH === tokenH && this._workTokenW === tokenW) return;
    const device = this.device;
    const D = VIT_CONFIG.dim;
    const numPatches = tokenH * tokenW;
    const N = numPatches + 1;
    const T = N * D;

    // Destroy old buffers if grid size changed
    if (this._workBufs) {
      for (const buf of Object.values(this._workBufs)) buf.destroy();
      this._bindGroupCache.clear();
    }

    this._workBufs = {
      tokenBufA: createEmptyBuffer(device, T * 4),
      tokenBufB: createEmptyBuffer(device, T * 4),
      normBuf: createEmptyBuffer(device, T * 4),
      qBuf: createEmptyBuffer(device, T * 4),
      kBuf: createEmptyBuffer(device, T * 4),
      vBuf: createEmptyBuffer(device, T * 4),
      scoreBuf: createEmptyBuffer(device, VIT_CONFIG.numHeads * N * N * 4),
      attnOutBuf: createEmptyBuffer(device, T * 4),
      projOutBuf: createEmptyBuffer(device, T * 4),
      hiddenBuf: createEmptyBuffer(device, N * VIT_CONFIG.mlpHiddenDim * 4),
      ffnOutBuf: createEmptyBuffer(device, T * 4),
      qkvWorkBuf: createEmptyBuffer(device, N * 3 * D * 4),
    };
    this._workTokenH = tokenH;
    this._workTokenW = tokenW;
  }

  // Encode segments of a single transformer block: an ordered list of encode
  // closures that together produce exactly the dispatch stream of the original
  // inline block body. ctx.currentTokens is mutated inside the closures, so
  // they must run in order; splitting them across command encoders/submits is
  // legal (all buffers persist) and is how sub-block cooperative chunking
  // keeps each GPU submission under a frame budget.
  _encodeBlockSegments(weights, ctx, l) {
    const device = this.device;
    const { N, T, D, wb } = ctx;
    const { normBuf, qBuf, kBuf, vBuf, scoreBuf, attnOutBuf, projOutBuf, hiddenBuf, ffnOutBuf, qkvWorkBuf, tokenBufA, tokenBufB } = wb;
    return [
      { name: 'norm1-qkv', encode: encoder => {
        this._encodeLayerNorm(encoder, ctx.currentTokens, normBuf, weights, `encoder.backbone.blocks.${l}.norm1`, N);
        this._encodeQKV(encoder, normBuf, qBuf, kBuf, vBuf, weights, l, N, qkvWorkBuf);
      } },
      { name: 'attn-scores', encode: encoder => {
        this._encodeAttnScores(encoder, qBuf, kBuf, scoreBuf, N);
      } },
      { name: 'attn-softmax', encode: encoder => {
        this._encodeAttnSoftmax(encoder, scoreBuf, N);
      } },
      { name: 'attn-apply-proj', encode: encoder => {
        this._encodeAttnApply(encoder, scoreBuf, vBuf, attnOutBuf, N);
        this._encodeLinear(encoder, attnOutBuf, projOutBuf, weights, `encoder.backbone.blocks.${l}.attn.proj`, N, D, D);
        // LayerScale1 + residual: write to the OTHER buffer to avoid read/write race
        const attnResidualOut = (ctx.currentTokens === tokenBufA) ? tokenBufB : tokenBufA;
        this._encodeLayerScaleResidual(encoder, projOutBuf, ctx.currentTokens, attnResidualOut, weights, `encoder.backbone.blocks.${l}.ls1`, T, D);
        ctx.currentTokens = attnResidualOut;
      } },
      { name: 'norm2-fc1', encode: encoder => {
        this._encodeLayerNorm(encoder, ctx.currentTokens, normBuf, weights, `encoder.backbone.blocks.${l}.norm2`, N);
        this._encodeLinearGelu(encoder, normBuf, hiddenBuf, weights, `encoder.backbone.blocks.${l}.mlp.fc1`, N, D, VIT_CONFIG.mlpHiddenDim);
      } },
      { name: 'fc2-residual', encode: encoder => {
        this._encodeLinear(encoder, hiddenBuf, ffnOutBuf, weights, `encoder.backbone.blocks.${l}.mlp.fc2`, N, VIT_CONFIG.mlpHiddenDim, D);
        const ffnResidualOut = (ctx.currentTokens === tokenBufA) ? tokenBufB : tokenBufA;
        this._encodeLayerScaleResidual(encoder, ffnOutBuf, ctx.currentTokens, ffnResidualOut, weights, `encoder.backbone.blocks.${l}.ls2`, T, D);
        ctx.currentTokens = ffnResidualOut;
        if (VIT_CONFIG.intermediateLayers.includes(l)) {
          const snapBuf = createEmptyBuffer(device, T * 4, GPUBufferUsage.COPY_DST);
          encoder.copyBufferToBuffer(ctx.currentTokens, 0, snapBuf, 0, T * 4);
          ctx.intermediateFeatures.push({ buffer: snapBuf, layerIdx: l });
        }
      } },
    ];
  }

  // Encode a single transformer block (monolithic path: all segments into one
  // encoder — identical dispatch stream to the segmented cooperative path).
  _encodeBlock(encoder, weights, ctx, l) {
    for (const segment of this._encodeBlockSegments(weights, ctx, l)) {
      segment.encode(encoder);
    }
  }

  encode(encoder, imageBuf, weights, tokenH, tokenW) {
    const D = VIT_CONFIG.dim;
    const numPatches = tokenH * tokenW;
    const N = numPatches + 1; // +1 for CLS
    const T = N * D; // total token elements

    this._ensureWorkBuffers(tokenH, tokenW);
    const wb = this._workBufs;

    // --- Patch embedding ---
    // tokenBufA is the initial token buffer
    this._encodePatchEmbed(encoder, imageBuf, weights, wb.tokenBufA, tokenH, tokenW);

    // --- Transformer blocks ---
    const ctx = { N, T, D, wb, currentTokens: wb.tokenBufA, intermediateFeatures: [] };
    for (let l = 0; l < VIT_CONFIG.numLayers; l++) {
      this._encodeBlock(encoder, weights, ctx, l);
    }
    return this._encodeProjectionAndCls(encoder, weights, ctx, tokenH, tokenW);
  }

  /**
   * Cooperatively encode the backbone: patch embed + transformer blocks in
   * chunks of `chunkBlocks`, calling `await onChunk(encoder, meta)` after each
   * chunk is encoded. The hook owns submission (and any yielding); this method
   * creates a fresh command encoder for the next chunk. Work buffers persist
   * across submits, so numerics are identical to the monolithic encode().
   */
  async encodeChunked(imageBuf, weights, tokenH, tokenW, { chunkBlocks = 1, splitBlocks = false, onChunk } = {}) {
    const D = VIT_CONFIG.dim;
    const numPatches = tokenH * tokenW;
    const N = numPatches + 1;
    const T = N * D;

    this._ensureWorkBuffers(tokenH, tokenW);
    const wb = this._workBufs;
    const chunk = Math.max(1, Math.floor(chunkBlocks) || 1);

    let encoder = this.device.createCommandEncoder();
    this._encodePatchEmbed(encoder, imageBuf, weights, wb.tokenBufA, tokenH, tokenW);

    const ctx = { N, T, D, wb, currentTokens: wb.tokenBufA, intermediateFeatures: [] };
    if (splitBlocks) {
      // Sub-block granularity: each block's attention/MLP segments become
      // their own submit, keeping single-submission GPU occupancy near a
      // frame budget for shared-device hosts.
      for (let l = 0; l < VIT_CONFIG.numLayers; l++) {
        const segments = this._encodeBlockSegments(weights, ctx, l);
        for (let s = 0; s < segments.length; s++) {
          segments[s].encode(encoder);
          await onChunk(encoder, {
            kind: 'vit-block-segment', block: l, segment: s,
            segmentName: segments[s].name, segmentsPerBlock: segments.length,
            totalBlocks: VIT_CONFIG.numLayers,
          });
          encoder = this.device.createCommandEncoder();
        }
      }
    } else {
      for (let l = 0; l < VIT_CONFIG.numLayers; ) {
        const firstBlock = l;
        const lastBlock = Math.min(l + chunk, VIT_CONFIG.numLayers) - 1;
        for (; l <= lastBlock; l++) this._encodeBlock(encoder, weights, ctx, l);
        await onChunk(encoder, { kind: 'vit-blocks', firstBlock, lastBlock, totalBlocks: VIT_CONFIG.numLayers });
        encoder = this.device.createCommandEncoder();
      }
    }

    const result = this._encodeProjectionAndCls(encoder, weights, ctx, tokenH, tokenW);
    await onChunk(encoder, { kind: 'feature-projection' });
    return result;
  }

  _encodeProjectionAndCls(encoder, weights, ctx, tokenH, tokenW) {
    const device = this.device;
    const { N, T, D, intermediateFeatures, currentTokens } = ctx;
    const numPatches = tokenH * tokenW;

    // --- Project and sum intermediate features ---
    // Each intermediate feature gets a 1x1 conv projection, then all are summed
    const featureBuf = createEmptyBuffer(device, D * numPatches * 4);
    let sumBuf = null;
    let normedClsBuf = null; // Will hold the normed CLS token from the last layer

    for (let i = 0; i < intermediateFeatures.length; i++) {
      const { buffer: snapBuf } = intermediateFeatures[i];

      // Upstream flow (from get_intermediate_layers):
      //   1. Apply backbone final LayerNorm to intermediate block output
      //   2. Strip CLS token → [numPatches, D]
      //   3. Permute → [D, numPatches]
      //   4. Unflatten → [D, tokenH, tokenW]
      //   5. 1x1 conv projection → [D, tokenH, tokenW]
      //
      // Step 0: Apply backbone final norm to snapshot
      const normedBuf = createEmptyBuffer(device, T * 4);
      this._encodeLayerNorm(encoder, snapBuf, normedBuf, weights, 'encoder.backbone.norm', N);

      // Capture normed CLS token from last intermediate layer (for scale head)
      if (i === intermediateFeatures.length - 1) {
        normedClsBuf = normedBuf; // CLS token is at offset 0 (first D floats)
      }

      // Step 1: Linear projection on [numPatches, D] → [numPatches, D] (skip CLS via offset)
      const projBuf = createEmptyBuffer(device, D * numPatches * 4);
      this._encodeOutputProjection(encoder, normedBuf, projBuf, weights, i, N, numPatches);

      // Step 2: Transpose [numPatches, D] → [D, numPatches] (= [D, tokenH, tokenW] in CHW)
      const transposedBuf = createEmptyBuffer(device, D * numPatches * 4);
      this._encodeTranspose(encoder, projBuf, transposedBuf, numPatches, D);

      if (sumBuf === null) {
        sumBuf = transposedBuf;
      } else {
        this._encodeAdd(encoder, sumBuf, transposedBuf, D * numPatches);
      }
    }

    // Don't submit here — caller is responsible for submitting the encoder.
    // Return debug buffers for post-submit readback.
    return {
      featureBuf: sumBuf || featureBuf,
      clsTokenBuf: normedClsBuf || currentTokens,
      tokenH,
      tokenW,
      _debugSnaps: intermediateFeatures,
    };
  }

  _cachedUniform(data) {
    const key = uniformKey(data);
    if (this._uniformCache.has(key)) return this._uniformCache.get(key);
    const buf = makeUniform(this.device, data);
    this._uniformCache.set(key, buf);
    return buf;
  }

  _cachedBindGroup(tag, layout, entries) {
    // Build cache key from tag + all resource identity/range metadata.
    let key = tag;
    for (const e of entries) {
      const r = e.resource;
      const buf = r.buffer;
      key += `|b${e.binding}:${bindGroupBufferId(buf)}@${r.offset || 0}+${r.size || 'all'}`;
    }
    if (this._bindGroupCache.has(key)) return this._bindGroupCache.get(key);
    const bg = this.device.createBindGroup({ layout, entries });
    this._bindGroupCache.set(key, bg);
    return bg;
  }

  // --- Private dispatch methods ---

  _encodePatchEmbed(encoder, imageBuf, weights, outputBuf, tokenH, tokenW) {
    const device = this.device;
    const D = VIT_CONFIG.dim;
    const ps = VIT_CONFIG.patchSize;
    const numTokens = tokenH * tokenW + 1;
    const totalWG = ceilDiv(numTokens * D, 256);
    const [wgX, wgY] = splitWG(totalWG);

    const paramsData = new Uint32Array([tokenH * ps, tokenW * ps, ps, tokenH, tokenW, 3, D, numTokens, wgX]);
    const paramsBuf = this._cachedUniform(paramsData);

    const bg = device.createBindGroup({
      layout: this.pipelines.patchEmbed.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuf } },
        { binding: 1, resource: { buffer: imageBuf } },
        { binding: 2, resource: { buffer: weights.encoder.patchEmbed.weight } },
        { binding: 3, resource: { buffer: weights.encoder.patchEmbed.bias } },
        { binding: 4, resource: { buffer: weights.encoder.clsToken } },
        { binding: 5, resource: { buffer: weights.encoder.posEmbed } },
        { binding: 6, resource: { buffer: outputBuf } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.patchEmbed);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _encodeLayerNorm(enc, input, output, weights, prefix, N) {
    this.device;
    const D = VIT_CONFIG.dim;

    const paramsData = new ArrayBuffer(16);
    const v = new DataView(paramsData);
    v.setUint32(0, N, true);
    v.setUint32(4, D, true);
    v.setFloat32(8, VIT_CONFIG.eps, true);
    const paramsBuf = this._cachedUniform(new Uint8Array(paramsData));

    const gammaKey = `${prefix}.weight`;
    const betaKey = `${prefix}.bias`;
    let gamma = weights.encoder.blockWeights?.[gammaKey];
    let beta = weights.encoder.blockWeights?.[betaKey];
    if (!gamma && prefix === 'encoder.backbone.norm') {
      gamma = weights.encoder.norm?.weight;
      beta = weights.encoder.norm?.bias;
    }
    if (!gamma || !beta) { console.warn(`Missing LayerNorm weights: ${prefix}`); return; }

    const bg = this._cachedBindGroup(`ln_${prefix}`, this.pipelines.layerNorm.getBindGroupLayout(0), [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: gamma } },
      { binding: 3, resource: { buffer: beta } },
      { binding: 4, resource: { buffer: output } },
    ]);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipelines.layerNorm);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(N);
    pass.end();
  }

  _encodeQKV(enc, input, qBuf, kBuf, vBuf, weights, layerIdx, N, qkvWorkBuf) {
    this.device;
    const D = VIT_CONFIG.dim;
    const D3 = 3 * D;
    const prefix = `encoder.backbone.blocks.${layerIdx}.attn.qkv`;
    const qkvWeight = weights.encoder.blockWeights?.[`${prefix}.weight`];
    const qkvBias = weights.encoder.blockWeights?.[`${prefix}.bias`];

    if (!qkvWeight || !qkvBias) {
      console.warn(`Missing QKV weights for layer ${layerIdx}`);
      return;
    }

    // Project to [N, 3*D] with one linear call, then split Q/K/V
    this._encodeLinearFull(enc, input, qkvWorkBuf, qkvWeight, qkvBias, N, D, D3);

    // Split [N, 3*D] → Q [N, D], K [N, D], V [N, D]
    this._encodeSplitQKV(enc, qkvWorkBuf, qBuf, kBuf, vBuf, N, D);
  }

  _encodeLinearFull(enc, input, output, weight, bias, numRows, inDim, outDim) {
    this.device;
    const totalWG = ceilDiv(numRows * outDim, 256);
    const [wgX, wgY] = splitWG(totalWG);

    const paramsData = new Uint32Array([numRows, inDim, outDim, wgX]);
    const paramsBuf = this._cachedUniform(paramsData);

    const entries = [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: weight } },
      { binding: 3, resource: { buffer: bias } },
      { binding: 4, resource: { buffer: output } },
    ];
    const bg = this._cachedBindGroup('linFull', this.pipelines.linear.getBindGroupLayout(0), entries);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipelines.linear);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _encodeSplitQKV(enc, qkvBuf, qBuf, kBuf, vBuf, N, D) {
    this.device;
    const total = N * D;
    const totalWG = ceilDiv(total, 256);
    const [wgX, wgY] = splitWG(totalWG);

    const paramsBuf = this._cachedUniform(new Uint32Array([N, D, wgX]));

    const bg = this._cachedBindGroup('splitQKV', this.pipelines.splitQKV.getBindGroupLayout(0), [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: qkvBuf } },
      { binding: 2, resource: { buffer: qBuf } },
      { binding: 3, resource: { buffer: kBuf } },
      { binding: 4, resource: { buffer: vBuf } },
    ]);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipelines.splitQKV);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _encodeLinear(enc, input, output, weights, prefix, numRows, inDim, outDim) {
    this.device;
    const totalWG = ceilDiv(numRows * outDim, 256);
    const [wgX, wgY] = splitWG(totalWG);

    const paramsData = new Uint32Array([numRows, inDim, outDim, wgX]);
    const paramsBuf = this._cachedUniform(paramsData);

    const weight = weights.encoder.blockWeights?.[`${prefix}.weight`];
    const bias = weights.encoder.blockWeights?.[`${prefix}.bias`];

    if (!weight || !bias) {
      console.warn(`Missing linear weights: ${prefix}`);
      return;
    }

    const bg = this._cachedBindGroup('lin', this.pipelines.linear.getBindGroupLayout(0), [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: weight } },
      { binding: 3, resource: { buffer: bias } },
      { binding: 4, resource: { buffer: output } },
    ]);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipelines.linear);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _encodeLinearWithOffsets(enc, input, weight, wOffset, wSize, bias, bOffset, bSize, output, numRows, inDim, outDim) {
    this.device;
    const totalWG = ceilDiv(numRows * outDim, 256);
    const [wgX, wgY] = splitWG(totalWG);

    const paramsData = new Uint32Array([numRows, inDim, outDim, wgX]);
    const paramsBuf = this._cachedUniform(paramsData);

    const bg = this._cachedBindGroup('linOff', this.pipelines.linear.getBindGroupLayout(0), [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: weight, offset: wOffset, size: wSize } },
      { binding: 3, resource: { buffer: bias, offset: bOffset, size: bSize } },
      { binding: 4, resource: { buffer: output } },
    ]);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipelines.linear);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _encodeAttnScores(enc, qBuf, kBuf, scoreBuf, N) {
    this.device;
    const { numHeads, dim, headDim, scale } = VIT_CONFIG;
    const total = numHeads * N * N;
    const totalWG = ceilDiv(total, 256);
    const [wgX, wgY] = splitWG(totalWG);

    const paramsData = new ArrayBuffer(24);
    const v = new DataView(paramsData);
    v.setUint32(0, N, true);
    v.setUint32(4, dim, true);
    v.setUint32(8, numHeads, true);
    v.setUint32(12, headDim, true);
    v.setFloat32(16, scale, true);
    v.setUint32(20, wgX, true);
    const paramsBuf = this._cachedUniform(new Uint8Array(paramsData));

    const bg = this._cachedBindGroup('attnS', this.pipelines.attnScores.getBindGroupLayout(0), [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: qBuf } },
      { binding: 2, resource: { buffer: kBuf } },
      { binding: 3, resource: { buffer: scoreBuf } },
    ]);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipelines.attnScores);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _encodeAttnSoftmax(enc, scoreBuf, N) {
    this.device;
    const totalRows = VIT_CONFIG.numHeads * N;
    const totalWG = ceilDiv(totalRows, 256);
    const [wgX, wgY] = splitWG(totalWG);

    const paramsData = new Uint32Array([N, VIT_CONFIG.numHeads, wgX]);
    const paramsBuf = this._cachedUniform(paramsData);

    const bg = this._cachedBindGroup('smx', this.pipelines.attnSoftmax.getBindGroupLayout(0), [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: scoreBuf } },
    ]);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipelines.attnSoftmax);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _encodeAttnApply(enc, scoreBuf, vBuf, output, N) {
    this.device;
    const D = VIT_CONFIG.dim;
    const totalWG = ceilDiv(N * D, 256);
    const [wgX, wgY] = splitWG(totalWG);

    const paramsData = new Uint32Array([N, D, VIT_CONFIG.numHeads, VIT_CONFIG.headDim, wgX]);
    const paramsBuf = this._cachedUniform(paramsData);

    const bg = this._cachedBindGroup('attnA', this.pipelines.attnApply.getBindGroupLayout(0), [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: scoreBuf } },
      { binding: 2, resource: { buffer: vBuf } },
      { binding: 3, resource: { buffer: output } },
    ]);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipelines.attnApply);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _encodeLayerScaleResidual(enc, input, residual, output, weights, prefix, count, D) {
    this.device;
    const totalWG = ceilDiv(count, 256);
    const [wgX, wgY] = splitWG(totalWG);

    const paramsData = new Uint32Array([count, D, wgX]);
    const paramsBuf = this._cachedUniform(paramsData);

    const gamma = weights.encoder.blockWeights?.[`${prefix}.gamma`];
    if (!gamma) { console.warn(`Missing LayerScale gamma: ${prefix}`); return; }

    const bg = this._cachedBindGroup('ls', this.pipelines.layerScale.getBindGroupLayout(0), [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: gamma } },
      { binding: 3, resource: { buffer: residual } },
      { binding: 4, resource: { buffer: output } },
    ]);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipelines.layerScale);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _encodeLinearGelu(enc, input, output, weights, prefix, numRows, inDim, outDim) {
    this.device;
    const totalWG = ceilDiv(numRows * outDim, 256);
    const [wgX, wgY] = splitWG(totalWG);

    const paramsData = new Uint32Array([numRows, inDim, outDim, wgX]);
    const paramsBuf = this._cachedUniform(paramsData);

    const weight = weights.encoder.blockWeights?.[`${prefix}.weight`];
    const bias = weights.encoder.blockWeights?.[`${prefix}.bias`];
    if (!weight || !bias) { console.warn(`Missing linear+GELU weights: ${prefix}`); return; }

    const bg = this._cachedBindGroup('linG', this.pipelines.linearGelu.getBindGroupLayout(0), [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: weight } },
      { binding: 3, resource: { buffer: bias } },
      { binding: 4, resource: { buffer: output } },
    ]);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipelines.linearGelu);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _encodeOutputProjection(enc, tokensBuf, outputBuf, weights, projIdx, N, numPatches) {
    // Extract patch tokens (skip CLS), reshape to CHW, and project with 1x1 conv
    // This is a simplified version — the upstream code does permute + unflatten + conv
    // For now, we treat it as a linear: [numPatches, D] → [numPatches, D]
    // using the output_projections weight
    this.device;
    const D = VIT_CONFIG.dim;
    const totalWG = ceilDiv(numPatches * D, 256);
    const [wgX, wgY] = splitWG(totalWG);

    const paramsData = new Uint32Array([numPatches, D, D, wgX]);
    const paramsBuf = this._cachedUniform(paramsData);

    const proj = weights.encoder.outputProjections[projIdx];

    const bg = this._cachedBindGroup(`outProj${projIdx}`, this.pipelines.linear.getBindGroupLayout(0), [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: tokensBuf, offset: D * 4, size: numPatches * D * 4 } },
      { binding: 2, resource: { buffer: proj.weight } },
      { binding: 3, resource: { buffer: proj.bias } },
      { binding: 4, resource: { buffer: outputBuf } },
    ]);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipelines.linear);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _encodeTranspose(enc, input, output, rows, cols) {
    this.device;
    const total = rows * cols;
    const totalWG = ceilDiv(total, 256);
    const [wgX, wgY] = splitWG(totalWG);

    const paramsData = new Uint32Array([rows, cols, wgX]);
    const paramsBuf = this._cachedUniform(paramsData);

    const bg = this._cachedBindGroup('trans', this.pipelines.transpose.getBindGroupLayout(0), [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: output } },
    ]);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipelines.transpose);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  /**
   * Run layer-by-layer comparison against PyTorch reference tensors.
   * Call from browser console: await window.__mogeInference.backbone.debugCompare(...)
   */
  async debugCompare(imageBuf, weights, tokenH, tokenW) {
    const device = this.device;
    const D = VIT_CONFIG.dim;
    const numPatches = tokenH * tokenW;
    const N = numPatches + 1;
    const T = N * D;

    // Load reference manifest
    const manifestResp = await fetch('/layer_dumps/manifest.json');
    const manifest = await manifestResp.json();

    async function loadRef(name) {
      const info = manifest[name];
      if (!info) { console.warn(`No reference for ${name}`); return null; }
      const resp = await fetch(`/layer_dumps/${info.file}`);
      return new Float32Array(await resp.arrayBuffer());
    }

    const results = {};

    function compareArrays(label, gpu, ref) {
      if (!ref) { console.log(`  ${label}: no reference`); return null; }
      const n = Math.min(gpu.length, ref.length);
      let maxErr = 0, sumErr = 0, sumSq = 0;
      let gpuMin = Infinity, gpuMax = -Infinity, refMin = Infinity, refMax = -Infinity;
      let gpuSum = 0, refSum = 0, gpuSqSum = 0, refSqSum = 0;
      let worstIdx = 0, nanCount = 0, infCount = 0;
      let firstNanIdx = -1;
      for (let i = 0; i < n; i++) {
        if (isNaN(gpu[i])) { nanCount++; if (firstNanIdx < 0) firstNanIdx = i; continue; }
        if (!isFinite(gpu[i])) { infCount++; continue; }
        const err = Math.abs(gpu[i] - ref[i]);
        sumErr += err;
        sumSq += err * err;
        if (err > maxErr) { maxErr = err; worstIdx = i; }
        if (gpu[i] < gpuMin) gpuMin = gpu[i];
        if (gpu[i] > gpuMax) gpuMax = gpu[i];
        if (ref[i] < refMin) refMin = ref[i];
        if (ref[i] > refMax) refMax = ref[i];
        gpuSum += gpu[i]; refSum += ref[i];
        gpuSqSum += gpu[i] * gpu[i]; refSqSum += ref[i] * ref[i];
      }
      const finiteN = n - nanCount - infCount;
      const gpuMean = gpuSum / finiteN, refMean = refSum / finiteN;
      const gpuStd = Math.sqrt(Math.max(0, gpuSqSum / finiteN - gpuMean * gpuMean));
      const refStd = Math.sqrt(Math.max(0, refSqSum / finiteN - refMean * refMean));
      const meanErr = sumErr / finiteN;
      const rmsErr = Math.sqrt(sumSq / finiteN);
      const relStd = refStd > 0 ? gpuStd / refStd : NaN;
      const worstRow = Math.floor(worstIdx / D);
      const worstCol = worstIdx % D;

      const result = {
        label, maxErr, meanErr, rmsErr, relStd,
        gpu: { min: gpuMin, max: gpuMax, mean: gpuMean, std: gpuStd },
        ref: { min: refMin, max: refMax, mean: refMean, std: refStd },
        worstIdx, worstRow, worstCol,
        worstGpu: gpu[worstIdx], worstRef: ref[worstIdx],
      };
      results[label] = result;

      const nanStr = nanCount > 0 ? ` NaN=${nanCount}${firstNanIdx >= 0 ? `@${firstNanIdx}` : ''}` : '';
      const infStr = infCount > 0 ? ` Inf=${infCount}` : '';
      console.log(`  ${label}: maxErr=${maxErr.toFixed(4)} rmsErr=${rmsErr.toFixed(4)} relStd=${relStd.toFixed(4)} | GPU std=${gpuStd.toFixed(4)} REF std=${refStd.toFixed(4)} | worst@[${worstRow},${worstCol}] gpu=${gpu[worstIdx]?.toFixed(4)} ref=${ref[worstIdx]?.toFixed(4)}${nanStr}${infStr}`);
      return result;
    }

    console.log('\n=== BACKBONE COMPARISON ===\n');

    // --- Stage 1: Patch embedding ---
    {
      const tokenBuf = createEmptyBuffer(device, T * 4);
      const enc = device.createCommandEncoder();
      this._encodePatchEmbed(enc, imageBuf, weights, tokenBuf, tokenH, tokenW);
      device.queue.submit([enc.finish()]);
      const gpu = await readBuffer(device, tokenBuf, T * 4);
      const ref = await loadRef('tokens_after_pos_embed');
      compareArrays('patch_embed', gpu, ref);
      tokenBuf.destroy();
    }

    // --- Stage 2: Run blocks, compare at checkpoints ---
    const checkpoints = [0, 1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 16, 17, 23];
    let tokenBufA = createEmptyBuffer(device, T * 4);
    let tokenBufB = createEmptyBuffer(device, T * 4);
    {
      const enc = device.createCommandEncoder();
      this._encodePatchEmbed(enc, imageBuf, weights, tokenBufA, tokenH, tokenW);
      device.queue.submit([enc.finish()]);
    }
    let currentTokens = tokenBufA;

    const normBuf = createEmptyBuffer(device, T * 4);
    const qBuf = createEmptyBuffer(device, T * 4);
    const kBuf = createEmptyBuffer(device, T * 4);
    const vBuf = createEmptyBuffer(device, T * 4);
    const scoreBuf = createEmptyBuffer(device, VIT_CONFIG.numHeads * N * N * 4);
    const attnOutBuf = createEmptyBuffer(device, T * 4);
    const projOutBuf = createEmptyBuffer(device, T * 4);
    const hiddenBuf = createEmptyBuffer(device, N * VIT_CONFIG.mlpHiddenDim * 4);
    const ffnOutBuf = createEmptyBuffer(device, T * 4);
    const qkvWorkBuf = createEmptyBuffer(device, N * 3 * D * 4);

    const DO_BLOCK0_SUBSTEPS = true;
    for (let l = 0; l < VIT_CONFIG.numLayers; l++) {
      // For block 0, run sub-steps individually and compare each
      if (l === 0 && DO_BLOCK0_SUBSTEPS) {
        console.log('\n--- Block 0 sub-steps ---');

        // norm1
        let enc = device.createCommandEncoder();
        this._encodeLayerNorm(enc, currentTokens, normBuf, weights, `encoder.backbone.blocks.0.norm1`, N);
        device.queue.submit([enc.finish()]);
        const norm1Gpu = await readBuffer(device, normBuf, T * 4);
        const norm1Ref = await loadRef('block_0_norm1');
        compareArrays('b0_norm1', norm1Gpu, norm1Ref);

        // QKV
        enc = device.createCommandEncoder();
        this._encodeQKV(enc, normBuf, qBuf, kBuf, vBuf, weights, 0, N, qkvWorkBuf);
        device.queue.submit([enc.finish()]);
        const qGpu = await readBuffer(device, qBuf, T * 4);
        const kGpu = await readBuffer(device, kBuf, T * 4);
        const vGpu = await readBuffer(device, vBuf, T * 4);
        // QKV ref is [N, 3*D] — split into Q, K, V
        const qkvRef = await loadRef('block_0_qkv');
        if (qkvRef) {
          const qRef = new Float32Array(N * D);
          const kRef = new Float32Array(N * D);
          const vRef = new Float32Array(N * D);
          for (let i = 0; i < N; i++) {
            for (let d = 0; d < D; d++) {
              qRef[i * D + d] = qkvRef[i * 3 * D + d];
              kRef[i * D + d] = qkvRef[i * 3 * D + D + d];
              vRef[i * D + d] = qkvRef[i * 3 * D + 2 * D + d];
            }
          }
          compareArrays('b0_Q', qGpu, qRef);
          compareArrays('b0_K', kGpu, kRef);
          compareArrays('b0_V', vGpu, vRef);
        }

        // Attention scores + softmax + apply
        enc = device.createCommandEncoder();
        this._encodeAttnScores(enc, qBuf, kBuf, scoreBuf, N);
        this._encodeAttnSoftmax(enc, scoreBuf, N);
        this._encodeAttnApply(enc, scoreBuf, vBuf, attnOutBuf, N);
        device.queue.submit([enc.finish()]);

        // Attn output projection
        enc = device.createCommandEncoder();
        this._encodeLinear(enc, attnOutBuf, projOutBuf, weights, `encoder.backbone.blocks.0.attn.proj`, N, D, D);
        device.queue.submit([enc.finish()]);
        const projGpu = await readBuffer(device, projOutBuf, T * 4);
        const attnRef = await loadRef('block_0_attn_out');
        compareArrays('b0_attn_proj', projGpu, attnRef);

        // LayerScale1 + residual
        enc = device.createCommandEncoder();
        const attnResidualOut = (currentTokens === tokenBufA) ? tokenBufB : tokenBufA;
        this._encodeLayerScaleResidual(enc, projOutBuf, currentTokens, attnResidualOut, weights, `encoder.backbone.blocks.0.ls1`, T, D);
        device.queue.submit([enc.finish()]);
        currentTokens = attnResidualOut;
        const ls1Gpu = await readBuffer(device, currentTokens, T * 4);
        const ls1Ref = await loadRef('block_0_after_ls1');
        compareArrays('b0_after_ls1', ls1Gpu, ls1Ref);

        // norm2
        enc = device.createCommandEncoder();
        this._encodeLayerNorm(enc, currentTokens, normBuf, weights, `encoder.backbone.blocks.0.norm2`, N);
        device.queue.submit([enc.finish()]);
        const norm2Gpu = await readBuffer(device, normBuf, T * 4);
        const norm2Ref = await loadRef('block_0_norm2');
        compareArrays('b0_norm2', norm2Gpu, norm2Ref);

        // MLP fc1 (linear + GELU)
        enc = device.createCommandEncoder();
        this._encodeLinearGelu(enc, normBuf, hiddenBuf, weights, `encoder.backbone.blocks.0.mlp.fc1`, N, D, VIT_CONFIG.mlpHiddenDim);
        device.queue.submit([enc.finish()]);
        const fc1Gpu = await readBuffer(device, hiddenBuf, N * VIT_CONFIG.mlpHiddenDim * 4);
        // Compare against post-GELU reference (our shader fuses linear+GELU)
        const fc1Ref = await loadRef('block_0_fc1_post_gelu');
        compareArrays('b0_fc1_gelu', fc1Gpu, fc1Ref);

        // MLP fc2 (linear)
        enc = device.createCommandEncoder();
        this._encodeLinear(enc, hiddenBuf, ffnOutBuf, weights, `encoder.backbone.blocks.0.mlp.fc2`, N, VIT_CONFIG.mlpHiddenDim, D);
        device.queue.submit([enc.finish()]);
        const fc2Gpu = await readBuffer(device, ffnOutBuf, T * 4);
        const mlpRef = await loadRef('block_0_mlp_out');
        compareArrays('b0_mlp_out', fc2Gpu, mlpRef);

        // LayerScale2 + residual → final block 0 output
        enc = device.createCommandEncoder();
        const ffnResidualOut = (currentTokens === tokenBufA) ? tokenBufB : tokenBufA;
        this._encodeLayerScaleResidual(enc, ffnOutBuf, currentTokens, ffnResidualOut, weights, `encoder.backbone.blocks.0.ls2`, T, D);
        device.queue.submit([enc.finish()]);
        currentTokens = ffnResidualOut;

        const b0Gpu = await readBuffer(device, currentTokens, T * 4);
        const b0Ref = await loadRef('block_0_output');
        compareArrays('block_0', b0Gpu, b0Ref);
        continue;
      }

      // All other blocks: run as a batch
      const enc = device.createCommandEncoder();

      this._encodeLayerNorm(enc, currentTokens, normBuf, weights, `encoder.backbone.blocks.${l}.norm1`, N);
      this._encodeQKV(enc, normBuf, qBuf, kBuf, vBuf, weights, l, N, qkvWorkBuf);
      this._encodeAttnScores(enc, qBuf, kBuf, scoreBuf, N);
      this._encodeAttnSoftmax(enc, scoreBuf, N);
      this._encodeAttnApply(enc, scoreBuf, vBuf, attnOutBuf, N);
      this._encodeLinear(enc, attnOutBuf, projOutBuf, weights, `encoder.backbone.blocks.${l}.attn.proj`, N, D, D);

      const attnResidualOut = (currentTokens === tokenBufA) ? tokenBufB : tokenBufA;
      this._encodeLayerScaleResidual(enc, projOutBuf, currentTokens, attnResidualOut, weights, `encoder.backbone.blocks.${l}.ls1`, T, D);
      currentTokens = attnResidualOut;

      this._encodeLayerNorm(enc, currentTokens, normBuf, weights, `encoder.backbone.blocks.${l}.norm2`, N);
      this._encodeLinearGelu(enc, normBuf, hiddenBuf, weights, `encoder.backbone.blocks.${l}.mlp.fc1`, N, D, VIT_CONFIG.mlpHiddenDim);
      this._encodeLinear(enc, hiddenBuf, ffnOutBuf, weights, `encoder.backbone.blocks.${l}.mlp.fc2`, N, VIT_CONFIG.mlpHiddenDim, D);

      const ffnResidualOut = (currentTokens === tokenBufA) ? tokenBufB : tokenBufA;
      this._encodeLayerScaleResidual(enc, ffnOutBuf, currentTokens, ffnResidualOut, weights, `encoder.backbone.blocks.${l}.ls2`, T, D);
      currentTokens = ffnResidualOut;

      device.queue.submit([enc.finish()]);

      if (checkpoints.includes(l)) {
        const gpu = await readBuffer(device, currentTokens, T * 4);
        const ref = await loadRef(`block_${l}_output`);
        if (ref) {
          compareArrays(`block_${l}`, gpu, ref);
        } else {
          let gMin = Infinity, gMax = -Infinity, gSum = 0, gSqSum = 0;
          for (let i = 0; i < gpu.length; i++) {
            if (gpu[i] < gMin) gMin = gpu[i];
            if (gpu[i] > gMax) gMax = gpu[i];
            gSum += gpu[i]; gSqSum += gpu[i] * gpu[i];
          }
          const gMean = gSum / gpu.length;
          const gStd = Math.sqrt(Math.max(0, gSqSum / gpu.length - gMean * gMean));
          console.log(`  block_${l}: GPU only | [${gMin.toFixed(4)}, ${gMax.toFixed(4)}] std=${gStd.toFixed(4)} (no ref dump)`);
          results[`block_${l}`] = { label: `block_${l}`, gpu: { min: gMin, max: gMax, mean: gMean, std: gStd } };
        }
      }
    }

    normBuf.destroy(); qBuf.destroy(); kBuf.destroy(); vBuf.destroy();
    scoreBuf.destroy(); attnOutBuf.destroy(); projOutBuf.destroy();
    hiddenBuf.destroy(); ffnOutBuf.destroy();
    tokenBufA.destroy(); tokenBufB.destroy();

    console.log('\n=== COMPARISON COMPLETE ===');
    window.__backboneCompareResults = results;
    return results;
  }

  /**
   * Detailed sub-block comparison for a single transformer block.
   * Runs block l step-by-step and compares each intermediate against PyTorch.
   * Requires PyTorch sub-block dumps (block_X_norm1, block_X_attn_qkv, etc.)
   * For now, compares within WebGPU at block 0 to isolate the divergence stage.
   */
  async debugBlock0(imageBuf, weights, tokenH, tokenW) {
    const device = this.device;
    const D = VIT_CONFIG.dim;
    const numPatches = tokenH * tokenW;
    const N = numPatches + 1;
    const T = N * D;
    const l = 0;

    function stats(label, arr, refArr) {
      let min = Infinity, max = -Infinity, sum = 0, sqSum = 0;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] < min) min = arr[i];
        if (arr[i] > max) max = arr[i];
        sum += arr[i]; sqSum += arr[i] * arr[i];
      }
      const mean = sum / arr.length;
      const std = Math.sqrt(sqSum / arr.length - mean * mean);
      let errStr = '';
      console.log(`  ${label}: [${min.toFixed(4)}, ${max.toFixed(4)}] mean=${mean.toFixed(6)} std=${std.toFixed(6)}${errStr}`);
    }

    // Initialize from patch embed
    let tokenBufA = createEmptyBuffer(device, T * 4);
    let tokenBufB = createEmptyBuffer(device, T * 4);
    {
      const enc = device.createCommandEncoder();
      this._encodePatchEmbed(enc, imageBuf, weights, tokenBufA, tokenH, tokenW);
      device.queue.submit([enc.finish()]);
    }
    let currentTokens = tokenBufA;

    const normBuf = createEmptyBuffer(device, T * 4);
    const qBuf = createEmptyBuffer(device, T * 4);
    const kBuf = createEmptyBuffer(device, T * 4);
    const vBuf = createEmptyBuffer(device, T * 4);
    const scoreBuf = createEmptyBuffer(device, VIT_CONFIG.numHeads * N * N * 4);
    const attnOutBuf = createEmptyBuffer(device, T * 4);
    const projOutBuf = createEmptyBuffer(device, T * 4);
    const hiddenBuf = createEmptyBuffer(device, N * VIT_CONFIG.mlpHiddenDim * 4);
    const ffnOutBuf = createEmptyBuffer(device, T * 4);
    const qkvWorkBuf = createEmptyBuffer(device, N * 3 * D * 4);

    console.log('\n=== BLOCK 0 SUB-STEP COMPARISON ===\n');

    // Step 1: LayerNorm1
    {
      const enc = device.createCommandEncoder();
      this._encodeLayerNorm(enc, currentTokens, normBuf, weights, `encoder.backbone.blocks.${l}.norm1`, N);
      device.queue.submit([enc.finish()]);
      const norm1 = await readBuffer(device, normBuf, T * 4);
      stats('norm1_output', norm1);
      // Check dim 538 specifically across a few tokens
      console.log(`    dim538 samples: token0=${norm1[0*D+538]?.toFixed(6)}, token276=${norm1[276*D+538]?.toFixed(6)}`);
    }

    // Step 2: QKV
    {
      const enc = device.createCommandEncoder();
      this._encodeQKV(enc, normBuf, qBuf, kBuf, vBuf, weights, l, N, qkvWorkBuf);
      device.queue.submit([enc.finish()]);
      const q = await readBuffer(device, qBuf, T * 4);
      const k = await readBuffer(device, kBuf, T * 4);
      const v = await readBuffer(device, vBuf, T * 4);
      stats('Q', q);
      stats('K', k);
      stats('V', v);
      // Check dim 538 = head 8, offset 26
      console.log(`    Q dim538: token0=${q[538]?.toFixed(6)}, token276=${q[276*D+538]?.toFixed(6)}`);
      console.log(`    K dim538: token0=${k[538]?.toFixed(6)}, token276=${k[276*D+538]?.toFixed(6)}`);
      console.log(`    V dim538: token0=${v[538]?.toFixed(6)}, token276=${v[276*D+538]?.toFixed(6)}`);
    }

    // Step 3: Attention scores (just stats, huge tensor)
    {
      const enc = device.createCommandEncoder();
      this._encodeAttnScores(enc, qBuf, kBuf, scoreBuf, N);
      device.queue.submit([enc.finish()]);
      const scores = await readBuffer(device, scoreBuf, VIT_CONFIG.numHeads * N * N * 4);
      // Just check head 8 scores for token 276
      const headBase = 8 * N * N;
      const rowBase = headBase + 276 * N;
      let sMin = Infinity, sMax = -Infinity;
      for (let j = 0; j < N; j++) {
        if (scores[rowBase + j] < sMin) sMin = scores[rowBase + j];
        if (scores[rowBase + j] > sMax) sMax = scores[rowBase + j];
      }
      console.log(`  attn_scores head8 token276: [${sMin.toFixed(4)}, ${sMax.toFixed(4)}]`);
    }

    // Step 4: Softmax
    {
      const enc = device.createCommandEncoder();
      this._encodeAttnSoftmax(enc, scoreBuf, N);
      device.queue.submit([enc.finish()]);
      const softmax = await readBuffer(device, scoreBuf, VIT_CONFIG.numHeads * N * N * 4);
      const headBase = 8 * N * N;
      const rowBase = headBase + 276 * N;
      let sSum = 0, sMax = -Infinity;
      for (let j = 0; j < N; j++) {
        sSum += softmax[rowBase + j];
        if (softmax[rowBase + j] > sMax) sMax = softmax[rowBase + j];
      }
      console.log(`  softmax head8 token276: sum=${sSum.toFixed(6)}, max=${sMax.toFixed(6)}`);
    }

    // Step 5: Apply attention
    {
      const enc = device.createCommandEncoder();
      this._encodeAttnApply(enc, scoreBuf, vBuf, attnOutBuf, N);
      device.queue.submit([enc.finish()]);
      const attnOut = await readBuffer(device, attnOutBuf, T * 4);
      stats('attn_apply_output', attnOut);
      console.log(`    attn_out dim538: token276=${attnOut[276*D+538]?.toFixed(6)}`);
    }

    // Step 6: Output projection
    {
      const enc = device.createCommandEncoder();
      this._encodeLinear(enc, attnOutBuf, projOutBuf, weights, `encoder.backbone.blocks.${l}.attn.proj`, N, D, D);
      device.queue.submit([enc.finish()]);
      const proj = await readBuffer(device, projOutBuf, T * 4);
      stats('proj_output', proj);
      console.log(`    proj dim538: token276=${proj[276*D+538]?.toFixed(6)}`);
    }

    // Step 7: LayerScale1 + residual
    {
      const enc = device.createCommandEncoder();
      const outBuf = (currentTokens === tokenBufA) ? tokenBufB : tokenBufA;
      this._encodeLayerScaleResidual(enc, projOutBuf, currentTokens, outBuf, weights, `encoder.backbone.blocks.${l}.ls1`, T, D);
      device.queue.submit([enc.finish()]);
      const ls1 = await readBuffer(device, outBuf, T * 4);
      stats('after_ls1_residual', ls1);
      console.log(`    ls1_res dim538: token276=${ls1[276*D+538]?.toFixed(6)}`);
      currentTokens = outBuf;
    }

    // Step 8: LayerNorm2
    {
      const enc = device.createCommandEncoder();
      this._encodeLayerNorm(enc, currentTokens, normBuf, weights, `encoder.backbone.blocks.${l}.norm2`, N);
      device.queue.submit([enc.finish()]);
      const norm2 = await readBuffer(device, normBuf, T * 4);
      stats('norm2_output', norm2);
    }

    // Step 9: MLP fc1 (linear + GELU)
    {
      const enc = device.createCommandEncoder();
      this._encodeLinearGelu(enc, normBuf, hiddenBuf, weights, `encoder.backbone.blocks.${l}.mlp.fc1`, N, D, VIT_CONFIG.mlpHiddenDim);
      device.queue.submit([enc.finish()]);
      const fc1 = await readBuffer(device, hiddenBuf, N * VIT_CONFIG.mlpHiddenDim * 4);
      let fMin = Infinity, fMax = -Infinity, fSum = 0, fSqSum = 0;
      for (let i = 0; i < fc1.length; i++) {
        if (fc1[i] < fMin) fMin = fc1[i];
        if (fc1[i] > fMax) fMax = fc1[i];
        fSum += fc1[i]; fSqSum += fc1[i] * fc1[i];
      }
      const fMean = fSum / fc1.length, fStd = Math.sqrt(fSqSum / fc1.length - fMean * fMean);
      console.log(`  fc1_output (GELU): [${fMin.toFixed(4)}, ${fMax.toFixed(4)}] mean=${fMean.toFixed(6)} std=${fStd.toFixed(6)}`);
    }

    // Step 10: MLP fc2 (linear)
    {
      const enc = device.createCommandEncoder();
      this._encodeLinear(enc, hiddenBuf, ffnOutBuf, weights, `encoder.backbone.blocks.${l}.mlp.fc2`, N, VIT_CONFIG.mlpHiddenDim, D);
      device.queue.submit([enc.finish()]);
      const fc2 = await readBuffer(device, ffnOutBuf, T * 4);
      stats('fc2_output', fc2);
      console.log(`    fc2 dim538: token276=${fc2[276*D+538]?.toFixed(6)}`);
    }

    // Step 11: LayerScale2 + residual → final block 0 output
    {
      const enc = device.createCommandEncoder();
      const outBuf = (currentTokens === tokenBufA) ? tokenBufB : tokenBufA;
      this._encodeLayerScaleResidual(enc, ffnOutBuf, currentTokens, outBuf, weights, `encoder.backbone.blocks.${l}.ls2`, T, D);
      device.queue.submit([enc.finish()]);
      const final = await readBuffer(device, outBuf, T * 4);
      stats('block0_final', final);
      console.log(`    final dim538: token276=${final[276*D+538]?.toFixed(6)}`);
    }

    // Load reference for comparison
    const refResp = await fetch('/layer_dumps/block_0_output.bin');
    const ref = new Float32Array(await refResp.arrayBuffer());
    console.log(`\n  Reference block0 dim538 token276: ${ref[276*D+538]?.toFixed(6)}`);

    // Clean up
    normBuf.destroy(); qBuf.destroy(); kBuf.destroy(); vBuf.destroy();
    scoreBuf.destroy(); attnOutBuf.destroy(); projOutBuf.destroy();
    hiddenBuf.destroy(); ffnOutBuf.destroy();
    tokenBufA.destroy(); tokenBufB.destroy();

    console.log('\n=== BLOCK 0 ANALYSIS COMPLETE ===\n');
  }

  _encodeAdd(enc, dst, src, count) {
    // Simple element-wise add using the activation shader
    // We reuse layerScale with gamma=1 and dst as residual... or just inline
    // For simplicity, use a copy + add pattern
    this.device;
    const totalWG = ceilDiv(count, 256);
    const [wgX, wgY] = splitWG(totalWG);

    const paramsBuf = this._cachedUniform(new Uint32Array([count, wgX]));

    const bg = this._cachedBindGroup('add', this.pipelines.add.getBindGroupLayout(0), [
      { binding: 0, resource: { buffer: dst } },
      { binding: 1, resource: { buffer: src } },
      { binding: 2, resource: { buffer: paramsBuf } },
    ]);

    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipelines.add);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }
}

function makeStubEncoderFeatures(length, random) {
  const features = new Float32Array(length);
  for (let i = 0; i < features.length; i++) {
    features[i] = (random() - 0.5) * 0.5;
  }
  return features;
}

function fixtureShapeInfo(fixture, expectedLength, tokenH, tokenW) {
  return {
    actualLength: fixture?.features?.length ?? null,
    expectedLength,
    fixtureTokenH: Number.isInteger(fixture?.tokenH) ? fixture.tokenH : null,
    fixtureTokenW: Number.isInteger(fixture?.tokenW) ? fixture.tokenW : null,
    expectedTokenH: tokenH,
    expectedTokenW: tokenW,
  };
}

function fixtureMatchesRuntimeGrid(fixture, expectedLength, tokenH, tokenW) {
  if (!(fixture?.features instanceof Float32Array)) return false;
  if (fixture.features.length !== expectedLength) return false;
  if (Number.isInteger(fixture.tokenH) && fixture.tokenH !== tokenH) return false;
  if (Number.isInteger(fixture.tokenW) && fixture.tokenW !== tokenW) return false;
  return true;
}

function selectCpuFallbackEncoderFeatures({
  fixture,
  encoderDim,
  tokenH,
  tokenW,
  random = Math.random,
} = {}) {
  const expectedLength = encoderDim * tokenH * tokenW;

  if (fixtureMatchesRuntimeGrid(fixture, expectedLength, tokenH, tokenW)) {
    return {
      features: fixture.features,
      clsToken: fixture.clsToken || null,
      source: 'fixture',
      rejectedFixture: null,
    };
  }

  const hasFixture = fixture?.features instanceof Float32Array;
  return {
    features: makeStubEncoderFeatures(expectedLength, random),
    clsToken: null,
    source: hasFixture ? 'stub-shape-mismatch' : 'stub-no-fixture',
    rejectedFixture: hasFixture ? fixtureShapeInfo(fixture, expectedLength, tokenH, tokenW) : null,
  };
}

const WEBGPU_INFERENCE_KIT_VERSION = '0.1.4';
const DEFAULT_KIT_VERSION = WEBGPU_INFERENCE_KIT_VERSION;
const DEFAULT_TIMING_SOURCE = 'queue-submit-wait';

function isNonEmptyString$2(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSource(input) {
  return input && typeof input === 'object' ? input : {};
}

function stringOrDefault(value, fallback) {
  return isNonEmptyString$2(value) ? value : fallback;
}

function validateKernelProfileMetadata(kernel) {
  const errors = [];

  if (!kernel || typeof kernel !== 'object') {
    return { ok: false, errors: ['kernel must be an object'] };
  }

  if (!isNonEmptyString$2(kernel.kitVersion)) errors.push('kernel.kitVersion must be a non-empty string');
  if (!isNonEmptyString$2(kernel.profile)) errors.push('kernel.profile must be a non-empty string');
  if (kernel.commit != null && typeof kernel.commit !== 'string') {
    errors.push('kernel.commit must be a string or null');
  }

  return { ok: errors.length === 0, errors };
}

function createKernelProfileMetadata(input = {}, options = {}) {
  const source = normalizeSource(input);
  const kernel = {
    kitVersion: stringOrDefault(source.kitVersion, options.defaultKitVersion || DEFAULT_KIT_VERSION),
    profile: stringOrDefault(source.profile, options.defaultProfile),
    commit: source.commit || null,
  };

  if (options.requireProfile === true || options.validate === true) {
    const result = validateKernelProfileMetadata(kernel);
    if (!result.ok) throw new Error(result.errors.join('; '));
  }

  return kernel;
}

function validateRouteTimingMetadata(timing) {
  const errors = [];

  if (!timing || typeof timing !== 'object') {
    return { ok: false, errors: ['timing metadata must be an object'] };
  }

  if (!Array.isArray(timing.requiredStages) || timing.requiredStages.length === 0) {
    errors.push('requiredStages must be a non-empty array');
  } else {
    timing.requiredStages.forEach((stage, index) => {
      if (!isNonEmptyString$2(stage)) errors.push(`requiredStages[${index}] must be a non-empty string`);
    });
  }
  if (!isNonEmptyString$2(timing.timingSource)) errors.push('timingSource must be a non-empty string');

  return { ok: errors.length === 0, errors };
}

function createRouteTimingMetadata(input = {}, options = {}) {
  const source = normalizeSource(input);
  const requiredStages = Array.isArray(source.requiredStages)
    ? source.requiredStages
    : (Array.isArray(options.requiredStages) ? options.requiredStages : []);

  const timing = {
    requiredStages: [...requiredStages],
    timingSource: stringOrDefault(source.timingSource, options.timingSource || DEFAULT_TIMING_SOURCE),
  };

  if (options.validate === true) {
    const result = validateRouteTimingMetadata(timing);
    if (!result.ok) throw new Error(result.errors.join('; '));
  }

  return timing;
}

function createRouteKernelProfileMetadata(input = {}, options = {}) {
  const source = normalizeSource(input);
  return {
    kernel: createKernelProfileMetadata(source.kernel, {
      defaultKitVersion: options.defaultKitVersion,
      defaultProfile: options.defaultProfile,
      requireProfile: options.requireProfile,
      validate: options.validateKernel,
    }),
    ...createRouteTimingMetadata(source, {
      requiredStages: options.requiredStages,
      timingSource: options.timingSource,
      validate: options.validateTiming,
    }),
  };
}

const WEBGPU_ROUTE_SCHEDULER_SCHEMA = 'kaminos.webgpu-route-scheduler.v0';
const WEBGPU_ROUTE_BACKPRESSURE_SCHEMA = 'kaminos.webgpu-route-backpressure.v0';

const SCHEDULER_MODES = new Set(['throughput', 'cooperative']);
const VERIFICATION_STATES = new Set(['verified', 'scheduler-unverified', 'unsupported']);
const BUDGETS = new Set(['interactive', 'visible-wait', 'furnace', 'batch', 'unknown']);
const MEMORY_EXCLUSIVITY = new Set(['shared', 'exclusive', 'unknown']);
const WARM_CACHE_STATES = new Set(['cold', 'warm', 'hot', 'unknown']);
const BREATHABILITY_SPAN_KINDS = new Set([
  'gpu-submit-bound',
  'gpu-submit-loop',
  'readback-bound',
  'js-yieldable',
  'cpu-bound',
  'external-bound',
  'unknown',
]);
const BREATHABILITY_CHECKPOINT_KINDS = new Set([
  'pre-submit',
  'post-submit',
  'stage-boundary',
  'diffusion-step',
  'readback',
  'external-callback',
  'unknown',
]);

function clone$2(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString$1(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizePhaseChunkSize(input = {}) {
  const out = {};
  if (!isPlainObject(input)) return out;
  for (const [phase, chunkSize] of Object.entries(input)) {
    out[phase] = chunkSize;
  }
  return out;
}

function normalizeScheduler(input = {}) {
  return {
    mode: input.mode || 'throughput',
    yieldMs: input.yieldMs ?? 0,
    waitForSubmittedWorkDone: Boolean(input.waitForSubmittedWorkDone),
    phaseChunkSize: normalizePhaseChunkSize(input.phaseChunkSize),
  };
}

function normalizeEffectiveScheduler(input = {}, requestedScheduler) {
  const base = normalizeScheduler({
    ...requestedScheduler,
    ...input,
    phaseChunkSize: input.phaseChunkSize ?? requestedScheduler.phaseChunkSize,
  });
  return {
    ...base,
    unsupportedFields: Array.isArray(input.unsupportedFields) ? [...input.unsupportedFields] : [],
  };
}

function normalizeBreathabilitySpan(input = {}) {
  return {
    name: input.name,
    stage: input.stage || null,
    kind: input.kind || 'unknown',
    interruptible: Boolean(input.interruptible),
    canYieldBefore: Boolean(input.canYieldBefore),
    canYieldAfter: Boolean(input.canYieldAfter),
    nonInterruptibleReason: input.nonInterruptibleReason || null,
    metadata: isPlainObject(input.metadata) ? clone$2(input.metadata) : {},
  };
}

function normalizeBreathabilityCheckpoint(input = {}) {
  return {
    name: input.name,
    kind: input.kind || 'unknown',
    beforeStage: input.beforeStage || null,
    afterStage: input.afterStage || null,
    yieldable: Boolean(input.yieldable),
    waitsForSubmittedWorkDone: Boolean(input.waitsForSubmittedWorkDone),
    metadata: isPlainObject(input.metadata) ? clone$2(input.metadata) : {},
  };
}

function normalizeBreathability(input = {}) {
  return {
    spans: Array.isArray(input.spans) ? input.spans.map(normalizeBreathabilitySpan) : [],
    checkpoints: Array.isArray(input.checkpoints)
      ? input.checkpoints.map(normalizeBreathabilityCheckpoint)
      : [],
    notes: input.notes || null,
  };
}

function validateSchedulerShape(errors, scheduler, label) {
  if (!isPlainObject(scheduler)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!SCHEDULER_MODES.has(scheduler.mode)) {
    errors.push(`${label}.mode must be throughput or cooperative`);
  }
  if (!isNonNegativeNumber(scheduler.yieldMs)) {
    errors.push(`${label}.yieldMs must be a non-negative number`);
  }
  if (typeof scheduler.waitForSubmittedWorkDone !== 'boolean') {
    errors.push(`${label}.waitForSubmittedWorkDone must be a boolean`);
  }
  if (!isPlainObject(scheduler.phaseChunkSize)) {
    errors.push(`${label}.phaseChunkSize must be an object`);
    return;
  }
  for (const [phase, chunkSize] of Object.entries(scheduler.phaseChunkSize)) {
    if (!isNonEmptyString$1(phase)) errors.push(`${label}.phaseChunkSize contains an empty phase name`);
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      errors.push(`${label}.phaseChunkSize.${phase} must be a positive integer`);
    }
  }
}

function validateBreathability(errors, breathability) {
  if (breathability == null) return;
  if (!isPlainObject(breathability)) {
    errors.push('breathability must be an object');
    return;
  }
  if (!Array.isArray(breathability.spans)) {
    errors.push('breathability.spans must be an array');
  } else {
    breathability.spans.forEach((span, index) => {
      const path = `breathability.spans[${index}]`;
      if (!isNonEmptyString$1(span?.name)) errors.push(`${path}.name must be a non-empty string`);
      if (span?.stage != null && !isNonEmptyString$1(span.stage)) errors.push(`${path}.stage must be null or a non-empty string`);
      if (!BREATHABILITY_SPAN_KINDS.has(span?.kind)) errors.push(`${path}.kind has unsupported value`);
      if (typeof span?.interruptible !== 'boolean') errors.push(`${path}.interruptible must be a boolean`);
      if (typeof span?.canYieldBefore !== 'boolean') errors.push(`${path}.canYieldBefore must be a boolean`);
      if (typeof span?.canYieldAfter !== 'boolean') errors.push(`${path}.canYieldAfter must be a boolean`);
      if (span?.nonInterruptibleReason != null && !isNonEmptyString$1(span.nonInterruptibleReason)) {
        errors.push(`${path}.nonInterruptibleReason must be null or a non-empty string`);
      }
      if (!isPlainObject(span?.metadata)) errors.push(`${path}.metadata must be an object`);
      if ((span?.kind === 'gpu-submit-bound' || span?.kind === 'gpu-submit-loop') && span.interruptible) {
        errors.push(`${path}.${span.kind} cannot be interruptible after GPU submit`);
      }
    });
  }

  if (!Array.isArray(breathability.checkpoints)) {
    errors.push('breathability.checkpoints must be an array');
  } else {
    breathability.checkpoints.forEach((checkpoint, index) => {
      const path = `breathability.checkpoints[${index}]`;
      if (!isNonEmptyString$1(checkpoint?.name)) errors.push(`${path}.name must be a non-empty string`);
      if (!BREATHABILITY_CHECKPOINT_KINDS.has(checkpoint?.kind)) errors.push(`${path}.kind has unsupported value`);
      if (checkpoint?.beforeStage != null && !isNonEmptyString$1(checkpoint.beforeStage)) {
        errors.push(`${path}.beforeStage must be null or a non-empty string`);
      }
      if (checkpoint?.afterStage != null && !isNonEmptyString$1(checkpoint.afterStage)) {
        errors.push(`${path}.afterStage must be null or a non-empty string`);
      }
      if (typeof checkpoint?.yieldable !== 'boolean') errors.push(`${path}.yieldable must be a boolean`);
      if (typeof checkpoint?.waitsForSubmittedWorkDone !== 'boolean') {
        errors.push(`${path}.waitsForSubmittedWorkDone must be a boolean`);
      }
      if (!isPlainObject(checkpoint?.metadata)) errors.push(`${path}.metadata must be an object`);
    });
  }

  if (breathability.notes != null && !isNonEmptyString$1(breathability.notes)) {
    errors.push('breathability.notes must be null or a non-empty string');
  }
}

function missingUnsupportedField(effectiveScheduler, field) {
  return !effectiveScheduler.unsupportedFields.includes(field)
    && !effectiveScheduler.unsupportedFields.includes('phaseChunkSize');
}

function createWebGpuRouteSchedulerProfile(input = {}) {
  const requestedScheduler = normalizeScheduler(input.requestedScheduler || input);
  const effectiveScheduler = normalizeEffectiveScheduler(
    input.effectiveScheduler || {},
    requestedScheduler,
  );
  const verificationState = input.verificationState
    || (requestedScheduler.mode === 'cooperative' ? 'scheduler-unverified' : 'unsupported');

  const profile = {
    schema: WEBGPU_ROUTE_SCHEDULER_SCHEMA,
    requestedScheduler,
    effectiveScheduler,
    verificationState,
    breathability: normalizeBreathability(input.breathability),
  };

  const result = validateWebGpuRouteSchedulerProfile(profile);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return profile;
}

function validateWebGpuRouteSchedulerProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) {
    return { ok: false, errors: ['scheduler profile must be an object'] };
  }
  if (profile.schema !== WEBGPU_ROUTE_SCHEDULER_SCHEMA) {
    errors.push(`schema must be ${WEBGPU_ROUTE_SCHEDULER_SCHEMA}`);
  }
  validateSchedulerShape(errors, profile.requestedScheduler, 'requestedScheduler');
  validateSchedulerShape(errors, profile.effectiveScheduler, 'effectiveScheduler');
  validateBreathability(errors, profile.breathability);

  if (!Array.isArray(profile.effectiveScheduler?.unsupportedFields)) {
    errors.push('effectiveScheduler.unsupportedFields must be an array');
  } else {
    for (const field of profile.effectiveScheduler.unsupportedFields) {
      if (!isNonEmptyString$1(field)) errors.push('effectiveScheduler.unsupportedFields entries must be non-empty strings');
    }
  }

  if (!VERIFICATION_STATES.has(profile.verificationState)) {
    errors.push('verificationState must be verified, scheduler-unverified, or unsupported');
  }

  if (isPlainObject(profile.requestedScheduler) && isPlainObject(profile.effectiveScheduler)) {
    for (const [phase, requestedChunk] of Object.entries(profile.requestedScheduler.phaseChunkSize || {})) {
      const effectiveChunk = profile.effectiveScheduler.phaseChunkSize?.[phase];
      const field = `phaseChunkSize.${phase}`;
      if (effectiveChunk !== requestedChunk && missingUnsupportedField(profile.effectiveScheduler, field)) {
        if (profile.verificationState === 'verified') {
          errors.push(`verified scheduler cannot drop requested ${field}`);
        } else {
          errors.push(`effectiveScheduler must list unsupported ${field}`);
        }
      }
    }
  }

  if (profile.verificationState === 'verified') {
    if (profile.effectiveScheduler?.unsupportedFields?.length > 0) {
      errors.push('verified scheduler cannot include unsupportedFields');
    }
    if (profile.requestedScheduler?.mode === 'cooperative' && profile.effectiveScheduler?.mode !== 'cooperative') {
      errors.push('verified cooperative scheduler must have effectiveScheduler.mode cooperative');
    }
  }

  return { ok: errors.length === 0, errors };
}

function normalizeFrameTail(input = {}) {
  return {
    sampleWindowMs: input.sampleWindowMs ?? 0,
    longFrameCount: input.longFrameCount ?? 0,
    maxFrameGapMs: input.maxFrameGapMs ?? 0,
    p95FrameGapMs: input.p95FrameGapMs ?? null,
    p99FrameGapMs: input.p99FrameGapMs ?? null,
  };
}

function createWebGpuRouteBackpressureProfile(input = {}) {
  const profile = {
    schema: WEBGPU_ROUTE_BACKPRESSURE_SCHEMA,
    requestedBudget: input.requestedBudget || 'unknown',
    effectiveBudget: input.effectiveBudget || input.requestedBudget || 'unknown',
    memoryExclusivity: input.memoryExclusivity || 'unknown',
    warmCacheState: input.warmCacheState || 'unknown',
    frameTail: normalizeFrameTail(input.frameTail),
  };
  const result = validateWebGpuRouteBackpressureProfile(profile);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return profile;
}

function validateOptionalFrameMs(errors, frameTail, field) {
  if (frameTail[field] != null && !isNonNegativeNumber(frameTail[field])) {
    errors.push(`frameTail.${field} must be null or a non-negative number`);
  }
}

function validateWebGpuRouteBackpressureProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) {
    return { ok: false, errors: ['backpressure profile must be an object'] };
  }
  if (profile.schema !== WEBGPU_ROUTE_BACKPRESSURE_SCHEMA) {
    errors.push(`schema must be ${WEBGPU_ROUTE_BACKPRESSURE_SCHEMA}`);
  }
  if (!BUDGETS.has(profile.requestedBudget)) errors.push('requestedBudget has unsupported value');
  if (!BUDGETS.has(profile.effectiveBudget)) errors.push('effectiveBudget has unsupported value');
  if (!MEMORY_EXCLUSIVITY.has(profile.memoryExclusivity)) errors.push('memoryExclusivity has unsupported value');
  if (!WARM_CACHE_STATES.has(profile.warmCacheState)) errors.push('warmCacheState has unsupported value');

  if (!isPlainObject(profile.frameTail)) {
    errors.push('frameTail must be an object');
  } else {
    if (!isNonNegativeNumber(profile.frameTail.sampleWindowMs)) {
      errors.push('frameTail.sampleWindowMs must be a non-negative number');
    }
    if (!Number.isInteger(profile.frameTail.longFrameCount) || profile.frameTail.longFrameCount < 0) {
      errors.push('frameTail.longFrameCount must be a non-negative integer');
    }
    if (!isNonNegativeNumber(profile.frameTail.maxFrameGapMs)) {
      errors.push('frameTail.maxFrameGapMs must be a non-negative number');
    }
    validateOptionalFrameMs(errors, profile.frameTail, 'p95FrameGapMs');
    validateOptionalFrameMs(errors, profile.frameTail, 'p99FrameGapMs');
  }

  return { ok: errors.length === 0, errors };
}

const WEBGPU_ROUTE_DEFINITION_SCHEMA = 'kaminos.webgpu-route-definition.v0';

function clone$1(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeRoles(entries = [], { defaultRequired = true } = {}) {
  if (!Array.isArray(entries)) return [];

  return entries.map(entry => {
    if (typeof entry === 'string') {
      return {
        role: entry,
        required: defaultRequired,
        artifactRequired: true,
        hashRequired: true,
      };
    }

    return {
      role: entry.role,
      required: entry.required !== false,
      artifactRequired: entry.artifactRequired !== false,
      hashRequired: entry.hashRequired !== false,
      shape: Array.isArray(entry.shape) ? [...entry.shape] : undefined,
    };
  });
}

function requiredRoleNames(roles) {
  return roles.filter(role => role.required !== false).map(role => role.role);
}

function optionalRoleNames(roles) {
  return roles.filter(role => role.required === false).map(role => role.role);
}

function defineWebGpuRoute(input) {
  if (!input || typeof input !== 'object') throw new Error('route input must be an object');

  const inputRoles = normalizeRoles(input.inputs || input.inputRoles, { defaultRequired: true });
  const outputRoles = normalizeRoles(input.outputs || input.outputRoles, { defaultRequired: true });

  return {
    schema: WEBGPU_ROUTE_DEFINITION_SCHEMA,
    routeId: input.routeId,
    backendKind: input.backendKind,
    model: clone$1(input.model),
    kernel: clone$1(input.kernel),
    inputRoles,
    outputRoles,
    requiredInputRoles: requiredRoleNames(inputRoles),
    requiredOutputRoles: requiredRoleNames(outputRoles),
    optionalOutputRoles: optionalRoleNames(outputRoles),
    requiredFeatures: Array.isArray(input.requiredFeatures) ? [...input.requiredFeatures].map(String).sort() : [],
    requiredStages: Array.isArray(input.requiredStages) ? [...input.requiredStages] : [],
    timingSource: input.timingSource || 'queue-submit-wait',
    scheduler: clone$1(input.scheduler || null),
    backpressure: clone$1(input.backpressure || null),
    worker: clone$1(input.worker || null),
  };
}

const MOGE_DEPTH_NORMAL_ROUTE_ID$2 = 'moge.depth-normal.webgpu-local.v0';
const MOGE_MODEL_ID$1 = 'Ruicheng/moge-2-vitl-normal';
const DEFAULT_KERNEL_PROFILE = 'conv-transpose2d-stride2';
const REQUIRED_STAGES = ['backbone', 'decoder-heads', 'output-readback'];

function createDefaultMogeScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: {
      mode: 'cooperative',
      yieldMs: 4,
      waitForSubmittedWorkDone: true,
      phaseChunkSize: {
        backbone: 1,
        'decoder-heads': 1,
        'output-readback': 1,
      },
    },
    effectiveScheduler: {
      mode: 'cooperative',
      yieldMs: 4,
      waitForSubmittedWorkDone: true,
      phaseChunkSize: {
        backbone: 1,
        'decoder-heads': 1,
        'output-readback': 1,
      },
      unsupportedFields: [],
    },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: [
        {
          name: 'backbone-submit',
          stage: 'backbone',
          kind: 'gpu-submit-bound',
          interruptible: false,
          canYieldBefore: true,
          canYieldAfter: true,
          nonInterruptibleReason: 'GPU command buffers cannot be preempted after submit',
        },
        {
          name: 'decoder-heads-submit',
          stage: 'decoder-heads',
          kind: 'gpu-submit-bound',
          interruptible: false,
          canYieldBefore: true,
          canYieldAfter: true,
          nonInterruptibleReason: 'GPU command buffers cannot be preempted after submit',
        },
        {
          name: 'output-readback',
          stage: 'output-readback',
          kind: 'readback-bound',
          interruptible: false,
          canYieldBefore: true,
          canYieldAfter: true,
        },
      ],
      checkpoints: REQUIRED_STAGES.map(stage => ({
        name: `after-${stage}`,
        kind: stage === 'output-readback' ? 'readback' : 'stage-boundary',
        afterStage: stage,
        yieldable: true,
        waitsForSubmittedWorkDone: true,
      })),
      notes: 'MoGE can cooperate between staged submits and readback, not inside a submitted GPU pass.',
    },
  });
}

function createDefaultMogeBackpressure() {
  return createWebGpuRouteBackpressureProfile({
    requestedBudget: 'visible-wait',
    effectiveBudget: 'visible-wait',
    memoryExclusivity: 'shared',
    warmCacheState: 'unknown',
  });
}

function createMogeDepthNormalRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });

  return defineWebGpuRoute({
    routeId: MOGE_DEPTH_NORMAL_ROUTE_ID$2,
    backendKind: 'webgpu-local',
    model: {
      id: MOGE_MODEL_ID$1,
      revision: input.model?.revision || 'local-vitl-normal',
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: routeMetadata.kernel,
    inputs: [
      { role: 'source-image', required: true, artifactRequired: true, hashRequired: true },
    ],
    outputs: [
      { role: 'depth', required: true, artifactRequired: true, hashRequired: true, shape: [592, 592] },
      { role: 'normal', required: true, artifactRequired: true, hashRequired: true, shape: [3, 592, 592] },
      { role: 'pointmap', required: false, artifactRequired: true, hashRequired: true, shape: [3, 592, 592] },
      { role: 'mask', required: false, artifactRequired: true, hashRequired: true, shape: [592, 592] },
    ],
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultMogeScheduler(),
    backpressure: input.backpressure || createDefaultMogeBackpressure(),
    worker: input.worker || {
      exportName: 'runMogeDepthNormalRoute',
    },
  });
}

const MOGE_DEPTH_NORMAL_ROUTE_ID$1 = 'moge.depth-normal.webgpu-local.v0';
const MOGE_ROUTE_REQUEST_SCHEMA = 'kaminos.webgpu-route-request.v0';
const MOGE_ROUTE_RESULT_SCHEMA = 'kaminos.webgpu-route-result.v0';
const MOGE_ROUTE_RECEIPT_SCHEMA = 'kaminos.webgpu-route-receipt.v0';
const AUTHORITATIVE_TIMING_SOURCE = 'queue-submit-wait';
const AUTHORITATIVE_TIMING_STAGES = ['backbone', 'decoder-heads', 'output-readback'];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const DEFAULT_MOGE_ROUTE_DEFINITION = createMogeDepthNormalRouteDefinition();

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireString(errors, value, path) {
  if (!isNonEmptyString(value)) errors.push(`${path} must be a non-empty string`);
}

function sourceArtifactFrom(routeReceipt) {
  const source = routeReceipt?.sourceArtifact || {};
  return {
    role: 'source-image',
    artifactId: source.artifactId || 'runtime:browser-imagedata',
    sha256: source.sha256 || null,
    hashStatus: source.sha256 ? 'provided' : 'not-hashed-browser-runtime',
    shape: Array.isArray(source.shape) ? [...source.shape] : null,
  };
}

function outputArtifactFrom(role, artifact, shape) {
  return {
    role,
    artifactId: artifact?.artifactId || `runtime:${role}`,
    sha256: artifact?.sha256 || null,
    hashStatus: artifact?.sha256 ? 'provided' : 'not-hashed-browser-runtime',
    shape,
  };
}

function outputArtifactsFrom(routeReceipt, outH, outW) {
  const outputs = routeReceipt?.outputs || {};
  return [
    outputArtifactFrom('depth', outputs.depth, [outH, outW]),
    outputArtifactFrom('normal', outputs.normal, [3, outH, outW]),
    outputArtifactFrom('pointmap', outputs.pointMap, [3, outH, outW]),
  ];
}

function createMogeRouteInvocationRequest({ routeReceipt, outH, outW, requestId } = {}) {
  const now = new Date().toISOString();
  return {
    schema: MOGE_ROUTE_REQUEST_SCHEMA,
    requestId: requestId || routeReceipt?.requestId || `moge-depth-normal:${now}`,
    routeId: MOGE_DEPTH_NORMAL_ROUTE_ID$1,
    backendKind: 'webgpu-local',
    inputs: [sourceArtifactFrom(routeReceipt)],
    outputs: outputArtifactsFrom(routeReceipt, outH, outW).map(output => ({
      role: output.role,
      artifactId: output.artifactId,
      sha256: output.sha256,
      hashStatus: output.hashStatus,
      shape: output.shape,
    })),
    routeConfig: {
      timingSource: routeReceipt?.timingSource || 'queue-submit-wait',
      profileStagedGpu: routeReceipt?.profileStagedGpu ?? null,
    },
    model: clone(routeReceipt?.model || {}),
    kernel: clone(routeReceipt?.kernel || {}),
    scheduler: clone(routeReceipt?.scheduler || DEFAULT_MOGE_ROUTE_DEFINITION.scheduler),
    backpressure: clone(routeReceipt?.backpressure || DEFAULT_MOGE_ROUTE_DEFINITION.backpressure),
    createdAt: now,
  };
}

function validateMogeRouteInvocationRequest(request) {
  const errors = [];
  if (!request || typeof request !== 'object') return { ok: false, errors: ['request must be an object'] };
  if (request.schema !== MOGE_ROUTE_REQUEST_SCHEMA) errors.push(`schema must be ${MOGE_ROUTE_REQUEST_SCHEMA}`);
  requireString(errors, request.requestId, 'requestId');
  if (request.routeId !== MOGE_DEPTH_NORMAL_ROUTE_ID$1) errors.push(`routeId must be ${MOGE_DEPTH_NORMAL_ROUTE_ID$1}`);
  if (request.backendKind !== 'webgpu-local') errors.push('backendKind must be webgpu-local');
  validateArtifacts(errors, request.inputs, 'inputs', ['source-image'], { requireHash: true });
  validateArtifacts(errors, request.outputs, 'outputs', ['depth', 'normal', 'pointmap'], { requireHash: false });
  const schedulerResult = validateWebGpuRouteSchedulerProfile(request.scheduler);
  if (!schedulerResult.ok) errors.push(...schedulerResult.errors.map(error => `scheduler.${error}`));
  const backpressureResult = validateWebGpuRouteBackpressureProfile(request.backpressure);
  if (!backpressureResult.ok) errors.push(...backpressureResult.errors.map(error => `backpressure.${error}`));
  return { ok: errors.length === 0, errors };
}

function validateArtifacts(errors, artifacts, path, allowedRoles, { requireHash }) {
  const allowed = new Set(allowedRoles);
  const seen = new Set();
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }
  artifacts.forEach((artifact, index) => {
    const artifactPath = `${path}[${index}]`;
    requireString(errors, artifact?.role, `${artifactPath}.role`);
    if (artifact?.role) {
      if (!allowed.has(artifact.role)) errors.push(`${artifactPath}.role is not defined by route`);
      if (seen.has(artifact.role)) errors.push(`${artifactPath}.role duplicates ${artifact.role}`);
      seen.add(artifact.role);
    }
    requireString(errors, artifact?.artifactId, `${artifactPath}.artifactId`);
    if (requireHash) requireString(errors, artifact?.sha256, `${artifactPath}.sha256`);
    if (artifact?.shape != null && (!Array.isArray(artifact.shape) || !artifact.shape.every(Number.isInteger))) {
      errors.push(`${artifactPath}.shape must be an integer array when present`);
    }
  });
  for (const role of allowedRoles) {
    if (!seen.has(role)) errors.push(`${path} missing role ${role}`);
  }
}

function validateRouteReceipt(errors, receipt) {
  if (!receipt || typeof receipt !== 'object') {
    errors.push('receipt must be an object');
    return;
  }
  if (receipt.schema !== MOGE_ROUTE_RECEIPT_SCHEMA) errors.push(`receipt.schema must be ${MOGE_ROUTE_RECEIPT_SCHEMA}`);
  if (receipt.requestedRouteId !== MOGE_DEPTH_NORMAL_ROUTE_ID$1) errors.push(`receipt.requestedRouteId must be ${MOGE_DEPTH_NORMAL_ROUTE_ID$1}`);
  if (receipt.effectiveRouteId !== MOGE_DEPTH_NORMAL_ROUTE_ID$1) errors.push(`receipt.effectiveRouteId must be ${MOGE_DEPTH_NORMAL_ROUTE_ID$1}`);
  if (receipt.status !== 'real') errors.push(`receipt.status must be real for authoritative result, got ${receipt.status}`);
  if (receipt.fallbackReason) errors.push(`receipt.fallbackReason must be empty for authoritative result, got ${receipt.fallbackReason}`);
  if (receipt.backend?.kind !== 'webgpu-local') errors.push('receipt.backend.kind must be webgpu-local');
  if (receipt.backend?.runtime !== 'browser') errors.push('receipt.backend.runtime must be browser');
  requireString(errors, receipt.backend?.adapterName, 'receipt.backend.adapterName');
  if (!Array.isArray(receipt.backend?.features) || receipt.backend.features.length === 0) {
    errors.push('receipt.backend.features must be a non-empty array');
  }
  requireString(errors, receipt.model?.id, 'receipt.model.id');
  requireString(errors, receipt.model?.revision, 'receipt.model.revision');
  requireString(errors, receipt.model?.weightsHash, 'receipt.model.weightsHash');
  requireString(errors, receipt.model?.dtype, 'receipt.model.dtype');
  requireString(errors, receipt.kernel?.kitVersion, 'receipt.kernel.kitVersion');
  requireString(errors, receipt.kernel?.profile, 'receipt.kernel.profile');
  validateArtifacts(errors, receipt.inputs, 'receipt.inputs', ['source-image'], { requireHash: true });
  validateArtifacts(errors, receipt.outputs, 'receipt.outputs', ['depth', 'normal', 'pointmap'], { requireHash: true });
  for (const output of receipt.outputs || []) {
    if (output.status !== 'real') errors.push(`receipt.outputs.${output.role}.status must be real, got ${output.status}`);
  }
  requireString(errors, receipt.timings?.source, 'receipt.timings.source');
  if (receipt.timings?.source !== AUTHORITATIVE_TIMING_SOURCE) {
    errors.push(`receipt.timings.source must be ${AUTHORITATIVE_TIMING_SOURCE} for authoritative result`);
  }
  if (!Number.isFinite(receipt.timings?.totalMs) || receipt.timings.totalMs <= 0) {
    errors.push('receipt.timings.totalMs must be a positive finite number');
  }
  if (!Array.isArray(receipt.timings?.stages) || receipt.timings.stages.length === 0) {
    errors.push('receipt.timings.stages must be a non-empty array');
  } else {
    const stageNames = new Set();
    for (const [index, stage] of receipt.timings.stages.entries()) {
      requireString(errors, stage?.name, `receipt.timings.stages[${index}].name`);
      if (!Number.isFinite(stage?.ms) || stage.ms < 0) {
        errors.push(`receipt.timings.stages[${index}].ms must be a finite non-negative number`);
      }
      if (isNonEmptyString(stage?.name)) stageNames.add(stage.name);
    }
    for (const stageName of AUTHORITATIVE_TIMING_STAGES) {
      if (!stageNames.has(stageName)) {
        errors.push(`receipt.timings.stages missing authoritative staged-submit stage ${stageName}`);
      }
    }
  }
}

function validateMogeRouteWorkerResult(result) {
  const errors = [];
  if (!result || typeof result !== 'object') return { ok: false, errors: ['result must be an object'] };
  requireString(errors, result.requestId, 'requestId');
  const requestResult = validateMogeRouteInvocationRequest(result.request);
  if (!requestResult.ok) errors.push(...requestResult.errors.map(error => `request.${error}`));
  validateRouteReceipt(errors, result.receipt);
  validateArtifacts(errors, result.outputs, 'outputs', ['depth', 'normal', 'pointmap'], { requireHash: true });
  return { ok: errors.length === 0, errors };
}

function createMogeRouteWorkerResult({ request, receipt } = {}) {
  const result = {
    schema: MOGE_ROUTE_RESULT_SCHEMA,
    requestId: request?.requestId || null,
    routeId: MOGE_DEPTH_NORMAL_ROUTE_ID$1,
    status: receipt?.status || 'unknown',
    request: clone(request),
    receipt: clone(receipt),
    backend: clone(receipt?.backend || null),
    outputs: clone(receipt?.outputs || []),
    timings: clone(receipt?.timings || null),
    createdAt: new Date().toISOString(),
  };
  const validation = validateMogeRouteWorkerResult(result);
  return {
    ...result,
    validation,
    authoritative: validation.ok && result.status === 'real',
  };
}

/**
 * inference.js — MoGe-2 inference pipeline in WebGPU compute.
 *
 * Architecture (from upstream configs/train/v2.json + modules.py):
 *
 *   Encoder: DINOv2 ViT-Large (dinov2_vitl14)
 *     - intermediate_layers: [5, 11, 17, 23] → sum of projected features → [1024, tokenH, tokenW]
 *     - Also returns CLS token [1024]
 *     [STUBBED: random features until ViT kernels arrive from voxel-attention-defibrillator]
 *
 *   Neck ConvStack:
 *     dim_in: [1026, 2, 2, 2, 2]  (encoder features + 2 UV channels per level)
 *     dim_res_blocks: [1024, 256, 128, 64, 32]
 *     num_res_blocks: [0, 2, 2, 2, 0]
 *     resamplers: [conv_transpose, conv_transpose, conv_transpose, bilinear]
 *     norm: none
 *
 *   Points/Normal/Mask heads (each a ConvStack):
 *     dim_in: [1024, 256, 128, 64, 32]  (from neck outputs)
 *     dim_res_blocks: [1024, 256, 128, 64, 32]
 *     num_res_blocks: [0, 1, 1, 1, 0]
 *     dim_out: [null, null, null, null, 3/3/1]
 *     resamplers: [conv_transpose, conv_transpose, conv_transpose, bilinear]
 *
 *   Scale head: MLP [1024 → 1024 → 1024 → 1] with ReLU between layers
 *
 *   Post-processing: exp remap, focal recovery, force projection, mask
 */


function createGpuTimestampProfile(device, count) {
  if (!device.features?.has?.('timestamp-query')) return null;
  const byteSize = count * 8;
  return {
    route: 'timestamp-query',
    count,
    querySet: device.createQuerySet({ type: 'timestamp', count }),
    resolveBuffer: device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    }),
    readBuffer: device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
  };
}

function writeGpuTimestamp(profile, encoder, index) {
  if (profile) encoder.writeTimestamp(profile.querySet, index);
}

function resolveGpuTimestamps(profile, encoder) {
  if (!profile) return;
  encoder.resolveQuerySet(profile.querySet, 0, profile.count, profile.resolveBuffer, 0);
  encoder.copyBufferToBuffer(profile.resolveBuffer, 0, profile.readBuffer, 0, profile.count * 8);
}

async function readGpuTimestamps(profile) {
  if (!profile) return null;
  await profile.readBuffer.mapAsync(GPUMapMode.READ);
  const values = Array.from(new BigUint64Array(profile.readBuffer.getMappedRange().slice(0)));
  profile.readBuffer.unmap();
  profile.querySet.destroy?.();
  profile.resolveBuffer.destroy();
  profile.readBuffer.destroy();
  return values;
}

function timestampDeltaMs(values, start, end) {
  if (!values || values.length <= end) return null;
  return Number(values[end] - values[start]) / 1e6;
}

const MOGE_DEPTH_NORMAL_ROUTE_ID = 'moge.depth-normal.webgpu-local.v0';
const MOGE_MODEL_ID = 'Ruicheng/moge-2-vitl-normal';
function timedStagesFromStagedProfile(staged) {
  if (!staged) return null;
  return [
    { name: 'backbone', ms: staged.backboneSubmitWaitMs },
    { name: 'neck-input', ms: staged.neckInputSubmitWaitMs },
    { name: 'decoder-heads', ms: staged.decoderSubmitWaitMs },
    { name: 'output-readback', ms: staged.outputReadbackMs },
  ].filter(stage => Number.isFinite(stage.ms));
}

function runtimeEvidenceFallbackReason(runtimeEvidence) {
  if (!runtimeEvidence) return null;
  const reasons = [];
  if (runtimeEvidence.weights !== 'real') reasons.push(`weights=${runtimeEvidence.weights || 'unknown'}`);
  if (runtimeEvidence.encoderFeatures && runtimeEvidence.encoderFeatures !== 'backbone-gpu' && runtimeEvidence.encoderFeatures !== 'fixture') {
    reasons.push(`encoderFeatures=${runtimeEvidence.encoderFeatures}`);
  }
  return reasons.length > 0 ? `non-authoritative runtime evidence (${reasons.join(', ')})` : null;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createMogeWebGpuRouteReceipt({ backendIdentity, routeRequest, routeReceipt, stagedGpuPhaseTimings, phaseTimings, outH, outW, runtimeEvidence, observedSchedulerEvents }) {
  const sourceArtifact = routeReceipt?.sourceArtifact || {};
  const outputArtifacts = routeReceipt?.outputs || {};
  const model = routeReceipt?.model || {};
  const kernel = routeReceipt?.kernel || {};
  const runtimeFallbackReason = runtimeEvidenceFallbackReason(runtimeEvidence);
  const status = runtimeFallbackReason ? 'partial' : (routeReceipt?.status || (sourceArtifact.sha256 ? 'real' : 'partial'));
  const stagedStages = timedStagesFromStagedProfile(stagedGpuPhaseTimings);
  const timingSource = stagedStages ? 'queue-submit-wait' : 'wall-clock';
  const totalMs = stagedGpuPhaseTimings?.totalProfiledGpuMs ?? phaseTimings.totalMs;

  const output = (role, artifact, shape) => ({
    role,
    artifactId: artifact?.artifactId || `runtime:${role}`,
    sha256: artifact?.sha256 || null,
    hashStatus: artifact?.sha256 ? 'provided' : 'not-hashed-browser-runtime',
    shape,
    status: artifact?.status || status,
  });

  return {
    schema: 'kaminos.webgpu-route-receipt.v0',
    requestedRouteId: MOGE_DEPTH_NORMAL_ROUTE_ID,
    effectiveRouteId: MOGE_DEPTH_NORMAL_ROUTE_ID,
    status,
    fallbackReason: runtimeFallbackReason || routeReceipt?.fallbackReason || null,
    runtimeEvidence: runtimeEvidence || null,
    backend: backendIdentity || {
      kind: 'webgpu-local',
      runtime: 'browser',
      adapterName: 'unknown-webgpu-adapter',
      browser: navigator.userAgent || 'unknown-browser',
      requestedFeatures: [],
      features: [],
      limits: {},
      timestampQuery: 'unavailable',
    },
    model: {
      id: MOGE_MODEL_ID,
      revision: model.revision || 'local-browser-weights',
      weightsHash: model.weightsHash || null,
      dtype: model.dtype || 'fp16',
    },
    kernel: {
      kitVersion: kernel.kitVersion || WEBGPU_INFERENCE_KIT_VERSION,
      profile: kernel.profile || 'conv-transpose2d-stride2',
      commit: kernel.commit || null,
    },
    inputs: [
      {
        role: 'source-image',
        artifactId: sourceArtifact.artifactId || 'runtime:browser-imagedata',
        sha256: sourceArtifact.sha256 || null,
        hashStatus: sourceArtifact.sha256 ? 'provided' : 'not-hashed-browser-runtime',
        shape: Array.isArray(sourceArtifact.shape) ? [...sourceArtifact.shape] : null,
      },
    ],
    outputs: [
      output('depth', outputArtifacts.depth, [outH, outW]),
      output('normal', outputArtifacts.normal, [3, outH, outW]),
      output('pointmap', outputArtifacts.pointMap, [3, outH, outW]),
    ],
    runtime: {
      scheduler: cloneJson(routeRequest?.scheduler || null),
      backpressure: cloneJson(routeRequest?.backpressure || null),
      schedulerVerification: createMogeSchedulerVerificationReceipt({
        routeRequest,
        scheduler: routeRequest?.scheduler || null,
        backpressure: routeRequest?.backpressure || null,
        stagedStages,
        observedEvents: observedSchedulerEvents,
      }),
    },
    timings: {
      source: timingSource,
      totalMs,
      stages: stagedStages || [
        { name: 'total', ms: phaseTimings.totalMs },
      ],
      profile: stagedGpuPhaseTimings
        ? {
            schema: 'kaminos.webgpu-staged-profile.v0',
            route: stagedGpuPhaseTimings.route,
            timingSource,
            requiredStages: ['backbone', 'decoder-heads', 'output-readback'],
            stages: stagedStages,
            stageNames: stagedStages.map(stage => stage.name),
            totalMs,
          }
        : null,
    },
  };
}

// --- Model config from upstream v2.json ---
const MODEL_CONFIG = {
  encoder: {
    dimOut: 1024,
  },
  neck: {
    dimIn: [1026, 2, 2, 2, 2],
    dimResBlocks: [1024, 256, 128, 64, 32],
    dimOut: [null, null, null, null, null],
    numResBlocks: [0, 2, 2, 2, 0],
    resamplers: ['conv_transpose', 'conv_transpose', 'conv_transpose', 'bilinear'],
    resBlockInNorm: 'none',
    resBlockHiddenNorm: 'none',
  },
  pointsHead: {
    dimIn: [1024, 256, 128, 64, 32],
    dimResBlocks: [1024, 256, 128, 64, 32],
    dimOut: [null, null, null, null, 3],
    numResBlocks: [0, 1, 1, 1, 0],
    resamplers: ['conv_transpose', 'conv_transpose', 'conv_transpose', 'bilinear'],
    resBlockInNorm: 'none',
    resBlockHiddenNorm: 'none',
  },
  normalHead: {
    dimIn: [1024, 256, 128, 64, 32],
    dimResBlocks: [1024, 256, 128, 64, 32],
    dimOut: [null, null, null, null, 3],
    numResBlocks: [0, 1, 1, 1, 0],
    resamplers: ['conv_transpose', 'conv_transpose', 'conv_transpose', 'bilinear'],
    resBlockInNorm: 'none',
    resBlockHiddenNorm: 'none',
  },
  maskHead: {
    dimIn: [1024, 256, 128, 64, 32],
    dimResBlocks: [1024, 256, 128, 64, 32],
    dimOut: [null, null, null, null, 1],
    numResBlocks: [0, 1, 1, 1, 0],
    resamplers: ['conv_transpose', 'conv_transpose', 'conv_transpose', 'bilinear'],
    resBlockInNorm: 'none',
    resBlockHiddenNorm: 'none',
  },
  patchSize: 14,
};


/**
 * ResidualConvBlock dispatch:
 *   [Norm →] Activation → Conv3x3 → [Norm →] Activation → Conv3x3 + Skip
 *
 * When inNorm='none', the norm layers are identity (MoGe-2 default).
 */
function dispatchResidualConvBlock(device, encoder, inputBuf, weights, params) {
  const { inC, outC, hiddenC, H, W, inNorm, hiddenNorm } = params;

  let x = inputBuf;

  // Norm 1 (skip if 'none')
  if (inNorm !== 'none') {
    const numGroups = inNorm === 'group_norm' ? Math.floor(inC / 32) : 1;
    x = dispatchGroupNorm(device, encoder, x, weights.norm1_scale, weights.norm1_bias,
      { C: inC, H, W, numGroups });
  }

  // ReLU -> Conv3x3 (inC -> hiddenC). MoGe-2 decoder uses norm='none',
  // so this is the hot path worth fusing.
  let convOut;
  if (inNorm === 'none') {
    convOut = dispatchReluConv2d(device, encoder, x, weights.conv1_weight, weights.conv1_bias,
      { inC, inH: H, inW: W, outC: hiddenC, kH: 3, kW: 3, padH: 1, padW: 1, strideH: 1, strideW: 1 });
  } else {
    x = dispatchActivation(device, encoder, x, null, inC * H * W, 0);
    convOut = dispatchConv2d(device, encoder, x, weights.conv1_weight, weights.conv1_bias,
      { inC, inH: H, inW: W, outC: hiddenC, kH: 3, kW: 3, padH: 1, padW: 1, strideH: 1, strideW: 1 });
  }

  x = convOut.buffer;

  // Norm 2 (skip if 'none')
  if (hiddenNorm !== 'none') {
    const numGroups = hiddenNorm === 'group_norm' ? Math.floor(hiddenC / 32) : 1;
    x = dispatchGroupNorm(device, encoder, x, weights.norm2_scale, weights.norm2_bias,
      { C: hiddenC, H, W, numGroups });
  }

  // ReLU -> Conv3x3 (hiddenC -> outC)
  if (hiddenNorm === 'none') {
    convOut = dispatchReluConv2d(device, encoder, x, weights.conv2_weight, weights.conv2_bias,
      { inC: hiddenC, inH: H, inW: W, outC, kH: 3, kW: 3, padH: 1, padW: 1, strideH: 1, strideW: 1 });
  } else {
    x = dispatchActivation(device, encoder, x, null, hiddenC * H * W, 0);
    convOut = dispatchConv2d(device, encoder, x, weights.conv2_weight, weights.conv2_bias,
      { inC: hiddenC, inH: H, inW: W, outC, kH: 3, kW: 3, padH: 1, padW: 1, strideH: 1, strideW: 1 });
  }

  // Skip connection
  let skip;
  if (inC !== outC && weights.skip_weight) {
    skip = dispatchConv1x1(device, encoder, inputBuf, weights.skip_weight, null,
      { inC, outC, H, W }).buffer;
  } else {
    skip = inputBuf;
  }

  // Add
  const out = dispatchActivation(device, encoder, convOut.buffer, skip, outC * H * W, 2);
  return out;
}

/**
 * Resampler dispatch.
 * Type determines the upsampling method:
 *   conv_transpose: ConvTranspose2d(inC, outC, k=2, s=2) → Conv2d(outC, outC, 3, pad=1)
 *   bilinear: Upsample(2x, bilinear) → Conv2d(inC, outC, 3, pad=1)
 */
function dispatchResampler(device, encoder, inputBuf, weights, params) {
  const { inC, outC, H, W, type } = params;

  if (type === 'conv_transpose') {
    // ConvTranspose2d: inC → outC, kernel=2, stride=2
    const deconv = dispatchConvTranspose2d(device, encoder, inputBuf,
      weights.deconv_weight, weights.deconv_bias,
      { inC, inH: H, inW: W, outC, stride: 2 });

    // Conv2d: outC → outC, 3x3, pad=1
    const conv = dispatchConv2d(device, encoder, deconv.buffer,
      weights.conv_weight, weights.conv_bias,
      { inC: outC, inH: deconv.H, inW: deconv.W, outC, kH: 3, kW: 3, padH: 1, padW: 1, strideH: 1, strideW: 1 });

    return { buffer: conv.buffer, H: deconv.H, W: deconv.W };
  } else if (type === 'bilinear') {
    // Bilinear upsample 2x
    const upsampled = dispatchUpsample(device, encoder, inputBuf,
      { C: inC, inH: H, inW: W, outH: H * 2, outW: W * 2, mode: 1 });

    // Conv2d: inC → outC, 3x3, pad=1
    const conv = dispatchConv2d(device, encoder, upsampled.buffer,
      weights.conv_weight, weights.conv_bias,
      { inC, inH: upsampled.H, inW: upsampled.W, outC, kH: 3, kW: 3, padH: 1, padW: 1, strideH: 1, strideW: 1 });

    return { buffer: conv.buffer, H: upsampled.H, W: upsampled.W };
  }

  throw new Error(`Unsupported resampler type: ${type}`);
}

async function dispatchResamplerProfiled(device, encoder, inputBuf, weights, params, stages) {
  const { inC, outC, H, W, type } = params;

  if (type === 'conv_transpose') {
    const deconv = dispatchConvTranspose2d(device, encoder, inputBuf,
      weights.deconv_weight, weights.deconv_bias,
      { inC, inH: H, inW: W, outC, stride: 2 });
    encoder = await submitProfileStage(device, encoder, stages, {
      name: 'deconv',
      shape: [outC, deconv.H, deconv.W],
      inputShape: [inC, H, W],
      resampler: type,
    });

    const conv = dispatchConv2d(device, encoder, deconv.buffer,
      weights.conv_weight, weights.conv_bias,
      { inC: outC, inH: deconv.H, inW: deconv.W, outC, kH: 3, kW: 3, padH: 1, padW: 1, strideH: 1, strideW: 1 });
    encoder = await submitProfileStage(device, encoder, stages, {
      name: 'postConv',
      shape: [outC, deconv.H, deconv.W],
      inputShape: [outC, deconv.H, deconv.W],
      resampler: type,
    });

    return { buffer: conv.buffer, H: deconv.H, W: deconv.W, encoder };
  } else if (type === 'bilinear') {
    const upsampled = dispatchUpsample(device, encoder, inputBuf,
      { C: inC, inH: H, inW: W, outH: H * 2, outW: W * 2, mode: 1 });
    encoder = await submitProfileStage(device, encoder, stages, {
      name: 'upsample',
      shape: [inC, upsampled.H, upsampled.W],
      inputShape: [inC, H, W],
      resampler: type,
    });

    const conv = dispatchConv2d(device, encoder, upsampled.buffer,
      weights.conv_weight, weights.conv_bias,
      { inC, inH: upsampled.H, inW: upsampled.W, outC, kH: 3, kW: 3, padH: 1, padW: 1, strideH: 1, strideW: 1 });
    encoder = await submitProfileStage(device, encoder, stages, {
      name: 'postConv',
      shape: [outC, upsampled.H, upsampled.W],
      inputShape: [inC, upsampled.H, upsampled.W],
      resampler: type,
    });

    return { buffer: conv.buffer, H: upsampled.H, W: upsampled.W, encoder };
  }

  throw new Error(`Unsupported resampler type: ${type}`);
}

/**
 * ConvStack dispatch — the core multi-scale decoder.
 *
 * For each level i:
 *   1. input_block: 1x1 conv (dimIn[i] → dimResBlocks[i])
 *   2. Add to running feature from previous level
 *   3. res_blocks: numResBlocks[i] × ResidualConvBlock
 *   4. output_block: 1x1 conv (dimResBlocks[i] → dimOut[i]) if dimOut[i] != null
 *   5. resampler: upsample x2 for next level
 *
 * Returns list of output features per level.
 */
function dispatchConvStack(device, encoder, inFeatures, weights, config) {
  const { dimIn, dimResBlocks, dimOut, numResBlocks, resamplers, resBlockInNorm, resBlockHiddenNorm } = config;
  const numLevels = dimResBlocks.length;
  const outFeatures = [];
  let x = null;

  for (let i = 0; i < numLevels; i++) {
    const H = inFeatures[i].H;
    const W = inFeatures[i].W;

    // input_block: 1x1 conv
    let projected = null;
    if (dimIn[i] != null && inFeatures[i].buffer != null) {
      projected = dispatchConv1x1(device, encoder, inFeatures[i].buffer,
        weights.levels[i].input_weight, weights.levels[i].input_bias,
        { inC: dimIn[i], outC: dimResBlocks[i], H, W });
    }

    // Add to running state or initialize
    if (i === 0) {
      x = projected.buffer;
    } else if (projected) {
      x = dispatchActivation(device, encoder, x, projected.buffer, dimResBlocks[i] * H * W, 2);
    }

    // res_blocks
    for (let j = 0; j < numResBlocks[i]; j++) {
      x = dispatchResidualConvBlock(device, encoder, x, weights.levels[i].res_blocks[j], {
        inC: dimResBlocks[i], outC: dimResBlocks[i], hiddenC: dimResBlocks[i],
        H, W, inNorm: resBlockInNorm, hiddenNorm: resBlockHiddenNorm,
      });
    }

    // output_block: 1x1 conv if dimOut specified
    if (dimOut[i] != null) {
      const out = dispatchConv1x1(device, encoder, x,
        weights.levels[i].output_weight, weights.levels[i].output_bias,
        { inC: dimResBlocks[i], outC: dimOut[i], H, W });
      outFeatures.push({ buffer: out.buffer, C: dimOut[i], H, W });
    } else {
      outFeatures.push({ buffer: x, C: dimResBlocks[i], H, W });
    }

    // resampler between levels
    if (i < numLevels - 1 && resamplers[i]) {
      const resampled = dispatchResampler(device, encoder, x,
        weights.levels[i].resampler, {
          inC: dimResBlocks[i], outC: dimResBlocks[i + 1],
          H, W, type: resamplers[i],
        });
      x = resampled.buffer;
    }
  }

  return outFeatures;
}

/**
 * Cooperative ConvStack: identical dispatch stream to dispatchConvStack, but
 * submits per level and hands each finished chunk to `onLevelChunk(encoder,
 * meta)` (which owns submit/wait/yield and returns nothing); a fresh encoder
 * is created for the next level. Buffers persist across submits, so numerics
 * match the monolithic path exactly.
 */

// Cooperative residual conv block: identical dispatch stream to
// dispatchResidualConvBlock, split into two submits between the two 3x3
// convs (each conv is roughly half the block's GPU time at high resolution).
async function dispatchResidualConvBlockCooperative(device, encoder, inputBuf, weights, params, onSplit) {
  const { inC, outC, hiddenC, H, W, inNorm, hiddenNorm } = params;
  let x = inputBuf;
  if (inNorm !== 'none') {
    const numGroups = inNorm === 'group_norm' ? Math.floor(inC / 32) : 1;
    x = dispatchGroupNorm(device, encoder, x, weights.norm1_scale, weights.norm1_bias,
      { C: inC, H, W, numGroups });
  }
  let convOut;
  if (inNorm === 'none') {
    convOut = dispatchReluConv2d(device, encoder, x, weights.conv1_weight, weights.conv1_bias,
      { inC, inH: H, inW: W, outC: hiddenC, kH: 3, kW: 3, padH: 1, padW: 1, strideH: 1, strideW: 1 });
  } else {
    x = dispatchActivation(device, encoder, x, null, inC * H * W, 0);
    convOut = dispatchConv2d(device, encoder, x, weights.conv1_weight, weights.conv1_bias,
      { inC, inH: H, inW: W, outC: hiddenC, kH: 3, kW: 3, padH: 1, padW: 1, strideH: 1, strideW: 1 });
  }
  x = convOut.buffer;

  encoder = await onSplit(encoder);

  if (hiddenNorm !== 'none') {
    const numGroups = hiddenNorm === 'group_norm' ? Math.floor(hiddenC / 32) : 1;
    x = dispatchGroupNorm(device, encoder, x, weights.norm2_scale, weights.norm2_bias,
      { C: hiddenC, H, W, numGroups });
  }
  if (hiddenNorm === 'none') {
    convOut = dispatchReluConv2d(device, encoder, x, weights.conv2_weight, weights.conv2_bias,
      { inC: hiddenC, inH: H, inW: W, outC, kH: 3, kW: 3, padH: 1, padW: 1, strideH: 1, strideW: 1 });
  } else {
    x = dispatchActivation(device, encoder, x, null, hiddenC * H * W, 0);
    convOut = dispatchConv2d(device, encoder, x, weights.conv2_weight, weights.conv2_bias,
      { inC: hiddenC, inH: H, inW: W, outC, kH: 3, kW: 3, padH: 1, padW: 1, strideH: 1, strideW: 1 });
  }
  let skip;
  if (inC !== outC && weights.skip_weight) {
    skip = dispatchConv1x1(device, encoder, inputBuf, weights.skip_weight, null,
      { inC, outC, H, W }).buffer;
  } else {
    skip = inputBuf;
  }
  const out = dispatchActivation(device, encoder, convOut.buffer, skip, outC * H * W, 2);
  return { buffer: out, encoder };
}

async function dispatchConvStackCooperative(device, encoder, inFeatures, weights, config, onLevelChunk, { splitResBlocks = false } = {}) {
  const { dimIn, dimResBlocks, dimOut, numResBlocks, resamplers, resBlockInNorm, resBlockHiddenNorm } = config;
  const numLevels = dimResBlocks.length;
  const outFeatures = [];
  let x = null;

  for (let i = 0; i < numLevels; i++) {
    const H = inFeatures[i].H;
    const W = inFeatures[i].W;

    let projected = null;
    if (dimIn[i] != null && inFeatures[i].buffer != null) {
      projected = dispatchConv1x1(device, encoder, inFeatures[i].buffer,
        weights.levels[i].input_weight, weights.levels[i].input_bias,
        { inC: dimIn[i], outC: dimResBlocks[i], H, W });
    }

    if (i === 0) {
      x = projected.buffer;
    } else if (projected) {
      x = dispatchActivation(device, encoder, x, projected.buffer, dimResBlocks[i] * H * W, 2);
    }

    for (let j = 0; j < numResBlocks[i]; j++) {
      // Sub-level granularity: each res block splits into two submits (one
      // per 3x3 conv), so no single submission approaches a frame budget
      // even at the highest-resolution levels.
      if (splitResBlocks) {
        const r = await dispatchResidualConvBlockCooperative(device, encoder, x,
          weights.levels[i].res_blocks[j], {
            inC: dimResBlocks[i], outC: dimResBlocks[i], hiddenC: dimResBlocks[i],
            H, W, inNorm: resBlockInNorm, hiddenNorm: resBlockHiddenNorm,
          }, async splitEncoder => {
            await onLevelChunk(splitEncoder, { level: i, numLevels, H, W, part: `res-block-${j}:conv1` });
            return device.createCommandEncoder();
          });
        x = r.buffer;
        encoder = r.encoder;
        await onLevelChunk(encoder, { level: i, numLevels, H, W, part: `res-block-${j}:conv2` });
        encoder = device.createCommandEncoder();
      } else {
        x = dispatchResidualConvBlock(device, encoder, x, weights.levels[i].res_blocks[j], {
          inC: dimResBlocks[i], outC: dimResBlocks[i], hiddenC: dimResBlocks[i],
          H, W, inNorm: resBlockInNorm, hiddenNorm: resBlockHiddenNorm,
        });
      }
    }

    if (dimOut[i] != null) {
      const out = dispatchConv1x1(device, encoder, x,
        weights.levels[i].output_weight, weights.levels[i].output_bias,
        { inC: dimResBlocks[i], outC: dimOut[i], H, W });
      outFeatures.push({ buffer: out.buffer, C: dimOut[i], H, W });
    } else {
      outFeatures.push({ buffer: x, C: dimResBlocks[i], H, W });
    }

    // Split the level tail too: at high resolution the output conv and the
    // resampler are each frame-budget-sized on their own.
    if (splitResBlocks && i < numLevels - 1 && resamplers[i]) {
      await onLevelChunk(encoder, { level: i, numLevels, H, W, part: 'output-block' });
      encoder = device.createCommandEncoder();
    }

    if (i < numLevels - 1 && resamplers[i]) {
      const resampled = dispatchResampler(device, encoder, x,
        weights.levels[i].resampler, {
          inC: dimResBlocks[i], outC: dimResBlocks[i + 1],
          H, W, type: resamplers[i],
        });
      x = resampled.buffer;
    }

    await onLevelChunk(encoder, { level: i, numLevels, H, W, part: splitResBlocks ? 'tail' : undefined });
    encoder = device.createCommandEncoder();
  }

  return { outFeatures, encoder };
}

async function dispatchConvStackProfiledByLevel(device, encoder, inFeatures, weights, config) {
  const { dimIn, dimResBlocks, dimOut, numResBlocks, resamplers, resBlockInNorm, resBlockHiddenNorm } = config;
  const numLevels = dimResBlocks.length;
  const outFeatures = [];
  const levels = [];
  let x = null;

  for (let i = 0; i < numLevels; i++) {
    const H = inFeatures[i].H;
    const W = inFeatures[i].W;

    let projected = null;
    if (dimIn[i] != null && inFeatures[i].buffer != null) {
      projected = dispatchConv1x1(device, encoder, inFeatures[i].buffer,
        weights.levels[i].input_weight, weights.levels[i].input_bias,
        { inC: dimIn[i], outC: dimResBlocks[i], H, W });
    }

    if (i === 0) {
      x = projected.buffer;
    } else if (projected) {
      x = dispatchActivation(device, encoder, x, projected.buffer, dimResBlocks[i] * H * W, 2);
    }

    for (let j = 0; j < numResBlocks[i]; j++) {
      x = dispatchResidualConvBlock(device, encoder, x, weights.levels[i].res_blocks[j], {
        inC: dimResBlocks[i], outC: dimResBlocks[i], hiddenC: dimResBlocks[i],
        H, W, inNorm: resBlockInNorm, hiddenNorm: resBlockHiddenNorm,
      });
    }

    const outputC = dimOut[i] != null ? dimOut[i] : dimResBlocks[i];
    if (dimOut[i] != null) {
      const out = dispatchConv1x1(device, encoder, x,
        weights.levels[i].output_weight, weights.levels[i].output_bias,
        { inC: dimResBlocks[i], outC: dimOut[i], H, W });
      outFeatures.push({ buffer: out.buffer, C: dimOut[i], H, W });
    } else {
      outFeatures.push({ buffer: x, C: dimResBlocks[i], H, W });
    }

    if (i < numLevels - 1 && resamplers[i]) {
      const resampled = dispatchResampler(device, encoder, x,
        weights.levels[i].resampler, {
          inC: dimResBlocks[i], outC: dimResBlocks[i + 1],
          H, W, type: resamplers[i],
        });
      x = resampled.buffer;
    }

    const waitStart = performance.now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const submitWaitMs = performance.now() - waitStart;
    levels.push({
      level: i,
      submitWaitMs,
      shape: [outputC, H, W],
      dimIn: dimIn[i],
      dimResBlocks: dimResBlocks[i],
      numResBlocks: numResBlocks[i],
      resampler: i < numLevels - 1 ? (resamplers[i] || null) : null,
    });
    encoder = device.createCommandEncoder();
  }

  return { outFeatures, encoder, levels };
}

async function submitProfileStage(device, encoder, stages, stage) {
  const waitStart = performance.now();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  stages.push({
    ...stage,
    submitWaitMs: performance.now() - waitStart,
  });
  return device.createCommandEncoder();
}

async function dispatchConvStackProfiledInternals(device, encoder, inFeatures, weights, config, targetLevel) {
  const { dimIn, dimResBlocks, dimOut, numResBlocks, resamplers, resBlockInNorm, resBlockHiddenNorm } = config;
  const numLevels = dimResBlocks.length;
  const outFeatures = [];
  const stages = [];
  let x = null;

  for (let i = 0; i < numLevels; i++) {
    const H = inFeatures[i].H;
    const W = inFeatures[i].W;
    const isTarget = i === targetLevel;

    let projected = null;
    if (dimIn[i] != null && inFeatures[i].buffer != null) {
      projected = dispatchConv1x1(device, encoder, inFeatures[i].buffer,
        weights.levels[i].input_weight, weights.levels[i].input_bias,
        { inC: dimIn[i], outC: dimResBlocks[i], H, W });
    }

    if (i === 0) {
      x = projected.buffer;
    } else if (projected) {
      x = dispatchActivation(device, encoder, x, projected.buffer, dimResBlocks[i] * H * W, 2);
    }

    if (isTarget) {
      encoder = await submitProfileStage(device, encoder, stages, {
        name: 'inputAdd',
        shape: [dimResBlocks[i], H, W],
      });
    }

    for (let j = 0; j < numResBlocks[i]; j++) {
      x = dispatchResidualConvBlock(device, encoder, x, weights.levels[i].res_blocks[j], {
        inC: dimResBlocks[i], outC: dimResBlocks[i], hiddenC: dimResBlocks[i],
        H, W, inNorm: resBlockInNorm, hiddenNorm: resBlockHiddenNorm,
      });
      if (isTarget) {
        encoder = await submitProfileStage(device, encoder, stages, {
          name: `resBlock${j}`,
          shape: [dimResBlocks[i], H, W],
        });
      }
    }

    const outputC = dimOut[i] != null ? dimOut[i] : dimResBlocks[i];
    if (dimOut[i] != null) {
      const out = dispatchConv1x1(device, encoder, x,
        weights.levels[i].output_weight, weights.levels[i].output_bias,
        { inC: dimResBlocks[i], outC: dimOut[i], H, W });
      outFeatures.push({ buffer: out.buffer, C: dimOut[i], H, W });
    } else {
      outFeatures.push({ buffer: x, C: dimResBlocks[i], H, W });
    }

    if (isTarget) {
      if (dimOut[i] != null) {
        encoder = await submitProfileStage(device, encoder, stages, {
          name: 'output',
          shape: [outputC, H, W],
        });
      } else {
        stages.push({
          name: 'output',
          submitWaitMs: 0,
          shape: [outputC, H, W],
          noOp: true,
        });
      }
    }

    if (i < numLevels - 1 && resamplers[i]) {
      const resampled = dispatchResampler(device, encoder, x,
        weights.levels[i].resampler, {
          inC: dimResBlocks[i], outC: dimResBlocks[i + 1],
          H, W, type: resamplers[i],
        });
      x = resampled.buffer;
      if (isTarget) {
        encoder = await submitProfileStage(device, encoder, stages, {
          name: 'resampler',
          shape: [dimResBlocks[i + 1], resampled.H, resampled.W],
          resampler: resamplers[i],
        });
      }
    }

    if (!isTarget) {
      performance.now();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      encoder = device.createCommandEncoder();
    }
  }

  return { outFeatures, encoder, stages };
}

async function dispatchConvStackProfiledResampler(device, encoder, inFeatures, weights, config, targetLevel) {
  const { dimIn, dimResBlocks, dimOut, numResBlocks, resamplers, resBlockInNorm, resBlockHiddenNorm } = config;
  const numLevels = dimResBlocks.length;
  const outFeatures = [];
  const stages = [];
  let x = null;
  let targetResampler = null;
  let preResamplerSubmitWaitMs = null;

  for (let i = 0; i < numLevels; i++) {
    const H = inFeatures[i].H;
    const W = inFeatures[i].W;
    const isTarget = i === targetLevel;

    let projected = null;
    if (dimIn[i] != null && inFeatures[i].buffer != null) {
      projected = dispatchConv1x1(device, encoder, inFeatures[i].buffer,
        weights.levels[i].input_weight, weights.levels[i].input_bias,
        { inC: dimIn[i], outC: dimResBlocks[i], H, W });
    }

    if (i === 0) {
      x = projected.buffer;
    } else if (projected) {
      x = dispatchActivation(device, encoder, x, projected.buffer, dimResBlocks[i] * H * W, 2);
    }

    for (let j = 0; j < numResBlocks[i]; j++) {
      x = dispatchResidualConvBlock(device, encoder, x, weights.levels[i].res_blocks[j], {
        inC: dimResBlocks[i], outC: dimResBlocks[i], hiddenC: dimResBlocks[i],
        H, W, inNorm: resBlockInNorm, hiddenNorm: resBlockHiddenNorm,
      });
    }

    if (dimOut[i] != null) {
      const out = dispatchConv1x1(device, encoder, x,
        weights.levels[i].output_weight, weights.levels[i].output_bias,
        { inC: dimResBlocks[i], outC: dimOut[i], H, W });
      outFeatures.push({ buffer: out.buffer, C: dimOut[i], H, W });
    } else {
      outFeatures.push({ buffer: x, C: dimResBlocks[i], H, W });
    }

    if (i < numLevels - 1 && resamplers[i]) {
      if (isTarget) {
        const waitStart = performance.now();
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        preResamplerSubmitWaitMs = performance.now() - waitStart;
        encoder = device.createCommandEncoder();

        targetResampler = resamplers[i];
        const resampled = await dispatchResamplerProfiled(device, encoder, x,
          weights.levels[i].resampler, {
            inC: dimResBlocks[i], outC: dimResBlocks[i + 1],
            H, W, type: resamplers[i],
          }, stages);
        x = resampled.buffer;
        encoder = resampled.encoder;
      } else {
        const resampled = dispatchResampler(device, encoder, x,
          weights.levels[i].resampler, {
            inC: dimResBlocks[i], outC: dimResBlocks[i + 1],
            H, W, type: resamplers[i],
          });
        x = resampled.buffer;
      }
    }

    if (!isTarget) {
      performance.now();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      encoder = device.createCommandEncoder();
    }
  }

  return { outFeatures, encoder, stages, resampler: targetResampler, preResamplerSubmitWaitMs };
}


// Hosted fp16 weights (see tools/convert_weights.py for how they were produced).
const HOSTED_WEIGHTS_URL = 'https://huggingface.co/lyonsno/moge-webgpu/resolve/main/weights.bin';

// Prefer a locally converted public/weights.bin; fall back to the hosted copy.
// Vite's SPA fallback answers missing files with 200 text/html, so a plain
// fetch cannot distinguish "no local weights" from success — check content-type.
async function resolveWeightsUrl() {
  try {
    const head = await fetch('/weights.bin', { method: 'HEAD' });
    const type = head.headers.get('content-type') || '';
    if (head.ok && !type.includes('text/html')) return '/weights.bin';
  } catch (e) { /* fall through to hosted */ }
  return HOSTED_WEIGHTS_URL;
}

class MoGeInference {
  constructor(gpu) {
    this.device = gpu.device;
    this.backendIdentity = gpu.backendIdentity || null;
    this.weights = null;
    this.backbone = null;
  }

  async init(onProgress) {
    try {
      // Test hook: harnesses that assert stub-route semantics (e.g. the route
      // receipt contract) opt in explicitly, since the hosted-weights fallback
      // otherwise makes stub mode unreachable in any networked browser.
      if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('forceStub')) {
        throw new Error('forced stub weights (forceStub test mode)');
      }
      const weightsUrl = await resolveWeightsUrl();
      this.weights = await loadWeights(this.device, weightsUrl, onProgress);
      this.useRealWeights = true;
      this.weightsSource = weightsUrl === HOSTED_WEIGHTS_URL ? 'hosted' : 'local';
      console.log(`Loaded real MoGe-2 weights (${this.weightsSource}: ${weightsUrl})`);

      // Initialize backbone
      this.backbone = new DINOv2Backbone(this.device);
      this.backbone.init();
      console.log('DINOv2 backbone initialized');

      // Expose for console debugging
      window.__mogeInference = this;
    } catch (e) {
      console.warn('Failed to load real weights, using stubs:', e.message);
      this.weights = this._createStubWeights();
      this.useRealWeights = false;
    }
  }

  _createStubWeights() {
    const d = this.device;
    const rand = (n) => {
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = (Math.random() - 0.5) * 0.02;
      return createStorageBuffer(d, data);
    };
    const zeros = (n) => createStorageBuffer(d, new Float32Array(n));
    const ones = (n) => {
      const data = new Float32Array(n);
      data.fill(1.0);
      return createStorageBuffer(d, data);
    };

    const makeResBlock = (C, hiddenC) => ({
      norm1_scale: ones(C),
      norm1_bias: zeros(C),
      conv1_weight: rand(hiddenC * C * 3 * 3),
      conv1_bias: zeros(hiddenC),
      norm2_scale: ones(hiddenC),
      norm2_bias: zeros(hiddenC),
      conv2_weight: rand(C * hiddenC * 3 * 3),
      conv2_bias: zeros(C),
      skip_weight: null,
    });

    const makeResampler = (inC, outC, type) => {
      if (type === 'conv_transpose') {
        return {
          deconv_weight: rand(inC * outC * 2 * 2),  // [inC, outC, 2, 2]
          deconv_bias: zeros(outC),
          conv_weight: rand(outC * outC * 3 * 3),
          conv_bias: zeros(outC),
        };
      } else {
        // bilinear: no deconv, just conv after upsample
        return {
          conv_weight: rand(outC * inC * 3 * 3),
          conv_bias: zeros(outC),
        };
      }
    };

    const makeConvStackWeights = (config) => ({
      levels: config.dimResBlocks.map((dimRB, i) => ({
        input_weight: config.dimIn[i] != null ? rand(dimRB * config.dimIn[i]) : null,
        input_bias: config.dimIn[i] != null ? zeros(dimRB) : null,
        res_blocks: Array.from({ length: config.numResBlocks[i] },
          () => makeResBlock(dimRB, dimRB)),
        output_weight: config.dimOut[i] != null ? rand(config.dimOut[i] * dimRB) : null,
        output_bias: config.dimOut[i] != null ? zeros(config.dimOut[i]) : null,
        resampler: i < config.dimResBlocks.length - 1 && config.resamplers[i]
          ? makeResampler(dimRB, config.dimResBlocks[i + 1], config.resamplers[i])
          : null,
      })),
    });

    return {
      neck: makeConvStackWeights(MODEL_CONFIG.neck),
      pointsHead: makeConvStackWeights(MODEL_CONFIG.pointsHead),
      normalHead: makeConvStackWeights(MODEL_CONFIG.normalHead),
      maskHead: makeConvStackWeights(MODEL_CONFIG.maskHead),
    };
  }

  /**
   * Try to load test fixture (real encoder features from PyTorch).
   */
  async _loadFixture() {
    try {
      const metaResp = await fetch('/test_fixtures/metadata.json');
      if (!metaResp.ok) return null;
      const meta = await metaResp.json();

      const [featBuf, clsBuf] = await Promise.all([
        fetch('/test_fixtures/encoder_features.bin').then(r => r.arrayBuffer()),
        fetch('/test_fixtures/cls_token.bin').then(r => r.arrayBuffer()),
      ]);

      console.log(`Loaded test fixture: tokenH=${meta.tokenH}, tokenW=${meta.tokenW}`);
      return {
        features: new Float32Array(featBuf),
        clsToken: new Float32Array(clsBuf),
        tokenH: meta.tokenH,
        tokenW: meta.tokenW,
        meta,
      };
    } catch (e) {
      console.warn('No test fixture available:', e.message);
      return null;
    }
  }

  /**
   * Run backbone comparison against PyTorch reference tensors.
   * Usage from console: await window.__mogeInference.runBackboneCompare()
   */
  async runBackboneCompare() {
    if (!this.backbone || !this.useRealWeights) {
      console.error('Backbone not initialized or using stub weights');
      return;
    }
    const device = this.device;
    const tokenH = 37, tokenW = 37;

    // Load normalized input from layer dumps (same image used for PyTorch reference)
    const resp = await fetch('/layer_dumps/input_normalized.bin');
    const inputData = new Float32Array(await resp.arrayBuffer());
    console.log(`Loaded reference input: [3, ${tokenH * 14}, ${tokenW * 14}], ${inputData.length} floats`);

    const imageBuf = createStorageBuffer(device, inputData);
    await this.backbone.debugCompare(imageBuf, this.weights, tokenH, tokenW);
    imageBuf.destroy();
  }

  /**
   * Detailed sub-block analysis of transformer block 0.
   * Usage from console: await window.__mogeInference.runBlock0Compare()
   */
  async runBlock0Compare() {
    if (!this.backbone || !this.useRealWeights) {
      console.error('Backbone not initialized');
      return;
    }
    const device = this.device;
    const tokenH = 37, tokenW = 37;
    const resp = await fetch('/layer_dumps/input_normalized.bin');
    const inputData = new Float32Array(await resp.arrayBuffer());
    const imageBuf = createStorageBuffer(device, inputData);
    await this.backbone.debugBlock0(imageBuf, this.weights, tokenH, tokenW);
    imageBuf.destroy();
  }

  /**
   * Run full inference.
   */
  async run(imageData, options = {}) {
    const totalStart = performance.now();
    const phaseTimings = {};
    const { width, height } = imageData;
    const device = this.device;
    const encoderDim = MODEL_CONFIG.encoder.dimOut;

    // Determine token grid size
    // Use 37x37 to match the pretrained position embedding grid (1370 tokens = 1 CLS + 37*37)
    // This avoids needing position embedding interpolation for now
    const tokenH = 37;
    const tokenW = 37;

    // --- Encoder ---
    let encoderData;
    let clsTokenData = null;
    let useBackbone = this.backbone && this.useRealWeights;

    const preprocessStart = performance.now();

    // Prepare image for backbone: normalize with ImageNet mean/std, resize to tokenH*14 x tokenW*14
    const imgH = tokenH * MODEL_CONFIG.patchSize;
    const imgW = tokenW * MODEL_CONFIG.patchSize;

    // Convert input image to CHW float [0,1], then normalize
    const imageMean = [0.485, 0.456, 0.406];
    const imageStd = [0.229, 0.224, 0.225];
    const normalizedImage = new Float32Array(3 * imgH * imgW);

    // Resize imageData to imgH x imgW using a temp canvas
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = imgW;
    tmpCanvas.height = imgH;
    const tmpCtx = tmpCanvas.getContext('2d');
    // Create ImageBitmap from the original imageData
    const origCanvas = document.createElement('canvas');
    origCanvas.width = width;
    origCanvas.height = height;
    origCanvas.getContext('2d').putImageData(imageData, 0, 0);
    tmpCtx.drawImage(origCanvas, 0, 0, imgW, imgH);
    const resizedData = tmpCtx.getImageData(0, 0, imgW, imgH);

    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < imgH * imgW; i++) {
        const pixel = resizedData.data[i * 4 + c] / 255.0;
        normalizedImage[c * imgH * imgW + i] = (pixel - imageMean[c]) / imageStd[c];
      }
    }
    phaseTimings.preprocessMs = performance.now() - preprocessStart;

    let backboneFeatureBuf = null;
    let backboneClsTokenBuf = null;
    let imageBuf = null;
    const tempUploadBuffers = [];
    const coop = resolveCooperativeScheduler(options.scheduler);
    const profileStagedGpu = !!options.profileStagedGpu;
    const stagedSubmits = profileStagedGpu || !!coop;
    const profileDecoderSubstages = !!options.profileDecoderSubstages;
    if (coop && profileDecoderSubstages) {
      // The substage profiler owns the decoder submits and bypasses the
      // cooperative decoder-heads seam, which would leave decoderSubmitWaitMs
      // unassigned (NaN total) and silently drop that phase's yields.
      throw new Error('cooperative scheduling and profileDecoderSubstages cannot be combined');
    }
    const profileNeckLevels = !!options.profileNeckLevels;
    const profileNeckInternalsLevel = Number.isInteger(options.profileNeckInternals?.level)
      ? options.profileNeckInternals.level
      : null;
    const profileNeckResamplerLevel = Number.isInteger(options.profileNeckResampler?.level)
      ? options.profileNeckResampler.level
      : null;
    const stagedGpuPhaseTimings = stagedSubmits
      ? { route: coop ? 'cooperative-staged-submits' : 'staged-submits' }
      : null;
    const decoderSubstageTimings = profileDecoderSubstages
      ? { route: 'decoder-staged-submits' }
      : null;
    const neckLevelTimings = profileNeckLevels
      ? { route: 'neck-level-staged-submits', levels: [] }
      : null;
    const neckInternalTimings = profileNeckInternalsLevel !== null
      ? { route: 'neck-internal-staged-submits', level: profileNeckInternalsLevel, stages: [] }
      : null;
    const neckResamplerTimings = profileNeckResamplerLevel !== null
      ? { route: 'neck-resampler-staged-submits', level: profileNeckResamplerLevel, stages: [] }
      : null;
    let commandEncoder = device.createCommandEncoder();
    // GPU timestamp brackets assume the monolithic single-encoder flow;
    // cooperative chunked submits use queue-submit-wait timing instead.
    const gpuTimestampProfile = options.profileGpuTimestamps && !coop
      ? createGpuTimestampProfile(device, 4)
      : null;
    const runtimeEvidence = {
      weights: this.useRealWeights ? 'real' : 'stub',
      encoderFeatures: null,
    };
    writeGpuTimestamp(gpuTimestampProfile, commandEncoder, 0);

    if (useBackbone) {
      imageBuf = createStorageBuffer(device, normalizedImage);

      const backboneEncodeStart = performance.now();
      if (coop) {
        // Cooperative path: per-chunk submits with browser yields between them.
        // Work buffers persist across submits, so numerics match encode().
        let backboneWaitMs = 0;
        const { featureBuf, clsTokenBuf } = await this.backbone.encodeChunked(
          imageBuf, this.weights, tokenH, tokenW, {
            chunkBlocks: coop.vitBlockChunkSize,
            splitBlocks: coop.splitVitBlocks,
            onChunk: async (chunkEncoder, meta) => {
              coopEvent(coop, 'backbone', 'queue-work-done-start', meta.kind === 'vit-blocks'
                ? { firstBlock: meta.firstBlock, lastBlock: meta.lastBlock }
                : (meta.kind === 'vit-block-segment'
                  ? { chunk: `block-${meta.block}:${meta.segmentName}` }
                  : { chunk: meta.kind }));
              const waitStart = performance.now();
              device.queue.submit([chunkEncoder.finish()]);
              if (coop.waitForSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
              const waitMs = performance.now() - waitStart;
              backboneWaitMs += waitMs;
              coopEvent(coop, 'backbone', 'queue-work-done-end', { waitMs });
              await coopYield(coop, 'backbone');
            },
          }
        );
        backboneFeatureBuf = featureBuf;
        backboneClsTokenBuf = clsTokenBuf;
        stagedGpuPhaseTimings.backboneSubmitWaitMs = backboneWaitMs;
      } else {
        const { featureBuf, clsTokenBuf } = this.backbone.encode(
          commandEncoder, imageBuf, this.weights, tokenH, tokenW
        );
        // Keep feature and CLS buffers on GPU — no readback here
        backboneFeatureBuf = featureBuf;
        backboneClsTokenBuf = clsTokenBuf;

        if (profileStagedGpu) {
          const waitStart = performance.now();
          device.queue.submit([commandEncoder.finish()]);
          await device.queue.onSubmittedWorkDone();
          stagedGpuPhaseTimings.backboneSubmitWaitMs = performance.now() - waitStart;
          commandEncoder = device.createCommandEncoder();
        }
      }
      phaseTimings.backboneEncodeMs = performance.now() - backboneEncodeStart;
      runtimeEvidence.encoderFeatures = 'backbone-gpu';
    } else {
      phaseTimings.backboneEncodeMs = 0;
      if (stagedSubmits) stagedGpuPhaseTimings.backboneSubmitWaitMs = 0;
      // Try fixture, then fall back to correctly shaped random features.
      const fixture = await this._loadFixture();
      const encoderSelection = selectCpuFallbackEncoderFeatures({
        fixture,
        encoderDim,
        tokenH,
        tokenW,
      });
      encoderData = encoderSelection.features;
      clsTokenData = encoderSelection.clsToken;
      runtimeEvidence.encoderFeatures = encoderSelection.source;
      if (typeof window !== 'undefined') {
        window.__mogeDebug = window.__mogeDebug || {};
        window.__mogeDebug.encoderFeatureSource = encoderSelection.source;
        window.__mogeDebug.rejectedEncoderFixture = encoderSelection.rejectedFixture;
      }
      if (encoderSelection.source === 'fixture') {
        console.log(`Using fixture encoder features`);
      } else if (encoderSelection.source === 'stub-shape-mismatch') {
        console.warn(
          `Ignoring incompatible fixture encoder features: expected ${encoderSelection.rejectedFixture.expectedLength} floats ` +
          `for ${tokenH}x${tokenW}, got ${encoderSelection.rejectedFixture.actualLength} floats ` +
          `for ${encoderSelection.rejectedFixture.fixtureTokenH}x${encoderSelection.rejectedFixture.fixtureTokenW}; using stub encoder features`
        );
      } else {
        console.log(`Using stub encoder features`);
      }
    }
    writeGpuTimestamp(gpuTimestampProfile, commandEncoder, 1);

    // Build neck input features: encoder features + UV coords at 5 scales
    const aspect = width / height;
    const neckInputs = [];

    function makeUV(h, w, aspect) {
      const spanX = aspect / Math.sqrt(1 + aspect * aspect);
      const spanY = 1 / Math.sqrt(1 + aspect * aspect);
      const uv = new Float32Array(2 * h * w);
      for (let y = 0; y < h; y++) {
        const v = -spanY * (h - 1) / h + (2 * spanY * (h - 1) / h) * y / (h - 1 || 1);
        for (let x = 0; x < w; x++) {
          const u = -spanX * (w - 1) / w + (2 * spanX * (w - 1) / w) * x / (w - 1 || 1);
          uv[0 * h * w + y * w + x] = u;
          uv[1 * h * w + y * w + x] = v;
        }
      }
      return uv;
    }

    for (let level = 0; level < 5; level++) {
      const h = tokenH * (2 ** level);
      const w = tokenW * (2 ** level);
      const dimIn = MODEL_CONFIG.neck.dimIn[level];

      if (level === 0 && backboneFeatureBuf) {
        // Zero-copy: concatenate backbone GPU buffer with UV on GPU
        const totalSize = dimIn * h * w * 4;
        const combinedBuf = createEmptyBuffer(device, totalSize);
        // Copy backbone features [1024, tokenH, tokenW] from GPU buffer
        const featureBytes = encoderDim * h * w * 4;
        commandEncoder.copyBufferToBuffer(backboneFeatureBuf, 0, combinedBuf, 0, featureBytes);
        // Upload UV coords to the remaining 2*h*w region
        const uv = makeUV(h, w, aspect);
        const uvBuf = createStorageBuffer(device, uv);
        commandEncoder.copyBufferToBuffer(uvBuf, 0, combinedBuf, featureBytes, uv.byteLength);
        tempUploadBuffers.push(uvBuf);
        neckInputs.push({ buffer: combinedBuf, H: h, W: w });
      } else if (level === 0 && encoderData) {
        // CPU fallback path (stub/fixture features)
        const data = new Float32Array(dimIn * h * w);
        const uv = makeUV(h, w, aspect);
        data.set(encoderData, 0);
        data.set(uv, encoderDim * h * w);
        neckInputs.push({ buffer: createStorageBuffer(device, data), H: h, W: w });
      } else {
        // UV only [2, h, w]
        const uv = makeUV(h, w, aspect);
        neckInputs.push({ buffer: createStorageBuffer(device, uv), H: h, W: w });
      }
    }
    writeGpuTimestamp(gpuTimestampProfile, commandEncoder, 2);
    if (stagedSubmits) {
      if (coop) coopEvent(coop, 'decoder-heads', 'queue-work-done-start', { chunk: 'neck-input' });
      const waitStart = performance.now();
      device.queue.submit([commandEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      stagedGpuPhaseTimings.neckInputSubmitWaitMs = performance.now() - waitStart;
      if (coop) {
        coopEvent(coop, 'decoder-heads', 'queue-work-done-end', { waitMs: stagedGpuPhaseTimings.neckInputSubmitWaitMs });
        await coopYield(coop, 'decoder-heads');
      }
      commandEncoder = device.createCommandEncoder();
    }

    // Submit backbone (if used) and start decoder in one encoder
    // No separate submit — backbone and decoder buffer copies share this encoder
    let decoderEncoder = commandEncoder;
    if (profileNeckLevels || neckInternalTimings || neckResamplerTimings) {
      const waitStart = performance.now();
      device.queue.submit([decoderEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      const preNeckSubmitWaitMs = performance.now() - waitStart;
      if (profileNeckLevels) neckLevelTimings.preNeckSubmitWaitMs = preNeckSubmitWaitMs;
      if (neckInternalTimings) neckInternalTimings.preNeckSubmitWaitMs = preNeckSubmitWaitMs;
      if (neckResamplerTimings) neckResamplerTimings.preNeckSubmitWaitMs = preNeckSubmitWaitMs;
      decoderEncoder = device.createCommandEncoder();
    }

    // Neck
    const neckAndHeadsEncodeStart = performance.now();
    // Cooperative decoder chunking: each ConvStack level (neck + each head) is
    // its own submit + yield, so the decoder can no longer produce a single
    // 1s+ queue occupancy (the dominant foreground hitch in composition runs).
    let coopDecoderWaitMs = 0;
    const coopLevelHook = label => async (levelEncoder, meta) => {
      const chunkLabel = `${label}:level-${meta.level}${meta.part ? `:${meta.part}` : ''}`;
      coopEvent(coop, 'decoder-heads', 'queue-work-done-start', { chunk: chunkLabel });
      const waitStart = performance.now();
      device.queue.submit([levelEncoder.finish()]);
      if (coop.waitForSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
      const waitMs = performance.now() - waitStart;
      coopDecoderWaitMs += waitMs;
      coopEvent(coop, 'decoder-heads', 'queue-work-done-end', { waitMs });
      await coopYield(coop, 'decoder-heads');
    };
    let neckOutputs;
    if (neckResamplerTimings) {
      const profiledNeck = await dispatchConvStackProfiledResampler(
        device, decoderEncoder, neckInputs, this.weights.neck, MODEL_CONFIG.neck, profileNeckResamplerLevel
      );
      neckOutputs = profiledNeck.outFeatures;
      decoderEncoder = profiledNeck.encoder;
      neckResamplerTimings.stages = profiledNeck.stages;
      neckResamplerTimings.resampler = profiledNeck.resampler;
      neckResamplerTimings.preResamplerSubmitWaitMs = profiledNeck.preResamplerSubmitWaitMs;
      neckResamplerTimings.totalResamplerMs = profiledNeck.stages.reduce((sum, stage) => sum + stage.submitWaitMs, 0);
    } else if (neckInternalTimings) {
      const profiledNeck = await dispatchConvStackProfiledInternals(
        device, decoderEncoder, neckInputs, this.weights.neck, MODEL_CONFIG.neck, profileNeckInternalsLevel
      );
      neckOutputs = profiledNeck.outFeatures;
      decoderEncoder = profiledNeck.encoder;
      neckInternalTimings.stages = profiledNeck.stages;
      neckInternalTimings.totalLevelInternalMs = profiledNeck.stages.reduce((sum, stage) => sum + stage.submitWaitMs, 0);
    } else if (profileNeckLevels) {
      const profiledNeck = await dispatchConvStackProfiledByLevel(
        device, decoderEncoder, neckInputs, this.weights.neck, MODEL_CONFIG.neck
      );
      neckOutputs = profiledNeck.outFeatures;
      decoderEncoder = profiledNeck.encoder;
      neckLevelTimings.levels = profiledNeck.levels;
      neckLevelTimings.totalNeckLevelMs = profiledNeck.levels.reduce((sum, level) => sum + level.submitWaitMs, 0);
    } else if (coop) {
      const r = await dispatchConvStackCooperative(
        device, decoderEncoder, neckInputs, this.weights.neck, MODEL_CONFIG.neck, coopLevelHook('neck'),
        { splitResBlocks: coop.splitDecoderResBlocks });
      neckOutputs = r.outFeatures;
      decoderEncoder = r.encoder;
    } else {
      neckOutputs = dispatchConvStack(device, decoderEncoder, neckInputs, this.weights.neck, MODEL_CONFIG.neck);
    }
    if (profileDecoderSubstages) {
      const waitStart = performance.now();
      device.queue.submit([decoderEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      decoderSubstageTimings.neckSubmitWaitMs = performance.now() - waitStart;
      decoderEncoder = device.createCommandEncoder();
    }

    // Points head
    const pointsInputs = neckOutputs.map(f => ({ buffer: f.buffer, H: f.H, W: f.W }));
    let pointsOutputs;
    if (coop) {
      const r = await dispatchConvStackCooperative(
        device, decoderEncoder, pointsInputs, this.weights.pointsHead, MODEL_CONFIG.pointsHead, coopLevelHook('points-head'),
        { splitResBlocks: coop.splitDecoderResBlocks });
      pointsOutputs = r.outFeatures;
      decoderEncoder = r.encoder;
    } else {
      pointsOutputs = dispatchConvStack(device, decoderEncoder, pointsInputs, this.weights.pointsHead, MODEL_CONFIG.pointsHead);
    }
    if (profileDecoderSubstages) {
      const waitStart = performance.now();
      device.queue.submit([decoderEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      decoderSubstageTimings.pointsHeadSubmitWaitMs = performance.now() - waitStart;
      decoderEncoder = device.createCommandEncoder();
    }

    // Normal head
    const normalInputs = neckOutputs.map(f => ({ buffer: f.buffer, H: f.H, W: f.W }));
    let normalOutputs;
    if (coop) {
      const r = await dispatchConvStackCooperative(
        device, decoderEncoder, normalInputs, this.weights.normalHead, MODEL_CONFIG.normalHead, coopLevelHook('normal-head'),
        { splitResBlocks: coop.splitDecoderResBlocks });
      normalOutputs = r.outFeatures;
      decoderEncoder = r.encoder;
    } else {
      normalOutputs = dispatchConvStack(device, decoderEncoder, normalInputs, this.weights.normalHead, MODEL_CONFIG.normalHead);
    }
    if (profileDecoderSubstages) {
      const waitStart = performance.now();
      device.queue.submit([decoderEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      decoderSubstageTimings.normalHeadSubmitWaitMs = performance.now() - waitStart;
      decoderEncoder = device.createCommandEncoder();
    }

    // Mask head
    const maskInputs = neckOutputs.map(f => ({ buffer: f.buffer, H: f.H, W: f.W }));
    let maskOutputs;
    if (coop) {
      const r = await dispatchConvStackCooperative(
        device, decoderEncoder, maskInputs, this.weights.maskHead, MODEL_CONFIG.maskHead, coopLevelHook('mask-head'),
        { splitResBlocks: coop.splitDecoderResBlocks });
      maskOutputs = r.outFeatures;
      decoderEncoder = r.encoder;
    } else {
      maskOutputs = dispatchConvStack(device, decoderEncoder, maskInputs, this.weights.maskHead, MODEL_CONFIG.maskHead);
    }
    if (profileDecoderSubstages) {
      const waitStart = performance.now();
      device.queue.submit([decoderEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      decoderSubstageTimings.maskHeadSubmitWaitMs = performance.now() - waitStart;
    }
    phaseTimings.neckAndHeadsEncodeMs = performance.now() - neckAndHeadsEncodeStart;
    if (!profileDecoderSubstages) {
      writeGpuTimestamp(gpuTimestampProfile, decoderEncoder, 3);
      resolveGpuTimestamps(gpuTimestampProfile, decoderEncoder);
    }

    // Submit entire pipeline (backbone + decoder in one encoder)
    if (profileDecoderSubstages) ; else if (stagedSubmits) {
      if (coop) coopEvent(coop, 'decoder-heads', 'queue-work-done-start', { chunk: 'decoder-tail' });
      const waitStart = performance.now();
      device.queue.submit([decoderEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      const tailWaitMs = performance.now() - waitStart;
      stagedGpuPhaseTimings.decoderSubmitWaitMs = coopDecoderWaitMs + tailWaitMs;
      if (coop) {
        coopEvent(coop, 'decoder-heads', 'queue-work-done-end', { waitMs: tailWaitMs });
        await coopYield(coop, 'decoder-heads');
      }
    } else {
      device.queue.submit([decoderEncoder.finish()]);
    }
    if (imageBuf) imageBuf.destroy();
    tempUploadBuffers.forEach(buf => buf.destroy());

    // Read back final outputs (only the necessary ones)
    const lastPoints = pointsOutputs[pointsOutputs.length - 1];
    const lastNormals = normalOutputs[normalOutputs.length - 1];
    const lastMask = maskOutputs[maskOutputs.length - 1];

    if (coop) coopEvent(coop, 'output-readback', 'readback-wait-start');
    const gpuReadbackStart = performance.now();
    const [pointsRaw, normalsRaw, maskRaw] = await Promise.all([
      readBuffer(device, lastPoints.buffer, lastPoints.C * lastPoints.H * lastPoints.W * 4),
      readBuffer(device, lastNormals.buffer, lastNormals.C * lastNormals.H * lastNormals.W * 4),
      readBuffer(device, lastMask.buffer, lastMask.C * lastMask.H * lastMask.W * 4),
    ]);
    phaseTimings.gpuReadbackMs = performance.now() - gpuReadbackStart;
    if (stagedSubmits) stagedGpuPhaseTimings.outputReadbackMs = phaseTimings.gpuReadbackMs;
    if (coop) {
      coopEvent(coop, 'output-readback', 'readback-wait-end', { waitMs: phaseTimings.gpuReadbackMs });
      await coopYield(coop, 'output-readback');
    }
    const gpuTimestamps = await readGpuTimestamps(gpuTimestampProfile);

    const outH = lastPoints.H;
    const outW = lastPoints.W;

    // Diagnostic: check raw output ranges
    let pMin = Infinity, pMax = -Infinity, pNan = 0, pZero = 0;
    for (let i = 0; i < pointsRaw.length; i++) {
      if (isNaN(pointsRaw[i])) pNan++;
      if (pointsRaw[i] === 0) pZero++;
      if (isFinite(pointsRaw[i])) {
        pMin = Math.min(pMin, pointsRaw[i]);
        pMax = Math.max(pMax, pointsRaw[i]);
      }
    }
    const pointsDiag = `shape=[${lastPoints.C}, ${outH}, ${outW}], range=[${pMin.toFixed(4)}, ${pMax.toFixed(4)}], NaN=${pNan}, zeros=${pZero}/${pointsRaw.length}`;
    console.log(`Points raw: ${pointsDiag}`);
    window.__mogeDebug = window.__mogeDebug || {};
    window.__mogeDebug.pointsDiag = pointsDiag;
    window.__mogeDebug.outputSize = `${outW}x${outH}`;

    let mMin = Infinity, mMax = -Infinity;
    for (let i = 0; i < maskRaw.length; i++) {
      if (isFinite(maskRaw[i])) {
        mMin = Math.min(mMin, maskRaw[i]);
        mMax = Math.max(mMax, maskRaw[i]);
      }
    }
    console.log(`Mask raw: range=[${mMin.toFixed(4)}, ${mMax.toFixed(4)}]`);

    // Read CLS token for scale head (deferred from backbone to avoid mid-pipeline sync)
    if (backboneClsTokenBuf && !clsTokenData) {
      const clsReadbackStart = performance.now();
      clsTokenData = await readBuffer(device, backboneClsTokenBuf, encoderDim * 4);
      phaseTimings.clsReadbackMs = performance.now() - clsReadbackStart;
    } else {
      phaseTimings.clsReadbackMs = 0;
    }

    // Scale head: CLS token → metric scale via MLP (1024→1024→1024→1) + exp
    const scaleHeadStart = performance.now();
    let metricScale = 1.0;
    if (clsTokenData && this.weights.scaleHead) {
      let x = clsTokenData;
      for (let li = 0; li < this.weights.scaleHead.layers.length; li++) {
        const { weight, bias, inDim, outDim } = this.weights.scaleHead.layers[li];
        const out = new Float32Array(outDim);
        for (let o = 0; o < outDim; o++) {
          let sum = bias[o];
          for (let k = 0; k < inDim; k++) {
            sum += x[k] * weight[k * outDim + o];
          }
          // ReLU between layers (not after the last)
          out[o] = (li < this.weights.scaleHead.layers.length - 1) ? Math.max(0, sum) : sum;
        }
        x = out;
      }
      metricScale = Math.exp(x[0]);
      console.log(`Scale head: raw=${x[0].toFixed(4)}, metric_scale=${metricScale.toFixed(4)}`);
    }
    phaseTimings.scaleHeadMs = performance.now() - scaleHeadStart;

    // Post-processing: exp remap
    const postprocessStart = performance.now();
    const points = new Float32Array(3 * outH * outW);
    const depth = new Float32Array(outH * outW);
    const colors = new Float32Array(3 * outH * outW);

    for (let i = 0; i < outH * outW; i++) {
      let px = pointsRaw[0 * outH * outW + i];
      let py = pointsRaw[1 * outH * outW + i];
      let pz = pointsRaw[2 * outH * outW + i];

      // exp remap: xy = xy * exp(z), z = exp(z)
      const expZ = Math.exp(Math.min(pz, 10));
      px = px * expZ;
      py = py * expZ;
      pz = expZ;

      points[i * 3 + 0] = px;
      points[i * 3 + 1] = py;
      points[i * 3 + 2] = pz;
      depth[i] = pz;

      // Color from input image
      const oy = Math.floor(i / outW);
      const ox = i % outW;
      const srcY = Math.min(Math.floor(oy * height / outH), height - 1);
      const srcX = Math.min(Math.floor(ox * width / outW), width - 1);
      const srcIdx = srcY * width + srcX;
      colors[i * 3 + 0] = imageData.data[srcIdx * 4 + 0] / 255;
      colors[i * 3 + 1] = imageData.data[srcIdx * 4 + 1] / 255;
      colors[i * 3 + 2] = imageData.data[srcIdx * 4 + 2] / 255;
    }

    // Normals from normal_head (moge-2-vitl-normal model)
    // normalsRaw is CHW planar [3, outH, outW], needs L2 normalization per pixel
    const normals = new Float32Array(3 * outH * outW);
    for (let i = 0; i < outH * outW; i++) {
      let nx = normalsRaw[0 * outH * outW + i];
      let ny = normalsRaw[1 * outH * outW + i];
      let nz = normalsRaw[2 * outH * outW + i];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      normals[i * 3 + 0] = nx / len;
      normals[i * 3 + 1] = ny / len;
      normals[i * 3 + 2] = nz / len;
    }

    // Apply metric scale
    if (metricScale !== 1.0) {
      for (let i = 0; i < points.length; i++) points[i] *= metricScale;
      for (let i = 0; i < depth.length; i++) depth[i] *= metricScale;
    }

    let dMin = Infinity, dMax = -Infinity;
    for (let i = 0; i < depth.length; i++) {
      if (isFinite(depth[i])) {
        dMin = Math.min(dMin, depth[i]);
        dMax = Math.max(dMax, depth[i]);
      }
    }

    // Clean up
    neckInputs.forEach(f => f.buffer.destroy());

    phaseTimings.postprocessMs = performance.now() - postprocessStart;
    phaseTimings.totalMs = performance.now() - totalStart;
    window.__mogeDebug = window.__mogeDebug || {};
    window.__mogeDebug.depthRange = `[${dMin.toFixed(4)}, ${dMax.toFixed(4)}]`;
    window.__mogeDebug.phaseTimings = phaseTimings;
    if (stagedSubmits) {
      stagedGpuPhaseTimings.totalProfiledGpuMs =
        stagedGpuPhaseTimings.backboneSubmitWaitMs +
        stagedGpuPhaseTimings.neckInputSubmitWaitMs +
        stagedGpuPhaseTimings.decoderSubmitWaitMs +
        stagedGpuPhaseTimings.outputReadbackMs;
      window.__mogeDebug.stagedGpuPhaseTimings = stagedGpuPhaseTimings;
    }
    if (profileDecoderSubstages) {
      decoderSubstageTimings.totalDecoderSubstageMs =
        decoderSubstageTimings.neckSubmitWaitMs +
        decoderSubstageTimings.pointsHeadSubmitWaitMs +
        decoderSubstageTimings.normalHeadSubmitWaitMs +
        decoderSubstageTimings.maskHeadSubmitWaitMs;
      window.__mogeDebug.decoderSubstageTimings = decoderSubstageTimings;
    }
    if (profileNeckLevels) {
      window.__mogeDebug.neckLevelTimings = neckLevelTimings;
    }
    if (neckInternalTimings) {
      window.__mogeDebug.neckInternalTimings = neckInternalTimings;
    }
    if (neckResamplerTimings) {
      window.__mogeDebug.neckResamplerTimings = neckResamplerTimings;
    }
    if (gpuTimestamps) {
      window.__mogeDebug.gpuPhaseTimings = {
        route: 'timestamp-query',
        timestampUnit: 'nanoseconds',
        timestamps: gpuTimestamps.map(String),
        backboneGpuMs: timestampDeltaMs(gpuTimestamps, 0, 1),
        neckInputGpuMs: timestampDeltaMs(gpuTimestamps, 1, 2),
        decoderGpuMs: timestampDeltaMs(gpuTimestamps, 2, 3),
        mainPassGpuMs: timestampDeltaMs(gpuTimestamps, 0, 3),
      };
    } else if (options.profileGpuTimestamps) {
      window.__mogeDebug.gpuPhaseTimings = {
        route: 'unavailable',
        reason: coop
          ? 'disabled in cooperative scheduling mode; timing authority is queue-submit-wait'
          : 'timestamp-query feature was not present on the GPUDevice',
      };
    }
    const webGpuRouteRequest = createMogeRouteInvocationRequest({
      routeReceipt: {
        ...(options.routeReceipt || {}),
        profileStagedGpu,
      },
      outH,
      outW,
    });
    if (coop) {
      // The route request's declared scheduler must reflect the cooperative
      // config that actually ran, and the verification receipt gets the
      // observed event trace (real submits + yields, not synthesized stages).
      webGpuRouteRequest.scheduler = {
        ...(webGpuRouteRequest.scheduler || {}),
        ...cooperativeSchedulerDescriptor(coop, { backboneTotalItems: VIT_BLOCK_COUNT }),
      };
    }
    const webGpuRouteReceipt = createMogeWebGpuRouteReceipt({
      backendIdentity: this.backendIdentity,
      routeRequest: webGpuRouteRequest,
      routeReceipt: options.routeReceipt,
      stagedGpuPhaseTimings,
      phaseTimings,
      outH,
      outW,
      runtimeEvidence,
      observedSchedulerEvents: coop ? coop.events : null,
    });
    window.__mogeDebug.webGpuRouteRequest = webGpuRouteRequest;
    window.__mogeDebug.webGpuRouteReceipt = webGpuRouteReceipt;
    const webGpuRouteResult = createMogeRouteWorkerResult({
      request: webGpuRouteRequest,
      receipt: webGpuRouteReceipt,
    });
    window.__mogeDebug.webGpuRouteResult = webGpuRouteResult;

    return {
      depth, normals, points, colors, width: outW, height: outH, metricScale,
      routeResult: webGpuRouteResult,
      schedulerVerificationReceipt: webGpuRouteReceipt.runtime.schedulerVerification,
    };
  }
}

export { INFERENCE_LIMIT_KEYS, MoGeInference, createMogeSchedulerVerificationReceipt, inferenceLimits, initGPU, resolveCooperativeScheduler };
