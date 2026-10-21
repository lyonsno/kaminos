// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {volumeSettingsPresetControlValuesEqual} from '../volume-settings-preset-contract.mjs';
import {flamePresetForLocalControls} from '../flame-authoring.mjs';
import {flamePoseToDomain} from '../scene-flame-emitter.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const values={domControls:{a:{value:1}},rendererControls:{},presentationControls:{}};
function context(){return vm.createContext({structuredClone,activeVolumeSettingsPresetReceipt:{label:'Accepted',preset:structuredClone(values)},readVolumeSettingsValues:()=>structuredClone(values),volumeSettingsPresetControlValuesEqual,flamePresetForLocalControls,flamePoseToDomain,flameDomainTranslation:[0,0,0],flameDomainScale:1,buildVolumeSettingsPreset(){throw Error('capture URL constructed during live authoring read');},flameEmitterPose:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}});}
test('inspector modified state compares current values without building a capture route',()=>{
 const source=html.slice(html.indexOf('function createFlameQuickFields()'));const expr=source.slice(source.indexOf('readSource:')+11,source.indexOf('readSourceRuntime:')).trim().replace(/,$/,'');
 const ctx=context();const read=vm.runInContext('('+expr+')',ctx);assert.equal(read().modified,false);ctx.activeVolumeSettingsPresetReceipt.preset.domControls.a.value=2;assert.equal(read().modified,true);
});
test('history reads retain exact editable values without creating an unused capture route',()=>{
 const start=html.indexOf('function flameSettingsState('),code=html.slice(start,html.indexOf('\n}\n',start)+3);const ctx=context();vm.runInContext(code,ctx);const state=ctx.flameSettingsState();assert.deepEqual(JSON.parse(JSON.stringify(state.domControls)),values.domControls);assert.equal(state.source.label,'Accepted');
});
test('interactive pose writes do not scan precise bounds for every object in the scene',()=>{
 const start=html.indexOf('function applyAuthoredScenePose('),code=html.slice(start,html.indexOf('\n}\n',start)+3);let applied;
 const ctx=vm.createContext({sceneObjects:[{id:'source',type:'flame'}],CAMERA_TYPE:'camera',FLAME_EMITTER_TYPE:'flame',LOCAL_LIQUID_EMITTER_TYPE:'water',
  writeAuthoredFlameEmitterPose:value=>{applied=value;},updateTransformInspector(){},updateSelectionFeedback(){},window:{_kaminosDirty(){},kaminosSceneObjectDebugState(){throw Error('scanned whole scene bounds during pose preview');}}});
 vm.runInContext(code,ctx);ctx.applyAuthoredScenePose('source',{position:[1,2,3]});assert.deepEqual(applied.position,[1,2,3]);
});
