import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const root = join(
  repo,
  'artifacts/pyro-gaussian-footprint-kneecapper-0716/deposition-subcell-oracle-state120-r2',
);
const manifestPath = join(root, 'evidence-manifest.json');
const pagePath = join(root, 'index.html');

assert.ok(existsSync(manifestPath), 'deposition/subcell evidence manifest exists');
assert.ok(existsSync(pagePath), 'deposition/subcell operator page exists');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.schema, 'kaminos.volume.deposition-subcell-evidence.v0');
assert.equal(manifest.status, 'complete');
assert.equal(manifest.failurePhase, null);
assert.equal(manifest.sourceCommit, 'fd670573');
assert.deepEqual(manifest.frozen, {
  stateStep: 120,
  grid: 160,
  depthBins: 96,
  rowCount: 1_899_742,
  sampleCap: null,
  droppedRowCount: 0,
  pathScale: 4.557231148404257,
});
assert.deepEqual(manifest.cohorts.attributionCameras, [0, 5, 10, 15, 20]);
assert.deepEqual(manifest.cohorts.heldOutCameras, [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19]);
assert.equal(manifest.arms.length, 4);

const expected = new Map([
  ['bilinear', ['bad0f6439e28', 'flow-tangent-five-tap-bilinear-v0', /--footprint-mode bilinear/]],
  ['higher-order', ['007b2d101883', 'flow-covariance-seven-by-seven-gauss-hermite-area-conserving-v0', /--footprint-mode higher-order/]],
  ['compound', ['6e9e3296b240', 'flow-bilinear-core-plus-gauss-hermite-compound-shared-mass-v0', /--compound-halo-mass 0\.25/]],
  ['selective', ['59d3377cc496', 'view-independent-multiview-residual-three-child-subcell-split-v0', /--split-min-camera-support 3/]],
]);

function png(path) {
  const bytes = readFileSync(path);
  assert.ok(bytes.length > 100, `${path} is not blank or partial`);
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${path} is a PNG`);
  assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0, `${path} has dimensions`);
}

for (const arm of manifest.arms) {
  assert.ok(expected.has(arm.id), `unexpected arm ${arm.id}`);
  const [jobId, footprintIdentity, routePattern] = expected.get(arm.id);
  assert.equal(arm.jobId, jobId);
  const report = JSON.parse(readFileSync(join(root, arm.report), 'utf8'));
  const receipt = JSON.parse(readFileSync(join(root, arm.receipt), 'utf8'));
  assert.equal(report.status, 'complete', `${arm.id} report is complete`);
  assert.equal(report.failurePhase, null, `${arm.id} has no failure phase`);
  assert.equal(report.effective.stateStep, 120, `${arm.id} state is frozen`);
  assert.equal(report.effective.rowCount, 1_899_742, `${arm.id} population is complete`);
  assert.equal(report.effective.sampleCap, null, `${arm.id} sample flow is uncapped`);
  assert.equal(report.effective.droppedRowCount, 0, `${arm.id} dropped no rows`);
  assert.equal(report.effective.footprintMode, footprintIdentity, `${arm.id} footprint identity matches`);
  assert.equal(report.metrics.cameras.length, 21, `${arm.id} has the complete orbit`);
  assert.equal(report.massAccounting.allNominalKernelMassConserved, true, `${arm.id} conserves nominal mass`);
  assert.equal(report.massAccounting.clippedCameraCount, 21, `${arm.id} reports every clipped camera`);
  assert.equal(
    report.massAccounting.viewportMassEvidenceAuthority,
    'non-decision-bearing-clipped-framing-v0',
    `${arm.id} does not launder clipped viewport mass`,
  );
  assert.equal(receipt.status, 'done', `${arm.id} Greenroom receipt is done`);
  assert.equal(receipt.exit_code, 0, `${arm.id} Greenroom exit is clean`);
  assert.equal(receipt.effective_timeout, null, `${arm.id} has no hidden timeout`);
  assert.equal(receipt.ignored_params, null, `${arm.id} has no ignored controls`);
  assert.equal(receipt.warnings, null, `${arm.id} has no route warnings`);
  assert.equal(receipt.effective_cwd, repo, `${arm.id} used the owning worktree`);
  assert.deepEqual(receipt.effective_env, { PYTHONPATH: '.' }, `${arm.id} environment matches`);
  assert.match(receipt.effective_route, routePattern, `${arm.id} effective route matches`);
}

for (let camera = 0; camera < 21; camera += 1) {
  const id = String(camera).padStart(2, '0');
  png(join(root, 'images', `camera-${id}-target.png`));
  for (const arm of expected.keys()) {
    png(join(root, 'images', `camera-${id}-${arm}.png`));
    png(join(root, 'images', `camera-${id}-${arm}-residual.png`));
  }
}

const selective = JSON.parse(readFileSync(join(root, 'reports/selective.json'), 'utf8'));
assert.equal(selective.selectiveSplit.requestedSplitCount, 6_932);
assert.equal(selective.selectiveSplit.effectiveSplitCount, 4_336);
assert.equal(selective.selectiveSplit.orientationRejectedCount, 2_596);
assert.equal(selective.selectiveSplit.splitSelectionCap, null);
for (const artifact of [selective.selectiveSplit.importanceArtifact, selective.selectiveSplit.selectedNativeCellArtifact]) {
  const local = join(root, 'selective', artifact.path.split('/').at(-1));
  const bytes = readFileSync(local);
  assert.equal(bytes.length, artifact.bytes, `${local} byte count matches`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256, `${local} hash matches`);
}

for (const arm of expected.keys()) {
  const failedReport = JSON.parse(readFileSync(join(root, 'r1-failures', `${arm}-report.json`), 'utf8'));
  const failedReceipt = JSON.parse(readFileSync(join(root, 'r1-failures', `${arm}-receipt.json`), 'utf8'));
  assert.equal(failedReport.status, 'failed', `${arm} r1 report preserves failure`);
  assert.equal(failedReport.failurePhase, 'calibration-raster', `${arm} r1 preserves the exact failure phase`);
  assert.equal(failedReceipt.status, 'failed', `${arm} r1 Greenroom receipt preserves failure`);
}

const page = readFileSync(pagePath, 'utf8');
assert.doesNotMatch(page, /\/Users\/|\/private\/tmp\//, 'operator page has no machine-absolute dependencies');
assert.match(page, /id="camera"/);
assert.match(page, /id="left"/);
assert.match(page, /id="right"/);
assert.match(page, /id="mode"/);
assert.match(page, /non-decision-bearing clipped viewport mass/);
assert.match(page, /4,336/);
assert.match(page, /Held cameras: 16/);

const witness = JSON.parse(readFileSync(join(root, 'witness/page-witness-report.json'), 'utf8'));
assert.equal(witness.schema, 'kaminos.volume.deposition-subcell-page-witness.v0');
assert.equal(witness.status, 'complete');
assert.equal(witness.failurePhase, null);
assert.equal(witness.effectiveRoute, 'http://127.0.0.1:18223/artifacts/pyro-gaussian-footprint-kneecapper-0716/deposition-subcell-oracle-state120-r2/index.html');
assert.equal(witness.captures.length, 2);
for (const capture of witness.captures) {
  assert.equal(capture.state.horizontalOverflow, false, `${capture.path} has no horizontal overflow`);
  assert.equal(capture.state.imagesComplete, true, `${capture.path} loaded both images`);
  assert.equal(capture.selectedState.camera, '18');
  assert.equal(capture.selectedState.left, 'bilinear');
  assert.equal(capture.selectedState.right, 'selective');
  assert.equal(capture.selectedState.mode, 'residual');
  png(join(root, 'witness', capture.path));
}

const checksumLines = readFileSync(join(root, 'sha256sums.txt'), 'utf8').trim().split('\n');
assert.ok(checksumLines.length >= 212, 'hash ledger covers the complete image-bearing bundle');
for (const line of checksumLines) {
  const match = line.match(/^([0-9a-f]{64})  (\.\/.*)$/);
  assert.ok(match, `invalid checksum row: ${line}`);
  const bytes = readFileSync(join(root, match[2]));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), match[1], `${match[2]} hash matches`);
}

console.log('deposition/subcell evidence contracts passed');
