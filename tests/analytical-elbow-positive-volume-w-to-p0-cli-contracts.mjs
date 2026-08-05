import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAnalyticalElbowWToP0Cli } from
  '../analytical-elbow-positive-volume-w-to-p0.mjs';

const temporaryRoot = await mkdtemp(join(tmpdir(), 'w-to-p0-cli-'));
try {
  const outputPath = join(temporaryRoot, 'w-to-p0.json');
  const bundle = await runAnalyticalElbowWToP0Cli(['--output', outputPath]);
  assert.equal(bundle.status, 'complete');
  assert.equal(bundle.report.status, 'W_P0_ADMITTED');
  assert.deepEqual(bundle.execution, {
    requestedRoute: 'analytical-elbow-positive-volume-w-to-p0-cli',
    effectiveRoute: 'analytical-elbow-positive-volume-w-to-p0-cli',
    fallbackUsed: false,
    innerRequestedRoute: 'analytical-elbow-positive-volume-w-to-p0',
    innerEffectiveRoute: 'analytical-elbow-positive-volume-w-to-p0',
  });
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), bundle);

  const failurePath = join(temporaryRoot, 'failed.json');
  await assert.rejects(
    runAnalyticalElbowWToP0Cli(['--invented', '--output', failurePath]),
    /unknown W-to-P0 argument --invented/,
  );
  const failure = JSON.parse(await readFile(failurePath, 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'argument-parsing');
  assert.equal(failure.effectiveRoute, null);
  assert.equal(failure.primaryOutput, null);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log('analytical elbow positive-volume W-to-P0 CLI contracts passed');
