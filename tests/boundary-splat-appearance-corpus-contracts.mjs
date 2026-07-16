import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleUrl = new URL('../boundary-splat-appearance-corpus.mjs', import.meta.url);
const source = await readFile(moduleUrl, 'utf8').catch(() => '');
assert.match(source, /validateBoundarySplatAppearanceCorpus/, 'appearance corpus validator must be explicit');

const {
  BOUNDARY_SPLAT_APPEARANCE_AUTHORITY,
  BOUNDARY_SPLAT_APPEARANCE_SCHEMA,
  validateBoundarySplatAppearanceCorpus,
} = await import(moduleUrl);
const {
  BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER,
} = await import(new URL('../boundary-splat-feature-capture.mjs', import.meta.url));

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identityMatrix = Array(16).fill(0).map((_, index) => index % 5 === 0 ? 1 : 0);
const cameraMatrix = offset => identityMatrix.map((value, index) => index === 12 ? offset : value);
const root = await mkdtemp(join(tmpdir(), 'kaminos-splat-appearance-'));

const appearanceReceipt = (mode, targetIdentity) => ({
  identity: 'appearance-decomposition-receipt-v0',
  requestedMode: mode,
  normalizedRequestedMode: mode,
  effectiveMode: mode,
  fallbackReason: null,
  targetIdentity,
  coefficientBoundary: 'per-sample-pre-tone-map-emission-extinction-v0',
  structuralAIdentity: 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0',
  broadCarrierIdentity: 'signed-control-minus-structural-a-local-coefficients-v0',
  opticalRecurrence: 'front-to-back-emission-with-exponential-transmittance-v0',
  positivePartitionIdentity: 'nonnegative-ridge-owned-plus-non-ridge-complete-flame-v0',
  completeFlameIdentity: 'smoke-off-complete-flame-local-emission-extinction-v0',
  ridgeOwnershipIdentity: 'state-derived-direct-flame-candidate-support-allocation-v0',
  coefficientSigns: {
    completeFlame: 'nonnegative',
    ridgeOwned: 'nonnegative',
    nonRidge: 'nonnegative',
  },
  simulationAdvanced: false,
  simulationReset: false,
  cameraMutated: false,
  controlsMutated: false,
  requestedPasses: {
    raymarchApplied: true,
    splatsApplied: false,
    residualApplied: false,
    featureCaptureApplied: false,
    smokeApplied: false,
  },
  passes: {
    raymarchApplied: true,
    splatsApplied: false,
    residualApplied: false,
    featureCaptureApplied: false,
    smokeApplied: false,
  },
  couplingTerms: [
    'b-emission-transported-through-a-plus-b-transmittance',
    'b-extinction-modulates-downstream-a-and-b-emission',
    'signed-b-coefficients-are-not-an-independent-positive-radiance-field',
  ],
});

try {
  const candidateFloats = new Float32Array(19 * 2).fill(0.25);
  const candidateBytes = Buffer.from(candidateFloats.buffer);
  const candidatePath = join(root, 'state-000.candidates.f32');
  await writeFile(candidatePath, candidateBytes);

  const cameras = [];
  for (const [index, split] of ['train', 'train', 'heldout'].entries()) {
    const id = `camera-${index}`;
    const structuralABytes = Buffer.from(`nonblank structural A target ${index}`);
    const broadCarrierBBytes = Buffer.from(`nonblank signed broad-carrier B visualization ${index}`);
    const bOnABytes = Buffer.from(`nonblank B optical effect on fixed A ${index}`);
    const recomposedBytes = Buffer.from(`nonblank exact A plus B recomposition ${index}`);
    const completeEmissionBytes = Buffer.from(`nonblank Complete Flame emission coefficients ${index}`);
    const completeExtinctionBytes = Buffer.from(`nonblank Complete Flame extinction coefficients ${index}`);
    const ridgeEmissionBytes = Buffer.from(`nonblank Ridge-Owned emission coefficients ${index}`);
    const ridgeExtinctionBytes = Buffer.from(`nonblank Ridge-Owned extinction coefficients ${index}`);
    const nonRidgeEmissionBytes = Buffer.from(`nonblank Non-Ridge emission coefficients ${index}`);
    const nonRidgeExtinctionBytes = Buffer.from(`nonblank Non-Ridge extinction coefficients ${index}`);
    const structuralAPath = join(root, `${id}.structural-a.png`);
    const broadCarrierBPath = join(root, `${id}.broad-carrier-b.png`);
    const bOnAPath = join(root, `${id}.b-on-fixed-a.png`);
    const recomposedPath = join(root, `${id}.a-plus-b.png`);
    const controlPath = join(root, `${id}.smoke-off-control.png`);
    const completeEmissionPath = join(root, `${id}.complete-emission.png`);
    const completeExtinctionPath = join(root, `${id}.complete-extinction.png`);
    const ridgeEmissionPath = join(root, `${id}.ridge-emission.png`);
    const ridgeExtinctionPath = join(root, `${id}.ridge-extinction.png`);
    const nonRidgeEmissionPath = join(root, `${id}.non-ridge-emission.png`);
    const nonRidgeExtinctionPath = join(root, `${id}.non-ridge-extinction.png`);
    const positiveRecompositionPath = join(root, `${id}.positive-recomposition.png`);
    await writeFile(structuralAPath, structuralABytes);
    await writeFile(broadCarrierBPath, broadCarrierBBytes);
    await writeFile(bOnAPath, bOnABytes);
    await writeFile(recomposedPath, recomposedBytes);
    await writeFile(controlPath, recomposedBytes);
    await writeFile(completeEmissionPath, completeEmissionBytes);
    await writeFile(completeExtinctionPath, completeExtinctionBytes);
    await writeFile(ridgeEmissionPath, ridgeEmissionBytes);
    await writeFile(ridgeExtinctionPath, ridgeExtinctionBytes);
    await writeFile(nonRidgeEmissionPath, nonRidgeEmissionBytes);
    await writeFile(nonRidgeExtinctionPath, nonRidgeExtinctionBytes);
    await writeFile(positiveRecompositionPath, recomposedBytes);
    const target = (path, bytes, mode, targetIdentity) => ({
      path,
      bytes: bytes.length,
      sha256: hash(bytes),
      authority: 'gpu-rgba8-raymarch-readback-frozen-sim-state',
      rendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
      decomposition: targetIdentity,
      presentationTargetIdentity: targetIdentity,
      sameStateCaptureId: 'appearance-state-000',
      simStepCount: 240,
      cameraId: id,
      requestedRaySteps: 160,
      effectiveRaySteps: 160,
      renderScale: 1,
      appearanceDecompositionReceipt: appearanceReceipt(mode, targetIdentity),
    });
    cameras.push({
      id,
      split,
      sameStateCaptureId: 'appearance-state-000',
      simStepCount: 240,
      camera: {
        viewProjection: cameraMatrix(index * 0.25),
        cameraRight: [1, 0, 0],
        cameraUp: [0, 1, 0],
        viewport: [960, 720],
      },
      structuralA: target(
        structuralAPath,
        structuralABytes,
        'structural-a',
        'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0',
      ),
      appearanceBroadCarrierB: target(
        broadCarrierBPath,
        broadCarrierBBytes,
        'broad-carrier-b',
        'pre-tone-map-signed-broad-carrier-coefficients-v0',
      ),
      appearanceBAppliedToFixedA: target(
        bOnAPath,
        bOnABytes,
        'b-applied-to-fixed-a',
        'pre-tone-map-b-optical-effect-on-fixed-structural-a-v0',
      ),
      appearanceAPlusB: target(
        recomposedPath,
        recomposedBytes,
        'a-plus-b-recomposition',
        'nonlinear-optical-a-plus-b-recomposition-v0',
      ),
      smokeOffBeautyControl: target(
        controlPath,
        recomposedBytes,
        'smoke-off-beauty-control',
        'smoke-off-beauty-optical-control-v0',
      ),
      positiveCompleteEmission: target(
        completeEmissionPath,
        completeEmissionBytes,
        'complete-flame-emission',
        'smoke-off-complete-flame-emission-coefficient-v0',
      ),
      positiveCompleteExtinction: target(
        completeExtinctionPath,
        completeExtinctionBytes,
        'complete-flame-extinction',
        'smoke-off-complete-flame-extinction-coefficient-v0',
      ),
      positiveRidgeOwnedEmission: target(
        ridgeEmissionPath,
        ridgeEmissionBytes,
        'ridge-owned-emission',
        'nonnegative-ridge-owned-flame-emission-coefficient-v0',
      ),
      positiveRidgeOwnedExtinction: target(
        ridgeExtinctionPath,
        ridgeExtinctionBytes,
        'ridge-owned-extinction',
        'nonnegative-ridge-owned-flame-extinction-coefficient-v0',
      ),
      positiveNonRidgeEmission: target(
        nonRidgeEmissionPath,
        nonRidgeEmissionBytes,
        'non-ridge-emission',
        'nonnegative-non-ridge-flame-emission-coefficient-v0',
      ),
      positiveNonRidgeExtinction: target(
        nonRidgeExtinctionPath,
        nonRidgeExtinctionBytes,
        'non-ridge-extinction',
        'nonnegative-non-ridge-flame-extinction-coefficient-v0',
      ),
      positiveOpticalRecomposition: target(
        positiveRecompositionPath,
        recomposedBytes,
        'positive-optical-recomposition',
        'nonnegative-ridge-plus-non-ridge-optical-recomposition-v0',
      ),
    });
  }

  const manifestPath = join(root, 'appearance-corpus.json');
  const manifest = {
    schema: BOUNDARY_SPLAT_APPEARANCE_SCHEMA,
    authority: BOUNDARY_SPLAT_APPEARANCE_AUTHORITY,
    cohortIdentity: 'appearance-cohort-000',
    sameStateCaptureId: 'appearance-state-000',
    simStepCount: 240,
    grid: 160,
    requestedRoute: '?volume_resolution=160&volume_steps=160',
    effectiveRoute: '?volume_resolution=160&volume_steps=160',
    prototypeIdentity: 'kaminos-volume-prototype-v0',
    backend: 'WebGPU:apple',
    fallbackReason: null,
    authoredAppearanceControls: {
      identity: 'boundary-splat-authored-appearance-conditioning-v0',
      authority: 'effective-runtime-controls-frozen-sim-state-v0',
      values: {
        reactionBoundaryFireRidge: 1.52,
        reactionBoundaryFireRidgeCut: 0.145,
        reactionBoundaryFireTip: 2,
        reactionBoundaryFireErosion: 0.3,
        reactionBoundaryFireCleanBlue: 0.3,
        reactionBoundaryFireSoot: 0.64,
        reactionBoundaryFireYellow: 0.44,
        reactionBoundaryFireWarmth: 0.16,
        reactionBoundaryFireLuma: 5,
      },
    },
    candidates: {
      path: candidatePath,
      bytes: candidateBytes.length,
      sha256: hash(candidateBytes),
      count: 2,
      strideFloats: 19,
      dtype: 'float32-le',
      candidateOrder: [...BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER],
      sameStateCaptureId: 'appearance-state-000',
      simStepCount: 240,
    },
    cameras,
  };
  manifest.cameras.forEach(camera => {
    camera.appearanceBAppliedToFixedA.trainingAuthority = 'diagnostic-only-not-local-b-target';
  });

  const writeManifest = value => writeFile(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
  await writeManifest(manifest);
  const valid = await validateBoundarySplatAppearanceCorpus(manifestPath, {
    expectedGrid: 160,
    expectedRaySteps: 160,
    expectedRenderScale: 1,
    requireWebGpuBackend: true,
  });
  assert.equal(valid.cameraCount, 3);
  assert.equal(valid.trainCameraCount, 2);
  assert.equal(valid.heldoutCameraCount, 1);
  assert.equal(valid.sameStateCaptureId, 'appearance-state-000');
  assert.equal(valid.candidateSha256, manifest.candidates.sha256);
  assert.equal(BOUNDARY_SPLAT_APPEARANCE_SCHEMA, 'kaminos-boundary-splat-appearance-coefficient-corpus-v1');
  assert.equal(BOUNDARY_SPLAT_APPEARANCE_AUTHORITY, 'live-simulator-frozen-state-multi-camera-positive-full-flame-coefficients-with-signed-comparator-v1');
  assert.equal(valid.positiveTargetAuthority, 'nonnegative-ridge-owned-plus-non-ridge-complete-flame-v0');
  assert.match(valid.corpusIdentity, /^sha256:[a-f0-9]{64}$/);

  const reject = async (mutate, pattern) => {
    const invalid = structuredClone(manifest);
    mutate(invalid);
    await writeManifest(invalid);
    await assert.rejects(
      () => validateBoundarySplatAppearanceCorpus(manifestPath, {
        expectedGrid: 160,
        expectedRaySteps: 160,
        expectedRenderScale: 1,
        requireWebGpuBackend: true,
      }),
      pattern,
    );
  };

  await reject(value => { value.cameras[2].split = 'train'; }, /heldout camera/i);
  await reject(value => { value.cameras[2].sameStateCaptureId = 'stale-state'; }, /same-state/i);
  await reject(value => { value.cameras[2].appearanceAPlusB.simStepCount += 1; }, /simulator step/i);
  await reject(value => { value.cameras[2].camera.viewProjection = [...value.cameras[0].camera.viewProjection]; }, /distinct camera/i);
  await reject(value => { delete value.cameras[2].appearanceBroadCarrierB; }, /broad-carrier B target.*missing/i);
  await reject(value => { delete value.cameras[2].positiveRidgeOwnedEmission; }, /Ridge-Owned emission target.*missing/i);
  await reject(value => { value.cameras[2].positiveRidgeOwnedEmission.appearanceDecompositionReceipt.coefficientSigns.ridgeOwned = 'signed'; }, /Ridge-Owned.*nonnegative/i);
  await reject(value => { value.cameras[2].positiveNonRidgeExtinction.appearanceDecompositionReceipt.ridgeOwnershipIdentity = 'screen-space-mask'; }, /ridge ownership identity/i);
  await reject(value => { value.cameras[2].appearanceBroadCarrierB.appearanceDecompositionReceipt.broadCarrierIdentity = 'positive-radiance-image'; }, /signed.*coefficient/i);
  await reject(value => { value.cameras[2].appearanceBroadCarrierB.appearanceDecompositionReceipt.passes.splatsApplied = true; }, /raymarch-only/i);
  await reject(value => { value.cameras[2].appearanceAPlusB.appearanceDecompositionReceipt.fallbackReason = 'unsupported'; }, /fallback/i);
  await reject(value => { value.cameras[2].structuralA.effectiveRaySteps = 96; }, /effective ray steps.*160/i);
  await reject(value => {
    value.cameras[2].smokeOffBeautyControl.path = value.cameras[2].appearanceBAppliedToFixedA.path;
    value.cameras[2].smokeOffBeautyControl.bytes = value.cameras[2].appearanceBAppliedToFixedA.bytes;
    value.cameras[2].smokeOffBeautyControl.sha256 = value.cameras[2].appearanceBAppliedToFixedA.sha256;
  }, /exact A\+B.*control/i);
  await reject(value => {
    value.cameras[2].positiveOpticalRecomposition.path = value.cameras[2].positiveRidgeOwnedEmission.path;
    value.cameras[2].positiveOpticalRecomposition.bytes = value.cameras[2].positiveRidgeOwnedEmission.bytes;
    value.cameras[2].positiveOpticalRecomposition.sha256 = value.cameras[2].positiveRidgeOwnedEmission.sha256;
  }, /positive optical recomposition.*control/i);
  await reject(value => { value.cameras[2].appearanceBAppliedToFixedA.trainingAuthority = 'nominal-local-b-target'; }, /diagnostic-only/i);
  await reject(value => { value.candidates.sameStateCaptureId = 'candidate-stale-state'; }, /candidate.*same-state/i);
  await reject(value => { value.candidates.candidateOrder.reverse(); }, /candidate.*column order/i);
  await reject(value => { delete value.candidates.candidateOrder; }, /candidate.*column order/i);
  await reject(value => { value.backend = 'WebGL2'; }, /backend.*WebGPU/i);
  await reject(value => { value.fallbackReason = 'route-fallback'; }, /fallback/i);

  await writeManifest(manifest);
  console.log('boundary splat appearance corpus contracts passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
