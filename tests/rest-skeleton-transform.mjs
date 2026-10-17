// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4} from '../lib/three.core.js';
import {captureRestTransform,applyRestTransform} from '../experiments/creature-motion/rest-skeleton-transform.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
const joint=(name,parent,head)=>({name,parent,head,tail:head.map((n,i)=>n+(i===1?1:0)),matrix:[[1,0,0,head[0]],[0,1,0,head[1]],[0,0,1,head[2]],[0,0,0,1]]});
const fixture=()=>({schema:'kaminos.complete-creature-joints.v0',joints:[joint('pelvis',null,[0,0,0]),joint('forelimb-left-shoulder','pelvis',[-2,2,0]),joint('forelimb-right-shoulder','pelvis',[2,2,0]),joint('forelimb-left-elbow','forelimb-left-shoulder',[-2,1,0]),joint('forelimb-right-elbow','forelimb-right-shoulder',[2,1,0])]});
const options={selected:['forelimb-left-shoulder'],active:'forelimb-left-shoulder',mirror:true,descendants:true,localToWorld:new Matrix4().toArray()};
test('viewport transform applies a mirrored branch in one snapshot, never accumulating previews',()=>{
 const p=fixture(),s=captureRestTransform(p,options),moved={...s,position:s.position.map((v,k)=>v+(k===0?1:0))};
 const a=applyRestTransform(p,moved),b=applyRestTransform(a,moved);
 assert.deepEqual(a.joints.map(j=>j.head),[[0,0,0],[-1,2,0],[1,2,0],[-1,1,0],[1,1,0]]);assert.deepEqual(b,a);assert.deepEqual(p,fixture());
});
test('symmetry stays in skeleton coordinates after the whole object is rotated and scaled',()=>{
 const p=fixture(),frame=new Matrix4().makeRotationZ(Math.PI/2).multiply(new Matrix4().makeScale(2,2,2));
 const s=captureRestTransform(p,{...options,localToWorld:frame.toArray()});
 const out=applyRestTransform(p,{...s,position:s.position.map((v,k)=>v+(k===1?2:0))});
 assert.ok(Math.abs(out.joints[1].head[0]+1)<1e-9);assert.ok(Math.abs(out.joints[2].head[0]-1)<1e-9);
});
test('pair scaling affects each joint once, descendants remain branches, and collapse rejects atomically',()=>{
 const p=fixture(),s=captureRestTransform(p,{...options,selected:['forelimb-left-shoulder','forelimb-right-shoulder']});
 const out=applyRestTransform(p,{...s,scale:[.5,1,1]});assert.deepEqual(out.joints.map(j=>j.head),[[0,0,0],[-1,2,0],[1,2,0],[-1,1,0],[1,1,0]]);
 assert.throws(()=>applyRestTransform(p,{...s,scale:[0,1,1]}),/collapse/);assert.deepEqual(p,fixture());
 const rotated=applyRestTransform(p,{...s,rotation:[0,0,Math.PI/4]});assert.ok(Math.abs(rotated.joints[1].head[1]-(2-Math.SQRT2))<1e-9);assert.ok(Math.abs(rotated.joints[2].head[1]-(2-Math.SQRT2))<1e-9);
});
test('shared cancel, undo and redo restore all mirrored heads, independent of later selection',()=>{
 const p=fixture();let current=p,selection=options.selected;
 const edits=createSceneEdits({read:()=>null,write:()=>{}});
 edits.register('@bones',{read:()=>captureRestTransform(current,{...options,selected:selection,active:selection[0]}),check:v=>structuredClone(v),write:v=>{current=applyRestTransform(p,v);}});
 edits.begin('@bones');const before=edits.state().active.before;edits.preview({...before,position:before.position.map((v,k)=>v+(k===0?1:0))});assert.notDeepEqual(current,p);edits.cancel();assert.deepEqual(current,p);assert.equal(edits.state().undoCount,0);
 edits.apply('@bones',{...before,position:before.position.map((v,k)=>v+(k===0?1:0))});const accepted=current;selection=['pelvis'];edits.undo();assert.deepEqual(current,p);edits.redo();assert.deepEqual(current,accepted);
});
