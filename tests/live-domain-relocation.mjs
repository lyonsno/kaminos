// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const method = source.match(/    relocateOrdinaryDomain\([\s\S]*?\n    },/)[0].replace(/,$/, '');
let rebuilds = 0;
const context = {
  followingDomain: null, productFrameOwner: 'prototype', device: {}, gridSize: 32,
  productTransform: {translate: [0, 0, 0], scale: 1}, volumePrimitives: [],
  state: {}, pendingDomainRemap: null, structuredClone,
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
  flameDomainTranslation: [0, 0, 0], flameDomainScale: 1, flameEmitterPose: {}, authoredFlamePresent: false,
  volumePrototype: {relocateOrdinaryDomain() {}}, applyFlameEmitterPose() {},
  window: {__kaminosVolumeEmitterReceipt: {effective: {family: 'disk'}}},
  setFlameDomainTranslation() { moves++; return true; }, writeAuthoredFlameEmitterPose() { sources++; },
};
vm.runInNewContext(`${preview}; writeFlameDomainPreview({position:[.2,0,0],scale:[1,1,1]});`, ui);
assert.equal(moves, 1, 'preview must move live coverage during the gesture');
assert.equal(sources, 1, 'source coordinates must follow the preview transform');

// Moving coverage while a diagnostic map is in flight must retire its result
// without stranding the map guard or replacing a still-mapped buffer.
let finishMap, unmaps = 0;
const residual = {
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
  encoder: {clearBuffer() {}},
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
