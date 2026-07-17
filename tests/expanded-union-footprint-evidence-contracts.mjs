import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(
  'artifacts/pyro-gaussian-footprint-kneecapper-0716/expanded-union-footprint-oracle-state120-r1',
);

test('evidence bundle is complete and self-contained', () => {
  assert.ok(existsSync(root), `artifact bundle missing: ${root}`);
  for (let camera = 0; camera <= 20; camera += 1) {
    const id = String(camera).padStart(2, '0');
    for (const treatment of ['target', 'nearest', 'bilinear', 'ellipse']) {
      assert.ok(
        existsSync(join(root, 'images', `camera-${id}-${treatment}.png`)),
        `missing camera ${id} ${treatment} image`,
      );
    }
  }
  for (const file of [
    'index.html',
    'README.md',
    'cockpit-manifest.v0.json',
    'sha256sums.txt',
    'reports/nearest.json',
    'reports/bilinear.json',
    'reports/ellipse.json',
    'receipts/greenroom-ellipse.json',
  ]) assert.ok(existsSync(join(root, file)), `missing evidence file: ${file}`);
});

test('cockpit manifest preserves evidence state and exact experiment identity', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'cockpit-manifest.v0.json'), 'utf8'));
  const ellipse = JSON.parse(readFileSync(join(root, 'reports', 'ellipse.json'), 'utf8'));
  assert.equal(manifest.schema, 'kaminos.pyro.cockpit-manifest.v0');
  assert.equal(manifest.experiment.id, 'expanded-union-footprint-oracle-state120-r1');
  assert.equal(manifest.producer.handle, 'pyro-gaussian-footprint-kneecapper');
  assert.equal(manifest.evidenceState.stage, 'produced');
  assert.equal(manifest.evidenceState.visualQuality, 'operator-unseen');
  assert.equal(manifest.evidenceState.operatorExplored, false);
  assert.equal(manifest.evidenceState.decisionBearing, false);
  assert.equal(manifest.sourceState.stateStep, ellipse.effective.stateStep);
  assert.equal(manifest.support.rowCount, ellipse.effective.rowCount);
  assert.equal(manifest.support.sampleCap, null);
  assert.equal(manifest.support.droppedRowCount, 0);
  assert.equal(manifest.treatment.identity, ellipse.effective.footprintMode);
  assert.equal(manifest.transport.identity, ellipse.effective.sharedTransmittanceIdentity);
  assert.equal(manifest.accumulation.ordering, ellipse.effective.orderApproximation);
  assert.equal(manifest.controls.requested.pathScale, ellipse.requested.pathScale);
  assert.equal(manifest.controls.effective.pathScale, ellipse.effective.pathScale);
  assert.equal(manifest.route.fallbackUsed, false);
  assert.equal(manifest.route.overflowCount, 0);
  assert.equal(manifest.route.capacityComplete, true);
});

test('cockpit sockets and authored fork contract are complete and non-destructive', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'cockpit-manifest.v0.json'), 'utf8'));
  for (const socket of ['target', 'treatment', 'difference', 'ridge', 'nonRidge', 'debugSupport']) {
    assert.ok(manifest.sockets[socket], `missing cockpit socket ${socket}`);
  }
  for (let camera = 0; camera <= 20; camera += 1) {
    const id = String(camera).padStart(2, '0');
    for (const treatment of ['residual', 'ridge', 'nonridge', 'support-target']) {
      assert.ok(existsSync(join(root, 'images', `camera-${id}-${treatment}.png`)), `missing cockpit image ${id} ${treatment}`);
    }
  }
  assert.equal(manifest.authoredFork.callerProvidedPathRequired, true);
  assert.equal(manifest.authoredFork.originalOverwriteForbidden, true);
  assert.match(manifest.authoredFork.pathTemplate, /\{forkName\}/);
  assert.ok(manifest.mutableAxes.includes('camera.orbitIndex'));
  assert.ok(manifest.mutableAxes.includes('presentation.exposure'));
  assert.ok(manifest.predicateLockedAxes.includes('sourceState.hashes'));
  assert.ok(manifest.predicateLockedAxes.includes('support.nativeCellIndex'));
});

test('cockpit manifest binds the complete artifact hash ledger', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'cockpit-manifest.v0.json'), 'utf8'));
  const ledger = readFileSync(join(root, manifest.artifacts.hashLedger.path));
  const digest = createHash('sha256').update(ledger).digest('hex');
  assert.equal(digest, manifest.artifacts.hashLedger.sha256);
  const rows = ledger.toString('utf8').trim().split('\n');
  assert.equal(rows.length, 174);
  assert.ok(rows.some(row => row.endsWith('  ./images/camera-10-target.png')));
  assert.ok(rows.some(row => row.endsWith('  ./images/camera-10-ellipse.png')));
  assert.ok(rows.some(row => row.endsWith('  ./images/camera-10-residual.png')));
  assert.ok(rows.some(row => row.endsWith('  ./images/camera-10-ridge.png')));
  assert.ok(rows.some(row => row.endsWith('  ./images/camera-10-nonridge.png')));
  assert.ok(rows.some(row => row.endsWith('  ./images/camera-10-support-target.png')));
});

test('all treatments bind the exact state and complete population', () => {
  const reports = Object.fromEntries(['nearest', 'bilinear', 'ellipse'].map(name => [
    name,
    JSON.parse(readFileSync(join(root, 'reports', `${name}.json`), 'utf8')),
  ]));
  for (const [name, report] of Object.entries(reports)) {
    assert.equal(report.status, 'complete', `${name} report is partial`);
    assert.equal(report.effective.stateStep, 120, `${name} state drifted`);
    assert.equal(report.effective.rowCount, 1_899_742, `${name} population drifted`);
    assert.equal(report.effective.droppedRowCount, 0, `${name} silently dropped rows`);
    assert.equal(report.effective.sampleCap, null, `${name} installed a hidden cap`);
    assert.equal(report.metrics.cameras.length, 21, `${name} orbit is partial`);
  }
  assert.equal(
    reports.ellipse.effective.footprintMode,
    'flow-tangent-five-by-three-area-conserving-ellipse-quadrature-v0',
  );
  assert.equal(reports.ellipse.effective.pathScale, reports.nearest.calibration.pathScale);

  const receipt = JSON.parse(readFileSync(join(root, 'receipts', 'greenroom-ellipse.json'), 'utf8'));
  assert.equal(receipt.status, 'done');
  assert.equal(receipt.job_id, 'c5bea0cdd3e1');
  assert.equal(receipt.exit_code, 0);
  assert.equal(receipt.failure_phase, null);
  assert.match(receipt.effective_route, /--footprint-mode ellipse/);
  assert.match(receipt.effective_route, /--state-step 120/);
});

test('operator page fails loud and does not depend on absolute image paths', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(html, /data-evidence-status="loading"/);
  assert.match(html, /Evidence unavailable:/);
  assert.match(html, /reports\/ellipse\.json/);
  assert.match(html, /camera-\$\{cameraId\}-\$\{treatment\}\.png/);
  assert.doesNotMatch(html, /(?:src|href)=["']\/(?:Users|private|tmp)\//);
});
