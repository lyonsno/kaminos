#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contractPath = join(root, 'volume-nonridge-randomized-capture-contract.mjs');
const witnessPath = join(root, 'volume-nonridge-randomized-capture-witness.mjs');
const corePath = join(root, 'volume-core.js');
const indexPath = join(root, 'index.html');

assert.ok(existsSync(contractPath), 'randomized Non-Ridge capture contract exists');
assert.ok(existsSync(witnessPath), 'randomized Non-Ridge browser witness exists');

const {
  NONRIDGE_RANDOMIZED_CONTROL_FIELDS,
  NONRIDGE_RANDOMIZED_CAPTURE_SEED,
  buildNonRidgeRandomizedControlTranche,
  decodeNonRidgeOpticalRows,
} = await import(contractPath);

assert.equal(NONRIDGE_RANDOMIZED_CAPTURE_SEED, 20260716, 'the assay seed is explicit and stable');
assert.deepEqual(
  NONRIDGE_RANDOMIZED_CONTROL_FIELDS.map(({ key, min, max }) => [key, min, max]),
  [
    ['reactionBoundarySupportThermal', 0, 2],
    ['reactionBoundarySupportReaction', 0, 2],
    ['reactionBoundarySupportFront', 0, 2],
    ['reactionBoundarySupportInterface', 0, 2],
    ['reactionBoundaryGradient', 0, 4],
    ['reactionBoundaryCut', 0, 0.55],
    ['reactionBoundarySoftness', 0.005, 0.45],
    ['reactionBoundaryCoreReject', 0, 1],
    ['reactionBoundaryTopology', 0, 2.5],
    ['reactionBoundaryCurl', 0, 2],
    ['reactionBoundaryDivergence', 0, 1],
    ['reactionBoundaryFireRidge', 0, 2],
    ['reactionBoundaryFireRidgeCut', 0, 0.55],
    ['reactionBoundaryFireTip', 0, 2],
    ['reactionBoundaryFireErosion', 0, 1],
  ],
  'the randomized dimensions and bounds match the canonical renderer clamps',
);

const first = buildNonRidgeRandomizedControlTranche({ trancheIndex: 0, interiorCount: 30 });
const repeated = buildNonRidgeRandomizedControlTranche({ trancheIndex: 0, interiorCount: 30 });
const index = readFileSync(indexPath, 'utf8');
const expectedSteps = new Map([
  ['reactionBoundarySupportThermal', 0.02],
  ['reactionBoundarySupportReaction', 0.02],
  ['reactionBoundarySupportFront', 0.02],
  ['reactionBoundarySupportInterface', 0.02],
  ['reactionBoundaryGradient', 0.05],
  ['reactionBoundaryCut', 0.005],
  ['reactionBoundarySoftness', 0.005],
  ['reactionBoundaryCoreReject', 0.01],
  ['reactionBoundaryTopology', 0.02],
  ['reactionBoundaryCurl', 0.02],
  ['reactionBoundaryDivergence', 0.01],
  ['reactionBoundaryFireRidge', 0.02],
  ['reactionBoundaryFireRidgeCut', 0.005],
  ['reactionBoundaryFireTip', 0.02],
  ['reactionBoundaryFireErosion', 0.01],
]);
assert.deepEqual(first, repeated, 'the same seed and tranche reproduce byte-stable controls');
assert.equal(first.uncapped, true, 'the design explicitly remains appendable and uncapped');
assert.equal(first.rows.length, 32, 'the first tranche contains two boundary anchors and thirty interior settings');
assert.equal(first.rows[0].role, 'boundary-min');
assert.equal(first.rows[1].role, 'boundary-max');
for (const field of NONRIDGE_RANDOMIZED_CONTROL_FIELDS) {
  assert.equal(field.step, expectedSteps.get(field.key), `${field.key} carries its legal slider step`);
  assert.match(index, new RegExp(`key: '${field.key}'[^\\n]+step: ${String(field.step).replace('.', '\\.')}`), `${field.key} canonical metadata agrees with the assay lattice`);
  const values = first.rows.map(row => row.requestedControls[field.key]);
  for (const value of values) {
    const latticeIndex = (value - field.min) / field.step;
    assert.ok(Math.abs(latticeIndex - Math.round(latticeIndex)) <= 1e-8, `${field.key} value ${value} lies on its legal lattice`);
  }
  assert.ok(values.includes(field.min), `${field.key} includes its legal minimum`);
  assert.ok(values.includes(field.max), `${field.key} includes its legal maximum`);
  assert.ok(values.some(value => value > field.min && value < field.max), `${field.key} includes interior coverage`);
}
assert.equal(first.coverage.fullRank, true, 'the sampled causal-control matrix is full rank including intercept');
assert.equal(first.coverage.rank, NONRIDGE_RANDOMIZED_CONTROL_FIELDS.length + 1);

const zero = decodeNonRidgeOpticalRows(new Float32Array(), 0);
assert.equal(zero.rowCount, 0, 'blank control settings survive as zero-row negative controls');
assert.deepEqual(zero.rows, []);
assert.throws(
  () => decodeNonRidgeOpticalRows(new Float32Array(1), 0),
  /exactly 0 values/,
  'partial or stale payloads cannot masquerade as blank captures',
);

const core = readFileSync(corePath, 'utf8');
const witness = readFileSync(witnessPath, 'utf8');
const formatControlValue = index.match(/function formatVolumePresetControlValue\(key, value\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(formatControlValue, /REACTION_FRONT_EXTRACTOR_CONTROL_FIELDS[\s\S]*field\?\.decimals/, 'native snapshot application preserves each canonical control precision');
assert.match(core, /NONRIDGE_OPTICAL_CAPTURE_IDENTITY/, 'core names the exact capture identity');
assert.match(core, /struct NonRidgeOpticalCaptureRow/, 'shader declares a row-aligned optical capture record');
assert.match(core, /worldPositionSupport:\s*vec4<f32>/, 'every row binds world position and support');
assert.match(core, /currentSidecar:[\s\S]*currentMaterial:[\s\S]*currentFire:[\s\S]*currentMicro:/, 'every row preserves Current-16 in canonical order');
assert.match(core, /sourceVelocity:[\s\S]*sourceSupports:[\s\S]*sourceTopology:/, 'every row preserves the source-complete candidate view');
assert.match(core, /nonRidgeEmissionExtinction:[\s\S]*completeEmissionExtinction:/, 'every row preserves positive target and Complete Flame adjudication coefficients');
assert.match(core, /nonRidgeEmissionCoefficient[\s\S]*nonRidgeExtinctionCoefficient[\s\S]*writeNonRidgeOpticalCaptureRow/, 'row targets come from the exact live local coefficient variables');
assert.match(core, /beginDebugNonRidgeOpticalCapture/, 'prototype exposes capture begin custody');
assert.match(core, /readDebugNonRidgeOpticalCaptureChunk/, 'prototype exposes uncapped chunked row reads');
assert.match(core, /releaseDebugNonRidgeOpticalCapture/, 'prototype exposes explicit release custody');
assert.match(core, /count-only[\s\S]*observedRowCount[\s\S]*exact-observed-row-allocation/, 'capture counts first and allocates the observed cohort exactly');
assert.match(core, /nonridge-optical-capture-requires-frozen-renderer/, 'capture rejects mutable live simulation state');

assert.match(witness, /buildNonRidgeRandomizedControlTranche/, 'witness uses the deterministic common design');
assert.match(witness, /kaminosApplyVolumeControlsSnapshot/, 'witness applies controls through the native receipt-bearing surface');
assert.match(witness, /requestedControls[\s\S]*effectiveControls[\s\S]*substitutions/, 'every setting records requested and effective controls');
assert.match(witness, /gpuEffectiveControls[\s\S]*GPU-effective controls diverged from the receipt/, 'every setting proves the receipt reached the shader-facing control objects');
assert.match(witness, /stateIdentity[\s\S]*cameraIdentity[\s\S]*smokeIdentity[\s\S]*rayIdentity[\s\S]*footprintIdentity/, 'every setting binds all frozen authority axes');
assert.match(witness, /status:\s*'captured-negative'/, 'blank settings are retained as labeled negative controls');
assert.match(witness, /rendererPassReceipt[\s\S]*requestedRoute[\s\S]*effectiveRoute/, 'capture cannot look authoritative without exact pass and route identity');
assert.match(witness, /wrapperRequestedRoute[\s\S]*rendererRequestedRoute/, 'wrapper and renderer requested routes remain separate authority axes');
assert.doesNotMatch(witness, /capture\?\.requestedRoute, admitted\.requestedRoute/, 'renderer route cannot be compared to the wrapper request token');
assert.match(witness, /effectiveFrameFootprint[\s\S]*renderWidth[\s\S]*renderHeight/, 'witness records the effective ray footprint, not only the requested browser viewport');
assert.match(witness, /renderWidth\s*>=\s*64[\s\S]*renderHeight\s*>=\s*64/, 'degenerate wrapper layout fails before optical capture');
assert.match(witness, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'pre-artifact failure still writes a durable report');
assert.match(witness, /positiveRecomposition/, 'the witness records exact Ridge plus Non-Ridge recomposition checks');

console.log('volume randomized Non-Ridge capture contracts passed');
