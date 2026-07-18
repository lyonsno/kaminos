import assert from 'node:assert/strict';
import {
  ANALYTICAL_FORCED_RESPONSE_IDENTITY,
  FORCED_SPLAT_RESPONSE_SCHEMA,
  FORCED_SPLAT_RESPONSE_STOP_CEILING_MS,
  MAX_INITIAL_RESIDUAL_SPLINE_KNOTS,
  buildAnalyticalForcedResponseReceipt,
  buildForcedSplatResponseControls,
  buildRigidTransformedHistoryControl,
  measureForcedSplatResponsePath,
  warpBoundarySplatByForcing,
} from '../boundary-splat-forced-response.mjs';

assert.equal(FORCED_SPLAT_RESPONSE_SCHEMA, 'kaminos.boundary-splat-forced-response.v0');
assert.equal(ANALYTICAL_FORCED_RESPONSE_IDENTITY, 'boundary-splat-analytical-age-height-forcing-warp-v0');
assert.equal(MAX_INITIAL_RESIDUAL_SPLINE_KNOTS, 8, 'first residual head budget is capped at eight age/height knots');
assert.equal(FORCED_SPLAT_RESPONSE_STOP_CEILING_MS, 2.0, 'assay keeps the explicit kill ceiling visible');

const descriptor = {
  schema: 'boundary-splat-instance-descriptor-v0',
  historySchema: 'boundary-splat-live-history-ring-v0',
  instanceId: 'forced-plume-a',
  sourceAttachment: 0.82,
  transform: {
    translation: [0.18, 0.0, -0.04],
    yawRadians: 0.35,
    scale: 1.0,
  },
  history: {
    source: 'canonical-live-history-slot',
    slot: 3,
    effectiveHistoryOffsetFrames: 20,
    authority: 'live-gpu-candidate-history-ring',
  },
};

const splat = {
  position: [0.08, 0.58, -0.03],
  highFrequencyOffset: [0.011, -0.007, 0.017],
  shape: [0.016, 0.035, 0.4, 0.9],
  colorOpacity: [0.74, 0.39, 0.11, 0.023],
  age: 0.47,
  height: 0.72,
};

const controls = buildForcedSplatResponseControls({
  descriptor,
  dtSeconds: 1 / 30,
  gravityWorld: [0, -9.81, 0],
  windWorld: [0.7, 0.0, -0.2],
  objectLinearVelocityWorld: [1.15, 0, 0.1],
  objectLinearAccelerationWorld: [-3.4, 0, 0.0],
  objectAngularVelocityWorld: [0, 1.8, 0],
  recentForcing: [
    { dtSeconds: 1 / 30, linearAccelerationWorld: [-2.0, 0, 0.0], windWorld: [0.4, 0, -0.1] },
    { dtSeconds: 1 / 30, linearAccelerationWorld: [-3.4, 0, 0.0], windWorld: [0.7, 0, -0.2] },
  ],
});

assert.equal(controls.schema, 'kaminos.boundary-splat-forced-controls.v0');
assert.equal(controls.effectiveControlIdentity, 'object-motion-gravity-wind-source-local-forcing-v0');
assert.deepEqual(controls.descriptorIdentity, {
  schema: 'boundary-splat-instance-descriptor-v0',
  historySchema: 'boundary-splat-live-history-ring-v0',
  historyAuthority: 'live-gpu-candidate-history-ring',
  instanceId: 'forced-plume-a',
});
assert.ok(controls.relativeWindLocal[0] < 0, 'relative wind is measured against object motion, not copied from world wind');
assert.ok(controls.accelerationLagLocal[0] > 0, 'acceleration lag pushes flame envelope opposite sudden object acceleration');
assert.equal(controls.usesDenseGridInference, false);
assert.equal(controls.usesPerSplatNeuralInference, false);
assert.equal(controls.predictsLongHorizonTurbulence, false);

const rigid = buildRigidTransformedHistoryControl(splat, descriptor);
const warped = warpBoundarySplatByForcing(splat, descriptor, controls);

assert.deepEqual(
  warped.highFrequencyOffset,
  splat.highFrequencyOffset,
  'analytical forcing warp preserves canonical high-frequency turbulent residuals exactly',
);
assert.deepEqual(
  warped.canonicalPositionBeforeResponse,
  rigid.position,
  'forcing is layered after the rigid transformed-history control rather than replacing history motion',
);
assert.notDeepEqual(warped.position, rigid.position, 'analytical warp must visibly differ from rigid transformed-history under forcing');
assert.ok(warped.lowFrequencyResponse[1] > 0, 'world gravity produces an upward buoyancy response for mature high splats');
assert.ok(warped.sourceAttachmentRetention > 0.5, 'young/source-attached splats keep base attachment instead of sliding as free smoke');
assert.ok(warped.shape[1] > rigid.shape[1], 'age/height forcing stretches the vertical envelope without touching turbulent identity');
assert.ok(warped.colorOpacity[3] <= splat.colorOpacity[3], 'acceleration lag may thin opacity but must not invent extra fire authority');
assert.equal(warped.responseIdentity, ANALYTICAL_FORCED_RESPONSE_IDENTITY);

const receipt = buildAnalyticalForcedResponseReceipt({
  requestedRoute: 'forced-response-assay-test',
  effectiveRoute: 'forced-response-assay-test',
  descriptor,
  controls,
  splatCount: 1,
  instanceCount: 1,
});
assert.equal(receipt.schema, FORCED_SPLAT_RESPONSE_SCHEMA);
assert.equal(receipt.status, 'analytical-control');
assert.equal(receipt.requestedRoute, 'forced-response-assay-test');
assert.equal(receipt.effectiveRoute, 'forced-response-assay-test');
assert.equal(receipt.modelIdentity, 'none-analytical-only');
assert.deepEqual(receipt.neuralInference, {
  perSplat: false,
  denseFullGrid: false,
  longHorizonTurbulence: false,
  residualHead: 'not-admitted',
  residualSplineKnotBudget: 8,
  deformationLattice: 'not-admitted',
});
assert.deepEqual(receipt.requiredWitnessArms, [
  'rigid-transformed-history-control',
  'analytical-age-height-forcing-warp',
]);

const bench = measureForcedSplatResponsePath({
  descriptors: Array.from({ length: 100 }, (_, index) => ({
    ...descriptor,
    instanceId: `forced-plume-${index}`,
    transform: {
      translation: [(index % 10) * 0.04, 0, Math.floor(index / 10) * 0.04],
      yawRadians: index * 0.01,
      scale: 0.92 + (index % 4) * 0.03,
    },
  })),
  splats: Array.from({ length: 128 }, (_, index) => ({
    ...splat,
    position: [0.04 * Math.sin(index), 0.15 + (index % 32) / 31, 0.04 * Math.cos(index * 0.7)],
    highFrequencyOffset: [0.002 * Math.sin(index * 4.1), 0.002 * Math.cos(index * 2.3), 0.002 * Math.sin(index * 1.7)],
    age: (index % 29) / 28,
    height: (index % 32) / 31,
  })),
  forcing: {
    dtSeconds: 1 / 30,
    gravityWorld: [0, -9.81, 0],
    windWorld: [0.45, 0.0, -0.25],
    objectLinearVelocityWorld: [0.8, 0, 0],
    objectLinearAccelerationWorld: [-1.8, 0, 0.4],
    objectAngularVelocityWorld: [0, 1.2, 0],
  },
  instanceCounts: [1, 16, 100],
  iterations: 5,
});

assert.equal(bench.schema, 'kaminos.boundary-splat-forced-response-cost.v0');
assert.deepEqual(bench.instanceCounts, [1, 16, 100]);
assert.equal(bench.rows.length, 3);
assert.ok(bench.rows.every(row => row.completeResponseMs >= 0), 'cost rows measure complete response path');
assert.ok(bench.rows.every(row => row.stopCeilingMs === 2.0), 'cost rows preserve kill ceiling');
assert.ok(bench.rows.every(row => row.targetMs === 1.0 && row.firstFrontierMs === 1.5), 'cost rows preserve target/frontier gates');
assert.ok(bench.rows.every(row => row.effectiveRoute === ANALYTICAL_FORCED_RESPONSE_IDENTITY), 'rows report effective route identity');
assert.ok(bench.rows.every(row => row.usesDenseGridInference === false && row.usesPerSplatNeuralInference === false), 'benchmark cannot hide forbidden inference routes');
assert.ok(bench.rows[2].instanceCount === 100 && bench.rows[2].appliedSplatCount === 12800, '100-instance row measures full descriptor by splat population');
assert.ok(bench.rows.every(row => row.stageProfile?.controlCompressionMs >= 0), 'cost rows split control compression timing');
assert.ok(bench.rows.every(row => row.stageProfile?.responseMaterializationMs >= 0), 'cost rows split response materialization timing');
if (bench.rows.some(row => row.status === 'stop-ceiling-exceeded')) {
  assert.ok(bench.rows.some(row => row.dominantStage === 'responseMaterialization'), 'over-ceiling rows name the narrower measured stage');
  assert.match(bench.boundedRepair, /WGSL response materialization/, 'over-ceiling CPU proxy names the bounded GPU materialization repair');
}

console.log('boundary splat forced response contracts passed');
