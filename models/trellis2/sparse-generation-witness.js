import {createWebGpuInferenceSession} from '../../webgpu-inference-kit/src/core.js';
import {createTrellisImageGenerationAdapter} from './trellis-generation.js';
import {loadGenerationInputs,validateGenerationInputs,generationPipelineType} from './generation-inputs.js';
import {GENERATION_ROUTE,GENERATION_FIELDS,validateGenerationResult} from './sparse-generation-witness-checks.js';
import {validateNativePrefixBackend,prefixAdapterName} from './sparse-prefix-witness-checks.js';
import {createTrellisAssetAdapter} from './trellis-material.js';
import {observeDeviceMemory} from './device-memory.js';
import {createTrellisSharedHost} from './shared-host.js';
const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
export async function runGenerationWitness(expectedSha,{memoryMonitor=false,sharedComposition}={}){
  const report={status:'failed',phase:'input-manifest',requestedRoute:GENERATION_ROUTE,numericalStatus:'not-compared',
    comparison:'actual WebGPU image generation with retained prepared pixels and browser noise; no matched MLX fidelity claim',outputs:{}},errors=[];
  let session,device,implementation,assetConsumer,runtime,scope=false,invocationOwner,serving=false,currentPhase='new',memory,bridge,sharedRun;
  report.memory={requested:memoryMonitor};
  const setPhase=(phase,modelRole)=>{report.phase=phase;memory?.setPhase(modelRole?phase+':'+modelRole:phase);};
  const stageCounts={},save=async(name,values,shape,dtype)=>{
    const response=await fetch('/output/'+name,{method:'POST',headers:{'X-Tensor-Dtype':dtype},body:values});
    if(!response.ok)throw Error('complete raw output not saved '+name);
    await response.text();
    report.outputs[name]={shape,dtype,byteLength:values.byteLength,sha256:await hash(values),finite:values.every(Number.isFinite)};
  };
  const savePhase=async extra=>{
    const saved=await fetch('/phase',{method:'POST',body:JSON.stringify({phase:report.phase,effectiveRoute:report.effectiveRoute,
      sessionId:session.snapshot().sessionId,modelRole:report.loadingModelRole??null,
      verifiedTensorCount:report.verifiedTensorCount,verifiedInputBytes:report.verifiedInputBytes,
      ...(memory?{deviceMemory:memory.snapshot()}:{}),...extra})});
    if(!saved.ok)throw Error('generation phase evidence not saved: '+await saved.text());
    await saved.text();
  };
  try{
    if(typeof memoryMonitor!=='boolean')throw TypeError('explicit boolean memory-monitor selection required');
    const fetched=await fetch('/fixture/manifest.json',{cache:'no-store'});if(!fetched.ok)throw Error('generation inputs unavailable');
    const bytes=await fetched.arrayBuffer();if(await hash(bytes)!==expectedSha)throw Error('changed generation manifest');
    const m=JSON.parse(new TextDecoder().decode(bytes));validateGenerationInputs(m);
    report.input={manifestSha256:expectedSha,producer:m.producer,references:m.references,image:m.image,modelIdentities:
      Object.fromEntries(Object.entries(m.models).map(([k,v])=>[k,v.identity])),dinoIdentity:m.dino.identity,seed:m.seed,
      meshResolution:m.meshResolution,pipelineType:generationPipelineType(m),samplingSteps:m.samplingSteps??12};
    report.verifiedTensorCount=0;report.verifiedInputBytes=0;
    report.verifiedInputMeaning='cumulative successful fetches/bytes, including repeated stage use; not resident memory';
    const fetchTensor=async name=>{
      const row=m.tensors[name];if(!row)throw Error('complete identified input required '+name);
      report.inputLoading={tensor:name,file:row.file,byteLength:row.byteLength,sha256:row.sha256,
        ...(report.loadingModelRole?{modelRole:report.loadingModelRole}:{}),phase:'fetch'};
      const r=await fetch('/fixture/'+row.file,{cache:'no-store'});if(!r.ok)throw Error('checkpoint tensor unavailable '+name);
      report.inputLoading.phase='response-body';const raw=await r.arrayBuffer();report.inputLoading.phase='sha256';
      if(raw.byteLength!==row.byteLength||await hash(raw)!==row.sha256)throw Error('partial/changed checkpoint tensor '+name);
      report.inputLoading.phase='typed-array';const values=new Float32Array(raw);report.inputLoading.phase='verified';
      report.verifiedTensorCount++;report.verifiedInputBytes+=raw.byteLength;return values;
    };
    setPhase('native-device');const adapter=sharedComposition?sharedComposition.sharedGpu?.adapter:await navigator.gpu?.requestAdapter();if(!adapter)throw Error('WebGPU unavailable');
    report.backend={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,
      device:adapter.info.device,isFallbackAdapter:adapter.info.isFallbackAdapter??adapter.isFallbackAdapter};validateNativePrefixBackend(report.backend);
    if(report.backend.isFallbackAdapter!==false)throw Error('explicit nonfallback native adapter required');
    const limits=sharedComposition?.sharedGpu?.device?.limits??adapter.limits;
    report.requiredLimits={maxStorageBufferBindingSize:limits.maxStorageBufferBindingSize,maxBufferSize:limits.maxBufferSize,
      maxComputeWorkgroupsPerDimension:limits.maxComputeWorkgroupsPerDimension};
    device=sharedComposition?sharedComposition.sharedGpu.device:await adapter.requestDevice({requiredLimits:report.requiredLimits});
    report.deviceTopology=sharedComposition?'same-device':'isolated-device';
    if(memoryMonitor)memory=observeDeviceMemory(device);
    setPhase('native-device');
    device.pushErrorScope('validation');scope=true;
    device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    device.lost.then(info=>{if(info.reason!=='destroyed')errors.push('device lost: '+info.reason+' '+info.message);});
    const sessionId='image-generation-'+crypto.randomUUID();
    if(sharedComposition){
      bridge=await createTrellisSharedHost({...sharedComposition,sessionId});
      session=bridge.session;sharedRun=await bridge.beginRun({runId:sessionId});
    }else session=await createWebGpuInferenceSession({sessionId,adapter,device,adapterName:prefixAdapterName(adapter.info)});
    const requiredStages=['dinov3-serving-patch-embedding','dinov3-serving-prefix-assembly','dinov3-final-no-affine-layernorm-resident',
      'flow-resident-conditioning-bf16','flow-resident-negative-zero','terminal-output-projection','decoder-sparse-conv','slat-coordinate-rope','slat-texture-concat'];
    const actual=sharedRun?.route??await session.registerRoute({routeId:GENERATION_ROUTE,runtimeOptions:{requiredStages,kernel:{profile:'trellis2-complete-image-generation-v0'}}});
    report.effectiveRoute=actual.routeId;if(actual.routeId!==GENERATION_ROUTE)throw Error('effective generation route mismatch');
    runtime={...actual.runtime,
      async runKernel(k,o){if(o.schedulerInvocation!==invocationOwner)throw Error('same generation invocation required');
        report.lastKernel={stage:o.stage,dispatch:o.dispatch,point:'before-native-kernel'};
        await savePhase({kernel:report.lastKernel});
        await actual.runtime.runKernel(k,o);const counts=stageCounts[currentPhase]??={};counts[o.stage]=(counts[o.stage]??0)+1;
        report.lastKernel={stage:o.stage,dispatch:o.dispatch,point:'native-kernel-returned'};
        await savePhase({kernel:report.lastKernel});},
      async readTensor(t,options){if(serving&&(t.dtype!=='u32'||t.byteLength!==4))throw Error('learned-feature/coordinate CPU read during serving forbidden');
        if(serving)report.servingMetadataReadbackBytes=(report.servingMetadataReadbackBytes??0)+4;
        return actual.runtime.readTensor(t,options);}};
    setPhase('cached-checkpoint-input-loading');
    const inputs=await loadGenerationInputs(m,fetchTensor);
    report.checkpointLoading='per-role uncached complete weights; shared identity-checked activation tables';
    const onPhase=async e=>{
      currentPhase=e.phase;setPhase(e.phase,e.modelRole);
      report.loadingModelRole=e.modelRole??null;
      await savePhase({backend:report.backend,requiredLimits:report.requiredLimits});
    };
    implementation=createTrellisImageGenerationAdapter({...inputs,route:{...actual,runtime},onPhase,
      async onNoiseInput(input){
        await save('noise.'+input.stage,input.values,input.shape,'f32');
        await savePhase({noiseInput:{stage:input.stage,...report.outputs['noise.'+input.stage],source:input.source,seed:input.seed}});
      }});
    setPhase('complete-image-generation');const started=performance.now();serving=true;
    const job=actual.enqueue({jobId:'actual-image-to-geometry-material',execute:invocation=>{invocationOwner=invocation;return implementation.run(invocation);}}),
      completed=await job.completion;serving=false;report.hostElapsedMs=performance.now()-started;
    report.jobCompletion={schema:completed.schema,routeId:completed.routeId,jobId:completed.jobId,status:completed.status,
      outputPresent:completed.outputPresent,failure:completed.failure,cancellation:completed.cancellation};
    // Noise remains useful on failure; save every reached complete input first.
    for(const [name,n]of Object.entries(implementation.noiseInputs))if(!report.outputs['noise.'+name])await save('noise.'+name,n.values,n.shape,'f32');
    if(completed.status!=='succeeded'){
      const error=Error(completed.failure?.message??'actual image generation '+completed.status);
      error.name=completed.failure?.name??'Error';throw error;
    }
    const out=completed.output;if(out!==implementation.outputs)throw Error('actual complete generation output identity required');
    report.composition={dinoBlocksExecuted:out.dino.blocksExecuted,lowResolutionRows:out.lowResolutionRows,highResolutionRows:out.highResolutionRows,
      phases:out.phases.map(p=>p.phase),sameInvocation:true,featureBytesToCPUDuringServing:out.featureBytesToCPUDuringServing,
      coordinateBytesToCPUDuringServing:out.coordinateBytesToCPUDuringServing,stageCounts,sessionId:session.snapshot().sessionId,
      geometryResolution:out.geometry.resolution,materialResolution:out.material.resolution,pipelineType:out.pipelineType,
      geometryLevels:out.geometry.levels,materialLevels:out.material.levels};
    setPhase('post-model-observation-retention');
    const fields={conditioning:out.conditioning,'geometry.features':out.geometry.features,'geometry.coordinates':out.geometry.coordinates,
      'material.features':out.material.features,'material.coordinates':out.material.coordinates,shapeCodes:out.shapeCodes,textureCodes:out.textureCodes};
    for(const [i,t]of out.geometry.subdivisions.entries())fields['geometry.subdivision'+i]=t;
    for(const [name,t]of Object.entries(fields)){const raw=await runtime.readTensor(t),data=t.dtype==='i32'?new Int32Array(raw):new Float32Array(raw);
      await save(name,data,t.shape,t.dtype);}
    assetConsumer=createTrellisAssetAdapter({runtime,geometry:out.geometry,material:out.material,
      provenance:{inputManifestSha256:expectedSha,route:actual.routeId,sessionId:session.snapshot().sessionId,modelIdentities:out.modelIdentities,
        input:'actual current WebGPU image generation; exact borrowed geometry/material tensors',comparison:report.comparison},
      async onPhase(e){setPhase(e.phase,e.modelRole);await savePhase({backend:report.backend,requiredLimits:report.requiredLimits});}});
    const asset=await assetConsumer.run();
    setPhase('post-model-asset-retention');
    const persisted=await fetch('/asset-output',{method:'POST',body:asset.glb});
    if(!persisted.ok)throw Error('learned PBR GLB was not saved');
    report.assetArtifact=await persisted.json();
    if(report.assetArtifact.sha256!==await hash(asset.glb)||report.assetArtifact.byteLength!==asset.glb.byteLength)
      throw Error('partial/changed learned asset receipt');
    report.assetHandoff=asset.handoff;report.assetPostprocess={uv:asset.mesh.uvMetadata,material:asset.textures.metadata,
      textureSize:[asset.textures.width,asset.textures.height],coveredPixels:asset.textures.coveredPixels};
    setPhase('profile');report.profile=actual.runtime.finishProfile({evidence:{mode:'live',source:'actual-image-to-learned-fields'}});report.profileStatus='passed';
    const validation=await device.popErrorScope();scope=false;if(validation)errors.push(validation.message);if(errors.length)throw Error(errors.join('\n'));
    report.status='succeeded';validateGenerationResult(report,m);report.phase=null;
    report.handoff='actual borrowed learned fields become retained PBR GLB; Kaminos inspection/placement/save/reopen outstanding';
  }catch(error){report.status='failed';report.error={name:error.name,message:error.message,stack:error.stack};report.lastGenerationPhase=implementation?.phase;
    memory?.setPhase('failure-retention-readback');
    if(implementation){serving=false;for(const [name,n]of Object.entries(implementation.noiseInputs))if(!report.outputs['noise.'+name])
      try{await save('noise.'+name,n.values,n.shape,'f32');}catch(e){report.retentionErrors??=[];report.retentionErrors.push(e.message);}}
    if(implementation?.conditioning&&!report.outputs.conditioning)try{const t=implementation.conditioning;
      await save('conditioning',new Float32Array(await runtime.readTensor(t)),t.shape,'f32');
    }catch(e){report.retentionErrors??=[];report.retentionErrors.push(e.message);}
    report.stageCounts=stageCounts;
  }finally{
    memory?.setPhase('cleanup');
    if(scope)try{const e=await device.popErrorScope();if(e)errors.push(e.message);}catch(e){errors.push(e.message);}
    report.errors=errors;if(errors.length)report.status='failed';
    if(sharedRun)try{report.sharedRelease=await sharedRun.finish();}catch(error){
      report.cleanupErrors??=[];report.cleanupErrors.push({name:'shared-run',message:error.message});report.status='failed';
    }
    const held=sharedRun&&report.sharedRelease?.status!=='released';
    for(const [name,cleanup]of held?[]:[['asset',()=>assetConsumer?.dispose()],['generation',()=>implementation?.dispose()],
      ['session',async()=>{if(bridge)await bridge.dispose();else if(session){await session.drain();session.close();}}],
      ['device',()=>{if(!sharedComposition)device?.destroy();}]])
      try{await cleanup();}catch(error){report.cleanupErrors??=[];report.cleanupErrors.push({name,message:error.message});report.status='failed';}
  }
  if(memory){report.memory.device=memory.snapshot();report.memory.deviceEvents=[...memory.events];memory.restore();}
  else if(memoryMonitor){report.memory.status='unavailable';report.memory.error='device allocation observer was not installed';}
  return report;
}
