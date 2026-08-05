import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const outputDir = await mkdtemp(join(tmpdir(), 'm31-witness-runner-'));
try {
  const result = spawnSync(process.execPath, [
    new URL('../tools/run-blender-m31-transfer-witness.mjs', import.meta.url).pathname,
    new URL('../artifacts/m31-generated-relation-positive-volume-transfer-v0/transfer.json',
      import.meta.url).pathname,
    outputDir,
  ], {
    encoding: 'utf8',
    env: { ...process.env, M31_WITNESS_BLENDER_BIN: '/usr/bin/true' },
  });
  assert.equal(result.status, 1,
    'a zero-exit Blender process without primary output must fail the runner');
  const receipt = JSON.parse(await readFile(join(outputDir, 'runner-receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.failurePhase, 'primary-output-validation');
  assert.equal(receipt.childExitCode, 0);
  assert.equal(receipt.primaryOutput, null);
} finally {
  await rm(outputDir, { recursive: true, force: true });
}

console.log('m31 transfer witness runner contracts passed');
