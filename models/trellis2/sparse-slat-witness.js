import {createWebGpuInferenceSession,WEBGPU_BUFFER_USAGE as U} from '../../webgpu-inference-kit/src/core.js';
import {createTrellisSLatFlowAdapter,SLAT_FLOW_ROUTE} from './slat-flow.js';
import {createTrellisOccupancyCoordinatesAdapter,buildOccupancyCoordinatesPlan} from './occupancy-coordinates.js';
import {validateSLatFlowFixture,compareFlowTensor} from './sparse-flow-witness-checks.js';
import {comparePrefixTensor,validateNativePrefixBackend,prefixAdapterName} from './sparse-prefix-witness-checks.js';
import {compareOccupancyCoordinates} from './occupancy-coordinate-witness-checks.js';
import {preserveSamplerWitnessFailure} from './sparse-sampler-witness-checks.js';
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');

// Matched-input observer only. Source logits/noise/conditioning are artifact
// inputs here; actual coordinate->SLat tensor handoff is GPU resident.
export async function runSparseSLatWitness(expectedSha){
 const report={status:'failed',phase:'fixture',requestedRoute:SLAT_FLOW_ROUTE},errors=[];
 let device,session,implementation,coordinateProducer,logits,errorScope=false;
 try{
  const response=await fetch('/fixture/manifest.json',{cache:'no-store'});if(!response.ok)throw Error('SLat fixture unavailable');
  const bytes=await response.arrayBuffer();if(await hash(bytes)!==expectedSha)throw Error('changed SLat manifest');
  const m=JSON.parse(new TextDecoder().decode(bytes)),plan=validateSLatFlowFixture(m),tensors={};
  report.reference={source:m.source,checkpoint:m.checkpoint,conditioning:m.conditioning,sample:m.sample,coordinates:m.coordinates,
   concatConditioning:m.concatConditioning,route:m.referenceRoute,effectiveBackend:m.effectiveBackend,inputHandoff:m.inputHandoff,manifestSha256:expectedSha};
  report.config=m.config;
  for(const [name,row]of Object.entries(m.tensors)){
   if(!/^[\w.-]+$/.test(row.file))throw Error('unsafe SLat fixture path');
   const fetched=await fetch('/fixture/'+row.file,{cache:'no-store'});if(!fetched.ok)throw Error('missing SLat tensor '+name);
   const raw=await fetched.arrayBuffer();if(raw.byteLength!==row.byteLength||await hash(raw)!==row.sha256)throw Error('partial/changed SLat tensor '+name);
   tensors[name]=row.dtype==='int32'?new Int32Array(raw):new Float32Array(raw);
  }
  if(tensors.timestep.length!==1||tensors.timestep[0]!==1000)throw Error('source first model clock differs from recorded bytes');
  report.phase='native-device';const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw Error('WebGPU unavailable');
  report.backend={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,
   device:adapter.info.device,isFallbackAdapter:adapter.info.isFallbackAdapter??adapter.isFallbackAdapter};validateNativePrefixBackend(report.backend);
  const binding=Math.max(134217728,plan.tokenRows*plan.tokenRows*12*4,plan.flow.block.hiddenBytes);
  report.requiredLimits={maxStorageBufferBindingSize:binding,maxBufferSize:Math.max(268435456,binding)};
  report.adapterLimits={maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize,maxBufferSize:adapter.limits.maxBufferSize};
  if(binding>adapter.limits.maxStorageBufferBindingSize)throw Error('complete source geometry exceeds actual adapter binding capacity');
  device=await adapter.requestDevice({requiredLimits:report.requiredLimits});
  report.deviceLimits={maxStorageBufferBindingSize:device.limits.maxStorageBufferBindingSize,maxBufferSize:device.limits.maxBufferSize,
   maxComputeWorkgroupsPerDimension:device.limits.maxComputeWorkgroupsPerDimension};
  device.pushErrorScope('validation');errorScope=true;device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  session=await createWebGpuInferenceSession({sessionId:`slat-flow-${crypto.randomUUID()}`,adapter,device,adapterName:prefixAdapterName(adapter.info)});
  const coordinatePlan=buildOccupancyCoordinatesPlan({resolution:64});
  const route=await session.registerRoute({routeId:SLAT_FLOW_ROUTE,runtimeOptions:{requiredStages:[...new Set([...coordinatePlan.stages,...plan.stages])],
   kernel:{profile:'trellis2-coordinate-slat-bf16-torso-f32-head-v0'}}});
  report.effectiveRoute=route.routeId;if(report.effectiveRoute!==report.requestedRoute)throw Error('effective SLat route mismatch');
  const runtime=route.runtime;
  logits=runtime.createTensor({name:'slat-witness.source-logits',shape:coordinatePlan.inputShape,dtype:'f32',usage:U.storage|U.copySrc|U.copyDst});
  runtime.uploadTensor(logits,tensors.logits);
  coordinateProducer=createTrellisOccupancyCoordinatesAdapter({route,logitsTensor:logits});
  report.phase='resident-coordinate-construction';
  const coordinateJob=route.enqueue({jobId:'SLat-source-ordered-occupancy-coordinates',execute:invocation=>coordinateProducer.run(invocation)});
  const coordinateCompletion=await coordinateJob.completion;
  if(coordinateCompletion.status!=='succeeded')throw Error('coordinate producer job failed '+coordinateCompletion.error?.message);
  const coordinates=await coordinateProducer.coordinates();
  if(coordinates.shape[0]!==plan.tokenRows)throw Error('resident coordinate count differs from matched reference');
  report.phase='SLat-construction';const construction=performance.now();
  const prefix=Object.fromEntries(Object.entries(tensors).filter(([n])=>n.startsWith('prefix.')).map(([n,v])=>[n.slice(7),v]));
  const blocks=Array.from({length:30},(_,i)=>({...Object.fromEntries(Object.entries(tensors).filter(([n])=>n.startsWith(`block${i}.`))
   .map(([n,v])=>[n.slice(`block${i}.`.length),v])),gelu:tensors.gelu}));
  implementation=createTrellisSLatFlowAdapter({route,config:m.config,weights:{prefix,blocks,terminal:{weight:tensors['terminal.weight'],bias:tensors['terminal.bias']}},
   conditioning:tensors.conditioning,coordinateTensor:coordinates,ropeFrequencies:tensors['rope.frequencies'],concatConditioning:tensors.concatConditioning});
  if(implementation.inputs.coordinates!==coordinates)throw Error('SLat did not borrow exact producer coordinate tensor');
  report.constructionHostMs=performance.now()-construction;report.phase='full-SLat-execution';const started=performance.now();
  const modelJob=route.enqueue({jobId:`source-${plan.mode}-SLat-full-30blocks`,execute:invocation=>implementation.run({sample:tensors.sample,timestep:tensors.timestep[0]},invocation)});
  const completed=await modelJob.completion;
  if(completed.status!=='succeeded')throw Error(`SLat job ${completed.status}:${completed.error?.message??''}`);
  if(completed.output.prediction!==implementation.outputs.prediction||completed.output.blocksExecuted!==30)throw Error('complete resident SLat output identity required');
  report.hostSubmitMs=performance.now()-started;report.sessionId=session.snapshot().sessionId;
  report.composition={sameSession:true,jobs:2,coordinateProducerJob:'SLat-source-ordered-occupancy-coordinates',
   flowJob:`source-${plan.mode}-SLat-full-30blocks`,coordinateRows:coordinates.shape[0],exactBorrowedCoordinateIdentity:true,
   metadataBytesToCPU:4,coordinateBytesToCPUDuringServing:0,readbackBetweenBlocks:false,executedBlocks:completed.output.blocksExecuted,
   logitsHandoff:'offline source-logit upload; decoder API not exercised',sampleHandoff:'fixed matched source fixture',
   textureShapeHandoff:plan.mode==='texture'?'offline normalized shape fixture':'not applicable',outputShape:completed.output.prediction.shape,arithmetic:plan.arithmetic};
  report.phase='observation-readback';report.outputs={};const observed={...implementation.diagnostics,prediction:completed.output.prediction,coordinates};
  for(const [name,tensor]of Object.entries(observed)){
   const raw=await runtime.readTensor(tensor),data=name==='coordinates'?new Int32Array(raw):new Float32Array(raw);
   const saved=await fetch('/output/'+name,{method:'POST',headers:{'X-Tensor-Dtype':name==='coordinates'?'i32':'f32'},body:data});
   if(!saved.ok)throw Error('raw SLat observation not saved '+name);
   const comparison=name==='coordinates'?compareOccupancyCoordinates(data,tensors.coordinates):
    (name==='projected'||name==='modulation'||name==='phases'?comparePrefixTensor:compareFlowTensor)(data,tensors['expected.'+name]);
   report.outputs[name]={shape:tensor.shape,dtype:tensor.dtype,sha256:await hash(data),comparison};
  }
  const validation=await device.popErrorScope();errorScope=false;if(validation)errors.push(validation.message);
  report.numericalStatus=Object.values(report.outputs).every(row=>row.comparison.passed)?'passed':'failed';
  report.predictionStatus=report.outputs.prediction.comparison.passed?'passed':'failed';
  report.profileStatus='failed';report.profile=runtime.finishProfile({evidence:{mode:'live',source:'source-ordered-coordinate-SLat-matched-input-fixture'}});report.profileStatus='passed';
  if(errors.length)throw Error(errors.join('\n'));if(report.numericalStatus!=='passed')throw Error('complete source SLat numerical comparison failed');
  report.status='succeeded';report.phase=null;
 }catch(error){preserveSamplerWitnessFailure(report,error);}
 finally{
  if(errorScope){try{const e=await device.popErrorScope();if(e)errors.push(e.message);}catch(e){errors.push(e.message);}}
  report.errors=errors;
  for(const [name,cleanup]of [['SLat',()=>implementation?.dispose()],['coordinates',()=>coordinateProducer?.dispose()],['logits',()=>logits?.buffer?.destroy()],
   ['session',async()=>{if(session){await session.drain();session.close();}}],['device',()=>device?.destroy()]]){
   try{await cleanup();}catch(error){report.cleanupErrors??=[];report.cleanupErrors.push({name,message:error.message});report.status='failed';}
  }
 }
 return report;
}
