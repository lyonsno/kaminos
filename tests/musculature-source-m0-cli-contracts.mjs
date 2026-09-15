import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const cli = new URL('../musculature-source-m0-validator.mjs', import.meta.url).pathname;
const fixture = new URL('../fixtures/track-m-musculature-source-m0.complete.v0.json', import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'kaminos-track-m-m0-'));

function run(input, output) {
  return spawnSync(process.execPath, [cli, '--input', input, '--output', output], {
    cwd: root.pathname,
    encoding: 'utf8',
  });
}

function runArgs(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root.pathname,
    encoding: 'utf8',
  });
}

const acceptedOutput = join(directory, 'accepted.json');
const accepted = run(fixture.pathname, acceptedOutput);
assert.equal(accepted.status, 0, accepted.stderr);
const acceptedReport = JSON.parse(await readFile(acceptedOutput, 'utf8'));
assert.equal(acceptedReport.schema, 'kaminos.musculature-source-m0-report.v0');
assert.equal(acceptedReport.status, 'validated');
assert.equal(acceptedReport.disposition, 'PASS_MUSCULATURE_SOURCE_ONLY');
assert.equal(acceptedReport.failurePhase, null);
assert.equal(acceptedReport.requestedInputPath, fixture.pathname);
assert.equal(acceptedReport.effectiveInputPath, fixture.pathname);
assert.equal(acceptedReport.requestedOutputPath, acceptedOutput);
assert.equal(acceptedReport.effectiveOutputPath, acceptedOutput);
assert.match(acceptedReport.lastTrustworthyEvidence.inputSha256, /^[0-9a-f]{64}$/);
assert.match(acceptedReport.lastTrustworthyEvidence.receiptSha256, /^[0-9a-f]{64}$/);
assert.equal(acceptedReport.lastTrustworthyEvidence.sourceId, 'synthetic-blender-source-v0');
assert.equal(acceptedReport.lastTrustworthyEvidence.controlId, 'synthetic-matched-control-v0');

const firstAcceptedReport = structuredClone(acceptedReport);
const rerun = run(fixture.pathname, acceptedOutput);
assert.equal(rerun.status, 0, rerun.stderr);
assert.deepEqual(
  JSON.parse(await readFile(acceptedOutput, 'utf8')),
  firstAcceptedReport,
  'rerunning the caller-parameterized validator must be idempotent',
);

const pendingInput = join(directory, 'pending.json');
const pendingOutput = join(directory, 'pending-report.json');
const pendingReceipt = JSON.parse(await readFile(fixture, 'utf8'));
pendingReceipt.evidence = { status: 'pending' };
pendingReceipt.measurementStation = { status: 'passed' };
pendingReceipt.cells = Array.from({ length: 6 }, (_, index) => ({ id: index, status: 'passed' }));
pendingReceipt.compilerCompatibility = { status: 'passed' };
await writeFile(pendingInput, `${JSON.stringify(pendingReceipt, null, 2)}\n`);
const pending = run(pendingInput, pendingOutput);
assert.equal(pending.status, 0, pending.stderr);
const pendingReport = JSON.parse(await readFile(pendingOutput, 'utf8'));
assert.equal(pendingReport.status, 'validated');
assert.equal(pendingReport.disposition, 'HOLD_MUSCULATURE_SOURCE_EVIDENCE');
assert.equal(pendingReport.validation.failures.length, 0);

const falseClosureInput = join(directory, 'false-closure.json');
const falseClosureOutput = join(directory, 'false-closure-report.json');
await writeFile(falseClosureInput, `${JSON.stringify({
  track: { id: 'relational', kind: 'generator-relational-sensitivity' },
  measurementStation: { status: 'passed' },
  cells: Array.from({ length: 6 }, (_, index) => ({ id: index, status: 'passed' })),
  compilerCompatibility: { status: 'passed' },
}, null, 2)}\n`);
const falseClosure = run(falseClosureInput, falseClosureOutput);
assert.notEqual(falseClosure.status, 0);
const falseClosureReport = JSON.parse(await readFile(falseClosureOutput, 'utf8'));
assert.equal(falseClosureReport.status, 'validated');
assert.equal(falseClosureReport.disposition, 'FAIL_MUSCULATURE_SOURCE');
assert.ok(falseClosureReport.validation.failures.some(failure => failure.code === 'musculature-track-scope-mismatch'));

const malformedInput = join(directory, 'malformed.json');
const malformedOutput = join(directory, 'malformed-report.json');
await writeFile(malformedInput, '{ broken-json');
const malformed = run(malformedInput, malformedOutput);
assert.notEqual(malformed.status, 0);
const malformedReport = JSON.parse(await readFile(malformedOutput, 'utf8'));
assert.equal(malformedReport.status, 'failed-to-validate');
assert.equal(malformedReport.disposition, null);
assert.equal(malformedReport.failurePhase, 'input-parse');
assert.match(malformedReport.lastTrustworthyEvidence.inputSha256, /^[0-9a-f]{64}$/);
assert.equal(malformedReport.validation, null);

const missingInput = join(directory, 'absent.json');
const missingOutput = join(directory, 'missing-report.json');
const missing = run(missingInput, missingOutput);
assert.notEqual(missing.status, 0);
const missingReport = JSON.parse(await readFile(missingOutput, 'utf8'));
assert.equal(missingReport.status, 'failed-to-validate');
assert.equal(missingReport.disposition, null);
assert.equal(missingReport.failurePhase, 'input-read');
assert.equal(missingReport.lastTrustworthyEvidence.inputSha256, null);
assert.equal(missingReport.validation, null);

const argumentOutput = join(directory, 'argument-report.json');
const argumentFailure = runArgs(['--output', argumentOutput, '--input']);
assert.notEqual(argumentFailure.status, 0);
const argumentReport = JSON.parse(await readFile(argumentOutput, 'utf8'));
assert.equal(argumentReport.status, 'failed-to-validate');
assert.equal(argumentReport.disposition, null);
assert.equal(argumentReport.failurePhase, 'argument-parse');
assert.equal(argumentReport.requestedInputPath, null);
assert.equal(argumentReport.effectiveInputPath, null);
assert.equal(argumentReport.requestedOutputPath, argumentOutput);
assert.equal(argumentReport.effectiveOutputPath, argumentOutput);

process.stdout.write('musculature source M0 CLI contracts passed\n');
