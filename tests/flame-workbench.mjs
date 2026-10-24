// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFlameWorkbench,observeFlameInvestigation,createFlameInvestigation} from '../flame-workbench.mjs';
import {createInvestigationRecording,investigationOperations} from '../investigation-recording.mjs';
import definition from '../experiments/flame.experiment.mjs';
import {openExperiment} from '../workbench-experiments.mjs';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {volumeSettingsPresetControlValuesEqual} from '../volume-settings-preset-contract.mjs';
import * as THREE from '../lib/three.core.js';
import * as framing from '../scene-frame-selected.mjs';

function fixture() {
  let settings={domControls:{'volume-flow-rate':{value:1,rawValue:'1'},'volume-look-freeze':{value:0}},
    rendererControls:{},presentationControls:{},source:{presetId:'saved-basin'}};
  const runtime={active:true,backend:'WebGPU:fixture',frameCount:41,simStepCount:19,controls:{flowRate:1,lookFreeze:0}};
  const listeners=new Set(),events=[],history=[];
  let view={position:[3,2,4],target:[0,1,0]},objects=[{id:'source',type:'flame-emitter'}];
  const notify=()=>{for(const fn of listeners)fn();};
  const options={readSettings:()=>structuredClone(settings),readRuntime:()=>structuredClone(runtime),
    readScene:()=>structuredClone(objects),readView:()=>structuredClone(view),
    applySettings(next){
      const rate=next.domControls['volume-flow-rate'].value;
      if(!Number.isFinite(rate)||rate<0)throw Error('invalid flow');
      history.push(structuredClone(settings));settings=structuredClone(next);
      runtime.controls.flowRate=rate;runtime.controls.lookFreeze=next.domControls['volume-look-freeze'].value;notify();
    },
    applyBasin:async id=>{settings.source={presetId:id};notify();},listBasins:async()=>({entries:[{presetId:'saved-basin',label:'Saved basin'}]}),
    select:id=>events.push(['select',id]),frame:()=>events.push(['frame']),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
  };
  return {options,runtime,history,events,notify,listeners,
    setView:next=>{view=next;notify();},setObjects:next=>{objects=next;notify();},
    draftInput(value){settings.domControls['volume-flow-rate'].value=value;notify();},
    ordinaryInput(value){settings.domControls['volume-flow-rate'].value=value;runtime.controls.flowRate=value;notify();}};
}

test('basin saving is an agent-callable source operation and does not apply settings',async()=>{
  const f=fixture(),calls=[];
  f.options.saveBasin=async input=>{calls.push(input);return {ok:true,effective:{presetId:'saved-copy',label:input.label}};};
  const api=createFlameWorkbench(f.options),before=api.read();
  const instance=await openExperiment(definition,{host:{flame:{open:async()=>api}}});
  const receipt=await instance.invoke('saveBasin',{label:'My flame'});
  assert.equal(receipt.effective.presetId,'saved-copy');
  assert.deepEqual(calls,[{label:'My flame'}]);assert.deepEqual(api.read(),before);
  assert.equal(f.history.length,0);
  f.options.saveBasin=async()=>{throw Error('store unavailable');};
  const failed=await openExperiment(definition,{host:{flame:{open:async()=>createFlameWorkbench(f.options)}}});
  await assert.rejects(failed.invoke('saveBasin',{label:'Try again'}),/store unavailable/);
  await instance.dispose();await failed.dispose();
});

test('the adapter edits the existing transaction without restarting or disposing its flame',async()=>{
  const f=fixture(),api=createFlameWorkbench(f.options);
  const original=api.read();assert.equal(original.clock.simStepCount,19);
  api.setControls({'volume-flow-rate':2.5});assert.equal(f.history.length,1);
  assert.equal(api.read().settings.domControls['volume-flow-rate'].value,2.5);
  assert.equal(api.read().runtime.controls.flowRate,2.5);
  api.setPaused(true);assert.equal(api.read().paused,true);assert.equal(f.runtime.simStepCount,19);
  api.setPaused(false);assert.equal(api.read().paused,false);
  assert.throws(()=>api.setControls({'missing':3}),/Unknown flame control/);
  assert.throws(()=>api.setControls({'volume-flow-rate':-2}),/invalid flow/);
  assert.equal(api.read().settings.domControls['volume-flow-rate'].value,2.5);
  assert.throws(()=>api.setPaused('false'),/Boolean/);
  assert.equal(f.runtime.active,true);assert.equal(f.runtime.simStepCount,19);
  await api.applyBasin('other');assert.equal(api.read().settings.source.presetId,'other');
});

test('inactive flame is explicit, not an implicit replacement fixture',()=>{
  const f=fixture();f.runtime.active=false;const api=createFlameWorkbench(f.options);
  assert.equal(api.read().active,false);
  assert.throws(()=>api.setControls({'volume-flow-rate':2}),/not active/);
  assert.equal(f.history.length,0);
});
test('agent checkbox edits preserve Boolean values through the real applied-settings comparison',()=>{
  const f=fixture(),read=f.options.readSettings,apply=f.options.applySettings;
  f.options.readSettings=()=>{const state=read();state.rendererControls['volume-ray-step-telemetry']??={type:'checkbox',value:true};return state;};
  f.options.applySettings=next=>{
    const applied=structuredClone(next);
    for(const descriptor of Object.values(applied.rendererControls))delete descriptor.rawValue;
    assert.equal(volumeSettingsPresetControlValuesEqual(applied,next),true,'a Boolean patch must compare equal to its actual DOM readback');
    apply(next);
  };
  const api=createFlameWorkbench(f.options);
  api.setControls({'volume-ray-step-telemetry':false});
  assert.equal(api.read().settings.rendererControls['volume-ray-step-telemetry'].value,false);
});

test('source recording includes ordinary edits, navigation and scene changes exactly once',()=>{
  const f=fixture(),api=createFlameWorkbench(f.options);
  const recorder=createInvestigationRecording({id:'flame',source:{revision:'fixture'},initial:api.read(),startingConditions:{kind:'live-runtime'}});
  const stop=observeFlameInvestigation({read:api.read,subscribe:f.options.subscribe,channel:investigationOperations});
  f.ordinaryInput(2);f.notify();api.setControls({'volume-flow-rate':3});
  f.setView({position:[2,3,4],target:[0,1,0]});f.setObjects([{id:'source',type:'flame-emitter',position:[1,0,0]}]);
  const rows=recorder.snapshot().operations;
  assert.deepEqual(rows.map(row=>row.kind),['flame.settings','flame.settings','camera.pose','scene.edit']);
  assert.equal(rows[0].effective.domControls['volume-flow-rate'].value,2);
  assert.equal(rows[1].effective.domControls['volume-flow-rate'].value,3);
  assert.equal(rows[1].clock.simStepCount,19);
  stop();assert.equal(f.listeners.size,0);f.ordinaryInput(4);assert.equal(recorder.finish().operations.length,4);
  assert.equal(f.runtime.active,true);
});

test('a refused edit cannot be recorded as successfully applied',()=>{
  const f=fixture(),api=createFlameWorkbench(f.options);
  const recorder=createInvestigationRecording({id:'refusal',source:{revision:'fixture'},initial:api.read(),startingConditions:{kind:'live-runtime'}});
  const stop=observeFlameInvestigation({read:api.read,subscribe:f.options.subscribe,channel:investigationOperations});
  assert.throws(()=>api.setControls({'volume-flow-rate':-2}),/invalid flow/);
  assert.equal(recorder.snapshot().operations.length,0);stop();recorder.finish();
});

test('source observations retain effective renderer controls alongside authored values',()=>{
  const f=fixture(),api=createFlameWorkbench(f.options);
  const recorder=createInvestigationRecording({id:'effective',source:{revision:'fixture'},initial:api.read(),startingConditions:{kind:'live-runtime'}});
  const stop=observeFlameInvestigation({read:api.read,subscribe:f.options.subscribe,channel:investigationOperations});
  f.ordinaryInput(2);
  f.draftInput(3);
  const row=recorder.snapshot().operations.at(-1);
  stop();recorder.finish();
  assert.equal(row.phase,'observed','an observation must not label a pending DOM preview as applied GPU state');
  assert.equal(row.effectiveRuntimeControls.flowRate,2);
  assert.equal(row.effective.domControls['volume-flow-rate'].value,3);
});

test('deferred controls record confirmation separately from preview and cancellation',()=>{
  const f=fixture(),api=createFlameWorkbench(f.options);
  const rows=[],stop=observeFlameInvestigation({read:api.read,subscribe:f.options.subscribe,channel:{emit:row=>rows.push(structuredClone(row))}});
  f.draftInput(3);
  assert.equal(rows.length,1);assert.equal(rows[0].effectiveRuntimeControls.flowRate,1);
  f.runtime.controls.flowRate=3;f.runtime.simStepCount=0;f.notify();
  assert.equal(rows.length,2,'the same authored value becoming effective is a distinct observation');
  assert.equal(rows[1].kind,'flame.runtime');assert.equal(rows[1].effectiveRuntimeControls.flowRate,3);
  assert.equal(rows[1].clock.simStepCount,0);
  f.draftInput(4);f.draftInput(3);
  assert.equal(rows.filter(row=>row.kind==='flame.runtime').length,1,'cancellation cannot claim another application');
  f.runtime.simStepCount=30;f.runtime.frameCount=70;f.notify();
  assert.equal(rows.length,4,'ordinary clock advances are not interventions');stop();
});

test('the real host retains geometry, collision and confirmed-source notifications',()=>{
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const functionSource=source.slice(source.indexOf('function openFlameWorkbench() {'),source.indexOf('window.kaminosFlameWorkbench='));
  const f=fixture(),document=new EventTarget(),window=new EventTarget(),controls=new EventTarget();
  let objects=[{id:'box',type:'mesh',geometry:{kind:'box',parameters:{width:1}},collision:{enabled:false},transform:{position:[0,0,0]}}],collisionEnabled=false;
  const edits=createSceneEdits({read:()=>null,write:()=>{}});
  edits.register('@box',{read:()=>objects[0],write:next=>{objects=[next];},check:next=>next});
  edits.register('@collision',{read:()=>({enabled:collisionEnabled}),write:next=>{collisionEnabled=next.enabled;},check:next=>next});
  Object.assign(window,{kaminosFlameAuthoring:{read:f.options.readSettings,apply:f.options.applySettings},
    kaminosSelection:{read:()=>({ids:['box']})},kaminosFlameDomain:{read:()=>({position:[0,0,0]})},
    kaminosSceneCollision:{read:()=>({enabled:collisionEnabled,runtime:{movingDiagnostic:1}})}});
  const api=runInNewContext(functionSource+'\nopenFlameWorkbench()',{
    window,document,controls,createFlameWorkbench,scenePlacementTools:{edits},
    volumePrototype:{debugState:f.options.readRuntime},readAuthoredCameraView:f.options.readView,
    readAuthoredFireObjects:()=>structuredClone(objects),serializeSceneGroups:()=>[],activeSceneFieldId:'flame-field',activeSceneComposition:{},
  });
  const initial=api.read(),rows=[];
  const stop=observeFlameInvestigation({read:api.read,subscribe:api.subscribe,channel:{emit:row=>rows.push(structuredClone(row))}});
  edits.apply('@box',{...objects[0],geometry:{kind:'box',parameters:{width:2}}},'Resize box');
  edits.apply('@box',{...objects[0],collision:{enabled:true}},'Set obstacle');
  edits.apply('@collision',{enabled:true},'Scene collisions');
  assert.equal(initial.scene.objects[0].geometry.parameters.width,1);
  assert.equal(initial.scene.objects[0].collision.enabled,false);assert.equal(initial.scene.collisionEnabled,false);
  assert.equal(rows.length,3);assert.equal(rows[0].effective.objects[0].geometry.parameters.width,2);
  assert.equal(rows[1].effective.objects[0].collision.enabled,true);assert.equal(rows[2].effective.collisionEnabled,true);
  f.runtime.controls.flowRate=2;window.dispatchEvent(new Event('kaminos-flame-controls-changed'));
  assert.equal(rows.length,4);assert.equal(rows[3].effectiveRuntimeControls.flowRate,2);
  stop();f.runtime.controls.flowRate=3;window.dispatchEvent(new Event('kaminos-flame-controls-changed'));
  assert.equal(rows.length,4,'disposal removes source notifications');
});

test('explicit domain framing uses its actual bounds without admitting editor helpers as content',()=>{
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const functionSource=source.slice(source.indexOf('function frameAuthoredSelection() {'),source.indexOf('function groupEditState('));
  const imported=source.match(/import \{ ([^}]+) \} from '\.\/scene-frame-selected\.mjs';/)[1].split(', ').map(name=>name.trim());
  const bindings=Object.fromEntries(imported.map(name=>[name,framing[name]]));
  const box=new THREE.Box3(new THREE.Vector3(1,-1,-2),new THREE.Vector3(3,3,0));
  const guide=new THREE.Box3Helper(box);guide.userData.kaminosEditorHelper=true;
  const camera=new THREE.PerspectiveCamera(40,1.3,.01,100);camera.position.set(0,.6,3);
  const controls={target:new THREE.Vector3(),update(){camera.lookAt(this.target);camera.updateMatrixWorld();}};
  controls.update();const before=camera.position.toArray();
  assert.equal(framing.frameObjects([guide],camera,controls),false,'ordinary content framing must still exclude helpers');
  assert.deepEqual(camera.position.toArray(),before);
  guide.visible=false;
  assert.equal(runInNewContext(functionSource+'\nframeAuthoredSelection()',{
    sceneSelection:{ids:['flame-field'],activeId:'flame-field'},activeSceneFieldId:'flame-field',flameDomainGuide:guide,camera,controls,...bindings,
  }),true,'explicit domain framing must not be filtered as helper content');
  assert.notDeepEqual(camera.position.toArray(),before);
  assert.deepEqual(controls.target.toArray(),box.getCenter(new THREE.Vector3()).toArray());
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const projected=new THREE.Vector3(x,y,z).project(camera);
    assert.ok(Math.abs(projected.x)<=1&&Math.abs(projected.y)<=1&&Math.abs(projected.z)<=1,'every domain corner fits in the camera');
  }
});

test('discovered Flame contribution borrows the authored runtime across close and reopen',async()=>{
  const f=fixture(),api=createFlameWorkbench(f.options);
  const host={flame:{open:async()=>api}};
  const instance=await openExperiment(definition,{host});
  await instance.invoke('setControls',{'volume-flow-rate':2});
  await instance.invoke('setPaused',true);
  assert.equal((await instance.read()).clock.simStepCount,19);
  await instance.dispose();assert.equal(f.runtime.active,true);assert.equal(f.listeners.size,0);
  const reopened=await openExperiment(definition,{host});
  assert.equal((await reopened.read()).settings.domControls['volume-flow-rate'].value,2);
  assert.equal((await reopened.read()).paused,true);assert.equal(f.history.length,2);
  await reopened.dispose();assert.equal(f.runtime.simStepCount,19);
});

test('missing host is explicit and setup cannot silently replace an authored flame',async()=>{
  await assert.rejects(openExperiment(definition,{host:{}}),/Flame.*host/i);
  const f=fixture(),api=createFlameWorkbench(f.options);
  await assert.rejects(openExperiment(definition,{host:{flame:{open:async()=>api}},inputs:{presetId:'other'}}),/existing|explicit|inputs/i);
  assert.equal(api.read().settings.source.presetId,'saved-basin');assert.equal(f.history.length,0);
});

test('shared recording handback retains real controls and stops observers without stopping the flame',()=>{
  const f=fixture(),flame=createFlameWorkbench(f.options);
  const ui={node:{isConnected:true},freeze(){},disconnect(){},saveFailed(){}};
  const mounted=createFlameInvestigation({flame,id:'mounted',source:{revision:'fixture'},document:{},
    request:()=>{},mount(){},guideFactory:()=>ui});
  f.ordinaryInput(2);
  assert.equal(mounted.read().recording.operations.length,1);
  const result=mounted.finish();assert.equal(result.recording.status,'finished');
  assert.equal(result.context.clock.simStepCount,19);assert.equal(f.listeners.size,0);
  assert.equal(f.runtime.active,true);assert.deepEqual(mounted.finish(),result);
  mounted.disconnect('Retained');assert.equal(f.runtime.active,true);
});

test('missing runtime and failed mounting cannot leak a recording or claim successful installation',()=>{
  const f=fixture(),flame=createFlameWorkbench(f.options);f.runtime.active=false;
  assert.throws(()=>createFlameInvestigation({flame,id:'missing',source:{revision:'fixture'}}),/not active/);
  f.runtime.active=true;
  assert.throws(()=>createFlameInvestigation({flame,id:'broken',source:{revision:'fixture'},
    document:{},request:()=>{},mount(){throw Error('mount rejected');},guideFactory:()=>({node:{},disconnect(){}})}),/mount rejected/);
  assert.equal(f.listeners.size,0);assert.equal(investigationOperations.active,false);
});

test('ordinary Enable/Disable publishes its settled state to flame subscribers immediately',async()=>{
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=source.indexOf("  document.getElementById('volume-toggle').addEventListener('click', async () => {");
  const end=source.indexOf("  document.getElementById('volume-fit-camera')",start);
  assert.ok(start>=0&&end>start,'the actual toggle handler is available');
  let click,active=true;
  const observed=[],window=new EventTarget();
  window.addEventListener('kaminos-flame-controls-changed',()=>observed.push(active));
  runInNewContext(source.slice(start,end),{document:{getElementById:()=>({addEventListener:(name,fn)=>click=fn})},
    window,Event,volumePrototype:{debugState:()=>({active}),setActive:async value=>{await Promise.resolve();active=value;}},setInfo(){},refreshVolumeReadout(){}});
  await click();assert.deepEqual(observed,[false],'off interrupts without waiting for the fallback poll');
  await click();assert.deepEqual(observed,[false,true],'on publishes only after activation has completed');
});

test('first-flame endpoint initialization uses captured settings and honors cancellation before construction',async()=>{
 const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function addFirstFlameField('),source.indexOf('async function openFirstFlameFieldDialog('));
 const endpoint={source:{presetId:'original'},domControls:{'volume-emitter-source-law':{value:'immersed-source'},'volume-pressure-solver':{value:'converged-open-top'},'volume-advection-scheme':{value:'maccormack'},'volume-time-step':{value:'uniform'},'volume-physical-thermal':{value:7},'volume-wind-angle':{value:7}}};
 let received,loads=0,duplicates=0,release;
 const scope={structuredClone,JSON,COMPOSITION_SCHEMA:'fixture',FLAME_EMITTER_ID:'source',activeSceneComposition:null,authoringBusy:false,
  assertSceneConstructionAvailable(){},volumePrototype:{},firstFlameFieldState:()=>({unchanged:true}),checkFlameSettingsState:value=>value,
  loadAuthoredFlameBasin:async()=>{loads++;return {...endpoint,domControls:{...endpoint.domControls,'volume-wind-angle':{value:2}}};},
  resolveFlameLightingRoute:x=>Object.entries(x),setActiveSceneObject(){},setInfo(){},globalThis:{},
  addBurnerObject:()=>{duplicates++;},scenePlacementTools:{edits:{state:()=>({}),applySettled:async(id,value)=>{received=value;scope.activeSceneComposition=value.composition;}}}};
 const add=runInNewContext(body+'\naddFirstFlameField',scope);
 await add('original',{settings:endpoint});assert.equal(received.settings.domControls['volume-wind-angle'].value,7);assert.equal(loads,0);
 await assert.rejects(add('original',{settings:endpoint}),/existing/);assert.equal(duplicates,0);
 scope.activeSceneComposition=null;scope.volumePrototype=null;received=null;
 scope.initKaminosVolumeRoute=()=>new Promise(resolve=>{release=()=>{scope.volumePrototype={};resolve();};});
 const request=new AbortController(),pending=add('original',{settings:endpoint,signal:request.signal});request.abort();release();
 await assert.rejects(pending);assert.equal(received,null);
});
