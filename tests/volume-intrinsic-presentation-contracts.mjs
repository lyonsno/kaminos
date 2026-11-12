// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createKaminosVolumePrototype} from '../volume-core.js';
function prototype() {
 const stub=()=>new Proxy(function(){},{get(t,p){if(p===Symbol.toPrimitive)return()=>0;if(p==='then')return undefined;return t[p]??(t[p]=stub());},set(t,p,v){t[p]=v;return true;},apply(){return stub();},construct(){return stub();}});
 globalThis.document=stub();globalThis.window=stub();globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{};globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 return createKaminosVolumePrototype({THREE:stub(),viewport:stub(),camera:stub(),controls:stub(),getControls:()=>({resolution:8,raySteps:8,adaptiveRays:0,renderScale:.5,smoke:.6}),onStatus(){}});
}
test('retained intrinsic and beauty controls preserve authored quality and simulation state',()=>{
 const p=prototype();try{
  const before=p.debugState();
  const intrinsic=p.setVolumePresentationMode('intrinsic');
  assert.equal(intrinsic.effectiveMode,'intrinsic');
  assert.equal(intrinsic.targetIdentity,'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0');
  assert.equal(intrinsic.authoredControlsMutated,false);
  const smoke=p.setRaymarchSmokePresentationMode('on');assert.equal(smoke.effectiveMode,'off');assert.equal(smoke.authoredSmokeControlMutated,false);
  const beauty=p.setVolumePresentationMode('beauty');assert.equal(beauty.effectiveMode,'beauty');assert.deepEqual(beauty.effectiveRayQuality,intrinsic.effectiveRayQuality);
  assert.equal(p.debugState().raymarchSmokePresentationModeEffective,'on');
  const after=p.debugState();assert.equal(after.simStepCount,before.simStepCount);assert.equal(after.fluidStateResetCount,before.fluidStateResetCount);
 }finally{p.dispose();}
});
test('unsupported presentation requests expose their normalization and reason',()=>{
 const p=prototype();try{
  const receipt=p.setVolumePresentationMode('unsupported');assert.equal(receipt.requestedMode,'unsupported');assert.equal(receipt.effectiveMode,'beauty');assert.equal(receipt.fallbackReason,'unsupported-volume-presentation-mode:unsupported');
  const smoke=p.setRaymarchSmokePresentationMode('unsupported');assert.equal(smoke.requestedMode,'unsupported');assert.equal(smoke.effectiveMode,'on');assert.equal(smoke.fallbackReason,'unsupported-raymarch-smoke-presentation-mode:unsupported');
 }finally{p.dispose();}
});
