import assert from 'node:assert/strict';
import * as checks from '../sparse-sampler-witness-checks.js';
import {buildSparseSamplerPlan,SPARSE_SAMPLER_STAGES} from '../sparse-sampler.js';
import {createStagedSubmitProfile,addStagedSubmitStage} from '../../../webgpu-inference-kit/src/staged-profile.js';
import {finishAndValidateRouteProfile} from '../../../webgpu-inference-kit/src/route-receipt-helper.js';

const plan=buildSparseSamplerPlan(),flowPlan={stages:['full-flow-observed']};
// Replay the exact required-stage expression in ce208a02 until its replacement
// exists. These are the stages actually dispatched by the guided/rescaled path.
const required=checks.requiredSamplerWitnessStages
  ?checks.requiredSamplerWitnessStages(flowPlan,plan,0)
  :[...new Set([...flowPlan.stages,...SPARSE_SAMPLER_STAGES])];
const actual=['full-flow-observed','sampler-positive-snapshot','sampler-guidance','sampler-xstart',
  'sampler-guidance-std','sampler-guidance-rescale','sampler-euler-delta','sampler-euler-update'];
const profile=createStagedSubmitProfile({route:'observed-first-step',requiredStages:required});
for(const name of actual)addStagedSubmitStage(profile,{name,ms:0});
assert.doesNotThrow(()=>finishAndValidateRouteProfile(profile),'Guided/rescaled first step must validate without an unexecuted alternate snapshot.');
assert.throws(()=>finishAndValidateRouteProfile({...profile,stages:profile.stages.filter(s=>s.name!=='sampler-euler-update')}),/missing required stage sampler-euler-update/);
assert.ok(checks.requiredSamplerWitnessStages(flowPlan,buildSparseSamplerPlan({guidanceRescale:0}),0).includes('sampler-final-snapshot'));
assert.ok(checks.requiredSamplerWitnessStages(flowPlan,plan,11).includes('sampler-final-snapshot'));
assert.throws(()=>checks.requiredSamplerWitnessStages(flowPlan,plan,12),/step/);

const outputs=Object.fromEntries(checks.SAMPLER_OBSERVATIONS.map(name=>[name,{comparison:{passed:name!=='guided'}}]));
const report={outputs};
// ce208a02 finishes the profile before recording numericalStatus. A profile
// exception must not hide already retained numerical failures.
const finish=checks.finishSamplerWitnessObservation??((r,fn)=>{
  r.profile=fn();r.numericalStatus=Object.values(r.outputs).every(row=>row.comparison.passed)?'passed':'failed';
});
assert.throws(()=>finish(report,()=>{throw new Error('profile failed');}),/profile failed/);
assert.equal(report.numericalStatus,'failed','Complete numerical verdict survives an independent profile failure.');
assert.equal(report.profileStatus,'failed');
const failed={outputs};assert.throws(()=>checks.finishSamplerWitnessObservation(failed,()=>({complete:true})),/numerical comparison failed/);
assert.equal(failed.numericalStatus,'failed');assert.equal(failed.profileStatus,'passed');
const complete={outputs:Object.fromEntries(checks.SAMPLER_OBSERVATIONS.map(name=>[name,{comparison:{passed:true}}]))};
checks.finishSamplerWitnessObservation(complete,()=>({complete:true}));assert.equal(complete.numericalStatus,'passed');
const partial=structuredClone(complete);delete partial.outputs.sample;
assert.throws(()=>checks.finishSamplerWitnessObservation(partial,()=>({complete:true})),/numerical comparison failed/);
console.log('Actual stage validator accepts only executed branches; missing work and profile/numerical false closure remain rejected.');
