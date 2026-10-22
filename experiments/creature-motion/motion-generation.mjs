import {createUniMateConsumer} from '../../models/unimate/unimate-consumer.js';
import {bundleArrays} from '../../models/unimate/unimate-generator.js';
import {checkMotion,checkPartial} from './motion-collection.mjs';
let consumer=null,host=null,route=null,busy=false,cancelled=false;
export async function loadMotionConditioning(spec,{fetchImpl=fetch}={}){
 if(!spec?.bundle||!spec.sha256)throw Error('This skeleton needs a prepared generation bundle');
 const base=new URL(spec.bundle,globalThis.location?.href??'http://localhost/');
 const response=await fetchImpl(new URL('demo.json',base));if(!response.ok)throw Error('Skeleton bundle HTTP '+response.status);const b=await response.json();
 const bin=await fetchImpl(new URL('demo.bin',base));if(!bin.ok)throw Error('Skeleton data HTTP '+bin.status);const bytes=await bin.arrayBuffer();
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 if(digest!==spec.sha256||b.sha256!==digest)throw Error('Prepared skeleton digest mismatch');
 return {b,a:bundleArrays(b,bytes)};
}
export async function generateSkeletonMotion({spec,reference,prompt,seed,rtol=1e-3,atol=1e-6,cfgScale=3,onPartial,onProgress=()=>{},getHost=()=>window.kaminosAppGpu(),options={}}){
 if(busy)throw Error('Motion generation is already running');
 if(typeof prompt!=='string'||!prompt.trim())throw Error('Describe a motion first');
 if(!Number.isSafeInteger(seed)||seed<0)throw Error('Seed must be a nonnegative integer');
 busy=true;cancelled=false;
 try{
  onProgress({phase:'loading',detail:'Reading skeleton'});const data=await loadMotionConditioning(spec);
  if((data.b.assetCondSha256??data.b.sha256)!==reference.assetCondSha256||JSON.stringify(data.b.skeleton.jointNames)!==JSON.stringify(reference.skeleton.jointNames)||JSON.stringify(data.b.skeleton.parents)!==JSON.stringify(reference.skeleton.parents))throw Error('Generation bundle differs from this motion skeleton');
  if(cancelled)throw Error('Generation stopped');
  if(!consumer){host=await getHost();if(cancelled)throw Error('Generation stopped');if(!host)throw Error('The scene GPU host is unavailable');const tracked={...host,beginRun:async(id,config)=>{const run=await host.beginRun(id,config);route={id,...config};return run;}};consumer=createUniMateConsumer(tracked,options);}
  const base={route:'unimate.text-to-motion.webgpu-local.v0',cooperative:true,controllerNorm:'valid-joints',sampling:'dopri5-valid-joints',cfgScale,prompt:prompt.trim(),seed,assetCondSha256:reference.assetCondSha256};
  route=null;const out=await consumer.run({asset:{skeletonData:data},prompt:prompt.trim(),seed,rtol,atol,cfgScale,onProgress,onPartial:onPartial?async sample=>{
   if(route?.routeId!==base.route)throw Error('Partial generation route differs');
   const partial={...base,status:'partial',textEncoder:sample.textEncoder,skeleton:sample.skeleton,...sample.motion,restFrame:sample.restFrame,refinement:{t:sample.t,index:sample.index,evaluations:sample.evaluations}};
   checkPartial(partial);await onPartial(partial);
  }:undefined});
  if(route?.routeId!=='unimate.text-to-motion.webgpu-local.v0'||out.report.textEncoder!=='browser T5')throw Error('Generation did not use the requested motion route');
  const motion={status:'completed',route:route.routeId,textEncoder:out.report.textEncoder,cooperative:true,controllerNorm:'valid-joints',sampling:'dopri5-valid-joints',cfgScale,prompt:out.report.prompt,seed:out.report.seed,assetCondSha256:reference.assetCondSha256,skeleton:out.skeleton,...out.motion,restFrame:out.restFrame,consumerReport:out.report,generation:{route,bundleSha256:spec.sha256,createdAt:new Date().toISOString()}};
  checkMotion(motion);return motion;
 }finally{busy=false;}
}
export function stopSkeletonMotion(){cancelled=true;consumer?.stop();}
