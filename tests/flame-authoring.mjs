import test from 'node:test';import assert from 'node:assert/strict';
import { createSceneEdits } from '../scene-edit-session.mjs';
import { createFlameAuthoring } from '../flame-authoring.mjs';
function fixture({load,writeFailure}={}) {
 let state={domControls:{flow:{value:1},unexposed:{value:.123456789012345}},source:{presetId:'a',label:'A'}};
 let pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
 const edits=createSceneEdits({read:()=>pose,write:(_,next)=>pose=next});
 const flame=createFlameAuthoring({edits,read:()=>structuredClone(state),
  write:next=>{state=structuredClone(next);if(writeFailure?.(next))throw Error('runtime rejected');},
  check:next=>{if(!Number.isFinite(next.domControls.flow.value))throw Error('invalid flow');return next;},load});
 return{edits,flame,read:()=>state};
}
test('basin is one shared history entry and preserves unexposed values through undo/redo',()=>{
 const {edits,flame}=fixture();const original=flame.read();
 edits.apply('kiln',{position:[1,0,0]},'Move kiln');
 const next=structuredClone(original);next.domControls.flow.value=2;next.source={presetId:'b',label:'B'};
 flame.apply(next);assert.equal(edits.state().undoCount,2);assert.deepEqual(flame.read(),next);
 edits.undo();assert.deepEqual(flame.read(),original);edits.redo();assert.deepEqual(flame.read(),next);
});
test('validation rejects before touching runtime/history',()=>{
 const {edits,flame}=fixture();const before=flame.read();const bad=flame.read();bad.domControls.flow.value=NaN;
 assert.throws(()=>flame.apply(bad),/invalid flow/);assert.deepEqual(flame.read(),before);assert.equal(edits.state().undoCount,0);
});
test('partial runtime failure restores whole previous settings and adds no entry',()=>{
 const {edits,flame}=fixture({writeFailure:next=>next.domControls.flow.value===2});const before=flame.read();const next=flame.read();next.domControls.flow.value=2;
 assert.throws(()=>flame.apply(next),/runtime rejected/);assert.deepEqual(flame.read(),before);assert.equal(edits.state().active,null);assert.equal(edits.state().undoCount,0);
});
test('pending edit is not silently committed by basin application',()=>{
 const {edits,flame}=fixture();edits.begin('kiln');assert.throws(()=>flame.apply(flame.read()),/Finish/);assert.equal(edits.state().active.id,'kiln');
});
test('edits during fetch invalidate pending basin instead of overwriting newer intent',async()=>{
 let resolve;const {edits,flame}=fixture({load:()=>new Promise(r=>resolve=r)});
 const pending=flame.applyBasin('b');const next=flame.read();next.domControls.flow.value=3;flame.apply(next);
 resolve(next);await assert.rejects(pending,/scene changed/);assert.equal(flame.read().domControls.flow.value,3);assert.equal(edits.state().undoCount,1);
});
test('concurrent basin loads cannot race and failure releases load state',async()=>{
 let reject;const {flame}=fixture({load:()=>new Promise((_,r)=>reject=r)});const first=flame.applyBasin('a');
 await assert.rejects(flame.applyBasin('b'),/already loading/);reject(Error('network'));await assert.rejects(first,/network/);
 const retry=flame.applyBasin('c');reject(Error('again'));await assert.rejects(retry,/again/);
});
test('explicit preset recovery reaches the loader and remains one undoable edit',async()=>{
 let received;const {flame,edits}=fixture({load:async(id,options)=>{received={id,options};const next=flame.read();next.domControls.flow.value=2;next.source.sourceSizeRecovery='current-emitter-size';return next;}});
 const before=flame.read();await flame.applyBasin('legacy',{sourceSize:'current'});
 assert.deepEqual(received,{id:'legacy',options:{sourceSize:'current'}});
 assert.equal(edits.state().undoCount,1);edits.undo();assert.deepEqual(flame.read(),before);
 edits.redo();assert.equal(flame.read().source.sourceSizeRecovery,'current-emitter-size');
});

test('selected-flame shape choices exclude the non-placeable cluster mode',async()=>{
 const {authoredFlameShapeOptions}=await import('../flame-authoring.mjs');
 const options=[{value:'cluster'},{value:'wick'},{value:'nozzle'},{value:'ribbon'},{value:'ring'}];
 assert.equal(typeof authoredFlameShapeOptions,'function','selected-flame shape admission is explicit');
 assert.deepEqual(authoredFlameShapeOptions(options).map(o=>o.value),['wick','nozzle','ribbon','ring']);
});

test('scripted single-control gesture records all coupled setting changes',()=>{
 const {edits,flame,read}=fixture();const before=flame.read();
 assert.equal(typeof flame.edit,'function','script control edits use the whole-settings gesture');
 flame.edit(()=>{read().domControls.flow.value=2;read().domControls.unexposed.value=.5;});
 assert.equal(edits.state().undoCount,1);edits.undo();assert.deepEqual(flame.read(),before);
});

test('live preview is one cancellable history gesture and cannot take over a later edit',()=>{
 const {edits,flame}=fixture();const before=flame.read();
 assert.equal(typeof flame.beginPreview,'function','flame authoring must support a live multi-frame gesture');
 const preview=flame.beginPreview('Blend flame');
 for(const value of [2,3,4]){const next=flame.read();next.domControls.flow.value=value;preview.update(next);}
 assert.equal(edits.state().undoCount,0);preview.commit();assert.equal(edits.state().undoCount,1);
 edits.undo();assert.deepEqual(flame.read(),before);edits.redo();assert.equal(flame.read().domControls.flow.value,4);
 const abandoned=flame.beginPreview('Blend flame');edits.cancel();edits.begin('kiln');
 assert.equal(abandoned.active(),false);abandoned.cancel();assert.equal(edits.state().active.id,'kiln');
 assert.throws(()=>abandoned.update(before),/ended/);edits.cancel();
 const cancelled=flame.beginPreview();const next=flame.read();next.domControls.flow.value=8;cancelled.update(next);cancelled.cancel();
 assert.equal(flame.read().domControls.flow.value,4);assert.equal(edits.state().undoCount,1);
});

test('failed preview restores the previous frame and cancellation restores gesture start',()=>{
 const {edits,flame}=fixture({writeFailure:next=>next.domControls.flow.value===2});
 assert.equal(typeof flame.beginPreview,'function','preview must preserve transactional rollback');
 const preview=flame.beginPreview();const next=flame.read();next.domControls.flow.value=3;preview.update(next);
 next.domControls.flow.value=2;assert.throws(()=>preview.update(next),/runtime rejected/);
 assert.equal(flame.read().domControls.flow.value,3);preview.cancel();assert.equal(flame.read().domControls.flow.value,1);assert.equal(edits.state().undoCount,0);
});
