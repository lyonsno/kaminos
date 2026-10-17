// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createRestSkeletonEditor,loadRestEditorInput} from '../experiments/creature-motion/rest-skeleton.experiment.mjs';
import {createSceneEdits,axisVector} from '../scene-edit-session.mjs';
const explicitProfile=()=>({schema:'kaminos.quadruped-correspondence.v1',id:'synthetic-partial',authority:'Test only',trunk:['root','forelimb-left-shoulder'],fore:{left:['forelimb-left-shoulder','elbowL','wristL'],right:['forelimb-right-shoulder','elbowR','wristR']},hind:{left:['hipL','kneeL','ankleL'],right:['hipR','kneeR','ankleR']}});
const pose=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
const joint=(name,parent,head)=>({name,parent,head,tail:head.map((v,k)=>v+(k===1?1:0)),matrix:[[1,0,0,head[0]],[0,1,0,head[1]],[0,0,1,head[2]],[0,0,0,1]]});
const plan=()=>({schema:'kaminos.complete-creature-joints.v0',joints:[joint('root',null,[0,0,0]),joint('forelimb-left-shoulder','root',[-2,2,0]),joint('forelimb-right-shoulder','root',[2,2,0])]});
const input=()=>({plan:plan(),baseline_sha256:'a'.repeat(64),display_matrix:new THREE.Matrix4().toArray(),reference:{jointNames:['root','tip'],parents:[-1,0],positions:[0,0,0,0,1,0]}});
async function open(inputs=input()){
 const scene=new THREE.Scene(),objects=[],edits=createSceneEdits({read:()=>null,write:()=>{}});let adapter,preferences={pivot:'median',orientation:'world'};
 const session={attach:async root=>{scene.add(root);const asset={id:'object-'+objects.length,root};objects.push(asset);return asset;},setView(){},readView:()=>({position:[3,0,0],target:[0,0,0]}),redraw(){},dispose:async()=>{for(const o of objects)o.root.removeFromParent();}};
 let properties,opened;const element=()=>({children:[],dataset:{},style:{},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},setAttribute(){},querySelectorAll(){return [];}}),document={createElement:element,defaultView:{kaminosWorkbenchExperiments:{async open(id,inputs){opened=await loadRestEditorInput(inputs);}},kaminosSceneEdits:edits,kaminosSelection:{set(){}}}};
 const host={controls:{document,mountObject:value=>{properties=value.properties;return {dispose(){}};},transformSettings:()=>preferences,components:{register(id,value){adapter=value;return {changed(fn){fn?.();},dispose(){}};}}},scene:{open:async()=>session}};
 const editor=await createRestSkeletonEditor({host,inputs});return {editor,objects,edits,get adapter(){return adapter;},get properties(){return properties;},get opened(){return opened;},preferences,mount(){editor.mount({root:element(),document,invoke:(name,value)=>Promise.resolve(editor.operations[name](value))});}};
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
test('atlas follows actual edits, keeps unsupported cells visible, and survives export/reopen',async()=>{
 const inputs=input(),reference={...inputs.reference,id:'test-ref',label:'Explicit test reference',source:{path:'synthetic-ref',sha256:'b'.repeat(64)},profile:explicitProfile()};
 inputs.proportion_atlas={schema:'kaminos.skeleton-proportion-atlas.v1',profile:explicitProfile(),activeReference:'test-ref',references:[reference,{...reference,id:'test-ref-2',label:'Second reference'}]};
 const ctx=await open(inputs);let read=ctx.editor.read();assert.equal(read.proportions.status,'partial');assert.equal(read.proportions.activeReference,'test-ref');assert.ok(read.proportions.references[0].comparison.rows.some(r=>r.candidate===null||r.reference===null));
 ctx.adapter.enter();const before=read.proportions.candidate.trunk.length;ctx.editor.operations.move({name:'forelimb-left-shoulder',position:[-4,2,0]});read=ctx.editor.read();assert.notEqual(read.proportions.candidate.trunk.length,before);await ctx.editor.operations.undo();assert.equal(ctx.editor.read().proportions.candidate.trunk.length,before);
 const heads=ctx.editor.read().joints.map(j=>j.head);ctx.objects[1].root.position.set(3,4,5);ctx.editor.operations.reference({id:'test-ref-2'});assert.equal(ctx.editor.read().proportions.activeReference,'test-ref-2');assert.deepEqual(ctx.editor.read().joints.map(j=>j.head),heads);assert.deepEqual(ctx.objects[1].root.position.toArray(),[3,4,5]);await ctx.editor.operations.undo();assert.equal(ctx.editor.read().proportions.activeReference,'test-ref');await ctx.editor.operations.redo();assert.equal(ctx.editor.read().proportions.activeReference,'test-ref-2');
 const saved=ctx.editor.operations.export();assert.equal(saved.rest_authoring.proportionAtlas.activeReference,'test-ref-2');const reopened=await open({plan:saved});assert.deepEqual(reopened.editor.read().proportions,ctx.editor.read().proportions);await reopened.editor.dispose();await ctx.editor.dispose();
});
test('mounted descriptor failure leaves readable unmeasurable anatomy with working Undo and subsequent edits',async()=>{
 const inputs=input();inputs.plan.joints.push(joint('neck','forelimb-left-shoulder',[0,4,0]));const profile=explicitProfile();profile.trunk=['root','neck'];const reference={...inputs.reference,id:'ref',label:'Reference',source:{path:'synthetic',sha256:'a'.repeat(64)},profile};inputs.proportion_atlas={schema:'kaminos.skeleton-proportion-atlas.v1',profile,activeReference:'ref',references:[reference]};
 const ctx=await open(inputs);ctx.mount();ctx.adapter.enter();const before=ctx.editor.operations.export();ctx.editor.operations.move({name:'root',position:[0,4,0]});assert.equal(ctx.edits.state().active,null);assert.equal(ctx.editor.read().proportions.status,'unmeasurable');await ctx.editor.operations.undo();assert.deepEqual(ctx.editor.operations.export().joints,before.joints);ctx.editor.operations.move({name:'root',position:[0,1,0]});assert.notEqual(ctx.editor.read().proportions.status,'unmeasurable');await ctx.editor.dispose();
});
test('Open skeleton retains current comparison for an older saved edit of the same graph',async()=>{
 const inputs=input(),reference={...inputs.reference,id:'r',label:'r',source:{path:'synthetic',sha256:'b'.repeat(64)},profile:explicitProfile()};inputs.proportion_atlas={schema:'kaminos.skeleton-proportion-atlas.v1',profile:explicitProfile(),activeReference:'r',references:[reference]};const ctx=await open(inputs);ctx.mount();const saved=ctx.editor.operations.export();delete saved.rest_authoring.proportionAtlas;saved.joints[1].head[0]-=.2;saved.joints[1].matrix[0][3]-=.2;
 const descendants=node=>[node,...(node.children??[]).flatMap(descendants)],file=descendants(ctx.properties).find(n=>n.type==='file');file.files=[{text:async()=>JSON.stringify(saved)}];await file.onchange();assert.equal(ctx.opened.proportionAtlas.activeReference,'r');assert.deepEqual(ctx.opened.plan.joints,saved.joints);
 const changed=structuredClone(saved);changed.joints[1].name='different-shoulder';file.files=[{text:async()=>JSON.stringify(changed)}];await file.onchange();assert.equal(ctx.opened.proportionAtlas,null);assert.deepEqual(ctx.opened.plan.joints,changed.joints);await ctx.editor.dispose();
});
