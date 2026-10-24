import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { readRawEvidence } from './witness-raw.mjs';

test('missing native generation writes a failure report before any browser launch', () => {
  const root = path.resolve(import.meta.dirname, '../..'), out = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-application-invalid-'));
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const child = spawnSync(process.execPath, [path.join(root, 'demos/material-photo/examples-witness.mjs'),
    '--repo-root', root, '--expected-commit', revision, '--chrome', '/not-a-browser',
    '--playwright-module', '/not-a-module', '--url', 'http://127.0.0.1:1/', '--output', out, '--application'], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json')));
  assert.equal(report.status, 'failed');
  assert.equal(report.phase, 'arguments');
  assert.match(report.error, /--application requires fresh --generate/);
  assert.equal(report.browser, undefined);
});

test('geometry arrays are retained completely, with the real typed layout', async () => {
  for (const name of ['depth', 'normals', 'points', 'colors']) {
    const data = new Float32Array(name === 'depth' ? [1, 2] : [1, 2, 3, 4, 5, 6]);
    const source = { geometry: { width: 2, height: 1, [name]: data } };
    const evaluate = async expression => Function('source', `return ${expression}`)(source);
    const raw = await readRawEvidence(evaluate, `geometry-${name}`, 'source');
    assert.equal(raw.type, 'Float32Array');
    assert.deepEqual(raw.bytes, Buffer.from(data.buffer));
  }
});

test('lifecycle evidence refuses false cancellation, stale output and absent rendering', async () => {
  const file = new URL('./application-witness.mjs', import.meta.url);
  assert.ok(fs.existsSync(file), 'real photograph application witness must exist');
  const { validateCancellation, validateRetry } = await import(file.href);
  const good = { stage: 'geometry', paused: { status: 'paused' }, frames: 2,
    terminal: { status: 'rejected', name: 'AbortError' }, displayedBefore: 'material-1', displayedAfter: 'material-1',
    operation: { stage: null, phase: null }, model: { loaded: true, phase: 'idle', error: null } };
  validateCancellation(good);
  for (const patch of [{ terminal: { status: 'resolved' } }, { paused: null }, { frames: 0 },
    { displayedAfter: 'replaced' }, { displayedBefore: null, displayedAfter: null },
    { model: { loaded: true, phase: 'finishing' } }, { operation: { stage: 'geometry' } }]) {
    assert.throws(() => validateCancellation({ ...good, ...patch }));
  }
  const baseline = { width: 2, height: 1, type: 'Float32Array', bytes: Buffer.from([1, 2, 3, 4]) };
  validateRetry(baseline, baseline);
  for (const patch of [{ width: 1 }, { type: 'Uint8Array' }, { bytes: Buffer.from([0, 2, 3, 4]) }, { bytes: Buffer.alloc(0) }]) {
    assert.throws(() => validateRetry(baseline, { ...baseline, ...patch }));
  }
});
