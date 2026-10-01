// Model-specific resident sparse-structure forward; references belong in observers.
import { WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';
import { buildSparsePrefixPlan, createTrellisSparsePrefixAdapter } from './sparse-prefix.js';
import { buildSparseBlockPlan, createTrellisSparseBlockWorkspace, createTrellisSparseBlockAdapter } from './sparse-block.js';

export const SPARSE_FLOW_ROUTE = 'trellis2.sparse-flow.webgpu.v0';

export function buildSparseFlowPlan(config = {}) {
  const prefix = buildSparsePrefixPlan(config), block = buildSparseBlockPlan(config);
  const { numBlocks = 30, outChannels = 8 } = config;
  for (const [name,value] of Object.entries({numBlocks,outChannels})) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  }
  return Object.freeze({ prefix, block, numBlocks, outChannels,
    outputShape:[1,outChannels,block.resolution,block.resolution,block.resolution],
    stages:[...prefix.stages,...Array.from({length:numBlocks},()=>block.stages).flat(),
      'terminal-layernorm','terminal-output-projection'],
    arithmetic:'bf16-torso/f32-terminal-layernorm-and-output', terminalEpsilon:1e-5 });
}

const terminalNormShader = (rows,width) => `
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read_write> output:array<f32>;
var<workgroup> partial:array<f32,256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) wid:vec3<u32>) {
  let row=wid.x; var sum=0.0;
  for(var i=lane;i<${width}u;i+=256u){sum+=input[row*${width}u+i];}
  partial[lane]=sum;workgroupBarrier();
  for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){partial[lane]+=partial[lane+stride];}workgroupBarrier();}
  let mean=partial[0]/${width}.0;workgroupBarrier();sum=0.0;
  for(var i=lane;i<${width}u;i+=256u){let delta=input[row*${width}u+i]-mean;sum+=delta*delta;}
  partial[lane]=sum;workgroupBarrier();
  for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){partial[lane]+=partial[lane+stride];}workgroupBarrier();}
  let inverse=inverseSqrt(partial[0]/${width}.0+0.00001);
  for(var i=lane;i<${width}u;i+=256u){output[row*${width}u+i]=(input[row*${width}u+i]-mean)*inverse;}
}`;

// Native [out,in] F32 head. Scatter directly to source NCDHW, not BF16.
const terminalProjectionShader = (rows,width,columns) => `
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read> weight:array<f32>;
@group(0) @binding(2) var<storage,read> bias:array<f32>;
@group(0) @binding(3) var<storage,read_write> output:array<f32>;
var<workgroup> tile_a:array<f32,256>;
var<workgroup> tile_b:array<f32,256>;
@compute @workgroup_size(16,16)
fn main(@builtin(local_invocation_id) lid:vec3<u32>,@builtin(workgroup_id) wid:vec3<u32>) {
  let row=wid.y*16u+lid.y;let col=wid.x*16u+lid.x;var sum=0.0;
  for(var base=0u;base<${width}u;base+=16u){
    var a=0.0;var b=0.0;
    if(row<${rows}u&&base+lid.x<${width}u){a=input[row*${width}u+base+lid.x];}
    if(col<${columns}u&&base+lid.y<${width}u){b=weight[col*${width}u+base+lid.y];}
    tile_a[lid.y*16u+lid.x]=a;tile_b[lid.y*16u+lid.x]=b;workgroupBarrier();
    for(var k=0u;k<16u;k++){sum+=tile_a[lid.y*16u+k]*tile_b[k*16u+lid.x];}workgroupBarrier();
  }
  if(row<${rows}u&&col<${columns}u){output[col * ${rows}u + row]=sum+bias[col];}
}`;

export function createTrellisSparseFlowAdapter({ route, config={}, weights, conditioning, phases, sampleTensor }) {
  const plan=buildSparseFlowPlan(config),runtime=route?.runtime;
  if(!runtime?.createTensor||!runtime?.runKernel)throw new TypeError('registered WebGPU runtime required');
  if(!Array.isArray(weights?.blocks)||weights.blocks.length!==plan.numBlocks)throw new TypeError('complete source block weight sets required');
  for(const [key,count] of [['weight',plan.outChannels*plan.block.channels],['bias',plan.outChannels]]){
    if(!(weights?.terminal?.[key] instanceof Float32Array)||weights.terminal[key].length!==count||
        !weights.terminal[key].every(Number.isFinite))throw new TypeError(`complete finite terminal ${key} required`);
  }
  const resources=[],blocks=[];let prefix,workspace,disposed=false,running=false,initialized=!!sampleTensor;
  const tensor=(name,shape)=>{const t=runtime.createTensor({name:`trellis.flow.${name}`,shape,dtype:'f32',usage:U.storage|U.copyDst|U.copySrc});resources.push(t);return t;};
  const cleanup=()=>{for(const block of blocks)block.dispose();prefix?.dispose();workspace?.dispose();for(const t of resources)t.buffer?.destroy?.();};
  try{
    const sample=sampleTensor??tensor('sample',plan.prefix.inputShape);
    prefix=createTrellisSparsePrefixAdapter({route,config,weights:weights.prefix,sampleTensor:sample});
    workspace=createTrellisSparseBlockWorkspace({route,config,conditioning,phases});
    let hidden=prefix.outputs.projected;
    for(const blockWeights of weights.blocks){const block=createTrellisSparseBlockAdapter({route,config,weights:blockWeights,
      inputs:{projected:hidden,modulation:prefix.outputs.modulation},workspace});blocks.push(block);hidden=block.outputs.hidden;}
    const normalized=tensor('terminal-normalized',plan.block.outputShape);
    const prediction=tensor('prediction',plan.outputShape);
    const weight=tensor('output.weight',[plan.outChannels,plan.block.channels]),bias=tensor('output.bias',[plan.outChannels]);
    runtime.uploadTensor(weight,weights.terminal.weight);runtime.uploadTensor(bias,weights.terminal.bias);
    const define=(name,code,args,dispatch)=>({name,dispatch,kernel:runtime.defineComputeKernel({name:`trellis.flow.${name}`,code,
      bindings:args.map((resource,i)=>({name:`b${i}`,resource,access:i===args.length-1?'storage':'read-only-storage'}))})});
    const terminal=[define('terminal-layernorm',terminalNormShader(plan.block.rows,plan.block.channels),[hidden,normalized],[plan.block.rows,1,1]),
      define('terminal-output-projection',terminalProjectionShader(plan.block.rows,plan.block.channels,plan.outChannels),[normalized,weight,bias,prediction],
        [Math.ceil(plan.outChannels/16),Math.ceil(plan.block.rows/16),1])];
    return Object.freeze({plan,inputs:Object.freeze({sample}),outputs:Object.freeze({prediction}),
      diagnostics:Object.freeze({hidden,normalized,...prefix.outputs}),
      async run({sample:cpuSample,timestep,conditioning:nextConditioning}={},invocation){
        if(disposed)throw new Error('sparse flow adapter disposed');if(running)throw new Error('sparse flow adapter in use');
        if(!Number.isFinite(timestep))throw new TypeError('finite model timestep required');
        if(sampleTensor&&cpuSample!==undefined)throw new TypeError('borrowed sampler state must not be CPU-reuploaded');
        if(cpuSample!==undefined&&(!(cpuSample instanceof Float32Array)||cpuSample.length!==plan.block.rows*plan.prefix.inChannels||
            !cpuSample.every(Number.isFinite)))throw new TypeError('complete finite NCDHW sample required');
        if(!initialized&&cpuSample===undefined)throw new TypeError('initial sample upload required');
        running=true;
        try{
          if(nextConditioning!==undefined)workspace.setConditioning(nextConditioning);
          if(cpuSample!==undefined){runtime.uploadTensor(sample,cpuSample);initialized=true;}
          await prefix.run({timestep},invocation);
          for(const block of blocks)await block.run(invocation);
          for(const {name,kernel,dispatch} of terminal)await runtime.runKernel(kernel,{stage:name,dispatch,schedulerInvocation:invocation,yieldAfter:true});
          return {prediction,blocksExecuted:blocks.length,arithmetic:plan.arithmetic};
        }finally{running=false;}
      },
      dispose(){if(running)throw new Error('sparse flow adapter in use');if(disposed)return;disposed=true;cleanup();}
    });
  }catch(error){cleanup();throw error;}
}
