import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(
  REPO_ROOT,
  'tools/run-current-k4-ring-cage-longitudinal-volume-ramp-frontier.mjs',
);
const CONFIG = path.join(
  REPO_ROOT,
  'fixtures/current-k4-packing/current-k4-longitudinal-volume-ramp-frontier-v0.json',
);
const CARRIER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/packed-carrier.json',
);
const SOURCE = path.join(
  REPO_ROOT,
  'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
);

function run(output, extra = []) {
  return spawnSync(process.execPath, [
    TOOL,
    '--selected-carrier', CARRIER,
    '--source', SOURCE,
    '--config', CONFIG,
    '--output', output,
    ...extra,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
}

async function json(output, relative) {
  return JSON.parse(await readFile(path.join(output, relative), 'utf8'));
}

test('the ramp frontier preserves the full requested matrix and measured refusal', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-ramp-frontier-'));
  const result = run(output);
  assert.equal(result.status, 0, result.stderr);
  const report = await json(output, 'run-report.json');
  const frontier = await json(output, 'frontier-result.json');

  assert.equal(report.status, 'completed');
  assert.equal(report.requestedCandidateCount, 7);
  assert.equal(report.effectiveCandidateCount, 7);
  assert.equal(report.candidateCapApplied, false);
  assert.equal(frontier.candidates.length, 7);
  assert.deepEqual(frontier.requestedCandidateIds, [
    'ramp-a092-a096-repay-789',
    'ramp-a092-a096-repay-6789',
    'ramp-a090-a095-repay-789',
    'ramp-a090-a095-repay-6789',
    'ramp-a090-a094-repay-789',
    'ramp-a090-a094-repay-6789',
    'ramp-a090-a094-a098-repay-5678',
  ]);
  const negativeControl = frontier.candidates.at(-1);
  assert.equal(negativeControl.status, 'measured-refused');
  assert.deepEqual(negativeControl.refusalReasons, [
    'skeletal-penetration-increase',
  ]);
  assert.ok(negativeControl.packedCarrier?.path && negativeControl.packedCarrier?.sha256);
  assert.ok(negativeControl.residualLedger?.path && negativeControl.residualLedger?.sha256);
  const admissible = frontier.candidates.filter(row => row.status === 'admissible');
  assert.equal(admissible.length, 6);
  assert.ok(admissible.every(row =>
    row.metrics.fixedNodeMaximumDrift === 0 &&
    row.metrics.centerlineMaximumDrift === 0 &&
    row.metrics.nonPositiveCellCount === 0 &&
    row.metrics.compartmentMaximumEscape === 0 &&
    row.metrics.skeletalPenetrationIncrease <= 1e-12 &&
    row.metrics.transferVolumeRelativeError <= 1e-10));
  assert.deepEqual(frontier.nondominatedCandidateIds, [
    'ramp-a092-a096-repay-789',
    'ramp-a090-a094-repay-6789',
  ]);
  assert.equal(frontier.visual.status, 'pending-agent-inspection');
  assert.deepEqual(frontier.visual.candidateIds, frontier.candidates.map(row => row.id));
  assert.deepEqual(report.inputs.config.requested, report.inputs.config.effective);
  assert.equal(report.inputs.config.fallbackUsed, false);
  assert.equal(report.lastTrustworthyEvidence.phase, 'frontier-result-written');
});

test('a ramp-frontier parse failure clears only owned stale evidence and remains durable', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-ramp-frontier-fail-'));
  await writeFile(
    path.join(output, '.kaminos-current-k4-longitudinal-volume-ramp-frontier-output'),
    'kaminos.current-k4-longitudinal-volume-ramp-frontier-output-custody.v0\n',
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

test('a ramp-frontier parse failure never clears a lookalike unowned directory', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-ramp-frontier-unowned-'));
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
