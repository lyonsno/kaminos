import assert from 'node:assert/strict';
import test from 'node:test';
import { FLAME_PROPERTY_GROUPS } from '../flame-authoring.mjs';
import {resolveSceneCameraSettings,resolveVolumeAppearanceTrims,productTransportSettings} from '../scene-lighting-semantics.mjs';

test('flame appearance exposes independent emitted and smoke-receiving trims',()=>{
  const appearance=FLAME_PROPERTY_GROUPS.find(group=>group.name==='Appearance').fields.map(([id])=>id);
  assert.ok(appearance.includes('flame-appearance-trim'),'direct visible emission trim is missing');
  assert.ok(appearance.includes('smoke-illumination-trim'),'shared smoke illumination trim is missing');
});

test('camera is independent scene state and known legacy transport paths migrate explicitly',()=>{
  assert.deepEqual(resolveSceneCameraSettings({exposureEV:2,whiteBalanceKelvin:7000,highlightKnee:.7}),{exposureEV:2,whiteBalanceKelvin:7000,highlightKnee:.7});
  assert.throws(()=>resolveSceneCameraSettings({highlightKnee:1}));
  assert.throws(()=>resolveSceneCameraSettings({whiteBalanceKelvin:NaN}));
  const before={'rendering-angular-pattern':'fixed','rendering-smoke-solver':'legacy','rendering-surface-scattering':false,'rendering-light-mode':'all','rendering-shared-gain':2};
  const next=productTransportSettings(before);
  assert.equal(next['rendering-angular-pattern'],'source');assert.equal(next['rendering-smoke-solver'],'distributed');assert.equal(next['rendering-surface-scattering'],true);assert.equal(next['rendering-light-mode'],'shared');assert.equal(next['rendering-shared-gain'],2);assert.equal(before['rendering-angular-pattern'],'fixed');
  assert.throws(()=>productTransportSettings({...before,'rendering-angular-pattern':'unrecognized'}),/Unknown/);
  assert.throws(()=>productTransportSettings({...before,'rendering-light-mode':'unrecognized'}),/Unknown/);
  assert.throws(()=>productTransportSettings({...before,'rendering-surface-scattering':'true'}),/Invalid/);
});

test('appearance trims are independent finite radiance multipliers with neutral defaults',()=>{
  assert.deepEqual(resolveVolumeAppearanceTrims(),{flameStops:0,smokeStops:0});
  assert.deepEqual(resolveVolumeAppearanceTrims({flameStops:2,smokeStops:-1}),{flameStops:2,smokeStops:-1});
  assert.throws(()=>resolveVolumeAppearanceTrims({smokeStops:Infinity}));
  assert.throws(()=>resolveVolumeAppearanceTrims({flameStops:128}));
});
