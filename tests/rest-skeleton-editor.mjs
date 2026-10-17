// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createRestSkeletonEditor} from '../experiments/creature-motion/rest-skeleton.experiment.mjs';
import {createSceneEdits,axisVector} from '../scene-edit-session.mjs';
const pose=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
const joint=(name,parent,head)=>({name,parent,head,tail:head.map((v,k)=>v+(k===1?1:0)),matrix:[[1,0,0,head[0]],[0,1,0,head[1]],[0,0,1,head[2]],[0,0,0,1]]});
const plan=()=>({schema:'kaminos.complete-creature-joints.v0',joints:[joint('root',null,[0,0,0]),joint('forelimb-left-shoulder','root',[-2,2,0]),joint('forelimb-right-shoulder','root',[2,2,0])]});
const input=()=>({plan:plan(),baseline_sha256:'a'.repeat(64),display_matrix:new THREE.Matrix4().toArray(),reference:{jointNames:['root','tip'],parents:[-1,0],positions:[0,0,0,0,1,0]}});
async function open(inputs=input()){
 const scene=new THREE.Scene(),objects=[],edits=createSceneEdits({read:()=>null,write:()=>{}});let adapter,preferences={pivot:'median',orientation:'world'};
 const session={attach:async root=>{scene.add(root);const asset={id:'object-'+objects.length,root};objects.push(asset);return asset;},setView(){},readView:()=>({position:[3,0,0],target:[0,0,0]}),redraw(){},dispose:async()=>{for(const o of objects)o.root.removeFromParent();}};
 const host={controls:{document:{defaultView:{kaminosSceneEdits:edits,kaminosSelection:{set(){}}}},transformSettings:()=>preferences,components:{register(id,value){adapter=value;return {changed(fn){fn?.();},dispose(){}};}}},scene:{open:async()=>session}};
 const editor=await createRestSkeletonEditor({host,inputs});return {editor,objects,edits,get adapter(){return adapter;},preferences};
}
test('actual factory restores default/legacy side axes and explicit reference placement',async()=>{
 for(const axis of ['x','z',null]){
  const inputs=input();if(axis)inputs.plan.rest_authoring={baselineSha256:'a'.repeat(64),displayMatrix:inputs.display_matrix,reference:inputs.reference,referenceDisplay:{mode:'side',axis,baseline:false}};
  const ctx=await open(inputs);assert.deepEqual(ctx.objects[1].root.position.toArray(),axis==='x'?[1.6,0,0]:[0,0,1.6]);await ctx.editor.dispose();
 }
});
test('actual export/reopen retains hidden reference independently of its free placement',async()=>{
 const inputs=input();inputs.plan.rest_authoring={baselineSha256:'a'.repeat(64),displayMatrix:inputs.display_matrix,reference:inputs.reference,referenceDisplay:{mode:'off',axis:'x',baseline:false}};
 const first=await open(inputs);first.objects[1].root.position.set(4,5,6);assert.equal(first.objects[1].root.visible,false);const saved=first.editor.operations.export();const second=await open({plan:saved});assert.equal(second.objects[1].root.visible,false);assert.deepEqual(second.objects[1].root.position.toArray(),[4,5,6]);await first.editor.dispose();await second.editor.dispose();
});
test('rotated object gives Local keyboard and gizmo the same frame and an identity initial delta',async()=>{
 const inputs=input(),skeleton=pose();skeleton.rotation=[0,0,Math.PI/2];inputs.plan.rest_authoring={baselineSha256:'a'.repeat(64),displayMatrix:inputs.display_matrix,reference:inputs.reference,scene:{skeleton,reference:pose()}};
 const ctx=await open(inputs);ctx.adapter.enter();const target=ctx.adapter.target(),keyboard=axisVector('x','local',target.localOrientation),gizmo=new THREE.Vector3(1,0,0).applyQuaternion(target.object.quaternion);assert.ok(keyboard.distanceTo(gizmo)<1e-10);
 const before=ctx.editor.read().joints.map(j=>j.head);ctx.edits.begin(target.id);ctx.edits.preview(target.read());ctx.edits.commit();assert.deepEqual(ctx.editor.read().joints.map(j=>j.head),before);await ctx.editor.dispose();
});
test('actual editor consumes Active and Individual pivot choices from the shared toolbar',async()=>{
 const ctx=await open();ctx.adapter.enter();ctx.editor.operations.select({name:'forelimb-left-shoulder',pair:true});ctx.preferences.pivot='active';let target=ctx.adapter.target();assert.deepEqual(target.object.position.toArray(),[-2,2,0]);ctx.edits.apply(target.id,{...target.read(),scale:[2,2,2]});assert.deepEqual(ctx.editor.read().joints[1].head,[-2,2,0]);await ctx.edits.undo();
 ctx.preferences.pivot='individual';target=ctx.adapter.target();ctx.edits.apply(target.id,{...target.read(),scale:[2,2,2]});assert.deepEqual(ctx.editor.read().joints.map(j=>j.head),plan().joints.map(j=>j.head));await ctx.editor.dispose();
});
