import assert from 'node:assert/strict';

import * as contracts from '@kaminos/fluid-contracts';
import * as fluid from '@kaminos/fluid-webgpu';

assert.equal(
  typeof contracts.createTerrainRemapReceipt,
  'function',
  'fluid contracts must publish a terrain-remap receipt constructor',
);
assert.equal(
  typeof contracts.validateTerrainRemapReceipt,
  'function',
  'fluid contracts must publish a terrain-remap receipt validator',
);

function makeTerrain({
  width = 4,
  height = 3,
  spacing = [0.25, 0.25],
  origin = [0, 0, 0],
  bed = new Array(width * height).fill(0),
  priorEpoch = 0,
  currentEpoch = 1,
  motionClass = 'stable',
  terrainId = 'phase-hills',
  transformId = 'phase-hills-chart-v1',
  sourceId = 'phase-hills-live',
  producerId = 'phase-hills-producer',
  producerRevision = 'phase-hills-revision',
  supportVelocity = new Float64Array(width * height * 3),
  tangentU,
  tangentV,
  normal,
  motionSubstepEnvelope = null,
  shockId = null,
} = {}) {
  const sampleCount = width * height;
  const defaultTangentU = new Float64Array(sampleCount * 3);
  const defaultTangentV = new Float64Array(sampleCount * 3);
  const defaultNormal = new Float64Array(sampleCount * 3);
  for (let index = 0; index < sampleCount; index += 1) {
    defaultTangentU[index * 3] = 1;
    defaultTangentV[index * 3 + 2] = 1;
    defaultNormal[index * 3 + 1] = 1;
  }
  return contracts.createTerrainFluidFrame({
    requestedRoute: 'lerms/hill-of-hills/terrain-fluid-frame',
    effectiveRoute: 'lerms/hill-of-hills/terrain-fluid-frame',
    producerId,
    producerRevision,
    requestedSourceId: sourceId,
    effectiveSourceId: sourceId,
    worldMetersPerUnit: 1,
    gravity: [0, -9.81, 0],
    terrainId,
    supportClass: 'heightfield',
    transformId,
    priorEpoch,
    currentEpoch,
    motionClass,
    shockId,
    grid: { width, height, spacing, origin },
    fields: {
      bedHeight: Float64Array.from(bed),
      jacobian: new Float64Array(sampleCount).fill(1),
      gradient: new Float64Array(sampleCount * 2),
      tangentU: tangentU ?? defaultTangentU,
      tangentV: tangentV ?? defaultTangentV,
      normal: normal ?? defaultNormal,
      supportVelocity,
      valid: new Uint8Array(sampleCount).fill(1),
    },
    dirtyRegions: [{ x: 0, y: 0, width, height }],
    motionSubstepEnvelope,
    complete: true,
  });
}

function phaseFrame(previous, {
  bedDelta = 0.01,
  supportSpeed = 0.6,
  deltaSeconds = 1 / 60,
  ...overrides
} = {}) {
  const count = previous.grid.width * previous.grid.height;
  const supportVelocity = new Float64Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    supportVelocity[index * 3 + 1] = supportSpeed;
  }
  return makeTerrain({
    width: previous.grid.width,
    height: previous.grid.height,
    spacing: previous.grid.spacing,
    origin: previous.grid.origin,
    bed: Array.from(previous.fields.bedHeight, value => value + bedDelta),
    priorEpoch: previous.currentEpoch,
    currentEpoch: previous.currentEpoch + 1,
    motionClass: 'phase_morph',
    terrainId: previous.terrainId,
    transformId: previous.transformId,
    sourceId: previous.source.effective,
    producerId: previous.producer.id,
    producerRevision: `${previous.producer.revision}-next`,
    supportVelocity,
    tangentU: previous.fields.tangentU,
    tangentV: previous.fields.tangentV,
    normal: previous.fields.normal,
    motionSubstepEnvelope: deltaSeconds,
    ...overrides,
  });
}

const initialTerrain = makeTerrain();
assert.throws(
  () => contracts.validateTerrainFluidFrame(
    phaseFrame(initialTerrain, { motionSubstepEnvelope: null }),
  ),
  /phase_morph.*substep envelope/i,
  'phase-morph frames without a source motion envelope fail closed',
);
const runtime = fluid.createKaminosFluidRuntime({
  terrainFrame: initialTerrain,
  depth: new Float64Array(initialTerrain.expectedSampleCount),
  producerRevision: 'phase-remap-test',
});
const depositReceipt = runtime.depositLocal({
  transactionId: 'phase-hill-deposit-1',
  lineageId: 'phase-hill-waterfall-1',
  fluidEpoch: 1,
  allocationGeneration: 1,
  supportId: initialTerrain.terrainId,
  transformId: initialTerrain.transformId,
  deposits: [
    { x: 1, y: 1, volume: 0.02, momentum: [0.03, 0, -0.01] },
    { x: 2, y: 1, volume: 0.01, momentum: [0.01, 0, 0.02] },
  ],
  debitedMaterials: { temperature: 3.5, salinity: 0.08 },
});
const before = runtime.snapshot();
const nextTerrain = phaseFrame(initialTerrain);
const remapReceipt = runtime.updateTerrain({
  terrainFrame: nextTerrain,
  deltaSeconds: 1 / 60,
  maximumBedDisplacement: 0.02,
  maximumSupportSpeed: 1,
  fluidDensityKgM3: 997,
});

assert.equal(remapReceipt.schema, contracts.TERRAIN_REMAP_RECEIPT_SCHEMA);
assert.equal(contracts.validateTerrainRemapReceipt(remapReceipt).state, 'committed');
assert.equal(remapReceipt.mode, 'phase_morph');
assert.equal(remapReceipt.previousTerrainEpoch, 1);
assert.equal(remapReceipt.terrainEpoch, 2);
assert.equal(remapReceipt.fluidEpoch, before.fluidEpoch);
assert.equal(remapReceipt.residual.volume, 0);
assert.deepEqual(remapReceipt.residual.momentum, [0, 0, 0]);
assert.deepEqual(remapReceipt.residual.materials, { temperature: 0, salinity: 0 });
assert.ok(remapReceipt.displacedVolume > 0, 'a rising wet support records positive swept volume');
assert.ok(remapReceipt.supportWork > 0, 'a rising wet support records positive support work');
assert.deepEqual(remapReceipt.predecessorReceiptIds, [depositReceipt.transactionId]);
assert.deepEqual(remapReceipt.lineageIds, [depositReceipt.lineageId]);
assert.throws(
  () => contracts.validateTerrainRemapReceipt({
    ...remapReceipt,
    residual: { ...remapReceipt.residual, volume: 0.01 },
  }),
  /volume residual exceeds tolerance/,
  'a poisoned committed remap receipt cannot masquerade as conservation evidence',
);

const after = runtime.snapshot();
assert.equal(after.terrainEpoch, 2);
assert.equal(after.fluidEpoch, before.fluidEpoch, 'terrain remap does not impersonate a fluid step');
assert.deepEqual(after.mappedDepth, before.mappedDepth, 'phase remap preserves mapped volume storage');
assert.deepEqual(after.mappedMomentumU, before.mappedMomentumU, 'phase remap preserves tangent-U momentum');
assert.deepEqual(after.mappedMomentumV, before.mappedMomentumV, 'phase remap preserves tangent-V momentum');
assert.deepEqual(after.materialMasses, before.materialMasses, 'phase remap preserves transported material masses');

const feedback = runtime.feedback();
const representation = runtime.representation();
for (const frame of [feedback, representation]) {
  assert.equal(frame.terrainEpoch, 2);
  assert.deepEqual(
    frame.conservationReceiptIds,
    [depositReceipt.transactionId, remapReceipt.receiptId],
    'canonical outputs preserve the deposit plus remap receipt chain',
  );
  assert.deepEqual(
    frame.lineageIds,
    [depositReceipt.lineageId],
    'canonical outputs preserve the original deposit lineage',
  );
}

const stepReceipt = runtime.step({ terrainFrame: nextTerrain, deltaSeconds: 1 / 240 });
assert.ok(stepReceipt.fluidEpoch > before.fluidEpoch, 'fluid continues from remapped state without reinitialization');
assert.equal(runtime.identity.terrainEpoch, 2);
assert.equal(runtime.identity.fluidEpoch, stepReceipt.fluidEpoch);
assert.deepEqual(runtime.representation().lineageIds, [depositReceipt.lineageId]);

function snapshotIdentity(value) {
  return {
    identity: { ...value.identity },
    state: value.snapshot(),
    receiptIds: value.feedback().conservationReceiptIds,
    lineageIds: value.feedback().lineageIds,
  };
}

function assertRejectedWithoutMutation(makeRejectedFrame, options, pattern, label) {
  const beforeFailure = snapshotIdentity(runtime);
  assert.throws(
    () => runtime.updateTerrain({
      terrainFrame: makeRejectedFrame(),
      deltaSeconds: 1 / 60,
      maximumBedDisplacement: 0.02,
      maximumSupportSpeed: 1,
      fluidDensityKgM3: 997,
      ...options,
    }),
    pattern,
    label,
  );
  assert.deepEqual(snapshotIdentity(runtime), beforeFailure, `${label}: rejected update mutated runtime state`);
}

assertRejectedWithoutMutation(
  () => phaseFrame(nextTerrain, { priorEpoch: 1, currentEpoch: 3 }),
  {},
  /prior epoch.*current terrain epoch/,
  'non-sequential prior epoch is rejected',
);
assertRejectedWithoutMutation(
  () => phaseFrame(nextTerrain, { currentEpoch: 2 }),
  {},
  /newer epoch|stale/i,
  'stale terrain epoch is rejected',
);
assertRejectedWithoutMutation(
  () => phaseFrame(nextTerrain, { spacing: [0.3, 0.25] }),
  {},
  /grid spacing changed/,
  'grid spacing change is rejected',
);
assertRejectedWithoutMutation(
  () => phaseFrame(nextTerrain, { terrainId: 'other-hills' }),
  {},
  /terrain identity changed/,
  'topology identity change is rejected',
);
assertRejectedWithoutMutation(
  () => phaseFrame(nextTerrain, { transformId: 'other-chart' }),
  {},
  /chart transform changed/,
  'chart change is rejected',
);
assertRejectedWithoutMutation(
  () => phaseFrame(nextTerrain, { sourceId: 'fallback-hills' }),
  {},
  /source identity changed/,
  'source change is rejected',
);
assertRejectedWithoutMutation(
  () => {
    const count = nextTerrain.expectedSampleCount;
    const tangentU = new Float64Array(count * 3);
    const tangentV = new Float64Array(count * 3);
    const normal = new Float64Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      tangentU[index * 3 + 2] = 1;
      tangentV[index * 3] = -1;
      normal[index * 3 + 1] = 1;
    }
    return phaseFrame(nextTerrain, { tangentU, tangentV, normal });
  },
  {},
  /basis rotation/,
  'unsupported chart-basis rotation is rejected',
);
assertRejectedWithoutMutation(
  () => phaseFrame(nextTerrain, { motionClass: 'shock_reset', shockId: 'hill-shock-3' }),
  {},
  /shock_reset/,
  'shock terrain is rejected',
);
assertRejectedWithoutMutation(
  () => phaseFrame(nextTerrain, { bedDelta: 0.08 }),
  {},
  /bed displacement/,
  'excessive bed displacement is rejected',
);
assertRejectedWithoutMutation(
  () => phaseFrame(nextTerrain, { supportSpeed: 2 }),
  {},
  /support speed/,
  'excessive support speed is rejected',
);
assertRejectedWithoutMutation(
  () => phaseFrame(nextTerrain, { deltaSeconds: 1 / 120 }),
  { deltaSeconds: 1 / 60 },
  /substep envelope/,
  'caller timestep beyond the source envelope is rejected',
);

console.log('watershed phase morph remap passed');
