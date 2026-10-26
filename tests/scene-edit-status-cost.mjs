// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createSceneEdits} from '../scene-edit-session.mjs';

const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
test('status readers and preview notifications do not copy retained scene context',()=>{
 const originalClone=globalThis.structuredClone;
 let contextCopies=0,notifications=0,current=originalClone(pose);
 const context={sceneMarker:'retained-scene',pixels:new Uint8Array(4096)};
 const edits=createSceneEdits({read:()=>current,write:(_,v)=>{current=v;},captureContext:()=>context,
  changed:s=>{assert.equal(s.active?.id,'flame');notifications++;}});
 edits.subscribe(s=>assert.equal(s.active?.label,'Flame response'));
 edits.begin('flame','Flame response');
 globalThis.structuredClone=value=>{
  if(value?.sceneMarker==='retained-scene'||value?.beforeContext?.sceneMarker==='retained-scene')contextCopies++;
  return originalClone(value);
 };
 try{
  const held=edits.state();assert.equal(held.active.id,'flame');
  edits.preview({position:[1,0,0]});
  assert.equal(notifications,2);
  assert.equal(contextCopies,0,'inspecting transaction identity must not clone its retained scene snapshot');
  assert.deepEqual(held.active.beforeContext,context);
  held.active.beforeContext.pixels[0]=99;
  assert.equal(edits.state().active.beforeContext.pixels[0],0,'returned context remains isolated');
 }finally{globalThis.structuredClone=originalClone;}
});
test('a retained status still serializes its original transaction after commit and another begin',()=>{
 let current=structuredClone(pose),context={sceneMarker:'first'};
 const edits=createSceneEdits({read:()=>current,write:(_,v)=>{current=v;},captureContext:()=>context});
 edits.begin('flame','First');const held=edits.state();
 edits.preview({position:[1,0,0]});edits.commit();context={sceneMarker:'second'};edits.begin('flame','Second');
 const serialized=structuredClone(held);
 assert.equal(serialized.active.label,'First');assert.deepEqual(serialized.active.before,pose);
 assert.deepEqual(serialized.active.beforeContext,{sceneMarker:'first'});
 assert.equal(serialized.undoCount,0);assert.equal(edits.state().undoCount,1);
 serialized.active.before.position[0]=99;
 assert.equal(held.active.before.position[0],0);
});
