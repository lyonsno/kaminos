import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(
  REPO_ROOT,
  'tools/run-current-k4-ring-cage-longitudinal-volume-amplitude-frontier.mjs',
);
const CONFIG = path.join(
  REPO_ROOT,
  'fixtures/current-k4-packing/current-k4-longitudinal-volume-amplitude-frontier-v0.json',
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

function run(output, extra = []) {
  return spawnSync(process.execPath, [
    TOOL,
    '--selected-carrier', CARRIER,
    '--residual-ledger', LEDGER,
    '--source', SOURCE,
    '--config', CONFIG,
    '--output', output,
    ...extra,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
}

async function json(output, relative) {
  return JSON.parse(await readFile(path.join(output, relative), 'utf8'));
}

test('the bounded longitudinal frontier preserves every requested amplitude and one selection law', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-longitudinal-frontier-'));
  const result = run(output);
  assert.equal(result.status, 0, result.stderr);
  const report = await json(output, 'run-report.json');
  const frontier = await json(output, 'frontier-result.json');

  assert.equal(report.status, 'completed');
  assert.equal(report.failurePhase, null);
  assert.equal(report.requestedCandidateCount, 3);
  assert.equal(report.effectiveCandidateCount, 3);
  assert.equal(report.candidateCapApplied, false);
  assert.deepEqual(frontier.requestedCompressionAreaScales, [0.92, 0.94, 0.96]);
  assert.deepEqual(frontier.candidates.map(candidate => candidate.id), [
    'm45-s11-a092', 'm45-s11-a094', 'm45-s11-a096',
  ]);
  assert.ok(frontier.candidates.every(candidate =>
    ['admissible', 'refused'].includes(candidate.status)));
  assert.equal(frontier.candidates.length, 3);
  assert.deepEqual(frontier.pressureSelection.compressionSectionIds, [
    'muscle-45:section:0011',
  ]);
  assert.deepEqual(frontier.pressureSelection.repaymentSectionIds, [
    'muscle-45:section:0010',
    'muscle-45:section:0009',
    'muscle-45:section:0008',
    'muscle-45:section:0007',
  ]);
  assert.ok(frontier.candidates.filter(candidate => candidate.status === 'admissible')
    .every(candidate =>
      candidate.metrics.fixedNodeMaximumDrift === 0 &&
      candidate.metrics.centerlineMaximumDrift === 0 &&
      candidate.metrics.nonPositiveCellCount === 0 &&
      candidate.metrics.compartmentMaximumEscape === 0 &&
      candidate.metrics.transferVolumeRelativeError <= 1e-10 &&
      candidate.packedCarrier?.path && candidate.packedCarrier?.sha256 &&
      candidate.residualLedger?.path && candidate.residualLedger?.sha256));
  assert.ok(frontier.nondominatedCandidateIds.every(id =>
    frontier.candidates.some(candidate => candidate.id === id &&
      candidate.status === 'admissible')));
  assert.equal(frontier.visual.status, 'pending-agent-inspection');
  assert.equal(frontier.visual.requiredView, 'identity-bound-contact-region-close');
  assert.deepEqual(report.inputs.config.requested, report.inputs.config.effective);
  assert.equal(report.inputs.config.fallbackUsed, false);
  assert.equal(report.lastTrustworthyEvidence.phase, 'frontier-result-written');
});

test('a parse failure preserves a durable report and clears only owned stale evidence', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-longitudinal-frontier-fail-'));
  await writeFile(
    path.join(output, '.kaminos-current-k4-longitudinal-volume-frontier-output'),
    'kaminos.current-k4-longitudinal-volume-frontier-output-custody.v0\n',
  );
  await writeFile(path.join(output, 'frontier-result.json'), '{"status":"stale"}\n');
  await mkdir(path.join(output, 'candidates'), { recursive: true });
  await writeFile(path.join(output, 'candidates/stale.json'), '{}\n');
  const result = spawnSync(process.execPath, [
    TOOL,
    '--output', output,
    '--unsupported', 'value',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const report = await json(output, 'run-report.json');
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'parse-arguments');
  assert.equal(report.outputCustodyVerified, true);
  assert.equal(report.staleEvidenceCleared, true);
  assert.equal(report.outputs, null);
  await assert.rejects(readFile(path.join(output, 'frontier-result.json')), /ENOENT/);
  await assert.rejects(readFile(path.join(output, 'candidates/stale.json')), /ENOENT/);
});

test('a parse failure never clears a lookalike unowned directory', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-longitudinal-frontier-unowned-'));
  await writeFile(path.join(output, 'frontier-result.json'), '{"owner":"other-tool"}\n');
  const result = spawnSync(process.execPath, [
    TOOL,
    '--output', output,
    '--unsupported', 'value',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const report = await json(output, 'run-report.json');
  assert.equal(report.status, 'failed');
  assert.equal(report.outputCustodyVerified, false);
  assert.equal(report.staleEvidenceCleared, false);
  assert.equal((await json(output, 'frontier-result.json')).owner, 'other-tool');
});
