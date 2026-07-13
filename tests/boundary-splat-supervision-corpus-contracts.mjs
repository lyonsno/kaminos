import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleUrl = new URL('../boundary-splat-supervision-corpus.mjs', import.meta.url);
const source = await readFile(moduleUrl, 'utf8').catch(() => '');
assert.match(source, /validateBoundarySplatSupervisionCorpus/, 'supervision corpus validator must be explicit');

const { BOUNDARY_SPLAT_SUPERVISION_SCHEMA, validateBoundarySplatSupervisionCorpus } = await import(moduleUrl);
const root = await mkdtemp(join(tmpdir(), 'kaminos-splat-supervision-'));
try {
  const candidates = new Float32Array(19 * 2).fill(0.25);
  const candidateBytes = Buffer.from(candidates.buffer);
  const targetBytes = Buffer.from('not-a-real-png-but-nonblank-target-proof');
  const candidatePath = join(root, 'frame-000.candidates.f32');
  const targetPath = join(root, 'frame-000.raymarch.png');
  await writeFile(candidatePath, candidateBytes);
  await writeFile(targetPath, targetBytes);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const manifestPath = join(root, 'corpus.json');
  const manifest = {
    schema: BOUNDARY_SPLAT_SUPERVISION_SCHEMA,
    authority: 'live-simulator-frozen-state-candidate-raymarch-v0',
    featureOrder: [
      'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
      'material.density', 'material.heat', 'material.fuel', 'material.detail',
      'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
      'micro.x', 'micro.y', 'micro.z', 'micro.w',
    ],
    frames: [{
      id: 'frame-000',
      sameStateCaptureId: 'same-state-000',
      simStepCount: 144,
      grid: 160,
      requestedRoute: '?volume_boundary_splat_mode=analytic&volume_resolution=160',
      effectiveRoute: '?volume_boundary_splat_mode=analytic&volume_resolution=160',
      rendererIdentity: 'live-boundary-sidecar-analytic-splats-v0',
      sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
      fallbackReason: null,
      camera: { viewProjection: Array(16).fill(0).map((_, index) => index % 5 === 0 ? 1 : 0), viewport: [640, 480] },
      candidates: { path: candidatePath, bytes: candidateBytes.length, sha256: hash(candidateBytes), count: 2, strideFloats: 19, dtype: 'float32-le' },
      target: { path: targetPath, bytes: targetBytes.length, sha256: hash(targetBytes), authority: 'gpu-rgba8-raymarch-readback-frozen-sim-state', rendererIdentity: 'native-3d-compute-fluid-raymarch-v0' },
    }],
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
  const valid = await validateBoundarySplatSupervisionCorpus(manifestPath);
  assert.equal(valid.frameCount, 1);
  assert.equal(valid.candidateCount, 2);
  assert.match(valid.corpusIdentity, /^sha256:[a-f0-9]{64}$/);

  const fallback = structuredClone(manifest);
  fallback.frames[0].fallbackReason = 'raymarch-substitution';
  await writeFile(manifestPath, JSON.stringify(fallback));
  await assert.rejects(() => validateBoundarySplatSupervisionCorpus(manifestPath), /fallback/i);

  const staleHash = structuredClone(manifest);
  staleHash.frames[0].target.sha256 = '0'.repeat(64);
  await writeFile(manifestPath, JSON.stringify(staleHash));
  await assert.rejects(() => validateBoundarySplatSupervisionCorpus(manifestPath), /target.*sha256/i);

  const wrongStride = structuredClone(manifest);
  wrongStride.frames[0].candidates.count = 3;
  await writeFile(manifestPath, JSON.stringify(wrongStride));
  await assert.rejects(() => validateBoundarySplatSupervisionCorpus(manifestPath), /candidate.*bytes/i);

  const temporal = structuredClone(manifest);
  temporal.frames = Array.from({ length: 7 }, (_, index) => ({
    ...structuredClone(manifest.frames[0]),
    id: `frame-${index}`,
    sameStateCaptureId: `same-state-${index}`,
    simStepCount: 200 + index,
    candidates: {
      ...manifest.frames[0].candidates,
      path: candidatePath,
    },
    target: {
      ...manifest.frames[0].target,
      path: targetPath,
    },
  }));
  temporal.temporalAlignment = {
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
      { sourceFrameId: 'frame-6', targetFrameId: 'frame-0', offsetSteps: -6, sourceCount: 2, targetCount: 2, matchedSlots: 1, births: 1, deaths: 1, stableSupportCount: 1 },
      { sourceFrameId: 'frame-2', targetFrameId: 'frame-0', offsetSteps: -2, sourceCount: 2, targetCount: 2, matchedSlots: 2, births: 0, deaths: 0, stableSupportCount: 2 },
      { sourceFrameId: 'frame-1', targetFrameId: 'frame-0', offsetSteps: -1, sourceCount: 2, targetCount: 2, matchedSlots: 2, births: 0, deaths: 0, stableSupportCount: 2 },
      { sourceFrameId: 'frame-0', targetFrameId: 'frame-1', offsetSteps: 1, sourceCount: 2, targetCount: 2, matchedSlots: 2, births: 0, deaths: 0, stableSupportCount: 2 },
      { sourceFrameId: 'frame-0', targetFrameId: 'frame-2', offsetSteps: 2, sourceCount: 2, targetCount: 2, matchedSlots: 2, births: 0, deaths: 0, stableSupportCount: 2 },
      { sourceFrameId: 'frame-0', targetFrameId: 'frame-6', offsetSteps: 6, sourceCount: 2, targetCount: 2, matchedSlots: 1, births: 1, deaths: 1, stableSupportCount: 1 },
    ],
  };
  await writeFile(manifestPath, JSON.stringify(temporal));
  const temporalValid = await validateBoundarySplatSupervisionCorpus(manifestPath);
  assert.equal(temporalValid.temporalAlignment.positiveOffsetCount, 3);
  assert.equal(temporalValid.temporalAlignment.negativeOffsetCount, 3);
  assert.equal(temporalValid.temporalAlignment.hardOffsetCount, 2);
  assert.equal(temporalValid.temporalAlignment.totalBirths, 2);
  assert.equal(temporalValid.temporalAlignment.totalDeaths, 2);

  const nearestNeighborTemporal = structuredClone(temporal);
  nearestNeighborTemporal.temporalAlignment.alignmentMethod = 'nearest-neighbor';
  await writeFile(manifestPath, JSON.stringify(nearestNeighborTemporal));
  await assert.rejects(() => validateBoundarySplatSupervisionCorpus(manifestPath), /nearest-neighbor|grid-cell/i);

  const oneSidedOffsets = structuredClone(temporal);
  oneSidedOffsets.temporalAlignment.offsetSteps = [1, 2, 6];
  oneSidedOffsets.temporalAlignment.pairs = oneSidedOffsets.temporalAlignment.pairs.filter(pair => pair.offsetSteps > 0);
  await writeFile(manifestPath, JSON.stringify(oneSidedOffsets));
  await assert.rejects(() => validateBoundarySplatSupervisionCorpus(manifestPath), /positive.*negative.*offset/i);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('boundary splat supervision corpus contracts passed');
