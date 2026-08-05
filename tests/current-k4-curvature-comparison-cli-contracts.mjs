import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CLI = path.join(REPO_ROOT, 'tools/compare-current-k4-curvature-assays.mjs');
const HASH = character => character.repeat(64);

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

function runReport(curvatureRegularization) {
  const config = {
    convergenceTolerance: 0.0001,
    curvatureRegularization,
    maxIterations: 96,
    maximumRelativeVolumeError: 0.015,
  };
  return {
    status: 'completed',
    sourceInputSha256: HASH('a'),
    effectiveConstructionIds: ['muscle-12', 'muscle-45'],
    config: { requested: config, effective: config, fallbackUsed: false },
    iterations: 4,
    termination: { reason: 'line-search-exhausted' },
    fixedNodeMaximumDrift: 0,
    metrics: {
      packed: {
        pairwise: {
          movableTotalPenetration: 2,
          movableMaximumPenetration: 1,
          fixedTotalPenetration: 0.25,
        },
        skeletal: { movableTotalPenetration: 0, movableMaximumPenetration: 0 },
        compartment: { maximumEscape: 0 },
        cages: [{ relativeVolumeError: 0.01, nonPositiveCellCount: 0 }],
      },
    },
  };
}

function residualLedger() {
  return {
    pairwise: {
      contacts: [
        {
          subjectConstructionId: 'muscle-12',
          obstacleConstructionId: 'muscle-45',
          fixed: false,
          penetration: 2,
        },
        {
          subjectConstructionId: 'muscle-12',
          obstacleConstructionId: 'muscle-45',
          fixed: true,
          penetration: 0.25,
        },
      ],
    },
    skeletal: { contacts: [] },
  };
}

async function writeJson(target, value) {
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeAssay(directory, curvatureRegularization) {
  await mkdir(directory, { recursive: true });
  await writeJson(path.join(directory, 'run-report.json'), runReport(curvatureRegularization));
  await writeJson(path.join(directory, 'residual-ledger.json'), residualLedger());
  await writeJson(path.join(directory, 'capture-route-verification.json'), {
    status: 'verified',
    bundleIdentity: { sha256: HASH(curvatureRegularization === 12 ? 'b' : 'c') },
    captures: [{ sha256: HASH(curvatureRegularization === 12 ? 'd' : 'e') }],
  });
  await writeJson(path.join(directory, 'visual-inspection.json'), {
    status: 'agent-inspected',
    captures: [{ sha256: HASH(curvatureRegularization === 12 ? 'd' : 'e') }],
  });
}

test('curvature comparison CLI recomputes exact receipts and fails loud on plausible false closure', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'kaminos-curvature-comparison-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const selected = path.join(root, 'selected');
  const challenger = path.join(root, 'challenger');
  const output = path.join(root, 'comparison.json');
  await writeAssay(selected, 12);
  await writeAssay(challenger, 6);

  const valid = run(['--selected', selected, '--challenger', challenger, '--output', output]);
  assert.equal(valid.status, 0, valid.stderr);
  const comparison = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(comparison.status, 'completed');
  assert.equal(comparison.decision.classification,
    'dominant-residual-family-persists-under-curvature-challenger');
  assert.equal(comparison.visual.selected.routeVerificationStatus, 'verified');
  assert.equal(comparison.visual.selected.inspectionStatus, 'agent-inspected');

  const tamperCases = [
    ['source identity', report => { report.sourceInputSha256 = HASH('f'); }, /source input identity/i],
    ['construction order', report => { report.effectiveConstructionIds.reverse(); }, /construction order/i],
    ['shared config', report => { report.config.effective.maxIterations = 48; }, /more than curvature/i],
    ['fallback', report => { report.config.fallbackUsed = true; }, /more than curvature|fallback/i],
  ];
  for (const [name, mutate, expected] of tamperCases) {
    await t.test(`rejects ${name} drift and replaces stale success`, async () => {
      const reportPath = path.join(challenger, 'run-report.json');
      const original = runReport(6);
      const tampered = structuredClone(original);
      mutate(tampered);
      await writeJson(reportPath, tampered);
      await writeJson(output, { status: 'completed', stale: true });
      const result = run(['--selected', selected, '--challenger', challenger, '--output', output]);
      assert.notEqual(result.status, 0);
      const failure = JSON.parse(await readFile(output, 'utf8'));
      assert.equal(failure.status, 'failed');
      assert.equal(failure.failurePhase, 'validate-comparison-class');
      assert.match(failure.error, expected);
      assert.equal(failure.stale, undefined);
      await writeJson(reportPath, original);
    });
  }

  await t.test('rejects missing or failed visual verification', async () => {
    await writeJson(path.join(challenger, 'capture-route-verification.json'), { status: 'failed' });
    const result = run(['--selected', selected, '--challenger', challenger, '--output', output]);
    assert.notEqual(result.status, 0);
    const failure = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(failure.status, 'failed');
    assert.match(failure.error, /visual routes must be independently verified/i);
    await writeAssay(challenger, 6);
  });

  await t.test('writes a parse-time failure receipt whenever output is recoverable', async () => {
    await writeJson(output, { status: 'completed', stale: true });
    const result = run([
      '--selected', selected,
      '--challenger', challenger,
      '--unsupported', 'value',
      '--output', output,
    ]);
    assert.notEqual(result.status, 0);
    const failure = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(failure.status, 'failed');
    assert.equal(failure.failurePhase, 'parse-arguments');
    assert.deepEqual(failure.rawArguments, [
      '--selected', selected,
      '--challenger', challenger,
      '--unsupported', 'value',
      '--output', output,
    ]);
    assert.equal(failure.stale, undefined);
  });
});
