import assert from 'node:assert/strict';
import test from 'node:test';
import {createCueTuneEditor} from '../kiln-cue-editor.mjs';
import {defaultKilnCues,normalizeKilnCues} from '../kiln-cinematic-cues.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {normalizeCueTune} from '../kiln-cue-tunes.mjs';

function fixture() {
  let cues=defaultKilnCues();
  let current={domControls:{'volume-input-radius':{value:.4},'volume-flow-rate':{value:2},
    'volume-physical-exposure':{value:-2},'hidden':{value:.123456789},'volume-resolution':{value:64}},
    rendererControls:{},presentationControls:{},source:{presetId:'original'}};
  const baseline=structuredClone(current);
  const edits=createSceneEdits({read:()=>null,write(){}});
  edits.register('@kiln-cues',{read:()=>cues,write:value=>{cues=value;},check:normalizeKilnCues});
  let finishLoad;
  const editor=createCueTuneEditor({readCues:()=>cues,writeCues:value=>edits.apply('@kiln-cues',value,'Tune key'),
    readTune:()=>structuredClone(current),applyTune:value=>{current=structuredClone(value);},validateTune:normalizeCueTune,
    loadTune:()=>new Promise(resolve=>{finishLoad=resolve;})});
  return {editor,edits,baseline,cues:()=>structuredClone(cues),current:()=>structuredClone(current),finish:value=>finishLoad(value)};
}

test('live draft changes the flame; cancel restores whole baseline and leaves cues/history unchanged',()=>{
  const f=fixture(),before=f.cues();f.editor.begin('work',1);f.editor.set('volume-physical-exposure',-3);
  assert.equal(f.current().domControls['volume-physical-exposure'].value,-3);
  assert.equal(f.current().domControls.hidden.value,.123456789);
  f.editor.cancel();assert.deepEqual(f.current(),f.baseline);assert.deepEqual(f.cues(),before);assert.equal(f.edits.state().undoCount,0);
});

test('cue cancellation and acceptance restore native control bounds and step',()=>{
  const field={type:'range',min:'0',max:'2.5',step:'0.01'};
  const original={...field};
  let current={domControls:{'volume-input-radius':{value:.4},'volume-flow-rate':{value:2}},rendererControls:{},presentationControls:{}};
  const editor=createCueTuneEditor({readCues:defaultKilnCues,writeCues(){},readTune:()=>current,
    validateTune:normalizeCueTune,loadTune:async()=>current,
    applyTune:tune=>{field.max='4';field.step='any';current=tune;},
    capturePresentation:()=>({...field}),restorePresentation:state=>Object.assign(field,state)});
  editor.begin('work',1);assert.equal(field.max,'4');editor.cancel();assert.deepEqual(field,original);
  editor.begin('work',1);editor.set('volume-flow-rate',3);editor.accept();assert.deepEqual(field,original);
});

test('accept replaces one complete key tune and shared undo/redo preserve baseline',async()=>{
  const f=fixture(),before=f.cues();f.editor.begin('work',1);f.editor.set('volume-physical-exposure',-3);f.editor.accept();
  const accepted=f.cues();assert.equal(accepted.work[1].tune.domControls['volume-physical-exposure'].value,-3);
  assert.equal(accepted.work[1].tune.domControls.hidden.value,.123456789);assert.deepEqual(accepted.work[1].tune.source,{presetId:'original'});
  assert.deepEqual(f.current(),f.baseline);assert.equal(f.edits.state().undoCount,1);
  await f.edits.undo();assert.deepEqual(f.cues(),before);await f.edits.redo();assert.deepEqual(f.cues(),accepted);
});

test('cancel or intervening retune invalidates a pending basin without overwriting accepted intent',async()=>{
  const f=fixture();f.editor.begin('work',1);const load=f.editor.useBasin('other');f.editor.cancel();f.finish(f.baseline);
  await assert.rejects(load,/Keyframe changed/);assert.deepEqual(f.current(),f.baseline);
  f.editor.begin('work',1);const next=f.editor.useBasin('other');f.editor.set('volume-physical-exposure',-4);f.finish(f.baseline);
  await assert.rejects(next,/Keyframe changed/);assert.equal(f.current().domControls['volume-physical-exposure'].value,-4);
});

test('scene simulation changes are refused before mutating the live draft',()=>{
  const f=fixture();f.editor.begin('work',1);const before=f.current();
  assert.throws(()=>f.editor.set('volume-resolution',160),/belongs to the scene/);assert.deepEqual(f.current(),before);
});

test('failed key acceptance keeps the draft available rather than losing the retune',()=>{
  const f=fixture();f.editor.begin('work',1);f.editor.set('volume-flow-rate',5);
  assert.throws(()=>f.editor.accept(),/Invalid kiln cue flow/);assert.equal(f.editor.active(),true);assert.equal(f.current().domControls['volume-flow-rate'].value,5);
  f.editor.cancel();assert.deepEqual(f.current(),f.baseline);
});
