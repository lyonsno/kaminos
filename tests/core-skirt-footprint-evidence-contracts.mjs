import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const root = join(
  repo,
  'artifacts/pyro-gaussian-footprint-kneecapper-0716/core-skirt-footprint-oracle-state120-r1',
);
const manifestPath = join(root, 'evidence-manifest.json');
assert.ok(existsSync(manifestPath), 'core/skirt evidence manifest exists');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.schema, 'kaminos.volume.core-skirt-footprint-evidence.v0');
assert.equal(manifest.status, 'complete');
assert.equal(manifest.failurePhase, null);
assert.equal(manifest.sourceCommit, '9ac62cbe');
assert.equal(manifest.frozen.stateStep, 120);
assert.equal(manifest.frozen.grid, 160);
assert.equal(manifest.frozen.depthBins, 96);
assert.equal(manifest.frozen.rowCount, 1_899_742);
assert.equal(manifest.frozen.sampleCap, null);
assert.equal(manifest.frozen.droppedRowCount, 0);
assert.equal(manifest.frozen.pathScale, 4.557231148404257);
assert.equal(manifest.cameraCount, 21);
assert.equal(manifest.arms.length, 8);

const expectedArms = new Map([
  ['m000-global', [0, 1, 0]],
  ['m025-global', [0.25, 1, 0]],
  ['m050-global', [0.5, 1, 0]],
  ['m075-global', [0.75, 1, 0]],
  ['m100-global', [1, 1, 0]],
  ['m050-ridge100', [0.5, 1, 1]],
  ['m075-ridge100', [0.75, 1, 1]],
  ['m075-min075-ridge100', [0.75, 0.75, 1]],
]);

function loadPng(path) {
  const bytes = readFileSync(path);
  assert.ok(bytes.length > 100, `${relative(root, path)} is not blank`);
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${relative(root, path)} is a PNG`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.ok(width > 0 && height > 0, `${relative(root, path)} has dimensions`);
  return { width, height };
}

for (let camera = 0; camera < manifest.cameraCount; camera += 1) {
  const cameraId = String(camera).padStart(2, '0');
  loadPng(join(root, 'images', `camera-${cameraId}-target.png`));
}

for (const arm of manifest.arms) {
  assert.ok(expectedArms.has(arm.id), `unexpected arm ${arm.id}`);
  const [mix, minor, rejection] = expectedArms.get(arm.id);
  assert.equal(arm.controls.skirtMix, mix);
  assert.equal(arm.controls.skirtMinorScale, minor);
  assert.equal(arm.controls.skirtRidgeRejection, rejection);
  assert.equal(arm.status, 'complete');
  assert.equal(arm.cameraCount, 21);

  const report = JSON.parse(readFileSync(join(root, arm.report), 'utf8'));
  const receipt = JSON.parse(readFileSync(join(root, arm.receipt), 'utf8'));
  assert.equal(report.status, 'complete', `${arm.id} report is complete`);
  assert.equal(report.failurePhase, null, `${arm.id} has no failure phase`);
  assert.equal(report.effective.stateStep, 120, `${arm.id} state is frozen`);
  assert.equal(report.effective.rowCount, 1_899_742, `${arm.id} population is complete`);
  assert.equal(report.effective.sampleCap, null, `${arm.id} is uncapped`);
  assert.equal(report.effective.droppedRowCount, 0, `${arm.id} dropped no rows`);
  assert.equal(report.effective.pathScale, 4.557231148404257, `${arm.id} path scale is frozen`);
  assert.deepEqual(report.requested.footprintControls, arm.controls, `${arm.id} requested controls match`);
  assert.equal(report.metrics.cameras.length, 21, `${arm.id} orbit is complete`);
  assert.ok(Number.isFinite(report.metrics.heldOutMean.expandedMae), `${arm.id} held-out MAE exists`);
  for (const row of report.metrics.cameras) {
    for (const key of ['gradientMae', 'targetTopTailLumaUnderfit', 'targetHighGradientUnderfit']) {
      assert.ok(Number.isFinite(row.expanded[key]), `${arm.id} camera ${row.cameraIndex} ${key} exists`);
    }
  }
  assert.equal(receipt.status, 'done', `${arm.id} Greenroom receipt is done`);
  assert.equal(receipt.exit_code, 0, `${arm.id} Greenroom exit is clean`);
  assert.equal(receipt.warnings, null, `${arm.id} Greenroom warnings are absent`);
  assert.equal(receipt.ignored_params, null, `${arm.id} Greenroom ignored no parameters`);
  assert.equal(receipt.effective_timeout, null, `${arm.id} Greenroom imposed no timeout`);
  assert.equal(receipt.effective_cwd, repo, `${arm.id} Greenroom used the owning worktree`);
  assert.deepEqual(receipt.effective_env, { PYTHONPATH: '.' }, `${arm.id} Greenroom environment matches`);
  assert.match(receipt.effective_route, /--footprint-mode core-skirt/, `${arm.id} effective route is core/skirt`);
  assert.match(receipt.effective_route, new RegExp(`--skirt-mix ${mix}(?:\\.0)?(?: |$)`), `${arm.id} effective mix matches`);

  for (let camera = 0; camera < manifest.cameraCount; camera += 1) {
    const cameraId = String(camera).padStart(2, '0');
    const treatment = loadPng(join(root, 'images', `camera-${cameraId}-${arm.id}.png`));
    const residual = loadPng(join(root, 'images', `camera-${cameraId}-${arm.id}-residual.png`));
    assert.deepEqual(treatment, residual, `${arm.id} camera ${cameraId} aligned views share dimensions`);
  }
}
assert.equal(new Set(manifest.arms.map(arm => arm.id)).size, expectedArms.size, 'every requested arm appears exactly once');

const page = readFileSync(join(root, 'index.html'), 'utf8');
assert.match(page, /evidence-manifest\.json/, 'page loads the exact evidence manifest');
assert.match(page, /Receipts verified/, 'page exposes verified receipt state');
assert.match(page, /Evidence unavailable:/, 'page fails loud on missing or partial evidence');
assert.match(page, /id="camera"/, 'page exposes all held camera views');
assert.match(page, /id="leftTreatment"/, 'page exposes a left treatment selector');
assert.match(page, /id="rightTreatment"/, 'page exposes a right treatment selector');
assert.match(page, /id="viewMode"/, 'page exposes composite and residual views');

const witnessPath = join(repo, 'core-skirt-footprint-page-witness.mjs');
assert.ok(existsSync(witnessPath), 'dynamic page witness exists');
const witness = readFileSync(witnessPath, 'utf8');
assert.match(witness, /Page\.captureScreenshot/, 'witness captures the rendered browser page');
assert.match(witness, /evidenceStatus/, 'witness waits for verified receipt state');
assert.match(witness, /failurePhase/, 'witness preserves the phase of pre-output failure');
assert.match(witness, /horizontalOverflow/, 'witness rejects incoherent responsive overflow');

const ledgerPath = join(root, 'sha256sums.txt');
const ledgerRows = readFileSync(ledgerPath, 'utf8').trim().split('\n');
assert.ok(ledgerRows.length > 0, 'hash ledger is populated');
const ledgerPaths = [];
for (const row of ledgerRows) {
  const match = row.match(/^([0-9a-f]{64})  (.+)$/);
  assert.ok(match, `invalid ledger row: ${row}`);
  const path = join(root, match[2]);
  ledgerPaths.push(match[2].replace(/^\.\//, ''));
  assert.ok(existsSync(path), `ledger artifact exists: ${match[2]}`);
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), match[1], `ledger hash matches ${match[2]}`);
}

function filesBelow(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = join(prefix, entry.name);
    return entry.isDirectory() ? filesBelow(join(directory, entry.name), relativePath) : [relativePath];
  });
}
const completeFiles = filesBelow(root).filter(path => path !== 'sha256sums.txt').sort();
assert.deepEqual(ledgerPaths.sort(), completeFiles, 'hash ledger covers every bundle artifact exactly once');

console.log('core/skirt footprint evidence contracts passed');
