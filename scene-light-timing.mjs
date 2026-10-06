export function assertSceneTimingSample(sample,previousFrame=-1){
  if(!Number.isFinite(sample.ms)||sample.ms<=0||!Number.isSafeInteger(sample.frame)||sample.frame<0)throw new Error('complete positive GPU scene timestamp required');
  if(sample.frame<=previousFrame)throw new Error('stale scene timestamp cannot impersonate a fresh frame');
  return sample;
}
const activeRenderers=new WeakSet();

export async function measureSceneGpu(renderer,{samples=20,getSignature=()=>''}={}){
  if(!Number.isSafeInteger(samples)||samples<1)throw new Error('positive explicit scene timing sample count required');
  if(!renderer.backend.device.features.has('timestamp-query'))return {status:'unsupported',scope:'Three scene render/compute GPU',reason:'timestamp-query unavailable',records:[]};
  if(activeRenderers.has(renderer))return {status:'failed',phase:'admission',error:'scene GPU timing already active',records:[]};
  activeRenderers.add(renderer);
  const previousTracking=renderer.backend.trackTimestamp,signature=getSignature(),records=[];
  renderer.backend.trackTimestamp=true;
  let previousRender=-1,previousCompute=-1;
  try{
    for(let i=0;i<samples;i++){
      await new Promise(requestAnimationFrame);
      const renderMs=await renderer.resolveTimestampsAsync('render'),renderFrames=renderer.backend.timestampQueryPool.render?.frames||[];
      const render=assertSceneTimingSample({ms:renderMs,frame:renderFrames.at(-1)},previousRender);previousRender=render.frame;
      let compute={status:'no-observed-compute-pool'};
      if(renderer.backend.timestampQueryPool.compute){const ms=await renderer.resolveTimestampsAsync('compute'),frames=renderer.backend.timestampQueryPool.compute.frames||[];compute=assertSceneTimingSample({ms,frame:frames.at(-1)},previousCompute);previousCompute=compute.frame;}
      if(getSignature()!==signature)throw new Error('lighting/geometry configuration changed during timing');
      records.push({render,compute,signature});
    }
    return {status:'measured',scope:'Three scene render/compute GPU; excludes volume, source seeding and lighting gather',samples,records};
  }catch(error){return {status:'failed',phase:'scene-timestamps',error:String(error.message||error),samples,records};}
  finally{renderer.backend.trackTimestamp=previousTracking;activeRenderers.delete(renderer);}
}
