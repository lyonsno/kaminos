import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleUrl = new URL('../boundary-splat-supervision-corpus.mjs', import.meta.url);
const source = await readFile(moduleUrl, 'utf8').catch(() => '');
assert.match(source, /validateBoundarySplatSupervisionCorpus/, 'supervision corpus validator must be explicit');

const {
  BOUNDARY_SPLAT_SUPERVISION_SCHEMA,
  BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER,
  settleBoundarySplatRawRelease,
  validateBoundarySplatSupervisionCorpus,
} = await import(moduleUrl);

{
  const transportError = new Error('structure transport failed');
  const successfulCleanup = await settleBoundarySplatRawRelease({
    primaryError: transportError,
    primaryPhase: 'transport-raw-sidecar-structure-frame-000',
    releasePhase: 'release-raw-sidecar-frame-000',
    release: async () => ({ ok: true, released: true }),
  });
  assert.equal(successfulCleanup.phase, 'transport-raw-sidecar-structure-frame-000');
  assert.equal(successfulCleanup.primaryError, transportError);
  assert.equal(successfulCleanup.releaseError, null);

  const metaError = new Error('meta transport failed');
  const failedCleanup = await settleBoundarySplatRawRelease({
    primaryError: metaError,
    primaryPhase: 'transport-raw-sidecar-meta-frame-000',
    releasePhase: 'release-raw-sidecar-frame-000',
    release: async () => { throw new Error('release failed'); },
  });
  assert.equal(failedCleanup.phase, 'transport-raw-sidecar-meta-frame-000');
  assert.equal(failedCleanup.primaryError, metaError);
  assert.match(metaError.rawSidecarReleaseError, /release failed/);

  await assert.rejects(
    () => settleBoundarySplatRawRelease({
      primaryPhase: 'capture-raw-sidecar-frame-000',
      releasePhase: 'release-raw-sidecar-frame-000',
      release: async () => { throw new Error('standalone release failed'); },
    }),
    error => error.message === 'standalone release failed' && error.supervisionPhase === 'release-raw-sidecar-frame-000',
  );
}
const root = await mkdtemp(join(tmpdir(), 'kaminos-splat-supervision-'));
try {
  const candidates = new Float32Array(19 * 2).fill(0.25);
  const candidateBytes = Buffer.from(candidates.buffer);
  const targetBytes = Buffer.from('not-a-real-png-but-nonblank-target-proof');
  const candidatePath = join(root, 'frame-000.candidates.f32');
  const targetPath = join(root, 'frame-000.raymarch.png');
  const structure = new Float32Array([0.5, 0.75, 0.25, 1]);
  const meta = new Float32Array([0.2, 0, 1, 0]);
  const structureBytes = Buffer.from(structure.buffer);
  const metaBytes = Buffer.from(meta.buffer);
  const structurePath = join(root, 'frame-000.sidecar-structure.f32');
  const metaPath = join(root, 'frame-000.sidecar-meta.f32');
  await writeFile(candidatePath, candidateBytes);
  await writeFile(targetPath, targetBytes);
  await writeFile(structurePath, structureBytes);
  await writeFile(metaPath, metaBytes);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const manifestPath = join(root, 'corpus.json');
  const manifest = {
    schema: BOUNDARY_SPLAT_SUPERVISION_SCHEMA,
    authority: 'live-simulator-frozen-state-candidate-raymarch-v0',
    candidateOrder: BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER,
    featureOrder: [
      'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
      'material.density', 'material.heat', 'material.fuel', 'material.detail',
      'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
      'micro.x', 'micro.y', 'micro.z', 'micro.w',
    ],
    warmup: {
      authority: 'live-single-browser-sim-step-floor-v0',
      requestedMinSimStepCount: 120,
      achievedSimStepCount: 144,
      uncapped: true,
    },
    frames: [{
      id: 'frame-000',
      sameStateCaptureId: 'same-state-000',
      simStepCount: 144,
      grid: 1,
      requestedRoute: '?volume_boundary_splat_mode=analytic&volume_resolution=160',
      effectiveRoute: '?volume_boundary_splat_mode=analytic&volume_resolution=160',
      rendererIdentity: 'live-boundary-sidecar-analytic-splats-v0',
      sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
      fallbackReason: null,
      camera: {
        viewProjection: Array(16).fill(0).map((_, index) => index % 5 === 0 ? 1 : 0),
        cameraRight: [1, 0, 0],
        cameraUp: [0, 1, 0],
        viewport: [640, 480],
      },
      splatControls: { radius: 0.8, sharpness: 6.5 },
      candidates: { path: candidatePath, bytes: candidateBytes.length, sha256: hash(candidateBytes), count: 2, strideFloats: 19, dtype: 'float32-le' },
      target: { path: targetPath, bytes: targetBytes.length, sha256: hash(targetBytes), authority: 'gpu-rgba8-raymarch-readback-frozen-sim-state', rendererIdentity: 'native-3d-compute-fluid-raymarch-v0', decomposition: 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0' },
      structuralSupervision: {
        identity: 'native-boundary-sidecar-structural-supervision-v0',
        captureId: 'same-state-000-sidecar',
        authority: 'live-native-boundary-sidecar-frozen-sim-state-v0',
        sameStateCaptureId: 'same-state-000',
        frameCount: 144,
        simStepCount: 144,
        requestedRoute: '?volume_boundary_splat_mode=analytic&volume_resolution=160',
        effectiveRoute: '?volume_boundary_splat_mode=analytic&volume_resolution=160',
        prototypeIdentity: 'kaminos-volume-prototype-v0',
        backend: 'WebGPU:apple',
        fallbackReason: null,
        dtype: 'float32-le',
        grid: [1, 1, 1],
        gridAuthority: 'exact-frame-grid-v0',
        gridToWorld: {
          identity: 'boundary-sidecar-cell-center-index-to-volume-world-v0',
          scale: [2, 2, 2],
          translation: [0, 0, 0],
          matrixColumnMajor: Array(16).fill(0).map((_, index) => index % 5 === 0 ? 1 : 0),
        },
        fields: {
          structure: { path: structurePath, bytes: structureBytes.length, sha256: hash(structureBytes), components: 4, channels: ['support', 'coverage', 'ridge', 'footprint'] },
          meta: { path: metaPath, bytes: metaBytes.length, sha256: hash(metaBytes), components: 4, channels: ['proximity', 'normalX', 'normalY', 'normalZ'] },
        },
        release: { captureId: 'same-state-000-sidecar', sameStateCaptureId: 'same-state-000', released: true },
      },
    }],
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(() => validateBoundarySplatSupervisionCorpus(manifestPath), /exact grid.*160/i);
  const validate = () => validateBoundarySplatSupervisionCorpus(manifestPath, { expectedGrid: 1 });
  const valid = await validate();
  assert.equal(valid.frameCount, 1);
  assert.equal(valid.candidateCount, 2);
  assert.equal(valid.structuralFrameCount, 1);
  assert.equal(valid.frames[0].structurePath, structurePath);
  assert.equal(valid.frames[0].metaPath, metaPath);
  assert.match(valid.corpusIdentity, /^sha256:[a-f0-9]{64}$/);

  const fallback = structuredClone(manifest);
  fallback.frames[0].fallbackReason = 'raymarch-substitution';
  await writeFile(manifestPath, JSON.stringify(fallback));
  await assert.rejects(validate, /fallback/i);

  const staleHash = structuredClone(manifest);
  staleHash.frames[0].target.sha256 = '0'.repeat(64);
  await writeFile(manifestPath, JSON.stringify(staleHash));
  await assert.rejects(validate, /target.*sha256/i);

  const wrongStride = structuredClone(manifest);
  wrongStride.frames[0].candidates.count = 3;
  await writeFile(manifestPath, JSON.stringify(wrongStride));
  await assert.rejects(validate, /candidate.*bytes/i);

  const wrongCandidateOrder = structuredClone(manifest);
  wrongCandidateOrder.candidateOrder = [...BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER].reverse();
  await writeFile(manifestPath, JSON.stringify(wrongCandidateOrder));
  await assert.rejects(validate, /candidate order/i);

  const missingCameraBasis = structuredClone(manifest);
  delete missingCameraBasis.frames[0].camera.cameraRight;
  await writeFile(manifestPath, JSON.stringify(missingCameraBasis));
  await assert.rejects(validate, /camera right/i);

  const missingSplatControls = structuredClone(manifest);
  delete missingSplatControls.frames[0].splatControls;
  await writeFile(manifestPath, JSON.stringify(missingSplatControls));
  await assert.rejects(validate, /splat controls/i);

  const staleStructure = structuredClone(manifest);
  staleStructure.frames[0].structuralSupervision.fields.structure.sha256 = '0'.repeat(64);
  await writeFile(manifestPath, JSON.stringify(staleStructure));
  await assert.rejects(validate, /structural.*structure.*sha256/i);

  const wrongStructuralState = structuredClone(manifest);
  wrongStructuralState.frames[0].structuralSupervision.sameStateCaptureId = 'different-state';
  await writeFile(manifestPath, JSON.stringify(wrongStructuralState));
  await assert.rejects(validate, /structural.*same-state/i);

  const unreleasedStructuralCapture = structuredClone(manifest);
  unreleasedStructuralCapture.frames[0].structuralSupervision.release.released = false;
  await writeFile(manifestPath, JSON.stringify(unreleasedStructuralCapture));
  await assert.rejects(validate, /structural.*release/i);

  const nonFiniteStructure = structuredClone(manifest);
  const invalidStructure = new Float32Array([Number.NaN, 0, 0, 0]);
  const invalidStructureBytes = Buffer.from(invalidStructure.buffer);
  await writeFile(structurePath, invalidStructureBytes);
  nonFiniteStructure.frames[0].structuralSupervision.fields.structure.sha256 = hash(invalidStructureBytes);
  await writeFile(manifestPath, JSON.stringify(nonFiniteStructure));
  await assert.rejects(validate, /structural.*non-finite/i);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('boundary splat supervision corpus contracts passed');
