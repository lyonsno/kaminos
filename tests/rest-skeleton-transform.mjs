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
test('Mirror L/R locks axial translation in the source frame, including its branch',()=>{
 const p=fixture();for(const j of p.joints){j.head[0]+=.3;j.tail[0]+=.3;j.matrix[0][3]+=.3;}
 const s=captureRestTransform(p,{...options,selected:['pelvis'],active:'pelvis'});
 const out=applyRestTransform(p,{...s,position:[s.position[0]+1,s.position[1]+.4,s.position[2]]});
 for(let i=0;i<p.joints.length;i++){assert.equal(out.joints[i].head[0],p.joints[i].head[0]);assert.ok(Math.abs(out.joints[i].head[1]-p.joints[i].head[1]-.4)<1e-10);}
 const lateral=applyRestTransform(p,{...s,position:[s.position[0]+1,s.position[1],s.position[2]]});assert.deepEqual(lateral,p);
 const free=applyRestTransform(p,{...s,mirror:false,position:[s.position[0]+1,s.position[1],s.position[2]]});assert.equal(free.joints[0].head[0],1.3);
});
test('axial lock follows a rotated object, not a world axis, and mixed selection can still widen limbs',()=>{
 const p=fixture(),frame=new Matrix4().makeRotationZ(Math.PI/2).multiply(new Matrix4().makeScale(2,3,4));
 const s=captureRestTransform(p,{...options,selected:['pelvis'],active:'pelvis',localToWorld:frame.toArray()});
 const out=applyRestTransform(p,{...s,position:[s.position[0]+3,s.position[1]+2,s.position[2]]});
 for(let i=0;i<p.joints.length;i++){assert.ok(Math.abs(out.joints[i].head[0]-p.joints[i].head[0])<1e-10);assert.ok(Math.abs(out.joints[i].head[1]-p.joints[i].head[1]+1)<1e-10);}
 const mixed=captureRestTransform(p,{...options,selected:['pelvis','forelimb-left-shoulder'],active:'forelimb-left-shoulder'}),wide=applyRestTransform(p,{...mixed,position:[mixed.position[0]+.5,mixed.position[1],mixed.position[2]]});
 assert.equal(wide.joints[0].head[0],0);assert.equal(wide.joints[1].head[0],-1.5);assert.equal(wide.joints[2].head[0],1.5);assert.equal(wide.joints[3].head[0],-1.5);
});
test('axial points stay on their prior transverse coordinates through rotation and scaling',()=>{
 const p=fixture();p.joints.push(joint('neck','pelvis',[0,3,0]));
 const s=captureRestTransform(p,{...options,selected:['pelvis','neck'],active:'neck',descendants:false});
 const out=applyRestTransform(p,{...s,rotation:[0,0,.3],scale:[1,1.2,1]});
 assert.equal(out.joints[0].head[0],0);assert.equal(out.joints.at(-1).head[0],0);assert.notDeepEqual(out,p);
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
