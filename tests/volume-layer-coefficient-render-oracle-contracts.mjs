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

const python = process.env.KAMINOS_MLX_PYTHON || '/private/tmp/kaminos-mlx-residual-venv/bin/python';
const selfTest = spawnSync(python, [script.pathname, '--self-test'], { encoding: 'utf8' });
assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
assert.match(selfTest.stdout, /coefficient render oracle self-test passed/);

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

console.log('volume layer coefficient render oracle contracts passed');
