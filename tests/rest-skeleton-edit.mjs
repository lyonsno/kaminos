// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {moveRestJoint} from '../experiments/creature-motion/rest-skeleton-edit.mjs';
import {loadRestEditorInput} from '../experiments/creature-motion/rest-skeleton.experiment.mjs';
import {authoredRestPlan} from '../experiments/creature-motion/rest-skeleton-edit.mjs';
import {createHash} from 'node:crypto';
const joint=(name,parent,head)=>({name,parent,head,tail:head.map((v,i)=>v+(i===1?1:0)),matrix:[[1,0,0,head[0]],[0,1,0,head[1]],[0,0,1,head[2]],[0,0,0,1]],label:name,retained:true});
export const fixture=()=>({schema:'kaminos.complete-creature-joints.v0',source:{'/original.glb':'a'.repeat(64)},joints:[joint('pelvis',null,[0,0,0]),joint('forelimb-left-shoulder','pelvis',[-2,2,0]),joint('forelimb-right-shoulder','pelvis',[2,2,0]),joint('forelimb-left-elbow','forelimb-left-shoulder',[-2,1,0]),joint('forelimb-right-elbow','forelimb-right-shoulder',[2,1,0])]});
test('moving an origin changes the model joint head, matrix translation and control tail, never the source',()=>{
 const p=fixture(),before=structuredClone(p),q=moveRestJoint(p,{name:'forelimb-left-shoulder',position:[-1,3,.5]});
 assert.deepEqual(q.joints[1].head,[-1,3,.5]);assert.deepEqual(q.joints[1].tail,[-1,4,.5]);assert.equal(q.joints[1].matrix[0][3],-1);assert.deepEqual(p,before);assert.deepEqual(q.source,p.source);assert.deepEqual(q.joints[3],p.joints[3]);
});
test('mirrored branch edit moves both descendants with reflected delta, preserving bone vectors',()=>{
 const p=fixture(),q=moveRestJoint(p,{name:'forelimb-left-shoulder',position:[-1,3,.5],mirror:true,descendants:true});
 assert.deepEqual(q.joints.map(j=>j.head),[[0,0,0],[-1,3,.5],[1,3,.5],[-1,2,.5],[1,2,.5]]);
});
test('invalid position, unknown joint and collapsed edges reject without mutation',()=>{
 const p=fixture(),before=structuredClone(p);for(const request of[{name:'absent',position:[0,1,0]},{name:'pelvis',position:[0,NaN,0]},{name:'forelimb-left-shoulder',position:[-2,1,0]}])assert.throws(()=>moveRestJoint(p,request));assert.deepEqual(p,before);
});
const display=[.1,0,0,0,0,0,-.1,0,0,.1,0,0,0,0,0,1];
test('saved authored plan reopens exactly, including source frame, reference and camera',async()=>{
 const plan=authoredRestPlan(moveRestJoint(fixture(),{name:'forelimb-left-shoulder',position:[-1,3,.5]}),{baselineSha256:'a'.repeat(64),displayMatrix:display,reference:null,view:{position:[1,2,3],target:[0,0,0]}});
 const result=await loadRestEditorInput({plan:JSON.parse(JSON.stringify(plan))});assert.deepEqual(result.plan,plan);assert.deepEqual(result.displayMatrix.toArray(),display);
});
test('recipe refuses wrong digest, bad frame, missing output, and conflicting plan',async()=>{
 const input={plan:fixture(),baseline_sha256:'a'.repeat(64),display_matrix:display},bytes=JSON.stringify(input),sha=createHash('sha256').update(bytes).digest('hex');
 const fetchImpl=async()=>new Response(bytes);
 const loaded=await loadRestEditorInput({recipe:'/input',recipe_sha256:sha},{fetchImpl});assert.equal(loaded.plan.joints.length,5);
 await assert.rejects(loadRestEditorInput({recipe:'/input',recipe_sha256:'b'.repeat(64)},{fetchImpl}),/digest mismatch/);
 await assert.rejects(loadRestEditorInput({recipe:'/input',recipe_sha256:sha},{fetchImpl:async()=>new Response('',{status:404})}),/HTTP 404/);
 await assert.rejects(loadRestEditorInput({recipe:'/input',recipe_sha256:sha,plan:fixture()},{fetchImpl}),/competing plan/);
 await assert.rejects(loadRestEditorInput({...input,display_matrix:new Array(16).fill(0)}),/Invertible/);
});
