import {createWebGpuInferenceSession} from '../../webgpu-inference-kit/src/core.js';
import {createTrellisSparseFlowAdapter} from './sparse-flow.js';
import {createTrellisSparseSamplerAdapter,SPARSE_SAMPLER_ROUTE} from './sparse-sampler.js';
import {validateFlowFixture} from './sparse-flow-witness-checks.js';
import {validateSamplerFixture,validateSamplerTrajectoryFixture,compareSamplerTensor,SAMPLER_OBSERVATIONS,requiredSamplerWitnessStages,finishSamplerWitnessObservation} from './sparse-sampler-witness-checks.js';
import {validateNativePrefixBackend,prefixAdapterName} from './sparse-prefix-witness-checks.js';
import {createSparseBlockInputCapture} from './sparse-block-witness.js';
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');

// Offline-only copies preserve recurrent states without reading them or using
// them as the next model input. The serving sampler still owns that recurrence.
export function createSparseSamplerTrajectoryCapture(runtime,sampler){
  const resources=[],first={},steps=[];let used=false,disposed=false,completedSteps=0;
  const snapshot=(name,tensor)=>{
    const capture=createSparseBlockInputCapture(runtime,tensor,`trellis.witness.sampler.${name}`);
    resources.push(capture);capture.capture();return capture.tensor;
  };
  return{first,steps,get completedSteps(){return completedSteps;},
    async run(sample,invocation){
      if(disposed)throw new Error('trajectory capture disposed');if(used)throw new Error('trajectory capture executes once');used=true;
      let result,modelCalls=0;
      for(let i=0;i<sampler.plan.steps.length;i++){
        result=await sampler.step({stepIndex:i,...(i===0?{sample}:{})},invocation);
        completedSteps++;modelCalls+=result.modelCalls;
        if(i===0){
          for(const name of SAMPLER_OBSERVATIONS)first[name]=snapshot(`first.${name}`,name==='sample'?result.sample:sampler.diagnostics[name]);
        }
        steps.push({index:i,clock:result.clock,tensor:i===0?first.sample:snapshot(`step${i}.sample`,result.sample)});
      }
      return{...result,stepsExecuted:completedSteps,modelCalls};
    },dispose(){if(disposed)return;disposed=true;for(const capture of resources)capture.dispose();}};
}

// One offline first-step observation. Serving sampler has no expected arrays,
// NPZ loader or readback between its model predictions and latent update.
export async function runSparseSamplerWitness(flowSha,samplerSha,trajectorySha){
  const report={status:'failed',phase:'fixture',requestedRoute:SPARSE_SAMPLER_ROUTE},errors=[];
  let device,session,flow,sampler,trajectoryCapture,errorScope=false;
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
    const flowPlan=validateFlowFixture(base),plan=validateSamplerFixture(reference,base,flowSha),tensors={},expected={},expectedStates=[];
    let trajectory;
    if(trajectorySha){
      trajectory=await manifest('/trajectory-fixture/manifest.json',trajectorySha);
      validateSamplerTrajectoryFixture(trajectory,reference,base,flowSha,samplerSha);
      report.trajectoryReference={sha256:trajectorySha,route:trajectory.referenceRoute,source:trajectory.source,producer:trajectory.producer,
        computedSteps:trajectory.computedSteps,reusedSteps:trajectory.reusedSteps,modelCalls:trajectory.modelCalls,
        completeScheduleModelCalls:trajectory.completeScheduleModelCalls,effectiveBackend:trajectory.effectiveBackend};
      for(const step of plan.steps)expectedStates.push(await tensor('/trajectory-fixture',`step${step.index}.sample`,trajectory.tensors[`step${step.index}.sample`]));
    }
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
    const requiredStages=trajectory?[...new Set(plan.steps.flatMap(step=>requiredSamplerWitnessStages(flowPlan,plan,step.index)))]:requiredSamplerWitnessStages(flowPlan,plan,0);
    const route=await session.registerRoute({routeId:SPARSE_SAMPLER_ROUTE,runtimeOptions:{requiredStages,
      kernel:{profile:trajectory?'trellis2-sparse-complete-schedule-bf16-model-f32-sampler-v0':'trellis2-sparse-first-step-bf16-model-f32-sampler-v0'}}});
    report.effectiveRoute=route.routeId;if(report.effectiveRoute!==SPARSE_SAMPLER_ROUTE)throw new Error('effective sampler route mismatch');
    const prefix=Object.fromEntries(Object.entries(tensors).filter(([name])=>name.startsWith('prefix.')).map(([name,v])=>[name.slice(7),v]));
    const blocks=Array.from({length:flowPlan.numBlocks},(_,i)=>({...Object.fromEntries(Object.entries(tensors)
      .filter(([name])=>name.startsWith(`block${i}.`)).map(([name,v])=>[name.slice(`block${i}.`.length),v])),gelu:tensors.gelu}));
    report.phase='model-construction';const construction=performance.now();
    flow=createTrellisSparseFlowAdapter({route,config:base.config,weights:{prefix,blocks,
      terminal:{weight:tensors['terminal.weight'],bias:tensors['terminal.bias']}},conditioning:tensors.conditioning,phases:tensors.phases});
    sampler=createTrellisSparseSamplerAdapter({route,flow,config:reference.config,conditioning:tensors.conditioning});
    if(trajectory)trajectoryCapture=createSparseSamplerTrajectoryCapture(route.runtime,sampler);
    report.constructionHostMs=performance.now()-construction;report.phase=trajectory?'complete-sampler-schedule':'first-sampler-step';const start=performance.now();
    const job=route.enqueue({jobId:trajectory?'sparse-complete-cfg-euler-schedule':'sparse-first-cfg-euler-step',execute:invocation=>trajectory
      ?trajectoryCapture.run(tensors.sample,invocation):sampler.step({sample:tensors.sample,stepIndex:0},invocation)});
    const completion=await job.completion;
    report.executionStatus=completion.status;
    // On a failed recurrent job, preserve snapshots of completed steps before
    // returning failure. They never become fallback model inputs.
    const result=completion.output;
    if(completion.status==='succeeded'&&(result.sample!==flow.inputs.sample||result.sample!==sampler.outputs.sample||
      result.modelCalls!==(trajectory?plan.steps.reduce((n,step)=>n+(step.guided?2:1),0):2)||
      (trajectory?result.stepsExecuted!==plan.steps.length:!result.guidanceRescaled)))throw new Error('complete resident sampler output identity mismatch');
    report.hostSubmitMs=performance.now()-start;report.sessionId=session.snapshot().sessionId;
    report.composition={sameSession:true,sameJob:true,modelCalls:result?.modelCalls,executedBlocks:result?result.modelCalls*flowPlan.numBlocks:undefined,
      stepsExecuted:trajectory?trajectoryCapture.completedSteps:result?1:0,stepIndex:result?.stepIndex,clock:result?.clock,positivePredictionSurvivesNegative:'GPU snapshot',
      readbackBetweenModelPasses:false,readbackBeforeEuler:false,readbackBetweenSamplerSteps:false,latentState:'same resident input/output tensor',
      outputShape:sampler.outputs.sample.shape,arithmetic:sampler.plan.arithmetic,negativeConditioning:'complete zeros_like positive'};
    report.phase='observation-readback';report.outputs={};const observer=performance.now();
    const observed=trajectory?trajectoryCapture.first:result?{...sampler.diagnostics,sample:result.sample}:{};
    for(const name of SAMPLER_OBSERVATIONS){
      const current=observed[name];if(!current)continue;
      const raw=await route.runtime.readTensor(current),values=raw instanceof Float32Array?raw:new Float32Array(raw);
      const saved=await fetch(`/output/${name}`,{method:'POST',body:values});if(!saved.ok)throw new Error(`raw sampler output not saved:${name}`);
      report.outputs[name]={shape:current.shape,dtype:current.dtype,sha256:await hash(values),comparison:compareSamplerTensor(name,values,expected[name])};
    }
    if(trajectory){
      report.trajectory={steps:[],stateSnapshots:'GPU copies; readback only after schedule job terminal'};
      for(const step of trajectoryCapture.steps){
        const name=`step${step.index}.sample`,raw=await route.runtime.readTensor(step.tensor),values=raw instanceof Float32Array?raw:new Float32Array(raw);
        const saved=await fetch(`/output/${name}`,{method:'POST',body:values});if(!saved.ok)throw new Error(`raw trajectory state not saved:${name}`);
        report.trajectory.steps.push({index:step.index,clock:step.clock,shape:step.tensor.shape,dtype:step.tensor.dtype,sha256:await hash(values),
          comparison:compareSamplerTensor('sample',values,expectedStates[step.index])});
      }
    }
    report.observerReadbackAndSaveMs=performance.now()-observer;
    const validation=await device.popErrorScope();errorScope=false;if(validation)errors.push(validation.message);
    if(errors.length)throw new Error(errors.join('\n'));
    if(completion.status!=='succeeded')throw new Error(`sampler job ${completion.status}:${completion.error?.message||''}`);
    finishSamplerWitnessObservation(report,()=>route.runtime.finishProfile({evidence:{mode:'live',source:trajectory?'sparse-complete-schedule-exact-source-reference':'sparse-first-step-exact-source-reference'}}),trajectory?plan.steps.length:undefined);
    report.status='succeeded';report.phase=null;
  }catch(error){report.error={message:error.message,stack:error.stack};}
  finally{
    if(errorScope){const validation=await device.popErrorScope();if(validation)errors.push(validation.message);}
    report.errors=errors;
    for(const [name,cleanup] of [['trajectory-capture',()=>trajectoryCapture?.dispose()],['sampler',()=>sampler?.dispose()],['flow',()=>flow?.dispose()],
      ['session',async()=>{if(session){await session.drain();session.close();}}],['device',()=>device?.destroy()]]){
      try{await cleanup();}catch(error){report.cleanupErrors??=[];report.cleanupErrors.push({name,message:error.message});report.status='failed';}
    }
  }
  return report;
}
