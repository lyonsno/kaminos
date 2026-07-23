import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const adapterPath = join(root, 'volume-fire-actor-control-rebake-adapter.mjs');
const analyticalPath = join(root, 'volume-stage-b-analytical-rebake.mjs');

assert.ok(existsSync(adapterPath), 'Wake must carry the reviewed FireActor control rebake adapter');
assert.ok(existsSync(analyticalPath), 'Wake must carry the exact Stage B analytical rebake implementation');

const fireActor = await import('../volume-fire-actor-mount.mjs');
assert.equal(fireActor.FIRE_ACTOR_REBAKE_CONTROL_IDS.length, 14);
assert.equal(typeof fireActor.createFireActorControlRebakeAdapter, 'function');
assert.equal(typeof fireActor.createVolumeEngineStageBStateReader, 'function');
assert.equal(typeof fireActor.fireActorRebakeControlsFromVolumeControls, 'function');
assert.equal(fireActor.FIRE_ACTOR_FULL_GRID_EXPORT_SCHEMA, 'kaminos.volume.full-field-export.v0');
assert.equal(
  fireActor.FIRE_ACTOR_FULL_GRID_EXPORT_AUTHORITY,
  'debug-full-grid-webgpu-copy-buffer-readback',
);
assert.equal(
  fireActor.FIRE_ACTOR_FULL_GRID_EXPORT_IDENTITY,
  'full-grid-fluid-front-boundary-sidecars-v0',
);

const parityContract = readFileSync(join(root, 'fire-actor-live-parity-contract.mjs'), 'utf8');
assert.match(parityContract, /FIRE_ACTOR_LIVE_PARITY_REBAKE_CONTROLS/);
assert.match(parityContract, /volume_reaction_boundary_fire_tip/);
assert.match(parityContract, /volume_reaction_boundary_divergence/);

const browser = readFileSync(join(root, 'fire-actor-live-parity-browser.mjs'), 'utf8');
assert.match(browser, /runControlRebake/);
assert.match(browser, /async function rebake/);
assert.match(browser, /rebake,/);

const index = readFileSync(join(root, 'index.html'), 'utf8');
assert.match(index, /createFireActorControlRebakeAdapter/);
assert.match(index, /createVolumeEngineStageBStateReader/);
assert.match(index, /fireActorRebakeControlsFromVolumeControls/);
assert.match(index, /integrationBaselineBoundarySidecarSha256/);
assert.match(index, /runControlRebake:/);

const workbench = readFileSync(join(root, 'fire-actor-live-parity.html'), 'utf8');
assert.match(workbench, /id="rebake"/);
assert.match(workbench, /id="kiln-rebake-canvas"/);
assert.match(workbench, /rebakeTreatment/);
assert.match(workbench, /rebakeReceipt/);

const witness = readFileSync(join(root, 'fire-actor-live-parity-witness.mjs'), 'utf8');
assert.match(witness, /liveRebakeExercise/);
assert.match(witness, /validateLiveRebakeExercise/);
assert.match(witness, /rebake\.png/);

const { validateLiveRebakeExercise } = await import('../fire-actor-live-parity-witness.mjs');
const { FIRE_ACTOR_LIVE_PARITY_REBAKE_CONTROLS } = await import('../fire-actor-live-parity-contract.mjs');
const controls = structuredClone(FIRE_ACTOR_LIVE_PARITY_REBAKE_CONTROLS);
const pixelIdentity = 'a'.repeat(64);
const sha256Json = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const source = {
  requestedMode: 'live',
  effectiveMode: 'live',
  stateId: null,
  sourceStateIdentity: null,
  fluidSha256: 'd'.repeat(64),
  frontSha256: 'e'.repeat(64),
  cameraIdentity: 'camera-signature',
  captureCameraIdentity: 'camera-signature',
  cameraRole: 'capture-state-binding-only-not-pixel-projection',
  simStepCount: 120,
  captureSimStepCount: 120,
  preReleaseSimStepCount: 120,
  postReleaseSimStepCount: 120,
  preReleaseCameraIdentity: 'camera-signature',
  postReleaseCameraIdentity: 'camera-signature',
  priorPauseState: true,
  restoredPauseState: true,
  advancedDuringLease: false,
  advancedAfterRelease: false,
  routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:apple',
  exportAuthority: 'debug-full-grid-webgpu-copy-buffer-readback',
  exportIdentity: 'full-grid-fluid-front-boundary-sidecars-v0',
};
const projection = {
  schema: 'kaminos.volume.stage-b-analytical-projection.v1',
  requested: 'stage-b-fixed-analytical-projection-v1',
  effective: 'stage-b-fixed-analytical-projection-v1',
  coordinateSpace: 'normalized-volume-world-v0',
  position: [0, 0.6, 3],
  target: [0, 0, 0],
  verticalFovDegrees: 40,
  depthPartition: {
    identity: 'camera-linear-depth-1.8-to-4.3-v0',
    near: 1.8,
    far: 4.3,
    layers: 16,
  },
  outputWidth: 16,
  outputHeight: 16,
  aspect: 1,
};
projection.identity = sha256Json(projection);
const treatmentProducerReceipt = {
  sourceStateIdentity: null,
  source: {
    mode: 'live',
    grid: 128,
    stateId: null,
    fluidSha256: source.fluidSha256,
    frontSha256: source.frontSha256,
    cameraIdentity: source.cameraIdentity,
    captureCameraIdentity: source.captureCameraIdentity,
    simStepCount: 120,
    routeIdentity: source.routeIdentity,
    effectiveRoute: source.effectiveRoute,
    backend: source.backend,
    exportAuthority: source.exportAuthority,
    exportIdentity: source.exportIdentity,
  },
  effectiveControls: controls,
  controlsIdentity: '2'.repeat(64),
  fixedProductionControlsIdentity: '3'.repeat(64),
  candidateIdentity: '5'.repeat(64),
  coefficientIdentity: '6'.repeat(64),
  covarianceIdentity: '7'.repeat(64),
  stageBIdentity: null,
  depositionIdentity: '1'.repeat(64),
  pixelIdentity,
  projection,
};
const stateBasis = {
  mode: treatmentProducerReceipt.source.mode,
  grid: treatmentProducerReceipt.source.grid,
  fluidSha256: treatmentProducerReceipt.source.fluidSha256,
  frontSha256: treatmentProducerReceipt.source.frontSha256,
  cameraIdentity: treatmentProducerReceipt.source.cameraIdentity,
  captureCameraIdentity: treatmentProducerReceipt.source.captureCameraIdentity,
  simStepCount: treatmentProducerReceipt.source.simStepCount,
  routeIdentity: treatmentProducerReceipt.source.routeIdentity,
  effectiveRoute: treatmentProducerReceipt.source.effectiveRoute,
  backend: treatmentProducerReceipt.source.backend,
  exportAuthority: treatmentProducerReceipt.source.exportAuthority,
  exportIdentity: treatmentProducerReceipt.source.exportIdentity,
};
source.stateId = `fireactor-live-${sha256Json(stateBasis)}`;
treatmentProducerReceipt.source.stateId = source.stateId;
source.sourceStateIdentity = sha256Json({
  stateId: source.stateId,
  grid: treatmentProducerReceipt.source.grid,
  fluidSha256: source.fluidSha256,
  frontSha256: source.frontSha256,
  cameraIdentity: source.cameraIdentity,
});
treatmentProducerReceipt.sourceStateIdentity = source.sourceStateIdentity;
treatmentProducerReceipt.stageBIdentity = sha256Json({
  sourceStateIdentity: treatmentProducerReceipt.sourceStateIdentity,
  controlsIdentity: treatmentProducerReceipt.controlsIdentity,
  fixedProductionControlsIdentity: treatmentProducerReceipt.fixedProductionControlsIdentity,
  projectionIdentity: treatmentProducerReceipt.projection.identity,
  candidateIdentity: treatmentProducerReceipt.candidateIdentity,
  coefficientIdentity: treatmentProducerReceipt.coefficientIdentity,
  covarianceIdentity: treatmentProducerReceipt.covarianceIdentity,
  depositionIdentity: treatmentProducerReceipt.depositionIdentity,
  pixelIdentity: treatmentProducerReceipt.pixelIdentity,
});
const validExercise = {
  beforeStep: 120,
  afterStep: 120,
  result: {
    receipt: {
      schema: 'kaminos.fire-actor-control-rebake-receipt.v1',
      status: 'applied',
      mountId: 'firemount-50c6c9e5977fd4c1a8bc133bda0bdf30af5ac8ee91f63805abb182ab17cd72b7',
      packageSha256: 'f90c67f4f87eeffeb08aa21f467cecfafeb9181394c2aef196015c2aedd576bc',
      basinRevision: 'basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95',
      requestedControls: controls,
      effectiveControls: controls,
      source,
      boundary: {
        baseline: {
          authority: 'baked',
          identity: '33a6943c6a2cb644f244d5edeeb544dbce52d0cef98e3fb9d705abd49b941216',
        },
        requested: 'analytical-recomputed',
        effective: 'analytical-recomputed',
      },
      identities: {
        treatmentStageB: treatmentProducerReceipt.stageBIdentity,
        deposition: treatmentProducerReceipt.depositionIdentity,
        pixels: pixelIdentity,
        projection: treatmentProducerReceipt.projection.identity,
      },
      projection,
      passes: { requested: ['source-validation'], encoded: [], applied: ['source-validation'] },
      simulatorAdvanced: false,
      fallbackReason: null,
      output: { width: 16, height: 16, byteLength: 1024 },
    },
    pixelByteLength: 1024,
    baselinePixelByteLength: 1024,
    rawPixelSha256: pixelIdentity,
    canvasPixelSha256: pixelIdentity,
    engineBefore: { simStepCount: 120, cameraSignature: source.cameraIdentity, paused: true },
    engineAfter: { simStepCount: 120, cameraSignature: source.cameraIdentity, paused: true },
    producerReceipts: { treatment: treatmentProducerReceipt },
  },
  pixels: { changedPixels: 12, litPixels: 12, sha256: 'b'.repeat(64) },
};
assert.doesNotThrow(() => validateLiveRebakeExercise(validExercise));
for (const [name, mutate, pattern] of [
  ['wrong source', value => { value.result.receipt.source.effectiveMode = 'frozen'; }, /source identity/],
  ['partial controls', value => { delete value.result.receipt.requestedControls[fireActor.FIRE_ACTOR_REBAKE_CONTROL_IDS[0]]; }, /fourteen controls/],
  ['wrong treatment', value => { value.result.receipt.requestedControls.volume_reaction_boundary_topology = 0.96; }, /treatment controls/],
  ['wrong mount', value => { value.result.receipt.mountId = `firemount-${'9'.repeat(64)}`; }, /mount identity/],
  ['wrong package', value => { value.result.receipt.packageSha256 = '9'.repeat(64); }, /mount identity/],
  ['missing source hash', value => { value.result.receipt.source.fluidSha256 = null; }, /source identity/],
  ['wrong route', value => { value.result.receipt.source.effectiveRoute = 'fallback'; }, /source identity/],
  ['fallback export authority', value => { value.result.receipt.source.exportAuthority = 'cached-fallback'; }, /source identity/],
  ['stale camera', value => {
    value.result.receipt.source.cameraIdentity = 'stale-default-camera';
    value.result.receipt.source.captureCameraIdentity = 'stale-default-camera';
    value.result.receipt.source.preReleaseCameraIdentity = 'stale-default-camera';
    value.result.receipt.source.postReleaseCameraIdentity = 'stale-default-camera';
    value.result.producerReceipts.treatment.source.cameraIdentity = 'stale-default-camera';
    value.result.producerReceipts.treatment.source.captureCameraIdentity = 'stale-default-camera';
  }, /engine capture identity/],
  ['state identity mismatch', value => { value.result.receipt.source.stateId = `fireactor-live-${'9'.repeat(64)}`; }, /producer receipt|derived from/],
  ['source identity mismatch', value => {
    value.result.receipt.source.sourceStateIdentity = '9'.repeat(64);
    value.result.producerReceipts.treatment.sourceStateIdentity = '9'.repeat(64);
  }, /internally inconsistent/],
  ['Stage B identity mismatch', value => { value.result.producerReceipts.treatment.stageBIdentity = '9'.repeat(64); }, /producer receipt|Stage B identity/],
  ['missing producer receipt', value => { delete value.result.producerReceipts; }, /producer receipt/],
  ['producer identity mismatch', value => { value.result.producerReceipts.treatment.pixelIdentity = '9'.repeat(64); }, /producer receipt/],
  ['raw pixel mismatch', value => { value.result.rawPixelSha256 = '9'.repeat(64); }, /raw pixel/],
  ['canvas pixel mismatch', value => { value.result.canvasPixelSha256 = '9'.repeat(64); }, /canvas pixel/],
  ['simulation advance', value => { value.result.receipt.simulatorAdvanced = true; }, /mutated simulation/],
  ['fallback', value => { value.result.receipt.fallbackReason = 'ordinary-renderer'; }, /fell back/],
  ['blank pixels', value => { value.pixels.litPixels = 0; }, /pixel witness is blank/],
]) {
  const candidate = structuredClone(validExercise);
  mutate(candidate);
  assert.throws(() => validateLiveRebakeExercise(candidate), pattern, name);
}

console.log('Wake promoted FireActor live rebake consumer contracts passed');
