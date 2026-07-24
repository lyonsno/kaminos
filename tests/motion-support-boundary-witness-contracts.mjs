#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), 'kaminos-motion-support-witness-'));
const witness = new URL('../motion-support-boundary-witness.mjs', import.meta.url);

function run(name, extra = []) {
  const output = join(temporary, `${name}.json`);
  const result = spawnSync(
    process.execPath,
    [witness.pathname, '--output', output, ...extra],
    { cwd: root.pathname, encoding: 'utf8' },
  );
  return { output, result };
}

const positive = run('positive');
assert.equal(positive.result.status, 0, positive.result.stderr);
const positiveReport = JSON.parse(await readFile(positive.output, 'utf8'));
assert.equal(positiveReport.schema, 'kaminos.motion-support-boundary-witness-report.v0');
assert.equal(positiveReport.status, 'pass');
assert.equal(positiveReport.failurePhase, null);
assert.equal(positiveReport.effective.supportSurface.revision, '81c5348');
assert.equal(positiveReport.evidence.stationaryPrepass.schema, 'kaminos.motion-support-prepass.v0');
assert.equal(positiveReport.evidence.shortRail.prepassCount, 5);
assert.ok(
  positiveReport.evidence.shortRail.plannerDispositions.every(value => value === 'local-support'),
  'the positive short rail must remain inside locally supportable terrain',
);
assert.equal(
  positiveReport.evidence.contactConstraints.schema,
  'kaminos.motion-contact-constraints.v0',
);

const stale = run('stale-source', ['--expected-surface-revision', 'definitely-stale']);
assert.notEqual(stale.result.status, 0, 'stale source witness must fail');
const staleReport = JSON.parse(await readFile(stale.output, 'utf8'));
assert.equal(staleReport.status, 'fail');
assert.equal(staleReport.failurePhase, 'support-prepass');
assert.match(staleReport.error.message, /support surface revision mismatch/);
assert.equal(staleReport.requested.expectedSurfaceRevision, 'definitely-stale');
assert.equal(staleReport.effective.supportSurface.revision, '81c5348');

const partial = run('partial-probes', ['--probe-mode', 'missing-last']);
assert.notEqual(partial.result.status, 0, 'partial probe witness must fail');
const partialReport = JSON.parse(await readFile(partial.output, 'utf8'));
assert.equal(partialReport.status, 'fail');
assert.equal(partialReport.failurePhase, 'contact-resolution');
assert.match(partialReport.error.message, /exactly the requested patches/);
assert.equal(partialReport.requested.probeMode, 'missing-last');
assert.equal(partialReport.effective.probeMode, 'missing-last');

const malformedArguments = run('malformed-arguments', ['--probe-mode', 'bogus']);
assert.notEqual(malformedArguments.result.status, 0, 'malformed witness arguments must fail');
const malformedArgumentsReport = JSON.parse(await readFile(malformedArguments.output, 'utf8'));
assert.equal(malformedArgumentsReport.status, 'fail');
assert.equal(malformedArgumentsReport.failurePhase, 'argument-parse');
assert.equal(malformedArgumentsReport.requested.probeMode, 'bogus');
assert.equal(malformedArgumentsReport.effective.probeMode, null);
assert.match(
  malformedArgumentsReport.error.message,
  /probe mode must be complete or missing-last/,
);

console.log('motion support boundary witness contracts passed');
