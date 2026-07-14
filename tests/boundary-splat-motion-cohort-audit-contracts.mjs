import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import * as transport from '../boundary-splat-phase-transport.mjs';
import * as cohortAudit from '../boundary-splat-motion-cohort-audit.mjs';

function site(position, state, opacity = 1) {
  const candidate = Array.from({ length: 16 }, (_, index) => state + index * 0.001);
  const splat = [
    ...position,
    0.02,
    0.2 + state,
    0.4 + state,
    0.8 + state,
    opacity,
    0.01,
    0.01,
    0,
    0,
  ];
  return { position, candidate, splat };
}

assert.equal(
  typeof transport.partitionMotionCohorts,
  'function',
  'transport contract must expose exact motion-cohort partitioning',
);
assert.equal(
  typeof transport.evaluateMotionCohorts,
  'function',
  'transport contract must expose cohort-specific prediction/control evaluation',
);

const source = [
  site([0, 0, 0], 0),
  site([0, 1, 0], 0),
  site([0, 2, 0], 0),
  site([0, 3, 0], 0),
  site([0, 4, 0], 0),
  site([0, 5, 0], 0),
];
const target = [
  site([0, 0, 0], 0.001),
  site([0, 1, 0], 0.01),
  site([0, 2, 0], 0.1),
  site([0, 3, 0], 1.0),
  site([1, 4, 0], 0.5),
  site([8, 8, 8], 0.75),
];

const partition = transport.partitionMotionCohorts(source, target, {
  gridStep: 1,
  stableChangeBinCount: 4,
  candidateScale: Array(16).fill(1),
  splatScale: Array(9).fill(1),
});

assert.equal(partition.authority, 'exact-adjacent-state-change-and-bounded-transport-cohorts-v0');
assert.deepEqual(
  partition.targetCohorts.map(cohort => cohort.id),
  ['stable-q1', 'stable-q2', 'stable-q3', 'stable-q4', 'transported', 'birth'],
);
assert.deepEqual(partition.targetCohorts.map(cohort => cohort.count), [1, 1, 1, 1, 1, 1]);
assert.equal(partition.death.count, 1);
assert.equal(
  partition.targetCohorts.reduce((sum, cohort) => sum + cohort.count, 0),
  target.length,
  'target cohorts must be exhaustive',
);
assert.equal(
  new Set(partition.targetCohorts.flatMap(cohort => cohort.targetIndices)).size,
  target.length,
  'target cohorts must be disjoint',
);
assert.ok(
  partition.targetCohorts[0].maximumChangeScore < partition.targetCohorts[3].minimumChangeScore,
  'stable quartiles must order exact state change rather than world-position identity alone',
);

const predicted = [
  target[0],
  target[1],
  source[2],
  source[3],
  target[5],
];
const evaluation = transport.evaluateMotionCohorts(partition, source, target, predicted, source);

assert.equal(evaluation.cohorts['stable-q1'].prediction.supportRecall, 1);
assert.equal(evaluation.cohorts['stable-q4'].prediction.supportRecall, 1);
assert.equal(evaluation.cohorts.transported.prediction.supportRecall, 0);
assert.equal(evaluation.cohorts.birth.prediction.supportRecall, 1);
assert.ok(
  evaluation.cohorts['stable-q4'].prediction.meanStateMse
    >= evaluation.cohorts['stable-q4'].control.meanStateMse,
  'copying an old dynamic state must not masquerade as moving-state advantage',
);
assert.equal(evaluation.claimGate.predictionBeatsControlOnMotionBearingCohorts, false);
assert.equal(evaluation.claimGate.aggregateSupportCanCloseClaim, false);
assert.match(evaluation.claimGate.reason, /motion-bearing cohorts/i);
assert.equal(
  typeof cohortAudit.buildMotionEmphasisRows,
  'function',
  'audit must expose deterministic static-attenuated witness rows',
);
const emphasizedTarget = cohortAudit.buildMotionEmphasisRows(target, partition, {
  staticAttenuation: 0.1,
  unmatchedAttenuation: 0.05,
});
assert.deepEqual(
  emphasizedTarget.map(row => row[7]),
  [0.1, 0.1, 1, 1, 1, 1],
  'only the measured lower-change half may be attenuated in the exact target role',
);
const emphasizedControl = cohortAudit.buildMotionEmphasisRows(source, partition, {
  staticAttenuation: 0.1,
  unmatchedAttenuation: 0.05,
});
assert.equal(emphasizedControl[4][7], 0.05, 'support absent from the exact target remains faintly visible as unmatched evidence');
assert.equal(emphasizedControl[5][7], 0.05, 'exact deaths remain faintly visible rather than disappearing from diagnosis');
assert.equal(
  typeof cohortAudit.validateMotionCohortWitness,
  'function',
  'audit must validate motion-emphasis witness authority before completion',
);
const validWitness = {
  schema: 'kaminos-boundary-splat-motion-cohort-witness-v0',
  status: 'completed',
  source: { audit: { sha256: 'a'.repeat(64) } },
  playback: { frameCount: 2, effectiveFps: 6, encodedDurationSeconds: 0.333333, loops: false },
  emphasis: {
    authority: 'exact-motion-cohort-static-attenuation-v0',
    staticCohorts: ['stable-q1', 'stable-q2'],
    motionCohorts: ['stable-q3', 'stable-q4', 'transported', 'birth'],
    staticAttenuation: 0.1,
    unmatchedAttenuation: 0.05,
  },
  roles: {
    reference: 'exact-heldout-target-motion-cohorts-v0',
    control: 'copied-current-projected-onto-exact-motion-cohorts-v0',
    predicted: 'learned-recurrent-state-projected-onto-exact-motion-cohorts-v0',
  },
  artifact: {
    sha256: 'b'.repeat(64),
    bytes: 100,
    probe: { frameCount: 2, width: 960, height: 240, fps: 6, duration: 0.333333 },
  },
  partialFlowDebug: {
    authority: 'display-only-motion-cohort-debug-mix-v0',
    requestedGain: 0.625,
    effectiveGain: 0.625,
    stateMutation: false,
    artifact: {
      sha256: 'c'.repeat(64),
      bytes: 100,
      probe: { frameCount: 2, width: 960, height: 240, fps: 6, duration: 0.333333 },
    },
  },
};
assert.doesNotThrow(() => cohortAudit.validateMotionCohortWitness(validWitness));
const blankWitness = structuredClone(validWitness);
blankWitness.artifact.probe.frameCount = 0;
assert.throws(() => cohortAudit.validateMotionCohortWitness(blankWitness), /frame count/i);
const missingRoleWitness = structuredClone(validWitness);
delete missingRoleWitness.roles.predicted;
assert.throws(() => cohortAudit.validateMotionCohortWitness(missingRoleWitness), /role/i);
const missingDebugWitness = structuredClone(validWitness);
delete missingDebugWitness.partialFlowDebug;
assert.throws(() => cohortAudit.validateMotionCohortWitness(missingDebugWitness), /flow debug/i);

const root = resolve(import.meta.dirname, '..');
const auditPath = join(root, 'boundary-splat-motion-cohort-audit.mjs');
assert.equal(existsSync(auditPath), true, 'motion cohort audit CLI must exist');
const hostileDir = await mkdtemp(join(tmpdir(), 'kaminos-motion-cohort-hostile-'));
const manifestPath = join(root, 'artifacts', 'pyro-phase-transport-crosswind-motion-r1-0714', 'receipts', 'phase-corpus.json');
const predictionPath = join(root, 'artifacts', 'pyro-phase-transport-crosswind-motion-r1-0714', 'receipts', 'transport-predictions.json');
const hostilePredictionPath = join(hostileDir, 'stale-predictions.json');
const prediction = JSON.parse(await readFile(predictionPath, 'utf8'));
prediction.manifest.sha256 = '0'.repeat(64);
await writeFile(hostilePredictionPath, `${JSON.stringify(prediction)}\n`);
const hostileRun = spawnSync(process.execPath, [
  auditPath,
  '--manifest', manifestPath,
  '--predictions', hostilePredictionPath,
  '--out-dir', hostileDir,
], { encoding: 'utf8' });
assert.notEqual(hostileRun.status, 0, 'stale prediction corpus identity must fail the audit');
const failedReport = JSON.parse(await readFile(join(hostileDir, 'motion-cohort-audit.json'), 'utf8'));
assert.equal(failedReport.schema, 'kaminos-boundary-splat-motion-cohort-audit-v0');
assert.equal(failedReport.status, 'failed');
assert.equal(failedReport.failurePhase, 'manifest-validation');
assert.equal(failedReport.lastTrustworthyEvidence.manifestPath, manifestPath);
assert.equal(failedReport.lastTrustworthyEvidence.predictionsPath, hostilePredictionPath);

console.log('boundary splat motion cohort audit contracts passed');
