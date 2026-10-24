// kaminos-test: node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = await mkdtemp(join(tmpdir(), 'sam31-controls-'));
try {
  const checkpoint = join(directory, 'bad.pt'), output = join(directory, 'output');
  await writeFile(checkpoint, 'not an official checkpoint');
  const run = spawnSync('python3', [fileURLToPath(new URL('../tools/sam31-stream-controls.py', import.meta.url)), '--checkpoint', checkpoint, '--out', output],
    { encoding: 'utf8', env: { ...process.env, EPISTAXIS_JOB_PRIMARY_OUTPUT: join(directory, 'primary.json') } });
  assert.ifError(run.error);
  assert.notEqual(run.status, 0);
  const report = JSON.parse(await readFile(join(output, 'controls.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.phase, 'checkpoint-hash');
  assert.match(report.error, /checkpoint SHA mismatch/);
  assert.deepEqual(report.controls, {});
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'primary.json'), 'utf8')), report);
  console.log('SAM3.1 control extraction rejects an unauthenticated checkpoint with a durable failure');
} finally { await rm(directory, { recursive: true, force: true }); }
