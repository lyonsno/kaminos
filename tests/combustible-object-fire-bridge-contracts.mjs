import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as plank from '../combustible-plank-core.js';
import * as volume from '../volume-core.js';

const volumeSource = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const gpuSource = await readFile(new URL('../combustible-object-fire-gpu.mjs', import.meta.url), 'utf8');
const witnessPageSource = await readFile(new URL('../combustible-object-pyro-bridge.html', import.meta.url), 'utf8');
const witnessSource = await readFile(new URL('../combustible-object-pyro-witness.mjs', import.meta.url), 'utf8');

assert.match(
  witnessPageSource,
  /observedTransferReceipt/,
  'the witness preserves a positive observed transfer when a later saturated dispatch applies zero marginal material',
);
assert.match(
  witnessPageSource,
  /kaminosCombustibleObjectPyroSettle/,
  'the witness exposes a frame-counted settle horizon for native fluid transport',
);
assert.match(witnessPageSource, /nativeFieldBaseline/);
assert.match(witnessPageSource, /changedPixels/);
assert.match(witnessSource, /pixelDelta\.changedPixels/);
assert.match(witnessSource, /--supported-settle-frames/);
assert.match(witnessSource, /--final-settle-frames/);
const supportedPhaseIndex = witnessSource.indexOf("phase = 'advancing-to-supported-combustion'");
const supportedSampleIndex = witnessSource.indexOf('kaminosCombustibleObjectPyroSampleNativeField()', supportedPhaseIndex);
const supportedCaptureIndex = witnessSource.indexOf("phase = 'capturing-combustion'", supportedSampleIndex);
assert.ok(supportedPhaseIndex >= 0 && supportedSampleIndex > supportedPhaseIndex && supportedCaptureIndex > supportedSampleIndex);
assert.doesNotMatch(
  witnessSource.slice(supportedPhaseIndex, supportedSampleIndex),
  /SetRenderActive\(false\)/,
  'the witness must sample against the freshly rebuilt live majorant, not a stale frozen majorant',
);
assert.match(
  witnessSource.slice(supportedSampleIndex, supportedCaptureIndex),
  /SetRenderActive\(false\)/,
  'the evidence harness freezes Pyro immediately after the native field sample for composed capture',
);

assert.equal(
  plank.COMBUSTIBLE_OBJECT_SOURCE_SCHEMA,
  'kaminos.combustible-object-source-descriptor.v0',
  'the object producer exposes a stable source schema',
);
assert.equal(
  plank.COMBUSTIBLE_OBJECT_SOURCE_PACKING,
  'gpu-sparse-combustible-object-source-vec4x8-v0',
  'the object producer exposes its exact GPU record packing',
);
assert.equal(
  volume.COMBUSTIBLE_OBJECT_FIRE_RECEIVER_SCHEMA,
  'kaminos.pyro-combustible-object-source-consumer.v0',
  'the Pyro receiver exposes a distinct consumer schema',
);
assert.equal(
  volume.COMBUSTIBLE_OBJECT_FIRE_RECEIVER_TRANSFORM_ID,
  'affine-object-world-to-pyro-near-domain-v0',
  'the receiver owns an explicit world-to-Pyro transform identity',
);
assert.equal(typeof plank.deriveCombustibleObjectSourceFrame, 'function');
assert.equal(typeof volume.validateCombustibleObjectSourceDescriptor, 'function');
assert.equal(typeof volume.consumeCombustibleObjectSourceTickReference, 'function');

function rotationZTranslation(angleRad, translation = [0, 0, 0]) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    translation[0], translation[1], translation[2], 1,
  ];
}

function advanceToEmission(ignition) {
  let previous = plank.createCombustiblePlankState({ ignition });
  let current = previous;
  for (let i = 0; i < 240; i += 1) {
    current = plank.stepCombustiblePlank(previous, 1 / 60);
    if (current.material.emittedVolatiles > previous.material.emittedVolatiles) {
      return { previous, current };
    }
    if (i === 239) return { previous, current };
    previous = current;
  }
  return { previous, current };
}

const sharedDevice = { queue: {} };
const producerBuffers = {
  headerBuffer: { label: 'combustible object source header' },
  recordsBuffer: { label: 'combustible object source records' },
};
const burningStep = advanceToEmission(true);
const sourceFrame = plank.deriveCombustibleObjectSourceFrame(burningStep.previous, burningStep.current, {
  device: sharedDevice,
  queue: sharedDevice.queue,
  ...producerBuffers,
  capacity: 4,
  allocationGeneration: 7,
  topologyEpoch: 2,
  writeTick: 19,
  sourceFrameId: 'combustible-plank/burning-member',
  sourceFrameHash: 0x53746e72,
  transformId: 'combustible-plank-object-to-world-v0',
  objectToWorld: rotationZTranslation(0, [0, 0, 0]),
  localSourcePosition: [0.34, 0, 0],
  sourceRadius: 0.08,
});

assert.equal(sourceFrame.schema, plank.COMBUSTIBLE_OBJECT_SOURCE_SCHEMA);
assert.equal(sourceFrame.packing, plank.COMBUSTIBLE_OBJECT_SOURCE_PACKING);
assert.equal(sourceFrame.materialAuthority, plank.COMBUSTIBLE_PLANK_SOURCE_AUTHORITY);
assert.equal(sourceFrame.device, sharedDevice, 'producer preserves the exact GPUDevice identity');
assert.equal(sourceFrame.queue, sharedDevice.queue, 'producer preserves the exact GPUQueue identity');
assert.equal(sourceFrame.headerBuffer, producerBuffers.headerBuffer);
assert.equal(sourceFrame.recordsBuffer, producerBuffers.recordsBuffer);
assert.equal(sourceFrame.headerBytes, 80);
assert.equal(sourceFrame.recordBytes, 128);
assert.equal(sourceFrame.recordFloats, 32);
assert.equal(sourceFrame.materialStep, burningStep.current.step);
assert.equal(sourceFrame.sourceCount, 1);
assert.equal(sourceFrame.packedCount, 1);
assert.equal(sourceFrame.rejectedCount, 0);
assert.equal(sourceFrame.overflowCount, 0);
assert.equal(sourceFrame.malformedCount, 0);
assert.ok(sourceFrame.emittedVolatileMass > 0, 'a burning material step emits positive volatile mass');
assert.ok(sourceFrame.emittedHeat > 0, 'a burning material step emits positive heat');
assert.equal(
  sourceFrame.emittedVolatileMass,
  sourceFrame.emittedFuelMass + sourceFrame.emittedSootMass,
  'volatile carrier partitions exactly into fuel and soot records',
);
assert.equal(sourceFrame.accountingResidual, 0, 'producer mass accounting closes exactly');
assert.equal(sourceFrame.records.length, 1);
assert.deepEqual(sourceFrame.records[0].localPositionRadius.slice(0, 3), [0.34, 0, 0]);

const controlStep = advanceToEmission(false);
const controlFrame = plank.deriveCombustibleObjectSourceFrame(controlStep.previous, controlStep.current, {
  device: sharedDevice,
  queue: sharedDevice.queue,
  ...producerBuffers,
  capacity: 4,
  allocationGeneration: 7,
  topologyEpoch: 2,
  writeTick: 20,
  sourceFrameId: 'combustible-plank/control-member',
  sourceFrameHash: 0x4374726c,
  transformId: 'combustible-plank-object-to-world-v0',
  objectToWorld: rotationZTranslation(0),
});
assert.equal(controlFrame.sourceCount, 0, 'the matched unburned control emits no source records');
assert.equal(controlFrame.emittedVolatileMass, 0);
assert.equal(controlFrame.emittedHeat, 0);

let postBurn = burningStep.current;
while (postBurn.step < 220) postBurn = plank.stepCombustiblePlank(postBurn, 1 / 60);
const aggregatedPostBurnFrame = plank.deriveCombustibleObjectSourceFrame(burningStep.current, postBurn, {
  device: sharedDevice,
  queue: sharedDevice.queue,
  ...producerBuffers,
  capacity: 4,
  allocationGeneration: 7,
  topologyEpoch: 2,
  writeTick: 22,
  sourceFrameId: 'combustible-plank/aggregated-post-burn-interval',
  sourceFrameHash: 0x41676772,
  transformId: 'combustible-plank-object-to-world-v0',
  objectToWorld: rotationZTranslation(-0.43),
});
assert.equal(postBurn.combustion.active, false, 'fixture endpoint has exhausted active combustion');
assert.ok(aggregatedPostBurnFrame.emittedVolatileMass > 0, 'fixture interval contains emitted mass');
assert.equal(
  aggregatedPostBurnFrame.sourceCount,
  1,
  'positive interval emissions remain publishable even when the endpoint is no longer actively burning',
);

const validated = volume.validateCombustibleObjectSourceDescriptor(sourceFrame, {
  device: sharedDevice,
  expectedGeneration: 7,
  expectedTopologyEpoch: 2,
});
assert.equal(validated, sourceFrame);
assert.throws(
  () => volume.validateCombustibleObjectSourceDescriptor(sourceFrame, { device: { queue: sharedDevice.queue } }),
  /same GPUDevice/,
  'cross-device proxy buffers fail closed',
);
assert.throws(
  () => volume.validateCombustibleObjectSourceDescriptor({ ...sourceFrame, queue: {} }, { device: sharedDevice }),
  /same GPUQueue/,
  'cross-queue source identity fails closed',
);
assert.throws(
  () => volume.validateCombustibleObjectSourceDescriptor({ ...sourceFrame, schema: 'fallback' }, { device: sharedDevice }),
  /schema mismatch/,
  'fallback source schemas fail closed',
);
assert.throws(
  () => volume.validateCombustibleObjectSourceDescriptor({ ...sourceFrame, sourceCount: 2 }, { device: sharedDevice }),
  /count accounting mismatch/,
  'partial source counts cannot masquerade as complete evidence',
);
assert.throws(
  () => volume.validateCombustibleObjectSourceDescriptor({ ...sourceFrame, overflowCount: 1 }, { device: sharedDevice }),
  /overflow/,
  'receiver refuses producer overflow instead of silently truncating it',
);

const receiverTransform = {
  id: volume.COMBUSTIBLE_OBJECT_FIRE_RECEIVER_TRANSFORM_ID,
  scale: [0.5, 0.5, 0.5],
  offset: [0.5, 0.5, 0.5],
};
const receiverState = {
  lastConsumedTick: 0,
  expectedGeneration: 7,
  expectedTopologyEpoch: 2,
};
const firstTransfer = volume.consumeCombustibleObjectSourceTickReference(receiverState, sourceFrame, {
  device: sharedDevice,
  transform: receiverTransform,
  gridSize: 32,
});
assert.equal(firstTransfer.ok, true);
assert.equal(firstTransfer.status, 'applied');
assert.equal(firstTransfer.lastConsumedTick, 19);
assert.equal(firstTransfer.acceptedRecords, 1);
assert.equal(firstTransfer.rejectedRecords, 0);
assert.ok(firstTransfer.touchedCells > 1, 'a finite-radius source resolves to a spatial multi-cell kernel');
assert.equal(firstTransfer.accepted[0].kernelWeightSum, 1, 'the spatial kernel preserves normalized source transfer');
assert.ok(firstTransfer.injectedHeat > 0);
assert.ok(firstTransfer.injectedFuel > 0);
assert.ok(firstTransfer.injectedSoot > 0);
assert.equal(firstTransfer.sourceVolatileMass, firstTransfer.acceptedVolatileMass);
assert.equal(firstTransfer.rejectedVolatileMass, 0);
assert.equal(firstTransfer.accountingResidual, 0);

const staleTransfer = volume.consumeCombustibleObjectSourceTickReference(firstTransfer, sourceFrame, {
  device: sharedDevice,
  transform: receiverTransform,
  gridSize: 32,
});
assert.equal(staleTransfer.ok, false);
assert.equal(staleTransfer.status, 'stale-source-tick');
assert.equal(staleTransfer.lastConsumedTick, 19);
assert.equal(staleTransfer.acceptedRecords, 0);
assert.equal(staleTransfer.touchedCells, 0);
assert.equal(staleTransfer.injectedHeat, 0);
assert.equal(staleTransfer.injectedFuel, 0);
assert.equal(staleTransfer.injectedSoot, 0);

assert.throws(
  () => volume.consumeCombustibleObjectSourceTickReference(receiverState, sourceFrame, {
    device: sharedDevice,
    transform: { ...receiverTransform, id: 'implicit-transform' },
    gridSize: 32,
  }),
  /transform identity mismatch/,
  'implicit or stale receiver transforms fail closed',
);

const rotatedFrame = plank.deriveCombustibleObjectSourceFrame(burningStep.previous, burningStep.current, {
  ...sourceFrame,
  writeTick: 21,
  objectToWorld: rotationZTranslation(0.42),
});
const rotatedTransfer = volume.consumeCombustibleObjectSourceTickReference(firstTransfer, rotatedFrame, {
  device: sharedDevice,
  transform: receiverTransform,
  gridSize: 32,
});
assert.equal(rotatedTransfer.ok, true);
assert.notDeepEqual(
  rotatedTransfer.accepted[0].receiverUnit,
  firstTransfer.accepted[0].receiverUnit,
  'the receiver applies the current object transform so the source follows motion',
);

assert.match(volumeSource, /setCombustibleObjectSources\s*\(/, 'volume prototype exposes the native descriptor receiver');
assert.match(volumeSource, /clearCombustibleObjectSources\s*\(/, 'volume prototype can release borrowed source identity');
assert.match(volumeSource, /combustibleObjectSourceDebug/, 'debug state carries effective route and source accounting');
assert.doesNotMatch(
  volumeSource,
  /setCombustibleObjectSources[\s\S]{0,1200}setExternalEmitters\s*\(/,
  'the native receiver does not launder object sources through the capped compatibility API',
);
assert.doesNotMatch(
  gpuSource,
  /let requested(?:Heat|Fuel|Soot|Smoke) = min\(/,
  'the native receiver must not shadow caller calibration with a hidden per-cell transfer cap',
);
assert.doesNotMatch(
  gpuSource,
  /let visibleFire = min\(/,
  'the native receiver must defer fire capacity to the field clamp instead of throttling visible fire',
);

console.log('combustible object/fire bridge contracts: ok');
