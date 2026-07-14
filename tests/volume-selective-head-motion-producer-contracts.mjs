#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const producer = join(root, 'volume-selective-head-motion-produce.mjs');
assert.ok(existsSync(producer), 'selective-head temporal producer exists');

const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-selective-producer-contract-'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceCapturePath = join(fixtureRoot, 'source-capture.json');
const pairPath = join(fixtureRoot, 'training-pair.json');
const probePath = join(fixtureRoot, 'support-probe.json');
const sourceCaptureSha = 'a'.repeat(64);

writeFileSync(sourceCapturePath, `${JSON.stringify({
  schema: 'kaminos.operator-exact-live-splat-basin-capture.v1',
  identity: 'contract-source-capture',
  payloadSha256: sourceCaptureSha,
  replayRoute: 'http://127.0.0.1:18000/?kaminos_volume_smoke=1&volume_resolution=160',
}, null, 2)}\n`);
writeFileSync(pairPath, `${JSON.stringify({
  schema: 'kaminos.volume.full-grid-field-pair.v0',
  identity: 'contract-training-pair',
  status: 'captured',
  failurePhase: null,
  authority: 'downsampled-same-high-history-input-to-exact-high-target',
  lowGrid: 128,
  highGrid: 160,
  source: {
    exactBasinSourceCaptureSha256: sourceCaptureSha,
    deterministicReplay: {
      identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
      completedSteps: 96,
      simStepCount: 96,
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      controlsSignature: 'contract-controls-signature',
      timeStepMs: 1000 / 60,
    },
  },
}, null, 2)}\n`);
const pairSha = sha256(readFileSync(pairPath));
writeFileSync(probePath, `${JSON.stringify({
  schema: 'kaminos.volume.exact-basin-support-probe.v0',
  identity: 'contract-support-probe',
  status: 'captured',
  failurePhase: null,
  inputs: {
    pairManifest: { path: pairPath, sha256: pairSha },
    lowGrid: 128,
    highGrid: 160,
  },
  artifacts: {
    classifier: { path: join(fixtureRoot, 'classifier.npz'), sha256: 'b'.repeat(64) },
    channelHeads: { path: join(fixtureRoot, 'heads.npz'), sha256: 'c'.repeat(64) },
  },
}, null, 2)}\n`);

function run(extra, outName = 'out') {
  const outDir = join(fixtureRoot, outName);
  const result = spawnSync(process.execPath, [
    producer,
    '--source-capture', sourceCapturePath,
    '--support-probe-manifest', probePath,
    '--target-origin', 'http://127.0.0.1:18100',
    '--out-dir', outDir,
    '--start-step', '97',
    '--frame-count', '2',
    '--support-threshold', '0.98',
    '--calibrated-residual-scale', '0.5',
    '--plan-only',
    ...extra,
  ], { encoding: 'utf8' });
  return { result, outDir };
}

const planned = run([]);
assert.equal(planned.result.status, 0, planned.result.stderr || planned.result.stdout);
const manifest = JSON.parse(readFileSync(join(planned.outDir, 'producer-manifest.json'), 'utf8'));
assert.equal(manifest.schema, 'kaminos.volume.selective-head-motion-producer.v0');
assert.equal(manifest.status, 'planned');
assert.equal(manifest.failurePhase, null);
assert.equal(manifest.executionAuthority, 'plan-only-no-gpu-work-performed-v0');
assert.deepEqual(manifest.simulationSteps, [97, 98]);
assert.equal(manifest.trainingStep, 96);
assert.equal(manifest.lowGrid, 128);
assert.equal(manifest.highGrid, 160);
assert.equal(manifest.supportThreshold, 0.98);
assert.equal(manifest.calibratedResidualScale, 0.5);
assert.equal(manifest.partialFlowDebugMix, 0.625);
assert.equal(manifest.renderComposition, 'raymarch-under-splats-v0');
assert.equal(manifest.frames.length, 2);
assert.deepEqual(manifest.frames[0].roles, [
  'truthHigh',
  'lowPhaseAligned',
  'selectiveFullResidual',
  'selectiveCalibratedResidual',
]);
assert.equal(manifest.frames[0].commands.highExport.includes('--deterministic-replay-steps 97'), true);
assert.equal(manifest.frames[1].commands.highExport.includes('--deterministic-replay-steps 98'), true);
assert.match(manifest.frames[0].commands.selectiveFullResidual, /--residual-scale 1/);
assert.match(manifest.frames[0].commands.selectiveCalibratedResidual, /--residual-scale 0\.5/);
assert.match(manifest.frames[0].commands.selectiveCalibratedResidual, /--checkpoint-transfer-mode consecutive-phase-aligned-sequence-v0/);
assert.match(manifest.frames[0].commands.renders.truthHigh, /--secondary-render-png/);
assert.match(manifest.frames[0].commands.renders.truthHigh, /--render-composition raymarch-under-splats-v0/);
assert.match(manifest.frames[0].commands.renders.truthHigh, /flowDebug/);
assert.equal(manifest.retention.ephemeralFieldArtifactsDeletedAfterFrameReceipt, true);
assert.equal(manifest.temporalAuthority, 'consecutive-phase-aligned-per-frame-frozen-model-application-v0');
assert.equal(manifest.recurrentPrediction, false);
assert.equal(manifest.staticSidecarOverMovingMaterial, false);

const badStart = run(['--start-step', '98'], 'bad-start');
assert.notEqual(badStart.result.status, 0, 'sequence cannot skip the first post-training step');
const badStartManifest = JSON.parse(readFileSync(join(badStart.outDir, 'producer-manifest.json'), 'utf8'));
assert.equal(badStartManifest.status, 'failed');
assert.equal(badStartManifest.failurePhase, 'sequence-validation');

const badMix = run(['--partial-flow-debug-mix', '0.9'], 'bad-mix');
assert.notEqual(badMix.result.status, 0, 'partial debug mix must remain inside the witness contract');
const badMixManifest = JSON.parse(readFileSync(join(badMix.outDir, 'producer-manifest.json'), 'utf8'));
assert.equal(badMixManifest.failurePhase, 'render-contract-validation');

console.log('selective-head motion producer contracts passed');
