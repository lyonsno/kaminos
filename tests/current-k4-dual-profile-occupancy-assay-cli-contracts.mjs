import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(REPO_ROOT, 'tools/run-current-k4-dual-profile-occupancy-assay.mjs');
const ATLAS = path.join(
  REPO_ROOT,
  'artifacts/authored-muscle-coordinate-export-v0/dense-selectors/k4-current-graph/parent-atlas.json',
);
const IDS = ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45'];
const LEVELS = ['baseline', 'mild', 'moderate'];
const PROFILES = ['source-candidate-radius-tubes', 'volume-preserving-tapered-belly.v0'];
const STALE_VISUALS = [
  'index.html',
  'visual-inspection.json',
  'interpretation.md',
  ...LEVELS.flatMap(level => PROFILES.flatMap(profile => [
    `${level}-${profile}-source.png`,
    `${level}-${profile}-result.png`,
    `${level}-${profile}-source-capture-report.json`,
    `${level}-${profile}-result-capture-report.json`,
  ])),
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

test('dual-profile K4 assay holds identity and environment while exposing tube refusal versus belly occupancy', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-current-k4-dual-profile-'));
  const completed = run(output);
  assert.equal(completed.status, 0, completed.stderr);

  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.schema, 'kaminos.current-k4-dual-profile-occupancy-assay-run-report.v0');
  assert.equal(report.status, 'completed');
  assert.deepEqual(report.requestedConstructionIds, IDS);
  assert.deepEqual(report.effectiveConstructionIds, IDS);
  assert.equal(report.requestedOccupancyEnvelope, 'normalized-sine');
  assert.deepEqual(report.profileOrder, PROFILES);
  assert.deepEqual(report.conditions.map(condition => condition.id), LEVELS);
  assert.deepEqual(report.visual.route, {
    requested: 'current-k4-dual-profile-occupancy-orbitable-v0',
    effective: 'current-k4-dual-profile-occupancy-orbitable-v0',
    fallbackUsed: false,
  });
  assert.equal(report.visual.status, 'pending-agent-inspection');

  for (const condition of report.conditions) {
    const tube = condition.profiles['source-candidate-radius-tubes'];
    const belly = condition.profiles['volume-preserving-tapered-belly.v0'];
    assert.equal(tube.source.shapeProfile, null);
    assert.equal(tube.result.status, 'immutable-constraint-conflict');
    assert.equal(tube.result.failurePhase, 'preflight');
    assert.equal(tube.result.blockerCount, 4);
    assert.equal(tube.result.sourceGeometryPreservedExactly, true);
    assert.equal(tube.result.occupancyProjectionApplied, false);
    assert.equal(belly.source.shapeProfile.effective.id, 'volume-preserving-tapered-belly.v0');
    assert.equal(belly.result.status, 'immutable-constraint-conflict');
    assert.equal(belly.result.failurePhase, 'preflight');
    assert.equal(belly.result.blockerCount, 2);
    assert.equal(belly.result.sourceGeometryPreservedExactly, true);
    assert.equal(belly.result.endpointDrift, 0);
    assert.ok(belly.result.maximumRelativeVolumeError <= 1e-9);
    assert.equal(belly.result.sourceTangentReversalCount, 0);
    assert.equal(belly.result.pairwiseRelationReversalCount, 0);
    assert.equal(belly.result.occupancyProjectionApplied, false);
    assert.equal(belly.result.requestedEnvelopeProfile, 'normalized-sine');
    assert.equal(belly.result.effectiveEnvelopeProfile, 'normalized-sine');
    assert.deepEqual(tube.source.effectiveConstructionIds, belly.source.effectiveConstructionIds);
    assert.equal(tube.source.parentAtlasFileSha256, belly.source.parentAtlasFileSha256);
    assert.deepEqual(tube.source.environment, belly.source.environment);
    assert.ok(
      Math.max(...belly.result.blockingMechanisms.map(blocker => blocker.penetration)) <
        Math.max(...tube.result.blockingMechanisms.map(blocker => blocker.penetration)) * 0.14,
      'the exact belly profile must materially reduce the fixed-attachment blocker even when it does not clear it',
    );
    for (const profile of Object.values(condition.profiles)) {
      assert.equal(profile.visibility.requestedMemberCount, 4);
      assert.equal(profile.visibility.effectiveSourceMemberCount, 4);
      assert.equal(profile.visibility.effectiveResultMemberCount, 4);
      assert.deepEqual(profile.visibility.missingSourceMembers, []);
      assert.deepEqual(profile.visibility.missingResultMembers, []);
      for (const artifact of Object.values(profile.outputs)) {
        const bytes = await readFile(path.join(output, artifact.path));
        assert.equal(sha256(bytes), artifact.sha256);
      }
    }
  }

  const portfolio = await readFile(path.join(output, report.visual.portfolio.path), 'utf8');
  assert.match(portfolio, /Unchanged source-candidate-radius tube/);
  assert.match(portfolio, /Immutable refusal · source preserved/);
  assert.match(portfolio, /Volume-preserving tapered-belly input/);
  assert.match(portfolio, /Immutable refusal · tapered belly preserved/);
  assert.doesNotMatch(portfolio, />Before packing</);
  assert.doesNotMatch(portfolio, />Packing result</);
});

test('failed reused-root dual-profile assay clears stale visual evidence and writes a failure report', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-current-k4-dual-profile-stale-'));
  await Promise.all(STALE_VISUALS.map(relative => writeFile(path.join(output, relative), 'stale')));

  const failed = run(output, ['--occupancy-envelope', 'implicit-fallback']);
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
