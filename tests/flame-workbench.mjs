// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFlameWorkbench,observeFlameInvestigation,createFlameInvestigation} from '../flame-workbench.mjs';
import {createInvestigationRecording,investigationOperations} from '../investigation-recording.mjs';
import definition from '../experiments/flame.experiment.mjs';
import {openExperiment} from '../workbench-experiments.mjs';

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
