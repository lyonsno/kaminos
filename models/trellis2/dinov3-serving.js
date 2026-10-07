// Production DINO kernels carried from Kaminos79ef54bd; no probe, oracle,
// receipt-required feature readback, or standalone runtime is in this module.
import {createLinearDispatch,WEBGPU_BUFFER_USAGE,WEBGPU_SHADER_STAGE} from '../../webgpu-inference-kit/src/runtime-primitives.js';
import {SAM_VECTOR_LINEAR_GELU_WGSL,SAM_VECTOR_LINEAR_WGSL} from '../../webgpu-inference-kit/src/sam-vector-linear-wgsl.js';
const PREFIX_TOKENS = 5;
const PATCH_TOKENS = 1024;
const TOKEN_COUNT = PREFIX_TOKENS + PATCH_TOKENS;
const CHANNELS = 1024;
const HEADS = 16;
const HEAD_DIM = 64;
const INTERMEDIATE = 4096;
const PATCH_SIZE = 16;
const IMAGE_SIZE = 512;
const LAYER_NORM_EPSILON = 1e-5;
const PATCH_EMBED_WGSL = `
struct PatchDims { image_height:u32, image_width:u32, patch_size:u32, patch_height:u32, patch_width:u32, hidden_size:u32, total_values:u32, _pad0:u32, };
@group(0) @binding(0) var<storage, read> pixels: array<f32>;
@group(0) @binding(1) var<storage, read> projection: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: PatchDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let index = gid.x + gid.y * grid.x * 64u + gid.z * grid.x * grid.y * 64u;
  if (index >= dims.total_values) { return; }
  let out_channel = index % dims.hidden_size;
  let patch_index = index / dims.hidden_size;
  let patch_y = patch_index / dims.patch_width;
  let patch_x = patch_index % dims.patch_width;
  var sum = bias[out_channel];
  for (var ky=0u; ky<dims.patch_size; ky=ky+1u) {
    for (var kx=0u; kx<dims.patch_size; kx=kx+1u) {
      let pixel_base = ((patch_y*dims.patch_size+ky)*dims.image_width+patch_x*dims.patch_size+kx)*3u;
      let weight_base = ((out_channel*dims.patch_size+ky)*dims.patch_size+kx)*3u;
      for (var channel=0u; channel<3u; channel=channel+1u) {
        sum = sum + pixels[pixel_base+channel] * projection[weight_base+channel];
      }
    }
  }
  output_values[index] = sum;
}`;

const PREFIX_ASSEMBLY_WGSL = `
struct PrefixDims { patch_count:u32, prefix_tokens:u32, channels:u32, total_values:u32, };
@group(0) @binding(0) var<storage, read> patch_values: array<f32>;
@group(0) @binding(1) var<storage, read> class_token: array<f32>;
@group(0) @binding(2) var<storage, read> register_tokens: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: PrefixDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let index = gid.x + gid.y * grid.x * 64u + gid.z * grid.x * grid.y * 64u;
  if (index >= dims.total_values) { return; }
  let channel = index % dims.channels;
  let token = index / dims.channels;
  if (token == 0u) { output_values[index] = class_token[channel]; }
  else if (token < dims.prefix_tokens) { output_values[index] = register_tokens[(token-1u)*dims.channels+channel]; }
  else { output_values[index] = patch_values[(token-dims.prefix_tokens)*dims.channels+channel]; }
}`;

const LAYERNORM_WGSL = `
struct NormDims { token_count:u32, channels:u32, epsilon:f32, _pad0:u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> norm_weight: array<f32>;
@group(0) @binding(2) var<storage, read> norm_bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: NormDims;
var<workgroup> reduction: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_id) local:vec3<u32>, @builtin(workgroup_id) group:vec3<u32>) {
  let token = group.x;
  let lane = local.x;
  let base = token * dims.channels;
  var partial = 0.0;
  for (var channel=lane; channel<dims.channels; channel=channel+64u) { partial = partial + input_values[base+channel]; }
  reduction[lane] = partial;
  workgroupBarrier();
  var stride = 32u;
  loop {
    if (lane < stride) { reduction[lane] = reduction[lane] + reduction[lane+stride]; }
    workgroupBarrier();
    if (stride == 1u) { break; }
    stride = stride / 2u;
  }
  let mean = reduction[0] / f32(dims.channels);
  var variance_partial = 0.0;
  for (var channel=lane; channel<dims.channels; channel=channel+64u) {
    let delta = input_values[base+channel] - mean;
    variance_partial = variance_partial + delta * delta;
  }
  reduction[lane] = variance_partial;
  workgroupBarrier();
  stride = 32u;
  loop {
    if (lane < stride) { reduction[lane] = reduction[lane] + reduction[lane+stride]; }
    workgroupBarrier();
    if (stride == 1u) { break; }
    stride = stride / 2u;
  }
  let inverse_std = inverseSqrt(reduction[0] / f32(dims.channels) + dims.epsilon);
  for (var channel=lane; channel<dims.channels; channel=channel+64u) {
    output_values[base+channel] = (input_values[base+channel]-mean)*inverse_std*norm_weight[channel]+norm_bias[channel];
  }
}`;

const FINAL_NO_AFFINE_LAYERNORM_WGSL = `
struct NormDims { token_count:u32, channels:u32, epsilon:f32, _pad0:u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(2) var<uniform> dims: NormDims;
var<workgroup> reduction: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_id) local:vec3<u32>, @builtin(workgroup_id) group:vec3<u32>) {
  let token = group.x;
  let lane = local.x;
  let base = token * dims.channels;
  var partial = 0.0;
  for (var channel=lane; channel<dims.channels; channel=channel+64u) { partial = partial + input_values[base+channel]; }
  reduction[lane] = partial;
  workgroupBarrier();
  var stride = 32u;
  loop {
    if (lane < stride) { reduction[lane] = reduction[lane] + reduction[lane+stride]; }
    workgroupBarrier();
    if (stride == 1u) { break; }
    stride = stride / 2u;
  }
  let mean = reduction[0] / f32(dims.channels);
  var variance_partial = 0.0;
  for (var channel=lane; channel<dims.channels; channel=channel+64u) {
    let delta = input_values[base+channel] - mean;
    variance_partial = variance_partial + delta * delta;
  }
  reduction[lane] = variance_partial;
  workgroupBarrier();
  stride = 32u;
  loop {
    if (lane < stride) { reduction[lane] = reduction[lane] + reduction[lane+stride]; }
    workgroupBarrier();
    if (stride == 1u) { break; }
    stride = stride / 2u;
  }
  let inverse_std = inverseSqrt(reduction[0] / f32(dims.channels) + dims.epsilon);
  for (var channel=lane; channel<dims.channels; channel=channel+64u) {
    output_values[base+channel] = (input_values[base+channel]-mean)*inverse_std;
  }
}`;

const ROPE_WGSL = `
struct RopeDims { token_count:u32, prefix_tokens:u32, channels:u32, head_dim:u32, patch_count:u32, total_values:u32, _pad0:u32, _pad1:u32, };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> rope_cos: array<f32>;
@group(0) @binding(2) var<storage, read> rope_sin: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: RopeDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let index = gid.x + gid.y * grid.x * 64u + gid.z * grid.x * grid.y * 64u;
  if (index >= dims.total_values) { return; }
  let channel = index % dims.channels;
  let token = index / dims.channels;
  if (token < dims.prefix_tokens) { output_values[index] = input_values[index]; return; }
  let patch_index = token - dims.prefix_tokens;
  let dim = channel % dims.head_dim;
  let mate = select(dim - dims.head_dim/2u, dim + dims.head_dim/2u, dim < dims.head_dim/2u);
  let mate_index = index - dim + mate;
  let rotated = select(input_values[mate_index], -input_values[mate_index], dim < dims.head_dim/2u);
  let rope_index = patch_index*dims.head_dim+dim;
  output_values[index] = input_values[index]*rope_cos[rope_index] + rotated*rope_sin[rope_index];
}`;

const ATTENTION_SCORE_WGSL = `
struct AttentionDims { token_count:u32, channels:u32, heads:u32, head_dim:u32, total_scores:u32, _pad0:u32, _pad1:u32, _pad2:u32, };
@group(0) @binding(0) var<storage, read> q_values: array<f32>;
@group(0) @binding(1) var<storage, read> k_values: array<f32>;
@group(0) @binding(2) var<storage, read_write> scores: array<f32>;
@group(0) @binding(3) var<uniform> dims: AttentionDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let index = gid.x + gid.y*grid.x*64u + gid.z*grid.x*grid.y*64u;
  if (index >= dims.total_scores) { return; }
  let token_count = dims.token_count;
  let key = index % token_count;
  let query = (index / token_count) % token_count;
  let head = index / (token_count*token_count);
  let q_base = query*dims.channels+head*dims.head_dim;
  let k_base = key*dims.channels+head*dims.head_dim;
  var score = 0.0;
  for (var dim=0u; dim<dims.head_dim; dim=dim+1u) { score = score + q_values[q_base+dim]*k_values[k_base+dim]; }
  scores[index] = score * inverseSqrt(f32(dims.head_dim));
}`;

const ATTENTION_SOFTMAX_WGSL = `
struct SoftmaxDims { row_count:u32, key_count:u32, total_scores:u32, _pad0:u32, };
@group(0) @binding(0) var<storage, read_write> scores: array<f32>;
@group(0) @binding(1) var<uniform> dims: SoftmaxDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let row = gid.x + gid.y*grid.x*64u + gid.z*grid.x*grid.y*64u;
  if (row >= dims.row_count) { return; }
  let base = row*dims.key_count;
  var maximum = -3.402823466e+38;
  for (var key=0u; key<dims.key_count; key=key+1u) { maximum = max(maximum, scores[base+key]); }
  var denominator = 0.0;
  for (var key=0u; key<dims.key_count; key=key+1u) { denominator = denominator + exp(scores[base+key]-maximum); }
  for (var key=0u; key<dims.key_count; key=key+1u) { scores[base+key] = exp(scores[base+key]-maximum)/denominator; }
}`;

const ATTENTION_CONTEXT_WGSL = `
struct ContextDims { token_count:u32, channels:u32, heads:u32, head_dim:u32, total_values:u32, _pad0:u32, _pad1:u32, _pad2:u32, };
@group(0) @binding(0) var<storage, read> probabilities: array<f32>;
@group(0) @binding(1) var<storage, read> v_values: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(3) var<uniform> dims: ContextDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let index = gid.x + gid.y*grid.x*64u + gid.z*grid.x*grid.y*64u;
  if (index >= dims.total_values) { return; }
  let channel = index%dims.channels;
  let query = index/dims.channels;
  let head = channel/dims.head_dim;
  let row = (head*dims.token_count+query)*dims.token_count;
  var value = 0.0;
  for (var key=0u; key<dims.token_count; key=key+1u) {
    value = value + probabilities[row+key]*v_values[key*dims.channels+channel];
  }
  output_values[index] = value;
}`;

const LAYER_SCALE_RESIDUAL_WGSL = `
struct ResidualDims { total_values:u32, channels:u32, _pad0:u32, _pad1:u32, };
@group(0) @binding(0) var<storage, read> residual: array<f32>;
@group(0) @binding(1) var<storage, read> update_values: array<f32>;
@group(0) @binding(2) var<storage, read> layer_scale: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: ResidualDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let index = gid.x + gid.y*grid.x*64u + gid.z*grid.x*grid.y*64u;
  if (index >= dims.total_values) { return; }
  output_values[index] = residual[index]+update_values[index]*layer_scale[index%dims.channels];
}`;

const bufferOwners=new WeakMap();
function ensureF32(value, name, length) {
  if (!(value instanceof Float32Array)) throw new Error(`${name} must be a Float32Array; fp16 and implicit numeric conversion are not accepted`);
  if (value.length !== length) throw new Error(`${name} length ${value.length} does not match expected ${length}`);
  return value;
}

function releaseOwnedTensorBuffers(tensors, preserve = []) {
  const retained = new Set(preserve.filter(Boolean));
  const released = new Set();
  for (const tensor of tensors) {
    if (!tensor || retained.has(tensor) || released.has(tensor)) continue;
    released.add(tensor);
    if (tensor.ownsBuffer === true && typeof tensor.buffer?.destroy === 'function') tensor.buffer.destroy();
  }
}

function releaseCreatedGpuBuffers(resources, preserve = []) {
  const retained = new Set(preserve.map(resource => resource?.buffer || resource).filter(Boolean));
  const released = new Set();
  for (const resource of resources) {
    const buffer = resource?.buffer || resource;
    if (!buffer || retained.has(buffer) || released.has(buffer)) continue;
    released.add(buffer);
    bufferOwners.get(buffer)?.delete(buffer);bufferOwners.delete(buffer);
    if (typeof buffer.destroy === 'function') buffer.destroy();
  }
}

function createResidentTensor(runtime, input, { managed = false } = {}) {
  if (!managed) return runtime.createTensor(input);
  if (typeof runtime.createManagedBuffer !== 'function') {
    throw new Error('session-resident DINO tensors require runtime.createManagedBuffer so per-run buffers stay caller-owned');
  }
  const byteLength = input.shape.reduce((count, axis) => count * axis, 1) * 4;
  const buffer = runtime.createManagedBuffer({ label:input.name, size:byteLength, usage:input.usage });
  return runtime.createTensor({ ...input, buffer });
}

function releaseResidentTensors(tensors, { managed = false, preserve = [] } = {}) {
  if (managed) releaseCreatedGpuBuffers(tensors, preserve);
  else releaseOwnedTensorBuffers(tensors, preserve);
}

export async function runTrellisDinoV3LayerNormResident(input = {}) {
  const layerIndex = input.layerIndex ?? 1;
  const { runtime, inputTensor, weight, bias, schedulerInvocation } = input;
  if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= 24) {
    throw new Error('resident LayerNorm layerIndex must be an integer from 0 through 23');
  }
  const layerName = `block${layerIndex}`;
  const operationName = `dinov3-${layerName}-layernorm1`;
  const tensorPrefix = `trellis.dinov3.${layerName}.norm1`;
  if (!runtime || !['createTensor', 'uploadTensor', 'createUniformBuffer', 'defineComputeKernel', 'runKernel'].every(name => typeof runtime[name] === 'function')) {
    throw new Error('resident LayerNorm requires the live WebGPU inference runtime');
  }
  if (!inputTensor?.buffer || inputTensor.dtype !== 'f32' || JSON.stringify(inputTensor.shape) !== JSON.stringify([1,TOKEN_COUNT,CHANNELS])) {
    throw new Error(`resident LayerNorm input must be the live F32 ${layerName === 'block1' ? 'block-0' : 'upstream'} tensor with shape [1,1029,1024]`);
  }
  if (!Number.isInteger(inputTensor.usage) || (inputTensor.usage & WEBGPU_BUFFER_USAGE.storage) === 0) {
    throw new Error('resident LayerNorm input must expose storage usage');
  }
  const weightValues = new Float32Array(ensureF32(weight, `${layerName}Norm1Weight`, CHANNELS));
  const biasValues = new Float32Array(ensureF32(bias, `${layerName}Norm1Bias`, CHANNELS));
  for (let index=0; index<CHANNELS; index+=1) {
    if (!Number.isFinite(weightValues[index])) throw new Error(`${layerName}Norm1Weight[${index}] is not finite`);
    if (!Number.isFinite(biasValues[index])) throw new Error(`${layerName}Norm1Bias[${index}] is not finite`);
  }
  const readonly = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
  const outputUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copySrc;
  const normWeight = createResidentTensor(runtime,{ name:`${tensorPrefix}.weight`, shape:[CHANNELS], dtype:'f32', usage:readonly },{managed:input.managedTensorBuffers===true});
  const normBias = createResidentTensor(runtime,{ name:`${tensorPrefix}.bias`, shape:[CHANNELS], dtype:'f32', usage:readonly },{managed:input.managedTensorBuffers===true});
  const output = createResidentTensor(runtime,{ name:`${tensorPrefix}.output`, shape:[1,TOKEN_COUNT,CHANNELS], dtype:'f32', usage:outputUsage },{managed:input.managedTensorBuffers===true});
  let dims;
  let completed = false;
  try {
    runtime.uploadTensor(normWeight, weightValues);
    runtime.uploadTensor(normBias, biasValues);
    dims = runtime.createUniformBuffer({
      label:`${tensorPrefix}.resident-dims`,
      schema:[{name:'token_count',type:'u32'},{name:'channels',type:'u32'},{name:'epsilon',type:'f32'},{name:'_pad0',type:'u32'}],
      values:{ token_count:TOKEN_COUNT, channels:CHANNELS, epsilon:LAYER_NORM_EPSILON, _pad0:0 },
    });
    const kernel = runtime.defineComputeKernel({
      name:`${tensorPrefix}.resident`, code:LAYERNORM_WGSL, entryPoint:'main',
      bindings:[
        {name:'input_values',resource:inputTensor,visibility:WEBGPU_SHADER_STAGE.compute,access:'read-only-storage'},
        {name:'norm_weight',resource:normWeight,visibility:WEBGPU_SHADER_STAGE.compute,access:'read-only-storage'},
        {name:'norm_bias',resource:normBias,visibility:WEBGPU_SHADER_STAGE.compute,access:'read-only-storage'},
        {name:'output_values',resource:output,visibility:WEBGPU_SHADER_STAGE.compute,access:'storage'},
        {name:'dims',resource:dims,visibility:WEBGPU_SHADER_STAGE.compute,type:'uniform'},
      ],
    });
    await input.onPhase?.({ phase:`${operationName}-resident` });
    await runtime.runKernel(kernel, {
      stage:`${operationName}-resident`, dispatch:[TOKEN_COUNT], schedulerInvocation,
      metadata:{ operation:'layernorm', sourceTensor:inputTensor.name, outputTensor:output.name, dtype:'f32', shape:[1,TOKEN_COUNT,CHANNELS] },
    });
    completed = true;
    return { operation:operationName, inputTensor, tensor:output, dtype:'f32', shape:[1,TOKEN_COUNT,CHANNELS] };
  } finally {
    releaseCreatedGpuBuffers(dims ? [dims] : []);
    if (input.releaseTransientTensors === true || !completed) {
      releaseResidentTensors(completed ? [normWeight,normBias] : [normWeight,normBias,output],{managed:input.managedTensorBuffers===true});
    }
  }
}

export async function runTrellisDinoV3Block1LayerNormResident(input = {}) {
  return runTrellisDinoV3LayerNormResident({ ...input, layerIndex:1 });
}

export async function runTrellisDinoV3Block2LayerNorm1Resident(input = {}) {
  return runTrellisDinoV3LayerNormResident({ ...input, layerIndex:2 });
}

async function runTrellisDinoV3AttentionResident(input = {}, layerIndex) {
  const layerName=`block${layerIndex}`;
  const residualLayerName=`block${layerIndex-1}`;
  const { runtime, inputTensor, residualTensor, schedulerInvocation } = input;
  if (!runtime || !['createTensor', 'uploadTensor', 'createUniformBuffer', 'defineComputeKernel', 'runKernel'].every(name => typeof runtime[name] === 'function')) {
    throw new Error('resident attention requires the live WebGPU inference runtime');
  }
  for (const [label, tensor] of [[`${layerName} LayerNorm`,inputTensor],[`${residualLayerName} residual`,residualTensor]]) {
    if (!tensor?.buffer || tensor.dtype !== 'f32' || JSON.stringify(tensor.shape) !== JSON.stringify([1,TOKEN_COUNT,CHANNELS])) {
      throw new Error(`${label} must be a live F32 tensor with shape [1,1029,1024]`);
    }
    if (!Number.isInteger(tensor.usage) || (tensor.usage & WEBGPU_BUFFER_USAGE.storage) === 0) {
      throw new Error(`${label} must expose storage usage`);
    }
  }
  const weightShapes = {
    qWeight:CHANNELS*CHANNELS,qBias:CHANNELS,kWeight:CHANNELS*CHANNELS,
    vWeight:CHANNELS*CHANNELS,vBias:CHANNELS,oWeight:CHANNELS*CHANNELS,
    oBias:CHANNELS,layerScale1:CHANNELS,ropeCos:PATCH_TOKENS*HEAD_DIM,ropeSin:PATCH_TOKENS*HEAD_DIM,
  };
  const weightValues={};
  for (const [name,length] of Object.entries(weightShapes)) {
    weightValues[name]=new Float32Array(ensureF32(input[name],`${layerName}${name[0].toUpperCase()}${name.slice(1)}`,length));
    for (let index=0;index<weightValues[name].length;index+=1) {
      if (!Number.isFinite(weightValues[name][index])) throw new Error(`${layerName} ${name}[${index}] is not finite`);
    }
  }
  const noKeyBias=new Float32Array(CHANNELS);
  const readonly=WEBGPU_BUFFER_USAGE.storage|WEBGPU_BUFFER_USAGE.copyDst;
  const scratch=WEBGPU_BUFFER_USAGE.storage;
  const outputUsage=WEBGPU_BUFFER_USAGE.storage|WEBGPU_BUFFER_USAGE.copySrc;
  const tensor=(name,shape,usage=scratch)=>createResidentTensor(runtime,{name:`trellis.dinov3.${layerName}.${name}`,shape,dtype:'f32',usage},{managed:input.managedTensorBuffers===true});
  const uniformBuffers=[];
  const createUniformBuffer=descriptor=>{
    const uniform=runtime.createUniformBuffer(descriptor);
    uniformBuffers.push(uniform);
    return uniform;
  };
  const tensors={
    qWeight:tensor('attention.q.weight',[CHANNELS,CHANNELS],readonly),qBias:tensor('attention.q.bias',[CHANNELS],readonly),
    kWeight:tensor('attention.k.weight',[CHANNELS,CHANNELS],readonly),kBias:tensor('attention.k.bias.architecture-zero',[CHANNELS],readonly),
    vWeight:tensor('attention.v.weight',[CHANNELS,CHANNELS],readonly),vBias:tensor('attention.v.bias',[CHANNELS],readonly),
    oWeight:tensor('attention.o.weight',[CHANNELS,CHANNELS],readonly),oBias:tensor('attention.o.bias',[CHANNELS],readonly),
    layerScale1:tensor('attention.layer-scale1',[CHANNELS],readonly),
    ropeCos:tensor('rope.cos',[PATCH_TOKENS,HEAD_DIM],readonly),ropeSin:tensor('rope.sin',[PATCH_TOKENS,HEAD_DIM],readonly),
    q:tensor('attention.q',[1,TOKEN_COUNT,CHANNELS]),k:tensor('attention.k',[1,TOKEN_COUNT,CHANNELS]),v:tensor('attention.v',[1,TOKEN_COUNT,CHANNELS]),
    qRope:tensor('attention.q-rope',[1,TOKEN_COUNT,CHANNELS]),kRope:tensor('attention.k-rope',[1,TOKEN_COUNT,CHANNELS]),
    scores:tensor('attention.scores-f32',[HEADS,TOKEN_COUNT,TOKEN_COUNT]),
    context:tensor('attention.context',[1,TOKEN_COUNT,CHANNELS]),projected:tensor('attention.projection',[1,TOKEN_COUNT,CHANNELS]),
    afterAttention:tensor('attention.residual-output',[1,TOKEN_COUNT,CHANNELS],outputUsage),
  };
  let completed=false;
  try {
  for (const [name,value] of Object.entries({ ...weightValues,kBias:noKeyBias })) runtime.uploadTensor(tensors[name],value);
  const linearDims=createUniformBuffer({
    label:`trellis.dinov3.${layerName}.attention.linear-dims`,
    schema:['input_channels','output_channels','total_output','_pad0'].map(name=>({name,type:'u32'})),
    values:{input_channels:CHANNELS,output_channels:CHANNELS,total_output:TOKEN_COUNT*CHANNELS,_pad0:0},
  });
  const ropeDims=createUniformBuffer({
    label:`trellis.dinov3.${layerName}.attention.rope-dims`,
    schema:['token_count','prefix_tokens','channels','head_dim','patch_count','total_values','_pad0','_pad1'].map(name=>({name,type:'u32'})),
    values:{token_count:TOKEN_COUNT,prefix_tokens:PREFIX_TOKENS,channels:CHANNELS,head_dim:HEAD_DIM,patch_count:PATCH_TOKENS,total_values:TOKEN_COUNT*CHANNELS,_pad0:0,_pad1:0},
  });
  const attentionDims=createUniformBuffer({
    label:`trellis.dinov3.${layerName}.attention.score-dims`,
    schema:['token_count','channels','heads','head_dim','total_scores','_pad0','_pad1','_pad2'].map(name=>({name,type:'u32'})),
    values:{token_count:TOKEN_COUNT,channels:CHANNELS,heads:HEADS,head_dim:HEAD_DIM,total_scores:HEADS*TOKEN_COUNT*TOKEN_COUNT,_pad0:0,_pad1:0,_pad2:0},
  });
  const softmaxDims=createUniformBuffer({
    label:`trellis.dinov3.${layerName}.attention.softmax-dims`,
    schema:['row_count','key_count','total_scores','_pad0'].map(name=>({name,type:'u32'})),
    values:{row_count:HEADS*TOKEN_COUNT,key_count:TOKEN_COUNT,total_scores:HEADS*TOKEN_COUNT*TOKEN_COUNT,_pad0:0},
  });
  const contextDims=createUniformBuffer({
    label:`trellis.dinov3.${layerName}.attention.context-dims`,
    schema:['token_count','channels','heads','head_dim','total_values','_pad0','_pad1','_pad2'].map(name=>({name,type:'u32'})),
    values:{token_count:TOKEN_COUNT,channels:CHANNELS,heads:HEADS,head_dim:HEAD_DIM,total_values:TOKEN_COUNT*CHANNELS,_pad0:0,_pad1:0,_pad2:0},
  });
  const residualDims=createUniformBuffer({
    label:`trellis.dinov3.${layerName}.attention.residual-dims`,
    schema:['total_values','channels','_pad0','_pad1'].map(name=>({name,type:'u32'})),
    values:{total_values:TOKEN_COUNT*CHANNELS,channels:CHANNELS,_pad0:0,_pad1:0},
  });
  const read=(name,resource)=>({name,resource,visibility:WEBGPU_SHADER_STAGE.compute,access:'read-only-storage'});
  const write=(name,resource)=>({name,resource,visibility:WEBGPU_SHADER_STAGE.compute,access:'storage'});
  const uniform=(name,resource)=>({name,resource,visibility:WEBGPU_SHADER_STAGE.compute,type:'uniform'});
  const linear=(name,source,weight,bias,output)=>runtime.defineComputeKernel({
    name:`trellis.dinov3.${layerName}.${name}`,code:SAM_VECTOR_LINEAR_WGSL,entryPoint:'main',
    bindings:[read('input_values',source),read('weight',weight),read('bias',bias),write('output_values',output),uniform('dims',linearDims)],
  });
  const rope=(name,source,output)=>runtime.defineComputeKernel({
    name:`trellis.dinov3.${layerName}.${name}`,code:ROPE_WGSL,entryPoint:'main',
    bindings:[read('input_values',source),read('rope_cos',tensors.ropeCos),read('rope_sin',tensors.ropeSin),write('output_values',output),uniform('dims',ropeDims)],
  });
  const qProjection=linear('attention.q-projection',inputTensor,tensors.qWeight,tensors.qBias,tensors.q);
  const kProjection=linear('attention.k-projection',inputTensor,tensors.kWeight,tensors.kBias,tensors.k);
  const vProjection=linear('attention.v-projection',inputTensor,tensors.vWeight,tensors.vBias,tensors.v);
  const qRope=rope('attention.q-rope',tensors.q,tensors.qRope);
  const kRope=rope('attention.k-rope',tensors.k,tensors.kRope);
  const scoreKernel=runtime.defineComputeKernel({
    name:`trellis.dinov3.${layerName}.attention.score`,code:ATTENTION_SCORE_WGSL,entryPoint:'main',
    bindings:[read('q_values',tensors.qRope),read('k_values',tensors.kRope),write('scores',tensors.scores),uniform('dims',attentionDims)],
  });
  const softmaxKernel=runtime.defineComputeKernel({
    name:`trellis.dinov3.${layerName}.attention.softmax`,code:ATTENTION_SOFTMAX_WGSL,entryPoint:'main',
    bindings:[{...read('scores',tensors.scores),access:'storage'},uniform('dims',softmaxDims)],
  });
  const contextKernel=runtime.defineComputeKernel({
    name:`trellis.dinov3.${layerName}.attention.context`,code:ATTENTION_CONTEXT_WGSL,entryPoint:'main',
    bindings:[read('probabilities',tensors.scores),read('v_values',tensors.v),write('output_values',tensors.context),uniform('dims',contextDims)],
  });
  const outputProjection=linear('attention.o-projection',tensors.context,tensors.oWeight,tensors.oBias,tensors.projected);
  const residualKernel=runtime.defineComputeKernel({
    name:`trellis.dinov3.${layerName}.attention.layer-scale-residual`,code:LAYER_SCALE_RESIDUAL_WGSL,entryPoint:'main',
    bindings:[read('residual',residualTensor),read('update_values',tensors.projected),read('layer_scale',tensors.layerScale1),write('output_values',tensors.afterAttention),uniform('dims',residualDims)],
  });
  const maxWorkgroupsPerDimension=input.device?.limits?.maxComputeWorkgroupsPerDimension;
  const linearDispatch=total=>createLinearDispatch(total,{workgroupSize:64,maxWorkgroupsPerDimension});
  const dispatch={
    qkvProjection:linearDispatch(TOKEN_COUNT*CHANNELS),patchRope:linearDispatch(TOKEN_COUNT*CHANNELS),
    attentionScore:linearDispatch(HEADS*TOKEN_COUNT*TOKEN_COUNT),attentionSoftmax:linearDispatch(HEADS*TOKEN_COUNT),
    attentionContext:linearDispatch(TOKEN_COUNT*CHANNELS),outputProjection:linearDispatch(TOKEN_COUNT*CHANNELS),
    attentionResidual:linearDispatch(TOKEN_COUNT*CHANNELS),
  };
  const invoke=async (kernel,stage,plan)=>{
    await input.onPhase?.({phase:stage});
    return runtime.runKernel(kernel,{stage,dispatch:plan,schedulerInvocation,yieldAfter:true,metadata:{operation:`dinov3-${layerName}-attention`,inputTensor:inputTensor.name,residualTensor:residualTensor.name,outputTensor:tensors.afterAttention.name,dtype:'f32'}});
  };
  await invoke(qProjection,`dinov3-${layerName}-qkv-projection-resident`,dispatch.qkvProjection);
  await invoke(kProjection,`dinov3-${layerName}-qkv-projection-resident`,dispatch.qkvProjection);
  await invoke(vProjection,`dinov3-${layerName}-qkv-projection-resident`,dispatch.qkvProjection);
  await invoke(qRope,`dinov3-${layerName}-patch-rope-resident`,dispatch.patchRope);
  await invoke(kRope,`dinov3-${layerName}-patch-rope-resident`,dispatch.patchRope);
  await invoke(scoreKernel,`dinov3-${layerName}-global-attention-resident`,dispatch.attentionScore);
  await invoke(softmaxKernel,`dinov3-${layerName}-global-attention-resident`,dispatch.attentionSoftmax);
  await invoke(contextKernel,`dinov3-${layerName}-global-attention-resident`,dispatch.attentionContext);
  await invoke(outputProjection,`dinov3-${layerName}-output-residual-resident`,dispatch.outputProjection);
  await invoke(residualKernel,`dinov3-${layerName}-output-residual-resident`,dispatch.attentionResidual);
  completed=true;
  return {operation:`dinov3-${layerName}-attention-residual`,inputTensor, residualTensor, tensor:tensors.afterAttention, dtype:'f32', shape:[1,TOKEN_COUNT,CHANNELS]};
  } finally {
    releaseCreatedGpuBuffers(uniformBuffers);
    if (input.releaseTransientTensors === true || !completed) releaseResidentTensors(Object.values(tensors),{managed:input.managedTensorBuffers===true,preserve:completed?[tensors.afterAttention]:[]});
    if (input.releaseConsumedTensors === true) releaseResidentTensors([inputTensor,residualTensor],{managed:input.managedTensorBuffers===true});
  }
}

export async function runTrellisDinoV3Block1AttentionResident(input = {}) {
  return runTrellisDinoV3AttentionResident(input,1);
}

export async function runTrellisDinoV3Block2AttentionResident(input = {}) {
  return runTrellisDinoV3AttentionResident(input,2);
}

async function runTrellisDinoV3BlockMlpResident(input, blockIndex) {
  const { runtime, inputTensor, residualTensor, schedulerInvocation } = input;
  const blockName=`block${blockIndex}`;
  if (!runtime || !['createTensor', 'uploadTensor', 'createUniformBuffer', 'defineComputeKernel', 'runKernel'].every(name => typeof runtime[name] === 'function')) {
    throw new Error('resident MLP requires the live WebGPU inference runtime');
  }
  for (const [label, tensor] of [[`${blockName} attention residual`,inputTensor],[`${blockName} MLP residual`,residualTensor]]) {
    if (!tensor?.buffer || tensor.dtype !== 'f32' || JSON.stringify(tensor.shape) !== JSON.stringify([1,TOKEN_COUNT,CHANNELS])) {
      throw new Error(`${label} must be a live F32 tensor with shape [1,1029,1024]`);
    }
    if (!Number.isInteger(tensor.usage) || (tensor.usage & WEBGPU_BUFFER_USAGE.storage) === 0) {
      throw new Error(`${label} must expose storage usage`);
    }
  }
  const weightShapes = {
    norm2Weight:CHANNELS,norm2Bias:CHANNELS,
    mlpUpWeight:INTERMEDIATE*CHANNELS,mlpUpBias:INTERMEDIATE,
    mlpDownWeight:CHANNELS*INTERMEDIATE,mlpDownBias:CHANNELS,layerScale2:CHANNELS,
  };
  const weightValues={};
  for (const [name,length] of Object.entries(weightShapes)) {
    const diagnosticName=`${blockName}${name[0].toUpperCase()}${name.slice(1)}`;
    const inputName=input[name] instanceof Float32Array?name:diagnosticName;
    weightValues[name]=new Float32Array(ensureF32(input[inputName],diagnosticName,length));
    for (let index=0;index<weightValues[name].length;index+=1) {
      if (!Number.isFinite(weightValues[name][index])) throw new Error(`${blockName} ${name}[${index}] is not finite`);
    }
  }
  const readonly=WEBGPU_BUFFER_USAGE.storage|WEBGPU_BUFFER_USAGE.copyDst;
  const outputUsage=WEBGPU_BUFFER_USAGE.storage|WEBGPU_BUFFER_USAGE.copySrc;
  const tensor=(name,shape,usage=outputUsage)=>createResidentTensor(runtime,{name:`trellis.dinov3.${blockName}.${name}`,shape,dtype:'f32',usage},{managed:input.managedTensorBuffers===true});
  const uniformBuffers=[];
  const createUniformBuffer=descriptor=>{
    const uniform=runtime.createUniformBuffer(descriptor);
    uniformBuffers.push(uniform);
    return uniform;
  };
  const tensors={
    norm2Weight:tensor('norm2.weight',[CHANNELS],readonly),norm2Bias:tensor('norm2.bias',[CHANNELS],readonly),
    norm2:tensor('norm2.output',[1,TOKEN_COUNT,CHANNELS]),
    mlpUpWeight:tensor('mlp.up.weight',[INTERMEDIATE,CHANNELS],readonly),mlpUpBias:tensor('mlp.up.bias',[INTERMEDIATE],readonly),
    mlpHidden:tensor('mlp.gelu-output',[1,TOKEN_COUNT,INTERMEDIATE]),
    mlpDownWeight:tensor('mlp.down.weight',[CHANNELS,INTERMEDIATE],readonly),mlpDownBias:tensor('mlp.down.bias',[CHANNELS],readonly),
    mlpProjection:tensor('mlp.projection',[1,TOKEN_COUNT,CHANNELS]),layerScale2:tensor('mlp.layer-scale2',[CHANNELS],readonly),
    afterMlp:tensor('mlp.residual-output',[1,TOKEN_COUNT,CHANNELS]),
  };
  let completed=false;
  try {
  for (const [name,value] of Object.entries(weightValues)) runtime.uploadTensor(tensors[name],value);
  const normDims=createUniformBuffer({
    label:`trellis.dinov3.${blockName}.norm2.resident-dims`,
    schema:[{name:'token_count',type:'u32'},{name:'channels',type:'u32'},{name:'epsilon',type:'f32'},{name:'_pad0',type:'u32'}],
    values:{token_count:TOKEN_COUNT,channels:CHANNELS,epsilon:LAYER_NORM_EPSILON,_pad0:0},
  });
  const linearDims=(label,inputChannels,outputChannels,totalOutput)=>createUniformBuffer({
    label, schema:['input_channels','output_channels','total_output','_pad0'].map(name=>({name,type:'u32'})),
    values:{input_channels:inputChannels,output_channels:outputChannels,total_output:totalOutput,_pad0:0},
  });
  const upDims=linearDims(`trellis.dinov3.${blockName}.mlp-up.resident-dims`,CHANNELS,INTERMEDIATE,TOKEN_COUNT*INTERMEDIATE);
  const downDims=linearDims(`trellis.dinov3.${blockName}.mlp-down.resident-dims`,INTERMEDIATE,CHANNELS,TOKEN_COUNT*CHANNELS);
  const residualDims=createUniformBuffer({
    label:`trellis.dinov3.${blockName}.mlp-residual.resident-dims`,
    schema:['total_values','channels','_pad0','_pad1'].map(name=>({name,type:'u32'})),
    values:{total_values:TOKEN_COUNT*CHANNELS,channels:CHANNELS,_pad0:0,_pad1:0},
  });
  const read=(name,resource)=>({name,resource,visibility:WEBGPU_SHADER_STAGE.compute,access:'read-only-storage'});
  const write=(name,resource)=>({name,resource,visibility:WEBGPU_SHADER_STAGE.compute,access:'storage'});
  const uniform=(name,resource)=>({name,resource,visibility:WEBGPU_SHADER_STAGE.compute,type:'uniform'});
  const norm2=runtime.defineComputeKernel({
    name:`trellis.dinov3.${blockName}.norm2`,code:LAYERNORM_WGSL,entryPoint:'main',
    bindings:[read('input_values',inputTensor),read('norm_weight',tensors.norm2Weight),read('norm_bias',tensors.norm2Bias),write('output_values',tensors.norm2),uniform('dims',normDims)],
  });
  const mlpUp=runtime.defineComputeKernel({
    name:`trellis.dinov3.${blockName}.mlp-up`,code:SAM_VECTOR_LINEAR_GELU_WGSL,entryPoint:'main',
    bindings:[read('input_values',tensors.norm2),read('weight',tensors.mlpUpWeight),read('bias',tensors.mlpUpBias),write('output_values',tensors.mlpHidden),uniform('dims',upDims)],
  });
  const mlpDown=runtime.defineComputeKernel({
    name:`trellis.dinov3.${blockName}.mlp-down`,code:SAM_VECTOR_LINEAR_WGSL,entryPoint:'main',
    bindings:[read('input_values',tensors.mlpHidden),read('weight',tensors.mlpDownWeight),read('bias',tensors.mlpDownBias),write('output_values',tensors.mlpProjection),uniform('dims',downDims)],
  });
  const residual=runtime.defineComputeKernel({
    name:`trellis.dinov3.${blockName}.mlp.layer-scale-residual`,code:LAYER_SCALE_RESIDUAL_WGSL,entryPoint:'main',
    bindings:[read('residual',residualTensor),read('update_values',tensors.mlpProjection),read('layer_scale',tensors.layerScale2),write('output_values',tensors.afterMlp),uniform('dims',residualDims)],
  });
  const maxWorkgroupsPerDimension=input.device?.limits?.maxComputeWorkgroupsPerDimension;
  const dispatch=total=>createLinearDispatch(total,{workgroupSize:64,maxWorkgroupsPerDimension});
  let phaseIndex=0;
  let lastCompletedPhase=null;
  const invoke=async (kernel,stage,workgroups,operation)=>{
    await input.onPhase?.({phase:stage,phaseIndex,lastCompletedPhase});
    await runtime.runKernel(kernel,{
      stage,dispatch:workgroups,schedulerInvocation,yieldAfter:true,
      metadata:{operation,inputTensor:inputTensor.name,residualTensor:residualTensor.name,outputTensor:tensors.afterMlp.name,dtype:'f32'},
    });
    lastCompletedPhase=stage;
    phaseIndex+=1;
  };
  await invoke(norm2,`dinov3-${blockName}-layernorm2-resident`,[TOKEN_COUNT],'layernorm');
  await invoke(mlpUp,`dinov3-${blockName}-mlp-up-resident`,dispatch(TOKEN_COUNT*INTERMEDIATE),'linear-gelu');
  await invoke(mlpDown,`dinov3-${blockName}-mlp-down-resident`,dispatch(TOKEN_COUNT*CHANNELS),'linear');
  await invoke(residual,`dinov3-${blockName}-mlp-residual-resident`,dispatch(TOKEN_COUNT*CHANNELS),'layer-scale-residual');
  completed=true;
  return {
    operation:`dinov3-${blockName}-mlp-residual`,inputTensor,residualTensor,norm2Tensor:tensors.norm2,
    mlpHiddenTensor:tensors.mlpHidden,mlpProjectionTensor:tensors.mlpProjection,tensor:tensors.afterMlp,
    dtype:'f32',shape:[1,TOKEN_COUNT,CHANNELS],
  };
  } finally {
    releaseCreatedGpuBuffers(uniformBuffers);
    if (input.releaseTransientTensors === true || !completed) releaseResidentTensors(Object.values(tensors),{managed:input.managedTensorBuffers===true,preserve:completed?[tensors.afterMlp]:[]});
    if (input.releaseConsumedTensors === true) releaseResidentTensors([inputTensor,residualTensor],{managed:input.managedTensorBuffers===true});
  }
}

export async function runTrellisDinoV3Block1MlpResident(input = {}) {
  return runTrellisDinoV3BlockMlpResident(input,1);
}

export async function runTrellisDinoV3Block2MlpResident(input = {}) {
  return runTrellisDinoV3BlockMlpResident(input,2);
}

export async function runTrellisDinoV3TransformerBlockResident(input = {}) {
  const blockIndex=input.blockIndex;
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex > 23) {
    throw new Error('resident complete blockIndex must be an integer from 0 through 23; the caller supplies assembled patch/prefix input');
  }
  const weights=input.weights;
  if (!weights || typeof weights !== 'object') throw new Error(`resident block${blockIndex} requires its full checkpoint weight set`);
  const expectedLengths={
    norm1Weight:CHANNELS,norm1Bias:CHANNELS,
    qWeight:CHANNELS*CHANNELS,qBias:CHANNELS,kWeight:CHANNELS*CHANNELS,
    vWeight:CHANNELS*CHANNELS,vBias:CHANNELS,oWeight:CHANNELS*CHANNELS,oBias:CHANNELS,
    layerScale1:CHANNELS,norm2Weight:CHANNELS,norm2Bias:CHANNELS,
    mlpUpWeight:INTERMEDIATE*CHANNELS,mlpUpBias:INTERMEDIATE,
    mlpDownWeight:CHANNELS*INTERMEDIATE,mlpDownBias:CHANNELS,layerScale2:CHANNELS,
  };
  const completeWeights={};
  for (const [name,length] of Object.entries(expectedLengths)) {
    completeWeights[name]=ensureF32(weights[name],`block${blockIndex}.${name}`,length);
    for (let index=0;index<length;index+=1) {
      if (!Number.isFinite(completeWeights[name][index])) throw new Error(`block${blockIndex}.${name}[${index}] is not finite`);
    }
  }
  const { runtime, inputTensor, schedulerInvocation }=input;
  const norm1=await runTrellisDinoV3LayerNormResident({
    ...input,layerIndex:blockIndex,inputTensor,
    weight:completeWeights.norm1Weight,bias:completeWeights.norm1Bias,
    releaseTransientTensors:true,managedTensorBuffers:input.managedTensorBuffers===true,
  });
  const attention=await runTrellisDinoV3AttentionResident({
    ...input,runtime,inputTensor:norm1.tensor,residualTensor:inputTensor,
    ...completeWeights,ropeCos:input.ropeCos,ropeSin:input.ropeSin,
    releaseTransientTensors:true,releaseConsumedTensors:true,managedTensorBuffers:input.managedTensorBuffers===true,
  },blockIndex);
  const mlp=await runTrellisDinoV3BlockMlpResident({
    ...input,runtime,inputTensor:attention.tensor,residualTensor:attention.tensor,
    ...completeWeights,releaseTransientTensors:true,releaseConsumedTensors:true,managedTensorBuffers:input.managedTensorBuffers===true,
  },blockIndex);
  return {
    operation:`dinov3-block${blockIndex}-complete-transformer-block`,
    inputTensor,tensor:mlp.tensor,dtype:'f32',shape:[1,TOKEN_COUNT,CHANNELS],
    blockIndex,
  };
}

export async function runTrellisDinoV3FinalNoAffineLayerNormResident(input = {}) {
  const { runtime,inputTensor,schedulerInvocation }=input;
  if (!runtime || !['createTensor','createUniformBuffer','defineComputeKernel','runKernel'].every(name=>typeof runtime[name]==='function')) {
    throw new Error('final no-affine LayerNorm requires the live WebGPU inference runtime');
  }
  if (!inputTensor?.buffer || inputTensor.name!=='trellis.dinov3.block23.mlp.residual-output' || inputTensor.dtype!=='f32' || JSON.stringify(inputTensor.shape)!==JSON.stringify([1,TOKEN_COUNT,CHANNELS])) {
    throw new Error('final no-affine LayerNorm input must be the live F32 [1,1029,1024] output of DINO block 23');
  }
  if (!Number.isInteger(inputTensor.usage) || (inputTensor.usage&WEBGPU_BUFFER_USAGE.storage)===0) {
    throw new Error('final no-affine LayerNorm input must expose storage usage');
  }
  const output=createResidentTensor(runtime,{
    name:'trellis.dinov3.final-no-affine-layernorm.conditioning-features',
    shape:[1,TOKEN_COUNT,CHANNELS],dtype:'f32',
    usage:WEBGPU_BUFFER_USAGE.storage|WEBGPU_BUFFER_USAGE.copySrc,
  },{managed:input.managedTensorBuffers===true});
  let dims;
  let kernel;
  let completed=false;
  try {
    dims=runtime.createUniformBuffer({
      label:'trellis.dinov3.final-no-affine-layernorm.resident-dims',
      schema:[{name:'token_count',type:'u32'},{name:'channels',type:'u32'},{name:'epsilon',type:'f32'},{name:'_pad0',type:'u32'}],
      values:{token_count:TOKEN_COUNT,channels:CHANNELS,epsilon:LAYER_NORM_EPSILON,_pad0:0},
    });
    kernel=runtime.defineComputeKernel({
      name:'trellis.dinov3.final-no-affine-layernorm',code:FINAL_NO_AFFINE_LAYERNORM_WGSL,entryPoint:'main',
      bindings:[
        {name:'input_values',resource:inputTensor,visibility:WEBGPU_SHADER_STAGE.compute,access:'read-only-storage'},
        {name:'output_values',resource:output,visibility:WEBGPU_SHADER_STAGE.compute,access:'storage'},
        {name:'dims',resource:dims,visibility:WEBGPU_SHADER_STAGE.compute,type:'uniform'},
      ],
    });
    await input.onPhase?.({phase:'dinov3-final-no-affine-layernorm-resident'});
    await runtime.runKernel(kernel,{
      stage:'dinov3-final-no-affine-layernorm-resident',dispatch:[TOKEN_COUNT],schedulerInvocation,
      metadata:{operation:'final-no-affine-layernorm',inputTensor:inputTensor.name,outputTensor:output.name,dtype:'f32',shape:[1,TOKEN_COUNT,CHANNELS]},
    });
    completed=true;
    return {operation:'dinov3-final-no-affine-layernorm-conditioning-features',inputTensor,tensor:output,dtype:'f32',shape:[1,TOKEN_COUNT,CHANNELS]};
  } finally {
    releaseCreatedGpuBuffers(dims ? [dims] : []);
    if (completed && input.releaseInput===true) releaseResidentTensors([inputTensor],{managed:input.managedTensorBuffers===true});
    if (!completed) releaseResidentTensors([output],{managed:input.managedTensorBuffers===true});
  }
}

export function createTrellisDinoV3ConditioningAdapter({route,pixelValues,prefixWeights,loadLayerWeights,
  modelIdentity=null,onPhase}={}) {
  const runtime=route?.runtime;
  if(!runtime||!['createTensor','createManagedBuffer','createUniformBuffer','uploadTensor','defineComputeKernel','runKernel']
    .every(name=>typeof runtime[name]==='function'))throw TypeError('registered managed WebGPU runtime required');
  if(!(pixelValues instanceof Float32Array)||pixelValues.length!==IMAGE_SIZE*IMAGE_SIZE*3||!pixelValues.every(Number.isFinite))
    throw TypeError('complete finite normalized F32 pixels required');
  if(typeof loadLayerWeights!=='function')throw TypeError('complete DINO checkpoint layer weight loader required');
  if(onPhase!==undefined&&typeof onPhase!=='function')throw TypeError('phase observer must be a function');
  const pixels=new Float32Array(pixelValues),prefix={};
  for(const [name,count]of Object.entries({patchProjection:CHANNELS*PATCH_SIZE*PATCH_SIZE*3,patchBias:CHANNELS,
    classToken:CHANNELS,registerTokens:4*CHANNELS,ropeCos:PATCH_TOKENS*HEAD_DIM,ropeSin:PATCH_TOKENS*HEAD_DIM})) {
    const data=ensureF32(prefixWeights?.[name],name,count);if(!data.every(Number.isFinite))throw TypeError('finite prefix weights required: '+name);
    prefix[name]=new Float32Array(data);
  }
  const owned=new Set(),track=buffer=>{owned.add(buffer);bufferOwners.set(buffer,owned);return buffer;},
    managed={...runtime,createManagedBuffer(d){return track(runtime.createManagedBuffer(d));},
      createUniformBuffer(d){const u=runtime.createUniformBuffer(d);track(u.buffer??u);return u;}},
    tensor=(name,shape,usage=WEBGPU_BUFFER_USAGE.storage|WEBGPU_BUFFER_USAGE.copySrc|WEBGPU_BUFFER_USAGE.copyDst)=>
      createResidentTensor(managed,{name:'trellis.dinov3.serving.'+name,shape,dtype:'f32',usage},{managed:true});
  let state='new',phase='new',result,disposed=false;
  const enter=async e=>{phase=e.phase;await onPhase?.(e);};
  return Object.freeze({runtime,routeId:route.routeId,get state(){return state;},get phase(){return phase;},get outputs(){return result;},
    async run(schedulerInvocation){
      if(disposed)throw Error('DINO serving adapter disposed');if(state!=='new')throw Error('DINO serving adapter is '+state);
      state='running';
      try {
        await enter({phase:'dinov3-serving-patch-prefix-assembly'});
        const t={pixels:tensor('pixels',[1,IMAGE_SIZE,IMAGE_SIZE,3]),projection:tensor('projection',[CHANNELS,PATCH_SIZE,PATCH_SIZE,3]),
          bias:tensor('bias',[CHANNELS]),patches:tensor('patches',[1,PATCH_TOKENS,CHANNELS]),classToken:tensor('class-token',[1,CHANNELS]),
          registerTokens:tensor('register-tokens',[4,CHANNELS]),output:tensor('prefix',[1,TOKEN_COUNT,CHANNELS])};
        for(const [name,data]of Object.entries({pixels,projection:prefix.patchProjection,bias:prefix.patchBias,
          classToken:prefix.classToken,registerTokens:prefix.registerTokens}))managed.uploadTensor(t[name],data);
        const uniform=(name,values)=>managed.createUniformBuffer({label:'trellis.dinov3.serving.'+name,
          schema:Object.keys(values).map(name=>({name,type:'u32'})),values}),
          patchDims=uniform('patch-dims',{image_height:IMAGE_SIZE,image_width:IMAGE_SIZE,patch_size:PATCH_SIZE,
            patch_height:32,patch_width:32,hidden_size:CHANNELS,total_values:PATCH_TOKENS*CHANNELS,_pad0:0}),
          prefixDims=uniform('prefix-dims',{patch_count:PATCH_TOKENS,prefix_tokens:PREFIX_TOKENS,channels:CHANNELS,total_values:TOKEN_COUNT*CHANNELS}),
          execute=async(name,code,inputs,output,dims,count)=>{
            const kernel=managed.defineComputeKernel({name:'trellis.dinov3.serving.'+name,code,entryPoint:'main',
              bindings:[...inputs.map((resource,i)=>({name:'input'+i,resource,access:'read-only-storage',visibility:WEBGPU_SHADER_STAGE.compute})),
                {name:'output',resource:output,access:'storage',visibility:WEBGPU_SHADER_STAGE.compute},
                {name:'dims',resource:dims,type:'uniform',visibility:WEBGPU_SHADER_STAGE.compute}]});
            await managed.runKernel(kernel,{stage:'dinov3-serving-'+name,schedulerInvocation,
              dispatch:createLinearDispatch(count,{workgroupSize:64,maxWorkgroupsPerDimension:runtime.device?.limits?.maxComputeWorkgroupsPerDimension}),yieldAfter:true});
          };
        await execute('patch-embedding',PATCH_EMBED_WGSL,[t.pixels,t.projection,t.bias],t.patches,patchDims,PATCH_TOKENS*CHANNELS);
        await execute('prefix-assembly',PREFIX_ASSEMBLY_WGSL,[t.patches,t.classToken,t.registerTokens],t.output,prefixDims,TOKEN_COUNT*CHANNELS);
        releaseCreatedGpuBuffers([...Object.values(t),patchDims,prefixDims],[t.output]);
        let current=t.output;
        for(let blockIndex=0;blockIndex<24;blockIndex++) {
          await enter({phase:'load-dinov3-block'+blockIndex+'-f32-checkpoint-weights'});
          const weights=await loadLayerWeights(blockIndex),next=await runTrellisDinoV3TransformerBlockResident({
            runtime:managed,device:runtime.device,inputTensor:current,blockIndex,weights,
            ropeCos:prefix.ropeCos,ropeSin:prefix.ropeSin,schedulerInvocation,managedTensorBuffers:true,
            releaseTransientTensors:true,releaseConsumedTensors:true,onPhase:enter});
          current=next.tensor;
        }
        const final=await runTrellisDinoV3FinalNoAffineLayerNormResident({runtime:managed,inputTensor:current,schedulerInvocation,
          managedTensorBuffers:true,releaseInput:true,onPhase:enter});
        await runtime.device?.queue?.onSubmittedWorkDone?.();
        result=Object.freeze({conditioning:final.tensor,blocksExecuted:24,modelIdentity,
          featureBytesToCPUDuringServing:0,kernelSource:'Kaminos79ef54bd production DINO kernels; serving lifecycle, no diagnostic readback'});
        state='completed';phase='completed';return result;
      }catch(error){state='failed';result=undefined;throw error;}
    },
    dispose(){if(state==='running')throw Error('DINO serving adapter in use');if(disposed)return;disposed=true;
      releaseCreatedGpuBuffers([...owned]);}
  });
}
