import * as jax from '@jax-js/jax';
import {runNumericalChecks,arrays} from './checks.mjs';
import {fixture,reference,compare} from './reference.mjs';
import {gatedDeltaSequence} from './recurrence.mjs';
import {createWebGpuInferenceRuntime,WEBGPU_BUFFER_USAGE as U} from '../../src/core.js';

export async function runBrowserChecks(nonce,progress=async()=>{}) {
  await jax.init('webgpu');
  const device=jax.getWebGPUDevice(),info=device.adapterInfo;
  if(!info?.vendor)throw new Error('GPU device identity unavailable');
  const result={nonce,backend:{effective:'webgpu',vendor:info.vendor,architecture:info.architecture,
    device:info.device,description:info.description,features:[...device.features]},cases:[]};
  const errors=[];
  device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  await progress({phase:'backend',backend:result.backend});
  result.cases=await runNumericalChecks(jax,'webgpu',record=>progress({phase:'numerics',case:record}));
  await progress({phase:'kit-interop'});

  const f=fixture(),expected=reference(f).output,run=jax.jit(gatedDeltaSequence);
  let produced,runtime;
  try {
    produced=run(arrays(jax,f));
    // gpuBuffer consumes a handle; retain the owner until the Kit has drained.
    const buffer=await produced.output.ref.gpuBuffer();
    runtime=await createWebGpuInferenceRuntime({routeId:'experiment.jax-gdn.borrowed-device',device,
      adapterName:[info.vendor,info.architecture,info.description].filter(Boolean).join(' '),yieldMs:0});
    const input=runtime.createTensor({name:'jax-owned-output',shape:[expected.length],dtype:'f32',buffer,usage:U.storage|U.copySrc});
    const output=runtime.createTensor({name:'kit-owned-affine-output',shape:[expected.length],dtype:'f32',usage:U.storage|U.copySrc});
    const kernel=runtime.defineComputeKernel({name:'jax-output-affine',code:`
      @group(0) @binding(0) var<storage,read> x:array<f32>;
      @group(0) @binding(1) var<storage,read_write> y:array<f32>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
        if(id.x<${expected.length}u){y[id.x]=2.0*x[id.x]+1.0;}}
    `,bindings:[{name:'input',resource:input,access:'read-only-storage'},{name:'output',resource:output,access:'storage'}]});
    await runtime.runKernel(kernel,{dispatch:[Math.ceil(expected.length/64),1,1],yieldAfter:true});
    const transformed=Array.from(new Float32Array(await runtime.readTensor(output)));
    compare(transformed,expected.map(x=>2*x+1));
    const sameDevice=runtime.device===device,disposal=runtime.dispose();runtime=null;
    const afterDispose=Array.from(await produced.output.ref.data());
    compare(afterDispose,expected);
    const later=Array.from(await produced.output.ref.mul(3).data());
    compare(later,expected.map(x=>3*x));
    result.interop={sameDevice,borrowedInputSurvived:true,deviceSurvived:true,transformed,afterDispose,later,disposal};
  } finally {
    await device.queue.onSubmittedWorkDone();
    runtime?.dispose();
    if(produced)jax.tree.dispose(produced);
    run.dispose();
  }
  if(errors.length)throw new Error('WebGPU validation errors: '+errors.join('; '));
  return result;
}
