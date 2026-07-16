import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const scriptUrl = new URL('../volume-layer-coefficient-learner-mlx.py', import.meta.url);
assert.ok(existsSync(scriptUrl), 'post-admission layer coefficient learner contract exists');
const script = await readFile(scriptUrl, 'utf8');

assert.match(script, /kaminos\.volume\.layer-coefficient-training-manifest\.v0/, 'learner pins its training manifest schema');
assert.match(script, /analytical-ridge-or-nonridge-admission-plus-exact-local-coefficients-v0/, 'learner requires analytical admission plus local coefficient truth');
assert.match(script, /analytical-not-learned-membership-v0/, 'learner rejects learned membership as support authority');
assert.match(script, /per-sample-pre-tone-map-emission-extinction-v0/, 'learner consumes local pre-tone-map coefficients');
assert.match(script, /one-shared-total-transmittance-v0/, 'learner assay requires one shared total transmittance');
assert.match(script, /global-order-one-stream-v0/, 'learner assay requires one globally ordered stream');
assert.match(script, /support-gradient-oriented-tangent-plane-diagonal-covariance-v0/, 'learner preserves the winning world-tangent covariance arm');
assert.match(script, /softplus-nonnegative-output-v0/, 'learner architecture makes coefficients nonnegative rather than clipping evidence');
assert.match(script, /matched-capacity-post-admission-kernel-descriptor-ablation-v0/, 'learner prepares the matched-capacity kernel descriptor arm');
assert.match(script, /camera-independent-flow-kernel-descriptors-v0/, 'learner accepts only camera-independent kernel descriptors');
assert.match(script, /flow-kernel-local-descriptor-socket-v0/, 'learner pins the actual flow-kernel descriptor socket identity');
assert.doesNotMatch(script, /kaminos\.flow-kernel-local-descriptor\.v0/, 'learner must not invent a descriptor schema beside the landed socket');
assert.match(script, /external-native-cell-index-list-v0/, 'learner pins the landed external native-cell index population identity');
assert.match(script, /analytical-admission-native-cell-indices/, 'learner requires a checksum-bound native-cell index artifact for every admitted row');
assert.doesNotMatch(script, /checksum-bound-analytical-admission-row-index-v0/, 'learner must not invent an admission identity beside the landed descriptor producer');
assert.match(script, /kernel-moment-analytical-geometry-v0/, 'learner keeps kernel-moment geometry analytical and separately gated');
assert.match(script, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'learner writes phase-local failure evidence');
assert.match(script, /--probe-only/, 'learner exposes a no-training contract probe');

const { BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER } = await import(
  new URL('../boundary-splat-feature-capture.mjs', import.meta.url)
);
const descriptorSocketUrl = new URL('../flow-kernel-descriptor-socket.mjs', import.meta.url);
const {
  FLOW_KERNEL_DESCRIPTOR_ORDER,
  FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY,
  FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS,
} = await import(descriptorSocketUrl);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const root = await mkdtemp(join(tmpdir(), 'kaminos-layer-coefficients-'));
const inputDir = join(root, 'input');
const outDir = join(root, 'output');
await Promise.all([mkdir(inputDir), mkdir(outDir)]);

function floatBytes(values) {
  const array = Float32Array.from(values);
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function uint32Bytes(values) {
  const array = Uint32Array.from(values);
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

async function artifact(name, values, shape, semanticRole) {
  const bytes = floatBytes(values);
  const path = join(inputDir, `${name}.f32`);
  await writeFile(path, bytes);
  return {
    path,
    bytes: bytes.length,
    sha256: sha256(bytes),
    dtype: 'float32-le',
    shape,
    semanticRole,
  };
}

async function uint32Artifact(name, values, shape, semanticRole) {
  const bytes = uint32Bytes(values);
  const path = join(inputDir, `${name}.u32`);
  await writeFile(path, bytes);
  return {
    path,
    bytes: bytes.length,
    sha256: sha256(bytes),
    dtype: 'uint32-le',
    shape,
    semanticRole,
  };
}

async function rawArtifact(name, bytes) {
  const path = join(inputDir, name);
  await writeFile(path, bytes);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

const featureOrder = [
  'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
  'material.density', 'material.heat', 'material.fuel', 'material.detail',
];
const admissionOrder = ['admission.ridge', 'admission.nonRidge'];
const coefficientOrder = [
  'ridge.emission.r', 'ridge.emission.g', 'ridge.emission.b', 'ridge.extinction',
  'nonRidge.emission.r', 'nonRidge.emission.g', 'nonRidge.emission.b', 'nonRidge.extinction',
];
const descriptorOrder = [
  'flow.coherence',
  'flow.curlMagnitude',
  'flow.divergence',
  'flow.curlActivity',
  'validity.conservativeMajorant',
  'majorant.fire',
  'majorant.extinction',
];
const descriptorKernelIdentity = 'flow-tangent-positive-symmetric-trilinear-v0';
const descriptorControls = { strength: 0.6, radiusWorld: 0.018, coherence: 0.7 };
const descriptorSocketBytes = await readFile(descriptorSocketUrl);
const descriptorSocketArtifact = {
  path: descriptorSocketUrl.pathname,
  bytes: descriptorSocketBytes.length,
  sha256: sha256(descriptorSocketBytes),
};

function descriptorRowsForFixture(count = 4) {
  return Array.from({ length: count }, (_, rowIndex) => {
    const row = Array(FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS).fill(0);
    row[0] = rowIndex * 0.01;
    row[3] = rowIndex;
    row[4] = 1;
    row[15] = descriptorControls.coherence;
    row[23] = 0.4 + rowIndex * 0.1;
    row[27] = 0.3 + rowIndex * 0.1;
    row[28] = -0.1 + rowIndex * 0.05;
    row[29] = 0.2 + rowIndex * 0.1;
    row[30] = 0;
    row[31] = 1;
    row[32] = 0.8;
    row[33] = 0.7;
    row[34] = 0.9;
    row[35] = 0.6;
    return row;
  }).flat();
}

async function state(id, splitRole, phase) {
  const count = 4;
  const features = [];
  const admissions = [];
  const targets = [];
  for (let row = 0; row < count; row += 1) {
    features.push(...featureOrder.map((_, channel) => (phase + row + channel + 1) / 32));
    const ridge = row < 2 ? 1 : 0;
    const nonRidge = row >= 2 ? 1 : 0;
    admissions.push(ridge, nonRidge);
    targets.push(
      ridge * 1.0, ridge * 0.7, ridge * 0.3, ridge * 0.5,
      nonRidge * 0.8, nonRidge * 0.5, nonRidge * 0.2, nonRidge * 0.4,
    );
  }
  const featureArtifact = await artifact(`${id}-features`, features, [count, featureOrder.length], 'post-admission-local-features');
  const admissionArtifact = await artifact(`${id}-admission`, admissions, [count, admissionOrder.length], 'analytical-ridge-or-nonridge-admission');
  const nativeCellIndices = await uint32Artifact(
    `${id}-native-cell-indices`,
    Array.from({ length: count }, (_, row) => phase * 100 + row),
    [count],
    'analytical-admission-native-cell-indices',
  );
  const coefficientArtifact = await artifact(`${id}-coefficients`, targets, [count, coefficientOrder.length], 'exact-local-layer-emission-extinction');
  const sourceFluid = await rawArtifact(`${id}-source-fluid.f32`, floatBytes([phase + 0.1, phase + 0.2]));
  const sourceFront = await rawArtifact(`${id}-source-front.f32`, floatBytes([phase + 0.3, phase + 0.4]));
  const sourceBoundary = await rawArtifact(`${id}-source-boundary.f32`, floatBytes([phase + 0.5, phase + 0.6]));
  const sourceManifestValue = {
    schema: 'kaminos.volume.full-grid-field-export.v0',
    identity: 'full-grid-fluid-front-boundary-sidecars-v0',
    status: 'captured',
    failurePhase: null,
    completeFieldCoverage: true,
    routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
    effectiveRoute: '?kaminos_volume_smoke=1&volume_resolution=160',
    prototypeIdentity: 'kaminos-volume-prototype-v0',
    backend: 'WebGPU:apple',
    grid: 160,
    sidecars: { fluid: sourceFluid, front: sourceFront },
    boundarySidecar: { sidecars: { boundary: sourceBoundary } },
  };
  const sourceManifestBytes = Buffer.from(`${JSON.stringify(sourceManifestValue, null, 2)}\n`);
  const sourceFieldManifest = await rawArtifact(`${id}-source-manifest.json`, sourceManifestBytes);
  const descriptorSourceHashes = {
    fluidSha256: sourceFluid.sha256,
    frontSha256: sourceFront.sha256,
    boundarySidecarSha256: sourceBoundary.sha256,
    majorantSha256: sha256(Buffer.from(`majorant-${id}`)),
  };
  const descriptorRows = descriptorRowsForFixture(count);
  const kernelDescriptors = await artifact(
    `${id}-kernel-descriptors`,
    descriptorRows,
    [count, FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS],
    'camera-independent-flow-kernel-descriptors',
  );
  Object.assign(kernelDescriptors, {
    socketIdentity: FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY,
    strideFloats: FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS,
    descriptorOrder: [...FLOW_KERNEL_DESCRIPTOR_ORDER],
    kernelIdentity: descriptorKernelIdentity,
    requestedControls: { ...descriptorControls },
    effectiveControls: { ...descriptorControls },
    sourceHashes: { ...descriptorSourceHashes },
    sourceManifestSha256: sourceFieldManifest.sha256,
    candidateAdmissionAuthority: 'external-native-cell-index-list-v0',
    admissionIndexAuthority: {
      identity: 'external-native-cell-index-list-v0',
      indexSha256: nativeCellIndices.sha256,
      count,
      byteLength: nativeCellIndices.bytes,
      duplicatePolicy: 'forbidden',
      orderIdentity: 'caller-ordered',
    },
    admissionIdentity: 'explicit-ridge-union-nonridge-selector-test-v0',
    admissionArtifactSha256: admissionArtifact.sha256,
  });
  return {
    id,
    splitRole,
    sameStateCaptureId: `capture-${id}`,
    sourceFieldManifest,
    requestedControlIdentity: `sha256:${String(phase + 1).repeat(64).slice(0, 64)}`,
    effectiveControlIdentity: `sha256:${String(phase + 1).repeat(64).slice(0, 64)}`,
    rows: {
      count,
      features: featureArtifact,
      admission: admissionArtifact,
      nativeCellIndices,
      coefficients: coefficientArtifact,
      kernelDescriptors,
    },
  };
}

const sourceCorpusPath = join(inputDir, 'appearance-corpus.json');
const identityMatrix = Array(16).fill(0).map((_, index) => index % 5 === 0 ? 1 : 0);

function appearanceReceipt(mode, targetIdentity) {
  return {
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
    coefficientSigns: { completeFlame: 'nonnegative', ridgeOwned: 'nonnegative', nonRidge: 'nonnegative' },
    simulationAdvanced: false,
    simulationReset: false,
    cameraMutated: false,
    controlsMutated: false,
    requestedPasses: { raymarchApplied: true, splatsApplied: false, residualApplied: false, featureCaptureApplied: false, smokeApplied: false },
    passes: { raymarchApplied: true, splatsApplied: false, residualApplied: false, featureCaptureApplied: false, smokeApplied: false },
    couplingTerms: [
      'b-emission-transported-through-a-plus-b-transmittance',
      'b-extinction-modulates-downstream-a-and-b-emission',
      'signed-b-coefficients-are-not-an-independent-positive-radiance-field',
    ],
  };
}

async function appearanceTarget(cameraId, name, mode, targetIdentity, bytes) {
  const path = join(inputDir, `${cameraId}-${name}.png`);
  await writeFile(path, bytes);
  return {
    path,
    bytes: bytes.length,
    sha256: sha256(bytes),
    authority: 'gpu-rgba8-raymarch-readback-frozen-sim-state',
    rendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
    decomposition: targetIdentity,
    presentationTargetIdentity: targetIdentity,
    sameStateCaptureId: 'appearance-state-000',
    simStepCount: 240,
    cameraId,
    requestedRaySteps: 160,
    effectiveRaySteps: 160,
    renderScale: 1,
    appearanceDecompositionReceipt: appearanceReceipt(mode, targetIdentity),
  };
}

async function appearanceCamera(index, split) {
  const id = `appearance-camera-${index}`;
  const recomposed = Buffer.from(`exact shared optical recomposition ${index}`);
  const target = (name, mode, identity) => appearanceTarget(
    id,
    name,
    mode,
    identity,
    Buffer.from(`nonblank ${name} ${index}`),
  );
  const camera = {
    id,
    split,
    sameStateCaptureId: 'appearance-state-000',
    simStepCount: 240,
    camera: {
      viewProjection: identityMatrix.map((value, matrixIndex) => matrixIndex === 12 ? index * 0.25 : value),
      cameraRight: [1, 0, 0],
      cameraUp: [0, 1, 0],
      viewport: [960, 720],
    },
    structuralA: await target('structural-a', 'structural-a', 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0'),
    appearanceBroadCarrierB: await target('broad-carrier-b', 'broad-carrier-b', 'pre-tone-map-signed-broad-carrier-coefficients-v0'),
    appearanceBAppliedToFixedA: await target('b-on-fixed-a', 'b-applied-to-fixed-a', 'pre-tone-map-b-optical-effect-on-fixed-structural-a-v0'),
    appearanceAPlusB: await appearanceTarget(id, 'a-plus-b', 'a-plus-b-recomposition', 'nonlinear-optical-a-plus-b-recomposition-v0', recomposed),
    smokeOffBeautyControl: await appearanceTarget(id, 'smoke-off-control', 'smoke-off-beauty-control', 'smoke-off-beauty-optical-control-v0', recomposed),
    positiveCompleteEmission: await target('complete-emission', 'complete-flame-emission', 'smoke-off-complete-flame-emission-coefficient-v0'),
    positiveCompleteExtinction: await target('complete-extinction', 'complete-flame-extinction', 'smoke-off-complete-flame-extinction-coefficient-v0'),
    positiveRidgeOwnedEmission: await target('ridge-emission', 'ridge-owned-emission', 'nonnegative-ridge-owned-flame-emission-coefficient-v0'),
    positiveRidgeOwnedExtinction: await target('ridge-extinction', 'ridge-owned-extinction', 'nonnegative-ridge-owned-flame-extinction-coefficient-v0'),
    positiveNonRidgeEmission: await target('nonridge-emission', 'non-ridge-emission', 'nonnegative-non-ridge-flame-emission-coefficient-v0'),
    positiveNonRidgeExtinction: await target('nonridge-extinction', 'non-ridge-extinction', 'nonnegative-non-ridge-flame-extinction-coefficient-v0'),
    positiveOpticalRecomposition: await appearanceTarget(id, 'positive-recomposition', 'positive-optical-recomposition', 'nonnegative-ridge-plus-non-ridge-optical-recomposition-v0', recomposed),
  };
  camera.appearanceBAppliedToFixedA.trainingAuthority = 'diagnostic-only-not-local-b-target';
  return camera;
}

const candidateBytes = floatBytes(Array(19 * 2).fill(0.25));
const candidatePath = join(inputDir, 'appearance-candidates.f32');
await writeFile(candidatePath, candidateBytes);
const sourceCorpus = {
  schema: 'kaminos-boundary-splat-appearance-coefficient-corpus-v1',
  authority: 'live-simulator-frozen-state-multi-camera-positive-full-flame-coefficients-with-signed-comparator-v1',
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
    sha256: sha256(candidateBytes),
    count: 2,
    strideFloats: 19,
    dtype: 'float32-le',
    candidateOrder: [...BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER],
    sameStateCaptureId: 'appearance-state-000',
    simStepCount: 240,
  },
  cameras: [
    await appearanceCamera(0, 'train'),
    await appearanceCamera(1, 'heldout'),
  ],
};
const sourceCorpusBytes = Buffer.from(`${JSON.stringify(sourceCorpus, null, 2)}\n`);
await writeFile(sourceCorpusPath, sourceCorpusBytes);

const states = [
  await state('train-state', 'train', 0),
  await state('held-state', 'heldOut', 1),
];
const manifest = {
  schema: 'kaminos.volume.layer-coefficient-training-manifest.v0',
  status: 'complete',
  identity: `sha256:${'a'.repeat(64)}`,
  authority: 'analytical-ridge-or-nonridge-admission-plus-exact-local-coefficients-v0',
  sourceAppearanceCorpus: {
    path: sourceCorpusPath,
    bytes: sourceCorpusBytes.length,
    sha256: sha256(sourceCorpusBytes),
    schema: 'kaminos-boundary-splat-appearance-coefficient-corpus-v1',
    authority: 'live-simulator-frozen-state-multi-camera-positive-full-flame-coefficients-with-signed-comparator-v1',
    expectedGrid: 160,
    expectedRaySteps: 160,
    expectedRenderScale: 1,
  },
  route: {
    requested: '?kaminos_volume_smoke=1&volume_resolution=160',
    effective: '?kaminos_volume_smoke=1&volume_resolution=160',
    prototypeIdentity: 'kaminos-volume-prototype-v0',
    backend: 'WebGPU:apple',
    fallbackReason: null,
  },
  cohort: {
    identity: 'layer-coefficient-cohort-v0',
    retainedStateCount: states.length,
    retainedRowCount: states.reduce((sum, value) => sum + value.rows.count, 0),
    droppedRowCount: 0,
    sampleCap: null,
  },
  featureView: {
    identity: 'post-admission-source-complete-local-features-v0',
    order: featureOrder,
  },
  admission: {
    identity: 'explicit-ridge-union-nonridge-selector-test-v0',
    authority: 'analytical-not-learned-membership-v0',
    order: admissionOrder,
    rowPolicy: 'only-analytically-admitted-candidates-v0',
  },
  coefficientTargets: {
    identity: 'separate-nonnegative-ridge-and-nonridge-local-coefficients-v0',
    coefficientBoundary: 'per-sample-pre-tone-map-emission-extinction-v0',
    order: coefficientOrder,
    outputTransform: 'softplus-nonnegative-output-v0',
  },
  footprint: {
    identity: 'support-gradient-oriented-tangent-plane-diagonal-covariance-v0',
    authority: 'analytical-view-independent-post-admission-footprint-v0',
    learnedByCoefficientModel: false,
  },
  descriptorComparison: {
    identity: 'matched-capacity-post-admission-kernel-descriptor-ablation-v0',
    selectionPolicy: 'forward-causal-ablation-smallest-held-gain-subset-v0',
    capacityMatch: {
      identity: 'equal-trainable-parameter-count-v0',
      baselineTrainableParameters: 8192,
      treatmentTrainableParameters: 8192,
    },
    producer: {
      identity: FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY,
      socketModule: descriptorSocketArtifact,
      strideFloats: FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS,
      descriptorOrder: [...FLOW_KERNEL_DESCRIPTOR_ORDER],
      kernelIdentity: descriptorKernelIdentity,
      candidateAdmissionAuthority: 'external-native-cell-index-list-v0',
      requestedRoute: '?volume_resolution=160&volume_kernel_strength=0.6',
      effectiveRoute: '?volume_resolution=160&volume_kernel_strength=0.6',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:apple',
      grid: 160,
      fallbackReason: null,
      requestedControls: { ...descriptorControls },
      effectiveControls: { ...descriptorControls },
      cameraIndependent: true,
      literalTapsExposed: false,
      strengthZeroIdentity: 'raw-source-field-identity-v0',
      validityPolicy: 'conservative-support-validity-majorant-v0',
    },
    baseline: {
      identity: 'current-features-plus-analytical-world-covariance-v0',
      featureViewIdentity: 'post-admission-source-complete-local-features-v0',
      footprintIdentity: 'support-gradient-oriented-tangent-plane-diagonal-covariance-v0',
    },
    treatment: {
      identity: 'current-features-plus-smallest-causal-kernel-descriptor-subset-v0',
      descriptorAuthority: 'camera-independent-flow-kernel-descriptors-v0',
      order: descriptorOrder,
      supportPredicted: false,
      footprintPredicted: false,
      cameraConditioned: false,
      beautyConditioned: false,
    },
    analyticalGeometryArm: {
      identity: 'kernel-moment-analytical-geometry-v0',
      status: 'gated-on-held-descriptor-signal',
      learnedGeometry: false,
      promotionGate: 'arm-two-held-post-admission-gain-v0',
    },
  },
  transportEvaluation: {
    identity: 'one-shared-total-transmittance-v0',
    orderPolicy: 'global-order-one-stream-v0',
    contributionPolicy: 'separate-premultiplied-layer-contributions-under-shared-transmittance-v0',
    independentlyRenderedToneMappedImageAdditivity: false,
  },
  splits: {
    identity: 'whole-simulator-state-holdout-v0',
    train: { stateIds: ['train-state'] },
    heldOut: { stateIds: ['held-state'] },
  },
  states,
};

const inputPath = join(inputDir, 'layer-coefficient-manifest.json');
const reportPath = join(outDir, 'contract-report.json');
const writeManifest = value => writeFile(inputPath, `${JSON.stringify(value, null, 2)}\n`);

await writeManifest(manifest);
const validProbe = spawnSync('python3', [
  scriptUrl.pathname,
  '--input', inputPath,
  '--report', reportPath,
  '--probe-only',
], { encoding: 'utf8' });
assert.equal(validProbe.status, 0, validProbe.stderr || validProbe.stdout);
const report = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(report.status, 'contract-valid');
assert.equal(report.trainingStarted, false);
assert.equal(report.backend, 'not-loaded-probe-only');
assert.equal(report.cohort.retainedRowCount, 8);
assert.equal(report.cohort.droppedRowCount, 0);
assert.deepEqual(report.coefficientTargets.order, coefficientOrder);
assert.equal(report.coefficientTargets.outputTransform, 'softplus-nonnegative-output-v0');
assert.equal(report.admission.authority, 'analytical-not-learned-membership-v0');
assert.equal(report.transportEvaluation.identity, 'one-shared-total-transmittance-v0');
assert.equal(report.descriptorComparison.capacityMatch.baselineTrainableParameters, report.descriptorComparison.capacityMatch.treatmentTrainableParameters);
assert.equal(report.descriptorComparison.treatment.descriptorAuthority, 'camera-independent-flow-kernel-descriptors-v0');
assert.equal(report.descriptorComparison.analyticalGeometryArm.learnedGeometry, false);
assert.equal(report.assays.heldState.generalizationAuthority, 'held-simulator-state-only');
assert.equal(report.lastTrustworthyEvidence.validatedArtifactCount, 20);
assert.equal(report.completionRevalidation.validatedArtifactCount, 20);
assert.equal(report.completionRevalidation.sourceAppearanceCorpusRevalidated, true);

const mutationManifest = structuredClone(manifest);
const mutationFeaturePath = join(inputDir, 'completion-race-features.f32');
const initialMutationBytes = await readFile(manifest.states[0].rows.features.path);
await writeFile(mutationFeaturePath, initialMutationBytes);
mutationManifest.states[0].rows.features.path = mutationFeaturePath;
mutationManifest.states[0].rows.features.bytes = initialMutationBytes.length;
mutationManifest.states[0].rows.features.sha256 = sha256(initialMutationBytes);
await writeManifest(mutationManifest);
const mutationReportPath = join(outDir, 'completion-race-report.json');
const mutationMarkerPath = join(outDir, 'completion-race-marker.json');
const mutationProbe = spawn('python3', [
  scriptUrl.pathname,
  '--input', inputPath,
  '--report', mutationReportPath,
  '--probe-only',
  '--revalidation-marker', mutationMarkerPath,
  '--revalidation-delay-ms', '250',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let mutationStdout = '';
let mutationStderr = '';
mutationProbe.stdout.on('data', chunk => { mutationStdout += chunk; });
mutationProbe.stderr.on('data', chunk => { mutationStderr += chunk; });
const markerDeadline = Date.now() + 10_000;
while (!existsSync(mutationMarkerPath)) {
  assert.ok(Date.now() < markerDeadline, 'completion revalidation marker must appear');
  await new Promise(resolve => setTimeout(resolve, 10));
}
await writeFile(mutationFeaturePath, floatBytes(Array(featureOrder.length * 4).fill(0.875)));
const mutationStatus = await new Promise((resolve, reject) => {
  mutationProbe.once('error', reject);
  mutationProbe.once('close', resolve);
});
assert.notEqual(mutationStatus, 0, 'artifact mutation after initial validation must block publication');
assert.match(`${mutationStderr}\n${mutationStdout}`, /completion-revalidation.*feature artifact sha256/i);
const mutationFailure = JSON.parse(await readFile(mutationReportPath, 'utf8'));
assert.equal(mutationFailure.failurePhase, 'completion-revalidation');
assert.equal(mutationFailure.trainingStarted, false);
await writeManifest(manifest);

async function reject(mutator, pattern, expectedPhase = 'validate-training-authority') {
  const value = structuredClone(manifest);
  await mutator(value);
  const failureReportPath = join(outDir, `failure-${Math.random().toString(16).slice(2)}.json`);
  await writeManifest(value);
  const result = spawnSync('python3', [
    scriptUrl.pathname,
    '--input', inputPath,
    '--report', failureReportPath,
    '--probe-only',
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'invalid layer coefficient authority must fail');
  assert.match(`${result.stderr}\n${result.stdout}`, pattern);
  const failure = JSON.parse(await readFile(failureReportPath, 'utf8'));
  assert.equal(failure.status, 'blocked');
  assert.equal(failure.failurePhase, expectedPhase);
  assert.ok(failure.lastTrustworthyEvidence.inputManifestSha256, 'failure preserves the last trustworthy manifest checksum');
}

await reject(value => { value.admission.authority = 'learned-membership-mlp-v0'; }, /analytical.*membership/i);
await reject(value => { value.transportEvaluation.independentlyRenderedToneMappedImageAdditivity = true; }, /independent.*image/i);
await reject(value => { value.route.fallbackReason = 'fell-back-to-cached-demo'; }, /fallback/i);
await reject(value => { value.cohort.sampleCap = 1024; }, /sample cap/i);
await reject(value => { value.splits.heldOut.stateIds = []; }, /held.*state/i);
await reject(value => { value.states[0].requestedControlIdentity = `sha256:${'f'.repeat(64)}`; }, /requested.*effective.*control/i);
await reject(value => { value.descriptorComparison.capacityMatch.treatmentTrainableParameters += 1; }, /matched.*capacity|trainable parameter/i);
await reject(value => { value.descriptorComparison.producer.cameraIndependent = false; }, /camera.independent/i);
await reject(value => { value.descriptorComparison.producer.literalTapsExposed = true; }, /literal.*tap/i);
await reject(value => {
  value.descriptorComparison.producer.identity = 'invented-descriptor-socket-v0';
}, /producer identity differs.*socket module/i);
await reject(value => {
  value.descriptorComparison.producer.socketModule.sha256 = 'f'.repeat(64);
}, /socket module artifact sha256/i);
await reject(async value => {
  const path = join(inputDir, 'invented-flow-kernel-descriptor-socket.mjs');
  const bytes = Buffer.from([
    "export const FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY = 'invented-descriptor-socket-v0';",
    `export const FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS = ${FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS};`,
    `export const FLOW_KERNEL_DESCRIPTOR_ORDER = ${JSON.stringify([...FLOW_KERNEL_DESCRIPTOR_ORDER])};`,
    '',
  ].join('\n'));
  await writeFile(path, bytes);
  value.descriptorComparison.producer.socketModule = {
    path,
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}, /canonical.*descriptor socket|socket identity must equal.*flow-kernel-local-descriptor-socket-v0/i);
await reject(async value => {
  const path = join(inputDir, 'counterfeit-flow-kernel-descriptor-socket.mjs');
  const counterfeitOrder = [...FLOW_KERNEL_DESCRIPTOR_ORDER];
  counterfeitOrder[0] = 'counterfeit.world.x';
  const bytes = Buffer.from([
    `export const FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY = '${FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY}';`,
    `export const FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS = ${FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS};`,
    `export const FLOW_KERNEL_DESCRIPTOR_ORDER = ${JSON.stringify(counterfeitOrder)};`,
    '',
  ].join('\n'));
  await writeFile(path, bytes);
  value.descriptorComparison.producer.socketModule = {
    path,
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
  value.descriptorComparison.producer.descriptorOrder = counterfeitOrder;
  for (const stateValue of value.states) stateValue.rows.kernelDescriptors.descriptorOrder = counterfeitOrder;
}, /canonical.*descriptor socket/i);
await reject(value => {
  value.states[0].rows.kernelDescriptors.kernelIdentity = 'wrong-kernel-v0';
}, /descriptor kernel identity differs/i);
await reject(value => {
  value.descriptorComparison.producer.candidateAdmissionAuthority = 'native-cell-unfiltered';
}, /candidate admission authority.*external native-cell index/i);
await reject(value => {
  value.states[0].rows.kernelDescriptors.candidateAdmissionAuthority = 'structural-threshold-compacted';
}, /descriptor admission authority.*external native-cell index/i);
await reject(value => {
  value.states[0].rows.kernelDescriptors.admissionIndexAuthority.indexSha256 = 'f'.repeat(64);
}, /descriptor admission index sha256/i);
await reject(async value => {
  const target = value.states[0].rows.nativeCellIndices;
  const bytes = uint32Bytes([0, 1, 1, 3]);
  const path = join(inputDir, 'duplicate-native-cell-indices.u32');
  await writeFile(path, bytes);
  target.path = path;
  target.bytes = bytes.length;
  target.sha256 = sha256(bytes);
  value.states[0].rows.kernelDescriptors.admissionIndexAuthority.indexSha256 = target.sha256;
}, /duplicate native-cell index/i);
await reject(value => {
  value.states[0].rows.kernelDescriptors.admissionArtifactSha256 = 'f'.repeat(64);
}, /descriptor admission artifact sha256/i);
await reject(value => {
  value.states[0].rows.kernelDescriptors.sourceHashes.fluidSha256 = 'f'.repeat(63);
}, /source hashes|fluidSha256.*sha256/i);
await reject(value => {
  value.states[0].rows.kernelDescriptors.sourceHashes.fluidSha256 = 'f'.repeat(64);
}, /descriptor source hash.*source field/i);
await reject(value => {
  value.states[0].rows.kernelDescriptors.sourceManifestSha256 = 'f'.repeat(64);
}, /descriptor source manifest sha256/i);
await reject(value => { delete value.descriptorComparison.producer.requestedRoute; }, /descriptor.*requested route/i);
await reject(value => { value.descriptorComparison.producer.fallbackReason = 'stale-kernel-cache'; }, /descriptor.*fallback/i);
await reject(value => { value.descriptorComparison.producer.backend = 'WebGL2'; }, /descriptor.*WebGPU/i);
await reject(value => { value.descriptorComparison.producer.effectiveControls.radiusWorld = 0.02; }, /requested and effective kernel controls differ/i);
await reject(value => { value.descriptorComparison.treatment.order.push('kernel.tap.7'); }, /literal.*tap|descriptor.*allowed/i);
await reject(value => { value.descriptorComparison.treatment.order.push('position.world.x'); }, /descriptor.*treatment.*prohibited/i);
await reject(value => { value.descriptorComparison.treatment.order.push('structure.normal.x'); }, /descriptor.*treatment.*prohibited/i);
await reject(value => { value.descriptorComparison.treatment.cameraConditioned = true; }, /camera conditioning/i);
await reject(value => { value.descriptorComparison.treatment.supportPredicted = true; }, /support.*predicted|analytical admission/i);
await reject(value => { value.descriptorComparison.treatment.footprintPredicted = true; }, /footprint.*predicted|analytical.*geometry/i);
await reject(value => { value.descriptorComparison.analyticalGeometryArm.learnedGeometry = true; }, /analytical.*geometry/i);
await reject(async value => {
  const target = value.states[0].rows.kernelDescriptors;
  const values = Array.from(descriptorRowsForFixture());
  values[FLOW_KERNEL_DESCRIPTOR_ORDER.indexOf('majorant.extinction')] = -0.1;
  const bytes = floatBytes(values);
  const path = join(inputDir, 'invalid-kernel-descriptor-majorant.f32');
  await writeFile(path, bytes);
  target.path = path;
  target.bytes = bytes.length;
  target.sha256 = sha256(bytes);
}, /descriptor.*majorant.*nonnegative/i);

await reject(async value => {
  value.descriptorComparison.producer.requestedControls.strength = 0;
  value.descriptorComparison.producer.effectiveControls.strength = 0;
  for (const [stateIndex, stateValue] of value.states.entries()) {
    const target = stateValue.rows.kernelDescriptors;
    target.requestedControls.strength = 0;
    target.effectiveControls.strength = 0;
    const values = Array.from(descriptorRowsForFixture());
    for (let row = 0; row < stateValue.rows.count; row += 1) {
      const offset = row * FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS;
      values[offset + FLOW_KERNEL_DESCRIPTOR_ORDER.indexOf('validity.strengthZeroIdentity')] = 1;
      values[offset + FLOW_KERNEL_DESCRIPTOR_ORDER.indexOf('kernel.covariance.xx')] = 0.1;
      values[offset + FLOW_KERNEL_DESCRIPTOR_ORDER.indexOf('kernel.radiusWorld')] = 0.01;
    }
    const bytes = floatBytes(values);
    const path = join(inputDir, `invalid-strength-zero-${stateIndex}.f32`);
    await writeFile(path, bytes);
    target.path = path;
    target.bytes = bytes.length;
    target.sha256 = sha256(bytes);
  }
}, /strength-zero.*moments/i);

await reject(async value => {
  const bytes = Buffer.from(`${JSON.stringify({
    schema: 'kaminos-boundary-splat-appearance-coefficient-corpus-v1',
    authority: 'live-simulator-frozen-state-multi-camera-positive-full-flame-coefficients-with-signed-comparator-v1',
  })}\n`);
  const path = join(inputDir, 'malformed-appearance-corpus.json');
  await writeFile(path, bytes);
  value.sourceAppearanceCorpus.path = path;
  value.sourceAppearanceCorpus.bytes = bytes.length;
  value.sourceAppearanceCorpus.sha256 = sha256(bytes);
}, /source appearance corpus.*(?:cohort|validation)/i);

await reject(async value => {
  const target = value.states[0].rows.coefficients;
  const bytes = floatBytes([
    -1, 0.7, 0.3, 0.5, 0, 0, 0, 0,
    1, 0.7, 0.3, 0.5, 0, 0, 0, 0,
    0, 0, 0, 0, 0.8, 0.5, 0.2, 0.4,
    0, 0, 0, 0, 0.8, 0.5, 0.2, 0.4,
  ]);
  await writeFile(target.path, bytes);
  target.bytes = bytes.length;
  target.sha256 = sha256(bytes);
}, /nonnegative/i);

await reject(async value => {
  const target = value.states[0].rows.coefficients;
  const bytes = floatBytes([
    1, 0.7, 0.3, 0.5, 0.2, 0, 0, 0,
    1, 0.7, 0.3, 0.5, 0, 0, 0, 0,
    0, 0, 0, 0, 0.8, 0.5, 0.2, 0.4,
    0, 0, 0, 0, 0.8, 0.5, 0.2, 0.4,
  ]);
  await writeFile(target.path, bytes);
  target.bytes = bytes.length;
  target.sha256 = sha256(bytes);
}, /outside.*admission/i);

await reject(value => {
  delete value.states[0].rows.coefficients;
}, /coefficient.*artifact.*missing/i);

await reject(async value => {
  const target = value.states[0].rows.coefficients;
  const path = join(inputDir, 'train-state-coefficients-blank.f32');
  await writeFile(path, Buffer.alloc(0));
  target.path = path;
  target.bytes = 0;
  target.sha256 = sha256(Buffer.alloc(0));
}, /coefficient.*artifact.*blank/i);

console.log('volume layer coefficient learner contracts passed');
