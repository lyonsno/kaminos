// Native compilation is asynchronous on the live edit route. Synchronous
// creation remains explicit for existing offline callers and small fixtures.
export function createLightingComputePipeline(device,descriptor,asynchronous=false){
  if(asynchronous&&typeof device.createComputePipelineAsync!=='function')throw Error('lighting requires asynchronous compute pipeline support');
  let failure=null;
  let launch;
  const kernel={pipeline:null,ready:null,get error(){return failure;},retry(){if(failure)launch();return kernel.ready;},get(){
    if(failure)throw failure;
    if(!kernel.pipeline)throw Error(`Lighting pipeline not completed: ${descriptor.label??descriptor.compute.entryPoint}`);
    return kernel.pipeline;
  }};
  if(asynchronous){
    launch=()=>{failure=null;kernel.ready=device.createComputePipelineAsync(descriptor).then(pipeline=>kernel.pipeline=pipeline,error=>{failure=error;throw error;});kernel.ready.catch(()=>{});};
    launch(); // The preparation owner observes completion and rejection.
  }else{
    kernel.pipeline=device.createComputePipeline(descriptor);kernel.ready=Promise.resolve(kernel.pipeline);
  }
  return kernel;
}

export async function prepareLightingComputePipelines(kernels){
  await Promise.all(kernels.filter(Boolean).map(kernel=>kernel.error?kernel.retry():kernel.ready));
}
