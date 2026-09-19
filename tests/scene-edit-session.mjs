import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
// A new capability: report its absence as a contract failure, before importing.
assert.ok(existsSync(new URL('../scene-edit-session.mjs', import.meta.url)), 'scene placement needs a reversible preview/commit/cancel operation');
const { createSceneEdits, transformPose } = await import('../scene-edit-session.mjs');
const start = {position:[.399,.215,-.128],rotation:[0,.4,0],scale:[6.704,5.677,6.878]};
const clone = x => structuredClone(x);
function fixture() { let pose=clone(start); return {get pose(){return pose}, edits:createSceneEdits({read:id=>id==='kiln'?clone(pose):null,write:(id,p)=>{pose=clone(p)}})}; }
test('preview does not create history; cancel restores all fields, and commit/undo/redo are one gesture',()=>{
 const f=fixture(),e=f.edits;e.begin('kiln');e.preview({position:[1,2,3]});e.preview({rotation:[.2,.3,.4]});
 assert.equal(e.state().undoCount,0);e.cancel();assert.deepEqual(f.pose,start);
 e.begin('kiln');e.preview({position:[1,2,3]});e.preview({rotation:[.2,.3,.4]});e.commit();const end=clone(f.pose);
 assert.equal(e.state().undoCount,1);e.undo();assert.deepEqual(f.pose,start);e.redo();assert.deepEqual(f.pose,end);
 e.undo();e.apply('kiln',{position:[9,2,1]});assert.equal(e.state().redoCount,0);
});
test('invalid preview and competing writes preserve the active gesture; no-op is not history',()=>{
 const f=fixture(),e=f.edits;e.begin('kiln');assert.throws(()=>e.preview({position:[NaN,0,0]}),/finite/);assert.deepEqual(f.pose,start);
 assert.throws(()=>e.apply('kiln',{position:[2,0,0]}),/active/);e.commit();assert.equal(e.state().undoCount,0);
 assert.throws(()=>e.begin('absent'),/found/);
});
test('move then rotate keeps moved origin and nonuniform scale; local axis follows retained frame',()=>{
 const moved=transformPose(start,{operation:'translate',axis:'x',frame:'local',frameRotation:start.rotation,amount:2});
 assert.ok(Math.abs(moved.position[0]-start.position[0]-2*Math.cos(.4))<1e-10);
 const rotated=transformPose(moved,{operation:'rotate',axis:'x',frame:'local',frameRotation:start.rotation,amount:Math.PI/2});
 assert.deepEqual(rotated.position,moved.position);assert.deepEqual(rotated.scale,start.scale);
 assert.ok(rotated.rotation.some((v,i)=>Math.abs(v-start.rotation[i])>.1));
});
test('snapping is relative to gesture start and scale supports exact numeric factors',()=>{
 const moved=transformPose(start,{operation:'translate',axis:'x',amount:.26,snap:.1});assert.ok(Math.abs(moved.position[0]-.699)<1e-12);
 assert.deepEqual(transformPose(start,{operation:'scale',axis:null,amount:2}).scale,start.scale.map(x=>2*x));
});
test('shared admission rejects every authored mutation while allowing rollback',()=>{
 let pose=clone(start),blocked=false;
 const e=createSceneEdits({read:()=>clone(pose),write:(_,p)=>pose=clone(p),admit:()=>{if(blocked)throw Error('busy or correction');}});
 e.apply('kiln',{position:[1,2,3]});const accepted=clone(pose);blocked=true;
 for(const action of [()=>e.begin('kiln'),()=>e.apply('kiln',{position:[9,9,9]}),()=>e.undo()])assert.throws(action,/busy or correction/);
 assert.deepEqual(pose,accepted);blocked=false;e.begin('kiln');e.preview({position:[4,5,6]});blocked=true;
 assert.throws(()=>e.preview({position:[7,8,9]}),/busy or correction/);e.cancel();assert.deepEqual(pose,accepted);
 blocked=false;e.undo();blocked=true;assert.throws(()=>e.redo(),/busy or correction/);assert.deepEqual(pose,start);
});
