import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(
  REPO_ROOT,
  'tools/run-current-k4-post-composition-contact-solve.mjs',
);
const CONFIG = path.join(
  REPO_ROOT,
  'fixtures/current-k4-packing/current-k4-post-composition-contact-solve-v0.json',
);
const FRONTIER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-ring-cage-contact-normal-ramp-frontier-v0/frontier-result.json',
);
const SOURCE = path.join(
  REPO_ROOT,
  'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
);
const CUSTODY_MARKER = '.kaminos-current-k4-post-composition-contact-solve-output';
const CUSTODY_SCHEMA =
  'kaminos.current-k4-post-composition-contact-solve-output-custody.v0';

function run(output, { frontier = FRONTIER, config = CONFIG } = {}) {
  return spawnSync(process.execPath, [
    TOOL,
    '--frontier', frontier,
    '--source', SOURCE,
    '--config', config,
    '--output', output,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
}

async function json(output, relative) {
  return JSON.parse(await readFile(path.join(output, relative), 'utf8'));
}

async function shortBudgetConfig(directory, maxIterations = 2) {
  const config = JSON.parse(await readFile(CONFIG, 'utf8'));
  config.solver.maxIterations = maxIterations;
  const configPath = path.join(directory, 'input', 'short-config.json');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config));
  return configPath;
}

test('the post-composition solve seeds every retained candidate plus the reference control', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-postsolve-'));
  const output = path.join(root, 'out');
  const result = run(output, { config: await shortBudgetConfig(root) });
  assert.equal(result.status, 0, result.stderr);
  const report = await json(output, 'run-report.json');
  const solve = await json(output, 'solve-result.json');
  const frontier = JSON.parse(await readFile(FRONTIER, 'utf8'));

  const expectedIds = [
    ...frontier.nondominatedCandidateIds.map(id => `solve-${id}`),
    'solve-reference-control',
  ];
  assert.equal(report.status, 'completed');
  assert.equal(report.requestedCandidateCount, expectedIds.length);
  assert.equal(report.effectiveCandidateCount, expectedIds.length);
  assert.equal(report.candidateCapApplied, false);
  assert.deepEqual(solve.candidates.map(row => row.id), expectedIds);
  assert.equal(report.inputs.config.fallbackUsed, false);
  assert.deepEqual(report.inputs.config.requested, report.inputs.config.effective);
  assert.equal(report.lastTrustworthyEvidence.phase, 'solve-result-written');
  assert.equal(solve.visual.status, 'pending-agent-inspection');
  assert.equal(solve.anisotropyContract.peakSectionId,
    frontier.anisotropyContract.peakSectionId);

  const admissible = solve.candidates.filter(row => row.status === 'admissible');
  assert.ok(admissible.length > 0, 'solve produced no admissible row');
  const admissibleIds = new Set(admissible.map(row => row.id));
  assert.ok(solve.nondominatedCandidateIds.every(id => admissibleIds.has(id)));

  for (const row of solve.candidates) {
    if (row.status === 'application-refused') {
      assert.ok(row.error);
      continue;
    }
    const receipt = await json(output, row.solveApplication.path);
    const packedCarrier = await json(output, row.packedCarrier.path);
    const ledger = await json(output, row.residualLedger.path);
    // Exact seed identity: each solve starts from the recorded seed carrier.
    if (row.id === 'solve-reference-control') {
      assert.equal(receipt.sourceCarrierSha256, solve.selectedReference.carrierSha256);
      assert.equal(row.requested.seedCandidateId, null);
    } else {
      const seed = frontier.candidates.find(
        candidate => `solve-${candidate.id}` === row.id,
      );
      assert.ok(seed, `frontier lacks seed for ${row.id}`);
      assert.equal(row.requested.seedCandidateId, seed.id);
      const seedCarrier = JSON.parse(await readFile(path.join(
        path.dirname(FRONTIER), seed.packedCarrier.path), 'utf8'));
      assert.equal(receipt.sourceCarrierSha256, seedCarrier.identity.sha256);
    }
    assert.equal(ledger.sourceCarrierSha256, packedCarrier.identity.sha256);
    assert.equal(receipt.config.fallbackUsed, false);
    assert.deepEqual(receipt.config.requested, receipt.config.effective);
    assert.ok(Number.isInteger(row.metrics.iterationsAccepted));
    assert.ok(typeof row.metrics.terminationReason === 'string');
  }
  for (const row of admissible) {
    assert.equal(row.metrics.fixedNodeMaximumDrift, 0);
    assert.deepEqual(row.refusalReasons, []);
  }
});

test('a post-solve parse failure clears only owned stale evidence and remains durable', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-postsolve-fail-'));
  await writeFile(path.join(output, CUSTODY_MARKER), `${CUSTODY_SCHEMA}\n`);
  await writeFile(path.join(output, 'solve-result.json'), '{"status":"stale"}\n');
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
  await assert.rejects(readFile(path.join(output, 'solve-result.json')), /ENOENT/);
  await assert.rejects(readFile(path.join(output, 'candidates/stale.json')), /ENOENT/);
});

test('a post-solve parse failure never clears a lookalike unowned directory', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-postsolve-unowned-'));
  await writeFile(path.join(output, 'solve-result.json'), '{"owner":"other-tool"}\n');
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
  assert.equal(
    JSON.parse(await readFile(path.join(output, 'solve-result.json'), 'utf8')).owner,
    'other-tool',
  );
});

test('an invalid solver budget fails loudly before any seed work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-postsolve-config-'));
  const config = JSON.parse(await readFile(CONFIG, 'utf8'));
  config.solver.maxIterations = 0;
  const configPath = path.join(root, 'input', 'invalid-config.json');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config));
  const output = path.join(root, 'out');
  const result = run(output, { config: configPath });
  assert.notEqual(result.status, 0);
  const report = await json(output, 'run-report.json');
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'validate-config');
  await assert.rejects(readFile(path.join(output, 'solve-result.json')), /ENOENT/);
});

test('a frontier naming an unknown retained candidate fails loudly before solving', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-postsolve-tamper-'));
  const frontier = JSON.parse(await readFile(FRONTIER, 'utf8'));
  frontier.nondominatedCandidateIds = ['no-such-candidate'];
  const frontierPath = path.join(root, 'input', 'tampered-frontier.json');
  await mkdir(path.dirname(frontierPath), { recursive: true });
  await writeFile(frontierPath, JSON.stringify(frontier));
  const output = path.join(root, 'out');
  const result = run(output, {
    frontier: frontierPath,
    config: await shortBudgetConfig(root),
  });
  assert.notEqual(result.status, 0);
  const report = await json(output, 'run-report.json');
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'resolve-seed-carriers');
  await assert.rejects(readFile(path.join(output, 'solve-result.json')), /ENOENT/);
});
