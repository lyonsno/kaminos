// Source generate.py normalization at TRELLIS2MLX34a7a570. Only constant
// coefficients cross from CPU; sampled codes and transformed results stay
// in the caller's registered WebGPU runtime. No inference/fixture callbacks.
import {WEBGPU_BUFFER_USAGE as U} from '../../webgpu-inference-kit/src/core.js';
import {decoderDispatch} from './slat-decoder-ops.js';

export const SLAT_NORMALIZATION_SOURCE=Object.freeze({repo:'lyonsno/trellis2mlx',
  commit:'34a7a570d5d6d8b9c99bbddb1d52bd414600d5c6',file:'generate.py',
  functions:Object.freeze(['_denormalize_slat','_normalize_slat'])});
const shapeMean=[0.781296,0.018091,-0.495192,-0.558457,1.06053,0.093252,1.518149,-0.933218,
  -0.732996,2.604095,-0.118341,-2.143904,0.495076,-2.179512,-2.130751,-0.996944,
  0.261421,-2.217463,1.260067,-0.150213,3.790713,1.481266,-1.046058,-1.523667,
  -0.059621,2.22078,1.621212,0.87723,0.567247,-3.175944,-3.186688,1.578665];
const shapeStd=[5.972266,4.706852,5.44501,5.209927,5.32022,4.547237,5.020802,5.444004,
  5.226681,5.683095,4.831436,5.286469,5.652043,5.367606,5.525084,4.730578,
  4.805265,5.124013,5.530808,5.619001,5.10393,5.41767,5.269677,5.547194,
  5.634698,5.235274,6.110351,5.511298,6.237273,4.879207,5.347008,5.405691];
const textureMean=[3.501659,2.212398,2.226094,0.251093,-0.026248,-0.687364,0.439898,-0.928075,
  0.029398,-0.339596,-0.869527,1.038479,-0.972385,0.126042,-1.129303,0.455149,
  -1.209521,2.069067,0.544735,2.569128,-0.323407,2.293,-1.925608,-1.217717,
  1.213905,0.971588,-0.023631,0.10675,2.021786,0.250524,-0.662387,-0.768862];
const textureStd=[2.665652,2.743913,2.765121,2.595319,3.037293,2.291316,2.144656,2.911822,
  2.969419,2.501689,2.154811,3.163343,2.621215,2.381943,3.186697,3.021588,
  2.295916,3.234985,3.233086,2.26014,2.874801,2.810596,3.29272,2.674999,
  2.680878,2.372054,2.451546,2.353556,2.995195,2.379849,2.786195,2.77519];

export function buildSLatScalePlan({tokenRows,mode='shape',direction='denormalize'}={}) {
  if(!Number.isSafeInteger(tokenRows)||tokenRows<1)throw RangeError('complete positive SLat row count required');
  if(!['shape','texture'].includes(mode)||!['normalize','denormalize'].includes(direction))throw TypeError('source SLat mode/direction required');
  return Object.freeze({tokenRows,mode,direction,shape:Object.freeze([tokenRows,32]),dtype:'f32',
    stages:Object.freeze(direction==='denormalize'?['slat-scale-multiply','slat-scale-add']:['slat-scale-subtract','slat-scale-divide']),
    source:SLAT_NORMALIZATION_SOURCE,arithmetic:'separate-source-F32-operation-boundaries'});
}
const shader=(count,operation)=>`
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read> coefficients:array<f32>;
@group(0) @binding(2) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>){
 let i=gid.x+gid.y*grid.x*64u;if(i<${count}u){output[i]=input[i]${operation}coefficients[i%32u];}
}`;

export function createTrellisSLatScaleAdapter({route,tokenRows,mode='shape',direction='denormalize',sampleTensor}={}) {
  const plan=buildSLatScalePlan({tokenRows,mode,direction}),runtime=route?.runtime,count=tokenRows*32,bytes=count*4;
  if(!runtime?.createTensor||!runtime?.uploadTensor||!runtime?.defineComputeKernel||!runtime?.runKernel)
    throw TypeError('registered SLat scaling runtime required');
  if(!sampleTensor?.buffer||sampleTensor.dtype!=='f32'||!(sampleTensor.usage&U.storage)||
    sampleTensor.byteLength!==bytes||JSON.stringify(sampleTensor.shape)!==JSON.stringify(plan.shape))
    throw TypeError('complete resident F32 sampled/decoded SLat codes required');
  if(!Number.isSafeInteger(count)||count>0xffffffff||bytes>(runtime.device?.limits?.maxStorageBufferBindingSize??134217728))
    throw RangeError('complete SLat scale exceeds effective binding capacity');
  const dispatch=decoderDispatch(Math.ceil(count/64),runtime.device?.limits?.maxComputeWorkgroupsPerDimension??65535),owned=[];
  let disposed=false,running=false;
  const allocate=(name,shape)=>{
    const t=runtime.createTensor({name:'trellis.slat-scale.'+name,shape,dtype:'f32',usage:U.storage|U.copyDst|U.copySrc});owned.push(t);return t;
  },cleanup=()=>{for(const t of owned)t.buffer?.destroy?.();};
  try{
    const mean=allocate('mean',[32]),std=allocate('std',[32]),intermediate=allocate('intermediate',plan.shape),output=allocate('result',plan.shape);
    runtime.uploadTensor(mean,Float32Array.from(mode==='shape'?shapeMean:textureMean));
    runtime.uploadTensor(std,Float32Array.from(mode==='shape'?shapeStd:textureStd));
    const operations=(direction==='denormalize'?[[sampleTensor,std,intermediate,'*'],[intermediate,mean,output,'+']]:
      [[sampleTensor,mean,intermediate,'-'],[intermediate,std,output,'/']]).map(([a,b,out,operator],i)=>({stage:plan.stages[i],
      kernel:runtime.defineComputeKernel({name:'trellis.'+plan.stages[i],code:shader(count,operator),
        bindings:[a,b,out].map((resource,j)=>({name:'b'+j,resource,access:j===2?'storage':'read-only-storage'}))})}));
    return Object.freeze({plan,runtime,routeId:route.routeId,inputs:Object.freeze({sample:sampleTensor}),outputs:Object.freeze({sample:output}),
      async run(invocation){
        if(disposed)throw Error('SLat scale adapter disposed');if(running)throw Error('SLat scale adapter in use');running=true;
        try{
          for(const op of operations)await runtime.runKernel(op.kernel,{stage:op.stage,dispatch,schedulerInvocation:invocation,yieldAfter:true});
          return output;
        }finally{running=false;}
      },
      dispose(){if(running)throw Error('SLat scale adapter in use');if(disposed)return;disposed=true;cleanup();}
    });
  }catch(error){cleanup();throw error;}
}
