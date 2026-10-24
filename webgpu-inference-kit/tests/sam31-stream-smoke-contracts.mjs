// kaminos-test: node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const moduleUrl = new URL('../tools/sam31-stream-smoke.mjs', import.meta.url);
assert.ok(existsSync(moduleUrl), 'sequential GPU exercise must reject incomplete or misbound frame evidence');
const smoke = await import(moduleUrl);
const { validateStreamSmokeFrame } = smoke;
const observedAdapter = JSON.parse(await readFile(new URL('./fixtures/sam31-observed-software-adapter.json', import.meta.url), 'utf8'));
assert.equal(typeof smoke.requireNativeStreamAdapter, 'function', 'native exercise must reject the observed software adapter before model materialization');
assert.throws(() => smoke.requireNativeStreamAdapter(observedAdapter.adapter), /native.*adapter|software.*adapter/i);
assert.throws(() => smoke.requireNativeStreamAdapter({ ...observedAdapter.adapter, fallback: false }), /adapter/i, 'software identity overrides a contradictory fallback flag');
assert.throws(() => smoke.requireNativeStreamAdapter({ vendor: 'unknown' }), /adapter/i, 'missing fallback identity is not hardware proof');
smoke.requireNativeStreamAdapter({ fallback: false, vendor: 'apple', architecture: 'metal-3' });
const frame = () => ({ frameIndex: 2, sourceImageSha256: 'sha256:current', maskWidth: 1, maskHeight: 1,
  maskLogits: new Float32Array(16), objectScores: new Float32Array(16),
  receipts: [{ status: 'real', requestedRouteId: 'sam.real', effectiveRouteId: 'sam.real', fallbackReason: null,
    outputs: [{ artifactId: 'frame:2' }] }] });
const expected = { frameIndex: 2, sourceImageSha256: 'sha256:current' };
validateStreamSmokeFrame(frame(), expected);
for (const mutate of [f => f.frameIndex--, f => f.sourceImageSha256 = 'sha256:stale', f => f.maskLogits = new Float32Array(),
  f => f.maskLogits[0] = NaN, f => f.receipts = [], f => f.receipts[0].effectiveRouteId = 'sam.fallback',
  f => f.receipts[0].fallbackReason = 'CPU', f => f.receipts[0].outputs = []]) {
  const value = frame(); mutate(value);
  assert.throws(() => validateStreamSmokeFrame(value, expected));
}
const temp = await mkdtemp(join(tmpdir(), 'sam31-stream-smoke-'));
try {
  const primary = join(temp, 'primary.json'), output = join(temp, 'output');
  const run = spawnSync(process.execPath, [fileURLToPath(moduleUrl), '--out', output, '--model', join(temp, 'absent'),
    '--sequence', temp, '--chrome', '/absent/chrome', '--playwright', '/absent/playwright.mjs'],
  { env: { ...process.env, EPISTAXIS_JOB_PRIMARY_OUTPUT: primary }, encoding: 'utf8' });
  assert.equal(run.status, 1);
  const report = JSON.parse(await readFile(primary, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.phase, 'inputs');
  assert.deepEqual(report.frames, []);
  assert.equal(report.numericalParity, null);
  assert.deepEqual(JSON.parse(await readFile(join(output, 'report.json'), 'utf8')), report);
  for (const populated of [true, false]) {
    const directory = join(temp, populated ? 'retained' : 'greenroom-created');
    const terminal = join(temp, populated ? 'retained-primary.json' : 'empty-primary.json');
    await mkdir(directory);
    if (populated) await writeFile(join(directory, 'sentinel'), 'retained evidence');
    const child = spawnSync(process.execPath, [fileURLToPath(moduleUrl), '--out', directory, '--model', join(temp, 'absent'),
      '--sequence', temp, '--chrome', '/absent/chrome', '--playwright', '/absent/playwright.mjs'],
    { env: { ...process.env, EPISTAXIS_JOB_PRIMARY_OUTPUT: terminal }, encoding: 'utf8' });
    assert.equal(child.status, 1);
    const failure = JSON.parse(await readFile(terminal, 'utf8'));
    assert.equal(failure.status, 'failed');
    assert.equal(failure.phase, populated ? 'output-initialization' : 'inputs');
    assert.equal(failure.browserLaunched, false);
    assert.deepEqual(failure.frames, []);
    if (populated) {
      assert.equal(await readFile(join(directory, 'sentinel'), 'utf8'), 'retained evidence');
      assert.equal(existsSync(join(directory, 'report.json')), false, 'rejected output evidence remains untouched');
    }
  }
} finally { await rm(temp, { recursive: true, force: true }); }
console.log('Sequential SAM smoke rejects stale, partial, nonfinite and fallback frame evidence');
