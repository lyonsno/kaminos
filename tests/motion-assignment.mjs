// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {createWalkingCreature} from '../experiments/creature-motion/walking.experiment.mjs';
import {sessionMotions} from '../experiments/creature-motion/motion-collection.mjs';
class Element {constructor(){this.children=[];this.style={};this.dataset={};}append(...x){this.children.push(...x);}setAttribute(){}replaceChildren(...x){this.children=x;}remove(){}click(){}}
const document={createElement:()=>new Element(),getElementById:()=>null};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
const base={status:'completed',route:'unimate.text-to-motion.webgpu-local.v0',textEncoder:'browser T5',cooperative:true,controllerNorm:'valid-joints',assetCondSha256:'d'.repeat(64),frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,.2,0,0,.2,1,0,.2,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]};
async function fixture(){
 const rows=await Promise.all(['initial','A','B'].map(prompt=>sessionMotions.add({...base,prompt})));
 const choices=rows.map(r=>({id:r.id,label:r.motion.prompt,motion:r.motion.prompt+'.json',motion_sha256:r.id,motion_data:r.text}));
 const scene=new THREE.Scene(),session={attach:async root=>{scene.add(root);return {id:'creature',root};},onFrame:()=>()=>{},redraw(){},setView(){},readView:()=>({}),dispose(){scene.clear();}};
 let held=null,release=null,save;
 const entry=await createWalkingCreature({host:{controls:{document},scene:{open:async()=>session}},inputs:{motion_generation:{},motion:choices[0].motion,motion_sha256:rows[0].id,motions:choices,blend_frames:0}},{publishInspector:false,mountProperties:options=>{save=options.save;return {properties:new Element(),update(){},dispose(){}};},loadSources:async request=>{
  const row=rows.find(r=>r.id===request.motion_sha256);if(row.motion.prompt===held)await new Promise(resolve=>{release=resolve;});
  return {manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),frame:{canonicalWorldToSourceNormalized:I,bones},motion:row.motion,source:{motionSha256:row.id,frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)}};
 }});
 entry.mount({root:new Element(),invoke:(name,input)=>entry.operations[name](input)});
 return {entry,rows,hold(prompt){held=prompt;},release(){release();},async saved(){let blob;const original=URL.createObjectURL;URL.createObjectURL=value=>{blob=value;return 'blob:test';};try{save(entry.read().recipe);return JSON.parse(await blob.text());}finally{URL.createObjectURL=original;}}};
}
test('superseded assignment cannot change winner, playback or saved clip',async()=>{
 const f=await fixture();try{f.hold('A');const older=f.entry.operations.assignMotion({id:f.rows[1].id});await f.entry.operations.assignMotion({id:f.rows[2].id});f.entry.operations.seek({frame:1});f.release();const result=await older;
 assert.equal(result.status,'superseded');assert.equal(f.entry.read().source.motionSha256,f.rows[2].id);assert.equal(f.entry.read().assignedMotion.sha256,f.rows[2].id);assert.equal(f.entry.read().playback.frame,1);assert.equal((await f.saved()).motion_sha256,f.rows[2].id);
 }finally{await f.entry.dispose();}
});
test('ordinary motion selector assigns; workspace preview preserves that saved choice',async()=>{
 const f=await fixture();try{await f.entry.operations.motion({id:f.rows[1].id});assert.equal((await f.saved()).motion_sha256,f.rows[1].id);await f.entry.operations.previewMotion({id:f.rows[2].id});assert.equal(f.entry.read().source.motionSha256,f.rows[2].id);assert.equal((await f.saved()).motion_sha256,f.rows[1].id);await f.entry.operations.restoreMotion();assert.equal(f.entry.read().source.motionSha256,f.rows[1].id);
 }finally{await f.entry.dispose();}
});
