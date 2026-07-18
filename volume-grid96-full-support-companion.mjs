#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRID96_FULL_SUPPORT_COMPANION_SCHEMA = 'kaminos.volume.grid96-full-support-companion.v0';
export const GRID96_CAUSAL_QUESTION = 'source-lattice-subcell-vs-deposit-space-quadrature-v0';
export const GRID96_NATIVE_CELL_COUNT = 96 ** 3;
export const GRID96_DESCRIPTOR_ORDER = Object.freeze([
  'position.world.x', 'position.world.y', 'position.world.z', 'position.nativeCellIndex',
  'kernel.normalizedMass', 'kernel.firstMoment.x', 'kernel.firstMoment.y', 'kernel.firstMoment.z',
  'kernel.covariance.xx', 'kernel.covariance.xy', 'kernel.covariance.xz', 'kernel.covariance.yy',
  'kernel.covariance.yz', 'kernel.covariance.zz', 'kernel.radiusWorld', 'kernel.coherence',
  'structure.normal.x', 'structure.normal.y', 'structure.normal.z', 'structure.normalValid',
  'flow.tangent.x', 'flow.tangent.y', 'flow.tangent.z', 'flow.coherence',
  'flow.curl.x', 'flow.curl.y', 'flow.curl.z', 'flow.curlMagnitude',
  'flow.divergence', 'flow.curlActivity', 'validity.strengthZeroIdentity', 'validity.conservativeMajorant',
  'majorant.density', 'majorant.fire', 'majorant.extinction', 'majorant.importance',
  'value.sidecar.x', 'value.sidecar.y', 'value.sidecar.z', 'value.sidecar.w',
  'value.material.x', 'value.material.y', 'value.material.z', 'value.material.w',
  'value.fire.x', 'value.fire.y', 'value.fire.z', 'value.fire.w',
  'value.micro.x', 'value.micro.y', 'value.micro.z', 'value.micro.w',
  'gradient.sidecar.x.x', 'gradient.sidecar.y.x', 'gradient.sidecar.z.x', 'gradient.sidecar.w.x',
  'gradient.sidecar.x.y', 'gradient.sidecar.y.y', 'gradient.sidecar.z.y', 'gradient.sidecar.w.y',
  'gradient.sidecar.x.z', 'gradient.sidecar.y.z', 'gradient.sidecar.z.z', 'gradient.sidecar.w.z',
  'gradient.material.x.x', 'gradient.material.y.x', 'gradient.material.z.x', 'gradient.material.w.x',
  'gradient.material.x.y', 'gradient.material.y.y', 'gradient.material.z.y', 'gradient.material.w.y',
  'gradient.material.x.z', 'gradient.material.y.z', 'gradient.material.z.z', 'gradient.material.w.z',
  'gradient.fire.x.x', 'gradient.fire.y.x', 'gradient.fire.z.x', 'gradient.fire.w.x',
  'gradient.fire.x.y', 'gradient.fire.y.y', 'gradient.fire.z.y', 'gradient.fire.w.y',
  'gradient.fire.x.z', 'gradient.fire.y.z', 'gradient.fire.z.z', 'gradient.fire.w.z',
  'gradient.micro.x.x', 'gradient.micro.y.x', 'gradient.micro.z.x', 'gradient.micro.w.x',
  'gradient.micro.x.y', 'gradient.micro.y.y', 'gradient.micro.z.y', 'gradient.micro.w.y',
  'gradient.micro.x.z', 'gradient.micro.y.z', 'gradient.micro.z.z', 'gradient.micro.w.z',
]);

const EXPECTED_GRID = 96;
const EXPECTED_MAJORANT_GRID = 24;
const EXPECTED_GRID160_MANIFEST_SHA256 = '340812f670ce2159e52a1b43335b3d3e473e0fa4120ff29e8228faf676584375';
const EXPECTED_GRID160_SOURCE_SHA256 = '2841b79f3ae625bba8b7f36f2b5f7ae40755814b95214a2607a95b3390456483';
const EXPECTED_GRID160_SUPPORT_SHA256 = '995f195f0079108fd9de2b51c3e011fb758af4c0e3a594c2d24b9dcc5306e9f9';
const EXPECTED_GRID160_DESCRIPTOR_SHA256 = '4cae2517538cf701ac97aad9382f4d150526de8c11e6513c3b98a82d4b5f0122';
const EXPECTED_GRID160_EVIDENCE_COMMIT = '4e9e602e';
const EXPECTED_SUPPORT_IDENTITY = 'full-flame-ridge-nonridge-live-union-v0';
const EXPECTED_ADMISSION_IDENTITY = 'explicit-ridge-union-promoted-nonridge-source-selector-v0';
const EXPECTED_ADMISSION_AUTHORITY = 'external-native-cell-index-list-v0';
const EXPECTED_DESCRIPTOR_IDENTITY = 'flow-kernel-local-descriptor-socket-v0';
const EXPECTED_KERNEL_IDENTITY = 'flow-tangent-positive-symmetric-trilinear-v0';
const EXPECTED_COEFFICIENT_IDENTITY = 'exact-local-layer-emission-extinction-v0';
const EXPECTED_COEFFICIENT_BOUNDARY = 'per-sample-pre-tone-map-emission-extinction-v0';
const EXPECTED_PARTITION_IDENTITY = 'separate-nonnegative-ridge-and-nonridge-local-coefficients-v0';
const EXPECTED_CAMERA_IDENTITY = 'filament-orbit-21-camera-yaw-v0';
const EXPECTED_TEACHER_IDENTITY = 'exact-same-state-shared-transmittance-intrinsic-target-v0';
const EXPECTED_TRANSPORT_IDENTITY = 'ridge-plus-non-ridge-extinction-one-running-transmittance-v0';
const EXPECTED_COMPOSITION_IDENTITY = 'one-globally-ordered-stream-v0';
const EXPECTED_RENDERER_IDENTITY = 'offline-exact-coefficient-shared-transmittance-oracle-v0';
const EXPECTED_TARGET_WIDTH = 314;
const EXPECTED_TARGET_HEIGHT = 242;
const EXPECTED_CAMERA_ANGLES = Object.freeze(Array.from({ length: 21 }, (_, index) => Number((-0.42 + index * 0.042).toFixed(3))));
const EXPECTED_FLUID_CHANNELS = Object.freeze([
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier', 'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront', 'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
]);
const EXPECTED_COEFFICIENT_CHANNELS = Object.freeze([
  'ridge.emission.r', 'ridge.emission.g', 'ridge.emission.b', 'ridge.extinction',
  'nonRidge.emission.r', 'nonRidge.emission.g', 'nonRidge.emission.b', 'nonRidge.extinction',
]);
const FORBIDDEN_NATIVE_LINEAGE = /(?:resize|resampl|upsampl|downsampl|grid160.*(?:source|geometry)|(?:source|geometry).*grid160)/i;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function buildGrid96FullSupportCompanion(inputs) {
  validateAll(inputs);
  const components = Object.fromEntries(Object.entries(inputs.refs).map(([role, ref]) => [role, { ...ref }]));
  const payload = {
    schema: GRID96_FULL_SUPPORT_COMPANION_SCHEMA,
    status: 'complete',
    failurePhase: null,
    causalQuestion: GRID96_CAUSAL_QUESTION,
    grid: EXPECTED_GRID,
    nativeCellCount: GRID96_NATIVE_CELL_COUNT,
    sameStateCaptureId: inputs.source.sameStateCaptureId,
    simStepCount: inputs.source.simStepCount,
    requestedControlIdentity: inputs.source.requestedControlIdentity,
    effectiveControlIdentity: inputs.source.effectiveControlIdentity,
    sourceManifestSha256: inputs.refs.source.sha256,
    sourceRoute: { ...inputs.source.route },
    source: {
      authority: inputs.source.authority,
      completeFieldCoverage: inputs.source.completeFieldCoverage,
      fullGridCellCount: inputs.source.fullGridCellCount,
      sidecars: clone(inputs.source.sidecars),
    },
    support: pick(inputs.support, [
      'identity', 'admissionIdentity', 'admissionAuthority', 'nativeCellIndexSha256', 'rowCount',
      'sampleCap', 'droppedRowCount', 'overflowCount', 'duplicatePolicy', 'nativeCellIndices', 'admission', 'features',
    ]),
    descriptors: pick(inputs.descriptors, [
      'identity', 'kernelIdentity', 'candidateAdmissionAuthority', 'nativeCellIndexSha256', 'rowCount',
      'strideFloats', 'descriptorOrder', 'artifact',
    ]),
    coefficients: pick(inputs.coefficients, [
      'identity', 'coefficientBoundary', 'partitionIdentity', 'channels', 'nonnegative',
      'nativeCellIndexSha256', 'rowCount', 'artifact',
    ]),
    cameraCohort: pick(inputs.cameras, [
      'identity', 'indices', 'angles', 'calibrationCameraIndex', 'heldOutCameraIndices', 'cameras',
    ]),
    teacher: pick(inputs.teacher, [
      'identity', 'coefficientBoundary', 'transportIdentity', 'compositionIdentity', 'rendererIdentity',
      'cameraCohortIdentity', 'cameraCount', 'calibrationCameraIndex', 'heldOutCameraIndices', 'targetCount',
      'targetWidth', 'targetHeight', 'supportNativeCellIndexSha256', 'coefficientArtifactSha256',
      'executionRoute', 'targets',
    ]),
    comparison: {
      role: 'immutable-external-comparison-only',
      grid: inputs.comparison.sourceState.grid,
      manifestIdentity: inputs.comparison.manifestIdentity,
      sourceStateIdentity: inputs.comparison.sourceState.identity,
      sourceManifestSha256: inputs.comparison.sourceState.sourceManifestSha256,
      supportNativeCellIndexSha256: inputs.comparison.support.nativeCellIndexSha256,
      descriptorSha256: inputs.comparison.covariance.descriptorSha256,
      supportRowCount: inputs.comparison.support.rowCount,
      cameraCohortIdentity: inputs.comparison.cameraOrbit.identity,
      targetIdentity: inputs.comparison.target.identity,
      manifest: components.comparison,
    },
    components,
    claimBoundary: {
      supports: 'Native grid96 causal comparison against immutable native grid160 evidence with support, optical algebra, teacher, and camera roles held semantically fixed.',
      doesNotSupport: [
        'cheaper-demo operation',
        'deposition or footprint adjudication',
        'learner architecture or campaign conclusions',
        'resized or resampled grid160 evidence',
        'shipping renderer parity',
      ],
      cheaperDemoClaim: false,
      depositionAdjudication: false,
      learnerCampaign: false,
    },
  };
  return { ...payload, identity: `sha256:${sha256(Buffer.from(stableJson(payload)))}` };
}

function validateAll(inputs) {
  const native = [
    ['source', inputs.source], ['support', inputs.support], ['descriptors', inputs.descriptors],
    ['coefficients', inputs.coefficients], ['camera-cohort', inputs.cameras], ['teacher', inputs.teacher],
  ];
  for (const [role, component] of native) validateNativeComponent(component, role, inputs.source.route);
  validateSameStateAndSource(native, inputs.refs.source.sha256);
  validateSource(inputs.source);
  validateSupport(inputs.support);
  validateDescriptors(inputs.descriptors, inputs.support);
  validateCoefficients(inputs.coefficients, inputs.support);
  validateCameraCohort(inputs.cameras);
  validateTeacher(inputs.teacher, inputs.cameras, inputs.support, inputs.coefficients);
  validateGrid160Comparison(inputs.comparison, inputs.support, inputs.refs.comparison.sha256);
}

function validateNativeComponent(component, role, sourceRoute) {
  assert.ok(component && typeof component === 'object', `${role} native component is missing`);
  assert.equal(component.status, 'complete', `${role} native component is not complete`);
  assert.equal(component.failurePhase, null, `${role} native component carries a failure phase`);
  assert.equal(component.role, role, `${role} native component role is false`);
  assert.equal(component.grid, EXPECTED_GRID, `${role} native component grid must equal ${EXPECTED_GRID}`);
  assertNonblank(component.sameStateCaptureId, `${role} same-state capture identity`);
  assertPositiveInteger(component.simStepCount, `${role} simulator step`);
  assertNonblank(component.requestedControlIdentity, `${role} requested control identity`);
  assertNonblank(component.effectiveControlIdentity, `${role} effective control identity`);
  assert.equal(component.requestedControlIdentity, component.effectiveControlIdentity, `${role} controls were substituted`);
  if (role === 'teacher') {
    assertSourceRoute(component.sourceRoute, role);
    assertExecutionRoute(component.executionRoute, role);
  } else {
    assertSourceRoute(component.route, role);
    if (sourceRoute) assert.equal(component.route.requested, sourceRoute.requested, `${role} requested source route differs from source`);
  }
  if (containsForbiddenNativeLineage(component)) throw new Error(`${role} native component contains resize or resample lineage`);
}

function containsForbiddenNativeLineage(value) {
  if (typeof value === 'string') return FORBIDDEN_NATIVE_LINEAGE.test(value);
  if (Array.isArray(value)) return value.some(item => containsForbiddenNativeLineage(item));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([childKey, childValue]) => {
    const assertedByKey = FORBIDDEN_NATIVE_LINEAGE.test(childKey)
      && childValue !== false
      && childValue != null
      && childValue !== 0
      && childValue !== '';
    return assertedByKey || containsForbiddenNativeLineage(childValue);
  });
}

function validateSameStateAndSource(components, sourceManifestSha256) {
  const source = components[0][1];
  assertSha256(sourceManifestSha256, 'source manifest');
  for (const [role, component] of components.slice(1)) {
    assert.equal(component.sameStateCaptureId, source.sameStateCaptureId, `${role} does not share the source capture identity`);
    assert.equal(component.simStepCount, source.simStepCount, `${role} does not share the source simulator step`);
    assert.equal(component.requestedControlIdentity, source.requestedControlIdentity, `${role} requested controls differ from source`);
    assert.equal(component.effectiveControlIdentity, source.effectiveControlIdentity, `${role} effective controls differ from source`);
    assert.equal(component.sourceManifestSha256, sourceManifestSha256, `${role} source manifest hash differs from source`);
    const componentSourceRoute = role === 'teacher' ? component.sourceRoute : component.route;
    assert.equal(componentSourceRoute.requested, source.route.requested, `${role} requested route differs from source`);
    assert.equal(componentSourceRoute.effective, source.route.effective, `${role} effective source route differs from source`);
    assert.equal(componentSourceRoute.backend, source.route.backend, `${role} source backend differs from source`);
  }
}

function validateSource(source) {
  assert.equal(source.authority, 'native-grid96-full-field-export-v0', 'source authority must name native grid96 export');
  assert.equal(source.completeFieldCoverage, true, 'source does not assert complete field coverage');
  assert.equal(source.fullGridCellCount, GRID96_NATIVE_CELL_COUNT, 'source full-grid cell count is incomplete');
  validateArtifact(source.sidecars?.fluid, {
    label: 'source fluid', dtype: 'float32-le', shape: [96, 96, 96, 16], semanticRole: 'full-field-fluid', channelOrder: EXPECTED_FLUID_CHANNELS,
  });
  validateArtifact(source.sidecars?.front, {
    label: 'source front', dtype: 'float32-le', shape: [96, 96, 96, 1], semanticRole: 'full-field-front', channelOrder: ['frontTopology'],
  });
  validateArtifact(source.sidecars?.boundary, {
    label: 'source boundary', dtype: 'float32-le', shape: [96, 96, 96, 4], semanticRole: 'full-field-boundary', channelOrder: ['support', 'coverage', 'ridge', 'footprint'],
  });
  validateArtifact(source.sidecars?.majorant, {
    label: 'source majorant', dtype: 'float32-le', shape: [EXPECTED_MAJORANT_GRID, EXPECTED_MAJORANT_GRID, EXPECTED_MAJORANT_GRID, 4],
    semanticRole: 'full-field-majorant', channelOrder: ['density', 'fire', 'extinction', 'importance'],
  });
}

function validateSupport(support) {
  assert.equal(support.identity, EXPECTED_SUPPORT_IDENTITY, 'support identity drifted from Full Flame union');
  assert.equal(support.admissionIdentity, EXPECTED_ADMISSION_IDENTITY, 'support admission identity drifted');
  assert.equal(support.admissionAuthority, EXPECTED_ADMISSION_AUTHORITY, 'support admission is not an exact native-cell index list');
  assertSha256(support.nativeCellIndexSha256, 'support native-cell index');
  assertPositiveInteger(support.rowCount, 'support row count');
  assert.ok(support.rowCount <= GRID96_NATIVE_CELL_COUNT, 'support row count exceeds the native grid96 cell count');
  assert.equal(support.sampleCap, null, 'support sampleCap must be null');
  assert.equal(support.droppedRowCount, 0, 'support dropped rows must be zero');
  assert.equal(support.overflowCount, 0, 'support overflow must be zero');
  assert.equal(support.duplicatePolicy, 'forbidden', 'support duplicates must be forbidden');
  const indexReceipt = validateArtifact(support.nativeCellIndices, {
    label: 'support native-cell indices', dtype: 'uint32-le', shape: [support.rowCount], semanticRole: 'analytical-admission-native-cell-indices',
  });
  assert.equal(indexReceipt.sha256, support.nativeCellIndexSha256, 'support native-cell index hash is not backed by its artifact');
  validateNativeCellIndices(indexReceipt.buffer, support.rowCount);
  const admissionReceipt = validateArtifact(support.admission, {
    label: 'support admission', dtype: 'float32-le', shape: [support.rowCount, 2], semanticRole: 'analytical-ridge-or-nonridge-admission',
  });
  validateFloatPayload(admissionReceipt.buffer, 'support admission', {
    nonnegative: true,
    rowWidth: 2,
    requirePositivePerRow: 'Ridge or Non-Ridge membership',
  });
  const featureReceipt = validateArtifact(support.features, {
    label: 'support features', dtype: 'float32-le', shape: [support.rowCount, 24], semanticRole: 'post-admission-local-features',
  });
  validateFloatPayload(featureReceipt.buffer, 'support features');
}

function validateDescriptors(descriptors, support) {
  assert.equal(descriptors.identity, EXPECTED_DESCRIPTOR_IDENTITY, 'descriptor socket identity drifted');
  assert.equal(descriptors.kernelIdentity, EXPECTED_KERNEL_IDENTITY, 'descriptor kernel identity drifted');
  assert.equal(descriptors.candidateAdmissionAuthority, EXPECTED_ADMISSION_AUTHORITY, 'descriptor admission authority drifted');
  assert.equal(descriptors.nativeCellIndexSha256, support.nativeCellIndexSha256, 'descriptors do not share the exact native-cell support identity');
  assert.equal(descriptors.rowCount, support.rowCount, 'descriptor rows do not cover exact support');
  assert.equal(descriptors.strideFloats, GRID96_DESCRIPTOR_ORDER.length, 'descriptor stride must remain 100 floats');
  assert.deepEqual(descriptors.descriptorOrder, GRID96_DESCRIPTOR_ORDER, 'descriptor order drifted from the exact kernel socket');
  const descriptorReceipt = validateArtifact(descriptors.artifact, {
    label: 'kernel descriptors', dtype: 'float32-le', shape: [support.rowCount, GRID96_DESCRIPTOR_ORDER.length], semanticRole: 'camera-independent-flow-kernel-descriptors',
  });
  validateFloatPayload(descriptorReceipt.buffer, 'kernel descriptors');
}

function validateCoefficients(coefficients, support) {
  assert.equal(coefficients.identity, EXPECTED_COEFFICIENT_IDENTITY, 'coefficient teacher identity drifted');
  assert.equal(coefficients.coefficientBoundary, EXPECTED_COEFFICIENT_BOUNDARY, 'coefficient boundary drifted');
  assert.equal(coefficients.partitionIdentity, EXPECTED_PARTITION_IDENTITY, 'Ridge/Non-Ridge partition identity drifted');
  assert.deepEqual(coefficients.channels, EXPECTED_COEFFICIENT_CHANNELS, 'coefficient channel order drifted');
  assert.equal(coefficients.nonnegative, true, 'coefficient channels must remain nonnegative');
  assert.equal(coefficients.nativeCellIndexSha256, support.nativeCellIndexSha256, 'coefficients do not share the exact native-cell support identity');
  assert.equal(coefficients.rowCount, support.rowCount, 'coefficient rows do not cover exact support');
  const coefficientReceipt = validateArtifact(coefficients.artifact, {
    label: 'exact layer coefficients', dtype: 'float32-le', shape: [support.rowCount, 8], semanticRole: 'exact-local-layer-emission-extinction',
  });
  validateFloatPayload(coefficientReceipt.buffer, 'exact layer coefficients', { nonnegative: true });
}

function validateCameraCohort(cameras) {
  assert.equal(cameras.identity, EXPECTED_CAMERA_IDENTITY, 'camera cohort identity drifted');
  const indices = Array.from({ length: 21 }, (_, index) => index);
  assert.deepEqual(cameras.indices, indices, 'camera cohort must contain the exact 21-camera orbit');
  assert.deepEqual(cameras.angles, EXPECTED_CAMERA_ANGLES, 'camera orbit angles drifted');
  assert.equal(cameras.calibrationCameraIndex, 10, 'camera 10 must remain the only calibration camera');
  assert.deepEqual(cameras.heldOutCameraIndices, indices.filter(index => index !== 10), 'camera cohort must contain exactly 20 held-out cameras');
  assert.equal(cameras.cameras?.length, 21, 'camera cohort is partial');
  assert.deepEqual(cameras.cameras.map(camera => camera.index), indices, 'camera entries do not map one-to-one onto the exact orbit');
  assert.equal(new Set(cameras.cameras.map(camera => camera.id)).size, 21, 'camera identities are duplicated');
  for (const camera of cameras.cameras) {
    assert.equal(camera.angle, EXPECTED_CAMERA_ANGLES[camera.index], `camera ${camera.index} angle drifted`);
    assert.equal(camera.split, camera.index === 10 ? 'calibration' : 'heldout', `camera ${camera.index} split drifted`);
    finiteArray(camera.pose?.position, 3, `camera ${camera.index} position`);
    finiteArray(camera.pose?.target, 3, `camera ${camera.index} target`);
  }
}

function validateTeacher(teacher, cameras, support, coefficients) {
  assert.equal(teacher.identity, EXPECTED_TEACHER_IDENTITY, 'teacher target identity drifted');
  assert.equal(teacher.coefficientBoundary, EXPECTED_COEFFICIENT_BOUNDARY, 'teacher coefficient boundary drifted');
  assert.equal(teacher.transportIdentity, EXPECTED_TRANSPORT_IDENTITY, 'teacher transport no longer uses one running transmittance');
  assert.equal(teacher.compositionIdentity, EXPECTED_COMPOSITION_IDENTITY, 'teacher global stream composition drifted');
  assert.equal(teacher.rendererIdentity, EXPECTED_RENDERER_IDENTITY, 'teacher renderer identity drifted');
  assert.equal(teacher.cameraCohortIdentity, cameras.identity, 'teacher camera cohort identity drifted');
  assert.equal(teacher.cameraCount, 21, 'teacher camera cohort is partial');
  assert.equal(teacher.targetCount, 21, 'teacher target cohort is partial');
  assert.equal(teacher.targetWidth, EXPECTED_TARGET_WIDTH, `teacher target width must remain ${EXPECTED_TARGET_WIDTH}`);
  assert.equal(teacher.targetHeight, EXPECTED_TARGET_HEIGHT, `teacher target height must remain ${EXPECTED_TARGET_HEIGHT}`);
  assert.equal(teacher.supportNativeCellIndexSha256, support.nativeCellIndexSha256, 'teacher support identity drifted');
  assert.equal(teacher.coefficientArtifactSha256, coefficients.artifact.sha256, 'teacher coefficient artifact identity drifted');
  assert.equal(teacher.calibrationCameraIndex, cameras.calibrationCameraIndex, 'teacher calibration camera drifted');
  assert.deepEqual(teacher.heldOutCameraIndices, cameras.heldOutCameraIndices, 'teacher held-out camera roles drifted');
  assert.equal(teacher.targets?.length, 21, 'teacher target artifacts are partial');
  assert.deepEqual(teacher.targets.map(target => target.cameraIndex), cameras.indices, 'teacher targets do not map one-to-one onto the camera orbit');
  for (const target of teacher.targets) {
    const camera = cameras.cameras[target.cameraIndex];
    assert.equal(target.cameraId, camera.id, `teacher camera ${target.cameraIndex} identity drifted`);
    assert.equal(target.split, camera.split, `teacher camera ${target.cameraIndex} split drifted`);
    assert.equal(target.sameStateCaptureId, teacher.sameStateCaptureId, `teacher camera ${target.cameraIndex} state identity drifted`);
    assert.equal(target.simStepCount, teacher.simStepCount, `teacher camera ${target.cameraIndex} simulator step drifted`);
    assert.equal(target.sourceManifestSha256, teacher.sourceManifestSha256, `teacher camera ${target.cameraIndex} source hash drifted`);
    assert.equal(target.supportNativeCellIndexSha256, teacher.supportNativeCellIndexSha256, `teacher camera ${target.cameraIndex} support identity drifted`);
    assert.equal(target.coefficientArtifactSha256, teacher.coefficientArtifactSha256, `teacher camera ${target.cameraIndex} coefficient artifact hash drifted`);
    assert.equal(target.width, teacher.targetWidth, `teacher camera ${target.cameraIndex} declared width drifted`);
    assert.equal(target.height, teacher.targetHeight, `teacher camera ${target.cameraIndex} declared height drifted`);
    validateArtifact(target.artifact, {
      label: `teacher camera ${target.cameraIndex}`,
      semanticRole: 'exact-shared-transmittance-target',
      png: { width: teacher.targetWidth, height: teacher.targetHeight },
    });
  }
}

function validateGrid160Comparison(comparison, support, comparisonManifestSha256) {
  assert.equal(comparisonManifestSha256, EXPECTED_GRID160_MANIFEST_SHA256, 'grid160 comparison manifest bytes do not match the immutable oracle');
  assert.equal(comparison?.schema, 'kaminos.pyro.cockpit-manifest.v0', 'grid160 comparison schema is invalid');
  assert.equal(comparison.manifestIdentity, 'expanded-union-flow-ellipse-state120-cockpit-manifest-v0', 'grid160 comparison identity drifted');
  assert.equal(comparison.producer?.evidenceCommit, EXPECTED_GRID160_EVIDENCE_COMMIT, 'grid160 comparison evidence commit drifted');
  assert.equal(comparison.experiment?.originalEvidenceImmutable, true, 'grid160 comparison evidence must remain immutable');
  assert.equal(comparison.sourceState?.grid, 160, 'external comparison must remain native grid160 evidence');
  assert.equal(comparison.sourceState?.sourceManifestSha256, EXPECTED_GRID160_SOURCE_SHA256, 'grid160 source manifest identity drifted');
  assert.equal(comparison.support?.identity, EXPECTED_SUPPORT_IDENTITY, 'grid160 comparison support semantics drifted');
  assert.equal(comparison.support?.nativeCellIndexSha256, EXPECTED_GRID160_SUPPORT_SHA256, 'grid160 support identity drifted');
  assert.notEqual(comparison.support.nativeCellIndexSha256, support.nativeCellIndexSha256, 'grid160 geometry was reused as native grid96 support');
  assert.equal(comparison.support.sampleCap, null, 'grid160 comparison was capped');
  assert.equal(comparison.support.droppedRowCount, 0, 'grid160 comparison dropped rows');
  assert.equal(comparison.covariance?.descriptorSha256, EXPECTED_GRID160_DESCRIPTOR_SHA256, 'grid160 descriptor identity drifted');
  assert.equal(comparison.cameraOrbit?.identity, EXPECTED_CAMERA_IDENTITY, 'grid160 comparison camera cohort semantics drifted');
  assert.equal(comparison.cameraOrbit?.calibrationCameraIndex, 10, 'grid160 comparison calibration camera drifted');
  assert.deepEqual(comparison.cameraOrbit?.heldOutCameraIndices, Array.from({ length: 21 }, (_, index) => index).filter(index => index !== 10), 'grid160 comparison held camera cohort drifted');
  assert.equal(comparison.target?.identity, EXPECTED_TEACHER_IDENTITY, 'grid160 comparison target semantics drifted');
  assert.equal(comparison.target?.cameraCount, 21, 'grid160 comparison camera count is partial');
}

function validateArtifact(artifact, expected) {
  assert.ok(artifact && typeof artifact === 'object', `${expected.label} artifact is missing`);
  assert.ok(isAbsolute(artifact.path), `${expected.label} artifact path must be absolute`);
  const bytes = readFileSync(artifact.path);
  assert.ok(bytes.length > 0, `${expected.label} artifact is blank`);
  assert.equal(artifact.bytes, bytes.length, `${expected.label} artifact byte count drifted`);
  const digest = sha256(bytes);
  assert.equal(artifact.sha256, digest, `${expected.label} artifact hash drifted`);
  if (expected.dtype) assert.equal(artifact.dtype, expected.dtype, `${expected.label} dtype drifted`);
  if (expected.shape) {
    assert.deepEqual(artifact.shape, expected.shape, `${expected.label} shape drifted`);
    assert.equal(bytes.length, expected.shape.reduce((product, value) => product * value, 1) * dtypeBytes(expected.dtype), `${expected.label} physical byte length does not match shape`);
  }
  if (expected.semanticRole) assert.equal(artifact.semanticRole, expected.semanticRole, `${expected.label} semantic role drifted`);
  if (expected.channelOrder) assert.deepEqual(artifact.channelOrder, expected.channelOrder, `${expected.label} channel order drifted`);
  if (expected.png) validatePng(bytes, expected.label, expected.png);
  return { path: artifact.path, bytes: bytes.length, sha256: digest, buffer: bytes };
}

const PNG_CRC_TABLE = Object.freeze(Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
}));

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function validatePng(bytes, label, expected) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  assert.deepEqual([...bytes.subarray(0, 8)], signature, `${label} artifact is not a PNG`);
  assert.ok(bytes.length >= 33, `${label} PNG is truncated before IHDR`);
  let offset = 8;
  let chunkIndex = 0;
  let width = null;
  let height = null;
  let sawIdat = false;
  let sawIend = false;
  while (offset < bytes.length) {
    assert.ok(bytes.length - offset >= 12, `${label} PNG is truncated before chunk header`);
    const length = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    assert.ok(chunkEnd <= bytes.length, `${label} PNG chunk payload is truncated`);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const declaredCrc = bytes.readUInt32BE(offset + 8 + length);
    assert.equal(declaredCrc, pngCrc32(Buffer.concat([typeBytes, data])), `${label} PNG ${type} CRC drifted`);
    if (chunkIndex === 0) {
      assert.equal(type, 'IHDR', `${label} PNG does not begin with IHDR`);
      assert.equal(length, 13, `${label} PNG IHDR length is invalid`);
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.ok(width > 0 && height > 0, `${label} PNG dimensions are empty`);
    } else {
      assert.notEqual(type, 'IHDR', `${label} PNG contains duplicate IHDR`);
    }
    if (type === 'IDAT') sawIdat = true;
    if (type === 'IEND') {
      assert.equal(length, 0, `${label} PNG IEND length is invalid`);
      sawIend = true;
      assert.equal(chunkEnd, bytes.length, `${label} PNG contains bytes after IEND`);
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  assert.equal(sawIdat, true, `${label} PNG has no IDAT payload`);
  assert.equal(sawIend, true, `${label} PNG has no terminal IEND`);
  assert.deepEqual([width, height], [expected.width, expected.height], `${label} PNG dimensions drifted`);
}

function validateNativeCellIndices(bytes, rowCount) {
  const values = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seen = new Set();
  for (let row = 0; row < rowCount; row += 1) {
    const value = values.getUint32(row * 4, true);
    assert.ok(value < GRID96_NATIVE_CELL_COUNT, `support native-cell index ${value} at row ${row} is outside native grid96`);
    assert.ok(!seen.has(value), `support contains duplicate native-cell index ${value} at row ${row}`);
    seen.add(value);
  }
}

function validateFloatPayload(bytes, label, options = {}) {
  const values = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.byteLength / 4;
  let rowHasPositive = false;
  for (let index = 0; index < count; index += 1) {
    const value = values.getFloat32(index * 4, true);
    assert.ok(Number.isFinite(value), `${label} contains a non-finite float at index ${index}`);
    if (options.nonnegative) assert.ok(value >= 0, `${label} contains a negative float at index ${index}`);
    if (options.rowWidth) {
      rowHasPositive ||= value > 0;
      if (index % options.rowWidth === options.rowWidth - 1) {
        const row = Math.floor(index / options.rowWidth);
        assert.ok(rowHasPositive, `${label} row ${row} has no ${options.requirePositivePerRow}`);
        rowHasPositive = false;
      }
    }
  }
}

function assertSourceRoute(route, role) {
  assert.ok(route && typeof route === 'object', `${role} source route identity is missing`);
  const requested = new URL(route.requested);
  assert.ok(['http:', 'https:'].includes(requested.protocol), `${role} requested source route must be HTTP(S)`);
  assert.equal(requested.searchParams.get('volume_resolution'), String(EXPECTED_GRID), `${role} requested source route is not native grid96`);
  assertNonblank(route.effective, `${role} effective source route`);
  assert.ok(route.backend?.startsWith('WebGPU:'), `${role} source backend is not WebGPU`);
  assert.equal(route.fallbackReason, null, `${role} source route contains fallback evidence`);
}

function assertExecutionRoute(route, role) {
  assert.ok(route && typeof route === 'object', `${role} execution route identity is missing`);
  assertNonblank(route.requested, `${role} requested execution route`);
  assertNonblank(route.effective, `${role} effective execution route`);
  assertNonblank(route.backend, `${role} execution backend`);
  assert.equal(route.fallbackUsed, false, `${role} execution route contains fallback evidence`);
  assert.equal(route.failurePhase, null, `${role} execution route contains a failure phase`);
  assert.equal(route.sampleCap, null, `${role} execution route contains a sample cap`);
}

function finiteArray(value, length, label) {
  assert.ok(Array.isArray(value) && value.length === length && value.every(Number.isFinite), `${label} must contain ${length} finite numbers`);
}

function assertNonblank(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must be nonblank`);
}

function assertPositiveInteger(value, label) {
  assert.ok(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
}

function assertSha256(value, label) {
  assert.match(value || '', HEX_SHA256, `${label} sha256 is invalid`);
}

function dtypeBytes(dtype) {
  if (dtype === 'float32-le' || dtype === 'uint32-le') return 4;
  throw new Error(`unsupported dtype ${dtype}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pick(object, keys) {
  return Object.fromEntries(keys.map(key => [key, clone(object[key])]));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function rawArg(argv, name) {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : null;
  return value && !value.startsWith('--') ? resolve(value) : null;
}

function parseArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) throw new Error(`invalid argument pair at ${key || '<end>'}`);
    if (result.has(key)) throw new Error(`duplicate argument ${key}`);
    result.set(key, value);
  }
  return result;
}

function required(args, name) {
  const value = args.get(name);
  if (!value) throw new Error(`missing required argument ${name}`);
  return resolve(value);
}

function readManifest(path, role) {
  const bytes = readFileSync(path);
  assert.ok(bytes.length > 0, `${role} manifest is blank`);
  const manifest = JSON.parse(bytes.toString('utf8'));
  return {
    manifest,
    ref: {
      path,
      bytes: bytes.length,
      sha256: sha256(bytes),
      schema: manifest.schema || null,
      identity: manifest.identity || manifest.manifestIdentity || null,
    },
  };
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

async function main() {
  const argv = process.argv.slice(2);
  let failurePhase = 'argument-validation';
  let reportPath = rawArg(argv, '--report');
  let outPath = rawArg(argv, '--out');
  let lastTrustworthyEvidence = { argv: [...argv] };
  try {
    const args = parseArgs(argv);
    reportPath = required(args, '--report');
    outPath = required(args, '--out');
    assert.notEqual(reportPath, outPath, '--report and --out must be different paths');
    const paths = {
      source: required(args, '--source-manifest'),
      support: required(args, '--support-manifest'),
      descriptors: required(args, '--descriptor-manifest'),
      coefficients: required(args, '--coefficient-manifest'),
      cameras: required(args, '--camera-manifest'),
      teacher: required(args, '--teacher-manifest'),
      comparison: required(args, '--grid160-comparison-manifest'),
    };
    lastTrustworthyEvidence = { paths, outPath, reportPath };

    failurePhase = 'input-read';
    const loaded = Object.fromEntries(Object.entries(paths).map(([role, path]) => [role, readManifest(path, role)]));
    lastTrustworthyEvidence.inputRefs = Object.fromEntries(Object.entries(loaded).map(([role, value]) => [role, value.ref]));

    failurePhase = 'native-component-validation';
    const nativeRoles = ['source', 'support', 'descriptors', 'coefficients', 'cameras', 'teacher'];
    for (const role of nativeRoles) validateNativeComponent(loaded[role].manifest, role === 'cameras' ? 'camera-cohort' : role, loaded.source.manifest.route);
    validateSameStateAndSource(nativeRoles.map(role => [role === 'cameras' ? 'camera-cohort' : role, loaded[role].manifest]), loaded.source.ref.sha256);
    validateSource(loaded.source.manifest);

    failurePhase = 'support-coupling-validation';
    validateSupport(loaded.support.manifest);
    validateDescriptors(loaded.descriptors.manifest, loaded.support.manifest);
    validateCoefficients(loaded.coefficients.manifest, loaded.support.manifest);

    failurePhase = 'camera-cohort-validation';
    validateCameraCohort(loaded.cameras.manifest);

    failurePhase = 'teacher-validation';
    validateTeacher(
      loaded.teacher.manifest,
      loaded.cameras.manifest,
      loaded.support.manifest,
      loaded.coefficients.manifest,
    );

    failurePhase = 'grid160-comparison-validation';
    validateGrid160Comparison(loaded.comparison.manifest, loaded.support.manifest, loaded.comparison.ref.sha256);

    failurePhase = 'manifest-write';
    const companion = buildGrid96FullSupportCompanion({
      ...Object.fromEntries(Object.entries(loaded).map(([role, value]) => [role, value.manifest])),
      refs: Object.fromEntries(Object.entries(loaded).map(([role, value]) => [role, value.ref])),
    });
    writeJsonAtomic(outPath, companion);

    failurePhase = 'manifest-validation';
    const outputBytes = readFileSync(outPath);
    const roundTrip = JSON.parse(outputBytes.toString('utf8'));
    assert.equal(roundTrip.identity, companion.identity, 'written companion identity drifted');
    assert.equal(roundTrip.grid, EXPECTED_GRID, 'written companion grid drifted');
    const report = {
      identity: 'kaminos.volume.grid96-full-support-companion-report.v0',
      status: 'complete',
      failurePhase: null,
      output: { path: outPath, bytes: outputBytes.length, sha256: sha256(outputBytes), identity: companion.identity },
      inputs: companion.components,
      causalQuestion: companion.causalQuestion,
      claimBoundary: companion.claimBoundary,
    };
    writeJsonAtomic(reportPath, report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const failure = {
      identity: 'kaminos.volume.grid96-full-support-companion-report.v0',
      status: 'failed',
      failurePhase,
      error: error?.stack || error?.message || String(error),
      lastTrustworthyEvidence,
    };
    if (outPath) writeJsonAtomic(outPath, failure);
    if (reportPath && reportPath !== outPath) writeJsonAtomic(reportPath, failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}

if (isCli) await main();
