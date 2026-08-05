import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(
  REPO_ROOT,
  'tools/prepare-current-k4-ring-cage-longitudinal-volume-frontier-visual.mjs',
);
const FRONTIER_ROOT = path.join(
  REPO_ROOT,
  'artifacts/current-k4-ring-cage-longitudinal-volume-ramp-frontier-v0',
);
const SOURCE = path.join(
  REPO_ROOT,
  'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
);

function run(frontier, output) {
  return spawnSync(process.execPath, [
    TOOL,
    '--frontier', frontier,
    '--source', SOURCE,
    '--output', output,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
}

async function json(root, relative) {
  return JSON.parse(await readFile(path.join(root, relative), 'utf8'));
}

test('the ramp visual preserves all seven measured candidates beside one reference', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-ramp-visual-'));
  const result = run(path.join(FRONTIER_ROOT, 'frontier-result.json'), output);
  assert.equal(result.status, 0, result.stderr);
  const [report, manifest] = await Promise.all([
    json(output, 'run-report.json'),
    json(output, 'visual-manifest.json'),
  ]);
  assert.equal(report.status, 'completed');
  assert.equal(manifest.status, 'pending-agent-inspection');
  assert.equal(manifest.candidateIds.length, 7);
  assert.equal(manifest.captureUrls.length, 8);
  assert.deepEqual(manifest.focus, {
    sectionId: 'muscle-45:section:0011',
    point: [8.396755744615195, -1.7105116328208096, 8.383702852785943],
    radius: 2.2,
  });
  assert.equal(manifest.route.requested, manifest.route.effective);
  assert.equal(manifest.route.fallbackUsed, false);
  assert.equal(manifest.captureUrls[0].state, 'before');
  assert.ok(manifest.captureUrls.slice(1).every(row => row.state === 'packed'));
  assert.deepEqual(report.inputs.frontier.requested, report.inputs.frontier.effective);
  assert.equal(report.inputs.frontier.fallbackUsed, false);
  assert.equal(report.lastTrustworthyEvidence.phase, 'visual-primary-written');
  for (const candidateId of manifest.candidateIds) {
    const html = await readFile(
      path.join(output, 'candidates', candidateId, 'index.html'),
      'utf8',
    );
    assert.ok(html.includes(JSON.stringify(manifest.focus.point)));
    assert.ok(html.includes(manifest.bundles[candidateId].sha256));
    assert.match(html, /viewMode==='contact'/);
  }
  const sheet = await readFile(path.join(output, 'contact-sheet.html'), 'utf8');
  assert.ok(manifest.candidateIds.every(candidateId => sheet.includes(candidateId)));
  assert.match(sheet, /measured-refused/);
});

test('ramp visual preparation rejects carrier tampering before its primary manifest', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-ramp-tamper-'));
  await cp(FRONTIER_ROOT, fixtureRoot, { recursive: true });
  const carrier = path.join(
    fixtureRoot,
    'candidates/ramp-a092-a096-repay-789-packed-carrier.json',
  );
  const parsed = JSON.parse(await readFile(carrier, 'utf8'));
  parsed.cages[0].manifest.nodes[0].currentPosition[0] += 0.01;
  await writeFile(carrier, `${JSON.stringify(parsed, null, 2)}\n`);
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-ramp-tamper-out-'));
  const result = run(path.join(fixtureRoot, 'frontier-result.json'), output);
  assert.notEqual(result.status, 0);
  const report = await json(output, 'run-report.json');
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'verify-candidate-inputs');
  assert.equal(report.outputs, null);
  await assert.rejects(readFile(path.join(output, 'visual-manifest.json')), /ENOENT/);
});
