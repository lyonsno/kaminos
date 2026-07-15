#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const packer = join(root, 'volume-phase-aligned-field-pair.py');
const exporter = readFileSync(join(root, 'volume-full-grid-field-export.mjs'), 'utf8');
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');

assert.ok(existsSync(packer), 'phase-aligned field pair packer exists');
assert.match(exporter, /kaminos\.volume\.phase-aligned-held-field\.v0/, 'exporter explicitly admits phase-aligned held render roles');
assert.match(exporter, /truthHigh[\s\S]*offline-high-truth-held-render-only-v0/, 'truth-high held render keeps oracle authority explicit');
assert.match(exporter, /lowPhaseAligned[\s\S]*downsampled-same-high-history-held-control-v0/, 'low control keeps phase-aligned downsample authority explicit');
assert.match(exporter, /--secondary-render-png/, 'one held-field upload can produce the beauty and partial-debug views');
assert.match(exporter, /importedSecondaryRender/, 'secondary same-state render carries its own effective receipt');
assert.match(core, /phase-aligned-held-render-application-v0/, 'runtime explicitly admits held phase-aligned fields');
assert.match(core, /phase-aligned-held-render-only/, 'runtime rejects simulation advance from held truth or low controls');

const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-phase-aligned-pair-contract-'));
const sourceDir = join(fixtureRoot, 'source');
const outDir = join(fixtureRoot, 'pair');
mkdirSync(sourceDir, { recursive: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fluidChannels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier', 'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront', 'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];
const highGrid = 5;
const lowGrid = 3;

function artifact(name, values, shape, channelOrder) {
  const path = join(sourceDir, name);
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  writeFileSync(path, bytes);
  return {
    path,
    shape,
    channelOrder,
    dtype: 'float32-le',
    byteOrder: 'little-endian',
    floatCount: values.length,
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

const fluidValues = new Float32Array(highGrid ** 3 * fluidChannels.length);
const frontValues = new Float32Array(highGrid ** 3);
for (let z = 0; z < highGrid; z += 1) {
  for (let y = 0; y < highGrid; y += 1) {
    for (let x = 0; x < highGrid; x += 1) {
      const cell = x + y * highGrid + z * highGrid * highGrid;
      for (let channel = 0; channel < fluidChannels.length; channel += 1) {
        fluidValues[cell * fluidChannels.length + channel] = x + 10 * y + 100 * z + channel / 100;
      }
      frontValues[cell] = x === 1 && y === 1 && z === 1 ? 0.9 : 0.1;
    }
  }
}

const fluid = artifact('fluid.f32', fluidValues, [highGrid, highGrid, highGrid, fluidChannels.length], fluidChannels);
const front = artifact('front.f32', frontValues, [highGrid, highGrid, highGrid, 1], ['frontTopology']);
const sourceManifest = {
  schema: 'kaminos.volume.full-grid-field-export.v0',
  identity: 'full-grid-fluid-front-boundary-sidecars-v0',
  status: 'captured',
  failurePhase: null,
  completeFieldCoverage: true,
  routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  prototypeIdentity: 'kaminos-volume-prototype-v0',
  backend: 'WebGPU:contract',
  grid: highGrid,
  fluidComponents: fluidChannels.length,
  fluidChannelOrder: fluidChannels,
  frontChannelOrder: ['frontTopology'],
  sourceCapture: {
    identity: 'contract-exact-basin',
    payloadSha256: 'a'.repeat(64),
    hashMatches: true,
  },
  deterministicReplay: {
    identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
    completedSteps: 13,
    simStepCount: 13,
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    controlsSignature: 'contract-controls-signature',
    timeStepMs: 1000 / 60,
  },
  sidecars: { fluid, front },
};
const sourceManifestPath = join(sourceDir, 'manifest.json');
writeFileSync(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);

const run = spawnSync('python3', [
  packer,
  '--high-manifest', sourceManifestPath,
  '--low-grid', String(lowGrid),
  '--out-dir', outDir,
], { encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr || run.stdout);

const pair = JSON.parse(readFileSync(join(outDir, 'pair-manifest.json'), 'utf8'));
assert.equal(pair.schema, 'kaminos.volume.full-grid-field-pair.v0');
assert.equal(pair.status, 'captured');
assert.equal(pair.authority, 'downsampled-same-high-history-input-to-exact-high-target');
assert.equal(pair.source.exactBasinSourceCaptureSha256, 'a'.repeat(64));
assert.equal(pair.source.deterministicReplay.completedSteps, 13);
assert.equal(pair.low.fluid.downsampleOperator, 'box-average-linear-field-v0');
assert.equal(pair.low.front.downsampleOperator, 'max-pool-support-field-v0');

const lowFluid = new Float32Array(readFileSync(pair.low.fluid.path).buffer.slice(
  readFileSync(pair.low.fluid.path).byteOffset,
  readFileSync(pair.low.fluid.path).byteOffset + readFileSync(pair.low.fluid.path).byteLength,
));
const lowFrontBytes = readFileSync(pair.low.front.path);
const lowFront = new Float32Array(lowFrontBytes.buffer.slice(lowFrontBytes.byteOffset, lowFrontBytes.byteOffset + lowFrontBytes.byteLength));
assert.ok(lowFluid.every(Number.isFinite), 'downsampled fluid is finite');
assert.equal(lowFront[0], Math.fround(0.9), 'non-divisible max-pool preserves thin front support');

const truthHeld = JSON.parse(readFileSync(join(outDir, 'truth-high-held-manifest.json'), 'utf8'));
assert.equal(truthHeld.schema, 'kaminos.volume.phase-aligned-held-field.v0');
assert.equal(truthHeld.role, 'truthHigh');
assert.equal(truthHeld.initializationAuthority, 'offline-high-truth-held-render-only-v0');
assert.equal(truthHeld.runtimeTruthAvailable, true);
assert.equal(truthHeld.receiver.grid, highGrid);

const lowHeld = JSON.parse(readFileSync(join(outDir, 'low-phase-aligned-held-manifest.json'), 'utf8'));
assert.equal(lowHeld.schema, 'kaminos.volume.phase-aligned-held-field.v0');
assert.equal(lowHeld.role, 'lowPhaseAligned');
assert.equal(lowHeld.initializationAuthority, 'downsampled-same-high-history-held-control-v0');
assert.equal(lowHeld.runtimeTruthAvailable, false);
assert.equal(lowHeld.receiver.grid, lowGrid);

writeFileSync(fluid.path, Buffer.alloc(fluid.byteLength, 0xff));
const failedDir = join(fixtureRoot, 'failed');
const failedRun = spawnSync('python3', [
  packer,
  '--high-manifest', sourceManifestPath,
  '--low-grid', String(lowGrid),
  '--out-dir', failedDir,
], { encoding: 'utf8' });
assert.equal(failedRun.status, 2, 'corrupt source bytes fail the pair packer');
const failed = JSON.parse(readFileSync(join(failedDir, 'pair-manifest.json'), 'utf8'));
assert.equal(failed.status, 'failed');
assert.equal(failed.failurePhase, 'source-validation');
assert.ok(failed.lastTrustworthyEvidence.sourceManifestSha256);

console.log('phase-aligned field pair contracts passed');
