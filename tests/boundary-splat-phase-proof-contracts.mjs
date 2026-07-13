import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BOUNDARY_SPLAT_PHASE_CORPUS_SCHEMA,
  BOUNDARY_SPLAT_PHASE_PROOF_SCHEMA,
  computeBoundarySplatPhaseProof,
  writeBoundarySplatPhaseProofPreview,
} from '../boundary-splat-phase-proof.mjs';
import { BOUNDARY_SPLAT_SUPERVISION_SCHEMA } from '../boundary-splat-supervision-corpus.mjs';

const root = await mkdtemp(join(tmpdir(), 'kaminos-phase-proof-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function candidateRows(frameIndex, rowCount) {
  const values = new Float32Array(rowCount * 19);
  for (let row = 0; row < rowCount; row += 1) {
    const base = row * 19;
    values[base] = row % 3;
    values[base + 1] = Math.floor(row / 3);
    values[base + 2] = 0;
    for (let feature = 0; feature < 16; feature += 1) {
      const slotSignal = row * 0.01 + feature * 0.001;
      const temporalSignal = frameIndex * (0.02 + feature * 0.0005);
      values[base + 3 + feature] = slotSignal + temporalSignal;
    }
  }
  return Buffer.from(values.buffer);
}

try {
  const targetBytes = Buffer.from('phase-proof-target');
  const targetPath = join(root, 'target.rgba');
  await writeFile(targetPath, targetBytes);
  const frames = [];
  for (let frameIndex = 0; frameIndex < 7; frameIndex += 1) {
    const candidateBytes = candidateRows(frameIndex, 9);
    const candidatePath = join(root, `frame-${frameIndex}.candidates.f32`);
    await writeFile(candidatePath, candidateBytes);
    frames.push({
      id: `frame-${frameIndex}`,
      sameStateCaptureId: `same-state-${frameIndex}`,
      simStepCount: 320 + frameIndex,
      grid: 160,
      requestedRoute: '?kaminos_volume_smoke=1&volume_boundary_splat_mode=learned',
      effectiveRoute: '?kaminos_volume_smoke=1&volume_boundary_splat_mode=learned',
      rendererIdentity: 'live-boundary-sidecar-analytic-splats-v0',
      sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
      fallbackReason: null,
      camera: { viewProjection: Array(16).fill(0).map((_, index) => index % 5 === 0 ? 1 : 0), viewport: [640, 480] },
      candidates: { path: candidatePath, bytes: candidateBytes.length, sha256: hash(candidateBytes), count: 9, strideFloats: 19, dtype: 'float32-le' },
      target: { path: targetPath, bytes: targetBytes.length, sha256: hash(targetBytes), authority: 'gpu-rgba8-raymarch-readback-frozen-sim-state', rendererIdentity: 'native-3d-compute-fluid-raymarch-v0' },
    });
  }
  const manifest = {
    schema: BOUNDARY_SPLAT_SUPERVISION_SCHEMA,
    authority: 'live-simulator-frozen-state-candidate-raymarch-v0',
    featureOrder: [
      'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
      'material.density', 'material.heat', 'material.fuel', 'material.detail',
      'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
      'micro.x', 'micro.y', 'micro.z', 'micro.w',
    ],
    frames,
    temporalAlignment: {
      schema: 'kaminos-boundary-splat-temporal-alignment-v0',
      identityKey: 'grid-cell-slot',
      alignmentMethod: 'grid-cell-slot',
      offsetSteps: [-6, -2, -1, 1, 2, 6],
      supportSemantics: {
        matched: 'same grid-cell slot is occupied in source and target',
        birth: 'target grid-cell slot is newly occupied relative to source',
        death: 'source grid-cell slot is absent from target',
      },
      pairs: [
        { sourceFrameId: 'frame-6', targetFrameId: 'frame-0', offsetSteps: -6, sourceCount: 9, targetCount: 9, matchedSlots: 8, births: 1, deaths: 1, stableSupportCount: 8 },
        { sourceFrameId: 'frame-2', targetFrameId: 'frame-0', offsetSteps: -2, sourceCount: 9, targetCount: 9, matchedSlots: 9, births: 0, deaths: 0, stableSupportCount: 9 },
        { sourceFrameId: 'frame-1', targetFrameId: 'frame-0', offsetSteps: -1, sourceCount: 9, targetCount: 9, matchedSlots: 9, births: 0, deaths: 0, stableSupportCount: 9 },
        { sourceFrameId: 'frame-0', targetFrameId: 'frame-1', offsetSteps: 1, sourceCount: 9, targetCount: 9, matchedSlots: 9, births: 0, deaths: 0, stableSupportCount: 9 },
        { sourceFrameId: 'frame-0', targetFrameId: 'frame-2', offsetSteps: 2, sourceCount: 9, targetCount: 9, matchedSlots: 9, births: 0, deaths: 0, stableSupportCount: 9 },
        { sourceFrameId: 'frame-0', targetFrameId: 'frame-6', offsetSteps: 6, sourceCount: 9, targetCount: 9, matchedSlots: 8, births: 1, deaths: 1, stableSupportCount: 8 },
      ],
    },
  };
  const manifestPath = join(root, 'phase-corpus.json');
  await writeFile(manifestPath, JSON.stringify(manifest));

  const proof = await computeBoundarySplatPhaseProof(manifestPath, { holdoutModulo: 3 });
  assert.equal(proof.schema, BOUNDARY_SPLAT_PHASE_PROOF_SCHEMA);
  assert.equal(proof.alignment.positiveOffsetCount, 3);
  assert.equal(proof.alignment.negativeOffsetCount, 3);
  assert.equal(proof.model.family, 'ridge-linear-offset-conditioned-v0');
  assert.ok(proof.model.holdoutSampleCount > 0);
  assert.ok(proof.identityBaseline.mse > 0);
  assert.ok(proof.phaseConditionedModel.mse < proof.identityBaseline.mse * 0.25, 'phase-conditioned model should beat identity on held-out offset signal');
  assert.equal(proof.advantage.beatsIdentity, true);
  assert.equal(proof.perOffset.length, 6);

  const phaseFrames = [];
  for (let frameIndex = 0; frameIndex < 7; frameIndex += 1) {
    const fullRows = new Float32Array(candidateRows(frameIndex, 9).buffer);
    const features = new Float32Array(9 * 16);
    for (let row = 0; row < 9; row += 1) {
      features.set(fullRows.slice(row * 19 + 3, row * 19 + 19), row * 16);
    }
    const featureBytes = Buffer.from(features.buffer);
    const featurePath = join(root, `phase-frame-${frameIndex}.features.f32`);
    await writeFile(featurePath, featureBytes);
    phaseFrames.push({
      id: `frame-${frameIndex}`,
      sameBrowserSessionId: 'same-browser-test',
      sameStateCaptureId: `same-state-${frameIndex}`,
      simStepCount: 320 + frameIndex,
      requestedRoute: '?kaminos_volume_smoke=1&volume_boundary_splat_mode=learned',
      effectiveRoute: '?kaminos_volume_smoke=1&volume_boundary_splat_mode=learned',
      rendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
      sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
      fallbackReason: null,
      candidates: { path: featurePath, bytes: featureBytes.length, sha256: hash(featureBytes), count: 9, strideFloats: 16, dtype: 'float32-le' },
    });
  }
  const phaseManifest = {
    schema: BOUNDARY_SPLAT_PHASE_CORPUS_SCHEMA,
    authority: 'live-simulator-controlled-step-selected-candidate-features-v0',
    featureOrder: manifest.featureOrder,
    frames: phaseFrames,
    temporalAlignment: manifest.temporalAlignment,
  };
  await writeFile(manifestPath, JSON.stringify(phaseManifest));
  const phaseProof = await computeBoundarySplatPhaseProof(manifestPath, { holdoutModulo: 3 });
  assert.equal(phaseProof.schema, BOUNDARY_SPLAT_PHASE_PROOF_SCHEMA);
  assert.equal(phaseProof.alignment.totalBirths, 2);
  assert.equal(phaseProof.advantage.beatsIdentity, true);

  const worldFrames = [];
  for (let frameIndex = 0; frameIndex < 7; frameIndex += 1) {
    const fullRows = new Float32Array(candidateRows(frameIndex, 9).buffer);
    const semanticOrder = frameIndex % 2 === 0
      ? Array.from({ length: 9 }, (_, index) => index)
      : Array.from({ length: 9 }, (_, index) => 8 - index);
    const features = new Float32Array(9 * 16);
    const splats = new Float32Array(9 * 12);
    for (const [compactIndex, semanticIndex] of semanticOrder.entries()) {
      features.set(fullRows.slice(semanticIndex * 19 + 3, semanticIndex * 19 + 19), compactIndex * 16);
      splats.set([
        (semanticIndex % 3) * 0.1, Math.floor(semanticIndex / 3) * 0.1, 0, 1,
        1, 0.5, 0.1, 0.02,
        0.04, 0.05, 0.5, 1,
      ], compactIndex * 12);
    }
    const featureBytes = Buffer.from(features.buffer);
    const splatBytes = Buffer.from(splats.buffer);
    const featurePath = join(root, `world-frame-${frameIndex}.features.f32`);
    const splatPath = join(root, `world-frame-${frameIndex}.splats.f32`);
    await writeFile(featurePath, featureBytes);
    await writeFile(splatPath, splatBytes);
    worldFrames.push({
      ...phaseFrames[frameIndex],
      candidates: { path: featurePath, bytes: featureBytes.length, sha256: hash(featureBytes), count: 9, strideFloats: 16, dtype: 'float32-le' },
      splats: {
        path: splatPath,
        bytes: splatBytes.length,
        sha256: hash(splatBytes),
        count: 9,
        strideFloats: 12,
        dtype: 'float32-le',
        authority: 'intercepted-live-boundary-splat-buffer-post-compaction-v0',
      },
    });
  }
  const worldManifest = {
    ...phaseManifest,
    frames: worldFrames,
    temporalAlignment: {
      ...manifest.temporalAlignment,
      identityKey: 'world-position-stable-key',
      alignmentMethod: 'world-position-stable-key',
      pairs: manifest.temporalAlignment.pairs.map(pair => ({
        ...pair,
        matchedSlots: 9,
        births: 0,
        deaths: 0,
        stableSupportCount: 9,
      })),
    },
  };
  await writeFile(manifestPath, JSON.stringify(worldManifest));
  const worldProof = await computeBoundarySplatPhaseProof(manifestPath, { holdoutModulo: 3 });
  assert.equal(worldProof.alignment.identityKey, 'world-position-stable-key');
  assert.equal(worldProof.model.sampleAlignment, 'world-position-stable-key', 'proof must record the actual sample alignment used by the model');
  assert.ok(worldProof.phaseConditionedModel.mse < worldProof.identityBaseline.mse * 0.25, 'world-position proof must survive compacted candidate reordering');

  const previewPath = join(root, 'phase-preview.png');
  const previewReportPath = join(root, 'phase-preview.json');
  await writeFile(manifestPath, JSON.stringify(phaseManifest));
  const preview = await writeBoundarySplatPhaseProofPreview(manifestPath, {
    out: previewPath,
    report: previewReportPath,
    holdoutModulo: 3,
    maxRowsPerOffset: 2,
  });
  const previewBytes = await readFile(previewPath);
  assert.equal(previewBytes.readUInt32BE(0), 0x89504e47, 'phase preview must write an inspectable PNG');
  assert.equal(preview.schema, 'kaminos-boundary-splat-phase-proof-preview-v0');
  assert.equal(preview.preview.authority, 'held-out-source-model-target-feature-state-png-v0');
  assert.equal(preview.blocks.join(','), 'source,modelPrediction,exactTarget');
  assert.ok(preview.holdoutRows.length >= 6, 'preview must include held-out rows across offsets');
  assert.equal(preview.proof.advantage.beatsIdentity, true);

  const noTemporal = structuredClone(manifest);
  delete noTemporal.temporalAlignment;
  await writeFile(manifestPath, JSON.stringify(noTemporal));
  await assert.rejects(() => computeBoundarySplatPhaseProof(manifestPath), /temporal alignment/i);

  const source = await readFile(new URL('../boundary-splat-phase-proof.mjs', import.meta.url), 'utf8');
  assert.match(source, /identityBaseline/, 'proof must preserve identity/current-state reuse baseline');
  assert.match(source, /offsetSteps\/maxAbsOffset/, 'proof must condition the model on signed phase offset');
  const witnessSource = await readFile(new URL('../boundary-splat-phase-corpus-witness.mjs', import.meta.url), 'utf8');
  assert.match(witnessSource, /--capture/, 'phase corpus witness must accept saved operator basin captures');
  assert.match(witnessSource, /readVolumeCaptureReplay/, 'phase corpus witness must load saved capture replay documents');
  assert.match(witnessSource, /replayCaptureControls/, 'phase corpus witness must reapply saved DOM controls before temporal feature capture');
  assert.match(witnessSource, /kaminosSetCameraDebugPose/, 'phase corpus witness must reapply saved camera pose for named basin replay');
  assert.match(witnessSource, /captureReplay/, 'phase corpus witness report must preserve capture replay identity');
  assert.match(witnessSource, /--live-sample-interval-ms/, 'phase corpus witness must support live-interval sampling when controlled stepping is too destructive');
  assert.match(witnessSource, /live-running-sample-sequence-v0/, 'live sampling must carry distinct sequence authority');
  assert.match(witnessSource, /captureBrowserSideFeatureFrame\(\{\s*advanceSim:\s*false/, 'live sampling must read feature frames without forcing simulator steps');
  assert.match(witnessSource, /captureBrowserSideFeatureFrame/, 'dense phase corpus witness must stage feature payloads browser-side before CDP transport');
  assert.match(witnessSource, /materializeBrowserSideFeatureCapture/, 'dense phase corpus witness must retrieve staged feature payloads without one giant Runtime.evaluate result');
  assert.match(witnessSource, /clearBrowserSideFeatureCapture/, 'dense phase corpus witness must release staged feature payloads after each frame');
  assert.match(witnessSource, /chunkCount/, 'chunked feature transport must report chunk count for evidence and false-closure checks');
  assert.match(witnessSource, /installBoundarySplatBufferInterceptor/, 'phase corpus witness must intercept live splat rows without editing the renderer');
  assert.match(witnessSource, /materializeBrowserSideSplatCapture/, 'phase corpus witness must persist world-position splat rows for honest temporal alignment');
  assert.match(witnessSource, /intercepted-live-boundary-splat-buffer-post-compaction-v0/, 'captured splat rows must carry explicit live-buffer authority');
  assert.match(witnessSource, /exceptionDetails/, 'CDP runtime exceptions must fail with their browser-side cause instead of undefined frame evidence');
  assert.match(witnessSource, /live-boundary-sidecar-analytic-splats-v0 candidates/, 'interceptor must match the physical splat buffer label, independent of learned attribute routing');
  assert.match(witnessSource, /splat capture payload was all-zero/, 'blank intercepted geometry must fail before it can become world-position evidence');
  assert.match(witnessSource, /render bind group/, 'interceptor must recover the candidate buffer from the actual render bind group, not buffer-label recency alone');
  assert.match(witnessSource, /pushErrorScope\('validation'\)/, 'intercepted GPU copies must surface WebGPU validation errors');
  assert.match(witnessSource, /GPUQueue.*writeBuffer/, 'camera uniforms must be captured from their CPU write because the uniform buffer lacks COPY_SRC');
  assert.match(witnessSource, /GPUCommandEncoder.*copyBufferToBuffer/, 'splat capture must intercept the feature witness encoder instead of copying a later profiled state');
  assert.match(witnessSource, /same-encoder-feature-splat-count-v0/, 'captured geometry must name its same-encoder alignment authority');
  assert.match(witnessSource, /drawState\[1\]/, 'same-encoder capture must use the GPU indirect instance count rather than stale sampled state');
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('boundary splat phase proof contracts passed');
