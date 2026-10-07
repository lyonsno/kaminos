import assert from 'node:assert/strict';
import test from 'node:test';
import { FLAME_PROPERTY_GROUPS } from '../flame-authoring.mjs';
import {resolveSceneCameraSettings,resolveVolumeAppearanceTrims,productTransportSettings,resolveProductGISettings} from '../scene-lighting-semantics.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolveSceneGISettings} from '../scene-gi-settings.mjs';

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

test('actual product GI setter rejects unknown supplied modes before effective state changes',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('function setSceneGIControls('),end=html.indexOf('for (const key of Object.keys(sceneGISettings))',start);
  let effective=resolveSceneGISettings();const nodes=new Map();
  const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:''});return nodes.get(id);}};
  const context={document,lightingDiagnostics:false,resolveSceneGISettings,resolveProductGISettings,updateSceneGI:value=>effective=value,sceneGISettings:effective};
  vm.createContext(context);vm.runInContext(html.slice(start,end),context);
  for(const mode of ['unsupported',17,null]) {
    const before=structuredClone(effective);assert.throws(()=>context.setSceneGIControls({mode}),/Invalid/);assert.deepEqual(effective,before);
  }
  context.setSceneGIControls({mode:'gtao'});assert.equal(effective.mode,'combined');
  context.setSceneGIControls({gain:5});assert.equal(effective.gain,5);
});

test('emissive opacity accumulator starts at vacuum rather than the legacy display background',()=>{
  const shader=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
  assert.ok(/var untrimmedEmissiveColor\s*=\s*vec3<f32>\(0\.0\)/.test(shader),'empty emissive rays must start transparent');
});

test('flame trim canonical field admits arbitrary decimal input like its visible projection',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const field=html.match(/<input[^>]*id="flame-appearance-trim"[^>]*>/)?.[0];
  assert.ok(field);assert.match(field,/step="any"/,'hidden source must admit the same decimals as the inspector');
});
