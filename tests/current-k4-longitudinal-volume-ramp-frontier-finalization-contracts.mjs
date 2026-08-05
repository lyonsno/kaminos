import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(
  REPO_ROOT,
  'tools/finalize-current-k4-ring-cage-longitudinal-volume-frontier.mjs',
);
const FRONTIER_ROOT = path.join(
  REPO_ROOT,
  'artifacts/current-k4-ring-cage-longitudinal-volume-ramp-frontier-v0',
);

async function json(root, relative) {
  return JSON.parse(await readFile(path.join(root, relative), 'utf8'));
}

function run(output) {
  return spawnSync(process.execPath, [TOOL, '--output', output], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

test('ramp finalization exposes the inspected scalar advance and withheld visual selection', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-ramp-finalize-'));
  await cp(FRONTIER_ROOT, output, { recursive: true });
  const result = run(output);
  assert.equal(result.status, 0, result.stderr);
  const [frontier, report, verification, finalization] = await Promise.all([
    json(output, 'frontier-result.json'),
    json(output, 'run-report.json'),
    json(output, 'visual/capture-route-verification.json'),
    json(output, 'visual/visual-finalization-report.json'),
  ]);
  assert.equal(frontier.resultStatus,
    'smooth-ramp-frontier-retained-scalar-advance-no-visual-selection');
  assert.equal(frontier.visual.status,
    'agent-inspected-ramp-frontier-coherent-scalar-advance-visually-subtle');
  assert.equal(frontier.visual.disposition,
    'retain-two-nondominated-ramps-reject-visual-selection-redirect-to-contact-normal-cross-section-ramp');
  assert.equal(frontier.visual.decision.selectedCandidateId, null);
  assert.equal(verification.status, 'verified');
  assert.equal(verification.captures.length, 8);
  assert.equal(verification.contactSheet.primaryOutput.png.width, 1600);
  assert.equal(verification.contactSheet.primaryOutput.png.height, 3000);
  assert.equal(report.resultStatus, frontier.resultStatus);
  assert.equal(report.lastTrustworthyEvidence.phase, 'visual-frontier-finalized');
  assert.equal(finalization.status, 'completed');
  assert.equal(finalization.outputs.captureRouteVerification.sha256,
    report.outputs.captureRouteVerification.sha256);

  const second = run(output);
  assert.equal(second.status, 0, second.stderr);
  assert.equal((await json(output, 'visual/visual-finalization-report.json')).status,
    'completed');
});

test('ramp finalization rejects stable Chrome without rewriting its scalar primary', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-ramp-stable-'));
  await cp(FRONTIER_ROOT, output, { recursive: true });
  const frontierPath = path.join(output, 'frontier-result.json');
  const before = await readFile(frontierPath);
  const reportPath = path.join(
    output,
    'visual/candidates/ramp-a092-a096-repay-789/contact-capture-report.json',
  );
  const capture = JSON.parse(await readFile(reportPath, 'utf8'));
  capture.browser.effective.installedStableChrome = true;
  await writeFile(reportPath, `${JSON.stringify(capture, null, 2)}\n`);
  const result = run(output);
  assert.notEqual(result.status, 0);
  const after = await readFile(frontierPath);
  assert.ok(before.equals(after));
  const finalization = await json(output, 'visual/visual-finalization-report.json');
  assert.equal(finalization.status, 'failed');
  assert.equal(finalization.failurePhase, 'verify-capture-receipts');
  assert.match(finalization.error, /stable Chrome/i);
});
