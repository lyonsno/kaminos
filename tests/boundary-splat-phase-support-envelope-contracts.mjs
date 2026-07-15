import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  SUPPORT_ENVELOPE_SELECTORS,
  calibrateSupportCountEnvelope,
  selectSupportEnvelopeRows,
  supportEnvelopeBudget,
  validateSupportEnvelopeReport,
} from '../boundary-splat-phase-support-envelope-witness.mjs';
import { addBitmapLabel } from '../boundary-splat-moving-phase-witness.mjs';

const calibration = calibrateSupportCountEnvelope([100, 110, 90, 120]);
assert.deepEqual(calibration, {
  authority: 'training-episode-frame-zero-relative-support-envelope-v0',
  frameCount: 4,
  frameZeroCount: 100,
  minimumCount: 90,
  maximumCount: 120,
  minimumRatio: 0.9,
  maximumRatio: 1.2,
});
assert.equal(supportEnvelopeBudget(100, 110, 1.01, calibration), 111);
assert.equal(supportEnvelopeBudget(100, 120, 1.01, calibration), 120, 'one-step growth must clamp at the episode-relative ceiling');
assert.equal(supportEnvelopeBudget(100, 80, 0.95, calibration), 90, 'one-step decay must clamp at the episode-relative floor');

const splat = (x, support, opacity, color = [1, 0.5, 0.25]) => [
  x, 0, 0, support,
  ...color, opacity,
  0.01, 0.02, 0.3, 0.7,
];
const candidate = support => [support, ...Array(15).fill(0)];
const rows = [
  splat(0, 0.9, 0.1),
  splat(1, 0.2, 0.9),
  splat(2, 0.7, 0.5),
  splat(3, 0.5, 0.2),
];
const candidates = [candidate(0.1), candidate(0.8), candidate(0.4), candidate(0.6)];
assert.deepEqual(Object.keys(SUPPORT_ENVELOPE_SELECTORS), ['candidateSupport', 'physicalSupport', 'visibleEnergy']);
const byCandidate = selectSupportEnvelopeRows(rows, candidates, 2, 'candidateSupport');
assert.deepEqual(byCandidate.rows.map(row => row[0]), [1, 3], 'selection must retain original raster order after ranking');
assert.deepEqual(byCandidate.accounting, {
  authority: 'deterministic-state-local-support-envelope-selection-v0',
  selector: 'candidateSupport',
  inputCount: 4,
  budget: 2,
  selectedCount: 2,
  droppedCount: 2,
  scoreMinimum: 0.6,
  scoreMaximum: 0.8,
});
assert.deepEqual(selectSupportEnvelopeRows(rows, candidates, 2, 'physicalSupport').rows.map(row => row[0]), [0, 2]);
assert.deepEqual(selectSupportEnvelopeRows(rows, candidates, 2, 'visibleEnergy').rows.map(row => row[0]), [1, 2]);
assert.throws(() => selectSupportEnvelopeRows(rows, candidates, 5, 'candidateSupport'), /budget/i);
assert.throws(() => selectSupportEnvelopeRows(rows, candidates.slice(1), 2, 'candidateSupport'), /align/i);

const hash = value => createHash('sha256').update(value).digest('hex');
const frameEvidence = (role, count = 2) => Array.from({ length: count }, (_, index) => ({
  step: index + 1,
  sha256: hash(`${role}-${index}`),
  nonBackgroundPixelCount: 10,
  projectedSplatCount: 2,
}));
const roles = {
  prediction: 'unmodified-learned-recurrent-full-splat-state-v0',
  candidateSupport: 'training-envelope-top-protected-candidate-support-v0',
  physicalSupport: 'training-envelope-top-physical-splat-support-v0',
  visibleEnergy: 'training-envelope-top-physical-visible-energy-v0',
};
const selectionAccounting = Object.fromEntries(Object.keys(SUPPORT_ENVELOPE_SELECTORS).map(selector => [
  selector,
  Array.from({ length: 2 }, (_, index) => ({
    step: index + 1,
    ceilingBudget: 120,
    authority: 'deterministic-state-local-support-envelope-selection-v0',
    selector,
    inputCount: 100,
    budget: 100,
    selectedCount: 100,
    droppedCount: 0,
    scoreMinimum: 0,
    scoreMaximum: 1,
  })),
]));
const validReport = {
  schema: 'kaminos-boundary-splat-phase-support-envelope-witness-v0',
  status: 'completed',
  source: {
    trainingManifest: { path: '/tmp/train.json', bytes: 100, sha256: hash('train') },
    evaluationManifest: { path: '/tmp/eval.json', bytes: 100, sha256: hash('eval') },
    predictions: { path: '/tmp/pred.json', bytes: 100, sha256: hash('pred') },
    occupancyModel: {
      path: '/tmp/occupancy-model.json',
      schema: 'kaminos-boundary-splat-phase-transport-model-v0',
      sha256: hash('occupancy-model'),
    },
    destinationStateModel: {
      path: '/tmp/destination-state-model.json',
      schema: 'kaminos-boundary-splat-phase-destination-state-model-v0',
      sha256: hash('destination-state-model'),
      trainingManifest: { path: '/tmp/train.json', bytes: 100, sha256: hash('train') },
      evaluationManifest: { path: '/tmp/eval.json', bytes: 100, sha256: hash('eval') },
    },
    requestedRoute: 'crosswind',
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    backend: { backend: 'mlx', device: 'Device(gpu, 0)', fallbackReason: null },
  },
  configuration: {
    authority: 'post-composition-zero-training-support-envelope-falsifier-v0',
    requestedFrameCount: 2,
    effectiveFrameCount: 2,
    frameSelection: 'uncapped-complete-heldout-episode-v0',
    staticAttenuation: 1,
    unmatchedAttenuation: 1,
    envelope: calibration,
    selectors: Object.keys(SUPPORT_ENVELOPE_SELECTORS),
    frameZeroEvaluationCount: 100,
    ceilingBudget: 120,
    oneStepMedianRatio: 1.01,
    counterfactualBudgetAtCeiling: 120,
    retrained: false,
    recurrenceRegenerated: false,
  },
  playback: { frameCount: 2, effectiveFps: 6.25, encodedDurationSeconds: 0.32, loops: false },
  roles,
  roleEvidence: Object.fromEntries(Object.keys(roles).map(role => [role, frameEvidence(role)])),
  selectionAccounting,
  frozenControlEvidence: [{ ...frameEvidence('frozen')[0] }, { ...frameEvidence('frozen')[0], step: 2 }],
  frozenControlIdentity: { authority: 'pixel-identical-frozen-control-v0', frameCount: 2, uniqueFrameCount: 1, sha256: frameEvidence('frozen')[0].sha256 },
  artifact: { sha256: hash('video'), bytes: 100, probe: { frameCount: 2, width: 1920, height: 240, fps: 6.25, duration: 0.32 } },
  metrics: { authority: 'same-raster-full-frame-error-v0', roles: Object.fromEntries(Object.keys(roles).map(role => [role, { lateMse: 1 }])) },
  claimBoundary: 'post-composition diagnostic only; cannot prove recurrent stability, a deployable predictor, or runtime integration',
};
assert.doesNotThrow(() => validateSupportEnvelopeReport(validReport));
const decayingOneStepContext = structuredClone(validReport);
decayingOneStepContext.configuration.oneStepMedianRatio = 0.5;
assert.doesNotThrow(
  () => validateSupportEnvelopeReport(decayingOneStepContext),
  'post-composition selector budget depends on the training ceiling, not the recorded one-step ratio',
);
const capped = structuredClone(validReport);
capped.configuration.effectiveFrameCount = 1;
assert.throws(() => validateSupportEnvelopeReport(capped), /frame count/i);
const masked = structuredClone(validReport);
masked.configuration.staticAttenuation = 0.1;
assert.throws(() => validateSupportEnvelopeReport(masked), /full opacity/i);
const fallback = structuredClone(validReport);
fallback.source.backend.fallbackReason = 'cpu';
assert.throws(() => validateSupportEnvelopeReport(fallback), /backend/i);
const partial = structuredClone(validReport);
partial.roleEvidence.candidateSupport.pop();
assert.throws(() => validateSupportEnvelopeReport(partial), /role evidence/i);
const blank = structuredClone(validReport);
blank.roleEvidence.physicalSupport[0].nonBackgroundPixelCount = 0;
assert.throws(() => validateSupportEnvelopeReport(blank), /blank/i);
const cached = structuredClone(validReport);
cached.roleEvidence.prediction[1].sha256 = cached.roleEvidence.prediction[0].sha256;
assert.throws(() => validateSupportEnvelopeReport(cached), /cached|static/i);
const dishonest = structuredClone(validReport);
dishonest.configuration.recurrenceRegenerated = true;
assert.throws(() => validateSupportEnvelopeReport(dishonest), /post-composition/i);

const missingOccupancyModel = structuredClone(validReport);
delete missingOccupancyModel.source.occupancyModel;
assert.throws(() => validateSupportEnvelopeReport(missingOccupancyModel), /occupancy model identity/i);
const badDestinationModel = structuredClone(validReport);
badDestinationModel.source.destinationStateModel.sha256 = 'not-a-sha';
assert.throws(() => validateSupportEnvelopeReport(badDestinationModel), /destination state model identity/i);
const staleDestinationTraining = structuredClone(validReport);
staleDestinationTraining.source.destinationStateModel.trainingManifest.sha256 = hash('stale-train');
assert.throws(() => validateSupportEnvelopeReport(staleDestinationTraining), /destination state model.*training/i);
const badRoleStep = structuredClone(validReport);
badRoleStep.roleEvidence.prediction[1].step = 9;
assert.throws(() => validateSupportEnvelopeReport(badRoleStep), /role evidence step/i);
const badFrozenStep = structuredClone(validReport);
badFrozenStep.frozenControlEvidence[1].step = 9;
assert.throws(() => validateSupportEnvelopeReport(badFrozenStep), /frozen control step/i);
const partialSelectionAccounting = structuredClone(validReport);
partialSelectionAccounting.selectionAccounting.candidateSupport.pop();
assert.throws(() => validateSupportEnvelopeReport(partialSelectionAccounting), /selection accounting/i);
const badSelectedCount = structuredClone(validReport);
badSelectedCount.selectionAccounting.physicalSupport[0].selectedCount = 99;
assert.throws(() => validateSupportEnvelopeReport(badSelectedCount), /selection accounting/i);
const badBudget = structuredClone(validReport);
badBudget.selectionAccounting.visibleEnergy[0].budget = 99;
assert.throws(() => validateSupportEnvelopeReport(badBudget), /selection accounting/i);
const badDroppedCount = structuredClone(validReport);
badDroppedCount.selectionAccounting.candidateSupport[0].droppedCount = 1;
assert.throws(() => validateSupportEnvelopeReport(badDroppedCount), /selection accounting/i);
const blankClaimBoundary = structuredClone(validReport);
blankClaimBoundary.claimBoundary = '';
assert.throws(() => validateSupportEnvelopeReport(blankClaimBoundary), /claim boundary/i);
const deployableClaimBoundary = structuredClone(validReport);
deployableClaimBoundary.claimBoundary = 'post-composition evidence proves recurrent stability and authorizes runtime integration';
assert.throws(() => validateSupportEnvelopeReport(deployableClaimBoundary), /claim boundary/i);

const blankRendered = { width: 180, height: 16, rgba: Buffer.alloc(180 * 16 * 4) };
for (const label of ['REFERENCE', 'FROZEN', 'PREDICTED', 'CANDIDATE SUPPORT', 'PHYSICAL SUPPORT', 'VISIBLE ENERGY']) {
  assert.doesNotThrow(() => addBitmapLabel(blankRendered, label), `label must render completely: ${label}`);
}
assert.throws(() => addBitmapLabel(blankRendered, 'UNSUPPORTED?'), /unsupported bitmap label character/i);

const root = resolve(import.meta.dirname, '..');
const failedOut = await mkdtemp(join(tmpdir(), 'kaminos-support-envelope-failure-'));
const failed = spawnSync(process.execPath, [
  join(root, 'boundary-splat-phase-support-envelope-witness.mjs'),
  '--training-manifest', join(failedOut, 'missing-training.json'),
  '--evaluation-manifest', join(failedOut, 'missing-evaluation.json'),
  '--predictions', join(failedOut, 'missing-predictions.json'),
  '--out-dir', failedOut,
], { encoding: 'utf8' });
assert.notEqual(failed.status, 0, 'pre-output source failure must fail the process');
const failureReport = JSON.parse(await readFile(join(failedOut, 'phase-support-envelope-witness.json'), 'utf8'));
assert.equal(failureReport.status, 'failed');
assert.equal(failureReport.failurePhase, 'source-validation');
assert.match(failureReport.error, /ENOENT|no such file/i);
assert.equal(failureReport.lastTrustworthyEvidence.outDir, failedOut);

console.log('boundary splat phase support envelope contracts passed');
