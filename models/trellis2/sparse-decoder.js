// Dense occupancy decoder. Effective pinned MLX arithmetic is F32, including
// its F16-stored checkpoint weights cast to constructor destination dtypes.
import {WEBGPU_BUFFER_USAGE as U} from '../../webgpu-inference-kit/src/core.js';
export { createTrellisOccupancyCoordinatesAdapter, buildOccupancyCoordinatesPlan } from './occupancy-coordinates.js';
export { buildSLatDecoderPlan, slatDecoderWeightShapes, createTrellisSLatDecoderAdapter } from './slat-decoder.js';
export { extractTrellisDualGridMesh, createTrellisMeshAdapter, encodeTrellisGeometryGLB, compareTrellisMeshes } from './trellis-mesh.js';
export const SPARSE_DECODER_ROUTE='trellis2.sparse-decoder.webgpu.v0';

export function buildSparseDecoderPlan({resolution=16,latentChannels=8,outChannels=1,
  channels=[512,128,32],numResBlocks=2,numResBlocksMiddle=2}={}){
  for(const [name,value] of Object.entries({resolution,latentChannels,outChannels}))
    if(!Number.isSafeInteger(value)||value<1)throw new RangeError(`${name} must be a positive integer`);
  if(!Array.isArray(channels)||!channels.length||channels.some(n=>!Number.isSafeInteger(n)||n<1))throw new RangeError('positive decoder channels required');
  for(const [name,value] of Object.entries({numResBlocks,numResBlocksMiddle}))
    if(!Number.isSafeInteger(value)||value<0)throw new RangeError(`${name} must be a nonnegative integer`);
  const blocks=[];
  for(let i=0;i<numResBlocksMiddle;i++)blocks.push({type:'residual',name:`middle_block.${i}`,resolution,channels:channels[0]});
  let r=resolution,index=0;
  for(let level=0;level<channels.length;level++){
    const c=channels[level];
    for(let i=0;i<numResBlocks;i++)blocks.push({type:'residual',name:`blocks.${index++}`,resolution:r,channels:c});
    if(level+1<channels.length){blocks.push({type:'upsample',name:`blocks.${index++}`,resolution:r,inChannels:c,outChannels:channels[level+1]});r*=2;}
  }
  if(!Number.isSafeInteger(r**3*Math.max(...channels)*4)||r**3*Math.max(...channels)>0xffffffff)throw new RangeError('decoder exceeds integer addressing');
  const stages=['decoder-input-layout','input_layer-conv3d'];
  for(const b of blocks)stages.push(...(b.type==='residual'
    ?[`${b.name}.norm1-norm-silu`,`${b.name}.conv1-conv3d`,`${b.name}.norm2-norm-silu`,`${b.name}.conv2-conv3d`,`${b.name}-residual`]
    :[`${b.name}.conv-conv3d`,`${b.name}-pixel-shuffle`]));
  stages.push('out_layer.0-norm-silu','out_layer.2-conv3d','decoder-output-layout');
  const plan={resolution,latentChannels,outChannels,channels:Object.freeze([...channels]),numResBlocks,numResBlocksMiddle,
    blocks:Object.freeze(blocks.map(Object.freeze)),inputShape:[1,latentChannels,resolution,resolution,resolution],
    outputShape:[1,outChannels,r,r,r],outputResolution:r,normEpsilon:1e-6,
    residualBlocks:blocks.filter(b=>b.type==='residual').length,convolutions:2+blocks.reduce((n,b)=>n+(b.type==='residual'?2:1),0),
    stages:Object.freeze(stages),arithmetic:'f32-channel-layernorm-silu-conv3d',weightLayout:'source-checkpoint-OI-DHW'};
  plan.requiredBindingBytes=Math.max(...Object.values(sparseDecoderWeightShapes(plan)).map(shape=>shape.reduce((a,b)=>a*b,4)),
    plan.inputShape.reduce((a,b)=>a*b,4),plan.outputShape.reduce((a,b)=>a*b,4),
    ...channels.map((c,i)=>(resolution*2**i)**3*c*4),
    ...blocks.filter(b=>b.type==='upsample').map(b=>b.resolution**3*8*b.outChannels*4));
  return Object.freeze(plan);
}
export function sparseDecoderWeightShapes(plan){
  const shapes={},conv=(name,input,output)=>{shapes[`${name}.weight`]=[output,input,3,3,3];shapes[`${name}.bias`]=[output];},
    norm=(name,c)=>{shapes[`${name}.weight`]=[c];shapes[`${name}.bias`]=[c];};
  conv('input_layer',plan.latentChannels,plan.channels[0]);
  for(const b of plan.blocks){
    if(b.type==='residual'){for(const i of [1,2]){norm(`${b.name}.norm${i}`,b.channels);conv(`${b.name}.conv${i}`,b.channels,b.channels);}}
    else conv(`${b.name}.conv`,b.inChannels,8*b.outChannels);
  }
  norm('out_layer.0',plan.channels.at(-1));conv('out_layer.2',plan.channels.at(-1),plan.outChannels);return shapes;
}

const indexWGSL='let index=gid.x+gid.y*grid.x*256u;';
const layoutShader=(voxels,c,toLast)=>`
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>){
 ${indexWGSL} if(index>=${voxels*c}u){return;}
 let voxel=index/${c}u;let channel=index%${c}u;
 ${toLast?`output[index]=input[channel*${voxels}u+voxel];`:`output[channel*${voxels}u+voxel]=input[index];`}
}`;

// Implicit im2col: only a 16x16 input/weight tile is materialized. The full
// 512-channel unfolded volume would exceed a browser storage binding limit.
export const sparseDecoderConvShader=(r,inputChannels,outputChannels)=>`
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read> weight:array<f32>;
@group(0) @binding(2) var<storage,read> bias:array<f32>;
@group(0) @binding(3) var<storage,read_write> output:array<f32>;
var<workgroup> tile_a:array<f32,256>;
var<workgroup> tile_b:array<f32,256>;
@compute @workgroup_size(16,16)
fn main(@builtin(local_invocation_id) lid:vec3<u32>,@builtin(workgroup_id) wid:vec3<u32>){
 let row=wid.y*16u+lid.y;let col=wid.x*16u+lid.x;var sum=0.0;
 let z=i32(row/${r*r}u);let y=i32((row/${r}u)%${r}u);let x=i32(row%${r}u);
 for(var base=0u;base<${27*inputChannels}u;base+=16u){
   let a_k=base+lid.x;let a_spatial=a_k/${inputChannels}u;let ic=a_k%${inputChannels}u;
   let iz=z+i32(a_spatial/9u)-1;let iy=y+i32((a_spatial/3u)%3u)-1;let ix=x+i32(a_spatial%3u)-1;
   var a=0.0;var b=0.0;
   if(row<${r**3}u&&a_k<${27*inputChannels}u&&iz>=0&&iy>=0&&ix>=0&&iz<${r}&&iy<${r}&&ix<${r}){
     a=input[((u32(iz)*${r}u+u32(iy))*${r}u+u32(ix))*${inputChannels}u+ic];
   }
   let b_k=base+lid.y;
   if(col<${outputChannels}u&&b_k<${27*inputChannels}u){
     b=weight[col*${27*inputChannels}u+(b_k%${inputChannels}u)*27u+b_k/${inputChannels}u];
   }
   tile_a[lid.y*16u+lid.x]=a;tile_b[lid.y*16u+lid.x]=b;workgroupBarrier();
   for(var k=0u;k<16u;k++){sum+=tile_a[lid.y*16u+k]*tile_b[k*16u+lid.x];}workgroupBarrier();
 }
 if(row<${r**3}u&&col<${outputChannels}u){output[row*${outputChannels}u+col]=sum+bias[col];}
}`;

const normSiluShader=(rows,c)=>`
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read> weight:array<f32>;
@group(0) @binding(2) var<storage,read> bias:array<f32>;
@group(0) @binding(3) var<storage,read_write> output:array<f32>;
var<workgroup> partial:array<f32,256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) wid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>){
 let row=wid.x+wid.y*grid.x;if(row>=${rows}u){return;}var sum=0.0;
 for(var i=lane;i<${c}u;i+=256u){sum+=input[row*${c}u+i];}partial[lane]=sum;workgroupBarrier();
 for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){partial[lane]+=partial[lane+stride];}workgroupBarrier();}
 let mean=partial[0]/${c}.0;workgroupBarrier();sum=0.0;
 for(var i=lane;i<${c}u;i+=256u){let d=input[row*${c}u+i]-mean;sum+=d*d;}partial[lane]=sum;workgroupBarrier();
 for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){partial[lane]+=partial[lane+stride];}workgroupBarrier();}
 let inverse=inverseSqrt(partial[0]/${c}.0+0.000001);
 for(var i=lane;i<${c}u;i+=256u){let value=(input[row*${c}u+i]-mean)*inverse*weight[i]+bias[i];output[row*${c}u+i]=value/(1.0+exp(-value));}
}`;

const residualShader=count=>`
@group(0) @binding(0) var<storage,read> skip:array<f32>;
@group(0) @binding(1) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>){${indexWGSL}if(index<${count}u){output[index]=skip[index]+output[index];}}`;

export const sparseDecoderShuffleShader=(r,c)=>`
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>){
 ${indexWGSL}if(index>=${(r*2)**3*c}u){return;}let channel=index%${c}u;let row=index/${c}u;
 let z=row/${r*r*4}u;let y=(row/${r*2}u)%${r*2}u;let x=row%${r*2}u;
 let source=((z/2u)*${r}u+y/2u)*${r}u+x/2u;
 let sub=((z%2u)*2u+y%2u)*2u+x%2u;
 output[index]=input[source*${c*8}u+channel*8u+sub];
}`;

export function createTrellisSparseDecoderAdapter({route,config={},weights,sampleTensor}){
  const runtime=route?.runtime,plan=buildSparseDecoderPlan(config),shapes=sparseDecoderWeightShapes(plan);
  if(!runtime?.createTensor||!runtime?.runKernel||!runtime?.defineComputeKernel)throw new TypeError('registered decoder runtime required');
  for(const [name,shape] of Object.entries(shapes)){
    const value=weights?.[name],count=shape.reduce((a,b)=>a*b,1);
    if(!(value instanceof Float32Array)||value.length!==count||!value.every(Number.isFinite))throw new TypeError(`complete finite decoder ${name} required`);
  }
  if(sampleTensor&&(!sampleTensor.buffer||sampleTensor.dtype!=='f32'||!(sampleTensor.usage&U.storage)||
    sampleTensor.byteLength!==plan.inputShape.reduce((a,b)=>a*b,4)||JSON.stringify(sampleTensor.shape)!==JSON.stringify(plan.inputShape)))throw new TypeError('borrowed complete F32 NCDHW latent required');
  const limit=runtime.device?.limits?.maxStorageBufferBindingSize??134217728,dispatchLimit=runtime.device?.limits?.maxComputeWorkgroupsPerDimension??65535;
  if(plan.requiredBindingBytes>limit)throw new RangeError('decoder tensor exceeds effective device binding capacity');
  const resources=[],operations=[],workspaces=new Map();let disposed=false,running=false,initialized=!!sampleTensor;
  const tensor=(name,shape)=>{const t=runtime.createTensor({name:`trellis.decoder.${name}`,shape,dtype:'f32',usage:U.storage|U.copyDst|U.copySrc});resources.push(t);return t;};
  const linearGrid=(count,size=256)=>{const groups=Math.ceil(count/size),x=Math.min(groups,dispatchLimit),y=Math.ceil(groups/x);if(y>dispatchLimit)throw new RangeError('decoder dispatch capacity exceeded');return[x,y,1];};
  const define=(name,code,args,dispatch)=>{
    if(dispatch.some(n=>n>dispatchLimit))throw new RangeError('decoder dispatch capacity exceeded');
    const kernel=runtime.defineComputeKernel({name:`trellis.decoder.${name}`,code,
      bindings:args.map((resource,i)=>({name:`b${i}`,resource,access:i===args.length-1?'storage':'read-only-storage'}))});
    operations.push({name,kernel,dispatch});
  };
  const cleanup=()=>resources.forEach(t=>t.buffer?.destroy?.());
  try{
    const w={};for(const [name,shape] of Object.entries(shapes)){w[name]=tensor(name,shape);runtime.uploadTensor(w[name],weights[name]);}
    const sample=sampleTensor??tensor('sample',plan.inputShape),input=tensor('input-channels-last',[plan.resolution**3,plan.latentChannels]);
    define('decoder-input-layout',layoutShader(plan.resolution**3,plan.latentChannels,true),[sample,input],linearGrid(input.byteLength/4));
    const workspace=(r,c)=>{
      const key=`${r}:${c}`;if(!workspaces.has(key))workspaces.set(key,{states:[tensor(`${key}.state0`,[r**3,c]),tensor(`${key}.state1`,[r**3,c])],
        activated:tensor(`${key}.activated`,[r**3,c]),intermediate:tensor(`${key}.intermediate`,[r**3,c])});return workspaces.get(key);
    };
    const conv=(key,r,ic,oc,from,to)=>define(`${key}-conv3d`,sparseDecoderConvShader(r,ic,oc),[from,w[`${key}.weight`],w[`${key}.bias`],to],[Math.ceil(oc/16),Math.ceil(r**3/16),1]);
    const norm=(key,r,c,from,to)=>define(`${key}-norm-silu`,normSiluShader(r**3,c),[from,w[`${key}.weight`],w[`${key}.bias`],to],linearGrid(r**3,1));
    let r=plan.resolution,c=plan.channels[0],current=workspace(r,c).states[0];
    conv('input_layer',r,plan.latentChannels,c,input,current);
    const levelOutputs=[];
    for(const b of plan.blocks){
      if(b.type==='residual'){
        const ws=workspace(r,c),next=ws.states.find(t=>t!==current);
        norm(`${b.name}.norm1`,r,c,current,ws.activated);conv(`${b.name}.conv1`,r,c,c,ws.activated,ws.intermediate);
        norm(`${b.name}.norm2`,r,c,ws.intermediate,ws.activated);conv(`${b.name}.conv2`,r,c,c,ws.activated,next);
        define(`${b.name}-residual`,residualShader(r**3*c),[current,next],linearGrid(r**3*c));current=next;
      }else{
        levelOutputs.push(current);
        const shuffled=tensor(`${b.name}.unshuffled`,[r**3,8*b.outChannels]);
        conv(`${b.name}.conv`,r,c,8*b.outChannels,current,shuffled);const next=workspace(r*2,b.outChannels).states[0];
        define(`${b.name}-pixel-shuffle`,sparseDecoderShuffleShader(r,b.outChannels),[shuffled,next],linearGrid(next.byteLength/4));
        r*=2;c=b.outChannels;current=next;
      }
    }
    levelOutputs.push(current);
    const normalized=workspace(r,c).activated,channelsLast=tensor('logits-channels-last',[r**3,plan.outChannels]),logits=tensor('logits',plan.outputShape);
    norm('out_layer.0',r,c,current,normalized);conv('out_layer.2',r,c,plan.outChannels,normalized,channelsLast);
    define('decoder-output-layout',layoutShader(r**3,plan.outChannels,false),[channelsLast,logits],linearGrid(logits.byteLength/4));
    return Object.freeze({plan,runtime,routeId:route.routeId,inputs:Object.freeze({sample}),outputs:Object.freeze({logits}),
      diagnostics:Object.freeze({levelOutputs,input}),
      async run({sample:initial}={},invocation){
        if(disposed)throw new Error('sparse decoder disposed');if(running)throw new Error('sparse decoder in use');
        if(sampleTensor&&initial!==undefined)throw new TypeError('borrowed resident latent must not be CPU-reuploaded');
        if(initial!==undefined&&(!(initial instanceof Float32Array)||initial.length!==sample.byteLength/4||!initial.every(Number.isFinite)))throw new TypeError('complete finite F32 latent required');
        if(!initialized&&initial===undefined)throw new TypeError('initial decoder sample required');
        running=true;try{
          if(initial!==undefined){runtime.uploadTensor(sample,initial);initialized=true;}
          for(const {name,kernel,dispatch} of operations)await runtime.runKernel(kernel,{stage:name,dispatch,schedulerInvocation:invocation,yieldAfter:true});
          return{logits,convolutionsExecuted:plan.convolutions,residualBlocksExecuted:plan.residualBlocks,arithmetic:plan.arithmetic};
        }finally{running=false;}
      },dispose(){if(running)throw new Error('sparse decoder in use');if(disposed)return;disposed=true;cleanup();}});
  }catch(error){cleanup();throw error;}
}
