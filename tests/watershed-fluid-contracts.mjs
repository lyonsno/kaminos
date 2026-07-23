import assert from 'node:assert/strict';

import {
  FLUID_EXCHANGE_RECEIPT_SCHEMA,
  FLUID_REPRESENTATION_FRAME_SCHEMA,
  FLUID_TERRAIN_FEEDBACK_FRAME_SCHEMA,
  TERRAIN_FLUID_FRAME_SCHEMA,
  createFluidExchangeReceipt,
  createFluidRepresentationFrame,
  createFluidTerrainFeedbackFrame,
  createRepresentationOwnershipLedger,
  createTerrainFluidFrame,
  validateFluidExchangeReceipt,
  validateFluidRepresentationFrame,
  validateFluidTerrainFeedbackFrame,
  validateRepresentationOwnershipLedger,
  validateTerrainFluidFrame,
} from '@kaminos/fluid-contracts';

function terrainFrame(overrides = {}) {
  const width = 3;
  const height = 2;
  const sampleCount = width * height;
  return createTerrainFluidFrame({
    requestedRoute: 'lerms/hill-of-hills/terrain-fluid-frame',
    effectiveRoute: 'lerms/hill-of-hills/terrain-fluid-frame',
    producerId: 'lerms-hill-of-hills',
    producerRevision: 'hill-test-revision',
    requestedSourceId: 'continuity-hills-live',
    effectiveSourceId: 'continuity-hills-live',
    worldMetersPerUnit: 4,
    gravity: [0, -9.81, 0],
    terrainId: 'continuity-hills',
    supportClass: 'heightfield',
    transformId: 'hill-substrate-to-world-v1',
    priorEpoch: 40,
    currentEpoch: 41,
    motionClass: 'ordinary_morph',
    grid: { width, height, spacing: [0.5, 0.75], origin: [-1, 0, -0.5] },
    fields: {
      bedHeight: new Float32Array([0, 0.1, 0.2, 0.05, 0.15, 0.25]),
      jacobian: new Float32Array(sampleCount).fill(1),
      gradient: new Float32Array(sampleCount * 2),
      tangentU: new Float32Array(Array.from({ length: sampleCount }, () => [1, 0, 0]).flat()),
      tangentV: new Float32Array(Array.from({ length: sampleCount }, () => [0, 0, 1]).flat()),
      normal: new Float32Array(Array.from({ length: sampleCount }, () => [0, 1, 0]).flat()),
      supportVelocity: new Float32Array(sampleCount * 3),
      valid: new Uint8Array(sampleCount).fill(1),
    },
    dirtyRegions: [{ x: 0, y: 0, width, height }],
    complete: true,
    ...overrides,
  });
}

const frame = terrainFrame();
assert.equal(frame.schema, TERRAIN_FLUID_FRAME_SCHEMA);
assert.equal(validateTerrainFluidFrame(frame, {
  expectedRoute: 'lerms/hill-of-hills/terrain-fluid-frame',
  expectedSourceId: 'continuity-hills-live',
  minimumEpoch: 41,
}).currentEpoch, 41);

assert.throws(
  () => validateTerrainFluidFrame(terrainFrame({ effectiveRoute: 'fixture/default' }), {
    expectedRoute: 'lerms/hill-of-hills/terrain-fluid-frame',
  }),
  /effective route mismatch/,
  'a fallback route cannot masquerade as the requested live Hill frame',
);
assert.throws(
  () => validateTerrainFluidFrame(terrainFrame({ effectiveSourceId: 'cached-fixture' }), {
    expectedSourceId: 'continuity-hills-live',
  }),
  /effective source mismatch/,
  'a stale fixture source cannot satisfy the live source contract',
);
assert.throws(
  () => validateTerrainFluidFrame(terrainFrame({ currentEpoch: 39 })),
  /current epoch precedes prior epoch/,
  'terrain epochs cannot run backward',
);
assert.throws(
  () => validateTerrainFluidFrame(terrainFrame({
    fields: {
      bedHeight: new Float32Array(5),
      jacobian: new Float32Array(6).fill(1),
      gradient: new Float32Array(12),
      tangentU: new Float32Array(Array.from({ length: 6 }, () => [1, 0, 0]).flat()),
      tangentV: new Float32Array(Array.from({ length: 6 }, () => [0, 0, 1]).flat()),
      normal: new Float32Array(Array.from({ length: 6 }, () => [0, 1, 0]).flat()),
      supportVelocity: new Float32Array(18),
      valid: new Uint8Array(6).fill(1),
    },
  })),
  /bedHeight length/,
  'partial terrain fields fail loud instead of becoming a blank authoritative frame',
);

const ownership = createRepresentationOwnershipLedger({
  fluidEpoch: 12,
  terrainEpoch: 41,
  macroVolume: 8,
  localVolume: 1.25,
  parcelVolume: 0.5,
  externalSources: 0.75,
  externalSinks: 0.25,
  initialVolume: 9.25,
  tolerance: 1e-9,
});
assert.equal(validateRepresentationOwnershipLedger(ownership).residual, 0);
assert.throws(
  () => validateRepresentationOwnershipLedger({ ...ownership, parcelVolume: 0.4 }),
  /ownership residual exceeds tolerance/,
  'missing physical volume cannot be hidden in representation bookkeeping',
);

const receipt = createFluidExchangeReceipt({
  transactionId: 'deposit-17',
  lineageId: 'waterfall-lineage-4',
  sourceRepresentation: 'local',
  destinationRepresentation: 'macro',
  terrainEpoch: 41,
  fluidEpoch: 12,
  allocationGeneration: 3,
  supportId: 'continuity-hills',
  transformId: 'hill-substrate-to-world-v1',
  debitedVolume: 0.625,
  creditedVolume: 0.625,
  debitedMomentum: [0.2, 0, -0.05],
  creditedMomentum: [0.2, 0, -0.05],
  debitedMaterials: { temperature: 0.4 },
  creditedMaterials: { temperature: 0.4 },
  tolerance: 1e-8,
  state: 'committed',
});
assert.equal(receipt.schema, FLUID_EXCHANGE_RECEIPT_SCHEMA);
assert.equal(validateFluidExchangeReceipt(receipt).residual.volume, 0);
assert.throws(
  () => validateFluidExchangeReceipt({ ...receipt, creditedVolume: 0.5 }),
  /volume residual exceeds tolerance/,
  'a one-sided transfer cannot publish as committed',
);
for (const [field, value, pattern] of [
  ['transactionId', '', /transactionId must be a non-empty string/],
  ['lineageId', '', /lineageId must be a non-empty string/],
  ['terrainEpoch', Number.NaN, /terrainEpoch must be finite/],
  ['fluidEpoch', Number.NaN, /fluidEpoch must be finite/],
  ['allocationGeneration', Number.NaN, /allocationGeneration must be finite/],
  ['supportId', '', /supportId must be a non-empty string/],
  ['transformId', '', /transformId must be a non-empty string/],
]) {
  assert.throws(
    () => validateFluidExchangeReceipt({ ...receipt, [field]: value }),
    pattern,
    `a committed exchange receipt cannot omit or poison ${field}`,
  );
}

const feedback = createFluidTerrainFeedbackFrame({
  requestedRoute: 'kaminos/fluid/terrain-feedback',
  effectiveRoute: 'kaminos/fluid/terrain-feedback',
  producerRevision: 'producer-test-revision',
  fluidEpoch: 12,
  terrainEpoch: 41,
  representationIdentity: 'macro-local-parcel-exclusive-v1',
  grid: frame.grid,
  fields: {
    depth: new Float32Array(6).fill(0.2),
    wetness: new Float32Array(6).fill(1),
    tangentMomentum: new Float32Array(12),
  },
  dirtyRegions: frame.dirtyRegions,
  conservationReceiptIds: [receipt.transactionId],
  complete: true,
});
assert.equal(feedback.schema, FLUID_TERRAIN_FEEDBACK_FRAME_SCHEMA);
assert.equal(validateFluidTerrainFeedbackFrame(feedback, {
  expectedRoute: 'kaminos/fluid/terrain-feedback',
  expectedTerrainEpoch: 41,
}).terrainEpoch, 41);
assert.throws(
  () => validateFluidTerrainFeedbackFrame({
    ...feedback,
    fields: { ...feedback.fields, depth: Float32Array.from(feedback.fields.depth, (_, index) => index === 0 ? -0.1 : 0.2) },
  }),
  /depth\[0\] must be non-negative/,
  'negative terrain feedback depth cannot publish as complete',
);
assert.throws(
  () => validateFluidTerrainFeedbackFrame({
    ...feedback,
    fields: { ...feedback.fields, wetness: Float32Array.from(feedback.fields.wetness, (_, index) => index === 0 ? 1.1 : 1) },
  }),
  /wetness\[0\] must be in \[0, 1\]/,
  'wetness outside its physical range cannot publish as complete',
);
assert.throws(
  () => validateFluidTerrainFeedbackFrame({ ...feedback, fluidEpoch: -1 }),
  /fluidEpoch must be non-negative/,
  'a complete feedback frame cannot publish a poisoned fluid epoch',
);
assert.throws(
  () => validateFluidTerrainFeedbackFrame({ ...feedback, terrainEpoch: -1 }),
  /terrainEpoch must be non-negative/,
  'a complete feedback frame cannot publish a poisoned terrain epoch',
);

const representation = createFluidRepresentationFrame({
  requestedRoute: 'kaminos/fluid/representation-frame',
  effectiveRoute: 'kaminos/fluid/representation-frame',
  producerRevision: 'producer-test-revision',
  fluidEpoch: 12,
  terrainEpoch: 41,
  ownershipIdentity: ownership.identity,
  macro: {
    grid: frame.grid,
    mappedDepth: new Float32Array(6).fill(0.2),
    mappedMomentumU: new Float32Array(6),
    mappedMomentumV: new Float32Array(6),
    materialMasses: { temperature: new Float32Array(6).fill(0.01) },
    method: 'orthogonal-heightfield-hydrostatic-reconstruction-hll-v1',
  },
  local: { sourceBuffer: null, count: 0, supportScale: 0.05 },
  parcels: { sourceBuffer: null, count: 0 },
  physicalMaterial: { densityKgM3: 997, absorptionPerMeter: [0.05, 0.02, 0.01] },
  complete: true,
});
assert.equal(representation.schema, FLUID_REPRESENTATION_FRAME_SCHEMA);
assert.equal(validateFluidRepresentationFrame(representation, {
  expectedRoute: 'kaminos/fluid/representation-frame',
}).fluidEpoch, 12);
assert.throws(
  () => validateFluidRepresentationFrame({ ...representation, camera: { position: [0, 0, 0] } }),
  /camera-owned state/,
  'camera state cannot control or contaminate physical representation residency',
);
assert.throws(
  () => validateFluidRepresentationFrame({
    ...representation,
    macro: { ...representation.macro, mappedMomentumU: Float32Array.from([Number.NaN, 0, 0, 0, 0, 0]) },
  }),
  /macro\.mappedMomentumU\[0\] must be finite/,
  'non-finite macro momentum cannot publish as a complete representation',
);
assert.throws(
  () => validateFluidRepresentationFrame({
    ...representation,
    macro: { ...representation.macro, mappedMomentumV: undefined },
  }),
  /macro\.mappedMomentumV must be a typed array/,
  'a complete macro representation must include both momentum components',
);
assert.throws(
  () => validateFluidRepresentationFrame({
    ...representation,
    macro: {
      ...representation.macro,
      materialMasses: { temperature: Float32Array.from([Number.NaN, 0, 0, 0, 0, 0]) },
    },
  }),
  /macro\.materialMasses\.temperature\[0\] must be finite/,
  'transported material payloads cannot hide non-finite state',
);
assert.throws(
  () => validateFluidRepresentationFrame({ ...representation, fluidEpoch: -1 }),
  /fluidEpoch must be non-negative/,
  'a complete representation cannot publish a poisoned fluid epoch',
);
assert.throws(
  () => validateFluidRepresentationFrame({ ...representation, terrainEpoch: -1 }),
  /terrainEpoch must be non-negative/,
  'a complete representation cannot publish a poisoned terrain epoch',
);
const representationWithoutGrid = { ...representation };
delete representationWithoutGrid.grid;
assert.throws(
  () => validateFluidRepresentationFrame(representationWithoutGrid),
  /grid is required/,
  'a complete representation must retain its top-level output grid identity',
);
assert.throws(
  () => validateFluidRepresentationFrame({ ...representation, expectedSampleCount: 999 }),
  /fluid representation frame expected sample count mismatch/,
  'a complete representation cannot poison its expected sample count',
);

console.log('watershed fluid contracts passed');
