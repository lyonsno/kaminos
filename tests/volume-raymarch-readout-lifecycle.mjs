// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {volumeSubmissionContext} from './helpers/volume-submission.mjs';
const source=fs.readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const frame=source.slice(source.indexOf('  function renderOrdinaryFrame('),source.indexOf('  function pumpLookLabFrozenFrame('));
const invalidate=source.match(/  function invalidateRaymarchReadouts\([^]*?\n  \}/)?.[0]||'function invalidateRaymarchReadouts() {}';
const prepare=source.match(/  function prepareRayStepCounters\([^]*?\n  \}/)?.[0];
test('releasing disabled counters refreshes fluid bindings before they can be submitted',()=>{
  let rebound=0;
  const context=vm.createContext({state:{width:8,height:8},controlsSnapshot:{rayStepTelemetry:false},debugOpticalStepping:{mode:'numerical'},
    rayStepTelemetry:{ensure:()=>true,read:()=>({active:false})},rebuildFluidBindGroups:()=>{rebound++;}});
  vm.runInContext(invalidate+'\ninvalidateRaymarchReadouts("inactive");',context);
  assert.equal(rebound,1,'a changed counter binding must replace every fluid bind group');
});

for(const route of ['residual','splats','proxy'])test('leaving ordinary beauty for '+route+' cannot display old live work or marcher identity',()=>{
  const noop=()=>{},state={active:true,frameCount:1,simStepCount:9,width:8,height:8,lookFreezeFrame:null,
    rayStepTelemetry:{requested:true,active:true},opticalStepping:{requested:'numerical',effective:'numerical'}};
  let receipt={...state.rayStepTelemetry},visible=true;
  const rayStepTelemetry={ensure(w,h,requested,options){const active=options.supported&&options.activate!==false;receipt={requested,active,reason:options.reason};visible=active;return false;},read:()=>receipt};
  const encoder={finish:()=>({})},context=vm.createContext({
    pendingDomainRemap:null,encodeDomainRemap:noop,
    state,rayStepTelemetry,debugOpticalStepping:{mode:'numerical',tolerance:.001},controlsSnapshot:{lookFreeze:1,density:1,fire:1,rayStepTelemetry:true},
    productFrameOwner:'prototype',selectiveHeadLiveCapturePaused:false,raf:0,controls:{update:noop},updateUniforms:()=>context.prepareRayStepCounters(),
    emissiveRaymarchAdmission:()=>({eligible:true}),debugRaymarchShaderSpecialization:'auto',rebuildFluidBindGroups:noop,
    performance:{now:()=>1},device:{createCommandEncoder:()=>encoder,queue:{submit:noop}},normalizeLookFreeze:()=>true,lookFreezeCanPin:()=>true,
    simulationPaused:true,liveCompleteFlameOpticalCoefficientsEnabled:false,prepareSharedSceneConsumers:e=>e,
    selectiveHeadLiveRoleGroups:()=>null,encodeBoundarySidecar:noop,encodeBoundarySplats:noop,
    context:{getCurrentTexture:()=>({createView:()=>({})})},boundarySplatRequested:()=>route==='splats',browserResidualCanApply:()=>route==='residual',
    updateSelectiveHeadLiveCompositionState:()=>({effective:'splat-only',definition:{splat:true,raymarch:false}}),
    encodeBoundarySplatPresentation:()=>true,optionalPipelines:{boundarySplatRenderPipeline:{},boundarySplatPresentationRenderPipeline:{}},
    recordSelectiveHeadLivePassReceipt:x=>x,recordVolumePresentationApplication:noop,recordBrowserResidualCost:noop,
    ensureFrameTexture:noop,ensureBrowserResidualFeatureTexture:noop,frameTexture:{createView:()=>({})},browserResidualFeatureTexture:{createView:()=>({})},
    encodeBrowserResidualSourcePass:noop,encodeBrowserResidualPass:()=>true,sceneTransportConsumer:null,canvasPresentationSuppressed:route==='proxy',
    appearanceDecompositionActive:()=>false,encodeBoundarySplatTelemetry:noop,boundarySplatTelemetryCopyPending:false,pressureResidualCopyPending:false,
    selectiveHeadLiveExactPause:null,recordVolumeFrameTiming:noop,requestAnimationFrame:()=>1,render:noop,cancelAnimationFrame:noop,
    canvas:{classList:{remove:noop}},surface:{setActive:noop},emitStatus:noop,
  });
  Object.assign(context,volumeSubmissionContext(context.device));
  vm.runInContext(invalidate+'\n'+prepare+'\n'+frame+'\nrenderOrdinaryFrame(1);',context);
  assert.equal(state.error,undefined,'the chosen branch must successfully submit');assert.equal(state.frameCount,2);
  assert.equal(state.rayStepTelemetry.active,false);assert.equal(visible,false);
  assert.equal(state.opticalStepping.effective,null);assert.equal(state.opticalStepping.requested,'numerical');
});

test('World readout follows this draw resolution rather than the invalidated prior frame',()=>{
 const block=source.match(/    if\(state.worldSmoke\?\.raymarch\)\{[^]*?\n    \}/)?.[0];
 assert.ok(block);
 for(const mode of ['current','numerical','budgeted','joins','history']){
  const state={worldSmoke:{raymarch:{}},opticalStepping:{effective:null}};
  vm.runInNewContext(block,{state,optical:{mode}});
  assert.equal(state.worldSmoke.raymarch.effectiveMode,mode);
  assert.equal(state.worldSmoke.raymarch.policy,mode==='current'?'shared-quality-material-cell-step':mode==='numerical'?'nested-quadrature-fine-step-scale':'fixed-count-whole-ray');
 }
 assert.ok(source.indexOf(block)>source.indexOf('    state.opticalStepping = { ...optical, effective: optical.mode,'),'receipt follows effective route resolution');
});

test('shared transport initializes, advances and invalidates actual spatial guidance before binding',async()=>{
 const {opticalSteppingConfig,resolveOpticalStepping,raymarchAdaptivity}=await import('../volume-optical-native.mjs');
 const {createRayAllocationHistory}=await import('../volume-history-allocation.mjs');
 globalThis.GPUBufferUsage??={STORAGE:128,COPY_DST:8,COPY_SRC:4,UNIFORM:64};
 const start=source.indexOf('  function renderSceneTransportHost('),body=source.slice(start,source.indexOf('\n  function ',start+3));
 const helperStart=source.indexOf('  function prepareFixedCountAllocation('),helper=helperStart<0?'':source.slice(helperStart,source.indexOf('\n  function ',helperStart+3));
 for(const mode of ['budgeted','joins','history']){
  const writes=[],device={limits:{maxBufferSize:1e8,maxStorageBufferBindingSize:1e8},createBuffer:d=>({...d,destroy(){}}),queue:{writeBuffer:(buffer,offset,data)=>writes.push({buffer,offset,bytes:data.byteLength})}},rayAllocationHistory=createRayAllocationHistory(device);
  const encoder={clearBuffer(){}},state={frameCount:1,simStepCount:2,renderScale:1,worldSmoke:{effective:'one-way-world-field',raymarch:{}}},uniforms=new Float32Array(512);uniforms[368]=2;let constants,rebuilds=0;
  const context=vm.createContext({state,uniforms,rayAllocationHistory,worldSmoke:{plan:{},anchor:{}},worldSmokeKey:'world',intermediateKey:null,
   worldSmokeMapping:(_p,_a,t)=>({renderMin:t.translate.map(v=>v-1),renderMax:t.translate.map(v=>v+1)}),
   sceneTransportConsumer:({encode})=>encode({encoder}),
   appearanceDecompositionActive:()=>false,boundarySplatRequested:()=>false,browserResidualCanApply:()=>false,
   camera:{isPerspectiveCamera:true,getWorldDirection:()=>({toArray:()=>[0,0,-1]})},THREE:{Vector3:class{}},updateOrdinarySceneDepth:()=>null,
   emissiveRaymarchAdmission:()=>({eligible:true}),debugRaymarchShaderSpecialization:'auto',debugOpticalStepping:opticalSteppingConfig({mode}),debugOpticalSteppingExplicit:false,
   resolveOpticalStepping,raymarchAdaptivity,controlsSnapshot:{adaptiveRays:.65},sceneTransportLightEncoders:{has:()=>true},WGSL:'',distributedGroup:null,emissiveLightField:null,scenePointBindGroup:null,
   sceneTransport:null,createSceneVolumeTransport:()=>({encode(input){constants=input.constants;assert.ok(rayAllocationHistory.read().geometry,'guidance geometry must exist when the actual transport binds');return {};}}),device,stateSource:null,bindGroupLayout:{},
   rebuildFluidBindGroups(){rebuilds++;},fluidBindGroup:()=>({}),productTransform:{translate:[0,0,0],scale:1},currentFluid:0});
  context.worldSmoke.plan.materialDims=[8,8,8];
  vm.runInContext(helper+'\n'+body+'\nrenderSceneTransportHost();',context);
  assert.equal(constants.OPTICAL_STEP_MODE,opticalSteppingConfig({mode}).value);assert.equal(state.sceneTransport.stepping,mode);
  const first=rayAllocationHistory.read();assert.equal(first.frames,1);assert.equal(first.historyFrames,0);assert.equal(writes.length,2);assert.equal(rebuilds,1);
  vm.runInContext('state.frameCount++;state.simStepCount++;renderSceneTransportHost();',context);
  const second=rayAllocationHistory.read();assert.equal(second.frames,2);assert.equal(second.historyFrames,1);assert.equal(second.previousOffset,first.observationsOffset);assert.equal(rebuilds,2);
  context.productTransform.translate=[1,0,0];vm.runInContext('state.frameCount++;renderSceneTransportHost();',context);
  const moved=rayAllocationHistory.read();assert.equal(moved.frames,1);assert.equal(moved.historyFrames,0);assert.deepEqual(moved.geometry.min,[0,-1,-1]);assert.equal(writes.length,4);assert.equal(rebuilds,3);
  rayAllocationHistory.dispose();
 }
});
