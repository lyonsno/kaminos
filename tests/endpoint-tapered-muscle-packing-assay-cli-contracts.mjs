import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(REPO_ROOT, 'tools/run-endpoint-tapered-muscle-packing-assay.mjs');
const ATLAS = path.join(
  REPO_ROOT,
  'artifacts/authored-muscle-coordinate-export-v0/dense-selectors/k4-current-graph/parent-atlas.json',
);
const ROUTES = ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45'];
const STALE_ARTIFACT_PATHS = [
  'authenticated-source.json',
  'parent-preflight-result.json',
  'derived-source.json',
  'derivation-receipt.json',
  'packing-result.json',
  'parent/index.html',
  'tapered/index.html',
  'index.html',
  'parent-before.png',
  'tapered-before.png',
  'tapered-packed.png',
  'parent-before-capture-report.json',
  'tapered-before-capture-report.json',
  'tapered-packed-capture-report.json',
  'visual-inspection.json',
  'interpretation.md',
];

function run(output, extra = []) {
  return spawnSync(process.execPath, [
    TOOL,
    '--parent-atlas', ATLAS,
    '--routes', ROUTES.join(','),
    '--output', output,
    '--endpoint-radius-multiplier', '0.26',
    '--transition-fraction', '0.2',
    '--max-iterations', '1',
    ...extra,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
}

async function seedStaleArtifacts(output) {
  await mkdir(path.join(output, 'parent'), { recursive: true });
  await mkdir(path.join(output, 'tapered'), { recursive: true });
  await Promise.all(
    STALE_ARTIFACT_PATHS.map(relative => writeFile(path.join(output, relative), 'stale')),
  );
}

async function assertStaleArtifactsCleared(output) {
  for (const relative of STALE_ARTIFACT_PATHS) {
    await assert.rejects(
      readFile(path.join(output, relative)),
      /ENOENT/,
      `${relative} must not survive a failed reused-root run`,
    );
  }
}

test('endpoint-taper assay writes identity-bound source, result, terminal report, and three-state visual route', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-endpoint-taper-assay-'));
  const completed = run(output);
  assert.equal(completed.status, 0, completed.stderr);

  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  const source = JSON.parse(await readFile(path.join(output, 'derived-source.json'), 'utf8'));
  const result = JSON.parse(await readFile(path.join(output, 'packing-result.json'), 'utf8'));
  const receipt = JSON.parse(await readFile(path.join(output, 'derivation-receipt.json'), 'utf8'));
  const portfolio = await readFile(path.join(output, 'index.html'), 'utf8');

  assert.equal(report.status, 'completed');
  assert.equal(report.failurePhase, null);
  assert.equal(report.requestedSolverConfig.maxIterations, 1);
  assert.equal(report.effectiveSolverConfig.maxIterations, 1);
  assert.deepEqual(report.requestedConstructionIds, ROUTES);
  assert.deepEqual(report.effectiveConstructionIds, ROUTES);
  assert.deepEqual(report.taper.requested, {
    endpointRadiusMultiplier: 0.26,
    transitionFraction: 0.2,
    profile: 'smoothstep-arc-length',
    volumeCompensation: 'global-radius',
  });
  assert.deepEqual(report.taper.effective, receipt.effective);
  assert.equal(report.taper.fallbackUsed, false);
  assert.equal(source.input.effective.sha256, receipt.derivedSource.sha256);
  assert.equal(result.sourceId, source.id);
  assert.equal(result.config.maxIterations, 1);
  assert.match(report.outputs.derivedSource.sha256, /^[0-9a-f]{64}$/);
  assert.match(report.outputs.packingResult.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(report.visual.route, {
    requested: 'endpoint-tapered-current-k4-orbitable-v0',
    effective: 'endpoint-tapered-current-k4-orbitable-v0',
    fallbackUsed: false,
  });
  assert.equal(report.visual.status, 'pending-agent-inspection');
  assert.match(portfolio, /Authenticated constant-radius source/);
  assert.match(portfolio, /Endpoint-tapered source/);
  assert.match(portfolio, /Packed candidate/);
  assert.match(
    await readFile(path.join(output, 'tapered', 'index.html'), 'utf8'),
    /endpoint-tapered-current-k4-orbitable-v0/,
  );
});

test('endpoint-taper assay fails loud on invalid taper without publishing a primary result', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-endpoint-taper-invalid-'));
  const failed = run(output, ['--endpoint-radius-multiplier', '1']);
  assert.notEqual(failed.status, 0);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'derive-source');
  assert.match(report.error, /radius multiplier must be in \(0, 1\)/);
  await assert.rejects(readFile(path.join(output, 'packing-result.json')), /ENOENT/);
});

test('failed reused-root assay clears stale visual captures, receipts, and interpretation', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-endpoint-taper-reused-'));
  await seedStaleArtifacts(output);

  const failed = run(output, ['--endpoint-radius-multiplier', '1']);
  assert.notEqual(failed.status, 0);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'derive-source');
  assert.equal(report.outputs, null);
  assert.equal(report.visual, null);
  await assertStaleArtifactsCleared(output);
});

test('parse-stage taper failure retains output custody and clears reused-root success evidence', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-endpoint-taper-parse-failure-'));
  await seedStaleArtifacts(output);

  const failed = run(output, ['--endpoint-radius-multiplier', 'not-finite']);
  assert.notEqual(failed.status, 0);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'parse-arguments');
  assert.match(report.error, /endpoint-radius-multiplier must be finite/);
  assert.equal(report.outputs, null);
  assert.equal(report.visual, null);
  await assertStaleArtifactsCleared(output);
});
