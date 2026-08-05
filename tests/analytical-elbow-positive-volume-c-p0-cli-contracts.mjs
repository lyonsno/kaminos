import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runAnalyticalElbowCP0Cli } from
  '../analytical-elbow-positive-volume-c-p0.mjs';

const directory = await mkdtemp(join(tmpdir(), 'analytical-elbow-c-p0-'));
try {
  const output = join(directory, 'receipt.json');
  const bundle = await runAnalyticalElbowCP0Cli(['--output', output]);
  assert.equal(bundle.report.status, 'C_P0_COMPLETE');
  assert.equal(bundle.report.controlComparison.status, 'NUMERICAL_CANDIDATE');
  assert.deepEqual(bundle.execution, {
    requestedRoute: 'analytical-elbow-positive-volume-c-p0-cli',
    effectiveRoute: 'analytical-elbow-positive-volume-c-p0-cli',
    fallbackUsed: false,
    innerRequestedRoute: 'analytical-elbow-positive-volume-c-p0',
    innerEffectiveRoute: 'analytical-elbow-positive-volume-c-p0',
  });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), bundle);

  const failedOutput = join(directory, 'failed.json');
  await assert.rejects(
    runAnalyticalElbowCP0Cli(['--output', failedOutput, '--invented']),
    /unknown C\(P0\) argument/,
  );
  const failed = JSON.parse(await readFile(failedOutput, 'utf8'));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failurePhase, 'argument-parsing');
  assert.equal(failed.primaryOutput, null);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('analytical elbow positive-volume C(P0) CLI contracts passed');
