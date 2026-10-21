// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {flamePoseToDomain,immersedControlsForFlamePose,immersedRadiusBounds} from '../scene-flame-emitter.mjs';
const observed=JSON.parse(readFileSync(new URL('./fixtures/immersed-basin-pose-readback.json',import.meta.url)));
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function flameSettingsState(');
const code=html.slice(start,html.indexOf('\n}\n',start)+3);

test('basin loading canonicalizes numeric boundary noise even without a warning',async()=>{
 const begin=html.indexOf('async function loadAuthoredFlameBasin(');
 const loadCode=html.slice(begin,html.indexOf('\n}\n',begin)+3);
 for(const radius of [.5000000000000001,.019999999999999997,.9]){
  const state={domControls:{'emitter-assay-family':{value:'ring'},'volume-immersed-radius':{value:radius}},source:{id:'original'}};
  const context=vm.createContext({fetch:async()=>({ok:true,json:async()=>({})}),encodeURIComponent,
   validateVolumeSettingsPresetDocument:()=>({preset:state,label:'original'}),
   flameSettingsState:()=>state,flameSettingsStateClamps:()=>radius===.9?[{message:'radius clamped'}]:[],
   clampedFlameSettingsState:s=>({...s,domControls:{...s.domControls,'volume-immersed-radius':{value:Math.max(.02,Math.min(.5,radius))}}}),
   window:{},console:{warn(){}},setInfo(){}});
  vm.runInContext(loadCode,context);
  const result=await context.loadAuthoredFlameBasin('original');
  assert.equal(result.domControls['volume-immersed-radius'].value,Math.max(.02,Math.min(.5,radius)));
  assert.equal(state.domControls['volume-immersed-radius'].value,radius,'original remains intact');
 }
});

test('basin pose projection uses browser-representable values without changing feed or source pose',()=>{
 const preset={domControls:{...structuredClone(observed.expected),'volume-emitter-source-law':{value:'immersed-source'},'volume-immersed-radius':{value:.2},'volume-immersed-fuel':{value:.789012345}},rendererControls:{},presentationControls:{}};
 const before=structuredClone(preset);let clones=0;
 // Replay the observed browser range contract, not a general floating-point
 // tolerance. Native conformance exercises this same projection with real DOM.
 const context=vm.createContext({structuredClone,flameEmitterPose:observed.sourcePose,flameDomainTranslation:[0,0,0],flameDomainScale:1,activeVolumeSettingsPresetReceipt:null,flamePoseToDomain,immersedControlsForFlamePose,immersedRadiusBounds,
  document:{getElementById:id=>({cloneNode(){clones++;return{step:'any',set value(value){assert.equal(Number(value),observed.expected[id].value);},get value(){return String(observed.observed[id].value);}};}})}});
 vm.runInContext(code,context);const state=context.flameSettingsState(preset,{preset});
 for(const [id,descriptor] of Object.entries(observed.observed)){
  assert.equal(state.domControls[id].value,descriptor.value,id);
  assert.equal(Number(state.domControls[id].rawValue),descriptor.value,id);
 }
 assert.equal(clones,5);assert.deepEqual(preset,before,'preset stays immutable');
 assert.deepEqual(state.sourcePose,observed.sourcePose,'no direction or position change');
 assert.equal(state.domControls['volume-immersed-fuel'].value,.789012345,'feed stays exact');
 assert.deepEqual(state.source.preset,before,'retained original is not pose-projected');
 state.domControls['volume-immersed-radius'].value=.5;
 assert.deepEqual(state.source.preset,before,'subsequent clamping cannot mutate the retained original');
});
