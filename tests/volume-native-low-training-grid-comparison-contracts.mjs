#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const assembler = join(root, 'volume-native-low-training-grid-compare.mjs');
assert.ok(existsSync(assembler), 'native-low training-grid comparison assembler exists');

const fixture = mkdtempSync(join(tmpdir(), 'kaminos-native-low-training-grid-compare-'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (name, value) => {
  const path = join(fixture, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
};
const pngHeader = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de', 'hex');
const image = name => {
  const path = join(fixture, `${name}.png`);
  const png = Buffer.concat([pngHeader, Buffer.from(name)]);
  writeFileSync(path, png);
  return { path, byteLength: png.byteLength, sha256: sha256(png) };
};
const stateIdentity = 'a'.repeat(64);
const native = writeJson('native.json', {
  schema: 'kaminos.volume.full-grid-field-export.v0',
  status: 'captured',
  failurePhase: null,
  grid: 96,
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
});
function application(name, trainedLowGrid, crossGridApplication) {
  return writeJson(`${name}.application.json`, {
    schema: 'kaminos.volume.native-low-selective-composition.v0',
    status: 'captured',
    failurePhase: null,
    inputAuthority: 'native-low-simulator-state-no-synthetic-downsample-v0',
    runtimeTruthAvailable: false,
    sameNativeStateIdentity: stateIdentity,
    model: {
      identity: `exact-basin-selective-carrier-heads-160-to-${trainedLowGrid}-v0`,
      trainedLowGrid,
      trainedHighGrid: 160,
      trainingPairAuthority: 'downsampled-same-high-history-input-to-exact-high-target',
      trainingInputAuthority: 'phase-aligned-high-filtered-to-low-grid-v0',
      trainingInputSyntheticDownsample: true,
      nativeDeploymentInputSeenDuringTraining: false,
      features: { lowFieldCount: 17, squaredLowFieldCount: 17 },
    },
    relationship: {
      trainedLowGrid,
      applicationLowGrid: 96,
      outputGrid: 160,
      crossGridApplication,
      syntheticDownsampleApplied: false,
    },
  });
}
function witness(name, applicationPath, treatmentImage, overrides = {}) {
  return writeJson(`${name}.witness.json`, {
    schema: 'kaminos.volume.native-low-selective-witness.v0',
    status: 'captured',
    failurePhase: null,
    sameNativeStateIdentity: stateIdentity,
    relationship: JSON.parse(readFileSync(applicationPath)).relationship,
    renderer: {
      requested: 'splat-only-v0',
      controlEffective: 'splat-only-v0',
      treatmentEffective: 'splat-only-v0',
      raymarchExcludedFromDiscriminant: true,
      ...overrides,
    },
    roles: {
      nativeLowControl: { grid: 96, sameNativeStateIdentity: stateIdentity, image: image(`${name}.control`) },
      nativeLowSelectivePredicted: { grid: 160, sameNativeStateIdentity: stateIdentity, image: treatmentImage },
    },
    sources: {
      nativeManifest: { path: native, sha256: sha256(readFileSync(native)) },
      predictedManifest: { path: applicationPath, sha256: sha256(readFileSync(applicationPath)) },
    },
  });
}

const baselineApplication = application('baseline', 128, true);
const candidateApplication = application('candidate', 96, false);
const baselineWitness = witness('baseline', baselineApplication, image('baseline.treatment'));
const candidateWitness = witness('candidate', candidateApplication, image('candidate.treatment'));
const outDir = join(fixture, 'out');
const args = [
  assembler,
  '--native-manifest', native,
  '--baseline-application-manifest', baselineApplication,
  '--baseline-witness-manifest', baselineWitness,
  '--candidate-application-manifest', candidateApplication,
  '--candidate-witness-manifest', candidateWitness,
  '--out-dir', outDir,
];
const pass = spawnSync('node', args, { encoding: 'utf8' });
assert.equal(pass.status, 0, pass.stderr || pass.stdout);
const report = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
assert.equal(report.status, 'captured');
assert.equal(report.roles.native96Control.grid, 96);
assert.equal(report.roles.baseline128Trained.modelTrainedLowGrid, 128);
assert.equal(report.roles.candidate96Trained.modelTrainedLowGrid, 96);
assert.equal(report.sameNativeStateIdentity, stateIdentity);
assert.equal(report.runtimeTruthAvailable, false);
assert.ok(existsSync(join(outDir, 'index.html')));

const lyingWitness = witness('lying', candidateApplication, image('lying.treatment'), {
  raymarchExcludedFromDiscriminant: false,
});
const failedDir = join(fixture, 'failed');
const failed = spawnSync('node', [
  ...args.slice(0, -1), failedDir,
  '--candidate-witness-manifest', lyingWitness,
], { encoding: 'utf8' });
assert.notEqual(failed.status, 0, 'raymarch-contaminated treatment must fail closed');
const failedReport = JSON.parse(readFileSync(join(failedDir, 'manifest.json'), 'utf8'));
assert.equal(failedReport.status, 'failed');
assert.equal(failedReport.failurePhase, 'input-validation');
assert.match(failedReport.error, /raymarch/i);

console.log('native-low training-grid comparison contracts passed');
