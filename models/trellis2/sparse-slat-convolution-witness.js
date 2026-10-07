// Localize the next production decoder operation. This is an authenticated
// artifact diagnostic, not a full decoder or live sampler handoff.
import {createWebGpuInferenceSession} from '../../webgpu-inference-kit/src/core.js';
import {createSLatDecoderKernelOps} from './slat-decoder-ops.js';
import {SLAT_CONVOLUTION_ROUTE,validateSLatConvolutionFixture,validateSLatConvolutionResult,compareSLatDecoderObservation} from './slat-decoder-witness-checks.js';
import {validateNativePrefixBackend,prefixAdapterName} from './sparse-prefix-witness-checks.js';
import {preserveSamplerWitnessFailure,recordSamplerCompletion} from './sparse-sampler-witness-checks.js';
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const compareNeighbors=(actual,expected)=>{
  if(!(actual instanceof Int32Array)||!(expected instanceof Int32Array)||!actual.length||actual.length!==expected.length)
    return {passed:false,error:'complete matching neighbor observations required',actualCount:actual?.length,expectedCount:expected?.length};
  let failures=0,firstMismatch=null;
  for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i]){failures++;firstMismatch??={index:i,actual:actual[i],expected:expected[i]};}
  return {passed:failures===0,count:actual.length,failures,firstMismatch,contract:'exact complete source neighbor indices'};
};
export async function runSLatConvolutionWitness(expectedSha) {
  const report={status:'failed',phase:'fixture',requestedRoute:SLAT_CONVOLUTION_ROUTE},errors=[];
  let device,session,ops,scope=false;
  try {
    const response=await fetch('/fixture/manifest.json',{cache:'no-store'});if(!response.ok)throw Error('convolution reference unavailable');
    const bytes=await response.arrayBuffer();if(await hash(bytes)!==expectedSha)throw Error('changed convolution manifest');
    const m=JSON.parse(new TextDecoder().decode(bytes)),parents={};
    for(const name of ['parentReference','projectionReference']){
      const ref=m[name];if(!/^[\w.-]+$/.test(ref?.file??''))throw Error('safe convolution reference path required');
      const r=await fetch('/fixture/'+ref.file,{cache:'no-store'});if(!r.ok)throw Error('convolution reference unavailable '+name);
      const raw=await r.arrayBuffer();if(await hash(raw)!==ref.sha256)throw Error('changed convolution reference '+name);
      parents[name]=JSON.parse(new TextDecoder().decode(raw));
    }
    const plan=validateSLatConvolutionFixture(m,parents.parentReference,parents.projectionReference),tensors={};
    report.reference={manifestSha256:expectedSha,parentReference:m.parentReference,projectionReference:m.projectionReference,
      source:m.source,producer:m.producer,route:m.referenceRoute,effectiveBackend:m.effectiveBackend};report.fixtureVerifiedTensorCount=0;
    for(const name of ['input','coordinates','weight.blocks.0.0.conv.weight','weight.blocks.0.0.conv.bias','expected.neighbors','expected.convolution']){
      const row=m.tensors[name];if(!/^[\w.-]+$/.test(row.file??''))throw Error('safe convolution tensor path required');
      const r=await fetch('/fixture/'+row.file,{cache:'no-store'});if(!r.ok)throw Error('missing convolution tensor '+name);
      const raw=await r.arrayBuffer();if(raw.byteLength!==row.byteLength||await hash(raw)!==row.sha256)throw Error('partial/changed convolution tensor '+name);
      tensors[name]=row.dtype==='int32'?new Int32Array(raw):new Float32Array(raw);
      if(!tensors[name].every(Number.isFinite))throw Error('nonfinite convolution input/reference');report.fixtureVerifiedTensorCount++;
    }
    report.phase='native-device';const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw Error('WebGPU unavailable');
    report.backend={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,
      device:adapter.info.device,isFallbackAdapter:adapter.info.isFallbackAdapter??adapter.isFallbackAdapter};validateNativePrefixBackend(report.backend);
    if(report.backend.isFallbackAdapter!==false)throw Error('explicit observed nonfallback adapter required');
    report.requiredLimits={maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize,maxBufferSize:adapter.limits.maxBufferSize};
    device=await adapter.requestDevice({requiredLimits:report.requiredLimits});
    device.pushErrorScope('validation');scope=true;device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    session=await createWebGpuInferenceSession({sessionId:'decoder-convolution-'+crypto.randomUUID(),adapter,device,adapterName:prefixAdapterName(adapter.info)});
    const stages=['decoder-hash-clear','decoder-hash-insert','decoder-neighbors','decoder-sparse-conv'],
      route=await session.registerRoute({routeId:SLAT_CONVOLUTION_ROUTE,runtimeOptions:{requiredStages:stages,
        kernel:{profile:'trellis2-source-F16-first-sparse-convolution-v0'}}});report.effectiveRoute=route.routeId;
    if(report.effectiveRoute!==report.requestedRoute)throw Error('convolution effective route mismatch');
    const runtime=route.runtime;ops=createSLatDecoderKernelOps(runtime);
    const input=ops.upload('convolution-input',[plan.rows,plan.ci],tensors.input),
      coordinates=ops.allocate('convolution-coordinates',[plan.rows,3],'i32'),
      weight=ops.upload('convolution-weight',[plan.co,3,3,3,plan.ci],tensors['weight.blocks.0.0.conv.weight']),
      bias=ops.upload('convolution-bias',[plan.co],tensors['weight.blocks.0.0.conv.bias']),
      outputs={convolution:ops.allocate('convolution-output',[plan.rows,plan.co])};
    runtime.uploadTensor(coordinates,tensors.coordinates);
    report.composition={...plan,convolutionsExecuted:0,metadataReadbackBytes:0,fullDecoderCalls:0,
      sessionId:session.snapshot().sessionId,inputHandoff:'offline exact half projection/coordinates/weights; production neighbor and convolution kernels',
      featureBytesToCPUDuringServing:0,coordinateBytesToCPUDuringServing:0,semanticFeatureDtype:'float16',physicalFeatureDtype:'f32'};
    report.phase='convolution-execution';const job=route.enqueue({jobId:'complete-first-convolution',execute:async invocation=>{
      outputs.neighbors=await ops.neighbors(coordinates,plan.resolution,invocation);
      await ops.conv(input,outputs.neighbors,weight,bias,outputs.convolution,invocation);await ops.settle();return outputs;
    }}),completed=await job.completion;recordSamplerCompletion(report,completed);
    report.composition.convolutionsExecuted=ops.convolutionsExecuted;report.composition.metadataReadbackBytes=ops.metadataReadbackBytes;
    if(completed.status!=='succeeded'){preserveSamplerWitnessFailure(report);return report;}
    report.phase='observation-retention';report.outputs={};
    // Finish retaining both observations before numerical admission. A wrong
    // neighbor map must not hide the convolution of that exact observed map.
    for(const name of ['neighbors','convolution']){
      const t=outputs[name],raw=await runtime.readTensor(t),data=t.dtype==='i32'?new Int32Array(raw):new Float32Array(raw),
        saved=await fetch('/output/'+name,{method:'POST',headers:{'X-Tensor-Dtype':t.dtype},body:data});
      if(!saved.ok)throw Error('raw convolution output not saved '+name);
      const expected=tensors['expected.'+name],comparison=name==='neighbors'?compareNeighbors(data,expected):compareSLatDecoderObservation('features',data,expected);
      report.outputs[name]={shape:t.shape,dtype:t.dtype,sha256:await hash(data),comparison};
      if(name==='convolution'){
        const a=new Uint32Array(data.buffer,data.byteOffset,data.length),b=new Uint32Array(expected.buffer,expected.byteOffset,expected.length);
        let failures=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])failures++;
        report.outputs[name].bitComparison={count:data.length,failures,passed:data.length===expected.length&&failures===0,
          role:'localization diagnostic; unchanged numeric gate'};
      }
    }
    report.numericalStatus=Object.values(report.outputs).every(r=>r.comparison.passed)?'passed':'failed';
    const validation=await device.popErrorScope();scope=false;if(validation)errors.push(validation.message);
    report.phase='profile';report.profileStatus='failed';
    report.profile=runtime.finishProfile({evidence:{mode:'live',source:'complete-source-matched-first-decoder-convolution'}});
    const actualStages=report.profile.profile.stages;
    if(actualStages.length!==stages.length||actualStages.some((s,i)=>s.name!==stages[i]))throw Error('exact production neighbor/convolution kernel sequence required');
    report.profileStatus='passed';if(errors.length)throw Error(errors.join('\n'));
    report.phase='convolution-conformance';validateSLatConvolutionResult(report,plan);
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
