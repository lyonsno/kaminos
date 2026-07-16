import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const builder = new URL('../artifacts/lirm-trellis-0032-identity-bracket-v1/build-assay.mjs', import.meta.url);
const failurePath = new URL('../artifacts/lirm-trellis-0032-identity-bracket-v1/assembly-failure.json', import.meta.url);

rmSync(failurePath, { force: true });
const missingJobId = 'missing-cfg2-left-fixture';
const result = spawnSync(process.execPath, [builder.pathname], {
  encoding: 'utf8',
  env: { ...process.env, KAMINOS_0032_CFG2_LEFT_JOB_ID: missingJobId },
});

assert.notEqual(result.status, 0, 'builder must reject incomplete Greenroom evidence');
assert.ok(existsSync(failurePath), 'builder failure must leave a durable phase report');
const failure = JSON.parse(readFileSync(failurePath, 'utf8'));
assert.equal(failure.schema, 'kaminos.visual-evidence-assembly-failure.v1');
assert.equal(failure.phase, 'route-evidence-admission');
assert.match(failure.error, new RegExp(missingJobId));
assert.equal(failure.lastTrustworthyEvidence, 'CFG 1.00 generation and four admitted camera witnesses');
assert.equal(failure.primaryArtifactWritten, false);

console.log('LIRM Trellis 0032 identity-bracket failure reporting passed');
