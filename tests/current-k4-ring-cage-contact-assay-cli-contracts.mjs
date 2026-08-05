import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(REPO_ROOT, 'tools/run-current-k4-ring-cage-contact-assay.mjs');
const SOLVER_CARRIER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-ring-cage-admission-v0/solver-carrier.json',
);
const SOURCE = path.join(
  REPO_ROOT,
  'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
);
const IDS = ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45'];
const STALE_PRIMARY = [
  'assay-result.json',
  'source-carrier.json',
  'packed-carrier.json',
  'index.html',
  'source-crowded.png',
  'contact-relieved.png',
  'source-crowded-side.png',
  'contact-relieved-side.png',
  'source-crowded-capture-report.json',
  'contact-relieved-capture-report.json',
  'source-crowded-side-capture-report.json',
  'contact-relieved-side-capture-report.json',
  'capture-route-verification.json',
  'visual-inspection.json',
  'interpretation.md',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function run(output, extra = []) {
  return spawnSync(process.execPath, [
    TOOL,
    '--solver-carrier', SOLVER_CARRIER,
    '--source', SOURCE,
    '--output', output,
    ...extra,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
}

test('ring-cage contact assay writes a deterministic residual proposal and non-inverted orbitable witness', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-ring-cage-contact-assay-'));
  const completed = run(output);
  assert.equal(completed.status, 0, completed.stderr);

  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.schema, 'kaminos.current-k4-ring-cage-contact-assay-run-report.v0');
  assert.equal(report.status, 'completed');
  assert.equal(report.resultStatus, 'residual-constraint');
  assert.deepEqual(report.requestedConstructionIds, IDS);
  assert.deepEqual(report.effectiveConstructionIds, IDS);
  assert.deepEqual(report.visual.route, {
    requested: 'current-k4-ring-cage-contact-orbitable-v0',
    effective: 'current-k4-ring-cage-contact-orbitable-v0',
    fallbackUsed: false,
  });
  assert.equal(report.visual.status, 'pending-agent-inspection');
  assert.equal(report.visual.bundleIdentity.schema,
    'kaminos.current-k4-ring-cage-contact-visual-bundle.v0');
  assert.equal(report.visual.bundleIdentity.sha256.length, 64);
  assert.equal(report.visual.bundleIdentity.sourceCarrierSha256,
    report.solverCarrierIdentitySha256);
  assert.equal(report.visual.bundleIdentity.packedCarrierSha256,
    report.lastTrustworthyEvidence.packedCarrierIdentitySha256);
  assert.equal(report.visual.captureUrls.length, 4);
  for (const url of report.visual.captureUrls) {
    const parsed = new URL(url, 'http://127.0.0.1');
    assert.equal(parsed.searchParams.get('bundle'), report.visual.bundleIdentity.sha256);
    assert.equal(parsed.searchParams.get('source'), report.visual.bundleIdentity.sourceCarrierSha256);
    assert.equal(parsed.searchParams.get('packed'), report.visual.bundleIdentity.packedCarrierSha256);
  }
  assert.equal(report.fixedNodeMaximumDrift, 0);
  assert.ok(report.metrics.packed.pairwise.movableTotalPenetration <
    report.metrics.initial.pairwise.movableTotalPenetration * 0.65);
  assert.ok(report.metrics.packed.skeletal.movableTotalPenetration <
    report.metrics.initial.skeletal.movableTotalPenetration * 0.65);
  assert.ok(Math.max(...report.metrics.packed.cages.map(row => row.relativeVolumeError)) <= 0.015);
  assert.ok(report.metrics.packed.cages.every(row => row.nonPositiveCellCount === 0));
  assert.equal(report.metrics.packed.compartment.maximumEscape, 0);

  for (const artifact of Object.values(report.outputs)) {
    const bytes = await readFile(path.join(output, artifact.path));
    assert.equal(sha256(bytes), artifact.sha256);
  }
  const viewer = await readFile(path.join(output, report.outputs.viewer.path), 'utf8');
  assert.match(viewer, /Source crowded input/);
  assert.match(viewer, /Contact-relieved proposal · residual remains/);
  assert.match(viewer, /The source state is the squeezed, crowded construction/);
  assert.match(viewer, /dataset\.witnessBundle/);
  assert.match(viewer, /dataset\.sourceCarrier/);
  assert.match(viewer, /dataset\.packedCarrier/);
  assert.match(viewer, /identity-bound capture route mismatch/);
  assert.match(viewer, new RegExp(report.visual.bundleIdentity.sha256));
  assert.match(viewer, new RegExp(report.visual.bundleIdentity.sourceCarrierSha256));
  assert.match(viewer, new RegExp(report.visual.bundleIdentity.packedCarrierSha256));
  assert.doesNotMatch(viewer, />Before packing</);
  assert.doesNotMatch(viewer, />Packing result</);
});

test('failed reused-root ring-cage assay clears stale evidence and writes a terminal report', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-ring-cage-contact-stale-'));
  await Promise.all(STALE_PRIMARY.map(relative => writeFile(path.join(output, relative), 'stale')));
  const failed = run(output, ['--unlawful-fallback', 'yes']);
  assert.notEqual(failed.status, 0);

  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'parse-arguments');
  assert.equal(report.outputs, null);
  assert.equal(report.visual, null);
  for (const relative of STALE_PRIMARY) {
    await assert.rejects(access(path.join(output, relative)), { code: 'ENOENT' });
  }
});
