import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(REPO_ROOT, 'tools/run-source-shaped-muscle-packing-assay.mjs');
const ATLAS = path.join(
  REPO_ROOT,
  'artifacts/authored-muscle-coordinate-export-v0/dense-selectors/k4-current-graph/parent-atlas.json',
);

function run(output, routes, parentAtlas = ATLAS) {
  return spawnSync(process.execPath, [
    TOOL,
    '--parent-atlas', parentAtlas,
    '--routes', routes.join(','),
    '--output', output,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

test('assay CLI rejects a primary-output alias before touching parent-atlas bytes', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-k4-assay-input-alias-'));
  const parentAtlas = path.join(output, 'perturbation-result.json');
  const atlasBytes = await readFile(ATLAS);
  await writeFile(parentAtlas, atlasBytes);
  const result = run(output, ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45'], parentAtlas);
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readFile(parentAtlas), atlasBytes, 'input bytes must survive the rejected run');
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'resolve-destinations');
  assert.match(report.error, /primary output.*alias.*parent atlas/i);
});

test('assay CLI redirects a report alias to a failure sidecar without publishing success', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-k4-assay-report-alias-'));
  const parentAtlas = path.join(output, 'run-report.json');
  const atlasBytes = await readFile(ATLAS);
  await writeFile(parentAtlas, atlasBytes);
  const result = run(output, ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45'], parentAtlas);
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readFile(parentAtlas), atlasBytes, 'input bytes must survive the rejected run');
  const sidecar = path.join(output, 'run-report.json.source-shaped-packing-assay-failure.json');
  const report = JSON.parse(await readFile(sidecar, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'resolve-destinations');
  assert.match(report.error, /report path.*alias.*parent atlas/i);
  await assert.rejects(readFile(path.join(output, 'perturbation-result.json')), /ENOENT/);
});

test('assay CLI resolves report symlinks before protecting parent-atlas bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kaminos-k4-assay-report-symlink-'));
  const output = path.join(root, 'output');
  const parentAtlas = path.join(root, 'parent-atlas.json');
  const atlasBytes = await readFile(ATLAS);
  await writeFile(parentAtlas, atlasBytes);
  await mkdir(output);
  await symlink(parentAtlas, path.join(output, 'run-report.json'));
  const result = run(output, ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45'], parentAtlas);
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readFile(parentAtlas), atlasBytes, 'symlink target bytes must survive');
  const sidecar = path.join(output, 'run-report.json.source-shaped-packing-assay-failure.json');
  const report = JSON.parse(await readFile(sidecar, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'resolve-destinations');
  assert.match(report.error, /report path.*alias.*parent atlas/i);
});

test('assay CLI writes a durable failure report before primary output exists', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-k4-assay-failure-'));
  const result = run(output, ['muscle-34', 'muscle-13', 'missing-route', 'muscle-45']);
  assert.notEqual(result.status, 0);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'build-and-solve');
  assert.deepEqual(
    report.requestedConstructionIds,
    ['muscle-34', 'muscle-13', 'missing-route', 'muscle-45'],
  );
  assert.match(report.lastTrustworthyEvidence.parentAtlasFileSha256, /^[0-9a-f]{64}$/);
  assert.match(report.error, /missing-route/);
  await assert.rejects(readFile(path.join(output, 'perturbation-result.json')), /ENOENT/);
});

test('assay CLI records effective identity and replays byte-identical primary output', async () => {
  const firstOutput = await mkdtemp(path.join(tmpdir(), 'kaminos-k4-assay-first-'));
  const secondOutput = await mkdtemp(path.join(tmpdir(), 'kaminos-k4-assay-replay-'));
  const routes = ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45'];
  const first = run(firstOutput, routes);
  const second = run(secondOutput, routes);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const firstBytes = await readFile(path.join(firstOutput, 'perturbation-result.json'));
  const secondBytes = await readFile(path.join(secondOutput, 'perturbation-result.json'));
  assert.deepEqual(secondBytes, firstBytes);
  const report = JSON.parse(await readFile(path.join(firstOutput, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'completed');
  assert.equal(
    report.effectiveParentAtlasPath,
    'repo://artifacts/authored-muscle-coordinate-export-v0/dense-selectors/k4-current-graph/parent-atlas.json',
  );
  assert.deepEqual(report.requestedConstructionIds, routes);
  assert.deepEqual(report.effectiveConstructionIds, routes);
  assert.match(report.outputSha256, /^[0-9a-f]{64}$/);
  assert.equal(report.claimCeiling, 'qualitative-route-local-mechanical-response');
  assert.equal(report.mechanism.requested.id, 'muscle-compartment-packing-projection.v0');
  assert.deepEqual(report.mechanism.effective, report.mechanism.requested);
  assert.deepEqual(
    report.conditions[1].perturbation.effective,
    report.conditions[1].perturbation.requested,
  );
  assert.equal(
    report.conditions[1].assumptions.effective.id,
    'source-shaped-k4-provisional-environment.v0',
  );
  assert.match(report.conditions[1].assumptions.effective.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(report.visual.route, {
    requested: 'source-shaped-muscle-packing-preflight-orbitable-v0',
    effective: 'source-shaped-muscle-packing-preflight-orbitable-v0',
    fallbackUsed: false,
  });
  assert.equal(report.visual.status, 'pending-agent-inspection');
  assert.match(report.visual.portfolioSha256, /^[0-9a-f]{64}$/);
  const portfolio = await readFile(path.join(firstOutput, 'index.html'), 'utf8');
  assert.match(portfolio, /Current-graph K4 fixed-attachment preflight/);
  for (const condition of report.conditions) {
    assert.equal(condition.visual.role, 'diagnostic-not-admission');
    assert.match(condition.visual.indexHtmlSha256, /^[0-9a-f]{64}$/);
    const html = await readFile(path.join(firstOutput, condition.visual.relativeRoot, 'index.html'), 'utf8');
    assert.match(html, /data-blocking-mechanism="pairwise-fixed-attachment-penetration"/);
    assert.match(html, /const framingBounds = new THREE\.Box3\(\)/);
    assert.match(html, /source-shaped-muscle-packing-preflight-orbitable-v0/);
  }
});
