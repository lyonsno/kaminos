import * as jax from '@jax-js/jax';
import {runQ4Case,runQ4Update,q4Arrays} from './q4-checks.mjs';
import {q4Fixture,q4Reference} from './q4-reference.mjs';
import {compare} from './reference.mjs';
import {createWebGpuInferenceRuntime,createWebGpuLinearShader,WEBGPU_BUFFER_USAGE as U} from '../../src/core.js';

async function consumeAdapter(device,p,f,affineShader){
  const {tokens:T,columns:C,rows:R,rank:K,alpha}=f.dims;
  const frozen=q4Arrays(jax,f);jax.tree.dispose(frozen.params);
  let runtime;
  try{
    runtime=await createWebGpuInferenceRuntime({routeId:'experiment.jax-q4-lora.updated-adapter',device,adapterName:device.adapterInfo.vendor,yieldMs:0});
    const borrowed={};
    for(const [name,a]of Object.entries({...p,...frozen.base}))borrowed[name]=runtime.createTensor({name,shape:a.shape,dtype:name==='packed'?'u32':'f32',buffer:await a.ref.gpuBuffer(),usage:U.storage|U.copySrc});
    const upload=(name,data,usage=U.storage|U.copyDst|U.copySrc)=>{
      const t=runtime.createTensor({name,shape:[data.length],dtype:data instanceof Uint32Array?'u32':'f32',usage});runtime.uploadTensor(t,data);return t;
    };
    const output=(name,n)=>runtime.createTensor({name,shape:[n],dtype:'f32',usage:U.storage|U.copySrc});
    const base=output('base',T*R),hidden=output('hidden',T*K),delta=output('delta',T*R),total=output('total',T*R);
    const bind=(name,resource,access='read-only-storage',type)=>({name,resource,access,type});
    const execute=async(name,code,bindings,dispatch)=>runtime.runKernel(runtime.defineComputeKernel({name,code,bindings}),{dispatch,yieldAfter:true});
    const dims=upload('affine-dims',new Uint32Array([T,R,C,64,0,C,0,0,R,0,0,0]),U.uniform|U.copyDst);
    await execute('existing-qwen-affine4',affineShader,[bind('x',borrowed.input),bind('w',borrowed.packed),bind('s',borrowed.scales),bind('b',borrowed.biases),bind('y',base,'storage'),bind('p',dims,undefined,'uniform')],[R,1,T]);
    for(const [name,input,weight,inDim,outDim,y]of [['a',borrowed.input,borrowed.a,C,K,hidden],['b',hidden,borrowed.b,K,R,delta]]){
      const params=upload(name+'-dims',new Uint32Array([T,inDim,outDim,1,0]),U.uniform|U.copyDst),bias=upload(name+'-zero-bias',new Float32Array(outDim));
      await execute('kit-linear-'+name,createWebGpuLinearShader({variant:'split4'}),[bind('p',params,undefined,'uniform'),bind('x',input),bind('w',weight),bind('b',bias),bind('y',y,'storage')],[Math.ceil(T*outDim/256),1,1]);
    }
    await execute('lora-add',`@group(0) @binding(0)var<storage,read>base:array<f32>;
      @group(0) @binding(1)var<storage,read>delta:array<f32>;
      @group(0) @binding(2)var<storage,read_write>out:array<f32>;
      @compute @workgroup_size(64)fn main(@builtin(global_invocation_id)i:vec3<u32>){if(i.x<${T*R}u){out[i.x]=base[i.x]+${(alpha/K).toPrecision(17)}*delta[i.x];}}`,
      [bind('base',base),bind('delta',delta),bind('out',total,'storage')],[Math.ceil(T*R/64),1,1]);
    const values=Array.from(new Float32Array(await runtime.readTensor(total))),sameDevice=runtime.device===device;
    const parameters={};for(const [name,a]of Object.entries(p))parameters[name]=Array.from(await a.ref.data());
    compare(values,q4Reference(f,parameters).output);
    const disposal=runtime.dispose();runtime=null;
    for(const [name,a]of Object.entries(p))compare(Array.from(await a.ref.data()),parameters[name],{atol:0,rtol:0});
    for(const [name,a]of Object.entries(frozen.base))compare(Array.from(await a.ref.data()),f.base[name],{atol:0,rtol:0});
    return {output:values,sameDevice,borrowedSurvived:true,frozenUnchanged:true,disposal,
      kernels:['existing-qwen-affine4','kit-linear-a/split4','kit-linear-b/split4','lora-add']};
  }finally{await device.queue.onSubmittedWorkDone();runtime?.dispose();jax.tree.dispose(frozen.base);}
}

export async function runBrowserChecks(nonce,progress,{fixture,fixtureSha256}){
  if(fixture.status!=='succeeded'||!fixture.consumer?.affineShader)throw new Error('observed native fixture and consumer source required');
  await jax.init('webgpu');
  const device=jax.getWebGPUDevice(),info=device.adapterInfo,errors=[];
  // Diagnostic allocation/compiled-shader custody, not a timing benchmark or
  // an assertion that an absent allocation implies zero residency (pool reuse).
  const allocations=[],shaders=[],createBuffer=device.createBuffer,createShaderModule=device.createShaderModule;
  device.createBuffer=function(d){allocations.push({phase:phase,size:d.size,usage:d.usage,label:d.label??null});return createBuffer.call(this,d);};
  device.createShaderModule=function(d){shaders.push({phase:phase,code:d.code,label:d.label??null});return createShaderModule.call(this,d);};
  let phase='init';
  try{
  device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const backend={effective:'webgpu',vendor:info.vendor,architecture:info.architecture,features:[...device.features]};
  await progress({phase:'backend',backend});
  const cases=[];
  for(const f of [q4Fixture(),fixture.fixture]){
    phase=f.dims.columns===4096?'native-replay':'synthetic-gradient';
    const record=await runQ4Case(jax,'webgpu',f);cases.push(record);await progress({phase:'q4-numerics',case:record});
  }
  compare(cases[1].output,fixture.nativeOutput);
  phase='update-and-kit';
  const update=await runQ4Update(jax,'webgpu',q4Fixture(),1,p=>consumeAdapter(device,p,q4Fixture(),fixture.consumer.affineShader));
  cases.push(update);await progress({phase:'kit-updated-adapter',case:update});
  await device.queue.onSubmittedWorkDone();
  if(errors.length)throw new Error('WebGPU validation errors: '+errors.join('; '));
  return {nonce,fixtureSha256,backend,cases,diagnostics:{allocations,shaders}};
  }finally{device.createBuffer=createBuffer;device.createShaderModule=createShaderModule;}
}
