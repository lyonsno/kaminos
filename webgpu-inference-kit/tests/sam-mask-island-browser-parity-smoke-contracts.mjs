import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

assert.match(smokeJs, /navigator\.gpu/, 'browser smoke must require a real browser WebGPU adapter');
assert.match(smokeJs, /requestAdapter/, 'browser smoke must request an effective adapter');
assert.match(smokeJs, /runSam3MaskDecoderIslandRoute/, 'browser smoke must run the package route runner');
assert.match(smokeJs, /createSam3MaskProjectionCpuOracle/, 'browser smoke must compare against the CPU oracle');
assert.match(smokeJs, /samMaskIslandParitySmokeState/, 'browser smoke must expose an explicit debug state hook');
assert.match(smokeJs, /fullSam3BrowserExecution:\s*false/, 'browser smoke must preserve the bounded island claim');
assert.match(smokeJs, /manifest\.staticWeights/, 'browser smoke must preserve synthetic static-weight identity');
assert.doesNotMatch(smokeJs, /weightsHash:\s*embeddingTensor\.sha256/, 'browser smoke must not pretend the input embedding is a weights hash');
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

assert.equal(join(new URL('.', root).pathname, 'smokes').includes('webgpu-inference-kit'), true);

console.log('sam mask island browser parity smoke contracts passed');
