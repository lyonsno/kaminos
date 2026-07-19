import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ANALYTICAL_FORCED_RESPONSE_IDENTITY,
  FORCED_SPLAT_RESPONSE_SCHEMA,
  FORCED_SPLAT_RESPONSE_STRIDE_BYTES,
  FORCED_SPLAT_RESPONSE_STOP_CEILING_MS,
  MAX_INITIAL_RESIDUAL_SPLINE_KNOTS,
  buildAnalyticalForcedResponseReceipt,
  buildForcedSplatResponseControls,
  buildRigidTransformedHistoryControl,
  measureForcedSplatResponsePath,
  packBoundarySplatForcedResponses,
  warpBoundarySplatByForcing,
} from '../boundary-splat-forced-response.mjs';

assert.equal(FORCED_SPLAT_RESPONSE_SCHEMA, 'kaminos.boundary-splat-forced-response.v0');
assert.equal(ANALYTICAL_FORCED_RESPONSE_IDENTITY, 'boundary-splat-analytical-age-height-forcing-warp-v0');
assert.equal(MAX_INITIAL_RESIDUAL_SPLINE_KNOTS, 8, 'first residual head budget is capped at eight age/height knots');
assert.equal(FORCED_SPLAT_RESPONSE_STOP_CEILING_MS, 2.0, 'assay keeps the explicit kill ceiling visible');
assert.equal(FORCED_SPLAT_RESPONSE_STRIDE_BYTES, 64, 'the forcing side buffer stays at four vec4 values per instance');

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const motionWitness = readFileSync(new URL('../volume-boundary-splat-motion-witness.mjs', import.meta.url), 'utf8');
const greenroomSupervisor = readFileSync(new URL('../volume-boundary-splat-forced-response-greenroom.mjs', import.meta.url), 'utf8');
const greenroomFixture = JSON.parse(readFileSync(new URL('../fixtures/volume/boundary-splat-forced-response-greenroom.json', import.meta.url), 'utf8'));
assert.match(
  core,
  /BOUNDARY_SPLAT_FORCED_RESPONSE_IDENTITY\s*=\s*'boundary-splat-analytical-age-height-forcing-warp-v0'/,
  'runtime must publish the effective analytical response identity',
);
assert.match(
  motionWitness,
  /--forced-response-assay[\s\S]*captureForcedResponseAssay[\s\S]*rigidControl[\s\S]*analyticalResponse[\s\S]*imageDiff/,
  'the visual witness must capture matched rigid and analytical arms from one frozen simulator state',
);
assert.match(
  motionWitness,
  /--forced-response-renderer[\s\S]*forcedResponseRendererMode[\s\S]*'analytic'[\s\S]*forcedResponseRendererIdentity[\s\S]*SPLAT_RENDERER[\s\S]*forcedResponseExpectedModelIdentity/,
  'the forced-response visual authority must default explicitly to turbulence-bearing analytic splats',
);
assert.match(
  motionWitness,
  /routeEfficacyProbe[\s\S]*excludedFromTeacherJudgment:\s*true[\s\S]*forced-response-route-efficacy-missing/,
  'the witness must separately prove that exaggerated forcing reaches the learned-splat vertex route',
);
assert.match(
  motionWitness,
  /sampleBoundarySplatForcedResponseCostLadder[\s\S]*timestamp-query[\s\S]*stopCeilingExceeded/,
  'the witness must reject missing GPU timestamp authority and preserve the stop ceiling',
);
assert.match(
  motionWitness,
  /timestampStatus\s*!==\s*'measured'[\s\S]*forced-response-timing-unavailable/,
  'the witness must reject timing rows whose raster timestamp query was unsupported',
);
assert.match(
  motionWitness,
  /--headless[\s\S]*--headless=new[\s\S]*--enable-unsafe-webgpu[\s\S]*unsafeWebGpuEnabled/,
  'Greenroom mode must preserve and report the proven timestamp-capable Chrome route',
);
assert.match(
  motionWitness,
  /forced-response-route-disagreement[\s\S]*forced-response-timing-unavailable[\s\S]*forced-response-visual-delta-missing/,
  'the witness must fail loud on fallback routes, invisible response, and partial timing',
);
assert.match(
  motionWitness,
  /visualDeltas\.staticRigidVsAnalytical\.changedFraction\s*<=\s*0\.001[\s\S]*visualDeltas\.grazingRigidVsAnalytical\.changedFraction\s*<=\s*0\.001/,
  'physical response visibility must use flame-local changed pixels rather than a mostly-black whole-frame mean',
);
assert.match(
  motionWitness,
  /stopCeilingExceeded[\s\S]*forced-response-stop-ceiling-exceeded/,
  'the witness must stop rather than bless a measured response path above two milliseconds',
);
assert.match(
  motionWitness,
  /lastTrustworthyEvidence\.forcedResponseAssay\s*=\s*\{[\s\S]*timingRows:\s*report\.timing\?\.rows[\s\S]*visualDeltas:\s*report\.visualDeltas[\s\S]*stopCeilingExceeded:\s*report\.stopCeilingExceeded[\s\S]*\};[\s\S]*rejectForcedResponseFalseClosure\(report\)/,
  'terminal failures must retain trustworthy timing and visual evidence before false-closure validation throws',
);
assert.match(greenroomSupervisor, /kaminos\.volume\.boundary-splat-forced-response-greenroom\.v0/, 'Greenroom supervisor must publish a stable report schema');
assert.match(greenroomSupervisor, /failurePhase/, 'Greenroom supervisor must preserve the failure phase before primary output');
assert.match(
  greenroomSupervisor,
  /witnessReport\s*\?\s*'failed-after-partial-output'\s*:\s*'failed-before-primary-output'/,
  'Greenroom supervisor must not label preserved witness images as a pre-output failure',
);
assert.match(greenroomSupervisor, /lastTrustworthyEvidence/, 'Greenroom supervisor must preserve partial trustworthy evidence');
assert.match(greenroomSupervisor, /requestedRoute/, 'Greenroom supervisor must record the requested route');
assert.match(greenroomSupervisor, /effectiveRoute/, 'Greenroom supervisor must preserve the witness effective route');
assert.match(
  greenroomSupervisor,
  /forcedResponseRendererIdentity\s*\|\|\s*witnessReport\.rendererIdentity[\s\S]*timing\?\.authority\s*\|\|\s*witnessReport\.lastTrustworthyEvidence\?\.forcedResponseAssay\?\.timingAuthority/,
  'Greenroom supervisor must preserve effective renderer and timing identity from a late witness failure',
);
assert.match(greenroomSupervisor, /unsafeWebGpuEnabled/, 'Greenroom supervisor must preserve the effective timestamp-capable browser route');
assert.match(greenroomSupervisor, /--forced-response-assay/, 'Greenroom supervisor must invoke the bounded forced-response assay');
assert.match(greenroomSupervisor, /--forced-response-renderer/, 'Greenroom supervisor must pin the requested renderer mode');
assert.match(greenroomSupervisor, /--headless/, 'Greenroom supervisor must request the proven headless WebGPU route');
assert.match(greenroomSupervisor, /SIGTERM/, 'Greenroom supervisor must stop its owned HTTP server');
assert.match(
  greenroomSupervisor,
  /openSync[\s\S]*spawn\('python3'[\s\S]*closeSync/,
  'Greenroom supervisor must pass an already-open log descriptor to the HTTP child',
);
assert.equal(greenroomFixture.schema, 'kaminos.volume.boundary-splat-forced-response-greenroom-config.v0');
assert.equal(greenroomFixture.renderer, 'analytic');
assert.equal(greenroomFixture.route.volume_resolution, '160');
assert.equal(greenroomFixture.route.volume_boundary_splat_instances, '4');
assert.equal(greenroomFixture.route.volume_boundary_splat_candidate_budget, '6400');
assert.equal(greenroomFixture.route.volume_boundary_splat_phase_mode, 'age-sweep');
assert.deepEqual(greenroomFixture.costLadderInstances, [1, 16, 100]);

const packedResponse = packBoundarySplatForcedResponses([
  {
    enabled: true,
    gravityLocal: [0, -9.81, 0],
    relativeWindLocal: [-0.45, 0, -0.3],
    accelerationLagLocal: [0.08, 0, -0.02],
    sourceAttachment: 0.82,
    dtSeconds: 1 / 30,
  },
], { maxInstances: 2 });
assert.equal(packedResponse.packed.byteLength, 2 * FORCED_SPLAT_RESPONSE_STRIDE_BYTES);
assert.equal(packedResponse.activeCount, 1);
assert.deepEqual(Array.from(packedResponse.packed.slice(0, 3)), [0, 1, 0], 'world-down gravity packs an exact source-local buoyancy direction');
assert.equal(packedResponse.packed[15], 1, 'an explicit response row enables the analytical shader route');
assert.deepEqual(Array.from(packedResponse.packed.slice(16, 32)), new Array(16).fill(0), 'missing rows remain the exact rigid transformed-history control');
assert.match(
  core,
  /struct BoundarySplatForcedResponse[\s\S]*gravityAgeScale:\s*vec4<f32>[\s\S]*relativeWindAttachment:\s*vec4<f32>[\s\S]*accelerationLagOpacity:\s*vec4<f32>/,
  'runtime must keep forcing in a separate compact per-instance ABI',
);
assert.match(
  core,
  /@binding\(15\) var<storage, read> boundarySplatForcedResponses: array<BoundarySplatForcedResponse>/,
  'the response overlay must not mutate the Instance Fraud descriptor or history ABI',
);
assert.match(
  core,
  /fn boundarySplatAnalyticalForcedPosition\([\s\S]*attachmentGate[\s\S]*buoyancyResponse[\s\S]*relativeWindResponse[\s\S]*accelerationLagResponse/,
  'vertex materialization must name source attachment, buoyancy, relative wind, and acceleration lag',
);
assert.match(
  core,
  /let rigidTransformedPosition = splat\.positionSupport\.xyz \* instanceScale \+ descriptor\.transform\.xyz;[\s\S]*boundarySplatAnalyticalForcedPosition\(rigidTransformedPosition, splat, descriptor, forcedResponse\)/,
  'analytical forcing must layer after the exact rigid transformed-history control',
);
assert.match(
  core,
  /boundarySplatForcedResponseEffectiveRoute[\s\S]*requestedRoute[\s\S]*effectiveRoute[\s\S]*gpu-timestamp/,
  'human-visible timing receipts must distinguish the requested response route from GPU timestamp authority',
);
assert.match(
  core,
  /async function sampleBoundarySplatForcedResponseCostLadder\(options = \{\}\)[\s\S]*counts:\s*\[1, 16, 100\][\s\S]*rigidControl[\s\S]*analyticalResponse[\s\S]*incrementalRasterMs[\s\S]*controlUploadMs[\s\S]*completeResponseMs[\s\S]*stopCeilingMs:\s*2/,
  'runtime must measure matched rigid and analytical complete paths at 1, 16, and 100 instances',
);
assert.doesNotMatch(
  core,
  /incrementalRasterMs\s*=\s*[^;]*Math\.max\(0,\s*analyticalRasterMs\s*-\s*rigidRasterMs\)/,
  'negative analytical-minus-rigid deltas are measurement noise, not zero-cost response evidence',
);
assert.match(
  core,
  /signedRasterDeltaMs[\s\S]*timingNoiseFloor[\s\S]*incrementalRasterMs[\s\S]*timing-noise-floor/,
  'timing ladder must retain a signed delta and fail loud when serial raster noise reverses it',
);
assert.match(core, /Number\.isFinite\(incrementalRasterMs\)/, 'complete response must require a finite non-negative raster delta');
assert.match(
  core,
  /const splatRasterMs = profile\.stages\?\.splatRaster\?\.ms;[\s\S]*Number\.isFinite\(splatRasterMs\)/,
  'missing raster timing must remain unavailable instead of Number(null) becoming zero milliseconds',
);
assert.match(
  core,
  /setBoundarySplatForcedResponses,[\s\S]*sampleBoundarySplatForcedResponseCostLadder,[\s\S]*boundarySplatForcedResponseReceipt/,
  'the public prototype must expose forcing input, matched timing, and route receipts to the witness',
);

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
