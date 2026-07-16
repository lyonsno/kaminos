#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const composerPath = join(root, 'volume-vivisector-held-package-compose.py');
const witnessPath = join(root, 'volume-vivisector-held-package-splat-witness.mjs');
const exporterPath = join(root, 'volume-full-grid-field-export.mjs');
const corePath = join(root, 'volume-core.js');

assert.ok(existsSync(composerPath), 'held-package field composer exists');
assert.ok(existsSync(witnessPath), 'three-role splat witness exists');

const composer = readFileSync(composerPath, 'utf8');
const witness = readFileSync(witnessPath, 'utf8');
const exporter = readFileSync(exporterPath, 'utf8');
const core = readFileSync(corePath, 'utf8');

assert.match(composer, /kaminos\.volume\.vivisector-held-package-composition\.v0/);
assert.match(composer, /precomputed-held-package-inference-not-live-runtime-v0/);
assert.match(composer, /15ed4ef7762e89e467bb1fecaba6e270f0b98be9bc06dfd3bd928fbc50d65309/);
assert.match(composer, /c648ec41d57e8810a40c30b006c0809ee1707777f75662cfcca69c05d036845f/);
assert.match(composer, /df456e8837bdf08a540935dffef7737de688734c13213b8ded5be5837bc4ebd7/);
assert.match(composer, /63e04c6bd4fd08de7f7db1f1136c67bef7be96d46d03d660b1d83dfb198ea58c/);
assert.match(composer, /dee83581d4c4746c13c5afc1f84422bbe60855324790669873d38c777e387140/);
assert.match(composer, /nativeManifestSha256/);
assert.match(composer, /teacherManifestSha256/);
assert.match(composer, /highTruthUse/);
assert.match(composer, /offline metrics and reference role only; never read by prediction composition/);
assert.match(composer, /frontTopologyResidual/);
assert.match(composer, /fuelResidual/);
assert.match(composer, /visibleFireCarrierResidual/);
assert.match(composer, /fireLickResidual/);
assert.match(composer, /detailResidual/);
assert.match(composer, /fineSupport/);
assert.match(composer, /ridgeResidual/);
assert.match(composer, /temporalFrontDetail/);
assert.match(composer, /excluded-from-held-present-state-composition-v0/);
assert.match(composer, /sourceHistoryCandidate/);
assert.match(composer, /failurePhase/);
assert.match(composer, /lastTrustworthyEvidence/);
assert.match(composer, /completeFieldCoverage/);
assert.match(composer, /kaminos\.volume\.full-grid-field-export\.v0/);
assert.match(composer, /native-3d-compute-fluid-raymarch-v0/);
assert.match(composer, /WebGPU:apple/);
assert.match(composer, /native-source-capture-authority-v0/);
assert.match(composer, /checksum-bound-precomputed-cue-from-pinned-training-manifest-v0/);

assert.match(exporter, /VIVISECTOR_HELD_PACKAGE_SCHEMA/);
assert.match(exporter, /learned-vivisector-held-package-composition-not-truth-v0/);
assert.match(exporter, /precomputed-held-package-inference-not-live-runtime-v0/);
assert.match(exporter, /mustNotBeAcceptedAs/);
assert.match(core, /VIVISECTOR_HELD_PACKAGE_AUTHORITY/);
assert.match(core, /VIVISECTOR_HELD_PACKAGE_APPLICATION_IDENTITY/);
assert.match(core, /isVivisectorHeldPackage/);
assert.match(core, /!isCoarseReceiver && !isSelectiveComposition && !isVivisectorHeldPackage/);
assert.match(core, /isVivisectorHeldPackage && requestedSteps > 0/);
assert.match(core, /vivisector-held-package-render-only/);

assert.match(witness, /kaminos\.volume\.vivisector-held-package-splat-witness\.v0/);
assert.match(witness, /const ROLES = \['truthHigh', 'lowPhaseAligned', 'vivisectorPredicted'\]/);
assert.match(witness, /offline-high-truth-held-render-only-v0/);
assert.match(witness, /downsampled-same-high-history-held-control-v0/);
assert.match(witness, /precomputed-held-package-inference-not-live-runtime-v0/);
assert.match(witness, /splat-only-v0/);
assert.match(witness, /partialFlowDebugMix/);
assert.match(witness, /0\.625/);
assert.match(witness, /secondary-render-png/);
assert.match(witness, /flowDebug/);
assert.match(witness, /boundarySplatCandidateCount/);
assert.match(witness, /boundarySplatInstanceCount/);
assert.match(witness, /boundarySplatOverflowCount/);
assert.match(witness, /effectiveRoute/);
assert.match(witness, /backend/);
assert.match(witness, /servedCoreSha256/);
assert.match(witness, /expectedCoreSha256/);
assert.match(witness, /const SERVED_ASSETS = \['index\.html', 'volume-core\.js'\]/);
assert.match(witness, /served \$\{asset\} differs from owning worktree/);
assert.match(
  witness,
  /lastTrustworthyEvidence = \{ phase: failurePhase, targetOrigin, asset, expectedSha256, servedSha256 \}/,
  'served-checkout rejection preserves the exact asset comparison before throwing',
);
assert.match(witness, /failurePhase/);
assert.match(witness, /lastTrustworthyEvidence/);
assert.match(witness, /labels-under-images-v0/);
assert.match(witness, /analyzePngPixels/);
assert.match(witness, /comparePngPixels/);
assert.match(witness, /pixelEvidence/);
assert.match(witness, /roleDifferenceEvidence/);
assert.match(witness, /expectedRoute/);
assert.match(witness, /expectedBackend/);
assert.match(witness, /servedAssets/);
assert.match(witness, /manifestAuthority/);

const failureRoot = mkdtempSync(join(tmpdir(), 'kaminos-vivisector-witness-failure-'));
try {
  const failureManifest = join(failureRoot, 'manifest.json');
  const result = spawnSync(process.execPath, [
    witnessPath,
    '--out-dir', failureRoot,
    '--manifest', failureManifest,
    '--composition-manifest', join(failureRoot, 'missing-composition.json'),
    '--source-capture', join(failureRoot, 'missing-source-capture.json'),
    '--target-origin', 'http://127.0.0.1:1',
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'missing required input must fail');
  assert.ok(existsSync(failureManifest), 'pre-render input failure must still write a durable manifest');
  const failure = JSON.parse(readFileSync(failureManifest, 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'argument-validation');
  assert.match(failure.error, /--composition-manifest does not exist/);
} finally {
  rmSync(failureRoot, { recursive: true, force: true });
}

console.log('vivisector held-package splat witness contracts passed');
