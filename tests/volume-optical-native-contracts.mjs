// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {opticalSteppingConfig,resolveOpticalStepping,validateOpticalPreviewArm,installOpticalSteppingPreview} from '../volume-optical-native.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
test('main composition retains fresh burn and separates ray-noise binding from reactants', () => {
  const sampling = readFileSync(new URL('../volume-raymarch-sampling.mjs', import.meta.url), 'utf8');
  const noise = readFileSync(new URL('../volume-ray-start.mjs', import.meta.url), 'utf8');
  assert.match(sampling, /result\.sample\.freshBurn = sampleWorldReactantBurn\(p\);/);
  assert.match(noise, /@binding\(25\) var rayStartNoise/);
  assert.match(core, /binding: 25, resource: rayStartNoiseTexture\.createView\(\)/);
  assert.doesNotMatch(core, /constants:\s*\{GRID:/);
});
test('six authored ray steps survive the slider, gamut, route and GPU clamp', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const input = html.match(/<input[^>]*id="volume-steps"[^>]*>/)[0];
  assert.equal(Number(input.match(/min="([^"]+)"/)[1]), 6, 'Ray Steps must admit six');
  const snap = html.match(/function snapVolumeRaySteps\(value\) \{[\s\S]*?\n\}/)[0];
  const context = vm.createContext({clampVolumeValue:(v,min,max)=>Math.max(min,Math.min(max,v))});
  vm.runInContext(snap, context);
  for (const value of [6,7,24,36,96,160]) assert.equal(context.snapVolumeRaySteps(value),value);
  assert.equal(context.snapVolumeRaySteps(0),6);
  assert.equal(context.snapVolumeRaySteps(200),160);
  assert.match(html,/x: \(snapVolumeRaySteps\(steps\) - 6\) \/ \(160 - 6\)/);
  assert.match(html,/snapVolumeRaySteps\(6 \+ clampVolumeValue\(x, 0, 1\) \* \(160 - 6\)\)/);
  assert.match(html,/Math\.max\(6, Math\.min\(160, routeRaySteps\)\)/);
  assert.match(core,/raySteps: clampFinite\(controls\.raySteps, 6, 160, 96\)/);
  assert.match(core,/clamp\(u\.viewport_steps_density\.z, 6\.0, 192\.0\)/);
});
test('native numerical stepping does not inherit sample-budget tail truncation', () => {
  assert.match(core, /setDebugOpticalStepping\(/, 'native camera must expose an explicit comparison switch');
  // The joined exterior lifts the sample budget only while it renders (its traversal cap grows instead).
  assert.match(core, /!opticalStepping && \(\(!exteriorActive && expensiveSamples >= expensiveSampleBudget\) \|\| traversalSteps >= maxTraversalSteps\)/);
  assert.match(core, /let opticalStepping = OPTICAL_STEP_MODE != 0u && !fullGridCapture && !opticalTrace && physicalColorMode > 1\.5 && !exteriorActive;/, 'numerical stepping is the default whenever the exterior is off');
  assert.match(core, /if \(opticalStepping\) \{[\s\S]*?opticalStepObserve/);
});
test('visual witness rejects wrong route, stale tolerance, changed state and absent pixels', () => {
  const requested={mode:'numerical',tolerance:0.001,step:150};
  const state={backend:'WebGPU:apple',simStepCount:150,opticalStepping:{effective:'numerical',tolerance:0.001},
    raymarchShaderSpecialization:{effective:'lean-emissive-raymarch-v0'},physicalColor:{effective:'emissive-transport-v2'}};
  const sample={ok:true,image:{width:1,height:1,rgba:[20,10,5,255]}};
  validateOpticalPreviewArm(sample,state,requested);
  assert.throws(()=>validateOpticalPreviewArm(sample,{...state,controls:{raySteps:24}},
    {...requested,raySteps:6}),/wrong effective/);
  validateOpticalPreviewArm(sample,{...state,controls:{raySteps:6}},{...requested,raySteps:6});
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
  assert.equal(opticalSteppingConfig().mode, 'numerical');
  assert.equal(opticalSteppingConfig().value, 2);
  assert.equal(opticalSteppingConfig().tolerance, 0.001);
  for (const mode of ['current','fixed','numerical','fixed-dense']) assert.equal(opticalSteppingConfig({mode}).mode, mode);
  assert.throws(() => opticalSteppingConfig({mode:'regional'}), /unknown optical/);
  for (const tolerance of [0,-1,NaN,Infinity,'0.01']) assert.throws(() => opticalSteppingConfig({tolerance}), /finite/);
  assert.match(opticalSteppingConfig({mode:'numerical'}).authority, /not a continuous-field bound/);
});

test('preview initially shows the numerical default or an explicitly active comparison', () => {
  function mount(active) {
    const nodes=[];
    const document={getElementById:()=>({closest:()=>({after:()=>{}})}),createElement:()=>{
      const node={style:{},append:()=>{},addEventListener:()=>{}};nodes.push(node);return node;
    }};
    installOpticalSteppingPreview({debugState:()=>({opticalStepping:active})},document);
    return nodes.find(node=>node.id==='optical-stepping-preview');
  }
  assert.equal(mount(null).value,'numerical:0.001');
  assert.equal(mount({mode:'current',effective:'current',tolerance:0.001}).value,'current');
  assert.equal(mount({mode:'numerical',effective:'numerical',tolerance:0.01}).value,'numerical:0.01');
});

test('numerical default preserves stock and diagnostic paths with an explicit effective receipt', () => {
  const config=opticalSteppingConfig();
  assert.equal(resolveOpticalStepping(config,{emissive:true}).value,2);
  for(const options of [{emissive:false},{emissive:true,trace:true}]) {
    const effective=resolveOpticalStepping(config,options);
    assert.equal(effective.requested,'numerical');
    assert.equal(effective.mode,'current');
    assert.equal(effective.value,0);
    assert.ok(effective.reason);
    assert.throws(()=>resolveOpticalStepping(config,{...options,explicit:true}),/requires lean emissive beauty/);
  }
  assert.equal(resolveOpticalStepping(opticalSteppingConfig({mode:'current'}),{emissive:false,explicit:true}).value,0);
  assert.match(core,/resolveOpticalStepping\(debugOpticalStepping/);
  assert.match(core,/OPTICAL_STEP_MODE:optical.value/);
});
