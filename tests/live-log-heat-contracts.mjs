import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.webgpu.js';
import {checkLiveLogFrame,stepLiveLogThermal,LIVE_LOG_HEAT_IDENTITY} from '../live-log-heat-core.mjs';
import {BURN_TABLE_ASSET} from '../burn-table-core.mjs';

test('local heat accumulates damage, then cools without erasing its history',()=>{
  let state=[0,0,0,0];for(let i=0;i<600;i++)state=stepLiveLogThermal(state,1,1/60);
  assert.ok(state[0]>1&&state[1]>.6&&state[2]>0);
  const char=state[1];for(let i=0;i<1800;i++)state=stepLiveLogThermal(state,0,1/60);
  assert.ok(state[0]<.01);assert.ok(state[1]>=char);assert.equal(state[2],0);
  let control=[0,0,0,0];for(let i=0;i<2400;i++)control=stepLiveLogThermal(control,0,1/60);
  assert.deepEqual(control,[0,0,0,0]);
});
test('GPU source identity rejects fallback device, absent generation and invalid coordinates',()=>{
  const device={},frame={device,fluid:{},dimensions:[48,48,48],allocationId:'fluid-1',simStepCount:4,dt:1/60,transform:{translate:[0,0,0],scale:1}};
  assert.equal(checkLiveLogFrame(frame,device),frame);
  assert.throws(()=>checkLiveLogFrame({...frame,device:{}},device),/same GPU/);
  assert.throws(()=>checkLiveLogFrame({...frame,allocationId:null},device),/allocation identity/);
  assert.throws(()=>checkLiveLogFrame({...frame,dt:0},device),/duration/);
  assert.throws(()=>checkLiveLogFrame({...frame,transform:{translate:[0,0,NaN],scale:1}},device),/transform/);
});
async function fixture({fire}={}){
  const device={},model=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());model.add(mesh);
  let registry=[{id:'log-1',object:model}],consumer,active=false,paused=false,steps=0,burner=true,reset=0,disposed=0;
  const events=[],fields=[],canvas={style:{opacity:'.85'}};
  const runtime={canvasElement:()=>canvas,setSimulationPaused(value){paused=value;return {paused};},borrowThermalGpuContext:async()=>({device,dimensions:[48,48,48]}),
    bindGpuThermalConsumer(value){consumer=value;return ()=>{consumer=null;};},resetThermalExperimentFluid(){reset++;steps=0;return {simStepCount:0};},
    async setActive(value){active=value;},debugState:()=>({backend:'WebGPU:test',active,simStepCount:steps,simGrid:48})};
  const field=()=>{let ticks=0;const f={stateNode:THREE.TSL.vec4(0),encode(){ticks++;},reset(){ticks=0;},read:()=>({steps:ticks}),dispose(){disposed++;}};fields.push(f);return f;};
  const context={THREE,BURN_TABLE_ASSET,LIVE_LOG_HEAT_IDENTITY,crypto:globalThis.crypto,console,
    createLiveLogHeatGpu:async()=>field(),createBurnMaterial:()=>({material:new THREE.MeshStandardNodeMaterial(),update(){},read:()=>({}),dispose(){}})};
  vm.createContext(context);
  const source=fs.readFileSync(new URL('../live-log-experiment.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export async function','async function');
  vm.runInContext(source+'\nglobalThis.create=createLiveLogExperiment;',context);
  const experiment=await context.create({record:e=>events.push(e),host:{fire,scene:{ready:Promise.resolve(),renderer:()=>({backend:{device}}),load:async()=>model,objects:()=>registry,dirty(){},enterWorkbench(){},frame(){},select(){}},volume:{ready:Promise.resolve(),get:()=>runtime,burner(value){burner=value;}}}});
  return {experiment,events,canvas,read:()=>({active,paused,burner,reset,disposed,consumer}),remove:()=>{registry=[];},step(){steps++;consumer?.encode({}, {dt:1/60});}};
}
test('cold start, shared operation reset and removal do not advance or leave GPU work running',async()=>{
  const f=await fixture();assert.equal(f.experiment.read().status,'cold');assert.equal(f.read().paused,true);assert.equal(f.read().burner,false);
  assert.equal(f.experiment.read().fields[0].steps,0);const attempt=f.experiment.read().attempt;
  f.experiment.operations.run();f.step();assert.equal(f.experiment.read().fields[0].steps,1);
  f.experiment.operations.burnerOff();assert.equal(f.read().burner,false);assert.equal(f.read().paused,false);
  f.experiment.operations.move({position:[1,0,0]});assert.equal(f.experiment.read().fields[0].steps,1);
  f.experiment.operations.reset();assert.equal(f.experiment.read().status,'cold');assert.equal(f.experiment.read().fields[0].steps,0);assert.notEqual(f.experiment.read().attempt,attempt);
  f.experiment.operations.run();f.remove();f.step();assert.equal(f.read().paused,true);assert.equal(f.experiment.read().status,'unavailable');
  assert.equal(f.experiment.read().paused,f.read().paused,'reported pause must match the missing-log runtime pause');
  f.experiment.operations.burnerOff();assert.equal(f.read().burner,false);assert.equal(f.experiment.read().burner,false);
  assert.throws(()=>f.experiment.operations.run(),/removed/);f.experiment.dispose();f.experiment.dispose();assert.equal(f.read().disposed,1);assert.equal(f.read().active,false);
  assert.ok(f.events.some(e=>e.kind==='sinter.live-log.burner-off'&&e.phase==='applied'));
});
test('removing or replacing fire cannot abort log resource cleanup',async()=>{
  let reject=false,disposals=0;
  const fire={read:()=>({status:reject?'unavailable':'mounted',enabled:!reject,visible:true}),setEnabled(){if(reject)throw Error('Fire source registration changed');},dispose(){disposals++;}};
  const f=await fixture({fire});reject=true;
  await f.experiment.dispose();await f.experiment.dispose();
  assert.equal(f.read().active,false);assert.equal(f.read().disposed,1);assert.equal(disposals,1);
});
test('flame visibility changes only the presentation layer and restores its prior value on disposal',async()=>{
  const f=await fixture();assert.equal(f.canvas.style.opacity,'0');
  f.experiment.operations.run();f.step();const before=f.experiment.read();
  f.experiment.operations.flameView({visible:true});assert.equal(f.canvas.style.opacity,'1');
  assert.equal(f.experiment.read().fields[0].steps,before.fields[0].steps);assert.equal(f.read().paused,false);
  f.experiment.operations.flameView({visible:false});assert.equal(f.canvas.style.opacity,'0');
  assert.throws(()=>f.experiment.operations.flameView({visible:1}),/boolean/);
  f.experiment.dispose();assert.equal(f.canvas.style.opacity,'.85');
});
