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
assert.match(script, /kernel-moment-analytical-geometry-v0/, 'learner keeps kernel-moment geometry analytical and separately gated');
assert.match(script, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'learner writes phase-local failure evidence');
assert.match(script, /--probe-only/, 'learner exposes a no-training contract probe');

const { BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER } = await import(
  new URL('../boundary-splat-feature-capture.mjs', import.meta.url)
);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const root = await mkdtemp(join(tmpdir(), 'kaminos-layer-coefficients-'));
const inputDir = join(root, 'input');
const outDir = join(root, 'output');
await Promise.all([mkdir(inputDir), mkdir(outDir)]);

function floatBytes(values) {
  const array = Float32Array.from(values);
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
  'kernel.mass',
  'kernel.meanOffset.x',
  'kernel.meanOffset.y',
  'kernel.meanOffset.z',
  'kernel.flowCoherence',
];
const descriptorValidityOrder = ['kernel.validity', 'kernel.majorant'];
const descriptorSocketIdentity = `sha256:${'b'.repeat(64)}`;
const descriptorSourceFieldIdentity = `sha256:${'c'.repeat(64)}`;
const descriptorKernelControlIdentity = `sha256:${'d'.repeat(64)}`;

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
  const kernelDescriptors = await artifact(
    `${id}-kernel-descriptors`,
    Array.from({ length: count * descriptorOrder.length }, (_, index) => (phase + index + 1) / 64),
    [count, descriptorOrder.length],
    'camera-independent-flow-kernel-descriptors',
  );
  Object.assign(kernelDescriptors, {
    socketIdentity: descriptorSocketIdentity,
    sourceFieldIdentity: descriptorSourceFieldIdentity,
    kernelControlIdentity: descriptorKernelControlIdentity,
    descriptorOrder,
  });
  const kernelDescriptorValidity = await artifact(
    `${id}-kernel-descriptor-validity`,
    [1, 0.8, 1, 0.7, 1, 0.9, 1, 0.6],
    [count, descriptorValidityOrder.length],
    'conservative-kernel-descriptor-validity-majorant',
  );
  Object.assign(kernelDescriptorValidity, {
    socketIdentity: descriptorSocketIdentity,
    sourceFieldIdentity: descriptorSourceFieldIdentity,
    kernelControlIdentity: descriptorKernelControlIdentity,
    descriptorOrder: descriptorValidityOrder,
  });
  return {
    id,
    splitRole,
    sameStateCaptureId: `capture-${id}`,
    requestedControlIdentity: `sha256:${String(phase + 1).repeat(64).slice(0, 64)}`,
    effectiveControlIdentity: `sha256:${String(phase + 1).repeat(64).slice(0, 64)}`,
    rows: {
      count,
      features: await artifact(`${id}-features`, features, [count, featureOrder.length], 'post-admission-local-features'),
      admission: await artifact(`${id}-admission`, admissions, [count, admissionOrder.length], 'analytical-ridge-or-nonridge-admission'),
      coefficients: await artifact(`${id}-coefficients`, targets, [count, coefficientOrder.length], 'exact-local-layer-emission-extinction'),
      kernelDescriptors,
      kernelDescriptorValidity,
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
      schema: 'kaminos.flow-kernel-local-descriptor.v0',
      socketIdentity: descriptorSocketIdentity,
      sourceFieldIdentity: descriptorSourceFieldIdentity,
      requestedKernelControlIdentity: descriptorKernelControlIdentity,
      effectiveKernelControlIdentity: descriptorKernelControlIdentity,
      requestedRoute: '?volume_resolution=160&volume_kernel_strength=0.6',
      effectiveRoute: '?volume_resolution=160&volume_kernel_strength=0.6',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:apple',
      grid: 160,
      fallbackReason: null,
      requestedControls: { strength: 0.6, worldRadius: 0.018, flowCoherence: 0.7 },
      effectiveControls: { strength: 0.6, worldRadius: 0.018, flowCoherence: 0.7 },
      cameraIndependent: true,
      literalKernelTapsIncluded: false,
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
assert.equal(report.lastTrustworthyEvidence.validatedArtifactCount, 11);
assert.equal(report.completionRevalidation.validatedArtifactCount, 11);
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
await reject(value => { value.descriptorComparison.producer.literalKernelTapsIncluded = true; }, /literal.*tap/i);
await reject(value => { value.descriptorComparison.producer.effectiveKernelControlIdentity = `sha256:${'e'.repeat(64)}`; }, /requested.*effective.*kernel/i);
await reject(value => {
  value.descriptorComparison.producer.socketIdentity = `sha256:${'e'.repeat(64)}`;
}, /descriptor.*socket identity.*artifact/i);
await reject(value => {
  value.descriptorComparison.producer.sourceFieldIdentity = `sha256:${'e'.repeat(64)}`;
}, /descriptor.*source field identity.*artifact/i);
await reject(value => {
  value.states[0].rows.kernelDescriptors.kernelControlIdentity = `sha256:${'e'.repeat(64)}`;
}, /descriptor.*kernel control identity.*artifact/i);
await reject(value => { delete value.descriptorComparison.producer.requestedRoute; }, /descriptor.*requested route/i);
await reject(value => { value.descriptorComparison.producer.fallbackReason = 'stale-kernel-cache'; }, /descriptor.*fallback/i);
await reject(value => { value.descriptorComparison.producer.backend = 'WebGL2'; }, /descriptor.*WebGPU/i);
await reject(value => { value.descriptorComparison.producer.effectiveControls.worldRadius = 0.02; }, /requested.*effective.*kernel controls/i);
await reject(value => { value.descriptorComparison.treatment.order.push('kernel.tap.7'); }, /literal.*tap|descriptor.*allowed/i);
await reject(value => { value.descriptorComparison.treatment.cameraConditioned = true; }, /camera conditioning/i);
await reject(value => { value.descriptorComparison.treatment.supportPredicted = true; }, /support.*predicted|analytical admission/i);
await reject(value => { value.descriptorComparison.treatment.footprintPredicted = true; }, /footprint.*predicted|analytical.*geometry/i);
await reject(value => { value.descriptorComparison.analyticalGeometryArm.learnedGeometry = true; }, /analytical.*geometry/i);
await reject(async value => {
  const target = value.states[0].rows.kernelDescriptorValidity;
  const bytes = floatBytes([1, 0.8, 0, -0.1, 1, 0.9, 1, 0.6]);
  const path = join(inputDir, 'invalid-kernel-descriptor-validity.f32');
  await writeFile(path, bytes);
  target.path = path;
  target.bytes = bytes.length;
  target.sha256 = sha256(bytes);
}, /descriptor.*majorant.*nonnegative/i);

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
