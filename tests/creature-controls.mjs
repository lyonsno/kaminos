// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWalkingCreature} from '../experiments/creature-motion/walking.experiment.mjs';
class Element{constructor(){this.children=[];this.style={};this.value='';}append(...x){this.children.push(...x);}prepend(...x){this.children.unshift(...x);}setAttribute(k,v){this[k]=String(v);}remove(){this.removed=true;}}
const document={createElement:()=>new Element(),getElementById:()=>null},scene=new THREE.Scene();let frame=null,seating=null;
const session={async attach(root){scene.add(root);return {id:'animal',root,owned:true};},onFrame(fn){frame=fn;return()=>{frame=null;};},redraw(){},readView:()=>({position:[4,2,4],target:[0,0,0]}),async dispose(){scene.clear();}};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
const skin=sha=>({manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),source:{caseSha256:sha}});
const data={...skin('a'.repeat(64)),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,.2,0,0,.2,1,0,.2,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]},source:{motionSha256:'b'.repeat(64),frameSha256:'c'.repeat(64),caseSha256:'a'.repeat(64)}};
const choices=[{cast:'heavy',label:'Heavy',attachment:'distributed',case:'heavy',case_sha256:'a'.repeat(64)},{cast:'lean',label:'Lean',attachment:'distributed',case:'lean',case_sha256:'d'.repeat(64)}];
const creature=await createWalkingCreature({host:{controls:{document,mountObject:x=>(seating=x,{dispose(){},update(){}})},scene:{open:async()=>session}},inputs:{case:'heavy',case_sha256:'a'.repeat(64),choices,blend_frames:0}},{loadSources:async()=>data,loadSkin:async input=>skin(input.case_sha256)});
assert.equal(typeof creature.operations.skin,'function','Ordinary creature has no composable cast/attachment operation');
creature.operations.seek({frame:1});const held=creature.read();await creature.operations.skin({cast:'lean',attachment:'distributed'});
assert.equal(creature.read().playback.frame,1);assert.deepEqual(creature.read().transform,held.transform);assert.equal(creature.read().recipe.case,'lean');assert.equal(creature.read().source.caseSha256,'d'.repeat(64));
creature.operations.rate({rate:.5});creature.operations.replay();frame({deltaSeconds:1/30});assert.equal(creature.read().playback.frame,0);frame({deltaSeconds:1/30});assert.equal(creature.read().playback.frame,1);
let reopened=0;
await creature.mount({root:new Element(),invoke:(name,input)=>creature.operations[name](input),reopen:async()=>{reopened++;}});assert.ok(seating.properties&&seating.playback,'Properties and playback must seat through the shared selected-object API');
const nodes=n=>[n,...n.children.flatMap(nodes)],file=nodes(seating.properties).find(n=>n['aria-label']==='Open creature setup');
const actualRoot=scene.children[0];assert.equal(actualRoot.userData.kaminosFrameContentOnly,true,'Travelled creature must frame its current body rather than its authored starting point');scene.remove(actualRoot);assert.equal(creature.read().host.id,null,'Removed creature cannot continue advertising a live scene registration');scene.add(actualRoot);
file.files=[{text:async()=>JSON.stringify({...creature.read().recipe,choices:[...choices,choices[0]]})}];await file.onchange();
assert.equal(reopened,0,'Invalid skin choices must be rejected before replacing the current creature');
assert.equal(creature.read().recipe.rate,.5);scene.remove(scene.children[0]);assert.equal(creature.read().host.id,null,'Removed creature cannot continue advertising a live scene registration');await creature.dispose();assert.equal(frame,null);
console.log('Ordinary creature cast swap preserves held pose and placement, saved identity/rate, shared selection properties and clock');
