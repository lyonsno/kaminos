export const FOUR_ARM_HELD_STATE_STATE_IDS = Object.freeze([
  'coefficient-state-114',
  'coefficient-state-116',
  'coefficient-state-118',
  'coefficient-state-120',
]);

export const FOUR_ARM_HELD_STATE_ARM_IDS = Object.freeze([
  'full-correct',
  'sparse-drop',
  'sparse-conservative',
  'sparse-positive-complement',
]);

export const FOUR_ARM_HELD_STATE_FULL_COUNTS = Object.freeze({
  'coefficient-state-114': 1_924_725,
  'coefficient-state-116': 1_926_470,
  'coefficient-state-118': 1_927_051,
  'coefficient-state-120': 1_925_788,
});

export const FOUR_ARM_HELD_STATE_SPARSE_COUNT = 481_447;
export const FOUR_ARM_HELD_STATE_RECURRENCE = 'ordered-emission-extinction-shared-transmittance-v0';
export const FOUR_ARM_HELD_STATE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
export const FOUR_ARM_HELD_STATE_CAPTURE_SCHEMA = 'kaminos.integration.four-arm-held-state-capture.v0';
export const FOUR_ARM_HELD_STATE_RESIDUAL_SCHEMA = 'kaminos.integration.positive-complement-grid.v0';

const ARTIFACT_SCHEMA = 'kaminos.bailiff.persistent-sparse-positive-complement-artifact.v0';
const COHORT_MANIFEST_SHA256 = '4a93aeefe7eebec06f039dd35bd2947e4e76f292eadd7b7719e02235d062ac20';
const IMPLEMENTATION_BUNDLE_SHA256 = '603398858e2c8dac638f82a43a13f45d5e8f72c88ae1d2eb0d96f761e5e0853f';
const COEFFICIENT_AUTHORITY = 'exact-local-layer-emission-extinction';
const OWNERSHIP_AUTHORITY = 'complementary-local-optical-coefficient-ownership-v0';
const DEPTH_AUTHORITY = 'camera-depth-far-to-near-v0';
const REQUIRED_STAGE_NAMES = Object.freeze([
  'selection',
  'compaction',
  'deposition',
  'splatRaster',
  'residualMarch',
  'reconstruction',
  'composition',
]);
const SHA256 = /^[a-f0-9]{64}$/;

function fail(phase, reason) {
  throw new Error(`four-arm-held-state:${phase}:${reason}`);
}

function requireContract(condition, phase, reason) {
  if (!condition) fail(phase, reason);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateDescriptor(descriptor, label, expectedRows = null, expectedWidth = null) {
  requireContract(descriptor && typeof descriptor === 'object', 'artifact-admission', `${label}-descriptor-missing`);
  requireContract(typeof descriptor.path === 'string' && descriptor.path.length > 0, 'artifact-admission', `${label}-path-missing`);
  requireContract(SHA256.test(descriptor.sha256 || ''), 'artifact-admission', `${label}-sha256-invalid`);
  requireContract(Number.isSafeInteger(descriptor.bytes) && descriptor.bytes > 0, 'artifact-admission', `${label}-bytes-invalid`);
  requireContract(descriptor.authentication === 'sha256-and-byte-count-verified'
    || descriptor.authentication === 'derived-from-authenticated-disjoint-source-row-partition-v0',
  'artifact-admission', `${label}-authentication-invalid`);
  if (expectedRows !== null) {
    requireContract(descriptor.shape?.[0] === expectedRows, 'artifact-admission', `${label}-row-count-drift`);
  }
  if (expectedWidth !== null) {
    requireContract(descriptor.shape?.[1] === expectedWidth, 'artifact-admission', `${label}-row-width-drift`);
  }
  return true;
}

function validateRails(rails, prefix) {
  for (const field of [
    'selectionRerun',
    'residualAwareRetargeting',
    'supportRedefined',
    'coefficientsRedefined',
    'covarianceRedefined',
  ]) {
    requireContract(rails?.[field] === false, 'artifact-admission', `${prefix}-${field}-forbidden`);
  }
}

function validateState(state, stateId, request) {
  const sourceCount = FOUR_ARM_HELD_STATE_FULL_COUNTS[stateId];
  const complementCount = sourceCount - FOUR_ARM_HELD_STATE_SPARSE_COUNT;
  requireContract(state?.stateId === stateId, 'artifact-admission', 'state-sequence-drift');
  requireContract(state.steps === Number(stateId.slice(-3)), 'artifact-admission', `${stateId}-step-drift`);
  requireContract(state.population?.source === sourceCount, 'artifact-admission', `${stateId}-source-count-drift`);
  requireContract(state.population?.sparse === FOUR_ARM_HELD_STATE_SPARSE_COUNT, 'artifact-admission', `${stateId}-sparse-count-drift`);
  requireContract(state.population?.complement === complementCount, 'artifact-admission', `${stateId}-complement-count-drift`);
  requireContract(state.population?.exactClosure === true, 'artifact-admission', `${stateId}-population-not-closed`);
  requireContract(sameJson(state.arms?.map(arm => arm.armId), FOUR_ARM_HELD_STATE_ARM_IDS), 'artifact-admission', `${stateId}-arm-sequence-drift`);

  const source = state.sourceDescriptors || {};
  validateDescriptor(source.nativeCellIndices, `${stateId}-source-membership`, sourceCount);
  validateDescriptor(source.coefficients, `${stateId}-source-coefficients`, sourceCount, 8);
  validateDescriptor(source.kernelDescriptors, `${stateId}-source-kernels`, sourceCount, 8);
  validateDescriptor(source.features, `${stateId}-source-features`, sourceCount, 24);
  validateDescriptor(source.admission, `${stateId}-source-admission`, sourceCount, 2);

  for (const arm of state.arms) {
    const full = arm.armId === 'full-correct';
    const expectedCount = full ? sourceCount : FOUR_ARM_HELD_STATE_SPARSE_COUNT;
    requireContract(arm.stateId === stateId, 'artifact-admission', `${stateId}-${arm.armId}-state-alias`);
    requireContract(arm.requestedCandidateCount === expectedCount, 'artifact-admission', `${stateId}-${arm.armId}-candidate-count-drift`);
    requireContract(arm.recurrenceIdentity === FOUR_ARM_HELD_STATE_RECURRENCE, 'artifact-admission', `${stateId}-${arm.armId}-recurrence-drift`);
    requireContract(arm.depthAuthority === DEPTH_AUTHORITY, 'artifact-admission', `${stateId}-${arm.armId}-depth-authority-drift`);
    requireContract(arm.route?.requestedRoute === FOUR_ARM_HELD_STATE_ROUTE, 'artifact-admission', `${stateId}-${arm.armId}-route-drift`);
    requireContract(arm.route?.fallbackReason === null, 'artifact-admission', `${stateId}-${arm.armId}-fallback-forbidden`);
    if (!full) {
      validateDescriptor(arm.splatPayload?.membership, `${stateId}-${arm.armId}-membership`, expectedCount);
      validateDescriptor(arm.splatPayload?.sourceRowIndices, `${stateId}-${arm.armId}-source-rows`, expectedCount);
      validateDescriptor(arm.splatPayload?.coefficients, `${stateId}-${arm.armId}-coefficients`, expectedCount, 8);
      validateDescriptor(arm.splatPayload?.kernelDescriptors, `${stateId}-${arm.armId}-kernels`, expectedCount, 8);
      validateDescriptor(arm.splatPayload?.features, `${stateId}-${arm.armId}-features`, expectedCount, 24);
      validateDescriptor(arm.splatPayload?.admission, `${stateId}-${arm.armId}-admission`, expectedCount, 2);
    }
    const usesResidual = arm.armId === 'sparse-positive-complement';
    requireContract(arm.residualPayload?.enabled === usesResidual, 'artifact-admission', `${stateId}-${arm.armId}-residual-policy-drift`);
    if (usesResidual) {
      validateDescriptor(arm.residualPayload.sourceRowIndices, `${stateId}-complement-source-rows`, complementCount);
      validateDescriptor(arm.residualPayload.nativeCellIndices, `${stateId}-complement-membership`, complementCount);
      validateDescriptor(arm.residualPayload.coefficientSource, `${stateId}-complement-coefficients`, sourceCount, 8);
      requireContract(
        arm.residualPayload.gatherAuthority === 'source-order-indexed-positive-complement-gather-v0',
        'artifact-admission',
        `${stateId}-complement-gather-authority-drift`,
      );
    }
  }
  requireContract(request.fullCandidateCountByState[stateId] === sourceCount, 'artifact-admission', `${stateId}-request-count-drift`);
}

export function validateFourArmHeldStateArtifact(artifact) {
  requireContract(artifact?.schema === ARTIFACT_SCHEMA, 'artifact-admission', 'schema-drift');
  requireContract(artifact.status === 'authenticated-build-contract-only', 'artifact-admission', 'status-drift');
  requireContract(artifact.captureEligible === false && artifact.decisionBearing === false, 'artifact-admission', 'uncaptured-authority-inflation');
  requireContract(!Object.hasOwn(artifact.request || {}, 'fullCandidateCount'), 'artifact-admission', 'scalar-full-count-alias-forbidden');
  requireContract(sameJson(artifact.request, artifact.effectiveConfig), 'artifact-admission', 'requested-effective-config-drift');
  requireContract(sameJson(artifact.request?.stateIds, FOUR_ARM_HELD_STATE_STATE_IDS), 'artifact-admission', 'request-state-sequence-drift');
  requireContract(sameJson(artifact.request?.armIds, FOUR_ARM_HELD_STATE_ARM_IDS), 'artifact-admission', 'request-arm-sequence-drift');
  requireContract(sameJson(artifact.request?.fullCandidateCountByState, FOUR_ARM_HELD_STATE_FULL_COUNTS), 'artifact-admission', 'state-keyed-full-counts-drift');
  requireContract(artifact.request?.sparseCandidateCount === FOUR_ARM_HELD_STATE_SPARSE_COUNT, 'artifact-admission', 'sparse-count-drift');
  requireContract(artifact.request?.residualGridScale === 0.1, 'artifact-admission', 'residual-grid-scale-drift');
  requireContract(artifact.request?.residualRaySteps === 64, 'artifact-admission', 'residual-ray-steps-drift');
  requireContract(artifact.source?.cohortManifestSha256 === COHORT_MANIFEST_SHA256, 'artifact-admission', 'cohort-manifest-drift');
  requireContract(artifact.source?.implementationBundleSha256 === IMPLEMENTATION_BUNDLE_SHA256, 'artifact-admission', 'implementation-bundle-drift');
  requireContract(artifact.source?.coefficientAuthority === COEFFICIENT_AUTHORITY, 'artifact-admission', 'coefficient-authority-drift');
  requireContract(artifact.source?.ownershipAuthority === OWNERSHIP_AUTHORITY, 'artifact-admission', 'ownership-authority-drift');
  validateRails(artifact.source, 'source');
  validateRails(artifact.rails, 'rails');
  requireContract(artifact.rails?.depositionRedefined === false, 'artifact-admission', 'rails-depositionRedefined-forbidden');
  requireContract(artifact.route?.requestedRoute === FOUR_ARM_HELD_STATE_ROUTE, 'artifact-admission', 'requested-route-drift');
  requireContract(artifact.route?.status === 'unresolved-before-effective-route', 'artifact-admission', 'uncaptured-route-status-drift');
  requireContract(artifact.route?.effectiveRoute === null && artifact.route?.backend === null, 'artifact-admission', 'uncaptured-route-authority-inflation');
  requireContract(artifact.route?.fallbackReason === null, 'artifact-admission', 'fallback-forbidden');
  requireContract(artifact.opticalComposition?.ownershipAuthority === OWNERSHIP_AUTHORITY, 'artifact-admission', 'optical-ownership-drift');
  requireContract(artifact.opticalComposition?.recurrenceIdentity === FOUR_ARM_HELD_STATE_RECURRENCE, 'artifact-admission', 'optical-recurrence-drift');
  requireContract(artifact.opticalComposition?.recurrenceCount === 1, 'artifact-admission', 'multiple-recurrences-forbidden');
  requireContract(artifact.opticalComposition?.depthAuthority === DEPTH_AUTHORITY, 'artifact-admission', 'depth-authority-drift');
  requireContract(artifact.opticalComposition?.targetFormat === 'rgba16float', 'artifact-admission', 'target-format-drift');
  requireContract(artifact.opticalComposition?.independentlyToneMapped === false, 'artifact-admission', 'independent-tone-map-forbidden');
  requireContract(artifact.opticalComposition?.postToneMapAddition === false, 'artifact-admission', 'post-tone-map-addition-forbidden');
  requireContract(sameJson(artifact.states?.map(state => state.stateId), FOUR_ARM_HELD_STATE_STATE_IDS), 'artifact-admission', 'state-sequence-drift');
  for (let index = 0; index < FOUR_ARM_HELD_STATE_STATE_IDS.length; index += 1) {
    validateState(artifact.states[index], FOUR_ARM_HELD_STATE_STATE_IDS[index], artifact.request);
  }
  return true;
}

function validateResidualGrid(resource, state, arm, artifact) {
  requireContract(resource && typeof resource === 'object', 'residual-grid-admission', 'resource-missing');
  requireContract(resource.schema === FOUR_ARM_HELD_STATE_RESIDUAL_SCHEMA, 'residual-grid-admission', 'schema-drift');
  requireContract(resource.status === 'authenticated', 'residual-grid-admission', 'authentication-incomplete');
  requireContract(resource.stateId === state.stateId, 'residual-grid-admission', 'state-alias-forbidden');
  requireContract(resource.sourceRowIndicesSha256 === arm.residualPayload.sourceRowIndices.sha256, 'residual-grid-admission', 'membership-drift');
  requireContract(resource.coefficientSourceSha256 === arm.residualPayload.coefficientSource.sha256, 'residual-grid-admission', 'coefficient-source-drift');
  requireContract(resource.sourceRowCount === state.population.complement, 'residual-grid-admission', 'row-count-drift');
  requireContract(resource.gridSize === Math.round(160 * artifact.request.residualGridScale), 'residual-grid-admission', 'grid-size-drift');
  requireContract(resource.gridScale === artifact.request.residualGridScale, 'residual-grid-admission', 'grid-scale-drift');
  requireContract(resource.raySteps === artifact.request.residualRaySteps, 'residual-grid-admission', 'ray-steps-drift');
  requireContract(resource.targetFormat === 'rgba32float', 'residual-grid-admission', 'target-format-drift');
  requireContract(resource.independentlyToneMapped === false, 'residual-grid-admission', 'independent-tone-map-forbidden');
  requireContract(resource.postToneMapAddition === false, 'residual-grid-admission', 'post-tone-map-addition-forbidden');
}

export function buildFourArmHeldStateApplication({ artifact, stateId, armId, residualGrid = null } = {}) {
  validateFourArmHeldStateArtifact(artifact);
  requireContract(FOUR_ARM_HELD_STATE_STATE_IDS.includes(stateId), 'request-admission', 'unknown-state');
  requireContract(FOUR_ARM_HELD_STATE_ARM_IDS.includes(armId), 'request-admission', 'unknown-arm');
  const state = artifact.states.find(candidate => candidate.stateId === stateId);
  const arm = state.arms.find(candidate => candidate.armId === armId);
  const usesResidual = armId === 'sparse-positive-complement';
  if (usesResidual) validateResidualGrid(residualGrid, state, arm, artifact);
  requireContract(!residualGrid || usesResidual, 'request-admission', 'residual-resource-on-nonresidual-arm');
  const full = armId === 'full-correct';
  return {
    schema: 'kaminos.integration.four-arm-held-state-application.v0',
    status: 'admitted',
    requestedStateId: stateId,
    effectiveStateId: state.stateId,
    requestedArmId: armId,
    effectiveArmId: arm.armId,
    sourceSimStepCount: state.steps,
    splatCandidateCount: arm.requestedCandidateCount,
    fullCandidateCountByState: { ...FOUR_ARM_HELD_STATE_FULL_COUNTS },
    sparseCandidateCount: FOUR_ARM_HELD_STATE_SPARSE_COUNT,
    splatPayload: full ? {
      ...arm.splatPayload,
      sourceDescriptors: state.sourceDescriptors,
    } : arm.splatPayload,
    coefficientDisposition: arm.coefficientDisposition,
    coefficientLedger: structuredClone(arm.coefficientLedger || null),
    exactBinary32Ownership: structuredClone(arm.exactBinary32Ownership || null),
    residual: usesResidual ? {
      enabled: true,
      mode: 'positive-complement-coarse-volume-raymarch-v0',
      payload: arm.residualPayload,
      grid: { ...residualGrid },
    } : { enabled: false, mode: 'disabled-by-arm-policy-v0' },
    requestedRoute: FOUR_ARM_HELD_STATE_ROUTE,
    effectiveRoute: FOUR_ARM_HELD_STATE_ROUTE,
    backendRequired: 'WebGPU:apple',
    recurrenceIdentity: FOUR_ARM_HELD_STATE_RECURRENCE,
    recurrenceCount: 1,
    depthAuthority: DEPTH_AUTHORITY,
    targetFormat: 'rgba16float',
    selectionRerun: false,
    residualAwareRetargeting: false,
    independentlyToneMapped: false,
    postToneMapAddition: false,
    fallbackReason: null,
  };
}

async function sha256Bytes(bytes) {
  const view = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', view);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function fetchAuthenticatedDescriptor(descriptor, {
  fetchImpl,
  resolveDescriptorUrl,
  label,
}) {
  const url = resolveDescriptorUrl ? resolveDescriptorUrl(descriptor, label) : descriptor.path;
  requireContract(typeof url === 'string' && url.length > 0, 'resource-load', `${label}-url-missing`);
  const response = await fetchImpl(url, { cache: 'no-store' });
  requireContract(response?.ok === true, 'resource-load', `${label}-fetch-failed:${response?.status ?? 'unknown'}`);
  const buffer = await response.arrayBuffer();
  requireContract(buffer.byteLength === descriptor.bytes, 'resource-load', `${label}-byte-count-drift`);
  requireContract(await sha256Bytes(new Uint8Array(buffer)) === descriptor.sha256, 'resource-load', `${label}-sha256-drift`);
  return buffer;
}

function typedArray(buffer, Type, label) {
  requireContract(buffer.byteLength % Type.BYTES_PER_ELEMENT === 0, 'resource-load', `${label}-alignment-drift`);
  return new Type(buffer);
}

export async function loadFourArmHeldStateArtifact({
  artifactUrl,
  expectedSha256,
  fetchImpl = globalThis.fetch,
} = {}) {
  requireContract(typeof artifactUrl === 'string' && artifactUrl.length > 0, 'artifact-load', 'url-missing');
  requireContract(SHA256.test(expectedSha256 || ''), 'artifact-load', 'expected-sha256-invalid');
  requireContract(typeof fetchImpl === 'function', 'artifact-load', 'fetch-unavailable');
  const response = await fetchImpl(artifactUrl, { cache: 'no-store' });
  requireContract(response?.ok === true, 'artifact-load', `fetch-failed:${response?.status ?? 'unknown'}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  requireContract(await sha256Bytes(bytes) === expectedSha256, 'artifact-load', 'sha256-drift');
  const artifact = JSON.parse(new TextDecoder().decode(bytes));
  validateFourArmHeldStateArtifact(artifact);
  return {
    artifact,
    receipt: {
      identity: 'four-arm-held-state-artifact-load-receipt-v0',
      status: 'complete',
      requestedUrl: artifactUrl,
      effectiveUrl: response.url || artifactUrl,
      requestedSha256: expectedSha256,
      effectiveSha256: expectedSha256,
      fallbackReason: null,
    },
  };
}

export async function loadFourArmHeldStateArrays({
  application,
  fetchImpl = globalThis.fetch,
  resolveDescriptorUrl = null,
} = {}) {
  requireContract(application?.schema === 'kaminos.integration.four-arm-held-state-application.v0', 'resource-load', 'application-missing');
  requireContract(typeof fetchImpl === 'function', 'resource-load', 'fetch-unavailable');
  const payload = application.splatPayload;
  const source = payload.sourceDescriptors || payload;
  const membershipDescriptor = payload.membership || source.nativeCellIndices;
  const descriptors = {
    nativeCellIndices: membershipDescriptor,
    coefficients: payload.coefficients || source.coefficients,
    kernelDescriptors: payload.kernelDescriptors || source.kernelDescriptors,
    features: payload.features || source.features,
    admission: payload.admission || source.admission,
    sourceRowIndices: payload.sourceRowIndices || null,
    footprintScales: payload.footprintScales || null,
    depositMultiplicity: payload.depositMultiplicity || null,
    retainedQuadratureWeight: payload.retainedQuadratureWeight || null,
  };
  const entries = await Promise.all(Object.entries(descriptors).map(async ([name, descriptor]) => {
    if (!descriptor) return [name, null];
    const buffer = await fetchAuthenticatedDescriptor(descriptor, {
      fetchImpl,
      resolveDescriptorUrl,
      label: `splat-${name}`,
    });
    const Type = name === 'nativeCellIndices' || name === 'sourceRowIndices'
      ? Uint32Array
      : name === 'depositMultiplicity'
        ? Uint8Array
        : Float32Array;
    return [name, typedArray(buffer, Type, name)];
  }));
  const arrays = Object.fromEntries(entries);
  if (application.residual.enabled) {
    const residual = application.residual.payload;
    const residualDescriptors = {
      residualSourceRowIndices: residual.sourceRowIndices,
      residualNativeCellIndices: residual.nativeCellIndices,
      residualCoefficients: residual.coefficientSource,
      residualKernelDescriptors: residual.kernelDescriptorSource,
    };
    const residualEntries = await Promise.all(Object.entries(residualDescriptors).map(async ([name, descriptor]) => {
      const buffer = await fetchAuthenticatedDescriptor(descriptor, {
        fetchImpl,
        resolveDescriptorUrl,
        label: name,
      });
      const Type = name.includes('Indices') ? Uint32Array : Float32Array;
      return [name, typedArray(buffer, Type, name)];
    }));
    Object.assign(arrays, Object.fromEntries(residualEntries));
  }
  return {
    arrays,
    receipt: {
      identity: 'four-arm-held-state-array-load-receipt-v0',
      status: 'complete',
      stateId: application.effectiveStateId,
      armId: application.effectiveArmId,
      splatRowCount: application.splatCandidateCount,
      residualRowCount: application.residual.enabled ? application.residual.grid.sourceRowCount : 0,
      selectorRerun: false,
      residualAwareRetargeting: false,
      fallbackReason: null,
    },
  };
}

function conservativeScale(application, channel) {
  if (application.effectiveArmId !== 'sparse-conservative') return 1;
  const exact = application.exactBinary32Ownership?.[channel];
  requireContract(exact, 'gpu-pack', `${channel}-exact-ownership-missing`);
  const source = Number(BigInt(exact.sourceUnitSum));
  const sparse = Number(BigInt(exact.splatUnitSum));
  requireContract(Number.isFinite(source) && Number.isFinite(sparse) && sparse > 0, 'gpu-pack', `${channel}-redistribution-scale-invalid`);
  return source / sparse;
}

export function packFourArmHeldStateGpuRows({ application, arrays } = {}) {
  requireContract(application?.schema === 'kaminos.integration.four-arm-held-state-application.v0', 'gpu-pack', 'application-missing');
  requireContract(arrays && typeof arrays === 'object', 'gpu-pack', 'arrays-missing');
  const rowCount = application.splatCandidateCount;
  const required = {
    nativeCellIndices: 1,
    coefficients: 8,
    kernelDescriptors: 8,
    features: 24,
    admission: 2,
  };
  for (const [name, width] of Object.entries(required)) {
    requireContract(ArrayBuffer.isView(arrays[name]), 'gpu-pack', `${name}-missing`);
    requireContract(arrays[name].length === rowCount * width, 'gpu-pack', `${name}-length-drift`);
  }
  for (const name of ['sourceRowIndices', 'footprintScales', 'depositMultiplicity', 'retainedQuadratureWeight']) {
    if (arrays[name]) requireContract(arrays[name].length === rowCount, 'gpu-pack', `${name}-length-drift`);
  }
  const emissionScale = conservativeScale(application, 'emission');
  const extinctionScale = conservativeScale(application, 'extinction');
  const rows = new Float32Array(rowCount * 24);
  let kernelNativeCellMismatchCount = 0;
  for (let row = 0; row < rowCount; row += 1) {
    const coefficientOffset = row * 8;
    const featureOffset = row * 24;
    const outputOffset = row * 24;
    const nativeCellIndex = arrays.nativeCellIndices[row];
    if (arrays.kernelDescriptors[coefficientOffset + 3] !== nativeCellIndex) kernelNativeCellMismatchCount += 1;
    const baseRadius = (2 / 160) * (
      0.60
      + arrays.features[featureOffset + 3] * 2.65
      + arrays.features[featureOffset + 2] * 0.48
    );
    const coefficient = channel => arrays.coefficients[coefficientOffset + channel]
      * (channel === 3 || channel === 7 ? extinctionScale : emissionScale);
    rows.set([
      arrays.kernelDescriptors[coefficientOffset],
      arrays.kernelDescriptors[coefficientOffset + 1],
      arrays.kernelDescriptors[coefficientOffset + 2],
      Math.max(arrays.admission[row * 2], arrays.admission[row * 2 + 1]),
      coefficient(0), coefficient(1), coefficient(2), coefficient(3),
      baseRadius,
      arrays.footprintScales?.[row] ?? 1,
      arrays.retainedQuadratureWeight?.[row] ?? 1,
      arrays.depositMultiplicity?.[row] ?? 4,
      arrays.kernelDescriptors[coefficientOffset + 4],
      arrays.kernelDescriptors[coefficientOffset + 5],
      arrays.kernelDescriptors[coefficientOffset + 6],
      arrays.kernelDescriptors[coefficientOffset + 7],
      coefficient(4), coefficient(5), coefficient(6), coefficient(7),
      nativeCellIndex,
      arrays.admission[row * 2],
      arrays.admission[row * 2 + 1],
      arrays.sourceRowIndices?.[row] ?? row,
    ], outputOffset);
  }
  requireContract(kernelNativeCellMismatchCount === 0, 'gpu-pack', `kernel-native-cell-mismatch:${kernelNativeCellMismatchCount}`);
  return {
    rows,
    receipt: {
      identity: 'four-arm-held-state-gpu-pack-receipt-v0',
      status: 'complete',
      stateId: application.effectiveStateId,
      armId: application.effectiveArmId,
      requestedRowCount: rowCount,
      encodedRowCount: rowCount,
      rowStrideFloats: 24,
      uploadBytes: rows.byteLength,
      emissionScale,
      extinctionScale,
      redistributionIdentity: application.effectiveArmId === 'sparse-conservative'
        ? 'global-emission-extinction-mass-ratio-on-immutable-sparse-membership-v0'
        : 'identity-v0',
      rowCap: null,
      droppedRowCount: 0,
      selectorRerun: false,
      residualAwareRetargeting: false,
      fallbackReason: null,
    },
  };
}

export async function buildPositiveComplementResidualGrid({ application, arrays } = {}) {
  requireContract(application?.effectiveArmId === 'sparse-positive-complement', 'residual-grid-build', 'positive-complement-arm-required');
  const sourceRows = arrays?.residualSourceRowIndices;
  const coefficients = arrays?.residualCoefficients;
  const kernels = arrays?.residualKernelDescriptors;
  const expectedRows = application.residual.grid.sourceRowCount;
  requireContract(sourceRows instanceof Uint32Array && sourceRows.length === expectedRows, 'residual-grid-build', 'source-row-indices-drift');
  const sourceCount = FOUR_ARM_HELD_STATE_FULL_COUNTS[application.effectiveStateId];
  requireContract(coefficients instanceof Float32Array && coefficients.length === sourceCount * 8, 'residual-grid-build', 'coefficient-source-drift');
  requireContract(kernels instanceof Float32Array && kernels.length === sourceCount * 8, 'residual-grid-build', 'kernel-source-drift');
  const gridSize = application.residual.grid.gridSize;
  const grid = new Float32Array(gridSize ** 3 * 4);
  const fineCellsPerCoarseCell = (160 / gridSize) ** 3;
  let previous = -1;
  for (const sourceRow of sourceRows) {
    requireContract(sourceRow > previous && sourceRow < sourceCount, 'residual-grid-build', 'source-row-order-or-range-drift');
    previous = sourceRow;
    const offset = sourceRow * 8;
    const x = Math.max(0, Math.min(gridSize - 1, Math.floor((kernels[offset] * 0.5 + 0.5) * gridSize)));
    const y = Math.max(0, Math.min(gridSize - 1, Math.floor((kernels[offset + 1] * 0.5 + 0.5) * gridSize)));
    const z = Math.max(0, Math.min(gridSize - 1, Math.floor((kernels[offset + 2] * 0.5 + 0.5) * gridSize)));
    const target = ((z * gridSize + y) * gridSize + x) * 4;
    grid[target] += (coefficients[offset] + coefficients[offset + 4]) / fineCellsPerCoarseCell;
    grid[target + 1] += (coefficients[offset + 1] + coefficients[offset + 5]) / fineCellsPerCoarseCell;
    grid[target + 2] += (coefficients[offset + 2] + coefficients[offset + 6]) / fineCellsPerCoarseCell;
    grid[target + 3] += (coefficients[offset + 3] + coefficients[offset + 7]) / fineCellsPerCoarseCell;
  }
  return {
    ...application.residual.grid,
    status: 'authenticated',
    data: grid,
    dataSha256: await sha256Bytes(new Uint8Array(grid.buffer)),
    depositionIdentity: 'source-order-positive-complement-coarse-cell-volume-average-v0',
    fineCellsPerCoarseCell,
    selectorRerun: false,
    residualAwareRetargeting: false,
    fallbackReason: null,
  };
}

export function validateFourArmHeldStateCaptureReceipt(capture, application) {
  requireContract(capture?.schema === FOUR_ARM_HELD_STATE_CAPTURE_SCHEMA, 'capture-admission', 'schema-drift');
  requireContract(capture.status === 'captured', 'capture-admission', 'status-incomplete');
  requireContract(capture.requestedStateId === application.requestedStateId, 'capture-admission', 'requested-state-drift');
  requireContract(capture.effectiveStateId === application.effectiveStateId, 'capture-admission', 'effective-state-substitution');
  requireContract(capture.requestedArmId === application.requestedArmId, 'capture-admission', 'requested-arm-drift');
  requireContract(capture.effectiveArmId === application.effectiveArmId, 'capture-admission', 'effective-arm-substitution');
  requireContract(capture.route?.requestedRoute === FOUR_ARM_HELD_STATE_ROUTE, 'capture-admission', 'requested-route-drift');
  requireContract(capture.route?.effectiveRoute === FOUR_ARM_HELD_STATE_ROUTE, 'capture-admission', 'effective-route-substitution');
  requireContract(capture.route?.backend === 'WebGPU:apple', 'capture-admission', 'backend-substitution');
  requireContract(capture.route?.fallbackReason === null, 'capture-admission', 'fallback-forbidden');
  requireContract(capture.sourceSimStepCount === application.sourceSimStepCount, 'capture-admission', 'source-step-drift');
  requireContract(capture.capturedSimStepCount === capture.sourceSimStepCount, 'capture-admission', 'held-state-advanced');
  requireContract(capture.selectorRerun === false, 'capture-admission', 'selector-rerun-forbidden');
  requireContract(capture.residualAwareRetargeting === false, 'capture-admission', 'residual-retargeting-forbidden');
  requireContract(typeof capture.sameStateCaptureId === 'string' && capture.sameStateCaptureId.length > 0, 'capture-admission', 'same-state-id-missing');
  requireContract(typeof capture.captureNonce === 'string' && capture.captureNonce.length > 0, 'capture-admission', 'capture-nonce-missing');
  requireContract(capture.freshnessStatus === 'live-controlled-capture', 'capture-admission', 'capture-not-fresh');
  const pixelCount = capture.width * capture.height;
  requireContract(Number.isSafeInteger(pixelCount) && pixelCount > 0, 'capture-admission', 'dimensions-invalid');
  requireContract(capture.linearHdrFloatCount === pixelCount * 4, 'capture-admission', 'linear-hdr-partial');
  requireContract(capture.opticalDepthFloatCount === pixelCount, 'capture-admission', 'optical-depth-partial');
  requireContract(capture.transmittanceFloatCount === pixelCount, 'capture-admission', 'transmittance-partial');
  requireContract(capture.finitePixelCount === pixelCount, 'capture-admission', 'non-finite-pixels');
  requireContract(Number.isSafeInteger(capture.litPixels) && capture.litPixels > 0, 'capture-admission', 'blank-output');
  requireContract(capture.timing?.timestampStatus === 'available', 'capture-admission', 'timing-unavailable');
  let chargedTotal = 0;
  for (const stageName of REQUIRED_STAGE_NAMES) {
    const stage = capture.timing.stages?.[stageName];
    requireContract(stage?.status === 'sampled', 'capture-admission', `${stageName}-timing-partial`);
    requireContract(Number.isFinite(stage.ms) && stage.ms >= 0, 'capture-admission', `${stageName}-timing-invalid`);
    chargedTotal += stage.ms;
  }
  const charged = capture.timing.stages?.chargedTotal;
  requireContract(charged?.status === 'sampled', 'capture-admission', 'chargedTotal-timing-partial');
  requireContract(Number.isFinite(charged.ms) && Math.abs(charged.ms - chargedTotal) <= 1e-9, 'capture-admission', 'chargedTotal-mismatch');
  return true;
}
