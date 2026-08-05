import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(
  REPO_ROOT,
  'tools/run-current-k4-ring-cage-anisotropy-sweep.mjs',
);
const FIXTURE = path.join(
  REPO_ROOT,
  'fixtures/current-k4-packing/current-k4-anisotropy-frontier-v0.json',
);

function run(output, extra = []) {
  return spawnSync(process.execPath, [
    TOOL,
    '--solver-carrier',
    path.join(REPO_ROOT, 'artifacts/current-k4-ring-cage-admission-v0/solver-carrier.json'),
    '--selected-carrier',
    path.join(
      REPO_ROOT,
      'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/packed-carrier.json',
    ),
    '--source',
    path.join(
      REPO_ROOT,
      'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
    ),
    '--config', FIXTURE,
    '--output', output,
    ...extra,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
}

test('the bounded current-K4 anisotropy frontier preserves all nine requested outcomes', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-anisotropy-sweep-'));
  const result = run(output);
  assert.equal(result.status, 0, result.stderr);

  const [report, sweep] = await Promise.all([
    readFile(path.join(output, 'run-report.json'), 'utf8').then(JSON.parse),
    readFile(path.join(output, 'sweep-result.json'), 'utf8').then(JSON.parse),
  ]);
  assert.equal(report.schema,
    'kaminos.current-k4-ring-cage-anisotropy-sweep-run-report.v0');
  assert.equal(report.status, 'completed');
  assert.equal(report.failurePhase, null);
  assert.equal(report.requestedCandidateCount, 9);
  assert.equal(report.effectiveCandidateCount, 9);
  assert.equal(report.candidateCapApplied, false);
  assert.equal(sweep.schema,
    'kaminos.current-k4-ring-cage-anisotropy-sweep-result.v0');
  assert.equal(sweep.status, 'completed');
  assert.deepEqual(sweep.requestedGrid, {
    centerlineCheckpoints: [60, 66, 72],
    compressionScales: [0.92, 0.94, 0.96],
  });
  assert.equal(sweep.candidates.length, 9);
  assert.deepEqual(
    sweep.candidates.map(candidate => candidate.id),
    [
      'c12-i060-s092', 'c12-i060-s094', 'c12-i060-s096',
      'c12-i066-s092', 'c12-i066-s094', 'c12-i066-s096',
      'c12-i072-s092', 'c12-i072-s094', 'c12-i072-s096',
    ],
  );
  assert.ok(sweep.candidates.every(candidate =>
    ['admissible', 'refused'].includes(candidate.status)));
  assert.equal(
    sweep.candidates.filter(candidate => candidate.status === 'admissible').length +
      sweep.candidates.filter(candidate => candidate.status === 'refused').length,
    9,
    'refused cells must remain explicit rather than disappearing from the frontier',
  );
  assert.ok(sweep.candidates.some(candidate => candidate.status === 'admissible'));
  assert.ok(sweep.candidates.filter(candidate => candidate.status === 'admissible')
    .every(candidate =>
      candidate.metrics.fixedNodeMaximumDrift === 0 &&
      candidate.metrics.centerlineMaximumDrift === 0 &&
      candidate.metrics.nonPositiveCellCount === 0 &&
      candidate.metrics.compartmentMaximumEscape <= 0.0001 &&
      candidate.metrics.maximumRelativeVolumeError <= 0.015 &&
      candidate.metrics.maximumSectionAreaRelativeError <= 1e-12 &&
      candidate.packedCarrier?.path && candidate.packedCarrier?.sha256));
  assert.ok(sweep.nondominatedCandidateIds.every(id =>
    sweep.candidates.some(candidate => candidate.id === id && candidate.status === 'admissible')));
  assert.equal(sweep.visual.status, 'pending-agent-inspection');
  assert.deepEqual(report.inputs.config.requested, report.inputs.config.effective);
  assert.equal(report.inputs.config.fallbackUsed, false);
  assert.equal(report.lastTrustworthyEvidence.phase, 'sweep-result-written');
});

test('the anisotropy frontier writes a parse failure receipt and erases stale success', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-anisotropy-sweep-failure-'));
  const stale = path.join(output, 'sweep-result.json');
  await writeFile(stale, '{"status":"stale-success"}\n');
  const result = spawnSync(process.execPath, [
    TOOL,
    '--output', output,
    '--unsupported', 'value',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsupported argument/i);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'parse-arguments');
  assert.equal(report.outputs, null);
  await assert.rejects(readFile(stale), /ENOENT/);
});
