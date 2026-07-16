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
      captureAdmission: {
        identity: 'fresh-live-selective-splat-capture-admission-v0',
        authority: 'fresh-live-settings-no-anchor-v0',
        requestedRole: 'truthHigh',
        effectiveRole: 'truthHigh',
        roleAuthority: 'current-high-field-reference-no-learned-composition-v0',
        requestedComposition: 'splat-only-v0',
        effectiveComposition: 'splat-only-v0',
        compositionAuthority: 'splat-fire-authority-learned-boundary-sheets-v0',
        passReceipt: {
          composition: 'splat-only-v0',
          raymarchEncoded: false,
          raymarchApplied: false,
          splatEncoded: true,
          splatApplied: true,
          fallbackReason: null,
        },
        boundarySidecarSource: 'baked',
        boundarySidecarBuilt: true,
        boundarySidecarBuiltThisFrame: true,
        boundarySplatSourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
        boundarySplatFallbackReason: null,
        boundarySidecarOverrideReceipt: null,
        fullFieldImportReceipt: null,
        replayAnchor: null,
      },
      controlConditioning: {
        identity: 'boundary-splat-emitter-lifecycle-conditioning-v0',
        authority: 'effective-runtime-controls-frozen-sim-state-v0',
        sameStateCaptureId: 'same-state-000',
        simStepCount: 144,
        values: {
          inputRadius: 0.24,
          flowRate: 1.7,
          fireScale: 1.1,
          reactionFuelScale: 1,
          lifecycleEffect: 'none',
          lifecycleT: 0,
          quenchVapor: 0,
        },
      },
      candidates: { path: candidatePath, bytes: candidateBytes.length, sha256: hash(candidateBytes), count: 2, strideFloats: 19, dtype: 'float32-le' },
      target: { path: targetPath, bytes: targetBytes.length, sha256: hash(targetBytes), authority: 'gpu-rgba8-raymarch-readback-frozen-sim-state', rendererIdentity: 'native-3d-compute-fluid-raymarch-v0', decomposition: 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0', requestedRaySteps: 160, effectiveRaySteps: 160, renderScale: 1 },
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
  assert.equal(valid.frames[0].controlConditioning.values.inputRadius, 0.24);
  assert.match(valid.corpusIdentity, /^sha256:[a-f0-9]{64}$/);

  const validateExactTeacher = () => validateBoundarySplatSupervisionCorpus(manifestPath, {
    expectedGrid: 1,
    expectedRaySteps: 160,
    expectedRenderScale: 1,
  });
  const validExactTeacher = await validateExactTeacher();
  assert.equal(validExactTeacher.frames[0].requestedRaySteps, 160);
  assert.equal(validExactTeacher.frames[0].effectiveRaySteps, 160);
  assert.equal(validExactTeacher.frames[0].renderScale, 1);

  const missingRequestedTeacher = structuredClone(manifest);
  delete missingRequestedTeacher.frames[0].target.requestedRaySteps;
  await writeFile(manifestPath, JSON.stringify(missingRequestedTeacher));
  await assert.rejects(validateExactTeacher, /target requested ray steps/i);

  const cappedEffectiveTeacher = structuredClone(manifest);
  cappedEffectiveTeacher.frames[0].target.effectiveRaySteps = 96;
  await writeFile(manifestPath, JSON.stringify(cappedEffectiveTeacher));
  await assert.rejects(validateExactTeacher, /target effective ray steps/i);

  const scaledTeacher = structuredClone(manifest);
  scaledTeacher.frames[0].target.renderScale = 0.5;
  await writeFile(manifestPath, JSON.stringify(scaledTeacher));
  await assert.rejects(validateExactTeacher, /target render scale/i);

  await writeFile(manifestPath, JSON.stringify(manifest));

  const validateFresh = () => validateBoundarySplatSupervisionCorpus(manifestPath, {
    expectedGrid: 1,
    requireFreshLiveAdmission: true,
  });
  const validFresh = await validateFresh();
  assert.equal(validFresh.frames[0].captureAdmission.effectiveRole, 'truthHigh');

  const inactiveSelectiveRole = structuredClone(manifest);
  inactiveSelectiveRole.frames[0].captureAdmission.effectiveRole = 'off';
  await writeFile(manifestPath, JSON.stringify(inactiveSelectiveRole));
  await assert.rejects(validateFresh, /fresh-live.*effective role/i);

  const missingSplatComposition = structuredClone(manifest);
  missingSplatComposition.frames[0].captureAdmission.effectiveComposition = 'raymarch-only-v0';
  await writeFile(manifestPath, JSON.stringify(missingSplatComposition));
  await assert.rejects(validateFresh, /fresh-live.*composition/i);

  const unappliedSplatPass = structuredClone(manifest);
  unappliedSplatPass.frames[0].captureAdmission.passReceipt.splatApplied = false;
  await writeFile(manifestPath, JSON.stringify(unappliedSplatPass));
  await assert.rejects(validateFresh, /fresh-live.*splat pass/i);

  const staleSidecar = structuredClone(manifest);
  staleSidecar.frames[0].captureAdmission.boundarySidecarBuiltThisFrame = false;
  await writeFile(manifestPath, JSON.stringify(staleSidecar));
  await assert.rejects(validateFresh, /fresh-live.*sidecar/i);

  const importedSidecar = structuredClone(manifest);
  importedSidecar.frames[0].captureAdmission.boundarySidecarSource = 'override';
  importedSidecar.frames[0].captureAdmission.boundarySidecarOverrideReceipt = { status: 'applied' };
  await writeFile(manifestPath, JSON.stringify(importedSidecar));
  await assert.rejects(validateFresh, /fresh-live.*override/i);

  const importedFullField = structuredClone(manifest);
  importedFullField.frames[0].captureAdmission.fullFieldImportReceipt = { status: 'applied' };
  await writeFile(manifestPath, JSON.stringify(importedFullField));
  await assert.rejects(validateFresh, /fresh-live.*full-field/i);

  const replayedAnchor = structuredClone(manifest);
  replayedAnchor.frames[0].captureAdmission.replayAnchor = { captureId: 'held-state' };
  await writeFile(manifestPath, JSON.stringify(replayedAnchor));
  await assert.rejects(validateFresh, /fresh-live.*replay/i);

  const missingControlConditioning = structuredClone(manifest);
  delete missingControlConditioning.frames[0].controlConditioning;
  await writeFile(manifestPath, JSON.stringify(missingControlConditioning));
  const legacyUnconditioned = await validate();
  assert.equal(legacyUnconditioned.frames[0].controlConditioning, null);
  await assert.rejects(
    () => validateBoundarySplatSupervisionCorpus(manifestPath, { expectedGrid: 1, requireControlConditioning: true }),
    /control conditioning/i,
  );

  const wrongControlState = structuredClone(manifest);
  wrongControlState.frames[0].controlConditioning.sameStateCaptureId = 'different-state';
  await writeFile(manifestPath, JSON.stringify(wrongControlState));
  await assert.rejects(validate, /control conditioning.*same-state/i);

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
