import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  PHYSICAL_SPLAT_CHANNELS,
  buildCollapseAttributionVariants,
  substituteMatchedChannels,
  validateCollapseAttributionReport,
  visibleSplatEnergy,
} from '../boundary-splat-phase-collapse-attribution.mjs';

const row = (x, values = {}) => [
  x, 0, 0,
  values.support ?? 0.25,
  ...(values.color ?? [0.2, 0.4, 0.8]),
  values.opacity ?? 0.5,
  ...(values.shape ?? [0.01, 0.02]),
  ...(values.diagnostics ?? [0.3, 0.7]),
];

assert.deepEqual(PHYSICAL_SPLAT_CHANNELS, {
  support: [3],
  color: [4, 5, 6],
  opacity: [7],
  shape: [8, 9],
  diagnostics: [10, 11],
});

const energyRow = row(0, {
  color: [1, 0.5, 0.25],
  opacity: 0.2,
  shape: [9, 11],
});
assert.equal(
  visibleSplatEnergy(energyRow),
  0.2 * (1 * 0.2126 + 0.5 * 0.7152 + 0.25 * 0.0722),
  'visible energy must use physical color.rgb and opacity, never shape channels',
);

const predicted = [
  row(0, { color: [0.9, 0.8, 0.7], opacity: 0.6, shape: [0.08, 0.09] }),
  row(1, { color: [0.7, 0.6, 0.5], opacity: 0.4, shape: [0.06, 0.07] }),
];
const exact = [
  row(0, { color: [0.1, 0.2, 0.3], opacity: 0.2, shape: [0.01, 0.02] }),
  row(2, { color: [0.3, 0.4, 0.5], opacity: 0.3, shape: [0.02, 0.03] }),
];
const frozen = [
  row(0, { color: [0.2, 0.3, 0.4], opacity: 0.25, shape: [0.015, 0.025] }),
  row(3),
];

const colorRestored = substituteMatchedChannels(predicted, exact, ['color']);
assert.deepEqual(colorRestored.rows[0].slice(4, 7), exact[0].slice(4, 7));
assert.deepEqual(colorRestored.rows[0].slice(7), predicted[0].slice(7));
assert.deepEqual(colorRestored.rows[1], predicted[1], 'unmatched false support must remain explicit prediction state');
assert.deepEqual(colorRestored.accounting, {
  authority: 'world-position-exact-channel-substitution-v0',
  donorRole: 'donor',
  channelFamilies: ['color'],
  recipientCount: 2,
  donorCount: 2,
  matchedCount: 1,
  unmatchedRecipientCount: 1,
  unusedDonorCount: 1,
});

const variants = buildCollapseAttributionVariants(predicted, exact, frozen);
assert.deepEqual(Object.keys(variants), [
  'prediction',
  'exactSupportPredictedVisible',
  'predictedSupportExactVisible',
  'exactColorOnPredictedSupport',
  'exactOpacityOnPredictedSupport',
  'exactShapeOnPredictedSupport',
  'frozenVisibleOnPredictedSupport',
]);
assert.deepEqual(variants.prediction.rows, predicted);
assert.equal(variants.exactSupportPredictedVisible.rows.length, exact.length);
assert.equal(variants.predictedSupportExactVisible.rows.length, predicted.length);
assert.equal(variants.exactSupportPredictedVisible.authority, 'exact-support-with-position-matched-predicted-visible-state-v0');
assert.equal(variants.predictedSupportExactVisible.authority, 'predicted-support-with-position-matched-exact-visible-state-v0');
assert.deepEqual(variants.exactColorOnPredictedSupport.rows[0].slice(4, 7), exact[0].slice(4, 7));
assert.equal(variants.exactOpacityOnPredictedSupport.rows[0][7], exact[0][7]);
assert.deepEqual(variants.exactShapeOnPredictedSupport.rows[0].slice(8, 10), exact[0].slice(8, 10));
assert.deepEqual(variants.frozenVisibleOnPredictedSupport.rows[0].slice(4, 10), frozen[0].slice(4, 10));

const hash = value => createHash('sha256').update(value).digest('hex');
const frameEvidence = (prefix, count = 2) => Array.from({ length: count }, (_, index) => ({
  step: index + 1,
  sha256: hash(`${prefix}${index + 1}`),
  inputSplatCount: 2,
  nonBackgroundPixelCount: 10,
  projectedSplatCount: 2,
}));
const validReport = {
  schema: 'kaminos-boundary-splat-phase-collapse-attribution-v0',
  status: 'completed',
  source: {
    manifest: { sha256: hash('a') },
    predictions: { sha256: hash('b') },
    requestedRoute: 'live-crosswind-route',
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    backend: { backend: 'mlx', device: 'Device(gpu, 0)', fallbackReason: null },
  },
  configuration: {
    authority: 'raw-full-opacity-physical-splat-channel-attribution-v0',
    requestedFrameCount: 2,
    effectiveFrameCount: 2,
    frameSelection: 'uncapped-complete-heldout-episode-v0',
    staticAttenuation: 1,
    unmatchedAttenuation: 1,
    channelFamilies: PHYSICAL_SPLAT_CHANNELS,
  },
  playback: { frameCount: 2, effectiveFps: 6.25, encodedDurationSeconds: 0.32, loops: false },
  roles: Object.fromEntries(Object.keys(variants).map(key => [key, variants[key].authority])),
  roleEvidence: Object.fromEntries(Object.keys(variants).map(key => [key, frameEvidence(key)])),
  substitutionAccounting: {
    prediction: Array.from({ length: 2 }, (_, index) => ({
      step: index + 1,
      authority: 'unmodified-learned-recurrent-state-v0',
      recipientCount: 2,
    })),
    exactSupportPredictedVisible: Array.from({ length: 2 }, (_, index) => ({
      step: index + 1,
      authority: 'world-position-exact-channel-substitution-v0',
      donorRole: 'prediction',
      channelFamilies: ['color', 'opacity', 'shape'],
      recipientCount: 2,
      donorCount: 2,
      matchedCount: 1,
      unmatchedRecipientCount: 1,
      unusedDonorCount: 1,
    })),
    predictedSupportExactVisible: Array.from({ length: 2 }, (_, index) => ({
      step: index + 1,
      authority: 'world-position-exact-channel-substitution-v0',
      donorRole: 'exact-target',
      channelFamilies: ['color', 'opacity', 'shape'],
      recipientCount: 2,
      donorCount: 2,
      matchedCount: 1,
      unmatchedRecipientCount: 1,
      unusedDonorCount: 1,
    })),
    exactColorOnPredictedSupport: Array.from({ length: 2 }, (_, index) => ({
      step: index + 1,
      authority: 'world-position-exact-channel-substitution-v0',
      donorRole: 'exact-target',
      channelFamilies: ['color'],
      recipientCount: 2,
      donorCount: 2,
      matchedCount: 1,
      unmatchedRecipientCount: 1,
      unusedDonorCount: 1,
    })),
    exactOpacityOnPredictedSupport: Array.from({ length: 2 }, (_, index) => ({
      step: index + 1,
      authority: 'world-position-exact-channel-substitution-v0',
      donorRole: 'exact-target',
      channelFamilies: ['opacity'],
      recipientCount: 2,
      donorCount: 2,
      matchedCount: 1,
      unmatchedRecipientCount: 1,
      unusedDonorCount: 1,
    })),
    exactShapeOnPredictedSupport: Array.from({ length: 2 }, (_, index) => ({
      step: index + 1,
      authority: 'world-position-exact-channel-substitution-v0',
      donorRole: 'exact-target',
      channelFamilies: ['shape'],
      recipientCount: 2,
      donorCount: 2,
      matchedCount: 1,
      unmatchedRecipientCount: 1,
      unusedDonorCount: 1,
    })),
    frozenVisibleOnPredictedSupport: Array.from({ length: 2 }, (_, index) => ({
      step: index + 1,
      authority: 'world-position-exact-channel-substitution-v0',
      donorRole: 'frozen-present',
      channelFamilies: ['color', 'opacity', 'shape'],
      recipientCount: 2,
      donorCount: 2,
      matchedCount: 1,
      unmatchedRecipientCount: 1,
      unusedDonorCount: 1,
    })),
  },
  frozenControlEvidence: [{ ...frameEvidence('control')[0] }, { ...frameEvidence('control')[0], step: 2 }],
  frozenControlIdentity: { authority: 'pixel-identical-frozen-control-v0', frameCount: 2, uniqueFrameCount: 1, sha256: frameEvidence('control')[0].sha256 },
  artifact: { sha256: hash('c'), bytes: 100, probe: { frameCount: 2, width: 2240, height: 240, fps: 6.25, duration: 0.32 } },
  metrics: { authority: 'same-raster-full-frame-error-v0', roles: Object.fromEntries(Object.keys(variants).map(key => [key, { lateMse: 1 }])) },
  claimBoundary: 'These causal offline substitutions are not deployable predictions and do not authorize runtime composition.',
};
assert.doesNotThrow(() => validateCollapseAttributionReport(validReport));

const missingAccounting = structuredClone(validReport);
delete missingAccounting.substitutionAccounting;
assert.throws(() => validateCollapseAttributionReport(missingAccounting), /substitution accounting/i);
const partialAccounting = structuredClone(validReport);
partialAccounting.substitutionAccounting.exactColorOnPredictedSupport.pop();
assert.throws(() => validateCollapseAttributionReport(partialAccounting), /substitution accounting/i);
const wrongAccountingAuthority = structuredClone(validReport);
wrongAccountingAuthority.substitutionAccounting.exactShapeOnPredictedSupport[0].authority = 'aggregate-only-counterfeit-v0';
assert.throws(() => validateCollapseAttributionReport(wrongAccountingAuthority), /substitution accounting/i);
const wrongFamily = structuredClone(validReport);
wrongFamily.substitutionAccounting.predictedSupportExactVisible[0].channelFamilies = ['support'];
assert.throws(() => validateCollapseAttributionReport(wrongFamily), /channel families/i);
const incoherentCounts = structuredClone(validReport);
incoherentCounts.substitutionAccounting.exactOpacityOnPredictedSupport[0].unmatchedRecipientCount = 0;
assert.throws(() => validateCollapseAttributionReport(incoherentCounts), /substitution accounting/i);
const recipientMismatch = structuredClone(validReport);
recipientMismatch.substitutionAccounting.exactColorOnPredictedSupport[0].recipientCount = 3;
assert.throws(() => validateCollapseAttributionReport(recipientMismatch), /recipient count/i);
const blankBoundary = structuredClone(validReport);
blankBoundary.claimBoundary = '';
assert.throws(() => validateCollapseAttributionReport(blankBoundary), /claim boundary/i);
const deployableBoundary = structuredClone(validReport);
deployableBoundary.claimBoundary = 'This is a deployable prediction and runtime authorization.';
assert.throws(() => validateCollapseAttributionReport(deployableBoundary), /claim boundary/i);

const movingControl = structuredClone(validReport);
movingControl.frozenControlEvidence[1].sha256 = hash('z');
assert.throws(() => validateCollapseAttributionReport(movingControl), /frozen control/i);
const fallback = structuredClone(validReport);
fallback.source.backend.fallbackReason = 'cpu';
assert.throws(() => validateCollapseAttributionReport(fallback), /backend/i);
const staleMode = structuredClone(validReport);
staleMode.configuration.staticAttenuation = 0.1;
assert.throws(() => validateCollapseAttributionReport(staleMode), /full opacity/i);
const hiddenCap = structuredClone(validReport);
hiddenCap.configuration.effectiveFrameCount = 1;
assert.throws(() => validateCollapseAttributionReport(hiddenCap), /frame count/i);
const partial = structuredClone(validReport);
partial.roleEvidence.prediction.pop();
assert.throws(() => validateCollapseAttributionReport(partial), /role evidence/i);
const blank = structuredClone(validReport);
blank.roleEvidence.prediction[0].nonBackgroundPixelCount = 0;
assert.throws(() => validateCollapseAttributionReport(blank), /blank/i);
const cachedPrediction = structuredClone(validReport);
cachedPrediction.roleEvidence.prediction[1].sha256 = cachedPrediction.roleEvidence.prediction[0].sha256;
assert.throws(() => validateCollapseAttributionReport(cachedPrediction), /cached|static/i);

const root = resolve(import.meta.dirname, '..');
const failedOut = await mkdtemp(join(tmpdir(), 'kaminos-collapse-attribution-failure-'));
const failed = spawnSync(process.execPath, [
  join(root, 'boundary-splat-phase-collapse-attribution.mjs'),
  '--manifest', join(failedOut, 'missing-manifest.json'),
  '--predictions', join(failedOut, 'missing-predictions.json'),
  '--out-dir', failedOut,
], { encoding: 'utf8' });
assert.notEqual(failed.status, 0, 'failure fixture must fail before primary output');
const failureReport = JSON.parse(await readFile(join(failedOut, 'phase-collapse-attribution.json'), 'utf8'));
assert.equal(failureReport.status, 'failed');
assert.equal(failureReport.failurePhase, 'source-validation');
assert.match(failureReport.error, /ENOENT|no such file/i);
assert.equal(failureReport.lastTrustworthyEvidence.outDir, failedOut);

console.log('boundary splat phase collapse attribution contracts passed');
