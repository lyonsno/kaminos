import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {opticalSteppingConfig,validateOpticalPreviewArm} from '../volume-optical-native.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
test('native numerical comparison is opt-in and does not inherit sample-budget tail truncation', () => {
  assert.match(core, /setDebugOpticalStepping\(/, 'native camera must expose an explicit comparison switch');
  assert.match(core, /!opticalStepping && \(expensiveSamples >= expensiveSampleBudget/);
  assert.match(core, /if \(opticalStepping\) \{[\s\S]*?opticalStepObserve/);
});
test('visual witness rejects wrong route, stale tolerance, changed state and absent pixels', () => {
  const requested={mode:'numerical',tolerance:0.001,step:150};
  const state={backend:'WebGPU:apple',simStepCount:150,opticalStepping:{effective:'numerical',tolerance:0.001},
    raymarchShaderSpecialization:{effective:'lean-emissive-raymarch-v0'},physicalColor:{effective:'emissive-transport-v2'}};
  const sample={ok:true,image:{width:1,height:1,rgba:[20,10,5,255]}};
  validateOpticalPreviewArm(sample,state,requested);
  for (const patch of [{backend:'fallback'},{simStepCount:151},{opticalStepping:{effective:'fixed',tolerance:0.001}},
    {opticalStepping:{effective:'numerical',tolerance:0.01}},{raymarchShaderSpecialization:{effective:'full'}},{physicalColor:{effective:'other'}}]) {
    assert.throws(()=>validateOpticalPreviewArm(sample,{...state,...patch},requested),/wrong effective/);
  }
  for (const image of [null,{width:1,height:1,rgba:[1,2]}, {width:1,height:1,rgba:[0,0,0,255]}, {width:0,height:1,rgba:[]}]) {
    assert.throws(()=>validateOpticalPreviewArm({...sample,image},state,requested),/frame/);
  }
  assert.throws(()=>validateOpticalPreviewArm({...sample,ok:false},state,requested),/wrong effective/);
});
test('comparison configuration fails closed and retains explicit non-bound semantics', () => {
  assert.equal(opticalSteppingConfig().mode, 'current');
  for (const mode of ['fixed','numerical','fixed-dense']) assert.equal(opticalSteppingConfig({mode}).mode, mode);
  assert.throws(() => opticalSteppingConfig({mode:'regional'}), /unknown optical/);
  for (const tolerance of [0,-1,NaN,Infinity,'0.01']) assert.throws(() => opticalSteppingConfig({tolerance}), /finite/);
  assert.match(opticalSteppingConfig({mode:'numerical'}).authority, /not a continuous-field bound/);
});
