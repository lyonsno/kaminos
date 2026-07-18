#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildStageBControlParityLedger,
  PYRO_STAGE_B_CONTROL_PARITY_LEDGER_SCHEMA,
} from '../pyro-control-path-stage-b-parity-ledger.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const sourceRevision = 'fcccec02af5fc00ea63ff7817a58018777b5a49c';
const matrix = JSON.parse(await readFile(resolve(
  repoRoot,
  'artifacts/pyro-control-path-parity-audit/browser-gpu-frozen-capture-matrix/matrix.json',
), 'utf8'));

const manifest = {
  schema: 'kaminos.pyro-cockpit-manifest.v0',
  status: 'complete',
  evidenceState: 'produced',
  producer: { identity: 'radiance-transfer-producer-v0', implementationCommit: sourceRevision },
  source: {
    commit: sourceRevision,
    sameStateCaptureId: 'filament-orbit-f120-s120',
    controlsSha256: '4df68da037500e4b1a7b046b48f7927708642cc6294102a3c46f1acb3e01a7e7',
    candidatePayloadSha256: '995f195f0079108fd9de2b51c3e011fb758af4c0e3a594c2d24b9dcc5306e9f9',
    supportSha256: '33a6943c6a2cb644f244d5edeeb544dbce52d0cef98e3fb9d705abd49b941216',
    coefficientSha256: '1526ace8d701790749f6037feda64f54c39be01688286360737b741154be705c',
    covarianceSha256: '4cae2517538cf701ac97aad9382f4d150526de8c11e6513c3b98a82d4b5f0122',
    fluidSha256: '98d1d0650d67fcdf32f2fc7f5c353bac5355f7df01f45d1e0211c51eb02a7620',
    frontSha256: '27491552ce2c0294125d35658c3dd47289c91d0d068909c0c244e5167d7c7e35',
    candidateCount: 1_899_742,
  },
  identities: {
    target: 'smoke-off-complete-flame-local-emission-extinction-v0',
    treatment: 'matched-optical-recurrence-v0',
    support: 'sha256:33a6943c6a2cb644f244d5edeeb544dbce52d0cef98e3fb9d705abd49b941216',
    coefficient: 'sha256:1526ace8d701790749f6037feda64f54c39be01688286360737b741154be705c',
    covariance: 'sha256:4cae2517538cf701ac97aad9382f4d150526de8c11e6513c3b98a82d4b5f0122',
    accumulation: 'depth-binned-emission-optical-depth-v0',
    transport: 'depth-binned-exponential-self-transmittance-v0',
    presentation: 'raymarch-matched-exponential-power-grade-v0',
  },
  routes: {
    requested: '/volume-selective-head-live.html',
    effectiveWrapper: 'exact-basin-selective-head-live-v0',
    effectiveRenderer: 'native-3d-compute-fluid-raymarch-v0',
  },
  controls: {
    requestedSha256: '4df68da037500e4b1a7b046b48f7927708642cc6294102a3c46f1acb3e01a7e7',
    effectiveSha256: '4df68da037500e4b1a7b046b48f7927708642cc6294102a3c46f1acb3e01a7e7',
    locked: [
      'support', 'candidate-membership', 'candidate-count', 'positions', 'covariance', 'radius',
      'sharpness', 'coefficients', 'learned-attributes', 'authored-layers', 'simulator-state',
      'raymarch-target', 'camera-orbit',
    ],
    mutable: ['presentation-view', 'difference-gain', 'debug-view'],
  },
  renderer: {
    composition: 'splat-only-v0',
    backend: 'WebGPU:apple',
    fallbackReason: null,
    targetFormat: 'rgba16float-array',
    layerFormat: 'rgba16float',
    depthBins: { requested: 16, effective: 16 },
  },
  capacity: { candidateCount: 1_899_742, capacity: 2_000_000, overflowCount: 0 },
};

const requestedRoute = new URL('http://127.0.0.1:18243/volume-selective-head-live.html');
const effectiveRoute = new URL('http://127.0.0.1:18784/volume-selective-head-live.html');
for (const [key, value] of Object.entries({
  volume_reaction_boundary_support_front: '0.66',
  volume_reaction_boundary_topology: '0.96',
  volume_reaction_boundary_fire_ridge: '1.52',
  volume_reaction_boundary_fire_tip: '2',
  volume_boundary_splat_radius: '0.98',
  volume_boundary_splat_sharpness: '12',
})) {
  requestedRoute.searchParams.set(key, value);
  effectiveRoute.searchParams.set(key, value);
}

const witness = {
  schema: 'kaminos.pyro.full-support-cockpit-witness.v0',
  status: 'passed',
  requestedRoute: requestedRoute.href,
  effectiveRoute: effectiveRoute.href,
  bootstrap: {
    presentedState: { simStepCount: 120, lookFreeze: 1, effectiveRoute: 'native-3d-compute-fluid-raymarch-v0' },
  },
  stageBReceipt: {
    status: 'effective',
    requestedTreatment: 'matched-optical-recurrence-v0',
    effectiveTreatment: 'matched-optical-recurrence-v0',
    requestedManifestSha256: '36ad2c8e831b6ac2f39d990f24262475e7ff5f4ee5e38fdd2ef106c1bc47db7a',
    effectiveManifestSha256: '36ad2c8e831b6ac2f39d990f24262475e7ff5f4ee5e38fdd2ef106c1bc47db7a',
    fallbackUsed: false,
    resourceState: 'complete',
    passes: {
      requested: ['manifest-validation', 'resource-binding', 'resource-load-verification'],
      applied: ['manifest-validation', 'resource-binding', 'resource-load-verification'],
      rendererRequested: true,
      rendererEncoded: true,
      rendererApplied: true,
    },
    rendererReceipt: {
      requestedMode: 'matched-optical-recurrence-v0',
      effectiveMode: 'matched-optical-recurrence-v0',
      fallbackReason: null,
    },
  },
};

const incompleteResourceWitness = structuredClone(witness);
incompleteResourceWitness.stageBReceipt.resourceState = 'missing';
await assert.rejects(
  buildStageBControlParityLedger({
    repoRoot,
    sourceRevision,
    manifest,
    witness: incompleteResourceWitness,
    priorMatrix: matrix,
  }),
  /Stage B resource state incomplete:missing/,
  'renderer booleans cannot substitute for a complete Stage B resource state',
);

const strippedAppliedPassWitness = structuredClone(witness);
strippedAppliedPassWitness.stageBReceipt.passes.applied = [];
await assert.rejects(
  buildStageBControlParityLedger({
    repoRoot,
    sourceRevision,
    manifest,
    witness: strippedAppliedPassWitness,
    priorMatrix: matrix,
  }),
  /Stage B requested pass not applied:manifest-validation/,
  'requested renderer passes cannot substitute for applied resource verification',
);

const ledger = await buildStageBControlParityLedger({
  repoRoot,
  sourceRevision,
  manifest,
  witness,
  priorMatrix: matrix,
});

assert.equal(ledger.schema, PYRO_STAGE_B_CONTROL_PARITY_LEDGER_SCHEMA);
assert.equal(ledger.scope, 'stage-b-six-control-executable-slice');
assert.equal(ledger.source.revision, sourceRevision);
assert.match(ledger.source.files.volumeCore.sha256, /^[a-f0-9]{64}$/);
assert.match(ledger.source.files.stageBConsumer.sha256, /^[a-f0-9]{64}$/);
assert.equal(ledger.runtime.candidateCount, 1_899_742);
assert.equal(ledger.runtime.capacity, 2_000_000);
assert.equal(ledger.runtime.overflowCount, 0);
assert.equal(ledger.runtime.layerCount, 16);
assert.equal(ledger.runtime.depositCount, 37_994_840);
assert.equal(ledger.runtime.requestedEffectiveIdentity, true);
assert.equal(ledger.runtime.fallback, null);
assert.deepEqual(ledger.runtime.appliedPasses, witness.stageBReceipt.passes.applied);
assert.equal(ledger.runtime.postLoadMutation, 'locked-control-cohort-no-post-load-mutation-v0');
assert.equal(ledger.enumeration.totalControlCount, 206);
assert.equal(ledger.enumeration.auditedControlCount, 6);
assert.equal(ledger.enumeration.nextUncappedEnumerationCount, 200);
assert.equal(ledger.contractEvidence.length, 2);
assert.ok(ledger.contractEvidence.every(item => item.line > 0 && /^[a-f0-9]{64}$/.test(item.scopeSha256)));
assert.equal(ledger.rows.length, 6);

const rows = new Map(ledger.rows.map(row => [row.control, row]));
const support = rows.get('volume_reaction_boundary_support_front');
assert.equal(support.stages.raymarch.coupling, 'direct-live');
assert.equal(support.stages.raymarch.ordinaryRouteReadsControl, true);
assert.equal(support.stages.raymarch.livePostLoad, false);
assert.equal(support.stages.candidate.coupling, 'producer-time-frozen');
assert.equal(support.stages.candidate.resourceIdentity, `sha256:${manifest.source.supportSha256}`);
assert.equal(support.stages.deposition.coupling, 'cohort-only-frozen');
assert.ok(support.evidence.every(item => item.line > 0 && /^[a-f0-9]{64}$/.test(item.scopeSha256)));

const ridge = rows.get('volume_reaction_boundary_fire_ridge');
assert.equal(ridge.stages.raymarch.coupling, 'direct-live');
assert.equal(ridge.stages.candidate.coupling, 'producer-time-frozen');
assert.equal(ridge.stages.coefficients.coupling, 'cohort-only-frozen');

const topology = rows.get('volume_reaction_boundary_topology');
assert.equal(topology.stages.raymarch.coupling, 'direct-live');
assert.equal(topology.stages.candidate.coupling, 'none');
assert.equal(topology.stages.candidate.classification, 'intentional-raymarch-only-current-route');
assert.equal(topology.priorFrozenCapture.stageBPixelDelta, null);

const tip = rows.get('volume_reaction_boundary_fire_tip');
assert.equal(tip.stages.raymarch.coupling, 'direct-live');
assert.equal(tip.stages.candidate.coupling, 'none');
assert.equal(tip.stages.presentation.coupling, 'none');

for (const control of ['volume_boundary_splat_radius', 'volume_boundary_splat_sharpness']) {
  const row = rows.get(control);
  assert.equal(row.requested.effectiveEqualsRequested, true);
  assert.ok(row.evidence.some(item => item.stage === 'route-ingress'));
  assert.ok(row.evidence.some(item => item.stage === 'gpu-upload'));
  assert.equal(row.stages.raymarch.classification, 'intentional-splat-only');
  assert.equal(row.stages.candidate.coupling, 'none');
  assert.equal(row.stages.coefficients.coupling, 'declared-locked-but-bypassed');
  assert.equal(row.stages.covariance.coupling, 'declared-locked-but-bypassed');
  assert.equal(row.stages.deposition.coupling, 'declared-locked-but-bypassed');
  assert.equal(row.stages.presentation.coupling, 'declared-locked-but-bypassed');
  assert.equal(row.falsifier.tripped, true);
  assert.equal(row.falsifier.catches, 'requested-effective-and-gpu-upload-survive-while-stage-b-consumer-bypasses-control');
  assert.ok(row.priorFrozenCapture.pixelDelta.meanAbsoluteChannelDeltaMean > 0);
  assert.equal(row.priorFrozenCapture.stageBPixelDelta, null);
}

assert.deepEqual(ledger.materialFindings.map(finding => finding.id), [
  'stage-b-radius-sharpness-bypass',
  'stage-b-covariance-lock-does-not-prove-covariance-consumption',
]);
assert.equal(ledger.provisionalDiagnosticGate.exhaustiveParityRequired, false);

const volumeCore = execFileSync('git', ['show', `${sourceRevision}:volume-core.js`], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
await assert.rejects(
  buildStageBControlParityLedger({
    repoRoot,
    sourceRevision,
    manifest,
    witness,
    priorMatrix: matrix,
    sourceOverrides: {
      'volume-core.js': volumeCore.replace(
        'clamp(u.topology_shell_carriers.z, 0.0, 2.0)',
        'clamp(0.0, 0.0, 2.0)',
      ),
    },
  }),
  /positive coupling marker missing:volume_reaction_boundary_support_front:candidate/,
  'a surviving route receipt must not hide a removed downstream support-front binding',
);

console.log('pyro Stage B control-path parity contracts passed');
