import {createWebGpuInferenceSession} from '../../webgpu-inference-kit/src/core.js';
import {createTrellisSparseFlowAdapter} from './sparse-flow.js';
import {createTrellisSparseSamplerAdapter,SPARSE_SAMPLER_ROUTE,SPARSE_SAMPLER_STAGES} from './sparse-sampler.js';
import {validateFlowFixture} from './sparse-flow-witness-checks.js';
import {validateSamplerFixture,compareSamplerTensor,SAMPLER_OBSERVATIONS} from './sparse-sampler-witness-checks.js';
import {validateNativePrefixBackend,prefixAdapterName} from './sparse-prefix-witness-checks.js';
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');

// One offline first-step observation. Serving sampler has no expected arrays,
// NPZ loader or readback between its model predictions and latent update.
export async function runSparseSamplerWitness(flowSha,samplerSha){
  const report={status:'failed',phase:'fixture',requestedRoute:SPARSE_SAMPLER_ROUTE},errors=[];
  let device,session,flow,sampler,errorScope=false;
  const manifest=async(url,sha)=>{
    const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`missing manifest:${url}`);
    const bytes=await response.arrayBuffer();if(await hash(bytes)!==sha)throw new Error(`changed manifest:${url}`);
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  const tensor=async(base,name,descriptor)=>{
    if(!/^[\w.-]+$/.test(descriptor.file))throw new Error(`unsafe tensor path:${name}`);
    const response=await fetch(`${base}/${descriptor.file}`,{cache:'no-store'});if(!response.ok)throw new Error(`missing tensor:${name}`);
    const bytes=await response.arrayBuffer();if(bytes.byteLength!==descriptor.byteLength||await hash(bytes)!==descriptor.sha256)throw new Error(`partial/changed tensor:${name}`);
    const values=new Float32Array(bytes);if(name!=='gelu'&&!values.every(Number.isFinite))throw new Error(`nonfinite tensor:${name}`);return values;
  };
  try{
    const base=await manifest('/fixture/manifest.json',flowSha),reference=await manifest('/sampler-fixture/manifest.json',samplerSha);
    const flowPlan=validateFlowFixture(base),plan=validateSamplerFixture(reference,base,flowSha),tensors={},expected={};
    report.flowFixtureSha256=flowSha;report.samplerFixtureSha256=samplerSha;
    report.reference={route:reference.referenceRoute,source:reference.source,producer:reference.producer,
      inputs:{sample:reference.sample,conditioning:reference.conditioning,checkpoint:reference.checkpoint},
      config:reference.config,clock:reference.clock,effectiveBackend:reference.effectiveBackend,
      modelCalls:reference.modelCalls,blocksExecuted:reference.blocksExecuted};
    for(const [name,row] of Object.entries(base.tensors)){
      if(!name.startsWith('expected.'))tensors[name]=await tensor('/fixture',name,row);
    }
    for(const name of SAMPLER_OBSERVATIONS)expected[name]=await tensor('/sampler-fixture',name,reference.tensors[name]);
    if(tensors.timestep[0]!==plan.steps[0].modelTime)throw new Error('model clock bytes differ from source sampler schedule');
    report.phase='native-device';
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw new Error('WebGPU unavailable');
    report.backend={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,
      device:adapter.info.device,isFallbackAdapter:adapter.info.isFallbackAdapter??adapter.isFallbackAdapter};
    validateNativePrefixBackend(report.backend);if(report.backend.isFallbackAdapter!==false)throw new Error('observed nonfallback adapter identity required');
    device=await adapter.requestDevice({requiredLimits:{maxStorageBufferBindingSize:flowPlan.block.hiddenBytes}});
    device.pushErrorScope('validation');errorScope=true;
    device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
    session=await createWebGpuInferenceSession({sessionId:`sparse-sampler-${crypto.randomUUID()}`,adapter,device,adapterName:prefixAdapterName(adapter.info)});
    const route=await session.registerRoute({routeId:SPARSE_SAMPLER_ROUTE,runtimeOptions:{requiredStages:[...new Set([...flowPlan.stages,...SPARSE_SAMPLER_STAGES])],
      kernel:{profile:'trellis2-sparse-first-step-bf16-model-f32-sampler-v0'}}});
    report.effectiveRoute=route.routeId;if(report.effectiveRoute!==SPARSE_SAMPLER_ROUTE)throw new Error('effective sampler route mismatch');
    const prefix=Object.fromEntries(Object.entries(tensors).filter(([name])=>name.startsWith('prefix.')).map(([name,v])=>[name.slice(7),v]));
    const blocks=Array.from({length:flowPlan.numBlocks},(_,i)=>({...Object.fromEntries(Object.entries(tensors)
      .filter(([name])=>name.startsWith(`block${i}.`)).map(([name,v])=>[name.slice(`block${i}.`.length),v])),gelu:tensors.gelu}));
    report.phase='model-construction';const construction=performance.now();
    flow=createTrellisSparseFlowAdapter({route,config:base.config,weights:{prefix,blocks,
      terminal:{weight:tensors['terminal.weight'],bias:tensors['terminal.bias']}},conditioning:tensors.conditioning,phases:tensors.phases});
    sampler=createTrellisSparseSamplerAdapter({route,flow,config:reference.config,conditioning:tensors.conditioning});
    report.constructionHostMs=performance.now()-construction;report.phase='first-sampler-step';const start=performance.now();
    const job=route.enqueue({jobId:'sparse-first-cfg-euler-step',execute:invocation=>sampler.step({sample:tensors.sample,stepIndex:0},invocation)});
    const completion=await job.completion;
    if(completion.status!=='succeeded')throw new Error(`sampler job ${completion.status}:${completion.error?.message||''}`);
    const result=completion.output;
    if(result.sample!==flow.inputs.sample||result.sample!==sampler.outputs.sample||result.modelCalls!==2||!result.guidanceRescaled)throw new Error('complete resident sampler output identity mismatch');
    report.hostSubmitMs=performance.now()-start;report.sessionId=session.snapshot().sessionId;
    report.composition={sameSession:true,sameJob:true,modelCalls:result.modelCalls,executedBlocks:result.modelCalls*flowPlan.numBlocks,
      stepsExecuted:1,stepIndex:result.stepIndex,clock:result.clock,positivePredictionSurvivesNegative:'GPU snapshot',
      readbackBetweenModelPasses:false,readbackBeforeEuler:false,latentState:'same resident input/output tensor',
      outputShape:result.sample.shape,arithmetic:result.arithmetic,negativeConditioning:'complete zeros_like positive'};
    report.phase='observation-readback';report.outputs={};const observer=performance.now();
    const observed={...sampler.diagnostics,sample:result.sample};
    for(const name of SAMPLER_OBSERVATIONS){
      const current=observed[name],raw=await route.runtime.readTensor(current),values=raw instanceof Float32Array?raw:new Float32Array(raw);
      const saved=await fetch(`/output/${name}`,{method:'POST',body:values});if(!saved.ok)throw new Error(`raw sampler output not saved:${name}`);
      report.outputs[name]={shape:current.shape,dtype:current.dtype,sha256:await hash(values),comparison:compareSamplerTensor(name,values,expected[name])};
    }
    report.observerReadbackAndSaveMs=performance.now()-observer;
    const validation=await device.popErrorScope();errorScope=false;if(validation)errors.push(validation.message);
    if(errors.length)throw new Error(errors.join('\n'));
    report.profile=route.runtime.finishProfile({evidence:{mode:'live',source:'sparse-first-step-exact-source-reference'}});
    report.numericalStatus=Object.values(report.outputs).every(row=>row.comparison.passed)?'passed':'failed';
    if(report.numericalStatus!=='passed')throw new Error('first sparse sampler numerical comparison failed');
    report.status='succeeded';report.phase=null;
  }catch(error){report.error={message:error.message,stack:error.stack};}
  finally{
    if(errorScope){const validation=await device.popErrorScope();if(validation)errors.push(validation.message);}
    report.errors=errors;
    for(const [name,cleanup] of [['sampler',()=>sampler?.dispose()],['flow',()=>flow?.dispose()],
      ['session',async()=>{if(session){await session.drain();session.close();}}],['device',()=>device?.destroy()]]){
      try{await cleanup();}catch(error){report.cleanupErrors??=[];report.cleanupErrors.push({name,message:error.message});report.status='failed';}
    }
  }
  return report;
}
