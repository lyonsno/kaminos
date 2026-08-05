import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(REPO_ROOT, 'tools/run-current-k4-fixed-contact-assay.mjs');
const ATLAS = path.join(
  REPO_ROOT,
  'artifacts/authored-muscle-coordinate-export-v0/dense-selectors/k4-current-graph/parent-atlas.json',
);
const IDS = ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45'];
const STALE_VISUALS = [
  'index.html',
  'baseline-source.png',
  'baseline-contact-admitted-result.png',
  'baseline-source-capture-report.json',
  'baseline-contact-admitted-result-capture-report.json',
  'visual-inspection.json',
  'interpretation.md',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function run(output, extra = []) {
  return spawnSync(process.execPath, [
    TOOL,
    '--parent-atlas', ATLAS,
    '--routes', IDS.join(','),
    '--output', output,
    '--max-iterations', '2',
    '--occupancy-envelope', 'normalized-sine',
    ...extra,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
}

test('fixed-contact assay opens exact belly negotiation while preserving and reporting admitted residuals', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-current-k4-fixed-contact-'));
  const completed = run(output);
  assert.equal(completed.status, 0, completed.stderr);

  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.schema, 'kaminos.current-k4-fixed-contact-assay-run-report.v0');
  assert.equal(report.status, 'completed');
  assert.deepEqual(report.requestedConstructionIds, IDS);
  assert.deepEqual(report.effectiveConstructionIds, IDS);
  assert.equal(report.shapeProfile.effective.id, 'volume-preserving-tapered-belly.v0');
  assert.equal(report.strictPreflight.status, 'immutable-constraint-conflict');
  assert.equal(report.strictPreflight.blockerCount, 2);
  assert.equal(report.strictPreflight.iterations, 0);
  assert.notEqual(report.contactAdmittedResult.status, 'immutable-constraint-conflict');
  assert.equal(report.contactAdmittedResult.iterations, 2);
  assert.equal(report.contactAdmittedResult.fixedAttachmentContact.policy, 'exact-source-linked-endpoint-only');
  assert.equal(report.contactAdmittedResult.fixedAttachmentContact.requested.length, 2);
  assert.equal(report.contactAdmittedResult.fixedAttachmentContact.effective.length, 2);
  assert.equal(report.contactAdmittedResult.fixedAttachmentContact.admittedResiduals.length, 2);
  assert.deepEqual(
    report.contactAdmittedResult.fixedAttachmentContact.admittedResiduals.map(row => row.penetration),
    report.strictPreflight.blockingMechanisms.map(row => row.penetration),
  );
  assert.equal(report.contactAdmittedResult.metrics.packed.endpointDrift, 0);
  assert.ok(report.contactAdmittedResult.metrics.packed.maximumRelativeVolumeError <= 1e-9);
  assert.ok(
    report.contactAdmittedResult.metrics.packed.pairwisePenetration <
      report.contactAdmittedResult.metrics.initial.pairwisePenetration,
  );
  assert.equal(report.contactAdmittedResult.clusterProjection.effectiveUpdate, 'capsule-axis-occupancy-allocation');
  assert.equal(report.contactAdmittedResult.clusterProjection.effectiveEnvelopeProfile, 'normalized-sine');
  assert.deepEqual(report.visual.route, {
    requested: 'current-k4-fixed-contact-orbitable-v0',
    effective: 'current-k4-fixed-contact-orbitable-v0',
    fallbackUsed: false,
  });
  assert.equal(report.visual.status, 'pending-agent-inspection');

  for (const artifact of Object.values(report.outputs)) {
    const bytes = await readFile(path.join(output, artifact.path));
    assert.equal(sha256(bytes), artifact.sha256);
  }
  const viewer = await readFile(path.join(output, report.outputs.viewer.path), 'utf8');
  assert.match(viewer, /Tapered-belly source · strict refusal has 2 fixed-contact blockers/);
  assert.match(viewer, /Contact admitted · occupancy attempted · residual remains/);
  assert.doesNotMatch(viewer, />Before packing</);
  assert.doesNotMatch(viewer, />Packing result</);
});

test('failed reused-root fixed-contact assay clears stale visuals and emits terminal report', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-current-k4-fixed-contact-stale-'));
  await Promise.all(STALE_VISUALS.map(relative => writeFile(path.join(output, relative), 'stale')));
  const failed = run(output, ['--occupancy-envelope', 'hidden-fallback']);
  assert.notEqual(failed.status, 0);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'parse-arguments');
  assert.equal(report.outputs, null);
  assert.equal(report.visual, null);
  for (const relative of STALE_VISUALS) {
    await assert.rejects(readFile(path.join(output, relative)), /ENOENT/);
  }
});
