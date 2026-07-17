#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const analyzerPath = join(root, 'volume-render-visible-delta-concentration.py');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-visible-delta-'));
const sourceDir = join(fixtureRoot, 'source');
const outDir = join(fixtureRoot, 'out');
mkdirSync(sourceDir, { recursive: true });

const sha256File = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function writePpm(path, changed = false) {
  const width = 8;
  const height = 8;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = 20 + x * 5;
      pixels[offset + 1] = 15 + y * 4;
      pixels[offset + 2] = 10;
      if (changed && x >= 3 && x <= 5 && y >= 2 && y <= 6) {
        pixels[offset] += 30;
        pixels[offset + 1] += 15;
      }
    }
  }
  writeFileSync(path, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
}

const deterministicPath = join(sourceDir, 'deterministic.ppm');
const learnedPath = join(sourceDir, 'learned.ppm');
writePpm(deterministicPath, false);
writePpm(learnedPath, true);

const frameManifestPath = join(sourceDir, 'frame-0000.json');
const frameManifest = {
  schema: 'kaminos.volume.native-low-selective-motion-frame.v0',
  status: 'captured',
  failurePhase: null,
  frameIndex: 0,
  simulationStep: 97,
  roles: {
    deterministicMaterializedControl: {
      requestedComposition: 'raymarch-only-v0',
      effectiveComposition: 'raymarch-only-v0',
      raymarchApplied: true,
      splatApplied: false,
      backend: 'WebGPU:apple',
      grid: 160,
      sameNativeStateIdentity: 'same-native-state-v0',
      image: { path: deterministicPath, byteLength: readFileSync(deterministicPath).byteLength, sha256: sha256File(deterministicPath) },
    },
    nativeLowSelectivePredicted: {
      requestedComposition: 'raymarch-only-v0',
      effectiveComposition: 'raymarch-only-v0',
      raymarchApplied: true,
      splatApplied: false,
      backend: 'WebGPU:apple',
      grid: 160,
      sameNativeStateIdentity: 'same-native-state-v0',
      image: { path: learnedPath, byteLength: readFileSync(learnedPath).byteLength, sha256: sha256File(learnedPath) },
    },
  },
};
writeFileSync(frameManifestPath, `${JSON.stringify(frameManifest, null, 2)}\n`);

const producerManifestPath = join(sourceDir, 'producer.json');
const producerManifest = {
  schema: 'kaminos.volume.native-low-selective-motion-producer.v0',
  identity: 'contract-native96-motion-v0',
  status: 'captured',
  failurePhase: null,
  runtimeTruthAvailable: false,
  renderCompositionRequested: 'raymarch-only-v0',
  frameCount: 1,
  simulationSteps: [97],
  roles: ['nativeLowControl', 'deterministicMaterializedControl', 'nativeLowSelectivePredicted'],
  model: { identity: 'contract-front-model-v0', modelSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64) },
  frameManifests: [frameManifestPath],
};
writeFileSync(producerManifestPath, `${JSON.stringify(producerManifest, null, 2)}\n`);

function run(outputDir) {
  return spawnSync('python3', [
    analyzerPath,
    '--producer-manifest', producerManifestPath,
    '--out-dir', outputDir,
    '--fractions', '0.05,0.10,0.20',
    '--representative-frame-indexes', '0',
  ], { encoding: 'utf8' });
}

const result = run(outDir);
assert.equal(result.status, 0, result.stderr || result.stdout);
const report = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
assert.equal(report.schema, 'kaminos.volume.render-visible-delta-concentration.v0');
assert.equal(report.status, 'captured');
assert.equal(report.failurePhase, null);
assert.equal(report.route.requested, 'ffmpeg-rgb24-srgb-visible-delta-v0');
assert.equal(report.route.effective, 'ffmpeg-rgb24-srgb-visible-delta-v0');
assert.equal(report.route.backend, 'cpu-ffmpeg-rawvideo');
assert.equal(report.source.producerManifestSha256, sha256File(producerManifestPath));
assert.equal(report.source.model.identity, 'contract-front-model-v0');
assert.equal(report.runtimeTruthAvailable, false);
assert.equal(report.frameCountRequested, 1);
assert.equal(report.frameCountProcessed, 1);
assert.equal(report.hiddenFrameCap, false);
assert.deepEqual(report.fractions, [0.05, 0.1, 0.2]);
assert.equal(report.frames[0].sameNativeStateIdentity, 'same-native-state-v0');
assert.equal(report.frames[0].effectiveComposition, 'raymarch-only-v0');
assert.equal(report.frames[0].backend, 'WebGPU:apple');
assert.ok(report.frames[0].visibleDeltaEnergy > 0);
assert.ok(report.frames[0].topPixelFractionEnergyRetention['0.20'] > report.frames[0].topPixelFractionEnergyRetention['0.05']);
assert.equal(report.oracle.authority, 'post-render-learned-delta-top-energy-mask-diagnostic-only-v0');
assert.equal(report.oracle.runtimeApplicable, false);
assert.deepEqual(report.contacts.deltaEnergy.columnOrder, [
  'deterministicMaterializedControl',
  'nativeLowSelectivePredicted',
  'visibleDeltaEnergy',
]);
assert.deepEqual(report.contacts.oracleRetention.columnOrder, [
  'deterministicMaterializedControl',
  'nativeLowSelectivePredicted',
  'top0.05VisibleDelta',
  'top0.10VisibleDelta',
  'top0.20VisibleDelta',
]);
assert.equal(report.contacts.deltaEnergy.labelsEmbedded, true);
assert.equal(report.contacts.oracleRetention.labelsEmbedded, true);
for (const artifact of Object.values(report.artifacts)) {
  assert.equal(artifact.sha256, sha256File(artifact.path));
  assert.ok(artifact.byteLength > 0);
  assert.ok(existsSync(artifact.path));
}

const tamperedDir = join(fixtureRoot, 'tampered');
const learnedBytes = readFileSync(learnedPath);
learnedBytes[learnedBytes.length - 1] ^= 0xff;
writeFileSync(learnedPath, learnedBytes);
const tampered = run(tamperedDir);
assert.notEqual(tampered.status, 0, 'image checksum drift must fail before analysis output');
const failed = JSON.parse(readFileSync(join(tamperedDir, 'manifest.json'), 'utf8'));
assert.equal(failed.status, 'failed');
assert.equal(failed.failurePhase, 'input-validation');
assert.match(failed.reason, /sha-?256 mismatch/i);
assert.equal(failed.lastTrustworthyEvidence.producerManifestSha256, sha256File(producerManifestPath));
assert.equal(existsSync(join(tamperedDir, 'delta-energy-contact.png')), false);
assert.equal(existsSync(join(tamperedDir, 'oracle-retention-contact.png')), false);

console.log('visible-delta concentration contracts passed');
