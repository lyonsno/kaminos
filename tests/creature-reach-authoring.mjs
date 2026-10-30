// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createPosedSkeleton} from '../experiments/creature-motion/posed-skeleton.experiment.mjs';
import {createWalkingCreature} from '../experiments/creature-motion/walking.experiment.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
class Element{constructor(){this.children=[];this.style={};this.value='';}append(...x){this.children.push(...x);}setAttribute(k,v){this[k]=String(v);}remove(){}}
const all=n=>[n,...n.children.flatMap(all)];
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
const bones=[{name:'pelvis',parent:null,restMatrix:I},{name:'forelimb-left-shoulder',parent:'pelvis',restMatrix:I}];
const data={manifest:{bones,channels:['fixed',...bones.map(b=>b.name)],vertices:3,triangles:1},rest:new Float32Array([1,0,0,0,1,0,1,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,.5,.5,0,.5,.5,0,.5,.5]),source:{caseSha256:'a'.repeat(64),motionSha256:'b'.repeat(64),frameSha256:'c'.repeat(64)}};
function fixture(){const edits=createSceneEdits({read:()=>null,write(){}}),scene=new THREE.Scene();let properties;
 const document={createElement:()=>new Element(),getElementById:()=>null,defaultView:{kaminosSceneEdits:edits,kaminosSelection:{set(){}}}};
 const session={attach:async root=>{scene.add(root);return {id:root.uuid,root};},redraw(){},setView(){},readView:()=>({position:[4,2,4],target:[0,0,0]}),dispose:async()=>scene.clear()};
 const host={controls:{document,mountObject:x=>(properties=x.properties,{dispose(){}}),components:{register:()=>({changed:f=>f(),dispose(){}})}},scene:{open:async()=>session,refreshPresentation(){}}};
 return {host,edits,document,properties:()=>properties};}
const f=fixture(),entry=await createPosedSkeleton({host:f.host,inputs:{rest_only:true}},{loadSources:async()=>data});
try{
 assert.equal(typeof entry.operations.limbAttachmentReach,'function','native creature posing must expose a saved, undoable reach operation');
 entry.mount({root:new Element(),document:f.document,invoke:(name,input)=>entry.operations[name](input)});
 const control=all(f.properties()).find(n=>n['aria-label']==='Limb attachment reach');assert(control,'selected creature inspector owns the property');
 control.value='2';await control.onchange();assert.equal(entry.read().binding.limbAttachmentReach,2);
 await f.edits.undo();assert.equal(entry.read().binding.limbAttachmentReach,0);await f.edits.redo();assert.equal(entry.read().binding.limbAttachmentReach,2);
 const saved=JSON.parse(JSON.stringify(entry.operations.snapshot()));assert.equal(saved.limbAttachmentReach,2);
 await entry.operations.limbAttachmentReach({value:0});await entry.operations.restore(saved);assert.equal(entry.read().binding.limbAttachmentReach,2);
 const bad={...saved,caseSha256:'f'.repeat(64),limbAttachmentReach:1};await assert.rejects(async()=>entry.operations.restore(bad));assert.equal(entry.read().binding.limbAttachmentReach,2);
 const legacy={...saved};delete legacy.limbAttachmentReach;await entry.operations.restore(legacy);assert.equal(entry.read().binding.limbAttachmentReach,0,'legacy pose means original binding, not stale current reach');
 await entry.operations.limbAttachmentReach({value:2});await entry.operations.reset();assert.equal(entry.read().binding.limbAttachmentReach,2,'rest pose preserves authored binding');
}finally{await entry.dispose();}
const motionData={...data,frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:2,skeleton:{fps:30,jointNames:bones.map(b=>b.name),parents:[-1,0]},positions:[0,.2,0,0,.2,0,0,.2,1,0,.2,1,0,.2,2,0,.2,2],localRotations:Array.from({length:6},()=>[1,0,0,0]).flat()}};
const g=fixture(),walking=await createWalkingCreature({host:g.host,inputs:{blend_frames:0,limb_attachment_reach:1}},{loadSources:async()=>motionData});
try{assert.equal(walking.read().skin.binding.limbAttachmentReach,1);await walking.operations.limbAttachmentReach({value:2});assert.equal(walking.read().recipe.limb_attachment_reach,2);await g.edits.undo();assert.equal(walking.read().recipe.limb_attachment_reach,1);const h=fixture(),reopened=await createWalkingCreature({host:h.host,inputs:walking.read().recipe},{loadSources:async()=>motionData});try{assert.equal(reopened.read().skin.binding.limbAttachmentReach,1);}finally{await reopened.dispose();}}finally{await walking.dispose();}
console.log('Reach is a native creature property, undoable, saved in pose/setup, legacy-safe and isolated per object');
