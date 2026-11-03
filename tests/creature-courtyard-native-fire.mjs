// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createCourtyard} from '../experiments/creature-motion/courtyard.experiment.mjs';
import {createFlameWorkbench} from '../flame-workbench.mjs';
const clone=structuredClone;
async function fixture(law='inflow-boundary'){
 const scene=new THREE.Scene(),frames=new Set(),listeners=new Set();let serial=0;
 let controls={'volume-flow-rate':.5,'volume-emitter-source-law':law,'volume-immersed-speed':.5},enabled=true;
 const descriptor=(id,value)=>({id,value});
 const settings=()=>({domControls:Object.fromEntries(Object.entries(controls).map(([id,value])=>[id,descriptor(id,value)])),rendererControls:{},presentationControls:{}});
 const source=()=>({id:'court-fire',type:'flame-emitter',emissionEnabled:enabled,emission:{settings:settings().domControls},transform:{position:[0,1,0],scale:[1,1,1]}});
 const notify=()=>{for(const listener of [...listeners])listener();};
 const nativeEdit=patch=>{Object.assign(controls,patch);notify();};
 const flame=createFlameWorkbench({readSettings:settings,applySettings:next=>{controls=Object.fromEntries(Object.entries(next.domControls).map(([id,d])=>[id,d.value]));notify();},readRuntime:()=>({active:true,frameCount:10,simStepCount:8,controls:{flowRate:controls['volume-flow-rate'],immersedSpeed:controls['volume-immersed-speed']}}),readScene:()=>({objects:[source()]}),readView:()=>({position:[1,2,3]}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}});
 const session={async attach(root){scene.add(root);return {id:'object-'+(++serial),root};},onFrame(fn){frames.add(fn);return()=>frames.delete(fn);},setView(){},redraw(){},async dispose(){scene.clear();frames.clear();}};
 const emitted=[],host={scene:{open:async()=>session},controls:{document:{createElement:()=>({click(){}})}},fire:{setEnabled(value){enabled=value;notify();}}};
 const program={duration:8,events:[{at:0,source:'fire',patch:{flow:.25}},{at:2,source:'beacon',patch:{visible:true}},{at:3,source:'fire',patch:{flow:2.5}},{at:5,source:'fire',patch:{flow:0}}]};
 const room=await createCourtyard({host,inputs:{actors:[],zones:[],view:{},program},record:x=>emitted.push(clone(x))},{openFlame:()=>flame,createLivingScene:async()=>({read:()=>({actors:[]}),operations:{},mount(){},async dispose(){}})});
 return {room,emitted,nativeEdit,controls:()=>clone(controls),enabled:()=>enabled,listeners,frame:dt=>{for(const fn of frames)fn({deltaSeconds:dt});}};
}
test('an accepted native fire edit releases only that timer and retains the effective owner operation',async()=>{
 const f=await fixture();try{
  f.room.operations.automatic({enabled:true});f.frame(.5);f.nativeEdit({'volume-flow-rate':.7});f.frame(3);
  assert.equal(f.controls()['volume-flow-rate'],.7,'The next scheduled flame event must respect the ordinary edit');
  assert.equal(f.room.read().sources.beacon.visible,true,'Unrelated source events continue');
  const observed=f.emitted.filter(x=>x.kind==='flame.settings'&&x.effective.domControls['volume-flow-rate'].value===.7);
  assert.equal(observed.length,1,'The effective native edit is retained once');
  assert.ok(f.room.read().log.some(x=>x.kind==='courtyard.manual'&&x.effective.source==='fire'));
 }finally{await f.room.dispose();}
 assert.equal(f.listeners.size,0,'Disposal releases the owner operation subscription');
});
test('scheduled fire writes remain scheduled and distinguish their origin from manual interventions',async()=>{
 const f=await fixture();try{
  f.room.operations.automatic({enabled:true});f.frame(3);
  assert.equal(f.controls()['volume-flow-rate'],2.5);
  assert.equal(f.room.read().log.filter(x=>x.kind==='courtyard.manual').length,0,'Program edits must not release themselves');
  assert.ok(f.emitted.some(x=>x.kind==='flame.settings'&&x.origin==='courtyard-schedule'));
 }finally{await f.room.dispose();}
});
test('immersed-source events use the authored native inlet speed and enabled state',async()=>{
 const f=await fixture('immersed-source');try{
  f.room.operations.automatic({enabled:true});assert.equal(f.controls()['volume-immersed-speed'],.125,'Small event scales the actual authored inlet speed');
  f.frame(3);assert.equal(f.controls()['volume-immersed-speed'],1.25,'Large event scales the same native inlet coefficient');
  f.frame(2);assert.equal(f.enabled(),false,'A quiet event disables the actual source while the domain remains live');
  f.room.operations.repeat();assert.equal(f.enabled(),true);assert.equal(f.controls()['volume-immersed-speed'],.125);
 }finally{await f.room.dispose();}
});
