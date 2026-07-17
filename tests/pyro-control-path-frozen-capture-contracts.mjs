#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildFrozenCaptureComparison,
  buildFrozenCaptureWitnessUrl,
  PYRO_CONTROL_PATH_FROZEN_CAPTURE_SCHEMA,
} from '../pyro-control-path-frozen-capture-ledger.mjs';

function capture(composition, overrides = {}) {
  return {
    composition,
    requestedComposition: composition,
    effectiveComposition: composition,
    compositionAuthority: 'selective-head-live-render-composition-authority-v0',
    passReceipt: {
      raymarchApplied: composition !== 'splat-only-v0',
      splatApplied: true,
      raymarchFireAuthority: composition === 'full-raymarch-under-splats-diagnostic-v0' ? 1 : 0,
      ...overrides.passReceipt,
    },
    boundarySplatGpuProfile: {
      candidateCopyBytes: overrides.candidateCopyBytes ?? 4096,
      timestampStatus: 'supported',
    },
    screenshot: {
      path: `/tmp/${composition}.png`,
      byteLength: overrides.byteLength ?? 32000,
      sha256: overrides.sha256 ?? `${composition.replace(/[^a-z0-9]/g, '').padEnd(64, 'a').slice(0, 64)}`,
    },
  };
}

function report(url, overrides = {}) {
  return {
    schema: 'kaminos.volume.selective-head-composition-witness.v0',
    identity: 'same-state-selective-head-render-composition-witness-v0',
    status: 'captured',
    failurePhase: null,
    requestedUrl: url,
    effectiveRoute: 'exact-basin-selective-head-live-v0',
    modelIdentity: 'exact-basin-selective-carrier-heads-160-to-128-v0',
    sameStateAuthority: 'same-state-selective-render-composition-v0',
    sameStateSimStep: 96,
    compositions: [
      'splat-only-v0',
      'smoke-raymarch-under-splats-v0',
      'full-raymarch-under-splats-diagnostic-v0',
    ],
    captures: [
      capture('splat-only-v0', overrides.splatOnly),
      capture('smoke-raymarch-under-splats-v0', overrides.smokeHybrid),
      capture('full-raymarch-under-splats-diagnostic-v0', overrides.fullHybrid),
    ],
  };
}

const baselineUrl = buildFrozenCaptureWitnessUrl('http://127.0.0.1:8099/volume-selective-head-live.html', {
  volume_boundary_splat_mode: 'learned',
  volume_reaction_boundary_support_front: 0.4,
});
const treatmentUrl = buildFrozenCaptureWitnessUrl('http://127.0.0.1:8099/volume-selective-head-live.html', {
  volume_boundary_splat_mode: 'learned',
  volume_reaction_boundary_support_front: 1.6,
});

assert.match(baselineUrl, /volume_boundary_splat_mode=learned/);
assert.match(treatmentUrl, /volume_reaction_boundary_support_front=1\.6/);

const comparison = buildFrozenCaptureComparison({
  control: 'volume_reaction_boundary_support_front',
  requestedBaseline: 0.4,
  requestedTreatment: 1.6,
  baselineReport: report(baselineUrl),
  treatmentReport: report(treatmentUrl, {
    splatOnly: { sha256: 'b'.repeat(64), byteLength: 36000, candidateCopyBytes: 8192 },
    smokeHybrid: { sha256: 'c'.repeat(64), byteLength: 41000, candidateCopyBytes: 8192 },
    fullHybrid: { sha256: 'd'.repeat(64), byteLength: 43000, candidateCopyBytes: 8192 },
  }),
});

assert.equal(comparison.schema, PYRO_CONTROL_PATH_FROZEN_CAPTURE_SCHEMA);
assert.equal(comparison.classification, 'browser-gpu-frozen-capture-positive');
assert.equal(comparison.control, 'volume_reaction_boundary_support_front');
assert.equal(comparison.requested.baselineUrlValue, '0.4');
assert.equal(comparison.requested.treatmentUrlValue, '1.6');
assert.equal(comparison.requested.effectiveEqualsRequested, true);
assert.equal(comparison.identity.effectiveRoute, 'exact-basin-selective-head-live-v0');
assert.equal(comparison.identity.sameStateAuthority, 'same-state-selective-render-composition-v0');
assert.equal(comparison.identity.sourceStateComparable, true);
assert.equal(comparison.fallback, null);
assert.equal(comparison.postLoadMutation, null);
assert.equal(comparison.appliedPasses.splatApplied, true);
assert.equal(comparison.appliedPasses.raymarchApplied, true);
assert.equal(comparison.deltas.screenshotHashChangedCount, 3);
assert.equal(comparison.deltas.screenshotByteLengthMeanAbs, 8000);
assert.equal(comparison.deltas.boundarySplatGpuProfile.candidateCopyBytesMeanAbs, 4096);
assert.ok(comparison.captures.every(item => item.baseline.sha256 !== item.treatment.sha256));

const negative = buildFrozenCaptureComparison({
  control: 'volume_reaction_boundary_support_front',
  requestedBaseline: 0.4,
  requestedTreatment: 1.6,
  baselineReport: report(baselineUrl),
  treatmentReport: report(treatmentUrl),
});

assert.equal(negative.classification, 'browser-gpu-frozen-capture-no-delta');
assert.equal(negative.catches, 'requested-effective-match-with-zero-browser-gpu-frozen-capture-delta');
assert.equal(negative.falsifier.tripped, true);
assert.equal(negative.deltas.screenshotHashChangedCount, 0);

const drift = buildFrozenCaptureComparison({
  control: 'volume_reaction_boundary_support_front',
  requestedBaseline: 0.4,
  requestedTreatment: 1.6,
  baselineReport: report(baselineUrl),
  treatmentReport: {
    ...report(treatmentUrl, {
      splatOnly: { sha256: 'e'.repeat(64), byteLength: 36000, candidateCopyBytes: 8192 },
    }),
    sameStateSimStep: 97,
  },
});

assert.equal(drift.classification, 'browser-gpu-frozen-capture-source-step-drift');
assert.equal(drift.catches, 'browser-gpu-frozen-capture-source-step-drift');
assert.equal(drift.falsifier.tripped, true);
assert.equal(drift.identity.sourceStateComparable, false);

assert.throws(() => buildFrozenCaptureComparison({
  control: 'volume_reaction_boundary_support_front',
  requestedBaseline: 0.4,
  requestedTreatment: 1.6,
  baselineReport: report('http://127.0.0.1:8099/volume-selective-head-live.html?volume_boundary_splat_mode=learned'),
  treatmentReport: report(treatmentUrl),
}), /baseline report requestedUrl is missing volume_reaction_boundary_support_front/);

console.log('pyro control-path frozen capture contracts passed');
