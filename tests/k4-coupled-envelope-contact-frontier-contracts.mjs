import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  measureMuscleCompartmentRingCageContactState,
  solveMuscleCompartmentRingCageContact,
} from '../muscle-compartment-ring-cage-contact-core.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(
  REPO_ROOT,
  'tools/run-k4-coupled-envelope-contact-frontier.mjs',
);
const RECEIPT = path.join(
  REPO_ROOT,
  'artifacts/source-shaped-k4-envelope-frame-binding-v0/receipt.json',
);
const ENVELOPE = path.join(
  REPO_ROOT,
  'artifacts/source-shaped-k4-envelope-frame-binding-visual-v0/envelope-baseline.glb',
);
const ATTRIBUTION = path.join(
  REPO_ROOT,
  'artifacts/k4-source-route-containment-v0/result.json',
);
const CARRIER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/packed-carrier.json',
);
const SOURCE = path.join(
  REPO_ROOT,
  'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
);
const SOLVER_CONFIG = Object.freeze({
  convergenceTolerance: 0.0001,
  curvatureRegularization: 12,
  maxIterations: 2,
  maximumLocalTurningAngleChange: 0.25,
  maximumRelativeVolumeError: 0.015,
  maximumTotalTurningAngleChange: 1.25,
  relaxationStep: 0.32,
});

test('the solver records step-constraint rejections without weakening other gates', async () => {
  const solverCarrier = JSON.parse(await readFile(CARRIER, 'utf8'));
  const source = JSON.parse(await readFile(SOURCE, 'utf8'));
  const rejectEverything = () => 'always-violated';
  const solve = solveMuscleCompartmentRingCageContact(
    solverCarrier, source, SOLVER_CONFIG, { stepConstraint: rejectEverything },
  );
  assert.equal(solve.iterations, 0);
  assert.equal(solve.termination.reason, 'line-search-exhausted');
  assert.ok(solve.termination.lineSearchAttempts.some(attempt =>
    attempt.rejectionReasons.includes('step-constraint:always-violated')));
  // Identity: constrained zero-iteration solve leaves the carrier unchanged.
  assert.equal(solve.packedCarrier.identity.sha256, solverCarrier.identity.sha256);
  // Unknown option keys refuse loudly.
  assert.throws(() => solveMuscleCompartmentRingCageContact(
    solverCarrier, source, SOLVER_CONFIG, { unknown: true },
  ), /stepConstraint/);
});

test('the coupled frontier reports endpoints and middle states without selection', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-coupled-'));
  const result = spawnSync(process.execPath, [
    TOOL,
    '--frame-receipt', RECEIPT,
    '--envelope', ENVELOPE,
    '--attribution', ATTRIBUTION,
    '--carrier', CARRIER,
    '--source', SOURCE,
    '--blends', '0.35,0.7',
    '--solver-iterations', '2',
    '--output', output,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const frontier = JSON.parse(
    await readFile(path.join(output, 'frontier-result.json'), 'utf8'),
  );
  assert.equal(frontier.status, 'completed-provisional');
  // Both exact endpoints plus one row per requested blend.
  const ids = frontier.states.map(row => row.id);
  assert.ok(ids.includes('endpoint-collision-relieved'));
  assert.ok(ids.includes('endpoint-contained-rollback'));
  assert.ok(ids.includes('blend-035-solved'));
  assert.ok(ids.includes('blend-070-solved'));
  for (const row of frontier.states) {
    assert.ok(Number.isFinite(row.metrics.s8AxisSignedDistance));
    assert.ok(Number.isFinite(row.metrics.pairwiseMovableTotalPenetration));
    assert.ok(Number.isFinite(row.metrics.skeletalTotalPenetration));
    assert.ok(['endpoint', 'candidate'].includes(row.role));
  }
  // No selection: the result names nondominated ids only, never a winner.
  assert.ok(Array.isArray(frontier.nondominatedStateIds));
  assert.ok(!('selectedStateId' in frontier));
  const solved = frontier.states.find(row => row.id === 'blend-035-solved');
  assert.ok(solved.solve.termination);
  assert.equal(solved.solve.stepConstraint, 's8-envelope-signed-distance-must-not-increase');
});
