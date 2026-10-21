// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVolumeEmitterFamilyRuntime, resolveVolumeCoreEmitterSource } from '../volume-emitter-runtime.mjs';
import { resolveImmersedSourceConfig } from '../volume-core.js';
import { flamePoseToDomain, flamePoseFromImmersedControls, flameEmitterFrame,
  updateFlameEmitterSupportOutline } from '../scene-flame-emitter.mjs';
import * as THREE from '../lib/three.core.js';
import { flameEmissionControlApplies } from '../flame-authoring.mjs';

// Doctor's landed 1e09d042 contract: centre is in domain coordinates, direction
// is yaw/pitch degrees, and positive supply requires converged open top.
const controls = { inputRadius: .12, flowRate: 1.2, emitterSourceLaw: 'immersed-source',
  pressureSolver: 'converged-open-top', immersedCentreX: 0, immersedCentreY: -.5,
  immersedCentreZ: 0, immersedYaw: 0, immersedPitch: 90, immersedRadius: .2,
  immersedSpeed: .1, immersedFuel: .56, immersedTemperature: 1.2 };
function runtime(pose, sourceEnabled = true) {
  const calls = []; let applied;
  const prototype = {
    setControls(next) { applied = next; calls.push('controls'); },
    setAnalyticEmitterDescriptor(descriptor) { calls.push(descriptor); return descriptor
      ? {...descriptor,mode:'analytic-fixed',count:1,coordinateSpace:'volume-local'}
      : {mode:'off',count:0,coordinateSpace:'none'}; },
    setCoreEmitterSourceMode(mode) { return resolveVolumeCoreEmitterSource({mode,controlFlowRate:applied.flowRate}); },
  };
  const receipt = applyVolumeEmitterFamilyRuntime({prototype,family:'ring',controls,emitterPose:pose,sourceEnabled});
  return {applied,calls,receipt,gas:resolveImmersedSourceConfig(applied,{grid:32})};
}
test('selected source pose drives actual immersed centre, direction and scaled aperture', () => {
  const pose = flamePoseToDomain({position:[3.3,1.5,-1.8],rotation:[0,0,Math.PI/2],scale:[1.5,1.5,1.5]},[3,2,-2]);
  const {applied,gas,calls} = runtime(pose);
  assert.ok(Math.abs(applied.immersedCentreX-.3)<1e-12,'object translation reaches the gas source');
  assert.deepEqual(gas.requested.centre.map(v=>Number(v.toFixed(6))),[.3,-.5,.2]);
  assert.deepEqual(gas.effective.direction.map(v=>Number(v.toFixed(6))),[-1,0,0]);
  assert.ok(Math.abs(gas.effective.radiusCells-4.8)<1e-12);
  assert.equal(gas.effective.admitted,true);
  assert.equal(calls.at(-1),null,'immersed supply does not compile a second analytic injector');
});
test('removal stops immersed supply, and restoration reuses the same feed', () => {
  const pose={position:[0,-.5,0],rotation:[0,0,0],scale:[1,1,1]};
  const off=runtime(pose,false);
  assert.equal(off.gas.effective.admitted,false);
  assert.equal(off.gas.effective.reason,'source-disabled');
  assert.equal(off.gas.effective.fluxRequested,0);
  assert.equal(runtime(pose).gas.effective.admitted,true);
});
// Operator, 2026-10-18: an out-of-range aperture is clamped and reported, never
// a refusal; a pose outside the domain is still refused (no value to clamp to).
test('an enabled source never silently clamps: a pose outside the domain is refused, an aperture is clamped and reported', () => {
  assert.throws(()=>runtime({position:[2,0,0],rotation:[0,0,0],scale:[1,1,1]}),/outside.*domain/i);
  const wide=runtime({position:[0,0,0],rotation:[0,0,0],scale:[3,3,3]});
  assert.ok(Math.abs(wide.applied.immersedRadius-.6)<1e-12,'the engine receives the full scaled aperture');
  assert.equal(wide.receipt.effective.radiusClamp,null,'large radii are not clamped');
  assert.equal(runtime({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}).receipt.effective.radiusClamp,null);
  assert.equal(runtime({position:[2,0,0],rotation:[0,0,0],scale:[1,1,1]},false).gas.effective.admitted,false);
});
test('Workbench centre and aim round trip through the translated object frame without losing roll', () => {
  const input={...controls,immersedCentreX:.123456789,immersedYaw:127.2,immersedPitch:-32.4};
  const pose=flamePoseFromImmersedControls(input,[2,3,4]);
  const {gas}=runtime(flamePoseToDomain(pose,[2,3,4]));
  assert.ok(Math.abs(gas.requested.centre[0]-input.immersedCentreX)<1e-12);
  assert.ok(Math.abs(gas.requested.yaw-input.immersedYaw)<1e-10);
  assert.ok(Math.abs(gas.requested.pitch-input.immersedPitch)<1e-10);
  const rolled={position:[0,-.5,0],rotation:[0,.8,0],scale:[1,1,1]};
  assert.deepEqual(flamePoseFromImmersedControls(controls,[0,0,0],rolled).rotation,rolled.rotation);
});
test('immersed helper is a disc with authored aperture radius and local +Y normal', () => {
  const group=new THREE.Group();
  updateFlameEmitterSupportOutline(THREE,group,{family:'ring',inputRadius:.7,sourceLaw:'immersed-source',immersedRadius:.2});
  const outline=group.userData.supportOutline;
  assert.equal(outline.geometry.type,'CircleGeometry');assert.equal(outline.geometry.parameters.radius,.2);
  assert.deepEqual(new THREE.Vector3(0,0,1).applyEuler(outline.rotation).toArray().map(v=>Number(v.toFixed(6))),[0,1,0]);
});
test('new source properties exclude old analytic knobs, while legacy source controls remain available', () => {
  for(const id of ['volume-immersed-speed','volume-immersed-radius','volume-immersed-cap-fraction'])assert.equal(flameEmissionControlApplies(id,'immersed-source'),true);
  for(const id of ['volume-flow-rate','volume-input-radius','emitter-assay-family'])assert.equal(flameEmissionControlApplies(id,'immersed-source'),false);
  assert.equal(flameEmissionControlApplies('volume-input-radius','shallow-primary'),true);
  assert.equal(flameEmissionControlApplies('volume-emitter-source-law','immersed-source'),true);
});

// Exercise the actual whole-settings check with base radius and object scale
// distinct. Operator, 2026-10-18: an out-of-range basin value is clamped and
// warned about, never a reason to refuse the basin, so the check passes and the
// clamp list names the scaled radius that will actually run.
test('whole-settings check clamps apertures outside the scaled source contract and reports them', async () => {
  const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
  const {normalizeFlameEmitterPose,immersedControlsForFlamePose,immersedRadiusClamp}=await import('../scene-flame-emitter.mjs');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const grab=name=>html.slice(html.indexOf(`function ${name}(`)).split('\n}')[0]+'\n}';
  let current;const controls={'volume-emitter-source-law':{tagName:'SELECT',options:[{value:'immersed-source'}]},'volume-immersed-radius':{tagName:'INPUT',type:'range',min:'.02',max:'.5'}};
  const context=vm.createContext({document:{getElementById:id=>controls[id]},flameSettingsState:()=>current,normalizeFlameEmitterPose,immersedControlsForFlamePose,immersedRadiusClamp,flamePoseToDomain,flameDomainTranslation:[0,0,0],flameDomainScale:1,flameEmitterPose:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},authoredFlamePresent:true,VOLUME_RETIRED_APERTURE_PATTERNS:[]});
  vm.runInContext(grab('flameSettingsStateProblems')+'\n'+grab('flameSettingsStateClamps')+'\n'+grab('checkFlameSettingsState')+'\nthis.check=checkFlameSettingsState;this.clamps=flameSettingsStateClamps;',context);
  for(const [scale,valid,outside,applied] of [[.8,.5,.02,.02],[2,.2,.3,null],[1,.2,135.764753512356,null]]){
    current={domControls:{'volume-emitter-source-law':{value:'immersed-source'},'volume-immersed-radius':{value:valid}},rendererControls:{},presentationControls:{},sourcePose:{position:[0,0,0],rotation:[0,0,0],scale:[scale,scale,scale]}};
    assert.equal(context.check(current),current);
    assert.deepEqual(JSON.parse(JSON.stringify(context.clamps(current))),[]);
    const wide=structuredClone(current);wide.domControls['volume-immersed-radius'].value=outside;
    assert.equal(context.check(wide),wide,'an out-of-range aperture is not refused');
    const listed=JSON.parse(JSON.stringify(context.clamps(wide)));
    if(applied===null){assert.deepEqual(listed,[],'large radii need no adjustment');continue;}
    assert.equal(listed.length,1,'the radius floor is reported once, as the scaled aperture');
    const [clamp]=listed;
    assert.equal(clamp.id,'volume-immersed-radius');
    assert.match(clamp.message,/scaled immersed source radius/);
    assert.match(clamp.message,new RegExp(`clamped to ${applied}`));
  }
});
