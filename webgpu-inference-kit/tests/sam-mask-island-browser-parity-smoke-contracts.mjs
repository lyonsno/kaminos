import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSource = readFileSync(new URL('../src/sam-mask-decoder-island.js', import.meta.url), 'utf8');
const smokeHtml = readFileSync(new URL('../smokes/sam-mask-island-parity.html', import.meta.url), 'utf8');
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');

assert.ok(packageJson.files.includes('smokes'), 'package must publish the browser smoke page');
assert.ok(packageJson.files.includes('tools'), 'package must publish the browser smoke witness tool');
assert.match(packageJson.scripts.test, /sam-mask-island-browser-parity-smoke-contracts\.mjs/, 'package test script must include browser parity smoke contracts');

assert.match(routeSource, /includeReadback/, 'route runner must expose explicit opt-in readback evidence for parity smoke');
assert.match(routeSource, /debugReadback/, 'route runner must label raw readback as debug evidence, not receipt truth');

assert.match(smokeHtml, /sam-mask-island-parity\.js/, 'smoke page must load the parity module');
assert.match(smokeHtml, /sam-mask-parity-canvas/, 'smoke page must expose a visible mask parity canvas');
assert.match(smokeHtml, /sam-source-image/, 'smoke page must expose the source image panel');

assert.match(smokeJs, /navigator\.gpu/, 'browser smoke must require a real browser WebGPU adapter');
assert.match(smokeJs, /requestAdapter/, 'browser smoke must request an effective adapter');
assert.match(smokeJs, /runSam3MaskDecoderIslandRoute/, 'browser smoke must run the package route runner');
assert.match(smokeJs, /runSam3MaskTailPhaseProgramRoute/, 'browser smoke must run the mask-tail phase-program route runner');
assert.match(smokeJs, /createSam3MaskProjectionCpuOracle/, 'browser smoke must compare against the CPU oracle');
assert.match(smokeJs, /createSam3MaskTailPhaseProgramCpuOracle/, 'browser smoke must compare mask-tail packets against the CPU oracle');
assert.match(smokeJs, /samMaskIslandParitySmokeState/, 'browser smoke must expose an explicit debug state hook');
assert.match(smokeJs, /fullSam3BrowserExecution:\s*false/, 'browser smoke must preserve the bounded island claim');
assert.match(smokeJs, /manifest\.staticWeights/, 'browser smoke must preserve synthetic static-weight identity');
assert.doesNotMatch(smokeJs, /weightsHash:\s*embeddingTensor\.sha256/, 'browser smoke must not pretend the input embedding is a weights hash');
assert.match(smokeJs, /SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID/, 'browser smoke must route by manifest route identity');
assert.match(smokeJs, /sam3-mask-tail-tensors/, 'browser smoke must preserve mask-tail tensor input identity');
assert.match(smokeJs, /mask-embedder-layer-0-weight/, 'browser smoke must load real mask embedder weights for mask-tail');
assert.match(smokeJs, /sourceImage/, 'browser smoke must preserve source image identity');
assert.match(smokeJs, /sourceImageShape/, 'browser smoke must derive source artifact shape through a named helper');
assert.match(smokeJs, /manifest\.sourceImage\?\.resolution/, 'browser smoke must use sourceImage.resolution for source artifact shape when present');
assert.doesNotMatch(smokeJs, /shape:\s*\[1\]/, 'browser smoke must not put fake placeholder shapes on aggregate packet artifacts');
assert.match(smokeJs, /selectedMaskIndex/, 'browser smoke must render a selected reference/webgpu mask');
assert.match(smokeJs, /drawVisualWitness/, 'browser smoke must draw source/reference/webgpu/diff witness panels');
assert.match(smokeJs, /drawSourcePanel/, 'browser smoke must handle packets without a source image file');
assert.match(smokeJs, /synthetic source/i, 'browser smoke must visibly label synthetic source placeholders');
assert.match(smokeJs, /maskLogitsMaxAbsDiff/, 'browser smoke must report logits diff');
assert.match(smokeJs, /binaryMismatchCount/, 'browser smoke must report binary mismatch count');

assert.match(witness, /--enable-unsafe-webgpu/, 'witness must launch Chrome with WebGPU enabled');
assert.match(witness, /Chrome DevTools endpoint did not open/, 'witness must use CDP with loud startup failure');
assert.match(witness, /samMaskIslandParitySmokeState/, 'witness must poll the browser debug state');
assert.match(witness, /kaminos\.sam3-mask-island\.browser-parity-smoke\.v0/, 'witness report must be schema stamped');
assert.match(witness, /primary_output_written/, 'witness must write whether the primary artifact was preserved');
assert.match(witness, /failure_phase/, 'witness must record failure phase');
assert.match(witness, /requestedRouteId/, 'witness must preserve requested route identity');
assert.match(witness, /effectiveRouteId/, 'witness must preserve effective route identity');
assert.match(witness, /backendIdentity/, 'witness must preserve browser backend identity');
assert.match(witness, /tensorPacket/, 'witness must preserve tensor packet identity');
assert.match(witness, /--packet-tool/, 'witness must allow a real boundary packet exporter');
assert.match(witness, /mlx-mask-tail-export/, 'witness must allow a real mask-tail packet exporter');
assert.match(witness, /MASK_TAIL_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve mask-tail route identity');
assert.match(witness, /lastHsSha256/, 'witness must preserve mask-tail tensor identity');
assert.match(witness, /sourceImage/, 'witness report must preserve source image identity');

assert.equal(join(new URL('.', root).pathname, 'smokes').includes('webgpu-inference-kit'), true);

const invalidChromeDir = await mkdtemp(join(tmpdir(), 'sam-mask-invalid-chrome-'));
const invalidChromeReport = join(invalidChromeDir, 'report.json');
const invalidChromeScreenshot = join(invalidChromeDir, 'screenshot.png');
const invalidChromePath = join(invalidChromeDir, 'definitely-not-chrome');
const invalidChromeRun = spawnSync(process.execPath, [
  'tools/sam-mask-island-browser-parity-smoke.mjs',
  '--out', invalidChromeScreenshot,
  '--report', invalidChromeReport,
  '--debug-port', String(19527 + (process.pid % 1000)),
  '--server-port', String(20527 + (process.pid % 1000)),
], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  env: {
    ...process.env,
    KAMINOS_CHROME: invalidChromePath,
  },
});
assert.notEqual(invalidChromeRun.status, 0, 'invalid Chrome path must fail');
assert.equal(existsSync(invalidChromeReport), true, 'invalid Chrome path must still write a report');
const invalidChromeFailure = JSON.parse(readFileSync(invalidChromeReport, 'utf8'));
assert.equal(invalidChromeFailure.ok, false);
assert.equal(invalidChromeFailure.failure_phase, 'launch_chrome');
assert.equal(invalidChromeFailure.primary_output_written, false);
assert.equal(invalidChromeFailure.screenshot, null);
assert.equal(invalidChromeFailure.chrome, invalidChromePath);
assert.match(invalidChromeFailure.error, /ENOENT|spawn/i);

console.log('sam mask island browser parity smoke contracts passed');
