// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFlameInspectorRefresh} from '../flame-inspector-refresh.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createFlameAuthoring} from '../flame-authoring.mjs';

function fixture(){
 let live={gain:1},visible={gain:1},diagnosticGain=1;const calls=[];
 const refresh=createFlameInspectorRefresh(force=>{calls.push(force);visible=structuredClone(live);});
 const edits=createSceneEdits({read:()=>null,write:()=>{}});
 const flame=createFlameAuthoring({
  edits:{...edits,preview:next=>refresh.preview(()=>edits.preview(next))},
  read:()=>structuredClone(live),check:next=>next,
  write:next=>{
   live=structuredClone(next);
   if(next.gain===99)throw Error('runtime rejected');
   refresh.request(); // refreshVolumeReadout inside the settings writer
   refresh.request(true); // native bounds and visible fields before diagnostics
   diagnosticGain=visible.gain;
  },
  changed:()=>refresh.request(),
 });
 edits.subscribe(()=>refresh.request());
 return {edits,flame,refresh,calls,visible:()=>visible,diagnosticGain:()=>diagnosticGain};
}

test('each preview refreshes visible fields exactly once, forced, before writer diagnostics',()=>{
 const f=fixture(),preview=f.flame.beginPreview();f.calls.length=0;
 preview.update({gain:2});assert.deepEqual(f.calls,[true]);
 assert.equal(f.visible().gain,2);assert.equal(f.diagnosticGain(),2);
 f.calls.length=0;preview.update({gain:3});assert.deepEqual(f.calls,[true]);assert.equal(f.visible().gain,3);
 assert.equal(f.edits.state().undoCount,0);preview.commit();assert.equal(f.edits.state().undoCount,1);
});

test('cancel, commit, undo, redo and failed-preview rollback keep the visible controls current',()=>{
 const f=fixture(),preview=f.flame.beginPreview();preview.update({gain:2});preview.commit();
 assert.equal(f.visible().gain,2);assert.equal(f.edits.state().undoCount,1);
 f.edits.undo();assert.equal(f.visible().gain,1);f.edits.redo();assert.equal(f.visible().gain,2);
 const next=f.flame.beginPreview();next.update({gain:3});
 assert.throws(()=>next.update({gain:99}),/runtime rejected/);assert.equal(f.visible().gain,3);assert.equal(f.flame.read().gain,3);
 next.cancel();assert.equal(f.visible().gain,2);assert.equal(f.edits.state().undoCount,1);
 f.flame.edit(()=>{f.refresh.request();},'ordinary edit');assert.equal(f.visible().gain,2);
});

test('outside preview notifications stay immediate; unforced previews flush before returning',()=>{
 const calls=[],refresh=createFlameInspectorRefresh(force=>calls.push(force));
 refresh.request();refresh.request(true);assert.deepEqual(calls,[undefined,true]);calls.length=0;
 const value=refresh.preview(()=>{refresh.request();refresh.request();return 42;});
 assert.equal(value,42);assert.deepEqual(calls,[false]);
});

test('nested previews preserve forced synchronization points and errors restore ordinary delivery',()=>{
 const calls=[],refresh=createFlameInspectorRefresh(force=>calls.push(force));
 refresh.preview(()=>{refresh.request();refresh.preview(()=>{refresh.request(true);assert.deepEqual(calls,[true]);});refresh.request();});
 assert.deepEqual(calls,[true]);
 assert.throws(()=>refresh.preview(()=>{refresh.request();throw Error('failed');}),/failed/);
 assert.deepEqual(calls,[true,false]);refresh.request(true);assert.deepEqual(calls,[true,false,true]);
 refresh.preview(()=>{refresh.request(true);refresh.request(true);});
 assert.deepEqual(calls,[true,false,true,true,true],'a second forced request may be rollback and must run');
});

// Exercise the current page's writer and authoring installation, so a helper-only
// pass cannot hide a missing batch scope or a direct inspector call in the host.
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
test('page authoring installation composes one forced preview refresh with the actual settings writer',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const writer=html.slice(html.indexOf('function writeFlameSettingsState(state) {'),html.indexOf('function installFlameAuthoring() {'));
 const install=html.slice(html.indexOf('function installFlameAuthoring() {'),html.indexOf('async function loadAuthoredFlameBasin('));
 let live={domControls:{gain:{value:1}},rendererControls:{},presentationControls:{'raymarch-smoke-presentation':{value:'on'}},sourcePose:{position:[0,0,0]},source:null};
 let visible=1;const calls=[];
 const refresh=createFlameInspectorRefresh(force=>{calls.push(force);visible=live.domControls.gain.value;});
 const edits=createSceneEdits({read:()=>null,write:()=>{}});
 const page={window:{},structuredClone,createFlameAuthoring,scenePlacementTools:{edits},flameInspectorRefresh:refresh,
  flameInspector:{sync:force=>{calls.push(force);visible=live.domControls.gain.value;}},
  flameSettingsState:()=>structuredClone(live),checkFlameSettingsState:next=>next,loadAuthoredFlameBasin(){},
  volumePrototype:{debugState:()=>({active:true}),setRaymarchSmokePresentationMode:mode=>({effectiveMode:mode})},
  document:{getElementById:()=>({type:'number'})},supersedeVolumeRebuildHolds(){},DEFAULT_VOLUME_SCENE:'fixture',
  setVolumeControlValue(id,value){if(id==='gain')live.domControls.gain.value=value;},updateVolumeControlLabels(){},
  applyFlameEmitterPose:()=>{},flameEmitterPose:live.sourcePose,syncRaymarchSmokePresentationControls(){},
  activeCanonicalVolumeMacroPreset:'',activeVolumeRayBudgetPreset:'',routedVolumeRayBudgetPreset:'',activeVolumeSettingsPresetReceipt:null,
  readVolumeSettingsValues:()=>live,volumeSettingsPresetControlValuesEqual:(a,b)=>a.domControls.gain.value===b.domControls.gain.value,
  syncBurnerControls(){},refreshVolumeReadout:()=>refresh.request(),recordFlameSettingsProblems:()=>assert.equal(visible,live.domControls.gain.value),
 };
 runInNewContext(writer+'\n'+install+'\ninstallFlameAuthoring();',page);
 edits.subscribe(()=>refresh.request());
 const author=page.window.kaminosFlameAuthoring,preview=author.beginPreview();calls.length=0;
 for(const gain of [2,3]){
  const next=author.read();next.domControls.gain.value=gain;preview.update(next);
  assert.equal(visible,gain);assert.deepEqual(calls,[true]);calls.length=0;
 }
 preview.cancel();assert.equal(visible,1);assert.equal(edits.state().undoCount,0);
 const next=author.read();next.domControls.gain.value=4;author.apply(next);
 assert.equal(visible,4);edits.undo();assert.equal(visible,1);edits.redo();assert.equal(visible,4);
});
