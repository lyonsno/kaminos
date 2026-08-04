import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCollarAssayCli } from '../analytical-elbow-collar-assay.mjs';

const directory = await mkdtemp(join(tmpdir(), 'kaminos-collar-assay-'));
const completePath = join(directory, 'complete.json');
const report = await runCollarAssayCli([
  '--output', completePath,
  '--collar-half-widths', '0,0.24,0.48,0.72',
]);
assert.equal(report.status, 'complete');
assert.deepEqual(
  JSON.parse(await readFile(completePath, 'utf8')),
  report,
);

const failedPath = join(directory, 'failed.json');
await assert.rejects(
  runCollarAssayCli([
    '--output', failedPath,
    '--collar-half-widths', '0,not-a-number',
  ]),
  /collar half-width must be finite and nonnegative/,
);
const failure = JSON.parse(await readFile(failedPath, 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'assay-execution');
assert.equal(failure.effectiveRoute, null);
assert.match(failure.error, /finite and nonnegative/);

console.log('analytical elbow collar assay CLI contracts passed');
