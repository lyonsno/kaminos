// Diagnostic of the production endpoint, not a full decoder or a live
// sampler handoff. Inputs are authenticated retained source arrays.
import {createWebGpuInferenceSession} from '../../webgpu-inference-kit/src/core.js';
import {createSLatDecoderKernelOps} from './slat-decoder-ops.js';
import {SLAT_PROJECTION_ROUTE,validateSLatProjectionFixture,validateSLatProjectionResult,compareSLatDecoderObservation} from './slat-decoder-witness-checks.js';
import {validateNativePrefixBackend,prefixAdapterName} from './sparse-prefix-witness-checks.js';
import {preserveSamplerWitnessFailure,recordSamplerCompletion} from './sparse-sampler-witness-checks.js';
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
export async function runSLatProjectionWitness(expectedSha) {
  const report={status:'failed',phase:'fixture',requestedRoute:SLAT_PROJECTION_ROUTE},errors=[];
  let device,session,ops,scope=false;
  try {
    const response=await fetch('/fixture/manifest.json',{cache:'no-store'});if(!response.ok)throw Error('projection reference unavailable');
    const bytes=await response.arrayBuffer();if(await hash(bytes)!==expectedSha)throw Error('changed projection manifest');
    const m=JSON.parse(new TextDecoder().decode(bytes));
    if(!/^[\w.-]+$/.test(m.parentReference?.file??''))throw Error('safe projection parent path required');
    const parentResponse=await fetch('/fixture/'+m.parentReference.file,{cache:'no-store'});if(!parentResponse.ok)throw Error('projection parent unavailable');
    const parentBytes=await parentResponse.arrayBuffer();if(await hash(parentBytes)!==m.parentReference.sha256)throw Error('changed projection parent');
    const parent=JSON.parse(new TextDecoder().decode(parentBytes)),plan=validateSLatProjectionFixture(m,parent),tensors={};
    report.reference={manifestSha256:expectedSha,parentReference:m.parentReference,source:m.source,producer:m.producer,
      route:m.referenceRoute,effectiveBackend:m.effectiveBackend};report.fixtureVerifiedTensorCount=0;
    for(const [name,row] of Object.entries(m.tensors)){
      if(!/^[\w.-]+$/.test(row.file??''))throw Error('safe projection tensor path required');
      const r=await fetch('/fixture/'+row.file,{cache:'no-store'});if(!r.ok)throw Error('missing projection tensor '+name);
      const raw=await r.arrayBuffer();if(raw.byteLength!==row.byteLength||await hash(raw)!==row.sha256)throw Error('partial/changed projection tensor '+name);
      tensors[name]=new Float32Array(raw);if(!tensors[name].every(Number.isFinite))throw Error('nonfinite projection input/reference');
      report.fixtureVerifiedTensorCount++;
    }
    report.phase='native-device';const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw Error('WebGPU unavailable');
    report.backend={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,
      device:adapter.info.device,isFallbackAdapter:adapter.info.isFallbackAdapter??adapter.isFallbackAdapter};validateNativePrefixBackend(report.backend);
    report.requiredLimits={maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize,maxBufferSize:adapter.limits.maxBufferSize};
    device=await adapter.requestDevice({requiredLimits:report.requiredLimits});
    device.pushErrorScope('validation');scope=true;device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    session=await createWebGpuInferenceSession({sessionId:'decoder-projection-'+crypto.randomUUID(),adapter,device,adapterName:prefixAdapterName(adapter.info)});
    const route=await session.registerRoute({routeId:SLAT_PROJECTION_ROUTE,runtimeOptions:{requiredStages:['decoder-linear'],
      kernel:{profile:'trellis2-source-F32-projection-F16-cast-v0'}}});report.effectiveRoute=route.routeId;
    if(report.effectiveRoute!==report.requestedRoute)throw Error('projection effective route mismatch');
    const runtime=route.runtime;ops=createSLatDecoderKernelOps(runtime);
    const input=ops.upload('projection-input',[plan.rows,plan.ci],tensors.sample),
      weight=ops.upload('projection-weight',[plan.co,plan.ci],tensors['weight.from_latent.weight']),
      bias=ops.upload('projection-bias',[plan.co],tensors['weight.from_latent.bias']),
      outputs={f32:ops.allocate('projection-f32',[plan.rows,plan.co]),f16:ops.allocate('projection-f16',[plan.rows,plan.co])};
    report.composition={...plan,operationKernelRuns:0,fullDecoderCalls:0,sessionId:session.snapshot().sessionId,
      inputHandoff:'offline exact-source sample/weights; production linear kernel, not live decoder composition',
      semanticDtypes:{f32:'float32',f16:'float16'},physicalOutputDtype:'f32'};
    report.phase='projection-execution';const job=route.enqueue({jobId:'complete-first-projection',execute:async invocation=>{
      await ops.linear(input,weight,bias,outputs.f32,false,invocation);report.composition.operationKernelRuns++;
      await ops.linear(input,weight,bias,outputs.f16,true,invocation);report.composition.operationKernelRuns++;
      await ops.settle();return outputs;
    }}),completed=await job.completion;recordSamplerCompletion(report,completed);
    if(completed.status!=='succeeded'){preserveSamplerWitnessFailure(report);return report;}
    report.phase='observation-retention';report.outputs={};
    for(const [name,t] of Object.entries(outputs)){
      const raw=await runtime.readTensor(t),data=new Float32Array(raw),saved=await fetch('/output/'+name,
        {method:'POST',headers:{'X-Tensor-Dtype':t.dtype},body:data});
      if(!saved.ok)throw Error('raw projection output not saved '+name);
      const expected=tensors['expected.'+name],comparison=compareSLatDecoderObservation('features',data,expected),
        a=new Uint32Array(data.buffer,data.byteOffset,data.length),b=new Uint32Array(expected.buffer,expected.byteOffset,expected.length);
      let bitFailures=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])bitFailures++;
      report.outputs[name]={shape:t.shape,dtype:t.dtype,sha256:await hash(data),comparison,
        bitComparison:{count:data.length,failures:bitFailures,passed:bitFailures===0,role:'localization diagnostic; unchanged numeric gate'}};
    }
    report.numericalStatus=Object.values(report.outputs).every(r=>r.comparison.passed)?'passed':'failed';
    const validation=await device.popErrorScope();scope=false;if(validation)errors.push(validation.message);
    report.profileStatus='failed';report.profile=runtime.finishProfile({evidence:{mode:'live',source:'complete-source-matched-first-decoder-operation'}});report.profileStatus='passed';
    const stages=report.profile.profile.stages;
    if(stages.length!==2||stages.some(s=>s.name!=='decoder-linear'))throw Error('exactly two production projection kernels required');
    if(errors.length)throw Error(errors.join('\n'));validateSLatProjectionResult(report,plan);
    report.status='succeeded';report.phase=null;
  }catch(error){preserveSamplerWitnessFailure(report,error);}
  finally{
    if(scope){try{const e=await device.popErrorScope();if(e)errors.push(e.message);}catch(e){errors.push(e.message);}}
    report.errors=errors;
    for(const [name,cleanup] of [['ops',()=>ops?.dispose()],['session',async()=>{if(session){await session.drain();session.close();}}],['device',()=>device?.destroy()]]){
      try{await cleanup();}catch(error){report.cleanupErrors??=[];report.cleanupErrors.push({name,message:error.message});report.status='failed';}
    }
  }
  return report;
}
