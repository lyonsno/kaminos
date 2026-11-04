// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {authoredMlsSetup} from '../authored-mls-water.mjs';
import * as contract from '../mls-juice-contract.mjs';
import {createMlsJuiceSolver} from '../mls-juice-solver.mjs';
import {createMlsJuiceRenderer} from '../mls-juice-renderer.mjs';
import {Group} from '../lib/three.core.js';
import {createAshSceneObject} from '../ash/scene-object.mjs';
import {defaultAshSettings,ASH_OBJECT_TYPE,ASH_OBJECT_SOURCE} from '../ash/scene-record.mjs';

globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,MAP_READ:16};
globalThis.GPUTextureUsage={RENDER_ATTACHMENT:1,TEXTURE_BINDING:2};
globalThis.GPUMapMode={READ:1};

const savedFetch=globalThis.fetch;
globalThis.fetch=async url=>({ok:true,text:()=>fs.readFile(url,'utf8')});

try {
  // 1. Authored MLS solver must cap per-batch catch-up substeps and bound maximum
  // backlog after a 1-second stall so a single command buffer never encodes 240 substeps,
  // while preserving brief frame-time jitter in its temporary backlog buffer without drops.
  const emitterRecord={
    id:'water-emitter',
    label:'Water Emitter',
    type:'local-liquid-emitter',
    transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},
    localLiquidEmitter:{schema:'kaminos.local-liquid-emitter.v1',mode:'continuous',rate:240,baseRadius:.05,strength:1},
  };
  const setup=authoredMlsSetup([emitterRecord],{particleCount:64});
  let now=0;
  const computePasses=[];
  const device={
    limits:{maxStorageBufferBindingSize:1024**3,maxBufferSize:1024**3,maxComputeWorkgroupsPerDimension:65535},
    createBuffer:({size})=>({getMappedRange:()=>new ArrayBuffer(size),mapAsync:async()=>{},unmap(){},destroy(){}}),
    createTexture:()=>({createView:()=>({}),destroy(){}}),
    createSampler:()=>({}),
    createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
    createComputePipelineAsync:async({label})=>({label,getBindGroupLayout:()=>({})}),
    createRenderPipelineAsync:async({label})=>({label,getBindGroupLayout:()=>({})}),
    createBindGroup:()=>({}),
    createCommandEncoder:()=>({
      clearBuffer(){},
      copyBufferToBuffer(){},
      beginComputePass:()=>({
        setPipeline(p){computePasses.push(p?.label??'compute');},
        setBindGroup(){},
        dispatchWorkgroups(){},
        end(){},
      }),
      finish:()=>({}),
    }),
    queue:{writeBuffer(){},submit(){},onSubmittedWorkDone:async()=>{}},
  };

  const solver=await createMlsJuiceSolver({
    device,
    setup:{...setup.solver,trackPopulation:false},
    packet:{authority:{simulation_safe:false},emitters:[]},
    now:()=>now,
  });

  // Initial observation at t=0
  assert.equal(solver.advance(now=0),false);

  // Brief compute variance: a 66.7ms frame (16 steps at 240Hz) followed by a 16.7ms frame (4 steps).
  // Frame 1 executes at most maxSubstepsPerBatch (12 steps) and buffers the remaining 4 steps;
  // Frame 2 executes 4 new + 4 buffered = 8 steps, losing zero steps.
  assert.equal(solver.advance(now=66.7),true);
  await new Promise(resolve=>setImmediate(resolve));
  const afterJitterFrame1=solver.read();
  assert.equal(afterJitterFrame1.cadence.lastBatchSteps,12,'A 66.7ms hitch must cap per-frame MLS batch execution to 12 substeps');
  assert.equal(afterJitterFrame1.clock.droppedSteps,0,'Brief 66.7ms frame variance must be buffered in backlog without dropping steps');
  assert(Math.abs(afterJitterFrame1.clock.backlogSeconds-4/240)<1e-3,'Remaining 4 substeps must stay buffered for the next frame');

  assert.equal(solver.advance(now=83.4),true);
  await new Promise(resolve=>setImmediate(resolve));
  const afterJitterFrame2=solver.read();
  assert.equal(afterJitterFrame2.clock.step,20,'Buffered jitter steps must drain cleanly on the following 16.7ms frame');
  assert.equal(afterJitterFrame2.clock.droppedSteps,0);

  // Severe stall: 1,000ms wall-clock stall (240 steps of wall time).
  // Must cap backlog to maxBacklogSeconds (24 steps = 0.1s) and execute only 12 steps this frame.
  assert.equal(solver.advance(now=1083.4),true);
  await new Promise(resolve=>setImmediate(resolve));
  const afterStall=solver.read();
  assert.equal(afterStall.cadence.lastBatchSteps,12,'A 1-second stall must not encode 240 substeps into one command buffer');
  assert(afterStall.clock.backlogSeconds<=12/240+1e-6,'Post-batch backlog after a 1-second stall must remain bounded');
  assert.equal(afterStall.clock.droppedSteps,216,'Excess stall backlog beyond the 24-step jitter buffer must be explicitly shed and counted');

  // 2. Surface renderer must reuse smoothed front-depth and thickness textures when
  // solver step and camera pose are unchanged (e.g. while a batch is pending or deferred).
  const renderPasses=[];
  const renderEncoder={
    beginRenderPass:desc=>{
      renderPasses.push(desc);
      return {setPipeline(){},setBindGroup(){},draw(){},end(){}};
    },
  };
  const hostCamera={
    far:100,
    matrixWorldInverse:{elements:new Float32Array(16).fill(1)},
    projectionMatrix:{elements:new Float32Array(16).fill(2)},
    projectionMatrixInverse:{elements:new Float32Array(16).fill(3)},
    matrixWorld:{elements:new Float32Array(16).fill(4)},
    updateMatrixWorld(){},
  };
  const surface=await createMlsJuiceRenderer({device,solver,hostEnvironment:true});
  surface.encode({
    encoder:renderEncoder,
    hostCamera,
    environment:{},
    sceneColor:{},
    sceneDepth:{},
    target:{},
    width:200,
    height:100,
  });
  assert.equal(renderPasses.length,5,'First surface encode at a new solver step must run front, thickness, 2 bilateral smooth passes, and compose');

  renderPasses.length=0;
  surface.encode({
    encoder:renderEncoder,
    hostCamera,
    environment:{},
    sceneColor:{},
    sceneDepth:{},
    target:{},
    width:200,
    height:100,
  });
  assert.equal(renderPasses.length,1,'Unchanged solver step and camera pose must reuse smoothed depth/thickness and run only scene refraction compose');
  assert.equal(surface.read().cachedSurfacePassesReused,1);

  // Camera movement must invalidate the cached surface depth/thickness even at the same solver step.
  hostCamera.matrixWorldInverse.elements[0]=9;
  renderPasses.length=0;
  surface.encode({
    encoder:renderEncoder,
    hostCamera,
    environment:{},
    sceneColor:{},
    sceneDepth:{},
    target:{},
    width:200,
    height:100,
  });
  assert.equal(renderPasses.length,5,'Camera movement must refresh particle front-depth, thickness, and bilateral smoothing');

  // 3. Multi-simulator frame coordinator must throttle per-frame water substep duties
  // and alternate secondary simulators evenly when Flame + Water + Ash contend over budget.
  assert.equal(typeof contract.createSimFrameCoordinator,'function','Multi-simulator frame coordinator must be exported');
  const coordinator=contract.createSimFrameCoordinator({targetFrameMs:16.67,waterBaseMaxSubsteps:12,waterContendedMaxSubsteps:6});
  const planNormal=coordinator.planFrame({
    nowMs:16,
    flame:{active:true},
    water:{active:true,pending:false,backlogSeconds:8/240},
    ash:{active:true,due:true,lagMs:33.3},
  });
  assert.equal(planNormal.water.advance,true);
  assert.equal(planNormal.water.maxSteps,12,'Uncontended frame within budget allows full 12-substep water catch-up');
  assert.equal(planNormal.ash.advance,true);

  // Next frame arrives 28ms later (over the 16.67ms budget) with all three sims active and due:
  // Coordinator must throttle water's per-frame batch cap to waterContendedMaxSubsteps (6)
  // and alternate secondary simulator priority across consecutive overloaded frames so neither starves.
  const planContended1=coordinator.planFrame({
    nowMs:44,
    flame:{active:true},
    water:{active:true,pending:false,backlogSeconds:8/240},
    ash:{active:true,due:true,lagMs:34},
  });
  const planContended2=coordinator.planFrame({
    nowMs:72,
    flame:{active:true},
    water:{active:true,pending:false,backlogSeconds:8/240},
    ash:{active:true,due:true,lagMs:34},
  });
  assert.equal(planContended1.contended,true);
  assert.equal(planContended2.contended,true);
  assert.notEqual(
    planContended1.water.advance && !planContended1.ash.advance,
    planContended2.water.advance && !planContended2.ash.advance,
    'Overloaded multi-sim frames must alternate secondary simulator duties rather than starving one or running both unchecked',
  );
  const waterAdmitted=planContended1.water.advance?planContended1.water:planContended2.water;
  assert.equal(waterAdmitted.maxSteps,6,'Contended multi-sim frame must tighten water substep duty to keep frame time steady');

  // 4. Ash scene object must preserve its 30Hz due state when deferred on a contended frame
  // (`advance: false`), then step on the following admitted frame without losing its cadence.
  let ashSteps=0;
  const ashObject=await createAshSceneObject({
    record:{id:'ash-1',label:'Ash',type:ASH_OBJECT_TYPE,source:ASH_OBJECT_SOURCE,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},ash:{...defaultAshSettings(),initialDepth:0}},
    renderer:null,
    readObjects:()=>[],
    createPatch:async()=>({
      root:new Group(),
      syncScene(){},
      setSliding(){},
      setSoftNormals(){},
      step(){ashSteps++;},
      read:()=>({}),
      dispose(){},
    }),
  });
  await ashObject.initialize();
  assert.equal(ashObject.due(100,{active:true}),true);
  assert.equal(ashObject.tick(100,{active:true,advance:true}),true);
  assert.equal(ashSteps,1);
  assert.equal(ashObject.due(120,{active:true}),false,'Ash is not yet due 20ms after a 30Hz step');
  assert.equal(ashObject.due(134,{active:true}),true,'Ash becomes due once 33.3ms have elapsed');
  assert.equal(ashObject.tick(134,{active:true,advance:false}),false,'Contended frame deferral must skip the step without resetting lastTick');
  assert.equal(ashSteps,1);
  assert.equal(ashObject.due(150,{active:true}),true,'Deferred Ash step must remain due on the next frame');
  assert.equal(ashObject.tick(150,{active:true,advance:true}),true,'Admitted frame must execute the deferred Ash step');
  assert.equal(ashSteps,2);
  ashObject.dispose();

  surface.dispose();
  solver.dispose();
} finally {
  globalThis.fetch=savedFetch;
}
console.log('MLS bounded catch-up, surface reuse, and multi-sim frame coordinator OK');
