import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const runnerUrl = new URL('../tools/sam31-tracker-memory-benchmark.mjs', import.meta.url);
const source = await readFile(runnerUrl, 'utf8').catch(() => null);
assert.ok(source, 'the executable benchmark runner must exist before a native A/B can be invoked');
const { validateBenchmarkPlan, startBenchmarkServer } = await import(runnerUrl);
const fixture = await mkdtemp(join(tmpdir(), 'sam31-memory-benchmark-cpu-'));
const packageRoot = join(fixture, 'package');
await mkdir(packageRoot);
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const modelText = JSON.stringify({ packageId: 'cpu-model', geometry: { episode: { sourceMaskHeight: 32, sourceMaskWidth: 32, multiplexCount: 16 } } });
await writeFile(join(packageRoot, 'sam31-model-package.json'), modelText);
await writeFile(join(packageRoot, 'tracker-model-root.json'), JSON.stringify({ modelPackage: { file: 'sam31-model-package.json', sha256: hash(modelText) } }));
await writeFile(join(fixture, 'frame0.jpg'), 'distinct-frame-zero');
await writeFile(join(fixture, 'frame1.jpg'), 'distinct-frame-one');
await writeFile(join(fixture, 'mask.f32'), Buffer.alloc(16 * 32 * 32 * 4));
const chrome = join(fixture, 'chromium');
await writeFile(chrome, 'CPU fixture; never an executable browser');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8' }).trim();
const plan = {
  modelPackageRoot: packageRoot, sourceImages: [join(fixture, 'frame0.jpg'), join(fixture, 'frame1.jpg')],
  initialMask: { file: join(fixture, 'mask.f32'), shape: [16, 1, 32, 32] }, commit, outputDir: join(fixture, 'outputs'),
  runs: [{ mode: 'flash', warmup: true }, { mode: 'flash', warmup: false }, { mode: 'online', warmup: false }],
  expectedGeometry: { imageHeight: 28, imageWidth: 28, queryHeight: 2, queryWidth: 2, queryTokens: 4, memoryTokens: 20, maskHeight: 8, maskWidth: 8, channels: 256, multiplexCount: 16 },
};
assert.deepEqual(validateBenchmarkPlan(plan, fixture).runs, plan.runs);
for (const [label, change] of [
  ['invalid mode', p => { p.runs[0].mode = 'fallback'; }],
  ['invalid warmup', p => { p.runs[0].warmup = 'false'; }],
  ['missing geometry', p => { delete p.expectedGeometry.queryTokens; }],
  ['inconsistent geometry', p => { p.expectedGeometry.queryTokens = 1; }],
  ['small source mask', p => { p.initialMask.shape = [16, 1, 8, 8]; }],
  ['missing measured online', p => { p.runs[2].warmup = true; }],
  ['missing source', p => { delete p.commit; }],
]) {
  const bad = structuredClone(plan); change(bad);
  assert.throws(() => validateBenchmarkPlan(bad, fixture), undefined, label);
}
const native = structuredClone(plan);
native.expectedGeometry = { imageHeight: 1008, imageWidth: 1008, queryHeight: 72, queryWidth: 72, queryTokens: 5184, memoryTokens: 5200, maskHeight: 288, maskWidth: 288, channels: 256, multiplexCount: 16 };
native.initialMask.shape = [16, 1, 1152, 1152];
assert.doesNotThrow(() => validateBenchmarkPlan(native, fixture));
const longPlan = { ...plan, runs: Array.from({ length: 301 }, (_, index) => ({ mode: index % 2 ? 'online' : 'flash', warmup: false })) };
assert.equal(validateBenchmarkPlan(longPlan, fixture).runs.length, 301, 'the runner must not silently cap the caller run list');

const mounts = { '/package/': packageRoot, '/': fileURLToPath(new URL('../', import.meta.url)) };
await symlink(join(fixture, 'frame0.jpg'), join(packageRoot, 'escape'));
let rejectedUpload;
const server = await startBenchmarkServer({ mounts, browserPlan: { fixture: true }, inputs: { '/caller/frame-0': Buffer.from('snapshot') }, onOutput: async (_index, _name, request) => { rejectedUpload = request; throw new Error('refused before reading upload'); } });
try {
  const response = await fetch(`${server.url}/caller/frame-0`);
  assert.equal(await response.text(), 'snapshot');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.equal((await fetch(`${server.url}/package/escape`)).status, 403);
  assert.equal((await fetch(`${server.url}/package/%2e%2e%2fframe0.jpg`)).status, 403);
  assert.deepEqual(await (await fetch(`${server.url}/api/benchmark-plan`)).json(), { fixture: true });
  try {
    const refused = await fetch(`${server.url}/api/output/0/selectedMasks`, { method: 'POST', body: Buffer.alloc(1024 * 1024) });
    assert.equal(refused.status, 500);
    assert.match(await refused.text(), /refused before reading/);
  } catch (error) {
    // The observed Node transport can close during this rejected upload.
    assert.equal(error.cause?.code, 'EPIPE', 'only the observed early-refusal transport error is accepted');
  }
  assert.ok(rejectedUpload, 'the server must have actually refused this upload');
  assert.ok(rejectedUpload.readableFlowing || rejectedUpload.readableEnded || rejectedUpload.destroyed, 'a refused upload must be drained or destroyed');
} finally { await server.close(); }
await assert.rejects(() => fetch(`${server.url}/api/benchmark-plan`), /fetch failed/);

const planPath = join(fixture, 'plan.json');
const report = join(fixture, 'report.json');
const trace = join(fixture, 'trace.json');
await writeFile(planPath, JSON.stringify(plan));
const env = {
  ...process.env, PLAYWRIGHT_MODULE: fileURLToPath(new URL('./sam31-tracker-memory-benchmark-runner-fixture.mjs', import.meta.url)), CHROME_PATH: chrome,
  SAM31_BENCHMARK_CPU_TRACE: trace,
};
function run(extraEnv = {}, inputPlan = planPath) {
  return spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(runnerUrl), '--plan', inputPlan, '--report', report], { env: { ...env, ...extraEnv }, encoding: 'utf8' });
}
let executed = run();
assert.equal(executed.status, 0, executed.stderr || executed.stdout);
let evidence = JSON.parse(await readFile(report, 'utf8'));
assert.equal(evidence.status, 'passed');
assert.equal(evidence.primary_output_written, true);
assert.equal(evidence.runs.length, plan.runs.length, 'warmups must retain complete output evidence too');
assert.equal(evidence.requestedPlan.runs.length, plan.runs.length);
assert.equal(evidence.timeoutMs, 0);
assert.equal(evidence.scope.streamingFPS, false);
assert.equal(evidence.scope.conditioningFrames, 1);
assert.equal(evidence.comparisons.length, 1, 'measured outputs must be compared in full without including warmups');
assert.equal(evidence.comparisons[0].referenceRunIndex, 1);
assert.equal(evidence.comparisons[0].actualRunIndex, 2);
for (const [name, stats] of Object.entries(evidence.comparisons[0].outputs)) {
  assert.equal(stats.elementCount, evidence.runs[1].outputs[name].elementCount);
  assert.equal(stats.maxAbsDiff, 0);
  assert.equal(stats.meanAbsDiff, 0);
  assert.equal(stats.rootMeanSquareDiff, 0);
  assert.equal(stats.relativeL2Diff, 0);
  assert.equal(stats.differentElementCount, 0);
  assert.equal(stats.binaryMismatchCount, 0);
}
assert.equal(evidence.source.commit, commit);
assert.equal(evidence.residentSetup.cacheEvidence?.backingStore?.kind, 'browser-opfs', 'effective cache backing must be evidence, not an echoed OPFS label');
assert.equal(evidence.browser.executablePath, await realpath(chrome));
assert.ok(evidence.source.files['src/sam31-browser-tracker-session-driver.js']);
assert.equal(new Set(evidence.runs.map(row => row.sessionId)).size, plan.runs.length);
assert.equal(new Set(evidence.runs.map(row => row.residentSessionId)).size, 1);
for (const row of evidence.runs) {
  assert.equal(row.attentionCalls.length, 8);
  const metadata = JSON.parse(await readFile(row.metadataFile, 'utf8'));
  assert.equal(metadata.result.memoryAttentionKernel, row.mode);
  assert.equal(metadata.result.manifest.executionGeometry.queryTokens, plan.expectedGeometry.queryTokens);
  for (const [name, output] of Object.entries(row.outputs)) {
    const bytes = await readFile(output.file);
    assert.equal(hash(bytes), output.sha256);
    assert.equal(bytes.length, output.byteLength);
    assert.equal(output.dtype, 'float32-le');
    assert.ok(output.shape.length > 0, name);
  }
}
let cleanup = JSON.parse(await readFile(trace, 'utf8'));
assert.equal(cleanup.launches, 1);
assert.equal(cleanup.residentCreations, 1);
assert.equal(cleanup.closed, true);
assert.equal(cleanup.residentClosed, true);
assert.equal(cleanup.launchOptions.timeout, 0);
assert.equal(cleanup.pageTimeout, 0);
assert.equal(cleanup.navigationTimeout, 0);
assert.equal(cleanup.gotoOptions.timeout, 0);
await assert.rejects(() => fetch(`${cleanup.url}/api/benchmark-plan`), /fetch failed/);

for (const [failure, phase] of [
  ['launch', 'browser-launch'], ['page-module', 'page-load'], ['mode', 'admit-run'], ['source', 'admit-run'],
  ['partial', 'admit-run'], ['blank', 'admit-run'], ['trace', 'admit-run'], ['device-change', 'admit-run'],
  ['input-change', 'admit-run'], ['upload', 'execute-run'], ['missing-capture', 'execute-run'], ['shape', 'admit-run'],
  ['opfs', 'resident-setup'], ['fallback', 'admit-run'],
  ['disconnect', 'execute-run'],
]) {
  executed = run({ SAM31_BENCHMARK_CPU_FAILURE: failure });
  assert.notEqual(executed.status, 0, failure);
  evidence = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(evidence.status, 'failed', failure);
  assert.equal(evidence.failure_phase, phase, `${failure}: ${evidence.error}`);
  assert.equal(evidence.primary_output_written, false);
  assert.ok(evidence.lastTrustworthyEvidence);
  if (phase === 'admit-run') {
    assert.ok(evidence.lastTrustworthyEvidence.browserMetadataFile, 'rejected runtime evidence must remain replayable');
    const rejected = JSON.parse(await readFile(evidence.lastTrustworthyEvidence.browserMetadataFile, 'utf8'));
    assert.ok(rejected.result);
  }
  cleanup = JSON.parse(await readFile(trace, 'utf8'));
  if (failure !== 'launch') assert.equal(cleanup.closed, true, failure);
  if (failure === 'disconnect') assert.equal(evidence.cleanup.sessionCloseSkipped, 'failed-or-disconnected');
  if (cleanup.url) await assert.rejects(() => fetch(`${cleanup.url}/api/benchmark-plan`), /fetch failed/);
}
const invalidPlan = join(fixture, 'invalid.json');
await writeFile(invalidPlan, '{');
executed = run({}, invalidPlan);
assert.notEqual(executed.status, 0);
evidence = JSON.parse(await readFile(report, 'utf8'));
assert.equal(evidence.failure_phase, 'read-plan');
assert.equal(evidence.primary_output_written, false);
const stalePlan = join(fixture, 'stale-source.json');
await writeFile(stalePlan, JSON.stringify({ ...plan, commit: '0'.repeat(40) }));
executed = run({}, stalePlan);
assert.notEqual(executed.status, 0);
evidence = JSON.parse(await readFile(report, 'utf8'));
assert.equal(evidence.failure_phase, 'source-preflight');
assert.equal(evidence.primary_output_written, false);
assert.equal(evidence.browser, undefined, 'a stale source request must fail before browser acquisition');
assert.equal(evidence.source.commit, commit);
const signaled = spawn(process.execPath, ['--experimental-vm-modules', fileURLToPath(runnerUrl), '--plan', planPath, '--report', report], { env: { ...env, SAM31_BENCHMARK_CPU_FAILURE: 'signal' }, stdio: ['ignore', 'pipe', 'pipe'] });
let signalOutput = '';
let signalError = '';
signaled.stderr.on('data', data => { signalError += data; });
await new Promise((accept, reject) => {
  signaled.stdout.on('data', data => {
    signalOutput += data;
    if (signalOutput.includes('CPU fixture holding invocation')) { signaled.kill('SIGTERM'); accept(); }
  });
  signaled.once('exit', () => reject(new Error(`signal fixture exited before its hold: ${signalError}`)));
});
const signalExit = await new Promise(accept => signaled.once('exit', accept));
assert.notEqual(signalExit, 0);
evidence = JSON.parse(await readFile(report, 'utf8'));
assert.equal(evidence.status, 'failed');
assert.match(evidence.error, /SIGTERM/);
assert.equal(evidence.primary_output_written, false);
assert.equal(evidence.cleanup.browserClosed, true);
assert.equal(evidence.cleanup.serverClosed, true);
assert.equal(evidence.cleanup.sessionCloseSkipped, 'failed-or-disconnected');
console.log(`SAM3.1 memory benchmark runner CPU contracts passed; retained fixture/evidence: ${fixture}`);
