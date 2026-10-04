import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertLocalLiquidSelectionContinuity } from '../local-liquid-selection-evidence.mjs';
const route='kaminos/finger-fluid/local-analytic-host-frame-v0';
function samples() {
  return [10,30].map(frameCount=>({water:{backend:'WebGPUBackend',mounted:true,failure:null,requestedRoute:route,effectiveRoute:route,frameCount,
    emitters:[{id:'A'},{id:'B'}],lastFrame:{frameId:'frame-'+frameCount,submittedByHost:true,presentedByHost:true},
    hostFrameCompositionEvidence:{hostFrameId:'frame-'+frameCount,effectiveRoute:route,primaryCommandEncoded:true},
    solver:{stepCount:frameCount,liveInlets:{generation:3,activeInletCount:2,inlets:[{id:'A',active:true},{id:'B',active:true}]}}}}));
}
test('selection witness admits advancing matching live frames with unchanged source generation',()=>assertLocalLiquidSelectionContinuity(samples()));
for(const [name,mutate] of [
  ['republication',r=>{r[1].water.solver.liveInlets.generation++}],
  ['fallback backend',r=>{r[1].water.backend='WebGLBackend'}],
  ['wrong route',r=>{r[1].water.effectiveRoute='demo'}],
  ['cached frames',r=>{r[1].water.frameCount=r[0].water.frameCount}],
  ['frozen solver',r=>{r[1].water.solver.stepCount=r[0].water.solver.stepCount}],
  ['missing generation',r=>{delete r[1].water.solver.liveInlets.generation}],
  ['mismatched frame',r=>{r[1].water.hostFrameCompositionEvidence.hostFrameId='older'}],
  ['partial source membership',r=>{r[1].water.solver.liveInlets.inlets.pop()}],
  ['inactive authored source',r=>{r[1].water.solver.liveInlets.inlets[0].active=false}],
  ['active padding',r=>{r[1].water.solver.liveInlets.inlets.push({id:'inactive-2',active:true,requestedActive:false,activationAuthority:'inactive_padding'})}],
  ['host stopped',r=>{r[1].water.mounted=false}],
])test('selection witness rejects '+name,()=>{const r=samples();mutate(r);assert.throws(()=>assertLocalLiquidSelectionContinuity(r));});

test('selection witness accepts observed inactive solver padding without treating it as a source',()=>{
  const r=samples();for(const s of r) s.water.solver.liveInlets.inlets.push({id:'inactive-2',active:false,requestedActive:false,activationAuthority:'inactive_padding'});
  assertLocalLiquidSelectionContinuity(r);
});
