// The source cascade's low-resolution sampled codes become the support for
// a separate high-resolution flow. These are actual serving adapters, not
// reference-result callbacks; only learned count/status words cross CPU.
import {buildSLatDecoderPlan,createTrellisSLatDecoderAdapter,createTrellisSLatDecoderAdapterAsync} from './slat-decoder.js';
import {createTrellisSLatScaleAdapter} from './slat-scale.js';
import {buildSLatRegridPlan,createTrellisSLatRegridAdapter} from './slat-regrid.js';
export function createTrellisSLatCascadeSupportAdapter(options={}){
  return constructCascadeSupport(options).next().value;
}
export async function createTrellisSLatCascadeSupportAdapterAsync(options={}){
  const construction=constructCascadeSupport(options,true);let step=construction.next();
  try{
    const decoder=await createTrellisSLatDecoderAdapterAsync({...step.value,loadWeight:options.loadWeight});
    try{step=construction.next(decoder);}catch(error){decoder.dispose();throw error;}
    return step.value;
  }catch(error){if(!step.done)construction.throw(error);throw error;}
}
function* constructCascadeSupport({route,config={},weights,siluTable,sampleTensor,
  coordinateTensor,meshResolution=1024}={},streaming=false){
  if(config.mode!==undefined&&config.mode!=='shape')throw TypeError('cascade support uses the learned shape decoder');
  const decoderConfig={...config,mode:'shape',structureOnly:true},plan=buildSLatDecoderPlan(decoderConfig);
  if(plan.latentChannels!==32)throw TypeError('source cascade requires 32-channel sampled shape codes');
  buildSLatRegridPlan({tokenRows:1,sourceResolution:plan.outputResolution,meshResolution});
  let scale,decoder,regrid,output,disposed=false,running=false,state='new';
  const cleanup=()=>{regrid?.dispose();decoder?.dispose();scale?.dispose();},outputs={};
  Object.defineProperty(outputs,'coordinates',{enumerable:true,get:()=>output?.coordinates});
  try{
    scale=createTrellisSLatScaleAdapter({route,tokenRows:plan.tokenRows,sampleTensor});
    const decoderOptions={route,config:decoderConfig,weights,siluTable,sampleTensor:scale.outputs.sample,coordinateTensor};
    decoder=streaming?(yield decoderOptions):createTrellisSLatDecoderAdapter(decoderOptions);
    return Object.freeze({plan,runtime:route.runtime,routeId:route.routeId,
      inputs:Object.freeze({sample:sampleTensor,coordinates:coordinateTensor}),outputs:Object.freeze(outputs),
      async run(invocation){
        if(disposed)throw Error('SLat cascade support disposed');if(running)throw Error('SLat cascade support in use');
        if(state!=='new')throw Error(state==='failed'?'failed SLat cascade support is poisoned':'single SLat cascade support already completed');
        running=true;state='running';
        try{
          await scale.run(invocation);const decoded=await decoder.run(invocation);
          regrid=createTrellisSLatRegridAdapter({route,tokenRows:decoded.coordinates.shape[0],sourceResolution:decoded.resolution,
            meshResolution,coordinateTensor:decoded.coordinates});
          const result=await regrid.run(invocation);
          // Regrid owns the new support. Its settled dispatch is the last
          // consumer of the learned LR decoder's coordinates and scale.
          decoder.dispose();scale.dispose();decoder=undefined;scale=undefined;
          output=Object.freeze({...result,lowResolutionDecodedRows:decoded.coordinates.shape[0],meshResolution,
            metadataReadbackBytes:decoded.metadataReadbackBytes+result.metadataReadbackBytes,
            featureBytesToCPUDuringServing:0,coordinateBytesToCPUDuringServing:0,
            composition:'sampled-LR-shape → denormalized-shape → learned-structure → HR-support'});
          state='completed';return output;
        }catch(error){state='failed';output=undefined;throw error;}finally{running=false;}
      },dispose(){if(running)throw Error('SLat cascade support in use');if(disposed)return;disposed=true;cleanup();}
    });
  }catch(error){cleanup();throw error;}
}
