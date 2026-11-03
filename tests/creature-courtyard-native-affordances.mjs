// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createCourtyard} from '../experiments/creature-motion/courtyard.experiment.mjs';
import {collectStaticSceneGeometry} from '../scene-light-geometry.mjs';
class Element{constructor(){this.children=[];this.style={};this.value='';}append(...nodes){for(const node of nodes){if(node&&typeof node==='object')node.parentNode=this;this.children.push(node);}}setAttribute(k,v){this[k]=String(v);}remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this);this.parentNode=null;}click(){}}
const nodes=root=>typeof root==='object'?[root,...root.children.flatMap(nodes)]:[];
async function fixture(){
 const toolbar=new Element(),add=new Element();toolbar.append(add);add.closest=()=>toolbar;
 const scene=new THREE.Scene(),frames=new Set(),seats=[],document={createElement:()=>new Element(),createTextNode:x=>x,getElementById:id=>id==='scene-add-menu'?add:null};let serial=0,borrowed=0,paused=false,steps=3,running=false,flow=.25;
 const session={async attach(root){scene.add(root);return {id:'object-'+(++serial),root};},onFrame(fn){frames.add(fn);return()=>frames.delete(fn);},setView(){},redraw(){},async dispose(){frames.clear();scene.clear();}};
 const host={controls:{document,mountObject:x=>{seats.push(x);return {dispose(){}};},installNumberDrag(){}},scene:{open:async()=>session,objects:()=>[]}};
 const program={duration:4,events:[{at:0,source:'fire',patch:{flow:0}},{at:1,source:'beacon',patch:{visible:true,scale:.5}},{at:2,source:'traveler',patch:{moving:true}},{at:3,source:'fire',patch:{flow:2.5}}]};
 const flame={read:()=>({active:true,runtime:{simulationPaused:paused},clock:{simStepCount:steps},flow}),setControls:patch=>{flow=patch['volume-flow-rate'];},borrowSceneClock(){borrowed++;paused=true;return {read:()=>({running,simStepCount:steps,simulationPaused:paused}),take:()=>0,advance(){steps+=60;},setRunning:v=>{running=v;paused=!v;},dispose(){}};}};
 const room=await createCourtyard({host,inputs:{actors:[],zones:[],view:{},program}},{openFlame:()=>flame,createLivingScene:async()=>({read:()=>({running,actors:[]}),operations:{async setRunning(x){running=x.running;},async advance(){}},mount(){},async dispose(){}})});
 return {room,scene,seats,document,toolbar,frame:seconds=>{for(const fn of [...frames])fn({deltaSeconds:seconds});},source:()=>({borrowed,paused,steps,flow})};
}
test('opening, pausing and repeating the fixture cannot acquire or pause the flame solver',async()=>{
 const f=await fixture();try{assert.equal(f.source().borrowed,0,'Courtyard must use ordinary flame controls without borrowing its clock');await f.room.operations.setRunning({running:false});f.room.operations.repeat();assert.equal(f.source().paused,false);assert.equal(f.source().steps,3);}finally{await f.room.dispose();}
});
test('timed objects follow viewer seconds independently of held creatures and fluid ticks',async()=>{
 const f=await fixture();try{f.room.operations.automatic({enabled:true});await f.room.operations.setRunning({running:false});f.frame(1);assert.equal(f.room.read().sources.beacon.scale[0],.5);assert.equal(f.room.read().program.time,1);assert.equal(f.source().steps,3);assert.equal(f.source().paused,false);}finally{await f.room.dispose();}
});
test('the courtyard exposes no whole-world exact simulation step',async()=>{
 const f=await fixture();try{assert.equal(f.room.operations.advance,undefined,'A courtyard command must not batch-submit fluid simulation');}finally{await f.room.dispose();}
});
test('source controls are attached to the actual selectable object and edit it through the shared operation',async()=>{
 const f=await fixture();try{f.room.mount({root:new Element(),document:f.document,invoke:async(op,input)=>f.room.operations[op](input)});const seat=f.seats.find(x=>x.asset.root.name==='Bronze iris beacon');assert.ok(seat);const fields=nodes(seat.properties),size=fields.find(x=>x['aria-label']==='Beacon size');assert.ok(size,'Selected beacon needs a meaningful size property');size.value='.8';await size.oninput();assert.equal(f.room.read().sources.beacon.scale[0],.8);assert.equal(f.room.read().sources.beacon.scheduled,false,'Editing one source releases that source from its timer');assert.ok(!fields.some(x=>/Fire small|Fire large/.test(x.textContent??'')));}finally{await f.room.dispose();}
});
test('the full tiled court and colonnade are accepted by ordinary native fire lighting',async()=>{
 const f=await fixture();try{
  const floor=f.scene.children.find(x=>x.name==='Stone court'),columns=f.scene.children.find(x=>x.name==='Court colonnade');assert.ok(floor);assert.ok(columns);
  const geometry=collectStaticSceneGeometry(floor);assert.equal(geometry.triangles.length,120*12,'All 120 box tiles must retain their surfaces');
  let drawables=0;floor.traverse(x=>{if(x.isMesh)drawables++;});assert.ok(drawables<120,'Static tiles should share drawable geometry');
  const bounds=new THREE.Box3().setFromObject(floor);assert.ok(bounds.min.distanceTo(new THREE.Vector3(-5.995,-.17,-4.995))<1e-6);assert.ok(bounds.max.distanceTo(new THREE.Vector3(5.995,-.01,4.995))<1e-6);
  assert.ok(collectStaticSceneGeometry(columns).triangles.length>0,'Colonnade must also retain supported casting surfaces');
 }finally{await f.room.dispose();}
});

test('room actions stay outside the owner slot hidden by native object selection and dispose their toolbar mount',async()=>{
 const f=await fixture(),hiddenOwner=new Element(),root=new Element();hiddenOwner.hidden=true;hiddenOwner.append(root);try{
  f.room.mount({root,document:f.document,invoke:async(op,input)=>f.room.operations[op](input)});
  const fields=[...nodes(root),...nodes(f.toolbar)];
  for(const control of [fields.find(x=>x['aria-label']==='Run timed objects'),fields.find(x=>x.textContent==='Save observation and event history'),fields.find(x=>x['aria-label']==='Selected creature sensory field')]){
   assert.ok(control);for(let at=control;at;at=at.parentNode)assert.notEqual(at.hidden,true,'Selected-object layout must not hide the room actions');
  }
 }finally{await f.room.dispose();}
 assert.equal(f.toolbar.children.length,1,'Only the borrowed Add control survives room disposal');
});
