import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const script = join(root, 'volume-selective-head-motion-witness.mjs');
const fixtureRoot = join(tmpdir(), `kaminos-selective-motion-contract-${process.pid}`);
rmSync(fixtureRoot, { recursive: true, force: true });
mkdirSync(fixtureRoot, { recursive: true });

const roles = [
  'truthHigh',
  'lowPhaseAligned',
  'selectiveFullResidual',
  'selectiveCalibratedResidual',
];
const beautyControlOverrides = {
  fireRenderMode: 'off', fire: 0, radiance: 0, glow: 0, shellAmount: 0,
  density: 0.25, smoke: 0.25, flowDebug: 0,
};

function writeFrame(frameIndex, simStep, overrides = {}, variant = 'base', composition = 'raymarch-under-splats-v0') {
  const frameDir = join(fixtureRoot, `${variant}-frame-${String(frameIndex).padStart(3, '0')}`);
  mkdirSync(frameDir, { recursive: true });
  const captures = Object.fromEntries(roles.map(role => {
    const beauty = join(frameDir, `${role}-beauty.png`);
    const partial = join(frameDir, `${role}-partial-flow.png`);
    writeFileSync(beauty, `beauty:${frameIndex}:${role}`);
    writeFileSync(partial, `partial:${frameIndex}:${role}`);
    const beautySha256 = createHash('sha256').update(readFileSync(beauty)).digest('hex');
    const partialSha256 = createHash('sha256').update(readFileSync(partial)).digest('hex');
    const renderReceipt = {
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      backend: 'WebGPU:apple',
      composition,
      learnedDecoder: 'live-boundary-sidecar-learned-attribute-splats-v0',
      learnedDecoderModel: 'sha256:decoder-model',
      renderControlSignature: 'sha256:render-controls',
      fallback: null,
      controlOverrides: { ...beautyControlOverrides },
      viewportContract: {
        identity: 'cdp-emulation-fixed-device-metrics-v0',
        requested: { width: 1620, height: 633, deviceScaleFactor: 2 },
        effective: { width: 1620, height: 633, deviceScaleFactor: 2 },
      },
      canvas: {
        cssRect: { x: 0, y: 0, width: 1240, height: 633 },
        renderWidth: 2480,
        renderHeight: 1266,
        devicePixelRatio: 2,
      },
      boundarySplatCandidateCount: role === 'truthHigh' ? 120000 : 100000,
      boundarySplatInstanceCount: role === 'truthHigh' ? 120000 : 100000,
      boundarySplatOverflowCount: 0,
    };
    return [role, {
      role,
      beauty: { path: beauty, sha256: beautySha256 },
      partialFlowDebug: {
        path: partial,
        sha256: partialSha256,
        requestedMix: 0.625,
        effectiveMix: 0.625,
        applicationAuthority: 'render-only-control-override-v0',
        renderReceipt: {
          ...renderReceipt,
          renderControlSignature: 'sha256:partial-render-controls',
          controlOverrides: { ...beautyControlOverrides, flowDebug: 0.625 },
        },
      },
      renderReceipt,
    }];
  }));
  const frame = {
    schema: 'kaminos.volume.selective-head-motion-frame.v0',
    status: 'captured',
    failurePhase: null,
    sequenceIdentity: 'contract-sequence',
    frameIndex,
    simulationStep: simStep,
    simulationTimeMs: simStep * (1000 / 60),
    cadenceMs: 1000 / 60,
    cameraIdentity: 'fixed-camera-v0',
    cropIdentity: 'fixed-canvas-crop-v0',
    sourceCaptureSha256: 'source-capture-sha',
    phaseAlignedPairAuthority: 'same-high-history-filtered-low-v0',
    selectiveModelIdentity: 'sha256:selective-model',
    supportThreshold: 0.92476779,
    calibratedResidualScale: 0.5,
    beautyControlOverrides,
    captures,
    ...overrides,
  };
  const path = join(frameDir, 'manifest.json');
  writeFileSync(path, `${JSON.stringify(frame, null, 2)}\n`);
  return path;
}

function run(framePaths, name, expectedComposition = 'raymarch-under-splats-v0') {
  const outDir = join(fixtureRoot, name);
  const result = spawnSync(process.execPath, [
    script,
    ...framePaths.flatMap(path => ['--frame-manifest', path]),
    '--out-dir', outDir,
    '--expected-frame-count', String(framePaths.length),
    '--expected-viewport-size', '1620,633',
    '--expected-canvas-size', '1240,633',
    '--expected-device-scale-factor', '2',
    '--expected-composition', expectedComposition,
  ], { encoding: 'utf8' });
  return { result, outDir };
}

const frame0 = writeFrame(0, 96);
const frame1 = writeFrame(1, 97);
const valid = run([frame0, frame1], 'valid');
assert.equal(valid.result.status, 0, valid.result.stderr || valid.result.stdout);

const manifest = JSON.parse(readFileSync(join(valid.outDir, 'manifest.json'), 'utf8'));
assert.equal(manifest.schema, 'kaminos.volume.selective-head-motion-witness.v0');
assert.equal(manifest.status, 'captured');
assert.equal(manifest.failurePhase, null);
assert.equal(manifest.frameCount, 2);
assert.deepEqual(manifest.roles, roles);
assert.deepEqual(manifest.simulationSteps, [96, 97]);
assert.equal(manifest.partialFlowDebug.requestedMix, 0.625);
assert.equal(manifest.partialFlowDebug.effectiveMix, 0.625);
assert.equal(manifest.partialFlowDebug.applicationAuthority, 'render-only-control-override-v0');
assert.equal(manifest.temporalAuthority, 'consecutive-phase-aligned-per-frame-frozen-model-application-v0');
assert.equal(manifest.recurrentPrediction, false);
assert.equal(manifest.staticSidecarOverMovingMaterial, false);
assert.equal(manifest.sourceCaptureSha256, 'source-capture-sha');
assert.equal(manifest.selectiveModelIdentity, 'sha256:selective-model');
assert.equal(manifest.renderIdentity.composition, 'raymarch-under-splats-v0');
assert.deepEqual(manifest.geometryIdentity.viewport, { width: 1620, height: 633, deviceScaleFactor: 2 });
assert.deepEqual(manifest.geometryIdentity.canvas, { width: 1240, height: 633, renderWidth: 2480, renderHeight: 1266 });
assert.equal(manifest.frames[0].captures.truthHigh.partialFlowDebug.path.endsWith('truthHigh-partial-flow.png'), true);

const raymarchFrame0 = writeFrame(0, 96, {}, 'raymarch-only', 'raymarch-only-v0');
const raymarchFrame1 = writeFrame(1, 97, {}, 'raymarch-only', 'raymarch-only-v0');
const raymarchOnly = run([raymarchFrame0, raymarchFrame1], 'raymarch-only', 'raymarch-only-v0');
assert.equal(raymarchOnly.result.status, 0, raymarchOnly.result.stderr || raymarchOnly.result.stdout);
const raymarchManifest = JSON.parse(readFileSync(join(raymarchOnly.outDir, 'manifest.json'), 'utf8'));
assert.equal(raymarchManifest.renderIdentity.composition, 'raymarch-only-v0');

const wrongExpectedComposition = run([raymarchFrame0, raymarchFrame1], 'wrong-composition', 'raymarch-under-splats-v0');
assert.notEqual(wrongExpectedComposition.result.status, 0, 'effective composition drift must fail');
assert.equal(
  JSON.parse(readFileSync(join(wrongExpectedComposition.outDir, 'manifest.json'), 'utf8')).failurePhase,
  'render-identity-validation',
);

const controlDriftPayload = JSON.parse(readFileSync(frame1, 'utf8'));
controlDriftPayload.captures.selectiveFullResidual.renderReceipt.controlOverrides.density = 0.75;
const controlDriftFrame = join(fixtureRoot, 'control-drift.json');
writeFileSync(controlDriftFrame, JSON.stringify(controlDriftPayload, null, 2));
const controlDrift = run([frame0, controlDriftFrame], 'control-drift');
assert.notEqual(controlDrift.result.status, 0, 'effective non-flow control substitution must fail');
assert.equal(
  JSON.parse(readFileSync(join(controlDrift.outDir, 'manifest.json'), 'utf8')).failurePhase,
  'render-identity-validation',
);

const missingControlAuthorityPaths = [frame0, frame1].map((framePath, index) => {
  const payload = JSON.parse(readFileSync(framePath, 'utf8'));
  delete payload.beautyControlOverrides;
  const path = join(fixtureRoot, `missing-control-authority-${index}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2));
  return path;
});
const missingControlAuthority = run(missingControlAuthorityPaths, 'missing-control-authority');
assert.notEqual(missingControlAuthority.result.status, 0, 'missing requested-control authority must fail');
assert.equal(
  JSON.parse(readFileSync(join(missingControlAuthority.outDir, 'manifest.json'), 'utf8')).failurePhase,
  'temporal-validation',
);

const partialSignatureDriftPayload = JSON.parse(readFileSync(frame1, 'utf8'));
partialSignatureDriftPayload.captures.selectiveFullResidual.partialFlowDebug.renderReceipt.renderControlSignature = 'sha256:drift';
const partialSignatureDriftFrame = join(fixtureRoot, 'partial-signature-drift.json');
writeFileSync(partialSignatureDriftFrame, JSON.stringify(partialSignatureDriftPayload, null, 2));
const partialSignatureDrift = run([frame0, partialSignatureDriftFrame], 'partial-signature-drift');
assert.notEqual(partialSignatureDrift.result.status, 0, 'partial debug signature drift must fail against partial debug, not beauty');

const html = readFileSync(join(valid.outDir, 'index.html'), 'utf8');
assert.match(html, /Truth high/);
assert.match(html, /Low phase-aligned control/);
assert.match(html, /Selective full residual/);
assert.match(html, /Selective calibrated residual/);
assert.match(html, /62\.5% flow debug/);
assert.match(html, /data-frame-index="1"/);
assert.match(html, /Playback/);

const skipped = run([frame0, writeFrame(1, 98, {}, 'skipped')], 'skipped-step');
assert.notEqual(skipped.result.status, 0, 'skipped simulation steps must fail');
const skippedReport = JSON.parse(readFileSync(join(skipped.outDir, 'manifest.json'), 'utf8'));
assert.equal(skippedReport.status, 'failed');
assert.equal(skippedReport.failurePhase, 'temporal-validation');

const missingControlFrame = writeFrame(1, 97, {
  captures: Object.fromEntries(Object.entries(JSON.parse(readFileSync(frame1, 'utf8')).captures)
    .filter(([role]) => role !== 'lowPhaseAligned')),
}, 'missing-control');
const missingControl = run([frame0, missingControlFrame], 'missing-control');
assert.notEqual(missingControl.result.status, 0, 'missing low control must fail');

const driftFramePayload = JSON.parse(readFileSync(frame1, 'utf8'));
driftFramePayload.captures.selectiveFullResidual.partialFlowDebug.effectiveMix = 1;
const driftFrame = join(fixtureRoot, 'debug-drift.json');
writeFileSync(driftFrame, JSON.stringify(driftFramePayload, null, 2));
const debugDrift = run([frame0, driftFrame], 'debug-drift');
assert.notEqual(debugDrift.result.status, 0, 'effective partial-debug drift must fail');
const debugReport = JSON.parse(readFileSync(join(debugDrift.outDir, 'manifest.json'), 'utf8'));
assert.equal(debugReport.failurePhase, 'render-identity-validation');

const missingImagePayload = JSON.parse(readFileSync(frame1, 'utf8'));
missingImagePayload.captures.truthHigh.beauty.path = join(fixtureRoot, 'missing.png');
const missingImageFrame = join(fixtureRoot, 'missing-image.json');
writeFileSync(missingImageFrame, JSON.stringify(missingImagePayload, null, 2));
const missingImage = run([frame0, missingImageFrame], 'missing-image');
assert.notEqual(missingImage.result.status, 0, 'missing visual output must fail');
const missingImageReport = JSON.parse(readFileSync(join(missingImage.outDir, 'manifest.json'), 'utf8'));
assert.equal(missingImageReport.failurePhase, 'artifact-validation');

const overflowPayload = JSON.parse(readFileSync(frame1, 'utf8'));
overflowPayload.captures.selectiveFullResidual.renderReceipt.boundarySplatOverflowCount = 1;
const overflowFrame = join(fixtureRoot, 'capacity-overflow.json');
writeFileSync(overflowFrame, JSON.stringify(overflowPayload, null, 2));
const overflow = run([frame0, overflowFrame], 'capacity-overflow');
assert.notEqual(overflow.result.status, 0, 'capacity overflow must fail instead of silently clipping the learned field');
const overflowReport = JSON.parse(readFileSync(join(overflow.outDir, 'manifest.json'), 'utf8'));
assert.equal(overflowReport.failurePhase, 'render-identity-validation');

const missingGeometryPayload = JSON.parse(readFileSync(frame1, 'utf8'));
delete missingGeometryPayload.captures.truthHigh.renderReceipt.viewportContract;
const missingGeometryFrame = join(fixtureRoot, 'missing-geometry.json');
writeFileSync(missingGeometryFrame, JSON.stringify(missingGeometryPayload, null, 2));
const missingGeometry = run([frame0, missingGeometryFrame], 'missing-geometry');
assert.notEqual(missingGeometry.result.status, 0, 'legacy or stale frame without viewport custody must fail');
assert.equal(JSON.parse(readFileSync(join(missingGeometry.outDir, 'manifest.json'), 'utf8')).failurePhase, 'render-identity-validation');

const partialFallbackPayload = JSON.parse(readFileSync(frame1, 'utf8'));
partialFallbackPayload.captures.selectiveFullResidual.partialFlowDebug.renderReceipt.fallback = 'secondary-render-fallback';
const partialFallbackFrame = join(fixtureRoot, 'partial-fallback.json');
writeFileSync(partialFallbackFrame, JSON.stringify(partialFallbackPayload, null, 2));
const partialFallback = run([frame0, partialFallbackFrame], 'partial-fallback');
assert.notEqual(partialFallback.result.status, 0, 'partial-debug fallback must fail independently of clean beauty evidence');
assert.equal(JSON.parse(readFileSync(join(partialFallback.outDir, 'manifest.json'), 'utf8')).failurePhase, 'render-identity-validation');

rmSync(fixtureRoot, { recursive: true, force: true });
