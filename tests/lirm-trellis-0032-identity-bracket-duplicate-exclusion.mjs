import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const builder = new URL('../artifacts/lirm-trellis-0032-identity-bracket-v1/build-assay.mjs', import.meta.url);
const failurePath = new URL('../artifacts/lirm-trellis-0032-identity-bracket-v1/assembly-failure.json', import.meta.url);
const excludedDuplicateJobId = '7846c3d4b3a3';

rmSync(failurePath, { force: true });
const result = spawnSync(process.execPath, [builder.pathname], {
  encoding: 'utf8',
  env: { ...process.env, KAMINOS_0032_CFG2_LEFT_JOB_ID: excludedDuplicateJobId },
});

assert.notEqual(result.status, 0, 'builder must reject an explicitly excluded duplicate witness');
assert.ok(existsSync(failurePath), 'duplicate rejection must leave a durable phase report');
const failure = JSON.parse(readFileSync(failurePath, 'utf8'));
assert.equal(failure.schema, 'kaminos.visual-evidence-assembly-failure.v1');
assert.equal(failure.phase, 'route-evidence-admission');
assert.match(failure.error, /explicitly excluded duplicate witness/);
assert.match(failure.error, new RegExp(excludedDuplicateJobId));
assert.equal(failure.primaryArtifactWritten, false);

console.log('LIRM Trellis 0032 identity-bracket duplicate exclusion passed');
