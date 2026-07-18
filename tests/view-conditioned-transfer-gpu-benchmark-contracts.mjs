import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(name) {
  try {
    return await readFile(new URL(name, root), 'utf8');
  } catch {
    assert.fail(`${name} is absent`);
  }
}

const exporter = await source('view-conditioned-transfer-gpu-export.py');
const page = await source('view-conditioned-transfer-gpu-benchmark.html');
const witness = await source('view-conditioned-transfer-gpu-benchmark.mjs');

assert.match(exporter, /kaminos\.view-conditioned-transfer-gpu-input\.v0/, 'export schema is explicit');
assert.match(exporter, /load_transfer_input[\s\S]*load_treatment/, 'export authenticates source and persisted treatment');
assert.match(exporter, /dense-ridge-rgba\.f32[\s\S]*reduced-ridge-rgba\.f32/, 'export writes separately bindable dense and reduced radiance buffers');
assert.match(exporter, /dense-expected-rgba\.f32[\s\S]*reduced-expected-rgba\.f32/, 'export writes CPU correctness references');
assert.match(exporter, /failurePhase[\s\S]*status[\s\S]*failed/, 'export preserves durable failure phase');
assert.match(exporter, /sha256/, 'export hashes every binary input');

assert.match(page, /navigator\.gpu/, 'page requires WebGPU');
assert.match(page, /requiredFeatures:[\s\S]*timestamp-query/, 'page requires timestamp-query instead of silently timing CPU submission');
assert.match(page, /dense-96-bin-compositor-v0[\s\S]*reduced-depth-tile-compositor-v0/, 'requested and effective compositor identities are explicit');
assert.match(page, /writeTimestamp[\s\S]*resolveQuerySet/, 'GPU timestamps surround the measured dispatch');
assert.match(page, /roundIndex\s*%\s*2[\s\S]*dense[\s\S]*reduced/, 'samples use interleaved AB/BA order');
assert.match(page, /requestedSamples[\s\S]*effectiveSamples[\s\S]*sampleCount/, 'requested and effective sample counts are reported');
assert.match(page, /expectedMae[\s\S]*expectedMaxAbsError/, 'GPU output is checked against CPU references');
assert.match(page, /optimizationClaimAllowed:\s*false/, 'page starts from a non-claiming state');

assert.match(witness, /kaminos\.view-conditioned-transfer-gpu-benchmark\.v0/, 'witness schema is explicit');
assert.match(witness, /--input-manifest[\s\S]*--treatment-report[\s\S]*--out-dir[\s\S]*--samples[\s\S]*--warmup/, 'load-bearing inputs are caller supplied');
assert.match(witness, /remote-debugging-port=0/, 'witness launches one isolated browser with an ephemeral CDP port');
assert.match(witness, /browserLaunchCount:\s*1/, 'witness receipts one browser launch');
assert.match(witness, /timestampStatus[\s\S]*outputValidation[\s\S]*optimizationClaimAllowed/, 'witness rejects missing timestamp or output authority');
assert.match(witness, /status:\s*'failed'[\s\S]*failurePhase/, 'witness writes durable failure state');
assert.match(witness, /chrome\.kill[\s\S]*server\.kill/, 'witness cleans up both browser and local server');

console.log('view-conditioned transfer GPU benchmark contracts passed');
