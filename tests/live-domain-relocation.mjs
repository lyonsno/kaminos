// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createFireProxySync} from '../fire-proxy-sync.mjs';
import {createProxySnapshotRegistry} from '../proxy-snapshot.mjs';
import {resolveWorldCalibration} from '../volume-world-calibration.mjs';

const source = fs.readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const method = source.match(/    relocateOrdinaryDomain\([\s\S]*?\n    },/)[0].replace(/,$/, '');
let rebuilds = 0;
const context = {
  followingDomain: null, productFrameOwner: 'prototype', device: {}, gridSize: 32,
  productTransform: {translate: [0, 0, 0], scale: 1}, volumePrimitives: [],
  state: {}, pendingDomainRemap: null, structuredClone, lastResidualPartials: null,
  normalizePrimitiveRecord: x => x, publishVolumePrimitiveState() {}, getPrimitiveSource() {},
  writeLiquidFireContactParams() {}, updateAnalyticEmitterDebug() {}, rebuildFluidState() { rebuilds++; },
};
const runtime = vm.runInNewContext(`({${method}})`, context);
assert.equal(runtime.relocateOrdinaryDomain([0.25, 0, 0]), true);
assert.equal(rebuilds, 0, 'moving live coverage must keep the allocated fields');
assert.deepEqual(context.pendingDomainRemap, {translate: [0, 0, 0], scale: 1});
runtime.relocateOrdinaryDomain([0.5, 0.3, 0], [], 1.2);
assert.deepEqual(context.pendingDomainRemap, {translate: [0, 0, 0], scale: 1},
  'several edits before a frame must remap from the last GPU-applied pose');
assert.deepEqual(JSON.parse(JSON.stringify(context.productTransform)), {translate: [0.5, 0.3, 0], scale: 1.2});
assert.equal(runtime.relocateOrdinaryDomain([0.5, 0.3, 0], [], 1.2), false);
assert.throws(() => runtime.relocateOrdinaryDomain([NaN, 0, 0]), /finite/);
assert.throws(() => runtime.relocateOrdinaryDomain([0, 0, 0], [], 0), /positive/);
context.followingDomain = {};
assert.throws(() => runtime.relocateOrdinaryDomain([0, 0, 0]), /following/);
console.log('Live domain edits retain allocation and coalesce from the applied pose');

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const preview = html.match(/function writeFlameDomainPreview\(value\) \{[\s\S]*?\n\}/)[0];
let moves = 0, sources = 0;
const ui = {flameDomainDraft: null, checkedFlameDomainPose: x => x, refreshFlameDomainPreview() {},
  domainTransformForPose: p => ({translation: p.position, scale: p.scale[0]}),
  flameDomainTranslation: [0, 0, 0], flameDomainScale: 1, flameEmitterPose: {}, authoredFlamePresent: true,
  volumePrototype: {relocateOrdinaryDomain() {}}, applyFlameEmitterPose() {},
  window: {__kaminosVolumeEmitterReceipt: {effective: {family: 'disk'}}},
  setFlameDomainTranslation() { moves++; return true; }, writeAuthoredFlameEmitterPose() { sources++; },
};
vm.runInNewContext(`${preview}; writeFlameDomainPreview({position:[.2,0,0],scale:[1,1,1]});`, ui);
assert.equal(moves, 1, 'preview must move live coverage during the gesture');
assert.equal(sources, 1, 'source coordinates must follow the preview transform');
ui.authoredFlamePresent=false;vm.runInNewContext(`${preview}; writeFlameDomainPreview({position:[.4,0,0],scale:[1,1,1]});`,ui);assert.equal(moves,2);assert.equal(sources,1,'source-free coverage movement must not recreate or update an emitter');

// Moving coverage while a diagnostic map is in flight must retire its result
// without stranding the map guard or replacing a still-mapped buffer.
let finishMap, unmaps = 0;
const residual = {
  resolveWorldCalibration,
  pressureResidualCopyPending: true, pressureResidualMapPending: false,
  pressureResidualMapGeneration: 0, pressureResidualMapStartedFrame: 0,
  pressureResidualReadbackBuffer: {mapAsync: () => new Promise(r => {finishMap = r;}), unmap() {unmaps++;}},
  pressureResidualWorkgroupCount: 1, pressureResidualCopyStep: 2, gridSize: 4, gridHeight: 4,
  pressureResidualCopyFluidCells: 64, pressureResidualCopyCells: 64,
  pressureResidualCopySolver: null, pressureResidualCopyMeasurement: null,
  GPUMapMode: {READ: 1}, setTimeout: () => 0, clearTimeout() {},
  PRESSURE_RESIDUAL_MAP_TIMEOUT_ERROR: 'timeout', PRESSURE_RESIDUAL_MAP_TIMEOUT_MS: 1000,
  state: {frameCount: 3, simStepCount: 2, pressureSolver: {residual: null}},
  pendingDomainRemap: {translate: [0, 0, 0], scale: 1}, productTransform: {translate: [.2, 0, 0], scale: 1},
  controlsSnapshot: {worldSmoke: 'off'}, REACTANT_MODEL: {ambientOxidizer: 1},
  resolveVelocityStaggeringConfig: () => ({effective: {mode: 'staggered'}}), domainRemapper: {encode() {}},
  fluidBuffers: [{}, {}], frontBuffers: [{}, {}], quenchBuffers: [{}, {}],
  reactantTextures: [{}, {}], waveletTextures: [{}, {}], joinedLowerFaceTexture: {},
  currentFluid: 0, currentFront: 0, currentQuench: 0, fineVelocity: null,
  pressureBuffers: [{}, {}], separatedPressure: null, refreshWorldRenderMapping() {},
  encoder: {clearBuffer() {}}, lastResidualPartials: null,
};
const encodeRemap = source.slice(source.indexOf('  function encodeDomainRemap('), source.indexOf('  function prepareFollowingDomain('));
const resolveMap = source.slice(source.indexOf('  async function resolvePressureResidualProbe()'), source.indexOf('  function encodePressureProjection('));
const diagnostic = vm.runInNewContext(`${encodeRemap}\n${resolveMap}\n({resolvePressureResidualProbe,encodeDomainRemap})`, residual);
const pending = diagnostic.resolvePressureResidualProbe();
diagnostic.encodeDomainRemap(residual.encoder);
finishMap(); await pending;
assert.equal(unmaps, 1, 'old diagnostic must release its mapped buffer');
assert.equal(residual.pressureResidualMapPending, false, 'diagnostics must resume after a live move');
assert.equal(residual.state.pressureSolver.residual, null, 'old-coordinate residual is stale');

// Exercise the actual cached-partial seam with its real proxy consumer. A
// paused move must invalidate existing snapshots and late/queued attachment.
const consumerMethod=source.match(/    setResidualPartialsConsumer\([\s\S]*?\n    },/)[0].replace(/,$/,'');
const generationMethod=source.match(/    getResidualFieldGeneration\(\) \{[^\n]*\}/)[0];
const proxyContext={...context,...residual,followingDomain:null,pendingDomainRemap:null,
  state:{fluidStateResetCount:7,residualFieldGeneration:7,pressureSolver:{residual:null}},
  residualPartialsConsumer:null,lastResidualPartials:null,queueMicrotask,console};
const proxyRuntime=vm.runInNewContext(`${encodeRemap}\n({${method},${consumerMethod},${generationMethod},encodeDomainRemap})`,proxyContext);
const data=new Float32Array(20);data.set([0,64,0,0,96,96,0,0],12);
const packet=()=>({partials:data,grid:4,gridY:4,workgroupsX:1,workgroupsY:1,workgroupsZ:1,
  floatsPerWorkgroup:20,step:16,fieldGeneration:proxyRuntime.getResidualFieldGeneration()});
proxyContext.lastResidualPartials=packet();
const registry=createProxySnapshotRegistry(),canvas={style:{visibility:''}};
const proxy=createFireProxySync({registry,readDomain:()=>({translation:proxyContext.productTransform.translate,scale:proxyContext.productTransform.scale}),
  createLayer:()=>({setSnapshot(){},clear(){},dispose(){}})});
const frame=()=>proxy.sync({prototype:proxyRuntime,display:true,canvas});
frame();await Promise.resolve();frame();
assert.equal(proxy.effective(),true,'pre-move cached field is usable');
const oldGeneration=proxyRuntime.getResidualFieldGeneration();
proxyRuntime.relocateOrdinaryDomain([.3,0,0]);
proxyRuntime.encodeDomainRemap(proxyContext.encoder);
frame();
assert.equal(registry.latest('fire'),null,'paused relocation must invalidate the published proxy');
assert.notEqual(proxyRuntime.getResidualFieldGeneration(),oldGeneration,'coordinates need their own generation');
assert.equal(proxyContext.state.fluidStateResetCount,7,'a coordinate change does not reset the simulation');
assert.equal(canvas.style.visibility,'','Full presentation remains until a fresh proxy is available');
let deliveries=0;
proxyRuntime.setResidualPartialsConsumer(()=>deliveries++);await Promise.resolve();
assert.equal(deliveries,0,'late attachment cannot replay pre-move partials');
proxyContext.lastResidualPartials=packet();
proxyRuntime.setResidualPartialsConsumer(()=>deliveries++);
proxyRuntime.relocateOrdinaryDomain([.4,0,0]);
await Promise.resolve();
assert.equal(deliveries,0,'a replay queued before preview cannot use the new coordinates');

// A coordinate change makes the measurement stale, but cannot make an
// unresolved map safe to reuse. Exercise timeout cleanup before and after
// the deferred remap, using the actual retirement and probe admission paths.
const retireMap=source.slice(source.indexOf('  function retirePressureResidualMap('),source.indexOf('  function advancePressureResidualFreshness('));
const beginProbe=source.slice(source.indexOf('  function beginPressureResidualProbe('),source.indexOf('  function finishPressureResidualProbe('));
for(const invalidation of ['preview','remap','replacement']){
  let timeout,lateMap,destroyed=0,allocations=0;
  const oldBuffer={mapAsync:()=>new Promise(r=>{lateMap=r;}),destroy(){destroyed++;},unmap(){}};
  const replacement={};
  const c={...residual,pressureResidualCopyPending:true,pressureResidualMapPending:false,
    pressureResidualMapGeneration:0,pressureResidualReadbackBuffer:oldBuffer,
    state:{frameCount:4,simStepCount:16,residualFieldGeneration:1,pressureResidualCopyFieldGeneration:1,pressureSolver:{}},
    device:{createBuffer(){allocations++;return replacement;}},GPUBufferUsage:{COPY_DST:1,MAP_READ:2},
    PRESSURE_RESIDUAL_FLOATS_PER_WORKGROUP:20,PRESSURE_RESIDUAL_PROBE_INTERVAL_STEPS:16,
    gridShapeLabel:()=> '4x4x4',setTimeout(fn){timeout=fn;return 1;},
    pressureResidualBeforePipeline:{},pressureResidualAfterPipeline:{},pressureResidualBindGroup:{},pressureResidualPartialsBuffer:{},
    fluidBindGroup:()=>({})};
  const probe=vm.runInNewContext(`${retireMap}\n${beginProbe}\n${resolveMap}\n({resolvePressureResidualProbe,beginPressureResidualProbe})`,c);
  const pending=probe.resolvePressureResidualProbe();
  c.state.residualFieldGeneration++;
  if(invalidation==='remap')c.state.domainRemap={count:1};
  if(invalidation==='replacement'){c.pressureResidualMapGeneration++;c.pressureResidualReadbackBuffer=replacement;c.pressureResidualMapPending=true;}
  timeout();await pending;
  if(invalidation==='replacement'){
    assert.equal(destroyed,0,'an old resolver cannot retire the replacement buffer');
    assert.equal(c.pressureResidualMapPending,true,'an old resolver cannot release the replacement guard');
  }else{
    assert.equal(destroyed,1,`${invalidation}: stale timed-out map must be retired`);
    assert.equal(allocations,1);assert.equal(c.pressureResidualReadbackBuffer,replacement);
    assert.equal(c.pressureResidualMapPending,false);
    const pass={setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};
    assert.equal(probe.beginPressureResidualProbe({beginComputePass:()=>pass}),true,'next probe uses the replacement');
  }
  lateMap();await Promise.resolve();
  assert.equal(c.pressureResidualReadbackBuffer,replacement,'late completion cannot restore the retired buffer');
}
console.log('Stale diagnostic timeouts retire their own buffer and preserve replacement custody');
