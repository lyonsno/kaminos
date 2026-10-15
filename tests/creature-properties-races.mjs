// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {openExperiment} from '../workbench-experiments.mjs';
import {createWalkingCreature} from '../experiments/creature-motion/walking.experiment.mjs';
class Element{constructor(){this.children=[];this.style={};this.value='';}append(...x){this.children.push(...x);}setAttribute(k,v){this[k]=String(v);}remove(){this.removed=true;}}
const nodes=n=>[n,...n.children.flatMap(nodes)];
async function fixture(){
 const document={createElement:()=>new Element(),getElementById:()=>null},scene=new THREE.Scene();let seating;
 const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
 const skin=sha=>({manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),source:{caseSha256:sha}});
 const heavy='a'.repeat(64),lean='d'.repeat(64),choices=[{cast:'heavy',label:'Heavy',attachment:'distributed',case:'heavy',case_sha256:heavy},{cast:'lean',label:'Lean',attachment:'distributed',case:'lean',case_sha256:lean}];
 const data={...skin(heavy),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,.2,0,0,.2,1,0,.2,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]},source:{motionSha256:'b'.repeat(64),frameSha256:'c'.repeat(64),caseSha256:heavy}};
 let rejectLean;const pending=new Promise((_resolve,reject)=>{rejectLean=reject;});
 const session={async attach(root){scene.add(root);return {id:'animal',root,owned:true};},onFrame(){throw Error('Paused property updates cannot rely on a frame callback');},redraw(){},readView:()=>({position:[4,2,4],target:[0,0,0]}),async dispose(){scene.clear();}};
 const host={controls:{document,mountObject:x=>(seating=x,{dispose(){},update(){}})},scene:{open:async()=>session}};
 const api=await openExperiment({id:'fixture/creature',title:'Creature',create:args=>createWalkingCreature(args,{loadSources:async()=>data,loadSkin:input=>input.case==='lean'?pending:Promise.resolve(skin(input.case_sha256))})},{host,inputs:{case:'heavy',case_sha256:heavy,choices,blend_frames:0},record(){}});
 const mount=await api.mount({root:new Element()});const all=nodes(seating.properties),cast=all.find(n=>n['aria-label']==='Creature cast'),error=all.find(n=>n.role==='alert');
 return {api,mount,cast,error,rejectLean,heavy,startLean(){cast.value='lean';return cast.onchange();}};
}
test('paused cast loading disables its controls immediately through the actual experiment mount',async()=>{
 const f=await fixture();try{const old=f.startLean();assert.equal(f.cast.disabled,true,'Paused cast selector did not present its pending load');f.rejectLean(Error('current refusal'));await old;assert.equal(f.cast.disabled,false);assert.equal(f.error.textContent,'current refusal');}finally{await f.api.dispose();}
});
test('obsolete refusal cannot overwrite a newer successful cast source, recipe or warning',async()=>{
 const f=await fixture();try{const old=f.startLean();f.cast.value='heavy';await f.cast.onchange();f.rejectLean(Error('obsolete lean fetch failed'));await old;const r=await f.api.read();assert.equal(r.currentSkin.current.cast,'heavy');assert.equal(r.currentSkin.error,null);assert.equal(r.source.caseSha256,f.heavy);assert.equal(r.recipe.case_sha256,f.heavy);assert.equal(f.error.textContent,'');assert.equal(f.cast.value,'heavy');}finally{await f.api.dispose();}
});
test('disposing the properties mount prevents late refusal publication',async()=>{
 const f=await fixture();try{const old=f.startLean();f.mount.dispose();f.rejectLean(Error('late refusal'));await old;assert.equal(f.error.textContent,'');}finally{await f.api.dispose();}
});
