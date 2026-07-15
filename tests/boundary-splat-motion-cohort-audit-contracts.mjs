import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
assert.equal(
  typeof cohortAudit.motionWitnessModeContract,
  'function',
  'witness mode contract must keep raw receipts and guide semantics out of legacy output',
);
assert.equal(
  typeof cohortAudit.writeRecurrentEnvelopeWitness,
  'function',
  'audit must expose the accepted legacy/envelope four-role witness writer',
);
assert.equal(
  typeof cohortAudit.validateNestedMotionCohortArtifacts,
  'function',
  'verified resume must rehash every nested audit, raster, and video before reuse',
);
const legacyModeContract = cohortAudit.motionWitnessModeContract('motion-cohort', 9);
assert.equal(legacyModeContract.includeControlFrameIdentity, false);
assert.match(legacyModeContract.guideControlDescription, /copied-current/i);
const rawModeContract = cohortAudit.motionWitnessModeContract('raw-product-view', 9);
assert.equal(rawModeContract.includeControlFrameIdentity, true);
assert.match(rawModeContract.guideControlDescription, /frozen/i);
assert.match(rawModeContract.guideControlDescription, /9/);
const envelopeComparisonModeContract = cohortAudit.motionWitnessModeContract('raw-recurrent-envelope-comparison', 9);
assert.equal(envelopeComparisonModeContract.includeControlFrameIdentity, true);
assert.deepEqual(envelopeComparisonModeContract.roleNames, ['reference', 'control', 'legacy', 'envelope']);
assert.match(envelopeComparisonModeContract.guideControlDescription, /frozen/i);
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
const rawProductWitness = structuredClone(validWitness);
rawProductWitness.emphasis = {
  authority: 'raw-product-view-no-cohort-attenuation-v0',
  staticCohorts: [],
  motionCohorts: [],
  staticAttenuation: 1,
  unmatchedAttenuation: 1,
};
rawProductWitness.roles = {
  reference: 'exact-heldout-full-splat-state-v0',
  control: 'frozen-current-full-splat-state-v0',
  predicted: 'learned-recurrent-full-splat-state-v0',
};
rawProductWitness.roleEvidence = {
  reference: [{ sha256: 'd'.repeat(64) }, { sha256: 'e'.repeat(64) }],
  control: [{ sha256: 'f'.repeat(64) }, { sha256: 'f'.repeat(64) }],
  predicted: [{ sha256: '1'.repeat(64) }, { sha256: '2'.repeat(64) }],
};
rawProductWitness.controlFrameIdentity = {
  authority: 'pixel-identical-frozen-control-v0',
  frameCount: 2,
  uniqueFrameCount: 1,
  sha256: 'f'.repeat(64),
};
assert.doesNotThrow(
  () => cohortAudit.validateMotionCohortWitness(rawProductWitness),
  'raw product view must preserve full splat opacity and prove frozen control pixels',
);
const movingRawControlWitness = structuredClone(rawProductWitness);
movingRawControlWitness.roleEvidence.control[1].sha256 = '3'.repeat(64);
assert.throws(
  () => cohortAudit.validateMotionCohortWitness(movingRawControlWitness),
  /control frame identity/i,
  'a visually moving raw control must fail closure even when its source payload is nominally frozen',
);
const envelopeComparisonWitness = structuredClone(rawProductWitness);
envelopeComparisonWitness.configuration = {
  authority: 'legacy-vs-training-episode-envelope-recurrence-v0',
  witnessMode: 'raw-recurrent-envelope-comparison',
};
envelopeComparisonWitness.source = {
  audit: { sha256: 'a'.repeat(64) },
  envelopeAudit: { sha256: '0'.repeat(64) },
  manifest: { sha256: 'b'.repeat(64) },
  legacy: {
    predictions: { sha256: 'c'.repeat(64) },
    trainingReport: { sha256: 'd'.repeat(64) },
    greenroomReceipt: {
      sha256: 'e'.repeat(64),
      jobId: 'legacy-job',
      status: 'done',
      exitCode: 0,
      effectiveRoute: 'python transport --support-budget-mode one-step-ratio',
    },
    backend: { backend: 'mlx', device: 'Device(gpu, 0)', fallbackReason: null },
  },
  envelope: {
    predictions: { sha256: '1'.repeat(64) },
    trainingReport: { sha256: '2'.repeat(64) },
    greenroomReceipt: {
      sha256: '3'.repeat(64),
      jobId: 'envelope-job',
      status: 'done',
      exitCode: 0,
      effectiveRoute: 'python transport --support-budget-mode training-episode-envelope',
    },
    backend: { backend: 'mlx', device: 'Device(gpu, 0)', fallbackReason: null },
  },
  sharedIdentity: {
    occupancyModelSha256: '4'.repeat(64),
    destinationStateModelSha256: '5'.repeat(64),
    trainingManifestSha256: '6'.repeat(64),
    inferenceFrameZero: { referenceFrameId: 'frame-0', count: 100 },
  },
};
envelopeComparisonWitness.roles = {
  reference: 'exact-heldout-full-splat-state-v0',
  control: 'frozen-current-full-splat-state-v0',
  legacy: 'one-step-ratio-learned-recurrent-full-splat-state-v0',
  envelope: 'training-episode-envelope-learned-recurrent-full-splat-state-v0',
};
envelopeComparisonWitness.roleEvidence = {
  reference: [{ step: 1, sha256: '7'.repeat(64) }, { step: 2, sha256: '8'.repeat(64) }],
  control: [{ step: 1, sha256: '9'.repeat(64) }, { step: 2, sha256: '9'.repeat(64) }],
  legacy: [{ step: 1, sha256: 'a'.repeat(64) }, { step: 2, sha256: 'b'.repeat(64) }],
  envelope: [{ step: 1, sha256: 'c'.repeat(64) }, { step: 2, sha256: 'd'.repeat(64) }],
};
envelopeComparisonWitness.controlFrameIdentity = {
  authority: 'pixel-identical-frozen-control-v0',
  frameCount: 2,
  uniqueFrameCount: 1,
  sha256: '9'.repeat(64),
};
const budgetSteps = (mode, clamped) => [
  { step: 1, requested: 101, effective: 101, predictedCount: 101, clamped: false },
  { step: 2, requested: 102, effective: clamped ? 101 : 102, predictedCount: clamped ? 101 : 102, clamped },
];
envelopeComparisonWitness.supportBudgetComparison = {
  authority: 'paired-recurrent-support-budget-accounting-v0',
  trainingManifestSha256: '6'.repeat(64),
  inferenceFrameZero: { referenceFrameId: 'frame-0', count: 100 },
  legacy: { mode: 'one-step-ratio', steps: budgetSteps('one-step-ratio', false) },
  envelope: { mode: 'training-episode-envelope', steps: budgetSteps('training-episode-envelope', true) },
};
envelopeComparisonWitness.artifact.probe.width = 1280;
envelopeComparisonWitness.partialFlowDebug.artifact.probe.width = 1280;
envelopeComparisonWitness.claimBoundary = 'Offline same-raster diagnostic only; no analytical-raymarch claim and no runtime authorization.';
assert.doesNotThrow(
  () => cohortAudit.validateMotionCohortWitness(envelopeComparisonWitness),
  'paired recurrence witness must preserve both accepted routes and a truly frozen control',
);
const generatedBoundaryWitness = structuredClone(envelopeComparisonWitness);
generatedBoundaryWitness.claimBoundary = 'Offline same-raster diagnostic only; it does not establish analytical-raymarch image error, authorize runtime composition, or prove cross-basin generalization.';
assert.doesNotThrow(
  () => cohortAudit.validateMotionCohortWitness(generatedBoundaryWitness),
  'the writer-generated claim boundary must satisfy its own validator',
);
const maskedMovingEnvelopeControl = structuredClone(envelopeComparisonWitness);
maskedMovingEnvelopeControl.emphasis = structuredClone(validWitness.emphasis);
maskedMovingEnvelopeControl.roleEvidence.control[1].sha256 = 'e'.repeat(64);
delete maskedMovingEnvelopeControl.controlFrameIdentity;
assert.throws(
  () => cohortAudit.validateMotionCohortWitness(maskedMovingEnvelopeControl),
  /emphasis|control frame identity/i,
  'four-role comparison cannot use changing target-derived emphasis to counterfeit a frozen control',
);
const missingEnvelopeAudit = structuredClone(envelopeComparisonWitness);
delete missingEnvelopeAudit.source.envelopeAudit;
assert.throws(
  () => cohortAudit.validateMotionCohortWitness(missingEnvelopeAudit),
  /envelope audit/i,
  'the envelope role must remain bound to its independently generated audit artifact',
);
const counterfeitLegacyRoute = structuredClone(envelopeComparisonWitness);
counterfeitLegacyRoute.source.legacy.greenroomReceipt.effectiveRoute = 'python transport --support-budget-mode one-step-ratio-counterfeit';
assert.throws(
  () => cohortAudit.validateMotionCohortWitness(counterfeitLegacyRoute),
  /route identity/i,
  'a mode substring embedded in a different effective token must not carry route authority',
);
const duplicateEnvelopeRoute = structuredClone(envelopeComparisonWitness);
duplicateEnvelopeRoute.source.envelope.greenroomReceipt.effectiveRoute = 'python transport --support-budget-mode training-episode-envelope --support-budget-mode one-step-ratio';
assert.throws(
  () => cohortAudit.validateMotionCohortWitness(duplicateEnvelopeRoute),
  /route identity/i,
  'duplicated mode flags must fail rather than defer to undocumented parser precedence',
);
const missingEnvelopeStep = structuredClone(envelopeComparisonWitness);
missingEnvelopeStep.supportBudgetComparison.envelope.steps.pop();
assert.throws(() => cohortAudit.validateMotionCohortWitness(missingEnvelopeStep), /budget.*step/i);
const overBudgetEnvelope = structuredClone(envelopeComparisonWitness);
overBudgetEnvelope.supportBudgetComparison.envelope.steps[1].predictedCount = 102;
assert.throws(() => cohortAudit.validateMotionCohortWitness(overBudgetEnvelope), /budget/i);
const staleEnvelopeFrameZero = structuredClone(envelopeComparisonWitness);
staleEnvelopeFrameZero.source.sharedIdentity.inferenceFrameZero.referenceFrameId = 'frame-stale';
assert.throws(() => cohortAudit.validateMotionCohortWitness(staleEnvelopeFrameZero), /frame zero/i);
const staticEnvelope = structuredClone(envelopeComparisonWitness);
staticEnvelope.roleEvidence.envelope[1].sha256 = staticEnvelope.roleEvidence.envelope[0].sha256;
assert.throws(() => cohortAudit.validateMotionCohortWitness(staticEnvelope), /static|moving/i);
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

const missingEnvelopeDir = await mkdtemp(join(tmpdir(), 'kaminos-recurrent-envelope-missing-'));
await assert.rejects(
  cohortAudit.writeRecurrentEnvelopeWitness(
    join(missingEnvelopeDir, 'missing-manifest.json'),
    join(missingEnvelopeDir, 'missing-legacy-predictions.json'),
    join(missingEnvelopeDir, 'missing-envelope-predictions.json'),
    {
      legacyTrainingReport: join(missingEnvelopeDir, 'missing-legacy-report.json'),
      envelopeTrainingReport: join(missingEnvelopeDir, 'missing-envelope-report.json'),
      legacyReceipt: join(missingEnvelopeDir, 'missing-legacy-receipt.json'),
      envelopeReceipt: join(missingEnvelopeDir, 'missing-envelope-receipt.json'),
      outDir: missingEnvelopeDir,
    },
  ),
  /ENOENT|source/i,
  'failure before rendering must reject rather than imply an absent or cached witness',
);
const missingEnvelopeReport = JSON.parse(await readFile(join(missingEnvelopeDir, 'recurrent-envelope-witness.json'), 'utf8'));
assert.equal(missingEnvelopeReport.status, 'failed');
assert.equal(missingEnvelopeReport.failurePhase, 'source-validation');
const missingEnvelopeCliDir = await mkdtemp(join(tmpdir(), 'kaminos-recurrent-envelope-cli-missing-'));
const missingEnvelopeCli = spawnSync(process.execPath, [
  auditPath,
  '--manifest', join(missingEnvelopeCliDir, 'missing-manifest.json'),
  '--predictions', join(missingEnvelopeCliDir, 'missing-legacy-predictions.json'),
  '--envelope-predictions', join(missingEnvelopeCliDir, 'missing-envelope-predictions.json'),
  '--legacy-training-report', join(missingEnvelopeCliDir, 'missing-legacy-report.json'),
  '--envelope-training-report', join(missingEnvelopeCliDir, 'missing-envelope-report.json'),
  '--legacy-receipt', join(missingEnvelopeCliDir, 'missing-legacy-receipt.json'),
  '--envelope-receipt', join(missingEnvelopeCliDir, 'missing-envelope-receipt.json'),
  '--out-dir', missingEnvelopeCliDir,
], { encoding: 'utf8' });
assert.notEqual(missingEnvelopeCli.status, 0);
assert.equal(
  existsSync(join(missingEnvelopeCliDir, 'recurrent-envelope-witness.json')),
  true,
  'paired CLI failure must route through the recurrent witness and preserve its failure report',
);

const nestedDir = await mkdtemp(join(tmpdir(), 'kaminos-nested-witness-'));
const nestedAudit = {
  schema: 'kaminos-boundary-splat-motion-cohort-audit-v0',
  status: 'completed',
  source: { manifest: { sha256: '1'.repeat(64) }, predictions: { sha256: '2'.repeat(64) } },
};
const nestedAuditBytes = Buffer.from(`${JSON.stringify(nestedAudit)}\n`);
const digest = value => createHash('sha256').update(value).digest('hex');
await writeFile(join(nestedDir, 'motion-cohort-audit.json'), nestedAuditBytes);
const nestedWitness = structuredClone(rawProductWitness);
nestedWitness.source = {
  audit: { sha256: digest(nestedAuditBytes) },
  manifest: { sha256: '1'.repeat(64) },
  predictions: { sha256: '2'.repeat(64) },
};
for (const surface of ['beauty', 'debug']) {
  for (const role of ['reference', 'control', 'predicted']) {
    const roleDir = join(nestedDir, surface, role);
    await import('node:fs/promises').then(({ mkdir }) => mkdir(roleDir, { recursive: true }));
    const evidence = [];
    for (let index = 0; index < 2; index += 1) {
      const value = Buffer.from(role === 'control' ? 'frozen' : `${surface}-${role}-${index}`);
      await writeFile(join(roleDir, `frame-${String(index).padStart(3, '0')}.png`), value);
      evidence.push({ sha256: digest(value) });
    }
    if (surface === 'beauty') nestedWitness.roleEvidence[role] = evidence;
    else nestedWitness.partialFlowDebug.roleEvidence = { ...(nestedWitness.partialFlowDebug.roleEvidence ?? {}), [role]: evidence };
  }
}
nestedWitness.controlFrameIdentity.sha256 = nestedWitness.roleEvidence.control[0].sha256;
const beautyVideo = Buffer.from('beauty-video');
const debugVideo = Buffer.from('debug-video');
await writeFile(join(nestedDir, 'motion-cohort-comparison.mp4'), beautyVideo);
await writeFile(join(nestedDir, 'motion-cohort-debug-comparison.mp4'), debugVideo);
nestedWitness.artifact = { ...nestedWitness.artifact, path: join(nestedDir, 'motion-cohort-comparison.mp4'), bytes: beautyVideo.byteLength, sha256: digest(beautyVideo) };
nestedWitness.partialFlowDebug.artifact = { ...nestedWitness.partialFlowDebug.artifact, path: join(nestedDir, 'motion-cohort-debug-comparison.mp4'), bytes: debugVideo.byteLength, sha256: digest(debugVideo) };
assert.doesNotThrow(() => cohortAudit.validateMotionCohortWitness(nestedWitness));
await assert.doesNotReject(
  cohortAudit.validateNestedMotionCohortArtifacts(nestedDir, nestedWitness, nestedAudit, nestedAuditBytes, {
    manifestSha256: '1'.repeat(64),
    predictionsSha256: '2'.repeat(64),
  }),
);
await writeFile(join(nestedDir, 'beauty', 'predicted', 'frame-001.png'), 'tampered');
await assert.rejects(
  cohortAudit.validateNestedMotionCohortArtifacts(nestedDir, nestedWitness, nestedAudit, nestedAuditBytes, {
    manifestSha256: '1'.repeat(64),
    predictionsSha256: '2'.repeat(64),
  }),
  /byte|hash|cached|raster/i,
  'verified resume must reject one mutated cached frame',
);

console.log('boundary splat motion cohort audit contracts passed');
