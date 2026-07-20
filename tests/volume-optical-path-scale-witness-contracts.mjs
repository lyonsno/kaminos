import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const witnessPath = new URL('../volume-four-arm-held-state-witness.mjs', import.meta.url);
const witness = readFileSync(witnessPath, 'utf8');

for (const [label, contract] of [
  ['effective route', /assertRouteContract\(expectedUrl\.href, admitted\.href\)/],
  ['backend substitution', /capture\.route\.backend, 'WebGPU:apple'/],
  ['renderer fallback', /capture\.fallbackUsed, false/],
  ['partial or nonfinite capture', /finitePixelCount, capture\.width \* capture\.height/],
  ['same held state', /armB\.capture\.capturedSimStepCount, armA\.capture\.capturedSimStepCount/],
  ['same camera', /armB\.capture\.camera\.signature, armA\.capture\.camera\.signature/],
  ['same raw deposits', /armB\.capture\.depositionPayload\.sha256[^]*?armA\.capture\.depositionPayload\.sha256/],
  ['effective scale', /effectiveOpticalPathScale, Math\.fround\(arm\.requestedScale\)/],
  ['exact float artifact hash', /sha256\(linearHdrBytes\), captured\.capture\.hashes\.linearHdrSha256/],
  ['real Beauty canvas dispatch', /renderFrozenScaleToCanvas\(\{[^}]*boundarySplatComposition:\s*'splat-only-v0'/],
  ['post-render compositor settle', /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/],
  ['nonblank Beauty', /screenshotBytes\.length > 1000/],
  ['Beauty pixel difference', /armB\.screenshot\.sha256, armA\.screenshot\.sha256/],
  ['durable failure report', /failurePhase,[^]*?lastTrustworthyEvidence[^]*?writeFileSync\(reportPath/],
]) {
  assert.match(witness, contract, `witness is missing the ${label} false-closure gate`);
}

const output = mkdtempSync(join(tmpdir(), 'kaminos-optical-path-scale-rejection-'));
const reportPath = join(output, 'report.json');
const rejected = spawnSync(process.execPath, [
  witnessPath.pathname,
  '--route-receipt',
  new URL('../scratch/full-support-stage-a-18789/route-receipt.json', import.meta.url).pathname,
  '--report',
  reportPath,
  '--scale-a',
  '0',
], { cwd: root.pathname, encoding: 'utf8' });
assert.equal(rejected.status, 1, 'invalid optical path scale was accepted');
const failure = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(failure.status, 'failed', 'invalid scale did not write a durable failed report');
assert.equal(failure.failurePhase, 'input-admission', 'invalid scale failure phase was ambiguous');
assert.match(failure.error, /--scale-a must be finite and positive/, 'invalid scale failure reason was hidden');

console.log('volume optical path scale witness contracts: passed');
