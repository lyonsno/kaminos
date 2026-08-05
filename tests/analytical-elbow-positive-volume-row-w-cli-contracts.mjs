import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runAnalyticalElbowRowWCli } from
  '../analytical-elbow-positive-volume-row-w.mjs';

function containsNegativeZero(value) {
  if (Object.is(value, -0)) return true;
  if (Array.isArray(value)) return value.some(containsNegativeZero);
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsNegativeZero);
  }
  return false;
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'row-w-cli-'));
try {
  const outputPath = join(temporaryRoot, 'row-w.json');
  const bundle = await runAnalyticalElbowRowWCli(['--output', outputPath]);
  assert.equal(bundle.status, 'complete');
  assert.equal(bundle.report.status, 'W_VALID');
  assert.deepEqual(bundle.execution, {
    requestedRoute: 'analytical-elbow-positive-volume-row-w-cli',
    effectiveRoute: 'analytical-elbow-positive-volume-row-w-cli',
    fallbackUsed: false,
    innerRequestedRoute: 'analytical-elbow-positive-volume-row-w',
    innerEffectiveRoute: 'analytical-elbow-positive-volume-row-w',
  });
  assert.equal(containsNegativeZero(bundle), false);
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), bundle);

  const failurePath = join(temporaryRoot, 'failed.json');
  await assert.rejects(
    runAnalyticalElbowRowWCli(['--invented', '--output', failurePath]),
    /unknown Row W argument --invented/,
  );
  const failure = JSON.parse(await readFile(failurePath, 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'argument-parsing');
  assert.equal(failure.effectiveRoute, null);
  assert.equal(failure.primaryOutput, null);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log('analytical elbow positive-volume Row W CLI contracts passed');
