import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const witness = readFileSync(new URL('../tools/sam-semantic-mask-workbench-witness.mjs', import.meta.url), 'utf8');

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
