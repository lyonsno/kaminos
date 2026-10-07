import { createWebGpuInferenceSession } from '../../webgpu-inference-kit/src/core.js';
import { createTrellisSparseFlowAdapter, SPARSE_FLOW_ROUTE } from './sparse-flow.js';
import { validateFlowFixture,compareFlowTensor } from './sparse-flow-witness-checks.js';
import { comparePrefixTensor,validateNativePrefixBackend,prefixAdapterName } from './sparse-prefix-witness-checks.js';

const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');

// Offline observer only. Serving forward neither downloads expected values nor
// crosses hidden/prediction bytes to CPU; readback happens after all30blocks.
export async function runSparseFlowWitness(expectedSha){
  const report={status:'failed',phase:'fixture',requestedRoute:SPARSE_FLOW_ROUTE},errors=[];
  let device,session,implementation,errorScope=false;
  try{
    const response=await fetch('/fixture/manifest.json',{cache:'no-store'});
    if(!response.ok)throw new Error('full flow reference unavailable');
    const bytes=await response.arrayBuffer();report.fixtureSha256=await hash(bytes);
    if(report.fixtureSha256!==expectedSha)throw new Error('full flow manifest digest mismatch');
    const manifest=JSON.parse(new TextDecoder().decode(bytes)),plan=validateFlowFixture(manifest),tensors={};
    report.reference={route:manifest.referenceRoute,effectiveBackend:manifest.effectiveBackend,source:manifest.source,
      checkpoint:manifest.checkpoint,sample:manifest.sample,conditioning:manifest.conditioning,timeConvention:manifest.timeConvention,
      fullModelExecutions:manifest.fullModelExecutions,blocksExecuted:manifest.blocksExecuted};
    for(const [name,descriptor] of Object.entries(manifest.tensors)){
      if(!/^[\w.-]+$/.test(descriptor.file))throw new Error(`unsafe tensor path:${name}`);
      const item=await fetch(`/fixture/${descriptor.file}`,{cache:'no-store'});
      if(!item.ok)throw new Error(`missing flow tensor:${name}`);
      const data=await item.arrayBuffer();
      if(data.byteLength!==descriptor.byteLength||await hash(data)!==descriptor.sha256)throw new Error(`partial/changed flow tensor:${name}`);
      tensors[name]=new Float32Array(data);
    }
    if(tensors.timestep.length!==1||tensors.timestep[0]!==manifest.timeConvention.modelValue)throw new Error('captured timestep bytes disagree with model clock');
    report.phase='native-device';
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw new Error('WebGPU unavailable');
    report.backend={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,
      device:adapter.info.device,isFallbackAdapter:adapter.info.isFallbackAdapter??adapter.isFallbackAdapter};
    validateNativePrefixBackend(report.backend);
    device=await adapter.requestDevice({requiredLimits:{maxStorageBufferBindingSize:plan.block.hiddenBytes}});
    device.pushErrorScope('validation');errorScope=true;
    device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
    session=await createWebGpuInferenceSession({sessionId:`sparse-flow-${crypto.randomUUID()}`,adapter,device,adapterName:prefixAdapterName(adapter.info)});
    const route=await session.registerRoute({routeId:SPARSE_FLOW_ROUTE,runtimeOptions:{requiredStages:[...new Set(plan.stages)],
      kernel:{profile:'trellis2-sparse-full-flow-bf16-torso-f32-head-v0'}}});
    report.effectiveRoute=route.routeId;if(report.effectiveRoute!==report.requestedRoute)throw new Error('effective sparse flow route mismatch');
    const prefix=Object.fromEntries(Object.entries(tensors).filter(([name])=>name.startsWith('prefix.')).map(([name,values])=>[name.slice(7),values]));
    const blocks=Array.from({length:plan.numBlocks},(_,i)=>({...Object.fromEntries(Object.entries(tensors)
      .filter(([name])=>name.startsWith(`block${i}.`)).map(([name,values])=>[name.slice(`block${i}.`.length),values])),gelu:tensors.gelu}));
    report.phase='model-construction';
    const construction=performance.now();
    implementation=createTrellisSparseFlowAdapter({route,config:manifest.config,weights:{prefix,blocks,
      terminal:{weight:tensors['terminal.weight'],bias:tensors['terminal.bias']}},conditioning:tensors.conditioning,phases:tensors.phases});
    report.constructionHostMs=performance.now()-construction;
    report.phase='full-sparse-execution';
    const start=performance.now(),job=route.enqueue({jobId:'sparse-prefix-30blocks-terminal',execute:invocation=>
      implementation.run({sample:tensors.sample,timestep:tensors.timestep[0]},invocation)});
    const completion=await job.completion;
    if(completion.status!=='succeeded')throw new Error(`full flow job ${completion.status}:${completion.error?.message||''}`);
    if(completion.output.prediction!==implementation.outputs.prediction||completion.output.blocksExecuted!==30)throw new Error('complete resident model output identity mismatch');
    report.hostSubmitMs=performance.now()-start;report.sessionId=session.snapshot().sessionId;
    report.composition={sameSession:true,sameJob:true,executedBlocks:completion.output.blocksExecuted,
      readbackBetweenBlocks:false,readbackBetweenPrefixAndBlocks:false,activationStorage:'one-shared-serialized-block-workspace',
      outputShape:completion.output.prediction.shape,outputArithmetic:completion.output.arithmetic};
    report.phase='observation-readback';report.outputs={};
    const observerStart=performance.now(),observed={...implementation.diagnostics,prediction:completion.output.prediction};
    for(const [name,tensor] of Object.entries(observed)){
      const raw=await route.runtime.readTensor(tensor),data=raw instanceof Float32Array?raw:new Float32Array(raw);
      const saved=await fetch(`/output/${name}`,{method:'POST',body:data});if(!saved.ok)throw new Error(`raw flow ${name} could not be saved`);
      report.outputs[name]={shape:tensor.shape,dtype:tensor.dtype,sha256:await hash(data),
        comparison:(name==='projected'||name==='modulation'?comparePrefixTensor:compareFlowTensor)(data,tensors[`expected.${name}`])};
    }
    report.observerReadbackAndSaveMs=performance.now()-observerStart;report.completedWithReadbackMs=performance.now()-start;
    const validation=await device.popErrorScope();errorScope=false;if(validation)errors.push(validation.message);
    if(errors.length)throw new Error(errors.join('\n'));
    report.profile=route.runtime.finishProfile({evidence:{mode:'live',source:'sparse-full-flow-exact-first-step-fixture'}});
    report.numericalStatus=Object.values(report.outputs).every(row=>row.comparison.passed)?'passed':'failed';
    if(report.numericalStatus!=='passed')throw new Error('full sparse flow numerical comparison failed');
    report.status='succeeded';report.phase=null;
  }catch(error){report.error={message:error.message,stack:error.stack};}
  finally{
    if(errorScope){const validation=await device.popErrorScope();if(validation)errors.push(validation.message);}
    report.errors=errors;implementation?.dispose();if(session){await session.drain();session.close();}device?.destroy();
  }
  return report;
}
