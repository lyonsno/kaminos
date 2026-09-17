import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { readCompleteChunkedJsonEvidence } from '../src/chunked-json-evidence.js';

const witness = readFileSync(new URL('../tools/sam-semantic-mask-workbench-witness.mjs', import.meta.url), 'utf8');
const inspectSource = witness.slice(witness.indexOf('function canvasInspectionExpression()'), witness.indexOf('let chromeProcess ='));
const inspectExpression = new Function(`${inspectSource}; return canvasInspectionExpression();`)();
const visibleOutput = { instances: [{ index: 7, score: 0.8, mask: new Uint32Array([1]), foregroundPixelCount: 1 }],
  mask: new Uint32Array([1]), logits: new Float32Array([0.75]),
  foregroundScheduling: { yieldCount: 2, frames: [{ zoom: 1.03 }] } };
const pixelContext = { getImageData: () => ({ data: new Uint8Array([200, 200, 200, 255]) }), drawImage() {} };
const inspectDocument = { createElement: () => ({ getContext: () => pixelContext }), getElementById(id) {
  if (id === 'sam-mask-runtime-frame') return { contentWindow: { samMaskIslandVisualOutput: () => visibleOutput } };
  return { width: 1, height: 1, dataset: {}, textContent: '', getContext: () => pixelContext };
} };
const observedVisual = runInNewContext(inspectExpression, { document: inspectDocument });
assert.equal(observedVisual.output.instances?.[0]?.index, 7, 'witness must retain non-top instance identity and raw mask');
assert.deepEqual(Array.from(observedVisual.output.instances[0].mask), [1]);
assert.deepEqual(Array.from(observedVisual.output.logits), [0.75], 'visible mask numerics must remain replayable');

const outputGuards = witness.slice(witness.indexOf("  if (output?.outputAuthority !=="),
  witness.indexOf('  if (values.prompt !== undefined && output.promptText'));
const validOutput = {
  outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
  instances: [{ index: 7 }], selectedCandidateCount: 1,
  foregroundScheduling: { mode: 'shared-device-input-driven-source-render', yieldCount: 2,
    frames: [{ zoom: 1.03, afterYieldCount: 1 }] },
};
const checkOutput = output => runInNewContext(outputGuards, { output, values: { 'exercise-foreground': true } });
checkOutput(validOutput);
for (const [patch, expected] of [
  [{ outputAuthority: 'fixture' }, /output authority/],
  [{ instances: [] }, /partial retained instance/],
  [{ foregroundScheduling: null }, /foreground exercise/],
  [{ foregroundScheduling: { ...validOutput.foregroundScheduling, mode: 'separate-device-render' } }, /foreground exercise/],
  [{ foregroundScheduling: { ...validOutput.foregroundScheduling, yieldCount: 0 } }, /foreground exercise/],
  [{ foregroundScheduling: { ...validOutput.foregroundScheduling, frames: [] } }, /foreground exercise/],
  [{ foregroundScheduling: { ...validOutput.foregroundScheduling, failure: 'device lost' } }, /foreground exercise/],
]) assert.throws(() => checkOutput({ ...validOutput, ...patch }), expected);

// Run the actual transport functions without launching Chrome or loading a model.
const transportSource = witness.slice(witness.indexOf('async function connectCdp('), witness.indexOf('async function settleForVisualCapture('));
class TestSocket extends EventTarget {
  static latest;
  constructor() {
    super();
    TestSocket.latest = this;
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }
  send() {}
  close() { this.dispatchEvent(new Event('close')); }
}
const { connectCdp, evaluate } = new Function('WebSocket', 'timeoutMs', 'readCompleteChunkedJsonEvidence', 'randomUUID',
  `${transportSource}; return { connectCdp, evaluate };`)(TestSocket, null, readCompleteChunkedJsonEvidence, randomUUID);
for (const event of ['close', 'error']) {
  const cdp = await connectCdp('fixture://cdp');
  let settled = 0;
  const requests = [cdp.request('Runtime.evaluate'), cdp.request('Page.captureScreenshot')]
    .map(request => request.catch(error => { settled += 1; return error; }));
  TestSocket.latest.dispatchEvent(new Event(event));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, 2, `CDP ${event} must reject every pending request without an execution timeout`);
  for (const error of await Promise.all(requests)) assert.match(error.message, /CDP.*(closed|error|failed)/);
  await assert.rejects(cdp.request('Runtime.evaluate'), /CDP.*(closed|error|failed)/);
}

const payload = { imageCache: { resources: 'x'.repeat(2 * 1024 * 1024) }, tail: 'must survive beyond the first chunk' };
const browser = { payload };
const progress = [];
let evaluations = 0;
const fixtureCdp = { async request(method, params) {
  assert.equal(method, 'Runtime.evaluate');
  evaluations += 1;
  const value = await runInNewContext(params.expression, browser);
  if (JSON.stringify(value).length > 1100000) throw new Error('fixture bulk CDP payload rejected');
  return { result: { value } };
} };
const transferred = await evaluate(fixtureCdp, 'payload', { chunked: true, onProgress: value => progress.push(value) });
assert.equal(JSON.stringify(transferred), JSON.stringify(payload), 'all evidence, including the tail, must survive transport');
assert.ok(evaluations > 3, 'large evidence must cross the actual chunked transfer path');
assert.equal(progress.at(-1).passed, true);
assert.equal(progress.at(-1).completedCharacters, JSON.stringify(payload).length);
assert.deepEqual(Object.keys(browser), ['payload'], 'temporary browser snapshot must be released after transfer');

let reads = 0;
const brokenBrowser = { payload };
const interruptedProgress = [];
await assert.rejects(evaluate({ async request(method, params) {
  reads += 1;
  if (reads === 3) throw new Error('CDP closed during chunk read');
  return { result: { value: await runInNewContext(params.expression, brokenBrowser) } };
} }, 'payload', { chunked: true, onProgress: value => interruptedProgress.push(value) }), /CDP closed/);
assert.equal(interruptedProgress.at(-1).passed, false, 'partial transfer cannot look complete');
assert.ok(interruptedProgress.at(-1).completedCharacters > 0, 'partial progress must remain available for the failure report');
assert.deepEqual(Object.keys(brokenBrowser), ['payload'], 'interrupted transfer must attempt snapshot cleanup');

for (const argument of ['url', 'out', 'report', 'debug-port', 'timeout-ms', 'prompt', 'expect-empty', 'negative-control', 'negative-out']) {
  assert.match(witness, new RegExp(`['"]${argument}['"]`), `witness must expose --${argument}`);
}
assert.match(witness, /api\/sam3-workbench-route/, 'witness must collect server route registration evidence');
assert.match(witness, /run-segmentation/, 'witness must activate the operator control rather than calling a hidden test hook');
assert.match(witness, /prompt-input[^]*dispatchEvent/, 'caller prompt must be written through the visible workbench input');
assert.match(witness, /workbench-status/, 'witness must observe the human-facing status surface');
assert.match(witness, /button\s*&&\s*!button\.disabled/, 'witness initialization must tolerate the page before its controls exist');
assert.match(witness, /source-canvas/, 'witness must inspect source canvas pixels');
assert.match(witness, /overlay-canvas/, 'witness must inspect overlay canvas pixels');
assert.match(witness, /mask-canvas/, 'witness must inspect raw mask canvas pixels');
assert.match(witness, /Page\.captureScreenshot/, 'witness must preserve the visible browser output');
assert.match(witness, /await settleForVisualCapture\(\)/, 'witness must allow the browser compositor to settle before visual capture');
assert.match(witness, /captureCompleteWorkbenchScreenshot/, 'witness must gate screenshots through a reusable presentation-completeness check');
assert.match(witness, /sourceSignalFraction/, 'screenshot gate must prove the visible source panel survived compositor capture');
assert.match(witness, /runButtonSignalFraction/, 'screenshot gate must prove ordinary control DOM survived compositor capture');
assert.match(witness, /screenshotCompleteness/, 'durable report must preserve screenshot-completeness evidence');
assert.match(witness, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\)/, 'partial compositor captures must receive bounded repaint retries');
assert.match(witness, /actual-webgpu-readback/, 'witness must reject non-GPU output authority');
assert.match(witness, /output\.promptText\s*!==\s*values\.prompt/, 'witness must reject runtime prompt identity drift');
assert.match(witness, /output\.imageCache\?\.status\s*!==\s*['"]miss['"]/, 'fresh positive witness must require an authenticated image-cache miss');
assert.match(witness, /values\[['"]expect-empty['"]\][^]*selectedCandidateCount\s*!==\s*0[^]*foregroundPixelCount\s*!==\s*0/, 'expected-empty witness must reject any retained candidate or foreground pixels');
assert.match(witness, /!values\[['"]expect-empty['"]\][^]*selectedCandidateCount\s*<=\s*0[^]*foregroundPixelCount\s*<=\s*0/, 'ordinary positive witness must reject an empty semantic result');
assert.match(witness, /!values\[['"]expect-empty['"]\][^]*canvases\.source\.checksum\s*===\s*canvases\.overlay\.checksum/, 'ordinary positive witness must require a visible mask-overlay delta');
assert.match(witness, /run-negative-control/, 'optional negative witness must activate the visible operator control');
assert.match(witness, /negativeControl/, 'report must preserve negative-control output separately from the positive witness');
assert.match(witness, /report\.visualEvidence = await evaluate\(cdp, canvasInspectionExpression\(\), \{\s*chunked: true/, 'positive output must use the tested complete transport');
assert.match(witness, /negativeVisualEvidence = await evaluate\(cdp, canvasInspectionExpression\(\), \{\s*chunked: true/, 'negative output must use the tested complete transport');
assert.match(witness, /report\.evidenceTransport\.positive = progress/, 'positive partial progress must reach the failure report');
assert.match(witness, /report\.evidenceTransport\.negative = progress/, 'negative partial progress must reach the failure report');
assert.match(witness, /negativeOutput\.imageCache\?\.status\s*!==\s*['"]hit['"]/, 'same-page negative witness must require authenticated image-feature reuse');
assert.match(witness, /Different from positive|Empty as expected/, 'negative control must fail unless it differs from the positive mask or selects nothing');
assert.match(witness, /registrationState[^]*mounted/, 'witness must reject an unmounted or projected route');
assert.match(witness, /requestedUrl\.href\s*!==\s*effectiveRegisteredUrl\.href/, 'witness must bind the complete registered URL including the manifest query');
assert.match(witness, /failurePhase/, 'witness report must remain useful after pre-output failure');
assert.match(witness, /writeReport/, 'witness must write its report on success and failure');
assert.match(witness, /Promise\.race/, 'Chrome spawn failure must rejoin the durable report path instead of throwing from an event callback');
assert.doesNotMatch(witness, /once\(['"]error['"],\s*error\s*=>\s*\{\s*throw/, 'Chrome spawn errors must not escape the durable report path');

const fixtureRoot = mkdtempSync(join(tmpdir(), 'sam-workbench-witness-contract-'));
const kitRoot = join(fixtureRoot, 'kit');
const packetRoot = join(fixtureRoot, 'packet');
const sampleRoot = join(fixtureRoot, 'samples');
mkdirSync(kitRoot);
mkdirSync(packetRoot);
mkdirSync(sampleRoot);
writeFileSync(join(packetRoot, 'tensor-manifest.json'), '{}\n');
for (const sample of ['truck.jpg', 'groceries.jpg', 'test_image.jpg']) writeFileSync(join(sampleRoot, sample), sample);
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: 'SAM Workbench Contract',
  GIT_AUTHOR_EMAIL: 'sam-workbench@example.invalid',
  GIT_COMMITTER_NAME: 'SAM Workbench Contract',
  GIT_COMMITTER_EMAIL: 'sam-workbench@example.invalid',
};
for (const args of [['init', '--quiet'], ['commit', '--allow-empty', '--quiet', '-m', 'fixture']]) {
  const result = spawnSync('git', args, { cwd: kitRoot, env: gitEnvironment, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
}

const portProbe = createServer();
await new Promise(resolveListen => portProbe.listen(0, '127.0.0.1', resolveListen));
const { port } = portProbe.address();
await new Promise(resolveClose => portProbe.close(resolveClose));

const serverPath = new URL('../tools/sam-semantic-mask-workbench-server.mjs', import.meta.url).pathname;
const witnessPath = new URL('../tools/sam-semantic-mask-workbench-witness.mjs', import.meta.url).pathname;
const child = spawn(process.execPath, [
  serverPath,
  '--kit-root', kitRoot,
  '--packet-root', packetRoot,
  '--sample-root', sampleRoot,
  '--port', String(port),
], { stdio: ['ignore', 'pipe', 'pipe'] });

try {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      const route = await fetch(`http://127.0.0.1:${port}/api/sam3-workbench-route`);
      if (route.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error('workbench witness contract fixture did not start');
    await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
  }
  const reportPath = join(fixtureRoot, 'mismatch-report.json');
  const result = spawnSync(process.execPath, [
    witnessPath,
    '--url', `http://127.0.0.1:${port}/smokes/sam-semantic-mask-workbench.html?manifest=%2Fsubstituted%2Ftensor-manifest.json`,
    '--report', reportPath,
    '--chrome', join(fixtureRoot, 'missing-chrome'),
    '--timeout-ms', '1000',
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'a same-path manifest substitution must be rejected');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.failurePhase, 'route-registration', 'manifest substitution must fail before browser launch');
  assert.match(report.error, /requested route does not match registered route/, 'failure must name route identity mismatch');
} finally {
  child.kill('SIGTERM');
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('sam semantic mask workbench witness contracts passed');
