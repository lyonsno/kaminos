import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const baselineManifestSource = readFileSync(new URL('../volume-stage-b-provisional-manifest.mjs', import.meta.url), 'utf8');
const moduleUrl = new URL('../volume-stage-b-analytical-rebake.mjs', import.meta.url);
const cockpitUrl = new URL('../volume-stage-b-rebake-cockpit.html', import.meta.url);
const serverUrl = new URL('../volume-stage-b-rebake-server.mjs', import.meta.url);
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
  defaultStageBControls,
  rebakeAnalyticalStageB,
} = await import(moduleUrl.href);

assert.deepEqual(MANDATORY_STAGE_B_CONTROLS, mandatoryControls);

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
assert.match(witness, /effectiveRoute[^]*requestedRoute/, 'witness must record requested and effective routes');
assert.match(witness, /sourceStateIdentity[^]*source-state-drift/, 'witness must reject frozen source-state drift');
assert.match(witness, /nonblank[^]*blank-frame/, 'witness must reject blank captures');
assert.match(witness, /meanAbsoluteChannelDelta/, 'witness must calculate treatment pixel deltas');
assert.match(witness, /Runtime\.exceptionThrown/, 'witness must audit browser exceptions');
assert.match(witness, /failurePhase[^]*lastTrustworthyEvidence/, 'witness must write durable pre-output failure context');
assert.match(ledgerGenerator, /MANDATORY_STAGE_B_CONTROLS/, 'ledger must enumerate exactly the mandatory control set');
assert.match(ledgerGenerator, /sourceStateIdentity[^]*source-state-drift/, 'ledger must reject per-control source drift');
assert.match(ledgerGenerator, /meanAbsoluteChannelDelta/, 'ledger must record per-control pixel deltas');
assert.match(ledgerGenerator, /requestedControls[^]*effectiveControls/, 'ledger must preserve requested/effective control identity');

console.log('Stage B analytical rebake contracts passed');
