// Offline sampler admission and comparisons. Never relax these after a run.
import {buildSparseSamplerPlan} from './sparse-sampler.js';
import {compareFlowTensor} from './sparse-flow-witness-checks.js';
export const SAMPLER_REFERENCE_ROUTE='pinned-MLX-GPU-source-first-step-sampler/fast-SDPA/two-pass-LN/mlx-sum-QK/F32-CFG-Euler';
export const SAMPLER_OBSERVATIONS=Object.freeze(['positive','negative','guided','x0Positive','x0Guided','stds','rescaled','mixed','final','sample']);
export const SAMPLE_TOLERANCE=Object.freeze({atol:0.001,rtol:0.001});
export function requiredSamplerWitnessStages(flowPlan,plan,stepIndex=0){
  const step=plan.steps[stepIndex];if(!step)throw new RangeError('witness step outside source schedule');
  const stages=['sampler-positive-snapshot'];
  if(step.guided){
    stages.push('sampler-guidance');
    if(plan.guidanceRescale>0)stages.push('sampler-xstart','sampler-guidance-std','sampler-guidance-rescale');
    else stages.push('sampler-final-snapshot');
  }else stages.push('sampler-final-snapshot');
  return [...new Set([...flowPlan.stages,...stages,'sampler-euler-delta','sampler-euler-update'])];
}
export function finishSamplerWitnessObservation(report,finishProfile){
  // Numerical evidence exists independently of profile validation. Never hide
  // it behind a bookkeeping exception or accept an empty/partial output set.
  report.numericalStatus=SAMPLER_OBSERVATIONS.every(name=>report.outputs?.[name]?.comparison?.passed===true)?'passed':'failed';
  report.profileStatus='failed';
  try{report.profile=finishProfile();report.profileStatus='passed';}
  catch(error){report.profileError={message:error.message,stack:error.stack};throw error;}
  if(report.numericalStatus!=='passed')throw new Error('first sparse sampler numerical comparison failed');
}
export function compareSamplerTensor(name,actual,expected){
  if(!SAMPLER_OBSERVATIONS.includes(name))throw new Error('unknown sampler observation');
  if(name!=='sample')return compareFlowTensor(actual,expected);
  if(!actual.length||!expected.length)throw new Error('empty sampler state');
  if(actual.length!==expected.length)throw new Error('sampler state length mismatch');
  let failures=0,exactCount=0,maxAbs=0,squared=0,referenceSquared=0,worstIndex=0;
  for(let i=0;i<actual.length;i++){
    if(!Number.isFinite(actual[i])||!Number.isFinite(expected[i]))throw new Error(`non-finite sampler state:${i}`);
    const delta=Math.abs(actual[i]-expected[i]);if(delta>maxAbs){maxAbs=delta;worstIndex=i;}
    if(delta>SAMPLE_TOLERANCE.atol+SAMPLE_TOLERANCE.rtol*Math.abs(expected[i]))failures++;
    if(actual[i]===expected[i])exactCount++;squared+=delta*delta;referenceSquared+=expected[i]**2;
  }
  return{passed:failures===0,count:actual.length,failures,exactCount,maxAbs,worstIndex,
    actualAtWorst:actual[worstIndex],expectedAtWorst:expected[worstIndex],rmse:Math.sqrt(squared/actual.length),
    relativeL2:Math.sqrt(squared/Math.max(referenceSquared,Number.MIN_VALUE)),tolerance:SAMPLE_TOLERANCE};
}
export function validateSamplerFixture(manifest,flowManifest,flowSha){
  if(manifest?.schema!=='trellis2.sparse-sampler-reference.v0'||manifest.status!=='succeeded')throw new Error('complete source sampler-step reference required');
  const plan=buildSparseSamplerPlan(manifest.config);
  if(!/^[a-f0-9]{64}$/.test(flowSha)||manifest.flowFixture?.sha256!==flowSha||
      !/^[a-f0-9]{40}$/.test(manifest.source?.commit)||manifest.source.commit!==flowManifest.source?.commit||
      manifest.source.dirty!==''||manifest.producer?.dirty!==''||!/^[a-f0-9]{40}$/.test(manifest.producer?.commit))throw new Error('sampler/flow source identity mismatch');
  for(const name of ['sample','conditioning','checkpoint'])if(!/^[a-f0-9]{64}$/.test(manifest[name]?.sha256)||
      manifest[name].sha256!==flowManifest[name]?.sha256)throw new Error(`sampler/flow ${name} identity mismatch`);
  const b=manifest.effectiveBackend;
  if(manifest.referenceRoute!==SAMPLER_REFERENCE_ROUTE||manifest.stepIndex!==0||manifest.stepsExecuted!==1||manifest.modelCalls!==2||
      manifest.blocksExecuted!==60||b?.device!=='Device(gpu, 0)'||b.attention!=='fast'||b.qk?.backend!=='mlx-sum'||
      b.layernorm?.backend!=='mlx-two-pass'||b.rope?.backend!=='inherit'||b.terminal?.backend!=='mlx-native-linear'||
      b.std?.backend!=='source-cuda-t4-welford-metal'||b.std.algorithm!=='pytorch-2.10-cuda-welford-vt2-block512')throw new Error('source sampler effective route/count mismatch');
  if(!plan.steps[0].guided||plan.guidanceRescale<=0)throw new Error('first sampler-step witness must exercise guidance and rescale');
  for(const key of ['index','time','previousTime','modelTime','dt','coefficient','inverseCoefficient','guided']){
    if(manifest.clock?.[key]!==plan.steps[0][key])throw new Error(`sampler schedule/clock mismatch:${key}`);
  }
  for(const name of SAMPLER_OBSERVATIONS){
    const shape=name==='stds'?[2]:plan.shape,row=manifest.tensors?.[name];
    if(!row||JSON.stringify(row.shape)!==JSON.stringify(shape)||row.dtype!=='float32'||
        row.byteLength!==shape.reduce((a,b)=>a*b,4)||!/^[a-f0-9]{64}$/.test(row.sha256)||!/^[\w.-]+$/.test(row.file))throw new Error(`partial/incompatible sampler output:${name}`);
  }
  return plan;
}
