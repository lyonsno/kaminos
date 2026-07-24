import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const outputRoot = await mkdtemp(resolve(tmpdir(), 'lirm-witness-spawn-failure-'));
try {
  const child = spawn(process.execPath, [
    new URL('../lirm-stationary-hill-contact-witness.mjs', import.meta.url).pathname,
    '--url', 'http://127.0.0.1:1/never',
    '--out-dir', outputRoot,
    '--chrome', resolve(outputRoot, 'missing-chrome'),
    '--debug-port', '19471',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const [code] = await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', (...args) => accept(args));
  });
  assert.notEqual(code, 0);
  const report = JSON.parse(await readFile(resolve(outputRoot, 'report.json'), 'utf8'));
  assert.equal(report.status, 'fail');
  assert.equal(report.failurePhase, 'browser-launch');
  assert.equal(report.error?.name, 'Error');
  assert.match(report.error?.message ?? '', /ENOENT|missing-chrome/);
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}

process.stdout.write('stationary Hill witness browser-launch failure contract passed\n');
