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
assert.throws(() => validateStreamSmokeFrame(frame(), { ...expected, foreground: true }), /foreground/);
const scheduled = frame();
scheduled.applicationInvocation = { invocationId: 'current', routeId: 'sam:frame', frameIndex: 2 };
scheduled.foreground = { status: 'succeeded', runId: 'current', routeId: 'sam:frame',
  pendingRequestCount: 0, activeRequestCount: 0, activeServiceCount: 0, queuedServiceCount: 0,
  receipts: [{ status: 'completed', runId: 'current', routeId: 'sam:frame', boundary: { phase: 'attention' } }] };
validateStreamSmokeFrame(scheduled, { ...expected, foreground: true });
const replayed = structuredClone(scheduled);
replayed.foreground.runId = replayed.foreground.receipts[0].runId = 'previous-frame-run';
assert.throws(() => validateStreamSmokeFrame(replayed, { ...expected, foreground: true }), /foreground/,
  'a whole internally consistent previous-frame report cannot certify the current invocation');
for (const mutate of [f => f.receipts = [], f => f.receipts[0].runId = 'stale',
  f => f.receipts[0].status = 'failed', f => f.activeRequestCount = 1, f => f.status = 'incomplete']) {
  const value = structuredClone(scheduled); mutate(value.foreground);
  assert.throws(() => validateStreamSmokeFrame(value, { ...expected, foreground: true }), /foreground/);
}
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
  await writeFile(join(temp, 'sequence.json'), JSON.stringify({ frames: [0, 1, 2].map(index => ({ sha256: `fixture:${index}` })) }));
  const startup = spawnSync(process.execPath, [fileURLToPath(moduleUrl), '--out', join(temp, 'http-startup'),
    '--model', temp, '--sequence', temp, '--chrome', process.execPath,
    '--playwright', fileURLToPath(new URL('./fixtures/sam31-stream-startup-browser.mjs', import.meta.url))],
  { env: { ...process.env, EPISTAXIS_JOB_PRIMARY_OUTPUT: join(temp, 'http-startup-primary.json') }, encoding: 'utf8' });
  assert.equal(startup.status, 1, 'the simulated browser must never count as inference evidence');
  const startupReport = JSON.parse(await readFile(join(temp, 'http-startup-primary.json'), 'utf8'));
  assert.match(startupReport.error, /startup-http-fixture-stop/, 'ordinary browser icon requests must not create a spurious missing-resource failure');
  assert.deepEqual(startupReport.frames, []);
} finally { await rm(temp, { recursive: true, force: true }); }
console.log('Sequential SAM smoke rejects stale, partial, nonfinite and fallback frame evidence');
