// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sceneContext} from './helpers/scene-context.mjs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('async function collectSceneComposition()');
const collect=source.slice(start,source.indexOf('async function withAuthoringAction(',start));
let phase='failed',checkpoints=0;
const context=sceneContext({deviceRecovery:{state:()=>({phase})},
 volumePrototype:{debugState:()=>({active:false})},activeSceneComposition:{flame:{presetId:'old'}},
 isAuthoredKilnCollisionRoute:()=>false,isSceneItemVisible:()=>true,isFireLightFieldRoute:()=>true,volumeCockpitLayoutReady:Promise.resolve(),
 buildVolumeSettingsPreset:()=>({domControls:{},rendererControls:{},presentationControls:{}}),
 saveVolumeSettingsPreset:async()=>({effective:{presetId:'current-authored',label:'Retained'}}),
 activeVolumeSettingsPresetReceipt:null,burnerRecipe:null,COMPOSITION_SCHEMA:'test',
 document:{getElementById:()=>({value:'0',checked:false})},location:{hash:''},
});
vm.runInContext(collect,context);
await vm.runInContext('collectSceneComposition()',context);
assert.equal(context.activeSceneComposition.flame.presetId,'current-authored','failed recovery must still save the authored flame settings');
phase='active';await assert.rejects(vm.runInContext('collectSceneComposition()',context),/not active/,'ordinary inactive flame remains rejected');
phase='failed';context.authoredAsh.set('ash',{checkpoint(){checkpoints++;throw Error('dead GPU read');}});
await assert.rejects(vm.runInContext('collectSceneComposition()',context),/Ash state is unavailable after GPU loss/);
assert.equal(checkpoints,0,'excluded causal ash cannot attempt readback from a lost GPU');
console.log('failed recovery preserves authored flame saving and rejects unavailable ash state');
