// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),from=html.indexOf('    const primary=primaryAuthoredFlameSource();',html.indexOf('function applyVolumeEmitterFamilyRuntimeToCockpit')),to=html.indexOf('    renderVolumeEmitterReceipt(receipt);',from);
function project(record){const context=vm.createContext({family:'ring',primaryAuthoredFlameSource:()=>record,FIRE_DOMAIN_ID:'flame-field',readVolumeSettingsValues:()=>({domControls:{'volume-immersed-fuel':{value:.8}}}),fireControlOwner:()=> 'source'});vm.runInContext(html.slice(from,to),context);return record;}
test('the ordinary cockpit projection preserves a bound outlet recipe and its off state',()=>{
 const emission={domainId:'flame-field',burnerPort:{designId:'crown-ring',index:0},settings:{'volume-immersed-fuel':{value:.2}}},record={emission:structuredClone(emission),emissionEnabled:false,object:{userData:{kaminosSceneObject:{emission}}}};
 project(record);assert.deepEqual(record.emission,emission);assert.equal(record.emissionEnabled,false);
});
test('an independent flame source still receives ordinary cockpit edits',()=>{
 const record={object:{userData:{kaminosSceneObject:{}}}};project(record);assert.equal(record.emission.settings['volume-immersed-fuel'].value,.8);
});
