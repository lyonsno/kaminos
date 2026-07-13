import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const witnessUrl = new URL('../scripts/smoke-splat-slot-witness.mjs', import.meta.url);
const witnessSource = await readFile(witnessUrl, 'utf8').catch(() => '');

assert.match(
  witnessSource,
  /writeFile\(outputPath/,
  'smoke-slot witness writes its report directly to a caller-owned path',
);

const directory = await mkdtemp(join(tmpdir(), 'kaminos-smoke-slot-witness-'));

function runWitness(name, extraArgs = []) {
  const outputPath = join(directory, `${name}.json`);
  const result = spawnSync(process.execPath, [witnessUrl.pathname, '--out', outputPath, ...extraArgs], {
    encoding: 'utf8',
  });
  return { ...result, outputPath };
}

const baseline = runWitness('baseline');
assert.equal(baseline.status, 0, baseline.stderr);
const baselineReport = JSON.parse(await readFile(baseline.outputPath, 'utf8'));
assert.ok(Buffer.byteLength(await readFile(baseline.outputPath, 'utf8')) < 50_000, 'witness report summarizes bindings instead of dumping repeated instance rows');
assert.equal(baselineReport.status, 'passed');
assert.equal(baselineReport.requestedRoute, 'pure-module-reference-smoke-slot-witness-v0');
assert.equal(baselineReport.effectiveRoute, 'pure-module-reference-smoke-slot-witness-v0');
assert.equal(baselineReport.evidenceScope, 'scheduling-cache-hierarchy-accounting-no-gpu-render');
assert.equal(baselineReport.firstResolve.instanceCount, 100);
assert.equal(baselineReport.firstResolve.uniqueSlotCount, 4);
assert.deepEqual(baselineReport.requestedConfig.historySlots, [1, 2, 3, 0]);
assert.equal(baselineReport.firstResolve.decodeCount, 4);
assert.equal(baselineReport.warmResolve.decodeCount, 0);
assert.equal(baselineReport.warmResolve.cacheHitCount, 4);
assert.equal(baselineReport.slotReuseResolve.decodeCount, 1);
assert.equal(baselineReport.assertions.every(assertion => assertion.passed), true);

const overflow = runWitness('overflow', ['--capacity', '2']);
assert.equal(overflow.status, 0, overflow.stderr);
const overflowReport = JSON.parse(await readFile(overflow.outputPath, 'utf8'));
assert.equal(overflowReport.status, 'passed');
assert.ok(overflowReport.firstResolve.diagnostics.some(item => item.code === 'smoke-splat-capacity-overflow'));
assert.equal(overflowReport.firstResolve.slotProducts.every(product => product.capacity.outputWasTruncated === false), true);

const missingPayload = runWitness('missing-payload', ['--omit-slot', '3']);
assert.notEqual(missingPayload.status, 0, 'missing historical payload must fail the witness');
const failureReport = JSON.parse(await readFile(missingPayload.outputPath, 'utf8'));
assert.equal(failureReport.status, 'failed');
assert.equal(failureReport.failurePhase, 'phase-payload-resolution');
assert.equal(failureReport.lastTrustworthyEvidence.requestedRoute, 'pure-module-reference-smoke-slot-witness-v0');
assert.equal(failureReport.lastTrustworthyEvidence.omittedHistorySlot, 3);
assert.equal(failureReport.effectiveRoute, null);

console.log('smoke splat slot witness contracts passed');
