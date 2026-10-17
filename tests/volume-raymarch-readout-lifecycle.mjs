// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
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
    state,rayStepTelemetry,debugOpticalStepping:{mode:'numerical',tolerance:.001},controlsSnapshot:{lookFreeze:1,density:1,fire:1,rayStepTelemetry:true},
    productFrameOwner:'prototype',selectiveHeadLiveCapturePaused:false,raf:0,controls:{update:noop},updateUniforms:()=>context.prepareRayStepCounters(),
    emissiveRaymarchAdmission:()=>({eligible:true}),debugRaymarchShaderSpecialization:'auto',rebuildFluidBindGroups:noop,
    performance:{now:()=>1},device:{createCommandEncoder:()=>encoder,queue:{submit:noop}},normalizeLookFreeze:()=>true,lookFreezeCanPin:()=>true,
    simulationPaused:true,liveCompleteFlameOpticalCoefficientsEnabled:false,prepareSharedSceneConsumers:e=>e,
    selectiveHeadLiveRoleGroups:()=>null,encodeBoundarySidecar:noop,encodeBoundarySplats:noop,
    context:{getCurrentTexture:()=>({createView:()=>({})})},boundarySplatRequested:()=>route==='splats',browserResidualCanApply:()=>route==='residual',
    updateSelectiveHeadLiveCompositionState:()=>({effective:'splat-only',definition:{splat:true,raymarch:false}}),
    encodeBoundarySplatPresentation:()=>true,boundarySplatRenderPipeline:{},boundarySplatPresentationRenderPipeline:{},
    recordSelectiveHeadLivePassReceipt:x=>x,recordVolumePresentationApplication:noop,recordBrowserResidualCost:noop,
    ensureFrameTexture:noop,ensureBrowserResidualFeatureTexture:noop,frameTexture:{createView:()=>({})},browserResidualFeatureTexture:{createView:()=>({})},
    encodeBrowserResidualSourcePass:noop,encodeBrowserResidualPass:()=>true,canvasPresentationSuppressed:route==='proxy',
    appearanceDecompositionActive:()=>false,encodeBoundarySplatTelemetry:noop,boundarySplatTelemetryCopyPending:false,pressureResidualCopyPending:false,
    selectiveHeadLiveExactPause:null,recordVolumeFrameTiming:noop,requestAnimationFrame:()=>1,render:noop,cancelAnimationFrame:noop,
    canvas:{classList:{remove:noop}},emitStatus:noop,
  });
  vm.runInContext(invalidate+'\n'+prepare+'\n'+frame+'\nrenderOrdinaryFrame(1);',context);
  assert.equal(state.error,undefined,'the chosen branch must successfully submit');assert.equal(state.frameCount,2);
  assert.equal(state.rayStepTelemetry.active,false);assert.equal(visible,false);
  assert.equal(state.opticalStepping.effective,null);assert.equal(state.opticalStepping.requested,'numerical');
});
