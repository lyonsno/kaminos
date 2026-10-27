// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFlameSceneClock} from '../flame-scene-clock.mjs';
const borrowTestClock=()=>{let steps=0,paused=false;return createFlameSceneClock({readRuntime:()=>({active:true,simStepCount:steps,simulationPaused:paused,timeStep:{effective:{dtScale:1}}}),pauseSimulation:value=>{paused=value;},stepSimulation:value=>{steps+=value.steps;},now:()=>0});};
import * as THREE from 'three';
import {createLivingScene} from '../experiments/creature-motion/living-scene.experiment.mjs';
import {createCourtyard} from '../experiments/creature-motion/courtyard.experiment.mjs';
import {openExperiment} from '../workbench-experiments.mjs';
class Element{constructor(){this.children=[];this.style={};}append(...x){this.children.push(...x);}prepend(...x){this.children.unshift(...x);}setAttribute(){}remove(){}click(){}}
const document={createElement:()=>new Element(),getElementById:()=>null},scene=new THREE.Scene(),callbacks=new Set();let serial=0;
const host={controls:{document},scene:{refreshPresentation(){},objects:()=>[],async open(){const owned=new Set(),stops=new Set();return {async attach(root){owned.add(root);scene.add(root);return {id:'object-'+(++serial),root};},onFrame(fn){callbacks.add(fn);const stop=()=>callbacks.delete(fn);stops.add(stop);return stop;},redraw(){},readView:()=>({}),setView(){},async dispose(){for(const stop of stops)stop();for(const root of owned)root.removeFromParent();}};}}};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
const data={manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,.2,0,0,.2,1,0,.2,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]},source:{motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)}};
const transform={position:[0,0,0],quaternion:[0,0,0,1],scale:[1,1,1]},creature={case:'skin',case_sha256:'c'.repeat(64),motion:'motion',motion_sha256:'a'.repeat(64),frame:'frame',frame_sha256:'b'.repeat(64),blend_frames:0,transform,action:'wander',play:false};
const setup={running:false,zones:[{id:'yard',label:'Courtyard',transform:{...transform,scale:[4,1,4]}}],actors:['one','two'].map(id=>({id,label:id,active:true,places:[{zoneId:'yard',enabled:true,preference:1}],creature}))};

const program={duration:8,events:[{at:0,source:'traveler',patch:{moving:false}},{at:1,source:'traveler',patch:{moving:true}}]};
async function courtyard(){
 let living,failNext=false,sourceSteps=0,sourcePaused=false;
 const inputs={...structuredClone(setup),program,view:{}};
 const definition={id:'rubberneck/courtyard',title:'Creatures · furnace courtyard',create:context=>createCourtyard(context,{loadSources:async()=>data,openFlame:()=>({read:()=>({active:true}),borrowSceneClock:()=>createFlameSceneClock({readRuntime:()=>({active:true,simStepCount:sourceSteps,simulationPaused:sourcePaused,timeStep:{effective:{dtScale:1}}}),pauseSimulation:value=>{sourcePaused=value;},stepSimulation:value=>{sourceSteps+=value.steps;},now:()=>0}),setControls(){}}),createLivingScene:async(context,deps)=>{if(failNext){failNext=false;throw Error('Synthetic construction refusal');}const {attention,...simple}=context.inputs;living=await createLivingScene({...context,inputs:simple},deps);return living;}})};
 const room=await openExperiment(definition,{host,inputs});return {room,tickSource:steps=>{sourceSteps+=steps;},sourceRead:()=>({steps:sourceSteps,paused:sourcePaused}),failConstruction:()=>{failNext=true;},get living(){return living;}};
}
test('manual source motion keeps running when event scheduling is held',async()=>{
 const {room}=await courtyard();try{
  await room.invoke('manual',{source:'traveler',patch:{moving:true}});await room.invoke('advance',{seconds:1});const a=await room.read();await room.invoke('advance',{seconds:1});const b=await room.read();
  assert.notDeepEqual(a.sources.traveler.position,b.sources.traveler.position,'Manual Lantern move must continue across simulation steps');
  await room.invoke('repeat');await room.invoke('advance',{seconds:2});await room.invoke('manual',{source:'beacon',patch:{visible:true}});const c=await room.read();await room.invoke('advance',{seconds:1});assert.notDeepEqual((await room.read()).sources.traveler.position,c.sources.traveler.position,'Holding automation during scheduled travel must not stop the object');
 }finally{await room.dispose();}
});
test('restart reconstructs the original cohort and flags after supported edits',async()=>{
 const c=await courtyard();try{
  await c.living.operations.setActive({id:'one',active:false});await c.living.operations.setPreview({id:'one',preview:true});await c.living.operations.duplicate({id:'two'});await c.living.operations.remove({id:'two'});
  await c.room.invoke('restart');const r=(await c.room.read()).creatures;assert.deepEqual(r.actors.map(a=>a.id),['one','two']);assert.ok(r.actors.every(a=>a.active&&a.behavior.preview===false));assert.equal(r.running,false);
 }finally{await c.room.dispose();}
});
async function exportRecording(room){const create=URL.createObjectURL,revoke=URL.revokeObjectURL;let blob;URL.createObjectURL=value=>{blob=value;return 'blob:test';};URL.revokeObjectURL=()=>{};try{await room.invoke('export');return JSON.parse(await blob.text());}finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;}}
test('ordinary living controls retain a complete shared recording',async()=>{
 const {room}=await courtyard();try{await room.invoke('setRunning',{running:true});await room.invoke('setRunning',{running:false});await room.invoke('actor',{id:'one',operation:'pause'});const r=await exportRecording(room);assert.equal(r.recording.complete,true,JSON.stringify(r.recording.issues));assert.ok(r.recording.operations.some(x=>x.kind==='living.run'&&x.effective.running===false));}finally{await room.dispose();}
});
test('one source intervention publishes one shared recorded event',async()=>{
 const {room}=await courtyard();try{await room.invoke('automatic',{enabled:false});const r=await exportRecording(room);assert.equal(r.recording.operations.filter(x=>x.kind==='courtyard.automatic').length,1);}finally{await room.dispose();}
});

test('failed baseline construction keeps the held prior cohort and reports no success',async()=>{
 const c=await courtyard();try{const before=(await c.room.read()).creatures.actors.map(a=>a.state.host.id);c.failConstruction();await assert.rejects(c.room.invoke('restart'),/construction refusal/);const after=await c.room.read();assert.deepEqual(after.creatures.actors.map(a=>a.state.host.id),before);assert.equal(after.creatures.running,false);assert.equal(after.log.at(-1).kind,'courtyard.restart-failed');}finally{await c.room.dispose();}
});

test('the actual living join follows fluid time rather than delayed host frames',async()=>{
 const c=await courtyard();try{
  assert.equal(c.sourceRead().paused,true);await c.room.invoke('setRunning',{running:true});assert.equal(c.sourceRead().paused,false);c.tickSource(6);for(const fn of [...callbacks])fn({deltaSeconds:10});assert.ok(Math.abs((await c.room.read()).time-.1)<1e-10,'Ten delayed wall seconds cannot become ten creature seconds when the fluid advanced only six ticks');
  await c.room.invoke('setRunning',{running:false});assert.equal(c.sourceRead().paused,true);const held=(await c.room.read()).time;for(const fn of [...callbacks])fn({deltaSeconds:20});assert.equal((await c.room.read()).time,held);await c.room.invoke('advance',{seconds:.1});assert.equal(c.sourceRead().steps,12);assert.ok(Math.abs((await c.room.read()).time-.2)<1e-10);
 }finally{await c.room.dispose();}
});
test('world-step failure holds the real joined clock as well as creatures',async()=>{
 const c=await courtyard();try{
  await c.room.invoke('setRunning',{running:true});scene.children.find(x=>x.name==='Crossing bronze lantern').removeFromParent();c.tickSource(120);
  assert.throws(()=>{for(const fn of [...callbacks])fn({deltaSeconds:2});},/Source removed/);
  assert.equal((await c.room.read()).creatures.running,false);assert.equal(c.sourceRead().paused,true,'The solver must stop when a scheduled world edit fails');assert.ok(((await c.room.read()).creatures.frameFailure?.message??'').includes('Source removed'),'The stopped scene must retain the failure reason');
 }finally{await c.room.dispose();}
});
test('event repeat restores the analytic path phase and preserves authored placement',async()=>{
 const c=await courtyard();try{
  await c.room.invoke('advance',{seconds:2});const first=(await c.room.read()).sources.traveler.position;
  await c.room.invoke('repeat');await c.room.invoke('advance',{seconds:2});assert.deepEqual((await c.room.read()).sources.traveler.position,first,'The same source program needs the same moving path phase');
  await c.room.invoke('manual',{source:'traveler',patch:{moving:false}});scene.children.find(x=>x.name==='Crossing bronze lantern').position.x+=1;
  await c.room.invoke('repeat');assert.equal((await c.room.read()).sources.traveler.position[0],1,'Repeating the scripted path must retain an ordinary placement edit');
 }finally{await c.room.dispose();}
});
