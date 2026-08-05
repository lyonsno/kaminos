import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(REPO_ROOT, 'tools/run-current-k4-occupancy-assay.mjs');
const ATLAS = path.join(
  REPO_ROOT,
  'artifacts/authored-muscle-coordinate-export-v0/dense-selectors/k4-current-graph/parent-atlas.json',
);
const IDS = ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45'];
const VISUAL_EVIDENCE_PATHS = [
  ...['baseline', 'mild', 'moderate'].flatMap(id => [
    `${id}-tapered-source.png`,
    `${id}-occupied-result.png`,
    `${id}-tapered-source-capture-report.json`,
    `${id}-occupied-result-capture-report.json`,
  ]),
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
    '--endpoint-radius-multiplier', '0.26',
    '--transition-fraction', '0.2',
    '--max-iterations', '2',
    ...extra,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
}

test('current-K4 occupancy assay emits identity-bound three-rung data and orbitable evidence', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-current-k4-occupancy-'));
  const completed = run(output);
  assert.equal(completed.status, 0, completed.stderr);

  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.schema, 'kaminos.current-k4-occupancy-assay-run-report.v0');
  assert.equal(report.status, 'completed');
  assert.deepEqual(report.requestedConstructionIds, IDS);
  assert.deepEqual(report.effectiveConstructionIds, IDS);
  assert.deepEqual(report.conditions.map(condition => condition.id), [
    'baseline',
    'mild',
    'moderate',
  ]);
  assert.deepEqual(report.visual.route, {
    requested: 'current-k4-occupancy-orbitable-v0',
    effective: 'current-k4-occupancy-orbitable-v0',
    fallbackUsed: false,
  });
  assert.equal(report.visual.status, 'pending-agent-inspection');

  for (const condition of report.conditions) {
    assert.equal(condition.parentPreflight.status, 'immutable-constraint-conflict');
    assert.equal(condition.parentPreflight.blockerCount, 4);
    assert.notEqual(condition.occupiedResult.status, 'immutable-constraint-conflict');
    assert.equal(condition.occupiedResult.packed.endpointDrift, 0);
    assert.ok(condition.occupiedResult.packed.maximumRelativeVolumeError <= 1e-9);
    assert.equal(condition.occupiedResult.packed.sourceTangentReversalCount, 0);
    assert.equal(condition.occupiedResult.packed.pairwiseRelationReversalCount, 0);
    for (const artifact of Object.values(condition.outputs)) {
      const bytes = await readFile(path.join(output, artifact.path));
      assert.equal(sha256(bytes), artifact.sha256);
    }
  }

  const portfolio = await readFile(path.join(output, report.visual.portfolio.path), 'utf8');
  assert.match(portfolio, /Tapered source/);
  assert.match(portfolio, /Occupied \+ locally relaxed result/);
  assert.doesNotMatch(portfolio, />Before packing</);
  assert.doesNotMatch(portfolio, />Packing result</);
});

test('failed reused-root occupancy assay clears stale visual evidence and fails loud', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-current-k4-occupancy-stale-'));
  await Promise.all(
    VISUAL_EVIDENCE_PATHS.map(relative => writeFile(path.join(output, relative), 'stale')),
  );

  const failed = run(output, ['--endpoint-radius-multiplier', 'not-finite']);
  assert.notEqual(failed.status, 0);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'parse-arguments');
  assert.equal(report.outputs, null);
  assert.equal(report.visual, null);
  for (const relative of VISUAL_EVIDENCE_PATHS) {
    await assert.rejects(
      readFile(path.join(output, relative)),
      /ENOENT/,
      `${relative} must not survive a failed reused-root assay`,
    );
  }
});
