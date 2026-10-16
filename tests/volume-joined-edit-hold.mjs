// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {joinedBoundaryUniformValues,resolveJoinedBoundary,resolveImmersedSourceConfig,resolvePressureSolverConfig} from '../volume-core.js';
import {fireCollisionEdit} from '../scene-collider.mjs';
import {resolveJoinedExteriorGeometry,createJoinedExterior} from '../volume-joined-exterior.mjs';
const source=readFileSync(process.env.KAMINOS_EDIT_SOURCE||new URL('../volume-core.js',import.meta.url),'utf8');
const body=name=>{const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);return source.slice(start,source.indexOf('\n  }',start)+4);};

function fixture(){
 const calls={fine:0,outer:0,pressure:0,prepare:0,seed:0,render:0}, queued=[];
 const geometry={dims:[4,8,4],originFine:[-2,-2,-2],cellWidthFine:2,finePitchLocal:.5};
 const ctx={state:{simStepCount:7,joinedBoundary:{admitted:true},joinedGhosts:{bound:true,generation:7},joinedEditing:{held:true,pending:false}},
  currentFluid:0,currentFront:0,currentQuench:0,gridSize:4,gridHeight:8,preparingJoinedExterior:false,
  gpuThermalConsumer:null,encodeGpuThermalConsumer(){},
  joinedGhostSynthetic:null,joinedGhostGeometry:geometry,controlsSnapshot:{},computePipeline:{},transportPredictBindGroup:{},
  queueMicrotask:fn=>queued.push(fn),refreshSceneCollision(){},joinedEditingHeld(){return ctx.state.joinedEditing.held;},
  joinedProducerSnapshot:()=>({}),resolveTransportConfig:()=>({effective:{predictorPass:false}}),ensureTransportPredictorBuffer(){},
  fluidBindGroup:()=>({}),encodeAnalyticEmitterInjection(){},updateSimCostLedger(){},
  encodePressureProjection(){calls.pressure++;return false;},syncJoinedRender(){calls.render++;},applyJoinedGhostGeometry(){throw Error('unexpected allocation');},
  joinedExterior:{paused:false,matches:()=>false,ghosts:geometry,
   step(){calls.outer++;return {stepped:true};},receipt:()=>({admitted:true}),
   prepare(){calls.prepare++;return {admitted:true};},seedGhosts(){calls.seed++;return true;}},
  encoder:{beginComputePass(){calls.fine++;return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};}}
 };
 vm.createContext(ctx);vm.runInContext(body('prepareJoinedExterior')+'\n'+body('encodeSim'),ctx);
 return {ctx,calls,queued,step:()=>vm.runInContext('encodeSim(encoder)',ctx),prepare:()=>vm.runInContext('prepareJoinedExterior()',ctx)};
}
test('actual fine dispatch advances standalone through a hold without touching shared pressure or stale ghosts',()=>{
 const {ctx,calls,queued,step,prepare}=fixture();
 ctx.state.joinedGhosts.generation=-1;
 step();step();prepare();
 assert.equal(calls.fine,2);assert.equal(calls.pressure,2);assert.equal(ctx.state.simStepCount,9);
 assert.equal(calls.outer,0);assert.equal(calls.prepare,0);assert.equal(calls.seed,0);assert.equal(queued.length,0);
});
test('placement waits for a current exterior snapshot before either predictor advances',()=>{
 const {ctx,calls,queued,step}=fixture();ctx.state.joinedEditing={held:false,pending:true};
 step();assert.equal(calls.fine,0);assert.equal(calls.outer,0);assert.equal(queued.length,1);
 queued.shift()();assert.equal(calls.prepare,1);assert.equal(calls.seed,1);assert.equal(ctx.state.joinedEditing.pending,false);
 assert.equal(ctx.state.joinedGhosts.generation,7);
 ctx.joinedExterior.matches=()=>true;step();assert.equal(calls.fine,1);assert.equal(calls.outer,1);assert.equal(calls.pressure,0);
 assert.equal(ctx.state.joinedGhosts.generation,8);
});
test('late queued preparation cannot rebuild into a newly started drag; refusal restores standalone fine',()=>{
 const {ctx,calls,queued,step,prepare}=fixture();ctx.state.joinedEditing={held:false,pending:true};step();
 ctx.state.joinedEditing.held=true;queued.shift()();assert.equal(calls.prepare,0);
 ctx.state.joinedEditing.held=false;ctx.joinedExterior.prepare=()=>({admitted:false,reason:'unsupported-layout'});
 ctx.refreshJoinedBoundary=()=>{ctx.state.joinedBoundary={requested:true,admitted:false,reason:'unsupported-layout'};};
 prepare();assert.equal(ctx.state.joinedEditing.pending,false);assert.equal(ctx.state.joinedEditing.reason,'unsupported-layout');
 step();assert.equal(calls.fine,1);assert.equal(calls.pressure,1);assert.equal(calls.outer,0);
});
test('resident mask update completes before predictor without skipping the fine step',()=>{
 const {ctx,calls,queued,step}=fixture();ctx.state.joinedEditing={held:false,pending:false};
 ctx.joinedExterior.canUpdateSolids=()=>true;
 step();assert.equal(calls.prepare,1);assert.equal(calls.fine,1);assert.equal(calls.outer,1);assert.equal(queued.length,0);
});
test('a changed producer retries a refused adapter before advancing either predictor',()=>{
 const {ctx,calls,queued,step}=fixture();ctx.state.joinedBoundary={requested:true,admitted:false};
 ctx.state.joinedEditing={held:false,pending:false};let changed=false;
 ctx.joinedExterior.retryAvailable=()=>changed;
 ctx.refreshJoinedBoundary=()=>{ctx.state.joinedBoundary.admitted=true;};
 step();assert.equal(calls.fine,1);assert.equal(queued.length,0);
 changed=true;step();assert.equal(calls.fine,1);assert.equal(queued.length,1);
 queued.shift()();assert.equal(calls.prepare,1);assert.equal(calls.seed,1);
 ctx.joinedExterior.matches=()=>true;step();assert.equal(calls.outer,1);
});
test('a stale live exterior snapshot prevents both predictors and queues reseeding',()=>{
 const {ctx,calls,queued,step}=fixture();ctx.state.joinedEditing={held:false,pending:false};
 ctx.joinedExterior.matches=()=>true;ctx.state.joinedGhosts.generation=6;
 step();assert.equal(calls.fine,0);assert.equal(calls.outer,0);assert.equal(calls.pressure,0);
 assert.equal(ctx.state.joinedGhosts.reason,'stale-ghost-generation');assert.equal(queued.length,1);
 queued.shift()();assert.equal(ctx.state.joinedGhosts.generation,7);step();assert.equal(calls.fine,1);
});

test('real exterior refusal survives fallback collision restoration, then an independent repair rejoins',()=>{
 const {ctx,calls,queued,step,prepare}=fixture();
 globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4,UNIFORM:8};
 globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_DST:4};
 globalThis.GPUShaderStage={COMPUTE:1};
 const resource=o=>({...o,destroy(){},createView(){return {};}});
 const pass=()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}});
 ctx.device={limits:{maxTextureDimension3D:2048,maxBufferSize:2**30,maxStorageBufferBindingSize:2**30,maxComputeWorkgroupsPerDimension:65535},
  queue:{writeBuffer(){},writeTexture(){},submit(){}},createBuffer:resource,
  createTexture:o=>resource({...o,width:o.size[0],height:o.size[1],depthOrArrayLayers:o.size[2]}),
  createShaderModule:o=>o,createBindGroupLayout:o=>o,createPipelineLayout:o=>o,createBindGroup:o=>o,
  createComputePipeline:o=>({...o,getBindGroupLayout:()=>({})}),
  createCommandEncoder:()=>({beginComputePass:pass,finish:()=>({})})};
 const wall={side:'+x',gap:1000};
 const adapter=createJoinedExterior(ctx.device,{coarseResolution:4,residentSolids:true,wall});
 ctx.joinedExterior=adapter;ctx.gridHeight=4;
 ctx.encoder.clearBuffer=()=>{};ctx.encoder.copyBufferToBuffer=()=>{};
 ctx.state.joinedBoundary={requested:true,admitted:true};
 ctx.state.joinedEditing={held:false,pending:false};
 ctx.controlsSnapshot={pressureSolver:'converged-open-top',projection:1,emitterSourceLaw:'immersed-source',immersedSourceEnabled:true};
 Object.assign(ctx,{resolveJoinedBoundary,resolveImmersedSourceConfig,resolvePressureSolverConfig,getSceneEditing:()=>null});
 let allocation=1,mask={revision:'authored-cube',cells:new Uint8Array(64)},rebuilds=0;
 ctx.joinedProducerSnapshot=()=>({dims:[4,4,4],pitch:.5,allocation,fluidBuffers:[{},{}],fluidBuffer:{size:4096,usage:1},fluidReadIndex:0,timeStep:{dtScale:1,backtraceScale:1},
  lowerFaceTexture:{width:4,height:4,depthOrArrayLayers:3,dimension:'2d',format:'r32float',usage:3,mipLevelCount:1,sampleCount:1,createView:()=>({})},
  burnRateTexture:resource({dimension:'3d',format:'r32float',usage:1,width:4,height:4,depthOrArrayLayers:4}),solidMask:mask,ghosts:{textures:Object.fromEntries(['a','b'].map(k=>[k,resource({dimension:'3d',format:'rgba32float',usage:1,width:5,height:9,depthOrArrayLayers:5})]))}});
 // The real rebuild destroys the collision producer; the next collision refresh
 // reconstructs the same authored mask. Exercise those transitions, not just
 // adapter.deferRetry in isolation.
 ctx.rebuildFluidState=()=>{rebuilds++;allocation++;mask=null;};
 ctx.refreshSceneCollision=()=>{mask={revision:'authored-cube',cells:new Uint8Array(64)};};
 ctx.applyJoinedGhostGeometry=g=>{ctx.joinedGhostGeometry=g;ctx.rebuildFluidState();};
 vm.runInContext(body('refreshJoinedBoundary'),ctx);
 assert.equal(prepare().reason,'wall-outside-exterior');
 for(let i=0;i<4;i++){step();while(queued.length)queued.shift()();}
 assert.equal(rebuilds,1,'restoring the fallback mask must not readmit and rebuild each frame');
 assert.equal(calls.fine,4,'fine flame must continue while optional exterior is refused');
 assert.equal(ctx.state.joinedBoundary.admitted,false);
 // A distinct allocation with a repaired wall must still readmit, prepare and
 // seed the actual exterior before the next joined predictor.
 wall.gap=0;allocation++;step();assert.equal(queued.length,1);
 queued.shift()();assert.equal(ctx.state.joinedBoundary.admitted,true);
 assert.equal(ctx.state.joinedEditing.pending,false);
 assert.equal(ctx.state.joinedGhosts.generation,ctx.state.simStepCount);
 step();while(queued.length)queued.shift()();step();
 assert(adapter.receipt().steps>0,'repaired exterior must advance');
 adapter.destroy();
});
test('resident mesh dragging is live while domain and source edits retain their hold',()=>{
 const {ctx}=fixture();ctx.joinedExterior.residentSolids=true;ctx.state.joinedEditing={held:false,pending:false};
 let id='cube';ctx.getSceneEditing=()=>({id});vm.runInContext(body('joinedEditingHeld'),ctx);
 assert.equal(vm.runInContext('joinedEditingHeld()',ctx),false);
 id='@flame-domain';assert.equal(vm.runInContext('joinedEditingHeld()',ctx),true);
 id='flame-emitter';assert.equal(vm.runInContext('joinedEditingHeld()',ctx),true);
});
test('grouped source previews hold and settle, collider-only groups stay live',()=>{
 const {ctx,calls,prepare}=fixture();ctx.joinedExterior.residentSolids=true;ctx.state.joinedBoundary.requested=true;
 const records=[{id:'cube',type:'procedural-mesh',collision:{enabled:true}},{id:'flame-emitter',type:'flame-emitter'}];
 const groups=[{id:'burner',objectIds:['cube','flame-emitter']},{id:'obstacles',objectIds:['cube']}];
 let edit;ctx.getSceneEditing=()=>edit;vm.runInContext(body('joinedEditingHeld'),ctx);
 for(const id of ['@group:burner','@assembly:burner']){
  edit=fireCollisionEdit({id},records,groups);assert.equal(vm.runInContext('joinedEditingHeld()',ctx),true);
  prepare();assert.equal(calls.prepare,0);edit=null;
  assert.equal(vm.runInContext('joinedEditingHeld()',ctx),false);assert.equal(ctx.state.joinedEditing.pending,true);
  prepare();assert.equal(ctx.state.joinedEditing.pending,false);calls.prepare=0;
 }
 edit=fireCollisionEdit({id:'@group:obstacles'},records,groups);
 assert.equal(vm.runInContext('joinedEditingHeld()',ctx),false);
});
test('diagnostic readback pause still prevents fine stepping during a drag',()=>{
 const {ctx,calls,step}=fixture();ctx.joinedExterior.paused=true;step();assert.equal(calls.fine,0);
});
test('outside placement settles to standalone dispatch without preparing a rejected exterior',()=>{
 const {ctx,calls,step,prepare,queued}=fixture();
 ctx.state.joinedBoundary.deferredAdmission={admitted:false};
 ctx.state.joinedEditing={held:false,pending:true};
 ctx.getSceneEditing=()=>null;
 ctx.refreshJoinedBoundary=()=>{ctx.state.joinedBoundary={requested:true,admitted:false,reason:'source-disabled'};};
 vm.runInContext(body('joinedEditingHeld'),ctx);
 ctx.joinedExterior.prepare=()=>{throw Error('standalone lower-face placeholder cannot prepare exterior');};
 prepare();assert.equal(ctx.state.joinedEditing.pending,false);
 step();step();prepare();
 vm.runInContext('joinedEditingHeld()',ctx);assert.equal(ctx.state.joinedEditing.fine,'standalone');
 assert.equal(calls.fine,2);assert.equal(calls.pressure,2);assert.equal(ctx.state.simStepCount,9);
 assert.equal(calls.outer,0);assert.equal(queued.length,0);
 // Re-admission must still wait for a current allocation, not reuse held ghosts.
 ctx.state.joinedBoundary={admitted:true};step();assert.equal(calls.fine,2);assert.equal(queued.length,1);
});
test('actual uniform write disables joined boundary and ghost reads, without revoking visible admission',()=>{
 const statement=source.split('\n').find(line=>line.includes('uniforms.set(joinedBoundaryUniformValues('));assert(statement);
 const ctx={state:{joinedBoundary:{admitted:true},joinedGhosts:{bound:true,generation:7},joinedEditing:{held:true}},joinedGhostGeometry:{originFine:[1,2,3],dims:[4,8,4],cellWidthFine:2,finePitchLocal:.5},joinedBoundaryUniformValues,JOINED_BOUNDARY_UNIFORM_OFFSET:0,uniforms:new Float32Array(12)};
 vm.createContext(ctx);vm.runInContext(statement,ctx);assert.deepEqual([...ctx.uniforms.slice(0,2)],[0,0]);assert.equal(ctx.state.joinedBoundary.admitted,true);
 ctx.state.joinedEditing.held=false;vm.runInContext(statement,ctx);assert.deepEqual([...ctx.uniforms.slice(0,2)],[1,1]);
});
test('edit adapter selects collision objects, grouped transforms, domain and source, not cameras or unmarked meshes',()=>{
 const records=[{id:'cube',type:'procedural-mesh',collision:{enabled:true}},{id:'decor',type:'glb'},{id:'camera',type:'camera'},{id:'light',type:'light'}];
 const groups=[{id:'group',objectIds:['decor','cube']},{id:'lights',objectIds:['light']}];
 for(const id of ['cube','@mesh-data:cube','@object-collision:decor','@group:group','@assembly:group'])assert.deepEqual(fireCollisionEdit({id},records,groups),{id});
 for(const id of ['@flame-domain','flame-emitter','@burner-controls'])assert.deepEqual(fireCollisionEdit({id},records,groups),{id,affectsSource:true});
 for(const id of ['camera','@viewport-lens','@mesh-data:light','decor','@group:lights'])assert.equal(fireCollisionEdit({id},records,groups),null);
 assert.equal(fireCollisionEdit(null,records),null);
 assert.deepEqual(fireCollisionEdit({id:'@selection-transform',before:{roots:{'@group:group':{}}}},records,groups),{id:'@selection-transform'});
});

test('emitter inside/outside/inside previews defer admission rebuild without claiming the source remains admitted',()=>{
 let rebuilds=0,editing=true;
 const ctx={state:{joinedBoundary:{requested:true,admitted:true}},joinedExterior:{},device:{},gridSize:32,gridHeight:64,
  controlsSnapshot:{pressureSolver:'converged-open-top',projection:1,emitterSourceLaw:'immersed-source',immersedSourceEnabled:true},
  getSceneEditing:()=>editing?{id:'flame-emitter'}:null,
  resolveJoinedBoundary,resolveImmersedSourceConfig,resolvePressureSolverConfig,rebuildFluidState(){rebuilds++;}};
 vm.createContext(ctx);vm.runInContext(body('refreshJoinedBoundary')+'\n'+body('joinedEditingHeld'),ctx);
 const refresh=()=>vm.runInContext('refreshJoinedBoundary(); joinedEditingHeld()',ctx);
 refresh();ctx.controlsSnapshot.immersedSourceEnabled=false;ctx.controlsSnapshot.immersedCentreX=2;refresh();
 assert.equal(rebuilds,0,'source outside the box must not destroy committed collision during the drag');
 assert.equal(ctx.state.joinedEditing.held,true);assert.equal(ctx.state.joinedBoundary.deferredAdmission.admitted,false);
 ctx.controlsSnapshot.immersedSourceEnabled=true;ctx.controlsSnapshot.immersedCentreX=0;refresh();
 editing=false;refresh();assert.equal(rebuilds,0,'cancel/return inside needs no admission allocation');
 editing=true;ctx.controlsSnapshot.immersedSourceEnabled=false;refresh();editing=false;refresh();
 assert.equal(rebuilds,1,'final outside placement reconciles admission once');assert.equal(ctx.state.joinedBoundary.admitted,false);
});

test('outside-source preview keeps the allocated reactant sidecar instead of replacing it with placeholders',()=>{
 const ctx={device:{createTexture(){throw Error('preview must not allocate');}},reactantSidecarFull:true,reactantTextures:[{destroy(){throw Error('preview must not destroy');}},{destroy(){throw Error('preview must not destroy');}}],joinedExterior:{},getSceneEditing:()=>({id:'flame-emitter'})};
 vm.createContext(ctx);vm.runInContext(body('ensureReactantSidecar'),ctx);
 assert.equal(vm.runInContext('ensureReactantSidecar(false)',ctx),false);assert.equal(ctx.reactantSidecarFull,true);
});

test('new drag from settled outside defers readmission until placement and cancellation stays standalone',()=>{
 let rebuilds=0,editing=false;
 const ctx={state:{joinedBoundary:{requested:true,admitted:false},joinedEditing:{held:false,pending:false}},joinedExterior:{},device:{},gridSize:32,gridHeight:64,
  controlsSnapshot:{pressureSolver:'converged-open-top',projection:1,emitterSourceLaw:'immersed-source',immersedSourceEnabled:false},
  getSceneEditing:()=>editing?{id:'flame-emitter'}:null,
  resolveJoinedBoundary,resolveImmersedSourceConfig,resolvePressureSolverConfig,rebuildFluidState(){rebuilds++;}};
 vm.createContext(ctx);vm.runInContext(body('refreshJoinedBoundary')+'\n'+body('joinedEditingHeld'),ctx);
 const refresh=()=>vm.runInContext('refreshJoinedBoundary(); joinedEditingHeld()',ctx);
 editing=true;refresh();assert.equal(ctx.state.joinedEditing.held,true);
 ctx.controlsSnapshot.immersedSourceEnabled=true;refresh();assert.equal(rebuilds,0);assert.equal(ctx.state.joinedBoundary.admitted,false);
 assert.equal(ctx.state.joinedBoundary.deferredAdmission.admitted,true);
 ctx.controlsSnapshot.immersedSourceEnabled=false;refresh();editing=false;refresh();assert.equal(rebuilds,0);
 editing=true;ctx.controlsSnapshot.immersedSourceEnabled=true;refresh();assert.equal(rebuilds,0);
 editing=false;refresh();assert.equal(rebuilds,1);assert.equal(ctx.state.joinedBoundary.admitted,true);
});
test('unsupported exterior keeps the fine grid and request, then readmits a supported configuration',()=>{
 let rebuilds=0;
 const ctx={state:{joinedBoundary:{requested:true,admitted:false}},device:{},gridSize:32,gridHeight:48,
  controlsSnapshot:{pressureSolver:'converged-open-top',projection:1,emitterSourceLaw:'immersed-source',immersedSourceEnabled:true},
  getSceneEditing:()=>null,resolveJoinedBoundary,resolveImmersedSourceConfig,resolvePressureSolverConfig,
  joinedExterior:{admission:p=>resolveJoinedExteriorGeometry({fineDims:p.dims,pitch:p.pitch,coarseResolution:32,size:2})},
  rebuildFluidState(){rebuilds++;}};
 ctx.joinedProducerSnapshot=()=>({dims:[ctx.gridSize,ctx.gridHeight,ctx.gridSize],pitch:2/ctx.gridSize});
 vm.createContext(ctx);vm.runInContext(body('refreshJoinedBoundary'),ctx);
 vm.runInContext('refreshJoinedBoundary()',ctx);
 assert.equal(ctx.state.joinedBoundary.requested,true);assert.equal(ctx.state.joinedBoundary.admitted,false);
 assert.equal(ctx.state.joinedBoundary.effective,'standalone-fine');assert.match(ctx.state.joinedBoundary.reason,/exterior:/);
 assert.equal(rebuilds,0);assert.equal(ctx.gridHeight,48,'adapter must not replace the selected fine grid');
 ctx.gridHeight=64;vm.runInContext('refreshJoinedBoundary()',ctx);
 assert.equal(ctx.state.joinedBoundary.admitted,true);assert.equal(rebuilds,1);
});
