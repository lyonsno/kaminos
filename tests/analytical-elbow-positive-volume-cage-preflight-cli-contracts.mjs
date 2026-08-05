import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runAnalyticalElbowCagePreflightCli } from
  '../analytical-elbow-positive-volume-cage-preflight.mjs';

const temporaryRoot = await mkdtemp(join(tmpdir(), 'cage-preflight-cli-'));
try {
  const rowSPath = join(temporaryRoot, 'row-s.json');
  const rowS = await runAnalyticalElbowCagePreflightCli([
    '--case', 'row-s', '--output', rowSPath,
  ]);
  assert.equal(rowS.status, 'complete');
  assert.equal(rowS.report.status, 'failed');
  assert.equal(rowS.report.error.code, 'constraint-conflict');
  assert.deepEqual(rowS.execution, {
    requestedRoute: 'analytical-elbow-positive-volume-cage-preflight',
    effectiveRoute: 'analytical-elbow-positive-volume-cage-preflight',
    fallbackUsed: false,
    innerRequestedRoute: 'positive-volume-cage-preflight',
    innerEffectiveRoute: 'positive-volume-cage-preflight',
  });
  assert.deepEqual(JSON.parse(await readFile(rowSPath, 'utf8')), rowS);

  const nonRingPath = join(temporaryRoot, 'non-ring.json');
  const nonRing = await runAnalyticalElbowCagePreflightCli([
    '--case', 'asymmetric-non-ring', '--output', nonRingPath,
  ]);
  assert.equal(nonRing.status, 'complete');
  assert.equal(nonRing.report.status, 'admitted');
  assert.equal(nonRing.manifest.fixture.ringIndexingUsed, false);
  assert.equal(
    nonRing.execution.effectiveRoute,
    'analytical-elbow-positive-volume-cage-preflight',
  );

  const failurePath = join(temporaryRoot, 'failed.json');
  await assert.rejects(
    runAnalyticalElbowCagePreflightCli([
      '--case', 'invented', '--output', failurePath,
    ]),
    /unknown cage preflight case invented/,
  );
  const failure = JSON.parse(await readFile(failurePath, 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'argument-parsing');
  assert.equal(failure.effectiveRoute, null);
  assert.equal(failure.primaryOutput, null);
  assert.match(failure.error, /unknown cage preflight case invented/);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log('analytical elbow positive-volume cage preflight CLI contracts passed');
