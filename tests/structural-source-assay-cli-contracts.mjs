import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const fixturePath = new URL('../fixtures/phase-three-hip-cup-source-assay.v0.json', import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'kaminos-structural-source-'));
const validOutput = join(directory, 'valid-manifest.json');

function run(input, output) {
  return spawnSync(process.execPath, [
    new URL('../structural-source-assay-manifest.mjs', import.meta.url).pathname,
    '--input', input,
    '--output', output,
  ], {
    cwd: root.pathname,
    encoding: 'utf8',
  });
}

function runArgs(args) {
  return spawnSync(process.execPath, [
    new URL('../structural-source-assay-manifest.mjs', import.meta.url).pathname,
    ...args,
  ], {
    cwd: root.pathname,
    encoding: 'utf8',
  });
}

const first = run(fixturePath.pathname, validOutput);
assert.equal(first.status, 0, first.stderr);
const firstManifest = JSON.parse(await readFile(validOutput, 'utf8'));
assert.equal(firstManifest.schema, 'kaminos.structural-generation-manifest.v0');
assert.equal(firstManifest.status, 'awaiting-generation');
assert.equal(firstManifest.requestedRouteId, 'frozen-image-generation-route');
assert.equal(firstManifest.effectiveRouteId, null);
assert.equal(firstManifest.jobs.length, 6);
assert.equal(firstManifest.compilerInput.schema, 'kaminos.asset-arrival-source.v0');
assert.equal(firstManifest.projectionPlan.schema, 'kaminos.asset-arrival-projection-plan.v0');
assert.equal(firstManifest.projectionPlan.cells.length, 6);
assert.equal(firstManifest.outcomeContract.reportSchema, 'kaminos.asset-arrival-projection-report.v0');
assert.equal(firstManifest.outcomeContract.failureSchema, 'kaminos.asset-arrival-projection-failure.v0');
assert.ok(firstManifest.jobs.every(job => job.effectiveRouteId === null));
assert.ok(firstManifest.jobs.every(job => job.productConfigHash === null));
assert.ok(firstManifest.jobs.every(job => job.publicationId === null));
assert.ok(firstManifest.jobs.every(job => job.outputHash === null));
assert.equal(firstManifest.execution.requestedInputPath, fixturePath.pathname);
assert.equal(firstManifest.execution.effectiveInputPath, fixturePath.pathname);
assert.equal(firstManifest.execution.requestedOutputPath, validOutput);
assert.equal(firstManifest.execution.effectiveOutputPath, validOutput);
assert.match(firstManifest.execution.inputHash, /^[0-9a-f]{64}$/);

const second = run(fixturePath.pathname, validOutput);
assert.equal(second.status, 0, second.stderr);
const secondManifest = JSON.parse(await readFile(validOutput, 'utf8'));
assert.deepEqual(secondManifest, firstManifest, 'rerunning the CLI must be idempotent');

const invalidInput = join(directory, 'invalid.json');
const invalidOutput = join(directory, 'invalid-report.json');
const invalidAssay = JSON.parse(await readFile(fixturePath, 'utf8'));
invalidAssay.cells = invalidAssay.cells.slice(0, -1);
await writeFile(invalidInput, `${JSON.stringify(invalidAssay, null, 2)}\n`);

const invalid = run(invalidInput, invalidOutput);
assert.notEqual(invalid.status, 0, 'invalid source must fail the command');
const failureReport = JSON.parse(await readFile(invalidOutput, 'utf8'));
assert.equal(failureReport.schema, 'kaminos.structural-source-manifest-report.v0');
assert.equal(failureReport.status, 'failed');
assert.equal(failureReport.failurePhase, 'source-validation');
assert.equal(failureReport.requestedInputPath, invalidInput);
assert.equal(failureReport.requestedOutputPath, invalidOutput);
assert.match(failureReport.lastTrustworthyEvidence.inputHash, /^[0-9a-f]{64}$/);
assert.ok(failureReport.validation.failures.some(failure => failure.code === 'cell-matrix-incomplete'));
assert.equal(failureReport.manifest, null, 'failed validation cannot masquerade as a manifest');

const malformedInput = join(directory, 'malformed.json');
const malformedOutput = join(directory, 'malformed-report.json');
await writeFile(malformedInput, '{ definitely-not-json');
const malformed = run(malformedInput, malformedOutput);
assert.notEqual(malformed.status, 0, 'malformed input must fail the command');
const malformedReport = JSON.parse(await readFile(malformedOutput, 'utf8'));
assert.equal(malformedReport.status, 'failed');
assert.equal(malformedReport.failurePhase, 'input-parse');
assert.match(malformedReport.lastTrustworthyEvidence.inputHash, /^[0-9a-f]{64}$/);
assert.equal(malformedReport.validation, null);
assert.equal(malformedReport.manifest, null);

const missingInput = join(directory, 'absent.json');
const missingOutput = join(directory, 'absent-report.json');
const missing = run(missingInput, missingOutput);
assert.notEqual(missing.status, 0, 'missing input must fail the command');
const missingReport = JSON.parse(await readFile(missingOutput, 'utf8'));
assert.equal(missingReport.status, 'failed');
assert.equal(missingReport.failurePhase, 'input-read');
assert.equal(missingReport.lastTrustworthyEvidence.inputHash, null);
assert.equal(missingReport.validation, null);
assert.equal(missingReport.manifest, null);

const argumentOutput = join(directory, 'argument-report.json');
const argumentFailure = runArgs(['--output', argumentOutput, '--input']);
assert.notEqual(argumentFailure.status, 0, 'malformed arguments must fail the command');
const argumentReport = JSON.parse(await readFile(argumentOutput, 'utf8'));
assert.equal(argumentReport.status, 'failed');
assert.equal(argumentReport.failurePhase, 'argument-parse');
assert.equal(argumentReport.requestedInputPath, null);
assert.equal(argumentReport.requestedOutputPath, argumentOutput);
assert.equal(argumentReport.effectiveInputPath, null);
assert.equal(argumentReport.effectiveOutputPath, argumentOutput);
assert.equal(argumentReport.lastTrustworthyEvidence.inputHash, null);
assert.equal(argumentReport.validation, null);
assert.equal(argumentReport.manifest, null);
