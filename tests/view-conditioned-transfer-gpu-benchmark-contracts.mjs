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
assert.match(page, /manifest\.treatment\.label\s*===\s*['"]d12-t2['"]/, 'page requires the authenticated d12-t2 treatment');
assert.match(page, /manifest\.effective\.tileSize\s*===\s*2/, 'page requires treatment tile size two');
assert.match(page, /denseShape[\s\S]*96[\s\S]*242[\s\S]*314/, 'page requires the exact dense workload shape');
assert.match(page, /reducedShape[\s\S]*12[\s\S]*121[\s\S]*157/, 'page requires the exact reduced storage shape');
assert.match(page, /occluderDepth[\s\S]*shape[\s\S]*242[\s\S]*314/, 'page requires the exact shared occluder depth shape');
assert.match(page, /treatment-caption[\s\S]*manifest\.treatment\.label/, 'visible treatment caption derives from authenticated identity');

assert.match(witness, /kaminos\.view-conditioned-transfer-gpu-benchmark\.v0/, 'witness schema is explicit');
assert.match(witness, /--input-manifest[\s\S]*--treatment-report[\s\S]*--out-dir[\s\S]*--samples[\s\S]*--warmup/, 'load-bearing inputs are caller supplied');
assert.match(witness, /remote-debugging-port=0/, 'witness launches one isolated browser with an ephemeral CDP port');
assert.match(witness, /browserLaunchCount:\s*1/, 'witness receipts one browser launch');
assert.match(witness, /timestampStatus[\s\S]*outputValidation[\s\S]*optimizationClaimAllowed/, 'witness rejects missing timestamp or output authority');
assert.match(witness, /status:\s*'failed'[\s\S]*failurePhase/, 'witness writes durable failure state');
assert.match(witness, /chrome\.kill[\s\S]*server\.kill/, 'witness cleans up both browser and local server');
assert.match(witness, /--phase-timeout-ms/, 'transport timeout is caller supplied');
assert.match(witness, /exportedManifest\.treatment\.label[\s\S]*args\.treatmentLabel/, 'Node independently requires the effective treatment label');
assert.match(witness, /EXPECTED_DENSE_SHAPE\s*=\s*\[96,\s*242,\s*314\][\s\S]*requireShape\(exportedManifest\.effective\.denseShape,\s*EXPECTED_DENSE_SHAPE/, 'Node independently requires exact dense workload shape');
assert.match(witness, /EXPECTED_REDUCED_SHAPE\s*=\s*\[12,\s*121,\s*157\][\s\S]*requireShape\(exportedManifest\.effective\.reducedShape,\s*EXPECTED_REDUCED_SHAPE/, 'Node independently requires exact reduced workload shape');
assert.match(witness, /pageReport\.workload[\s\S]*outputWidth[\s\S]*314[\s\S]*outputHeight[\s\S]*242/, 'Node revalidates the browser workload report');
assert.match(witness, /addEventListener\(['"]close['"][\s\S]*rejectPending/, 'CDP socket close rejects pending requests');
assert.match(witness, /addEventListener\(['"]error['"][\s\S]*rejectPending/, 'CDP socket error rejects pending requests');
assert.match(witness, /phaseTimeout[\s\S]*Promise\.race/, 'transport waits are bounded by the caller timeout');
assert.match(witness, /symlink[\s\S]*httpRoot[\s\S]*worktree[\s\S]*output/, 'HTTP server exposes only explicit worktree and durable-output mounts');
assert.match(witness, /--directory[\s\S]*httpRoot/, 'HTTP server uses the isolated mount root rather than a filesystem-wide root');

console.log('view-conditioned transfer GPU benchmark contracts passed');
