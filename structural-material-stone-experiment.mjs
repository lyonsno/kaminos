import assert from 'node:assert/strict';
import { inspectStoneThickness } from './structural-material-stone-evidence.mjs';

export function assertStoneHeld(state, expected) {
  const errors=inspectStoneThickness(state,expected);
  assert.deepEqual(errors,[],`Stone source/material route unavailable: ${errors.join('; ')}`);
  const c=state.clock;
  assert.ok(c?.runId&&c.paused&&!c.busy&&!c.failure&&c.presentationDrained,'Stone observation requires a held, drained runtime');
  assert.ok([c.constructionSteps,c.submittedSteps,c.completedSteps,c.presentedSteps].every(n=>Number.isSafeInteger(n)&&n>=0),'Stone clock counts missing or invalid');
  assert.equal(c.completedSteps,c.submittedSteps,'Stone physical work is incomplete');
  assert.equal(c.presentedSteps,c.completedSteps,'Stone presentation is stale');
  assert.ok(c.completedSteps>=c.constructionSteps&&Number.isFinite(c.stepSeconds)&&c.stepSeconds>0,'Stone startup/time step absent');
  assert.equal(c.completedSeconds,c.completedSteps*c.stepSeconds,'Physical time drops construction loading');
  assert.equal(c.experimentSeconds,(c.completedSteps-c.constructionSteps)*c.stepSeconds,'Experiment time does not preserve startup offset');
  for(const specimen of state.specimens){assert.equal(specimen.state.step,c.completedSteps,'Paired specimen clock differs');assert.equal(specimen.state.config.timeStep,c.stepSeconds,'Paired step duration differs');}
  return state;
}

const fields=(value,names)=>Object.fromEntries(names.map(name=>[name,value?.[name]]));
export function stoneObservationAuthority(state){
  return {source:fields(state,['route','preparedSha256','sourceSha256']),clock:fields(state.clock,['runId','constructionSteps','completedSteps','stepSeconds']),camera:state.camera,
    mode:state.mode,paired:state.paired,resetReceipt:state.resetReceipt,
    specimens:state.specimens.map(s=>({config:s.state.config,step:s.state.step,connectivityEpoch:s.state.connectivityEpoch,broken:s.state.broken,hand:s.state.hand,
      bodies:s.state.bodies.map(b=>fields(b,['index','position','quaternion','velocity','angularVelocity','component','stress'])),
      bonds:s.state.bonds.map(b=>fields(b,['id','a','b','alive','stress','reaction','bendingReaction','anchorA','anchorB','area'])),
      rendererPoses:s.rendererPoses,visibleCaps:s.visibleCaps}))};
}

export function createStoneObservationRuntime({evaluate,expected}){
  assert.equal(typeof evaluate,'function','Stone evaluator required');
  return {
    settle:()=>evaluate('window.__stoneThickness.hold()'),
    read:()=>evaluate('window.__stoneThickness.witness()'),
    camera:view=>evaluate(`window.__stoneThickness.camera(${JSON.stringify(view)})`),
    validate:state=>assertStoneHeld(state,expected),
    assertStable(before,after){assertStoneHeld(before,expected);assertStoneHeld(after,expected);
      assert.deepEqual(stoneObservationAuthority(after),stoneObservationAuthority(before),'Stone run, material, load or camera changed during capture');},
  };
}
