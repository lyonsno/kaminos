// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {createSceneEdits} from '../scene-edit-session.mjs';import {createFlameAuthoring} from '../flame-authoring.mjs';import {volumeSettingsPresetControlValuesEqual} from '../volume-settings-preset-contract.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const writer=html.slice(html.indexOf('function writeFlameSettingsState(state) {'),html.indexOf('function installFlameAuthoring()'));
const range=html.slice(html.indexOf('function applyVolumeRangeSavedValue('),html.indexOf('// Whether a select offers a value'));
const liveStart=html.indexOf('live:(key,value)=>{',html.indexOf('gridTuning:{'));
const live=html.slice(liveStart+'live:'.length,html.indexOf('\n      },\n      apply:patch=>',liveStart)+8);
function fixture(){
 const id='volume-pressure-solver-iterations',control={id,type:'range',min:'4',max:'240',step:'1',value:'12'},applied=[];
 const read=()=>({domControls:{[id]:{tagName:'INPUT',type:'range',value:Number(control.value),rawValue:control.value}},rendererControls:{},presentationControls:{'raymarch-smoke-presentation':{value:'on'}},volumeSceneRequested:'flame',source:null});
 const noop=()=>{};
 const ctx={window:{},GRID_TUNING_FIELDS:[['pressureSolverIterations',id]],document:{getElementById:key=>key===id?control:null},volumePrototype:{validateGridControls:noop,setRaymarchSmokePresentationMode:mode=>({effectiveMode:mode})},supersedeVolumeRebuildHolds:noop,setVolumeControlValue:noop,updateVolumeControlLabels:noop,applyFlameEmitterPose:()=>applied.push(Number(control.value)),flameEmitterPose:{},syncRaymarchSmokePresentationControls:noop,volumeSettingsPresetControlValuesEqual,buildVolumeSettingsPreset:read,syncBurnerControls:noop,refreshVolumeReadout:noop,recordFlameSettingsProblems:noop,flameInspector:null,checkFlameSettingsState:x=>x};
 vm.createContext(ctx);vm.runInContext(range+'\n'+writer+'\nvar live='+live+';',ctx);
 const edits=createSceneEdits({read:()=>({}),write:noop}),flame=createFlameAuthoring({edits,read,write:ctx.writeFlameSettingsState,check:x=>x});ctx.window.kaminosFlameAuthoring=flame;
 return{control,applied,edits,flame,live:ctx.live};
}
test('production live writer rolls back backing-range substitution inside the current gesture',()=>{
 for(const value of [1,3,241]){const f=fixture();f.edits.begin('@flame-settings','Tune iterations');assert.throws(()=>f.live('pressureSolverIterations',value),/substituted/);assert.equal(f.control.value,'12','refused live edit restores all applied settings');assert.equal(f.applied.at(-1),12);assert.equal(f.edits.state().active.id,'@flame-settings');f.edits.commit();assert.equal(f.edits.state().undoCount,0);}
});
test('valid live iterations form one undoable gesture and unowned preview is refused',()=>{
 const f=fixture();f.edits.begin('@flame-settings','Tune iterations');f.live('pressureSolverIterations',7);f.live('pressureSolverIterations',8);f.edits.commit();assert.equal(f.control.value,'8');assert.equal(f.edits.state().undoCount,1);f.edits.undo();assert.equal(f.control.value,'12');f.edits.redo();assert.equal(f.control.value,'8');assert.throws(()=>f.flame.preview(f.flame.read()),/gesture|edit/);
});
