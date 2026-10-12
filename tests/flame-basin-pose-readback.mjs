import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {flamePoseToDomain,immersedControlsForFlamePose} from '../scene-flame-emitter.mjs';
const observed=JSON.parse(readFileSync(new URL('./fixtures/immersed-basin-pose-readback.json',import.meta.url)));
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function flameSettingsState(');
const code=html.slice(start,html.indexOf('\n}\n',start)+3);

test('basin pose projection uses browser-representable values without changing feed or source pose',()=>{
 const preset={domControls:{...structuredClone(observed.expected),'volume-emitter-source-law':{value:'immersed-source'},'volume-immersed-radius':{value:.2},'volume-immersed-fuel':{value:.789012345}},rendererControls:{},presentationControls:{}};
 const before=structuredClone(preset);let clones=0;
 // Replay the observed browser range contract, not a general floating-point
 // tolerance. Native conformance exercises this same projection with real DOM.
 const context=vm.createContext({structuredClone,flameEmitterPose:observed.sourcePose,flameDomainTranslation:[0,0,0],flameDomainScale:1,activeVolumeSettingsPresetReceipt:null,flamePoseToDomain,immersedControlsForFlamePose,
  document:{getElementById:id=>({cloneNode(){clones++;return{step:'any',set value(value){assert.equal(Number(value),observed.expected[id].value);},get value(){return String(observed.observed[id].value);}};}})}});
 vm.runInContext(code,context);const state=context.flameSettingsState(preset);
 for(const [id,descriptor] of Object.entries(observed.observed)){
  assert.equal(state.domControls[id].value,descriptor.value,id);
  assert.equal(Number(state.domControls[id].rawValue),descriptor.value,id);
 }
 assert.equal(clones,5);assert.deepEqual(preset,before,'preset stays immutable');
 assert.deepEqual(state.sourcePose,observed.sourcePose,'no direction or position change');
 assert.equal(state.domControls['volume-immersed-fuel'].value,.789012345,'feed stays exact');
});
