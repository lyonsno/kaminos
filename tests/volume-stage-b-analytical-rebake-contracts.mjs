import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const baselineManifestSource = readFileSync(new URL('../volume-stage-b-provisional-manifest.mjs', import.meta.url), 'utf8');
const moduleUrl = new URL('../volume-stage-b-analytical-rebake.mjs', import.meta.url);
const cockpitUrl = new URL('../volume-stage-b-rebake-cockpit.html', import.meta.url);
const serverUrl = new URL('../volume-stage-b-rebake-server.mjs', import.meta.url);
const queueUrl = new URL('../volume-stage-b-rebake-queue.mjs', import.meta.url);
const witnessUrl = new URL('../volume-stage-b-rebake-witness.mjs', import.meta.url);
const ledgerGeneratorUrl = new URL('../volume-stage-b-rebake-ledger.mjs', import.meta.url);

const mandatoryControls = [
  'volume_reaction_boundary_fire_tip',
  'volume_reaction_boundary_topology',
  'volume_reaction_boundary_fire_erosion',
  'volume_reaction_boundary_cut',
  'volume_reaction_boundary_softness',
  'volume_reaction_boundary_core_reject',
  'volume_reaction_boundary_support_thermal',
  'volume_reaction_boundary_support_reaction',
  'volume_reaction_boundary_support_front',
  'volume_reaction_boundary_support_interface',
  'volume_reaction_boundary_fire_ridge',
  'volume_reaction_boundary_fire_ridge_cut',
  'volume_reaction_boundary_curl',
  'volume_reaction_boundary_divergence',
];

assert.equal(
  mandatoryControls.filter(control => baselineManifestSource.includes(control)).length,
  0,
  'pre-fix Stage B manifest must remain an explicit frozen-control no-op witness',
);
assert.ok(
  existsSync(moduleUrl),
  'pre-fix Stage B no-op: analytical rebake producer is absent for fire_tip and topology',
);

const {
  MANDATORY_STAGE_B_CONTROLS,
  PRODUCTION_STAGE_B_FIXED,
  boundarySupportFromFrozenCell,
  defaultStageBControls,
  productionBoundaryGradient,
  rebakeAnalyticalStageB,
} = await import(moduleUrl.href);

assert.deepEqual(MANDATORY_STAGE_B_CONTROLS, mandatoryControls);
assert.deepEqual(PRODUCTION_STAGE_B_FIXED, {
  identity: 'state120-integration-c5367d2a-boundary-fixed-v0',
  authority: {
    integrationCommit: 'c5367d2a76bbc3c90b32cbbb04764b6c6cda568b',
    cockpitManifestSha256: '8eaab98dc8591038d169063ac52e3c467eeaaa0aa8386b6f90ef494cc13f10f9',
    controlsSha256: '4df68da037500e4b1a7b046b48f7927708642cc6294102a3c46f1acb3e01a7e7',
    integrationBaselineBoundarySidecarSha256: '33a6943c6a2cb644f244d5edeeb544dbce52d0cef98e3fb9d705abd49b941216',
  },
  analyticalBoundarySource: 'live-recomputed-from-frozen-fluid-front',
  integrationBaselineBoundarySource: 'baked',
  gradientGain: 1.05,
  sidecarStepFootprintWidth: 0,
  displayContrast: 0.6,
  displayGamma: 3,
  displayOpacity: 3,
  inspectBoundaryFireMask: 1,
  cleanBlue: 0.3,
  sootYield: 0.64,
  sootYellowing: 0.44,
  thermalWarmth: 0.16,
  fireLuma: 5,
});
assert.equal(productionBoundaryGradient(3, 1, 0, 0, 0, 0, 160), 80, 'production gradient must include 0.5 / boundaryCellStep');

const supportChannels = new Float32Array(16);
const supportFrontField = new Float32Array(1);
const interfaceOnly = {
  ...defaultStageBControls(),
  volume_reaction_boundary_support_thermal: 0,
  volume_reaction_boundary_support_reaction: 0,
  volume_reaction_boundary_support_front: 0,
  volume_reaction_boundary_support_interface: 2,
};
supportChannels[7] = 1;
assert.equal(
  boundarySupportFromFrozenCell(supportChannels, supportFrontField, 0, interfaceOnly),
  0,
  'material.w/channel 7 must not impersonate production microLayer.w interface support',
);
supportChannels[7] = 0;
supportChannels[15] = 1;
assert.ok(
  boundarySupportFromFrozenCell(supportChannels, supportFrontField, 0, interfaceOnly) > 0,
  'production microLayer.w/channel 15 must reach interface support',
);

function tinyFrozenState(grid = 7) {
  const cellCount = grid ** 3;
  const fluid = new Float32Array(cellCount * 16);
  const front = new Float32Array(cellCount);
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const cell = x + y * grid + z * grid * grid;
        const offset = cell * 16;
        const radial = Math.hypot(x - 3, z - 3);
        const plume = Math.max(0, 1 - radial / 3.2) * Math.max(0, 1 - Math.abs(y - 3) / 4);
        fluid[offset] = (z - 3) * 0.025;
        fluid[offset + 1] = 0.04 + y * 0.018;
        fluid[offset + 2] = (3 - x) * 0.022;
        fluid[offset + 3] = plume * 0.32;
        fluid[offset + 4] = plume * 0.18;
        fluid[offset + 5] = plume * (0.28 + y * 0.05);
        fluid[offset + 6] = plume * Math.max(0.01, 0.24 - y * 0.025);
        fluid[offset + 7] = plume * 0.14;
        fluid[offset + 8] = plume * 0.52;
        fluid[offset + 9] = plume * 0.16;
        fluid[offset + 10] = plume * 0.48;
        fluid[offset + 11] = plume * (0.10 + y * 0.035);
        fluid[offset + 12] = plume * 0.11;
        fluid[offset + 13] = plume * (0.08 + Math.abs(x - 3) * 0.025);
        fluid[offset + 14] = plume * (0.10 + y * 0.026);
        fluid[offset + 15] = plume * 0.07;
        front[cell] = plume * (0.12 + y * 0.018);
      }
    }
  }
  return {
    grid,
    fluid,
    front,
    source: {
      stateId: 'fixture-state-120',
      fluidSha256: 'a'.repeat(64),
      frontSha256: 'b'.repeat(64),
      cameraIdentity: 'state120-cockpit-fixed-camera-v0',
    },
  };
}

const state = tinyFrozenState();
const baselineControls = {
  ...defaultStageBControls(),
  volume_reaction_boundary_cut: 0.015,
  volume_reaction_boundary_softness: 0.045,
  volume_reaction_boundary_core_reject: 0.5,
};
const baseline = await rebakeAnalyticalStageB({ state, controls: baselineControls, width: 48, height: 48 });
const fireTip = await rebakeAnalyticalStageB({
  state,
  controls: { ...baselineControls, volume_reaction_boundary_fire_tip: 0 },
  width: 48,
  height: 48,
});
const topology = await rebakeAnalyticalStageB({
  state,
  controls: { ...baselineControls, volume_reaction_boundary_topology: 2.5 },
  width: 48,
  height: 48,
});
const supportFront = await rebakeAnalyticalStageB({
  state,
  controls: { ...baselineControls, volume_reaction_boundary_support_front: 2 },
  width: 48,
  height: 48,
});

for (const treatment of [fireTip, topology]) {
  assert.equal(treatment.receipt.sourceStateIdentity, baseline.receipt.sourceStateIdentity, 'control rebake must preserve frozen source identity');
  assert.notEqual(treatment.receipt.stageBIdentity, baseline.receipt.stageBIdentity, 'control rebake must change Stage B identity');
  assert.notEqual(treatment.receipt.coefficientIdentity, baseline.receipt.coefficientIdentity, 'control rebake must change analytical coefficients');
  assert.notEqual(treatment.receipt.depositionIdentity, baseline.receipt.depositionIdentity, 'control rebake must change deposition inputs');
  assert.notEqual(treatment.receipt.pixelIdentity, baseline.receipt.pixelIdentity, 'control rebake must reach shared-optics pixels');
  assert.equal(treatment.receipt.fallback, null);
  assert.equal(treatment.receipt.postLoadMutation, 'analytical-rebake-only');
}
assert.notEqual(supportFront.receipt.covarianceIdentity, baseline.receipt.covarianceIdentity, 'support rebake must change flow-frame covariance');
assert.notEqual(supportFront.receipt.depositionIdentity, baseline.receipt.depositionIdentity, 'support rebake must change five-tap deposition inputs');

assert.notEqual(fireTip.receipt.candidateIdentity, baseline.receipt.candidateIdentity, 'fire_tip must reach candidate membership or support weight');
assert.notEqual(topology.receipt.candidateIdentity, baseline.receipt.candidateIdentity, 'topology must reach candidate membership or support weight');
assert.deepEqual(
  baseline.receipt.controlStatus.map(row => [row.control, row.status]),
  mandatoryControls.map(control => [control, 'rebake-coupled']),
);
assert.equal(baseline.receipt.opticalLayers, 16);
assert.equal(baseline.receipt.appliedPasses.includes('shared-optics-recurrence'), true);
assert.deepEqual(baseline.receipt.fixedProductionControls, PRODUCTION_STAGE_B_FIXED);
assert.match(baseline.receipt.fixedProductionControlsIdentity, /^[0-9a-f]{64}$/);

assert.ok(
  existsSync(queueUrl),
  'stale-response falsifier: Stage B server lacks a serialized request-local rebake runner',
);
const { createSerializedRebakeRunner } = await import(queueUrl.href);
const queueEvents = [];
const queuedRunner = createSerializedRebakeRunner({
  rebake: async controls => {
    queueEvents.push(`start:${controls.id}`);
    await Promise.resolve();
    queueEvents.push(`rebaked:${controls.id}`);
    return { receipt: { requestedControls: { ...controls } }, pixels: new Uint8ClampedArray([controls.id]) };
  },
  persist: async ({ result }) => {
    queueEvents.push(`persist:${result.receipt.requestedControls.id}`);
    await Promise.resolve();
  },
});
const queuedRequests = [{ id: 1 }, { id: 2 }, { id: 3 }];
const queuedResults = await Promise.all(queuedRequests.map(controls => queuedRunner.run(controls)));
assert.deepEqual(
  queuedResults.map(result => result.receipt.requestedControls.id),
  [1, 2, 3],
  'overlapping callers must each receive their request-local rebake result',
);
assert.deepEqual(queueEvents, [
  'start:1', 'rebaked:1', 'persist:1',
  'start:2', 'rebaked:2', 'persist:2',
  'start:3', 'rebaked:3', 'persist:3',
]);
assert.equal(queuedRunner.completedCount, 3);

await assert.rejects(
  rebakeAnalyticalStageB({ state: { ...state, front: null }, controls: baselineControls }),
  /stage-b-rebake-missing-input:front/,
);
await assert.rejects(
  rebakeAnalyticalStageB({ state: { ...state, source: { ...state.source, cameraIdentity: null } }, controls: baselineControls }),
  /stage-b-rebake-missing-input:cameraIdentity/,
);

for (const [url, label] of [[cockpitUrl, 'cockpit'], [serverUrl, 'server'], [witnessUrl, 'witness'], [ledgerGeneratorUrl, 'ledger generator']]) {
  assert.ok(existsSync(url), `Stage B analytical rebake ${label} is missing`);
}
const cockpit = readFileSync(cockpitUrl, 'utf8');
const server = readFileSync(serverUrl, 'utf8');
const witness = readFileSync(witnessUrl, 'utf8');
const ledgerGenerator = readFileSync(ledgerGeneratorUrl, 'utf8');
assert.match(cockpit, /rebake-coupled/, 'cockpit must expose per-control coupling status');
assert.match(cockpit, /sourceStateIdentity/, 'cockpit must expose frozen source identity');
assert.match(cockpit, /candidateIdentity/, 'cockpit must expose candidate identity');
assert.match(cockpit, /coefficientIdentity/, 'cockpit must expose coefficient identity');
assert.match(cockpit, /covarianceIdentity/, 'cockpit must expose covariance identity');
assert.match(cockpit, /depositionIdentity/, 'cockpit must expose deposition identity');
assert.match(cockpit, /pixelIdentity/, 'cockpit must expose shared-optics pixel identity');
assert.match(server, /stage-b-rebake-missing-input/, 'server must preserve fail-loud input diagnostics');
assert.match(server, /coefficient-state-120-source-field-manifest\.json/, 'server must bind the exact State-120 source manifest');
assert.match(server, /EXPECTED_FLUID_CHANNEL_ORDER[^]*fluidChannelOrder/, 'server must reject source-field channel-order drift');
assert.match(server, /integrationBaselineBoundarySidecarSha256/, 'server must bind the original baked boundary-sidecar identity');
assert.match(witness, /effectiveRoute[^]*requestedRoute/, 'witness must record requested and effective routes');
assert.match(witness, /requestedRouteUrl/, 'witness target selection must derive from the requested route');
assert.match(witness, /assert\.equal\(effectiveRoute, requestedRouteUrl\.href/, 'witness must reject requested/effective route mismatch');
assert.match(witness, /sourceStateIdentity[^]*source-state-drift/, 'witness must reject frozen source-state drift');
assert.match(witness, /nonblank[^]*blank-frame/, 'witness must reject blank captures');
assert.match(witness, /meanAbsoluteChannelDelta/, 'witness must calculate treatment pixel deltas');
assert.match(witness, /Runtime\.exceptionThrown/, 'witness must audit browser exceptions');
assert.match(witness, /failurePhase[^]*lastTrustworthyEvidence/, 'witness must write durable pre-output failure context');
assert.match(ledgerGenerator, /MANDATORY_STAGE_B_CONTROLS/, 'ledger must enumerate exactly the mandatory control set');
assert.match(ledgerGenerator, /sourceStateIdentity[^]*source-state-drift/, 'ledger must reject per-control source drift');
assert.match(ledgerGenerator, /meanAbsoluteChannelDelta/, 'ledger must record per-control pixel deltas');
assert.match(ledgerGenerator, /requestedControls[^]*effectiveControls/, 'ledger must preserve requested/effective control identity');
assert.match(
  ledgerGenerator,
  /fixedProductionControlsIdentity[^]*fixed-production-controls-drift/,
  'ledger must preserve and compare the production fixed-control identity for every perturbation',
);

console.log('Stage B analytical rebake contracts passed');
