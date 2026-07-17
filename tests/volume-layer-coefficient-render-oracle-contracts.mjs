import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const script = new URL('../volume-layer-coefficient-render-oracle.py', import.meta.url);
assert.ok(existsSync(script), 'coefficient render oracle exists');

const source = await readFile(script, 'utf8');
assert.match(source, /kaminos\.volume\.layer-coefficient-render-oracle\.v0/, 'oracle pins its report schema');
assert.match(source, /external-native-cell-index-list-v0/, 'oracle pins external native-cell admission');
assert.match(source, /per-sample-pre-tone-map-emission-extinction-v0/, 'oracle pins the exact coefficient boundary');
assert.match(source, /ridge-plus-non-ridge-extinction-one-running-transmittance-v0/, 'oracle pins one shared transmittance');
assert.match(source, /base-footprint-plus-flow-kernel-second-moment-tangent-covariance-v0/, 'oracle pins kernel-moment geometry');
assert.match(source, /camera-10-only-global-optical-path-fit-v0/, 'oracle pins one calibration camera');
assert.match(source, /independentlyRenderedToneMappedImageAdditivity/, 'oracle rejects independent image addition');
assert.match(source, /persist_capture_comparator/, 'oracle makes source comparator images local to the served gallery');
assert.match(source, /calibrationBoundaryHit/, 'oracle reports whether the fitted scalar remains search-boundary limited');
assert.match(source, /calibrationExpansionDiagnostic/, 'oracle diagnoses an unusually large calibration flow without capping it');
assert.match(source, /sampleCap/, 'oracle audits hidden row caps');
assert.match(
  source,
  /flow-tangent-five-by-three-area-conserving-ellipse-quadrature-v0/,
  'oracle names the no-blur projected ellipse treatment',
);
assert.match(source, /def ellipse_pixel_samples\(/, 'oracle exposes projected ellipse quadrature explicitly');
assert.match(source, /--path-scale/, 'oracle can freeze optical density across footprint arms');
assert.doesNotMatch(source, /ImageFilter|gaussian_filter|GaussianBlur/, 'footprint arm must not use post-process blur');
assert.match(
  source,
  /flow-tangent-five-tap-core-plus-ridge-conditioned-normal-skirt-v0/,
  'oracle names the operator-approved thin-core plus conditioned-skirt treatment',
);
assert.match(source, /def core_skirt_pixel_samples\(/, 'oracle exposes core/skirt quadrature explicitly');
assert.match(source, /--skirt-mix/, 'core/skirt mode requires an explicit global skirt mixture');
assert.match(source, /--skirt-minor-scale/, 'core/skirt mode requires an explicit normal-axis scale');
assert.match(source, /--skirt-ridge-rejection/, 'core/skirt mode requires explicit Ridge conditioning');
assert.match(source, /targetTopTailLumaUnderfit/, 'oracle reports missing target-aligned peak buildup');
assert.match(source, /targetHighGradientUnderfit/, 'oracle reports missing target-aligned structural energy');
assert.match(
  source,
  /flow-covariance-seven-by-seven-gauss-hermite-area-conserving-v0/,
  'oracle names the matched higher-order covariance treatment without claiming analytic integration',
);
assert.match(source, /def gauss_hermite_pixel_samples\(/, 'oracle exposes higher-order projected quadrature');
assert.match(
  source,
  /flow-bilinear-core-plus-gauss-hermite-compound-shared-mass-v0/,
  'oracle names the lawful core-preserving compound treatment',
);
assert.match(source, /def compound_pixel_samples\(/, 'oracle exposes the compound core and halo partition');
assert.match(source, /--compound-halo-mass/, 'compound treatment requires an explicit shared emission/extinction mass partition');
assert.match(
  source,
  /view-independent-multiview-residual-three-child-subcell-split-v0/,
  'oracle names the view-independent selective split treatment',
);
assert.match(source, /def candidate_residual_importance\(/, 'oracle exposes multiview residual backprojection');
assert.match(source, /def selective_split_pixel_samples\(/, 'oracle exposes deterministic three-child splitting');
assert.match(source, /--split-attribution-cameras/, 'selective splitting requires an explicit attribution cohort');
assert.match(source, /--split-score-threshold/, 'selective splitting has an explicit uncapped selection threshold');
assert.match(source, /--split-min-camera-support/, 'selective splitting requires explicit multiview support');
assert.match(source, /--split-offset-world/, 'selective splitting requires an explicit world-space child offset');
assert.match(source, /structuredDotSpectralPower/, 'oracle scores structured dot energy separately');
assert.match(source, /targetWispUnderfit/, 'oracle scores target-aligned edge wisps separately');
assert.match(source, /projectedFragments/, 'oracle reports projected fragment work instead of row count alone');
assert.match(source, /splitSelectionCap.*None/, 'selective splitting records that no candidate cap was applied');

const python = process.env.KAMINOS_MLX_PYTHON || '/private/tmp/kaminos-mlx-residual-venv/bin/python';
const selfTest = spawnSync(python, [script.pathname, '--self-test'], { encoding: 'utf8' });
assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
assert.match(selfTest.stdout, /coefficient render oracle self-test passed/);
assert.match(selfTest.stdout, /core-skirt endpoint contracts passed/);
assert.match(selfTest.stdout, /target-aligned metric contracts passed/);
assert.match(selfTest.stdout, /higher-order covariance contracts passed/);
assert.match(selfTest.stdout, /compound optical mass contracts passed/);
assert.match(selfTest.stdout, /selective split contracts passed/);
assert.match(selfTest.stdout, /deposition raster smoke contracts passed/);

const root = await mkdtemp(join(tmpdir(), 'kaminos-coefficient-render-contract-'));
const reportPath = join(root, 'failure-report.json');
const invalidManifestPath = join(root, 'invalid.json');
await writeFile(invalidManifestPath, JSON.stringify({ schema: 'wrong' }));
const failure = spawnSync(python, [
  script.pathname,
  '--manifest', invalidManifestPath,
  '--capture-report', invalidManifestPath,
  '--out-dir', join(root, 'out'),
  '--report', reportPath,
], { encoding: 'utf8' });
assert.notEqual(failure.status, 0, 'invalid manifest must fail');
assert.ok(existsSync(reportPath), 'failure before rendering must still emit a durable report');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(report.status, 'failed');
assert.equal(report.failurePhase, 'manifest-validation');
assert.match(report.error, /schema/i);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const duplicateIndices = Buffer.alloc(8);
duplicateIndices.writeUInt32LE(7, 0);
duplicateIndices.writeUInt32LE(7, 4);
const duplicatePath = join(root, 'duplicate.u32');
await writeFile(duplicatePath, duplicateIndices);
const fixturePath = join(root, 'duplicate-manifest.json');
await writeFile(fixturePath, JSON.stringify({
  schema: 'kaminos.volume.layer-coefficient-training-manifest.v0',
  authority: 'analytical-ridge-or-nonridge-admission-plus-exact-local-coefficients-v0',
  status: 'captured',
  cohort: { sampleCap: null, droppedRowCount: 0 },
  admission: { identity: 'explicit-ridge-union-promoted-nonridge-source-selector-v0' },
  coefficientTargets: {
    boundary: 'per-sample-pre-tone-map-emission-extinction-v0',
    order: [
      'ridge.emission.r', 'ridge.emission.g', 'ridge.emission.b', 'ridge.extinction',
      'nonRidge.emission.r', 'nonRidge.emission.g', 'nonRidge.emission.b', 'nonRidge.extinction',
    ],
  },
  transportEvaluation: {
    identity: 'one-shared-total-transmittance-v0',
    orderPolicy: 'global-order-one-stream-v0',
    contributionPolicy: 'separate-premultiplied-layer-contributions-under-shared-transmittance-v0',
    independentlyRenderedToneMappedImageAdditivity: false,
  },
  states: [{
    id: 'coefficient-state-096',
    splitRole: 'train',
    replay: { completedSteps: 96, grid: 160 },
    rows: {
      count: 2,
      nativeCellIndices: {
        path: duplicatePath,
        bytes: duplicateIndices.length,
        sha256: sha256(duplicateIndices),
        dtype: 'uint32-le',
        shape: [2],
        semanticRole: 'analytical-admission-native-cell-indices',
      },
    },
  }],
}));
const duplicateReport = join(root, 'duplicate-report.json');
const duplicate = spawnSync(python, [
  script.pathname,
  '--manifest', fixturePath,
  '--capture-report', invalidManifestPath,
  '--out-dir', join(root, 'duplicate-out'),
  '--report', duplicateReport,
  '--validate-only',
], { encoding: 'utf8' });
assert.notEqual(duplicate.status, 0, 'duplicate native-cell indices must fail');
assert.match(JSON.parse(await readFile(duplicateReport, 'utf8')).error, /duplicate/i);

const missingControlsReport = join(root, 'missing-core-skirt-controls-report.json');
const missingControls = spawnSync(python, [
  script.pathname,
  '--manifest', invalidManifestPath,
  '--capture-report', invalidManifestPath,
  '--out-dir', join(root, 'missing-controls-out'),
  '--report', missingControlsReport,
  '--footprint-mode', 'core-skirt',
], { encoding: 'utf8' });
assert.notEqual(missingControls.status, 0, 'core-skirt without explicit controls must fail');
const missingControlsFailure = JSON.parse(await readFile(missingControlsReport, 'utf8'));
assert.equal(missingControlsFailure.failurePhase, 'footprint-control-validation');
assert.equal(missingControlsFailure.requested.footprintMode, 'core-skirt');
assert.deepEqual(missingControlsFailure.requested.footprintControls, {
  skirtMix: null,
  skirtMinorScale: null,
  skirtRidgeRejection: null,
});
assert.match(missingControlsFailure.error, /requires explicit/i);

const missingCompoundReport = join(root, 'missing-compound-controls-report.json');
const missingCompound = spawnSync(python, [
  script.pathname,
  '--manifest', invalidManifestPath,
  '--capture-report', invalidManifestPath,
  '--out-dir', join(root, 'missing-compound-out'),
  '--report', missingCompoundReport,
  '--footprint-mode', 'compound',
], { encoding: 'utf8' });
assert.notEqual(missingCompound.status, 0, 'compound mode without explicit mass partition must fail');
const missingCompoundFailure = JSON.parse(await readFile(missingCompoundReport, 'utf8'));
assert.equal(missingCompoundFailure.failurePhase, 'footprint-control-validation');
assert.match(missingCompoundFailure.error, /explicit.*compound-halo-mass/i);

const missingSplitReport = join(root, 'missing-selective-split-controls-report.json');
const missingSplit = spawnSync(python, [
  script.pathname,
  '--manifest', invalidManifestPath,
  '--capture-report', invalidManifestPath,
  '--out-dir', join(root, 'missing-selective-split-out'),
  '--report', missingSplitReport,
  '--footprint-mode', 'selective-split',
], { encoding: 'utf8' });
assert.notEqual(missingSplit.status, 0, 'selective split without explicit attribution controls must fail');
const missingSplitFailure = JSON.parse(await readFile(missingSplitReport, 'utf8'));
assert.equal(missingSplitFailure.failurePhase, 'footprint-control-validation');
assert.match(missingSplitFailure.error, /selective-split mode requires explicit/i);

console.log('volume layer coefficient render oracle contracts passed');
