import {createWebGpuInferenceSession} from '../../webgpu-inference-kit/src/core.js';
import {createTrellisSparseDecoderAdapter,SPARSE_DECODER_ROUTE} from './sparse-decoder.js';
import {validateDecoderFixture,compareDecoderTensor,decoderObservationShapes} from './sparse-decoder-witness-checks.js';
import {validateNativePrefixBackend,prefixAdapterName} from './sparse-prefix-witness-checks.js';
import {recordSamplerCompletion,preserveSamplerWitnessFailure} from './sparse-sampler-witness-checks.js';
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');

// Offline stage isolation. The actual serving decoder accepts a borrowed GPU
// latent; this fixture upload is not claimed as sampler-to-decoder composition.
export async function runSparseDecoderWitness(expectedSha){
  const report={status:'failed',phase:'fixture',requestedRoute:SPARSE_DECODER_ROUTE},errors=[];
  let device,session,decoder,errorScope=false;
  try{
    const response=await fetch('/fixture/manifest.json',{cache:'no-store'});if(!response.ok)throw new Error('decoder fixture unavailable');
    const bytes=await response.arrayBuffer();if(await hash(bytes)!==expectedSha)throw new Error('changed decoder manifest');
    const m=JSON.parse(new TextDecoder().decode(bytes)),plan=validateDecoderFixture(m),values={};
    report.reference={fixtureKind:m.fixtureKind,source:m.source,producer:m.producer,checkpoint:m.checkpoint,input:m.input,
      effectiveBackend:m.effectiveBackend,route:m.referenceRoute,manifestSha256:expectedSha};report.config=m.config;
    for(const [name,row] of Object.entries(m.tensors)){
      if(!/^[\w.-]+$/.test(row.file))throw new Error('unsafe decoder tensor '+name);
      const item=await fetch('/fixture/'+row.file,{cache:'no-store'});if(!item.ok)throw new Error('missing decoder tensor '+name);
      const raw=await item.arrayBuffer();if(raw.byteLength!==row.byteLength||await hash(raw)!==row.sha256)throw new Error('partial/changed decoder tensor '+name);
      values[name]=new Float32Array(raw);if(!values[name].every(Number.isFinite))throw new Error('nonfinite decoder tensor '+name);
    }
    report.phase='native-device';const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw new Error('WebGPU unavailable');
    report.backend={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,
      device:adapter.info.device,isFallbackAdapter:adapter.info.isFallbackAdapter??adapter.isFallbackAdapter};
    validateNativePrefixBackend(report.backend);if(report.backend.isFallbackAdapter!==false)throw new Error('observed nonfallback adapter required');
    device=await adapter.requestDevice({requiredLimits:{maxStorageBufferBindingSize:Math.max(134217728,plan.requiredBindingBytes)}});
    device.pushErrorScope('validation');errorScope=true;device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
    session=await createWebGpuInferenceSession({sessionId:'sparse-decoder-'+crypto.randomUUID(),adapter,device,adapterName:prefixAdapterName(adapter.info)});
    const route=await session.registerRoute({routeId:SPARSE_DECODER_ROUTE,runtimeOptions:{requiredStages:plan.stages,
      kernel:{profile:'trellis2-dense-occupancy-f32-channel-layernorm-conv3d-v0'}}});
    report.effectiveRoute=route.routeId;if(route.routeId!==SPARSE_DECODER_ROUTE)throw new Error('wrong decoder route');
    const weights=Object.fromEntries(Object.entries(values).filter(([k])=>k.startsWith('weight.')).map(([k,v])=>[k.slice(7),v]));
    report.phase='model-construction';const construction=performance.now();
    decoder=createTrellisSparseDecoderAdapter({route,config:m.config,weights});report.constructionHostMs=performance.now()-construction;
    report.phase='complete-decoder';const started=performance.now(),job=route.enqueue({jobId:'decoder-full-operation-graph',
      execute:invocation=>decoder.run({sample:values.sample},invocation)});
    const completion=await job.completion;recordSamplerCompletion(report,completion);
    if(completion.status!=='succeeded'){preserveSamplerWitnessFailure(report);return report;}
    if(completion.output.logits!==decoder.outputs.logits||completion.output.convolutionsExecuted!==plan.convolutions||
      completion.output.residualBlocksExecuted!==plan.residualBlocks)throw new Error('complete resident decoder output identity required');
    report.hostSubmitMs=performance.now()-started;report.sessionId=session.snapshot().sessionId;
    report.composition={sameSession:true,sameJob:true,convolutionsExecuted:completion.output.convolutionsExecuted,
      residualBlocksExecuted:completion.output.residualBlocksExecuted,readbackBetweenLayers:false,
      latentHandoff:'offline fixture upload; live borrowed tensor API not exercised by this witness',arithmetic:plan.arithmetic};
    report.phase='observation-readback';report.outputs={};const observation=performance.now();
    const observed={...Object.fromEntries(decoder.diagnostics.levelOutputs.map((t,i)=>['level'+i,t])),logits:decoder.outputs.logits};
    for(const [name,tensor] of Object.entries(observed)){
      const raw=await route.runtime.readTensor(tensor),data=raw instanceof Float32Array?raw:new Float32Array(raw);
      const saved=await fetch('/output/'+name,{method:'POST',body:data});if(!saved.ok)throw new Error('raw decoder output not saved '+name);
      const expected=values['expected.'+name];report.outputs[name]={shape:tensor.shape,dtype:tensor.dtype,sha256:await hash(data),comparison:compareDecoderTensor(data,expected)};
      if(name==='logits'){
        let occupied=0,sourceOccupied=0,changed=0;for(let i=0;i<data.length;i++){occupied+=data[i]>0;sourceOccupied+=expected[i]>0;changed+=(data[i]>0)!==(expected[i]>0);}
        report.occupancy={threshold:0,count:data.length,occupied,sourceOccupied,changed,agreement:1-changed/data.length};
      }
    }
    report.observerReadbackAndSaveMs=performance.now()-observation;
    const validation=await device.popErrorScope();errorScope=false;if(validation)errors.push(validation.message);if(errors.length)throw new Error(errors.join('\n'));
    report.numericalStatus=Object.keys(decoderObservationShapes(plan)).every(name=>report.outputs[name]?.comparison?.passed===true)?'passed':'failed';
    report.profileStatus='failed';report.profile=route.runtime.finishProfile({evidence:{mode:'live',source:'exact-source-occupancy-decoder-fixture'}});report.profileStatus='passed';
    if(report.numericalStatus!=='passed')throw new Error('source occupancy decoder numerical comparison failed');
    report.status='succeeded';report.phase=null;
  }catch(error){preserveSamplerWitnessFailure(report,error);}
  finally{
    if(errorScope){try{const validation=await device.popErrorScope();if(validation)errors.push(validation.message);}catch(error){errors.push(error.message);}}
    report.errors=errors;
    for(const [name,cleanup] of [['decoder',()=>decoder?.dispose()],['session',async()=>{if(session){await session.drain();session.close();}}],['device',()=>device?.destroy()]])
      try{await cleanup();}catch(error){report.cleanupErrors??=[];report.cleanupErrors.push({name,message:error.message});report.status='failed';}
  }
  return report;
}
