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
assert.equal(
  typeof cohortAudit.validateRecurrentExposurePair,
  'function',
  'motion witness must expose a recurrent-exposure pair validator',
);
assert.equal(
  typeof cohortAudit.writeRecurrentExposureWitness,
  'function',
  'motion witness must expose a paired recurrent-exposure writer',
);
assert.equal(
  typeof cohortAudit.validateRecurrentExposureWitness,
  'function',
  'motion witness must validate paired recurrent-exposure output before handoff',
);

const exposurePairFixture = {
  seedReport: {
    status: 'completed',
    route: { backend: 'mlx', device: 'Device(gpu, 0)', fallbackReason: null },
    manifest: { path: '/corpus.json', sha256: 'a'.repeat(64) },
    model: { path: '/seed-model.json', sha256: 'b'.repeat(64) },
    modelTrainingManifest: { sha256: 'c'.repeat(64) },
    destinationStateModel: { path: '/state-model.json', sha256: 'd'.repeat(64) },
    predictions: { path: '/seed-output/transport-predictions.json' },
    supportBudget: { mode: 'training-episode-envelope' },
    holdoutMetrics: [{ step: 1 }, { step: 2 }],
  },
  exposureReport: {
    status: 'completed',
    route: { backend: 'mlx', device: 'Device(gpu, 0)', fallbackReason: null },
    manifest: { path: '/corpus.json', sha256: 'a'.repeat(64) },
    model: { path: '/exposure-model.json', sha256: 'e'.repeat(64) },
    modelTrainingManifest: { sha256: 'c'.repeat(64) },
    destinationStateModel: { path: '/state-model.json', sha256: 'd'.repeat(64) },
    predictions: { path: '/exposure-output/transport-predictions.json' },
    supportBudget: { mode: 'training-episode-envelope' },
    holdoutMetrics: [{ step: 1 }, { step: 2 }],
  },
  seedPredictions: {
    temporal: { controlledStepDeltaMs: 160, heldoutReferenceFrameIds: ['frame-0', 'frame-1', 'frame-2'] },
    frames: [{ referenceFrameId: 'frame-0' }, { referenceFrameId: 'frame-1' }, { referenceFrameId: 'frame-2' }],
  },
  exposurePredictions: {
    temporal: { controlledStepDeltaMs: 160, heldoutReferenceFrameIds: ['frame-0', 'frame-1', 'frame-2'] },
    frames: [{ referenceFrameId: 'frame-0' }, { referenceFrameId: 'frame-1' }, { referenceFrameId: 'frame-2' }],
  },
  exposureModel: {
    training: {
      initializationAuthority: 'frozen-seed-model-weights-v0',
      rolloutSeedModel: {
        authority: 'byte-hash-bound-frozen-eulerian-rollout-seed-v0',
        sha256: 'b'.repeat(64),
        trainingManifestSha256: 'c'.repeat(64),
      },
      rolloutExposure: {
        authority: 'exact-plus-frozen-seed-recurrent-eulerian-support-exposure-v0',
        exactPairCount: 7,
        recurrentPairCount: 5,
        sampleCap: null,
      },
    },
  },
  seedReceipt: {
    status: 'done', exit_code: 0, failure_phase: null,
    effective_route: 'python transport --manifest /corpus.json --model /seed-model.json --state-model /state-model.json --state-recurrence-mode protected-splat --support-budget-mode training-episode-envelope --out-dir /seed-output --inference-start 0 --inference-steps 2 --grid-size 160 --batch-size 4096',
  },
  exposureReceipt: {
    status: 'done', exit_code: 0, failure_phase: null,
    effective_route: 'python transport --manifest /corpus.json --model /exposure-model.json --state-model /state-model.json --state-recurrence-mode protected-splat --support-budget-mode training-episode-envelope --out-dir /exposure-output --inference-start 0 --inference-steps 2 --grid-size 160 --batch-size 4096',
  },
};
assert.doesNotThrow(() => cohortAudit.validateRecurrentExposurePair(exposurePairFixture));
for (const [label, mutate, pattern] of [
  ['same model', value => { value.exposureReport.model.sha256 = value.seedReport.model.sha256; }, /distinct model/i],
  ['wrong seed ancestry', value => { value.exposureModel.training.rolloutSeedModel.sha256 = 'f'.repeat(64); }, /seed ancestry/i],
  ['mismatched corpus', value => { value.exposureReport.manifest.sha256 = 'f'.repeat(64); }, /corpus identity/i],
  ['mismatched cadence', value => { value.exposurePredictions.temporal.controlledStepDeltaMs = 320; }, /temporal identity/i],
  ['mismatched state model', value => { value.exposureReport.destinationStateModel.sha256 = 'f'.repeat(64); }, /destination state model/i],
  ['wrong support mode', value => { value.exposureReport.supportBudget.mode = 'one-step-ratio'; }, /support budget mode/i],
  ['fallback backend', value => { value.exposureReport.route.fallbackReason = 'cpu'; }, /MLX GPU/i],
  ['duplicate route flag', value => { value.exposureReceipt.effective_route += ' --support-budget-mode one-step-ratio'; }, /route identity/i],
  ['stale route corpus', value => { value.exposureReceipt.effective_route = value.exposureReceipt.effective_route.replace('/corpus.json', '/wrong-corpus.json'); }, /route identity/i],
  ['stale route model', value => { value.exposureReceipt.effective_route = value.exposureReceipt.effective_route.replace('/exposure-model.json', '/wrong-model.json'); }, /route identity/i],
  ['stale route state model', value => { value.exposureReceipt.effective_route = value.exposureReceipt.effective_route.replace('/state-model.json', '/wrong-state.json'); }, /route identity/i],
  ['stale route output', value => { value.exposureReceipt.effective_route = value.exposureReceipt.effective_route.replace('/exposure-output', '/wrong-output'); }, /route identity/i],
  ['partial route steps', value => { value.exposureReceipt.effective_route = value.exposureReceipt.effective_route.replace('--inference-steps 2', '--inference-steps 1'); }, /route identity/i],
]) {
  const hostile = structuredClone(exposurePairFixture);
  mutate(hostile);
  assert.throws(
    () => cohortAudit.validateRecurrentExposurePair(hostile),
    pattern,
    `${label} must fail before paired raster evidence`,
  );
}

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
assert.equal(
  typeof cohortAudit.physicalDestinationStateModelIdentity,
  'function',
  'v1 witness must expose checkpoint objective and corpus identity validation',
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
  thresholdSelection: 'none; every full splat retains original opacity',
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
const recurrentExposureWitness = structuredClone(envelopeComparisonWitness);
recurrentExposureWitness.configuration = {
  authority: 'frozen-seed-vs-recurrent-exposure-physical-energy-v0',
  witnessMode: 'raw-recurrent-exposure-comparison',
  nestedArtifactMode: 'freshly-rendered',
};
recurrentExposureWitness.source = {
  seedAudit: { sha256: '0'.repeat(64) },
  exposureAudit: { sha256: '1'.repeat(64) },
  manifest: { path: '/corpus.json', sha256: 'b'.repeat(64) },
  seed: {
    predictions: { path: '/seed-output/transport-predictions.json', sha256: 'c'.repeat(64) },
    trainingReport: { sha256: 'd'.repeat(64) },
    greenroomReceipt: {
      ...envelopeComparisonWitness.source.envelope.greenroomReceipt,
      effectiveRoute: 'python transport --manifest /corpus.json --model /seed-model.json --state-model /state-model.json --state-recurrence-mode protected-splat --support-budget-mode training-episode-envelope --out-dir /seed-output --inference-start 0 --inference-steps 2 --grid-size 160 --batch-size 4096',
    },
    backend: { backend: 'mlx', device: 'Device(gpu, 0)', fallbackReason: null },
  },
  exposure: {
    predictions: { path: '/exposure-output/transport-predictions.json', sha256: 'e'.repeat(64) },
    trainingReport: { sha256: 'f'.repeat(64) },
    greenroomReceipt: {
      ...envelopeComparisonWitness.source.envelope.greenroomReceipt,
      sha256: '2'.repeat(64),
      jobId: 'exposure-job',
      effectiveRoute: 'python transport --manifest /corpus.json --model /exposure-model.json --state-model /state-model.json --state-recurrence-mode protected-splat --support-budget-mode training-episode-envelope --out-dir /exposure-output --inference-start 0 --inference-steps 2 --grid-size 160 --batch-size 4096',
    },
    backend: { backend: 'mlx', device: 'Device(gpu, 0)', fallbackReason: null },
  },
  sharedIdentity: {
    seedModelSha256: '3'.repeat(64),
    seedModelPath: '/seed-model.json',
    exposureModelSha256: '4'.repeat(64),
    exposureModelPath: '/exposure-model.json',
    destinationStateModelSha256: '5'.repeat(64),
    destinationStateModelPath: '/state-model.json',
    trainingManifestSha256: '6'.repeat(64),
    exposureAuthority: 'exact-plus-frozen-seed-recurrent-eulerian-support-exposure-v0',
    sampleCap: null,
  },
};
recurrentExposureWitness.roles = {
  reference: 'exact-heldout-full-splat-state-v0',
  control: 'frozen-current-full-splat-state-v0',
  seed: 'frozen-seed-learned-recurrent-full-splat-state-v0',
  exposure: 'recurrent-exposure-learned-recurrent-full-splat-state-v0',
};
recurrentExposureWitness.roleEvidence = {
  reference: envelopeComparisonWitness.roleEvidence.reference,
  control: envelopeComparisonWitness.roleEvidence.control,
  seed: envelopeComparisonWitness.roleEvidence.legacy,
  exposure: envelopeComparisonWitness.roleEvidence.envelope,
};
delete recurrentExposureWitness.supportBudgetComparison;
recurrentExposureWitness.metrics = {
  authority: 'accepted-training-report-support-and-same-corpus-iou-v0',
  seedHoldout: [
    { step: 1, predictionIoU: 0.4 },
    { step: 2, predictionIoU: 0.2 },
  ],
  exposureHoldout: [
    { step: 1, predictionIoU: 0.5 },
    { step: 2, predictionIoU: 0.18 },
  ],
  comparison: {
    authority: 'same-corpus-stepwise-recurrent-exposure-vs-frozen-seed-support-iou-v0',
    evaluatedStepCount: 2,
    improvedStepCount: 1,
    meanRelativeIoUDelta: 0.075,
    stepOneRelativeIoUDelta: 0.25,
    bestStep: {
      step: 1,
      seedIoU: 0.4,
      exposureIoU: 0.5,
      absoluteIoUDelta: 0.1,
      relativeIoUDelta: 0.25,
    },
    steps: [
      { step: 1, seedIoU: 0.4, exposureIoU: 0.5, absoluteIoUDelta: 0.1, relativeIoUDelta: 0.25 },
      { step: 2, seedIoU: 0.2, exposureIoU: 0.18, absoluteIoUDelta: -0.02, relativeIoUDelta: -0.1 },
    ],
  },
};
recurrentExposureWitness.claimBoundary = 'Offline same-raster diagnostic only; it does not establish analytical-raymarch image error, authorize runtime composition, prove cross-basin generalization, or establish long-horizon visual preservation.';
assert.doesNotThrow(() => cohortAudit.validateRecurrentExposureWitness(recurrentExposureWitness));
const sameExposureModelWitness = structuredClone(recurrentExposureWitness);
sameExposureModelWitness.source.sharedIdentity.exposureModelSha256 = sameExposureModelWitness.source.sharedIdentity.seedModelSha256;
assert.throws(() => cohortAudit.validateRecurrentExposureWitness(sameExposureModelWitness), /distinct model/i);
const movingExposureControl = structuredClone(recurrentExposureWitness);
movingExposureControl.roleEvidence.control[1].sha256 = 'f'.repeat(64);
assert.throws(() => cohortAudit.validateRecurrentExposureWitness(movingExposureControl), /control frame identity/i);
const staticExposureRole = structuredClone(recurrentExposureWitness);
staticExposureRole.roleEvidence.exposure[1].sha256 = staticExposureRole.roleEvidence.exposure[0].sha256;
assert.throws(() => cohortAudit.validateRecurrentExposureWitness(staticExposureRole), /static rather than moving/i);
const maskedExposureWitness = structuredClone(recurrentExposureWitness);
maskedExposureWitness.emphasis = structuredClone(validWitness.emphasis);
assert.throws(() => cohortAudit.validateRecurrentExposureWitness(maskedExposureWitness), /emphasis/i);
const missingExposureMetrics = structuredClone(recurrentExposureWitness);
delete missingExposureMetrics.metrics;
assert.throws(() => cohortAudit.validateRecurrentExposureWitness(missingExposureMetrics), /metrics/i);
const counterfeitExposureMetrics = structuredClone(recurrentExposureWitness);
counterfeitExposureMetrics.metrics.comparison.improvedStepCount = 2;
assert.throws(() => cohortAudit.validateRecurrentExposureWitness(counterfeitExposureMetrics), /metrics/i);
const staleCompletedExposureRoute = structuredClone(recurrentExposureWitness);
staleCompletedExposureRoute.source.exposure.greenroomReceipt.effectiveRoute = staleCompletedExposureRoute.source.exposure.greenroomReceipt.effectiveRoute.replace('/exposure-model.json', '/wrong-model.json');
assert.throws(() => cohortAudit.validateRecurrentExposureWitness(staleCompletedExposureRoute), /route identity/i);
const missingNestedArtifactMode = structuredClone(recurrentExposureWitness);
delete missingNestedArtifactMode.configuration.nestedArtifactMode;
assert.throws(() => cohortAudit.validateRecurrentExposureWitness(missingNestedArtifactMode), /nested artifact mode/i);
const runtimeAuthorizingBoundary = structuredClone(envelopeComparisonWitness);
runtimeAuthorizingBoundary.claimBoundary = 'Offline diagnostic only; this grants runtime authorization for composition.';
assert.throws(
  () => cohortAudit.validateMotionCohortWitness(runtimeAuthorizingBoundary),
  /claim boundary/i,
  'mentioning runtime authorization affirmatively must never satisfy the negative claim boundary',
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
const physicalEnergyEnvelopeWitness = structuredClone(envelopeComparisonWitness);
physicalEnergyEnvelopeWitness.configuration.authority = 'legacy-vs-training-episode-envelope-physical-energy-v1';
physicalEnergyEnvelopeWitness.source.sharedIdentity.destinationStateTrainingLoss = {
  authority: 'candidate-splat-physical-visible-energy-weighted-loss-v1',
  candidateChannelCount: 16,
  splatChannelCount: 9,
  visibleEnergy: 'max(opacity,0)*max(rec709-luminance,0)',
  visibleEnergyChannels: { color: [17, 18, 19], opacity: 20 },
  weights: { candidate: 0.1, splat: 1.0, visibleEnergy: 0.25 },
  responseAnchor: {
    authority: 'frozen-teacher-response-on-current-model-exposed-inputs-v0',
    scope: 'predicted-splat-exposure-rows-only',
    weight: 1.0,
  },
  visibleEnergyScale: 0.01,
  splatAttributeOrder: [
    'splat.support',
    'splat.color.r', 'splat.color.g', 'splat.color.b',
    'splat.opacity', 'splat.shape.x', 'splat.shape.y',
    'splat.ridge', 'splat.fireSignal',
  ],
};
physicalEnergyEnvelopeWitness.source.sharedIdentity.destinationStateTraining = {
  authority: 'protected-splat-anchored-online-scheduled-exposure-training-v0',
  mode: 'protected-anchored-online-rollout',
};
physicalEnergyEnvelopeWitness.source.sharedIdentity.destinationStateCorpora = {
  trainingManifestSha256: '6'.repeat(64),
  evaluationManifestSha256: 'b'.repeat(64),
};
assert.doesNotThrow(
  () => cohortAudit.validateMotionCohortWitness(physicalEnergyEnvelopeWitness),
  'the physical-energy witness must bind the corrected effective loss and physical splat ordering',
);
const staleDestinationLoss = structuredClone(physicalEnergyEnvelopeWitness);
staleDestinationLoss.source.sharedIdentity.destinationStateTrainingLoss.authority = 'candidate-splat-visible-energy-weighted-loss-v0';
assert.throws(
  () => cohortAudit.validateMotionCohortWitness(staleDestinationLoss),
  /physical visible-energy loss identity/i,
  'an old destination-state objective must not masquerade as the corrected physical-energy experiment',
);
const counterfeitDestinationChannels = structuredClone(physicalEnergyEnvelopeWitness);
counterfeitDestinationChannels.source.sharedIdentity.destinationStateTrainingLoss.visibleEnergyChannels.opacity = 22;
assert.throws(
  () => cohortAudit.validateMotionCohortWitness(counterfeitDestinationChannels),
  /physical visible-energy loss identity/i,
  'a corrected authority token cannot hide stale effective channel indices',
);
for (const mutate of [
  identity => { identity.visibleEnergy = 'max(shape.y,0)*rec709(color.b,opacity,shape.x)'; },
  identity => { identity.weights.splat = 0.5; },
  identity => { identity.weights.visibleEnergy = 0.5; },
  identity => { identity.responseAnchor.weight = 999; },
  identity => { delete identity.responseAnchor; },
  identity => { identity.splatAttributeOrder[1] = 'splat.color.counterfeit'; },
  identity => { identity.unexpectedObjective = { weight: 1.0 }; },
]) {
  const alternateObjective = structuredClone(physicalEnergyEnvelopeWitness);
  mutate(alternateObjective.source.sharedIdentity.destinationStateTrainingLoss);
  assert.throws(
    () => cohortAudit.validateMotionCohortWitness(alternateObjective),
    /physical visible-energy loss identity/i,
    'v1 must bind formula and all objective weights, not only authority and channel indices',
  );
}
for (const mutate of [
  identity => { identity.mode = 'protected-online-rollout'; },
  identity => { identity.authority = 'protected-splat-online-scheduled-exposure-training-v0'; },
]) {
  const alternateTraining = structuredClone(physicalEnergyEnvelopeWitness);
  mutate(alternateTraining.source.sharedIdentity.destinationStateTraining);
  assert.throws(
    () => cohortAudit.validateMotionCohortWitness(alternateTraining),
    /destination state training identity/i,
    'v1 must bind anchored training mode as well as the projected loss terms',
  );
}
const missingWitnessCorpora = structuredClone(physicalEnergyEnvelopeWitness);
delete missingWitnessCorpora.source.sharedIdentity.destinationStateCorpora;
assert.throws(
  () => cohortAudit.validateMotionCohortWitness(missingWitnessCorpora),
  /destination state corpus identity/i,
);
const counterfeitWitnessCorpus = structuredClone(physicalEnergyEnvelopeWitness);
counterfeitWitnessCorpus.source.sharedIdentity.destinationStateCorpora.evaluationManifestSha256 = 'f'.repeat(64);
assert.throws(
  () => cohortAudit.validateMotionCohortWitness(counterfeitWitnessCorpus),
  /destination state corpus identity/i,
);

const fullLoss = structuredClone(physicalEnergyEnvelopeWitness.source.sharedIdentity.destinationStateTrainingLoss);
delete fullLoss.splatAttributeOrder;
const destinationModel = {
  schema: 'kaminos-boundary-splat-phase-destination-state-model-v0',
  status: 'completed',
  route: { backend: 'mlx', device: 'Device(gpu, 0)', fallbackReason: null },
  output: {
    authority: 'candidate-16-plus-nonposition-splat-9-donor-residual-v0',
    attributeCount: 25,
    attributeOrder: [...Array.from({ length: 16 }, (_, index) => `candidate.${index}`), ...physicalEnergyEnvelopeWitness.source.sharedIdentity.destinationStateTrainingLoss.splatAttributeOrder],
  },
  training: {
    distribution: {
      authority: physicalEnergyEnvelopeWitness.source.sharedIdentity.destinationStateTraining.authority,
      mode: physicalEnergyEnvelopeWitness.source.sharedIdentity.destinationStateTraining.mode,
      loss: structuredClone(fullLoss),
    },
    loss: { ...structuredClone(fullLoss), visibleEnergyScale: 0.01 },
  },
  trainingManifest: { sha256: '6'.repeat(64) },
  evaluationManifest: { sha256: 'b'.repeat(64) },
};
const destinationReportIdentity = {
  trainingManifest: { sha256: '6'.repeat(64) },
  evaluationManifest: { sha256: 'b'.repeat(64) },
};
assert.deepEqual(
  cohortAudit.physicalDestinationStateModelIdentity(destinationModel, destinationReportIdentity),
  {
    training: physicalEnergyEnvelopeWitness.source.sharedIdentity.destinationStateTraining,
    loss: physicalEnergyEnvelopeWitness.source.sharedIdentity.destinationStateTrainingLoss,
    corpora: physicalEnergyEnvelopeWitness.source.sharedIdentity.destinationStateCorpora,
  },
);
for (const mutate of [
  model => { model.training.distribution.loss.responseAnchor.weight = 999; model.training.loss.responseAnchor.weight = 999; },
  model => { delete model.training.distribution.loss.responseAnchor; delete model.training.loss.responseAnchor; },
  model => { model.training.distribution.mode = 'protected-online-rollout'; },
  model => { model.training.distribution.authority = 'protected-splat-online-scheduled-exposure-training-v0'; },
]) {
  const model = structuredClone(destinationModel);
  mutate(model);
  assert.throws(
    () => cohortAudit.physicalDestinationStateModelIdentity(model, structuredClone(destinationReportIdentity)),
    /destination state model .*identity mismatch/i,
    'checkpoint identity must reject anchor and training-mode counterfeits',
  );
}
for (const mutate of [
  (model, report) => { delete model.trainingManifest; },
  (model, report) => { delete report.evaluationManifest; },
  (model, report) => { report.trainingManifest.sha256 = 'e'.repeat(64); },
  (model, report) => { model.evaluationManifest.sha256 = 'd'.repeat(64); },
]) {
  const model = structuredClone(destinationModel);
  const report = structuredClone(destinationReportIdentity);
  mutate(model, report);
  assert.throws(
    () => cohortAudit.physicalDestinationStateModelIdentity(model, report),
    /destination state model corpus identity/i,
    'joint absence and mismatched model/report corpus receipts must fail before raster work',
  );
}
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
