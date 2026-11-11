// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneFrameRuntime} from '../scene-frame-runtime.mjs';
function fixture(){
  let count=0,lastPlan=null,device={queue:{}},prepares=0,depthReads=0;
  const inputs={},plans=[],draws=[],camera={},texture={};
  const coordinator={read:()=>({lastPlan}),planFrame:input=>{plans.push(input);return lastPlan={...input,frame:plans.length};}};
  let runtime;
  runtime=createSceneFrameRuntime({readInputs:()=>inputs,draw:()=>{draws.push(runtime.composition.transportFrame);count++;},frameCount:()=>count,
    prepare:()=>prepares++,readDepth:()=>{depthReads++;return texture;},readSharedDevice:()=>device,readCamera:()=>camera,coordinator,
    readSimInputs:nowMs=>({flame:{active:true},water:{active:true,pending:true,backlogSeconds:.25},ash:{active:true,due:nowMs>10}}),
  });
  return {runtime,inputs,plans,draws,camera,texture,device,forgetDevice:()=>device=null,count:()=>count,prepares:()=>prepares,depthReads:()=>depthReads};
}
test('depth is rendered on the same device/camera, reused by ordinary rendering, and never fabricated across holds',()=>{
  const f=fixture();assert.equal(f.runtime.depth({held:true}),null);assert.equal(f.runtime.depth({enabled:false}),null);assert.equal(f.prepares(),0);
  f.inputs.radianceReady=false;assert.equal(f.runtime.depth(),null);assert.equal(f.depthReads(),0);
  f.inputs.radianceReady=true;assert.deepEqual(f.runtime.depth(),{device:f.device,camera:f.camera,texture:f.texture});
  assert.equal(f.runtime.renderOrdinary(),true);assert.equal(f.count(),1,'the depth prepass satisfies its ordinary frame');
  f.forgetDevice();assert.throws(()=>f.runtime.depth(),/shared-device-unavailable/);
});
test('transport frame stays synchronous through the actual depth/foreground composition',()=>{
  const f=fixture();f.inputs.transportRequired=true;f.runtime.setForegroundServiceActive(true);
  const frame={renderHost(){return f.runtime.runForegroundFrame(()=>{assert.equal(f.runtime.depth()?.texture,f.texture);return {status:'submitted'};});}};
  const result=f.runtime.consumeTransport(frame);assert.equal(result.sceneDrawn,true);assert.equal(result.sceneFrameCount,1);
  assert.deepEqual(f.draws,[frame]);assert.equal(f.runtime.composition.transportFrame,null);
  assert.throws(()=>f.runtime.consumeTransport({renderHost(){throw Error('transport failed');}}),/transport failed/);
  assert.equal(f.runtime.composition.transportFrame,null);
});
test('shared simulation plan preserves original per-scene-frame and close-timestamp reuse',()=>{
  const f=fixture(),first=f.runtime.planFrame(10);
  assert.equal(f.runtime.planFrame(100),first);assert.equal(f.plans.length,1);
  f.runtime.render();assert.equal(f.runtime.planFrame(10.5),first);assert.equal(f.plans.length,1);
  const next=f.runtime.planFrame(20);assert.notEqual(next,first);assert.equal(f.plans.length,2);
  assert.deepEqual(f.plans[1],{nowMs:20,flame:{active:true},water:{active:true,pending:true,backlogSeconds:.25},ash:{active:true,due:true}});
});
