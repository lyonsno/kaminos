import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(
  REPO_ROOT,
  'tools/run-current-k4-ring-cage-longitudinal-volume-assay.mjs',
);
const CARRIER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/packed-carrier.json',
);
const LEDGER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/residual-ledger.json',
);
const SOURCE = path.join(
  REPO_ROOT,
  'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
);
const CONFIG = path.join(
  REPO_ROOT,
  'fixtures/current-k4-packing/current-k4-longitudinal-volume-first-point-v0.json',
);

function run(output, config = CONFIG) {
  return spawnSync(process.execPath, [
    TOOL,
    '--selected-carrier', CARRIER,
    '--residual-ledger', LEDGER,
    '--source', SOURCE,
    '--config', config,
    '--output', output,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
}

async function json(output, relative) {
  return JSON.parse(await readFile(path.join(output, relative), 'utf8'));
}

test('the first current-K4 longitudinal point writes an identity-bound visible trade', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-longitudinal-'));
  const result = run(output);
  assert.equal(result.status, 0, result.stderr);
  const report = await json(output, 'run-report.json');
  const comparison = await json(output, 'comparison.json');
  const selection = await json(output, 'pressure-selection.json');
  const receipt = await json(output, 'redistribution-receipt.json');
  const selected = await json(output, 'selected-carrier.json');
  const packed = await json(output, 'packed-carrier.json');
  const html = await readFile(path.join(output, 'index.html'), 'utf8');

  assert.equal(report.status, 'completed');
  assert.equal(report.failurePhase, null);
  assert.equal(report.resultStatus,
    'longitudinal-volume-nondominated-pending-visual-admission');
  assert.equal(report.visual.status, 'pending-agent-inspection');
  assert.equal(report.visual.route.requested, report.visual.route.effective);
  assert.equal(report.visual.route.fallbackUsed, false);
  assert.equal(report.visual.captureUrls.length, 4);
  assert.ok(report.visual.captureUrls.every(url =>
    url.includes(report.visual.bundleIdentity.sha256)));
  assert.equal(selection.compressionSectionIds[0], 'muscle-45:section:0011');
  assert.deepEqual(selection.repaymentSectionIds, [
    'muscle-45:section:0010',
    'muscle-45:section:0009',
    'muscle-45:section:0008',
    'muscle-45:section:0007',
  ]);
  assert.equal(receipt.outputCarrierSha256, packed.identity.sha256);
  assert.equal(receipt.outputCarrier, undefined);
  assert.equal(selected.identity.sha256, selection.sourceCarrierSha256);
  assert.equal(comparison.selected.pairwiseMovableMaximumPenetration,
    0.3420731982757239);
  assert.equal(comparison.proposal.pairwiseMovableMaximumPenetration,
    0.3265856567325679);
  assert.equal(comparison.proposal.pairwiseMovableTotalPenetration,
    10.212581724883897);
  assert.equal(comparison.decision.improvedMovableMaximum, true);
  assert.equal(comparison.decision.improvedFixedTotal, true);
  assert.equal(comparison.decision.didNotWorsenSkeletal, true);
  assert.equal(comparison.decision.improvedMovableTotal, false);
  assert.ok(html.includes(report.visual.bundleIdentity.sha256));
  assert.ok(!JSON.stringify(report).includes('/private/tmp/'));
});

test('a malformed configuration writes a failure report and no stale visual primary', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-longitudinal-fail-'));
  const config = path.join(output, 'bad-config.json');
  await writeFile(config, '{"schema":"wrong"}\n');
  await writeFile(
    path.join(output, '.kaminos-current-k4-longitudinal-volume-assay-output'),
    'kaminos.current-k4-longitudinal-volume-assay-output-custody.v0\n',
  );
  await writeFile(path.join(output, 'packed-carrier.json'), '{"stale":true}\n');
  const result = run(output, config);
  assert.notEqual(result.status, 0);
  const report = await json(output, 'run-report.json');
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'validate-config');
  assert.equal(report.outputs, null);
  await assert.rejects(readFile(path.join(output, 'packed-carrier.json')), /ENOENT/);
  await assert.rejects(readFile(path.join(output, 'index.html')), /ENOENT/);
});
