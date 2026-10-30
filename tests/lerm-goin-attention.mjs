// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGoinPursuit} from '../experiments/lerms/goin-pursuit.experiment.mjs';

const names=['pelvis','spine-chest','neck','head','head-end'],parents=[-1,0,1,2,3];
const positions=[[0,0,0],[0,0,-1],[0,.2,-1.4],[0,.3,-1.8],[0,.35,-2.1]];
const at=p=>[[1,0,0,p[0]],[0,1,0,p[1]],[0,0,1,p[2]],[0,0,0,1]];
const bones=names.map((name,i)=>({name,parent:parents[i]<0?null:names[parents[i]],restMatrix:at(positions[i]),tail:[0,0,-.1]}));
const channels=['fixed',...names],vertices=403,rest=new Float32Array(vertices*3),weights=new Float32Array(vertices*channels.length);
rest.set([0,0,0,1,0,0,0,1,0]);for(let i=0;i<3;i++)weights[i*channels.length+1]=1;
for(let i=0;i<400;i++){rest.set([0,.3,-1.8-.4*i/400],(i+3)*3);weights[(i+3)*channels.length+channels.indexOf('head')]=1;}
const motion={frames:60,joints:names.length,skeleton:{fps:30,jointNames:names,parents},
 positions:Array.from({length:60},(_,f)=>positions.map(p=>[p[0],p[1],p[2]-.01*f]).flat()).flat(),localRotations:Array(60*names.length).fill([1,0,0,0]).flat()};
const data={manifest:{bones,channels,vertices,triangles:1},rest,weights,triangles:new Uint32Array([0,1,2]),frame:{canonicalWorldToSourceNormalized:at([0,0,0]),bones},motion,
 source:{caseSha256:'c'.repeat(64),frameSha256:'b'.repeat(64),motionSha256:'a'.repeat(64)}};
const scene=new THREE.Scene(),ticks=new Set();
class Element{constructor(){this.children=[];this.style={};}append(...xs){this.children.push(...xs);}setAttribute(){}remove(){}}
const host={controls:{document:{createElement:()=>new Element(),getElementById:()=>null}},scene:{refreshPresentation(){},async open(){const own=[];return {
 async attach(root,{metadata}={}){scene.add(root);own.push(root);root.userData.kaminosSceneObject={id:root.uuid,...metadata};return {id:root.uuid,root,owned:true};},
 onFrame(fn){ticks.add(fn);return ()=>ticks.delete(fn);},redraw(){},setView(){},readView:()=>({}),async dispose(){for(const root of own)root.removeFromParent();}
 };}}};
const inputs={creature:{blend_frames:0,radius:4,attention:{interests:[]}},goin:{position:[.4,.3,-2.5]},arrivalRadius:3,
 theft:{escape:[0,0,0],socket:{bone:'pelvis',offset:[0,1,0]}},running:false};
const item=await createGoinPursuit({host,inputs},{loadSources:async()=>data});
const tick=(seconds=1/30)=>{scene.updateMatrixWorld(true);item.operations.advance({seconds});};
try{
 item.operations.beginGoinGrab();
 for(let i=0;i<180;i++)tick();
 let state=item.read(),id=state.goin.id;
 assert.equal(state.task.custody.carrierId,null,'Held target cannot be taken');
 assert.equal(state.creature.attention.focus?.id,id,'Held goin stays interesting beyond novelty inspection');
 assert.ok(state.creature.attention.weight>.8,'Target attention reaches the actual presented pose');
 assert.equal(state.creature.action.engagement.enabled,false,'Curiosity must not replace game locomotion');
 const goin=scene.getObjectByProperty('uuid',id);goin.position.set(-.4,.3,-2.5);
 for(let i=0;i<30;i++)tick();
 assert.ok(Math.abs(item.read().creature.attention.focus.point[0]+.4)<.01,'Gaze follows current observed object placement');
 goin.visible=false;
 for(let i=0;i<120;i++)tick();
 assert.notEqual(item.read().creature.attention.focus?.id,id,'Missing target cannot become an omniscient gaze');
 goin.visible=true;
 for(let i=0;i<120;i++)tick();
 assert.equal(item.read().creature.attention.focus?.id,id);
 item.operations.endGoinGrab();tick();
 assert.equal(item.read().task.custody.phase,'carried');
 for(let i=0;i<120;i++)tick();
 assert.notEqual(item.read().creature.attention.focus?.id,id,'Possession releases gaze from the carried socket');
 assert.ok(!item.read().creature.attention.candidates.some(x=>x.id===id),'Carried wealth is not a surrounding interest');
 item.operations.beginGoinGrab();goin.position.set(.3,.3,-2.5);
 for(let i=0;i<150;i++)tick();
 assert.equal(item.read().creature.attention.focus?.id,id,'Taking it back renews the actual target interest');
 goin.removeFromParent();
 for(let i=0;i<120;i++)tick();
 assert.notEqual(item.read().creature.attention.focus?.id,id,'Detached geometry must not remain a live scene interest');
}finally{await item.dispose();}
assert.equal(ticks.size,0);assert.equal(scene.children.length,0);
const approaching=await createGoinPursuit({host,inputs:{...inputs,arrivalRadius:.6}},{loadSources:async()=>data});
try{
 approaching.operations.beginGoinGrab();
 for(let i=0;i<600;i++){scene.updateMatrixWorld(true);approaching.operations.advance({seconds:1/30});}
 const s=approaching.read();
 assert.equal(s.task.phase,'watching-held-goin');
 assert.equal(s.creature.attention.focus?.id,s.goin.id,'Arrival must leave the desired goin ahead of the actual head, not behind it');
 assert.equal(s.task.custody.carrierId,null);
}finally{await approaching.dispose();}
console.log('Goin possession composes with current attention without replacing game movement');
