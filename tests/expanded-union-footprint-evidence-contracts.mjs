import assert from 'node:assert/strict';
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
    'sha256sums.txt',
    'reports/nearest.json',
    'reports/bilinear.json',
    'reports/ellipse.json',
    'receipts/greenroom-ellipse.json',
  ]) assert.ok(existsSync(join(root, file)), `missing evidence file: ${file}`);
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
