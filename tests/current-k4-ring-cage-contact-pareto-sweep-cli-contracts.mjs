import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(REPO_ROOT, 'tools/run-current-k4-ring-cage-contact-pareto-sweep.mjs');
const SOLVER_CARRIER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-ring-cage-admission-v0/solver-carrier.json',
);
const SOURCE = path.join(
  REPO_ROOT,
  'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
);
const MATRIX = path.join(
  REPO_ROOT,
  'fixtures/current-k4-packing/current-k4-curvature-contact-pareto-v0.json',
);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function run(output, matrix = MATRIX) {
  return spawnSync(process.execPath, [
    TOOL,
    '--solver-carrier', SOLVER_CARRIER,
    '--source', SOURCE,
    '--matrix', matrix,
    '--output', output,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
}

test('current K4 Pareto sweep executes every caller-owned candidate and preserves the residual-shape frontier', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-k4-contact-pareto-'));
  const completed = run(output);
  assert.equal(completed.status, 0, completed.stderr);

  const matrix = JSON.parse(await readFile(MATRIX, 'utf8'));
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  const result = JSON.parse(await readFile(path.join(output, 'sweep-result.json'), 'utf8'));
  assert.equal(report.schema,
    'kaminos.current-k4-ring-cage-contact-pareto-run-report.v0');
  assert.equal(report.status, 'completed');
  assert.equal(report.requestedMatrixPath, MATRIX);
  assert.equal(report.effectiveMatrixPath,
    'repo://fixtures/current-k4-packing/current-k4-curvature-contact-pareto-v0.json');
  assert.equal(report.matrixFileSha256, sha256(await readFile(MATRIX)));
  assert.equal(report.requestedCandidateCount, matrix.candidates.length);
  assert.equal(report.effectiveCandidateCount, matrix.candidates.length);
  assert.equal(report.candidateCapApplied, false);
  assert.equal(result.candidates.length, matrix.candidates.length);
  assert.deepEqual(
    result.candidates.map(row => row.id),
    matrix.candidates.map(row => row.id),
  );
  assert.deepEqual(result.paretoCandidateIds, matrix.candidates.map(row => row.id));
  for (const [index, candidate] of result.candidates.entries()) {
    assert.deepEqual(candidate.config.requested, matrix.candidates[index].config);
    assert.deepEqual(candidate.config.effective, matrix.candidates[index].config);
    assert.equal(candidate.config.fallbackUsed, false);
    assert.equal(candidate.feasible, true);
    assert.equal(candidate.fixedNodeMaximumDrift, 0);
    assert.equal(candidate.metrics.compartmentMaximumEscape, 0);
    assert.equal(candidate.metrics.nonPositiveCellCount, 0);
    const configBytes = await readFile(path.join(output, candidate.configArtifact.path));
    assert.equal(sha256(configBytes), candidate.configArtifact.sha256);
    assert.deepEqual(JSON.parse(configBytes), matrix.candidates[index].config);
    const packedBytes = await readFile(path.join(output, candidate.packedCarrier.path));
    assert.equal(sha256(packedBytes), candidate.packedCarrier.sha256);
  }
  assert.ok(result.candidates.every((candidate, index, rows) => index === 0 ||
    candidate.objectives.contactResidual > rows[index - 1].objectives.contactResidual));
  assert.ok(result.candidates.every((candidate, index, rows) => index === 0 ||
    candidate.objectives.maximumLocalTurningAngleChange <
      rows[index - 1].objectives.maximumLocalTurningAngleChange));
  const resultBytes = await readFile(path.join(output, report.outputs.sweepResult.path));
  assert.equal(sha256(resultBytes), report.outputs.sweepResult.sha256);
});

test('malformed Pareto matrix clears stale primary evidence and writes a terminal report', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-k4-contact-pareto-fail-'));
  const matrix = path.join(output, 'malformed-matrix.json');
  await writeFile(matrix, '{"schema":"wrong","candidates":[]}\n');
  await writeFile(path.join(output, 'sweep-result.json'), 'stale');

  const failed = run(output, matrix);
  assert.notEqual(failed.status, 0);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'validate-matrix');
  assert.equal(report.outputs, null);
  assert.match(report.error, /Pareto matrix schema|candidate/i);
  await assert.rejects(access(path.join(output, 'sweep-result.json')), { code: 'ENOENT' });
});
