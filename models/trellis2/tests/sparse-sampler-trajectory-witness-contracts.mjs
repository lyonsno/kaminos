import assert from 'node:assert/strict';
import * as api from '../sparse-sampler-witness-checks.js';
import {buildSparseSamplerPlan} from '../sparse-sampler.js';
assert.equal(typeof api.validateSamplerTrajectoryFixture,'function','Missing complete schedule admission with retained first-step provenance and every recurrent state.');
const sha='a'.repeat(64),commit='b'.repeat(40),config={steps:12,guidanceStrength:7.5,guidanceRescale:.7,guidanceInterval:[.6,1],rescaleT:5,sigmaMin:1e-5},plan=buildSparseSamplerPlan(config);
const descriptor=(name,shape=plan.shape)=>({file:`${name}.f32`,shape,dtype:'float32',byteLength:shape.reduce((a,b)=>a*b,4),sha256:sha});
const base={source:{commit,dirty:''},sample:{sha256:sha},conditioning:{sha256:sha},checkpoint:{sha256:sha}};
const backend={device:'Device(gpu, 0)',attention:'fast',qk:{backend:'mlx-sum'},layernorm:{backend:'mlx-two-pass'},rope:{backend:'inherit'},terminal:{backend:'mlx-native-linear'},std:{backend:'source-cuda-t4-welford-metal',algorithm:'pytorch-2.10-cuda-welford-vt2-block512'}};
const first={schema:'trellis2.sparse-sampler-reference.v0',status:'succeeded',...structuredClone(base),producer:{commit,dirty:''},flowFixture:{sha256:sha},config,stepIndex:0,stepsExecuted:1,modelCalls:2,blocksExecuted:60,clock:plan.steps[0],referenceRoute:api.SAMPLER_REFERENCE_ROUTE,effectiveBackend:backend,
  tensors:Object.fromEntries(api.SAMPLER_OBSERVATIONS.map(name=>[name,descriptor(name,name==='stds'?[2]:plan.shape)]))};
const trajectory={schema:'trellis2.sparse-sampler-trajectory-reference.v0',status:'succeeded',...structuredClone(base),producer:{commit,dirty:''},flowFixture:{sha256:sha},firstStepFixture:{sha256:sha},config,clocks:plan.steps,stepsExecuted:12,computedSteps:11,reusedSteps:1,startStepIndex:1,modelCalls:20,blocksExecuted:600,completeScheduleModelCalls:22,referenceRoute:api.SAMPLER_TRAJECTORY_REFERENCE_ROUTE,effectiveBackend:backend,
  tensors:Object.fromEntries(plan.steps.map(step=>[`step${step.index}.sample`,descriptor(`step${step.index}.sample`)]))};
assert.equal(api.validateSamplerTrajectoryFixture(trajectory,first,base,sha,sha).steps.length,12);
for(const mutate of [r=>r.firstStepFixture.sha256='c'.repeat(64),r=>r.source.commit='c'.repeat(40),r=>r.source.dirty=' M model',r=>r.stepsExecuted=1,r=>r.modelCalls=22,r=>r.blocksExecuted=60,r=>r.startStepIndex=0,r=>r.reusedSteps=0,r=>r.completeScheduleModelCalls=2,r=>r.clocks=r.clocks.slice(0,11),r=>r.clocks[11].modelTime=1,r=>r.config.guidanceStrength=1,r=>r.effectiveBackend.device='Device(cpu, 0)',r=>delete r.tensors['step7.sample'],r=>r.tensors['step3.sample'].byteLength=4,r=>r.tensors['step5.sample'].dtype='float16',r=>r.tensors['step0.sample'].sha256='c'.repeat(64)]){
  const bad=structuredClone(trajectory);mutate(bad);assert.throws(()=>api.validateSamplerTrajectoryFixture(bad,first,base,sha,sha));
}
assert.equal(api.validateSamplerTrajectoryFixture({...trajectory,future:true},first,base,sha,sha).steps.length,12);
const report={outputs:Object.fromEntries(api.SAMPLER_OBSERVATIONS.map(name=>[name,{comparison:{passed:true}}])),trajectory:{steps:plan.steps.map(step=>({index:step.index,comparison:{passed:true}}))}};
api.finishSamplerWitnessObservation(report,()=>({}),12);assert.equal(report.trajectoryStatus,'passed');
const incomplete=structuredClone(report);incomplete.trajectory.steps.pop();assert.throws(()=>api.finishSamplerWitnessObservation(incomplete,()=>({}),12),/trajectory comparison failed/);
const mismatch=structuredClone(report);mismatch.trajectory.steps[8].comparison.passed=false;assert.throws(()=>api.finishSamplerWitnessObservation(mismatch,()=>({}),12),/trajectory comparison failed/);
console.log('Full schedule/provenance/backend/effective-count/state completeness and retained trajectory false-closure predicates pass.');
