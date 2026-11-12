// kaminos-test: node
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = await mkdtemp(join(tmpdir(), 'sam31-reporting-'));
try {
  const model = fileURLToPath(new URL('../tools/sam31-stream-model.mjs', import.meta.url));
  const controls = fileURLToPath(new URL('../tools/sam31-stream-controls.py', import.meta.url));
  for (const kind of ['model', 'controls']) {
    const output = join(directory, `${kind}-blocked`), primary = join(directory, `${kind}-primary.json`);
    if (kind === 'model') await mkdir(output); else await writeFile(output, 'retained file');
    const run = spawnSync(kind === 'model' ? process.execPath : 'python3', kind === 'model'
      ? [model, '--model', 'unused', '--controls', 'unused', '--out', output]
      : [controls, '--checkpoint', 'unused', '--out', output],
    { encoding: 'utf8', env: { ...process.env, EPISTAXIS_JOB_PRIMARY_OUTPUT: primary } });
    assert.ifError(run.error); assert.notEqual(run.status, 0);
    const report = JSON.parse(await readFile(primary, 'utf8'));
    assert.equal(report.status, 'failed'); assert.equal(report.phase, 'output-initialization');
    if (kind === 'controls') assert.equal(await readFile(output, 'utf8'), 'retained file');
  }
  const output = join(directory, 'controls-local-report-blocked'), primary = join(directory, 'independent.json');
  await mkdir(output); await mkdir(join(output, 'controls.json'));
  const checkpoint = join(directory, 'bad.pt'); await writeFile(checkpoint, 'bad checkpoint');
  const run = spawnSync('python3', [controls, '--checkpoint', checkpoint, '--out', output],
    { encoding: 'utf8', env: { ...process.env, EPISTAXIS_JOB_PRIMARY_OUTPUT: primary } });
  assert.ifError(run.error); assert.notEqual(run.status, 0);
  const report = JSON.parse(await readFile(primary, 'utf8'));
  assert.equal(report.status, 'failed'); assert.equal(report.phase, 'checkpoint-hash');
  assert.ok(report.outputReportError);
  console.log('SAM preparation reports survive blocked setup and blocked local-report writes without replacing retained output');
} finally { await rm(directory, { recursive: true, force: true }); }
