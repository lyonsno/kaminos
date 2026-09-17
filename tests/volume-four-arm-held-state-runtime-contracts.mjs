import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FOUR_ARM_HELD_STATE_ARM_IDS,
  FOUR_ARM_HELD_STATE_FULL_COUNTS,
  FOUR_ARM_HELD_STATE_STATE_IDS,
  buildFourArmHeldStateApplication,
  validateFourArmHeldStateArtifact,
  validateFourArmHeldStateCaptureReceipt,
} from '../volume-four-arm-held-state-runtime.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = await readFile(join(root, 'volume-core.js'), 'utf8');
const witness = await readFile(join(root, 'volume-four-arm-held-state-witness.mjs'), 'utf8');

const stateIds = [
  'coefficient-state-114',
  'coefficient-state-116',
  'coefficient-state-118',
  'coefficient-state-120',
];
const armIds = [
  'full-correct',
  'sparse-drop',
  'sparse-conservative',
  'sparse-positive-complement',
];
const fullCounts = {
  'coefficient-state-114': 1_924_725,
  'coefficient-state-116': 1_926_470,
  'coefficient-state-118': 1_927_051,
  'coefficient-state-120': 1_925_788,
};
const sparseCount = 481_447;

assert.deepEqual(FOUR_ARM_HELD_STATE_STATE_IDS, stateIds, 'held-state sequence drifted');
assert.deepEqual(FOUR_ARM_HELD_STATE_ARM_IDS, armIds, 'four-arm sequence drifted');
assert.deepEqual(FOUR_ARM_HELD_STATE_FULL_COUNTS, fullCounts, 'state-keyed full populations drifted');

const descriptor = (name, rows, width = 1) => ({
  path: `/authenticated/${name}`,
  bytes: rows * width * 4,
  sha256: createHash('sha256').update(name).digest('hex'),
  shape: width === 1 ? [rows] : [rows, width],
  authentication: 'sha256-and-byte-count-verified',
});

function fixtureArtifact() {
  return {
    schema: 'kaminos.bailiff.persistent-sparse-positive-complement-artifact.v0',
    status: 'authenticated-build-contract-only',
    decisionBearing: false,
    captureEligible: false,
    source: {
      cohortManifestSha256: '4a93aeefe7eebec06f039dd35bd2947e4e76f292eadd7b7719e02235d062ac20',
      implementationBundleSha256: '603398858e2c8dac638f82a43a13f45d5e8f72c88ae1d2eb0d96f761e5e0853f',
      coefficientAuthority: 'exact-local-layer-emission-extinction',
      ownershipAuthority: 'complementary-local-optical-coefficient-ownership-v0',
      selectionRerun: false,
      residualAwareRetargeting: false,
      supportRedefined: false,
      coefficientsRedefined: false,
      covarianceRedefined: false,
    },
    request: {
      stateIds,
      armIds,
      fullCandidateCountByState: fullCounts,
      sparseCandidateCount: sparseCount,
      residualGridScale: 0.1,
      residualRaySteps: 64,
      width: 900,
      height: 960,
    },
    effectiveConfig: {
      stateIds,
      armIds,
      fullCandidateCountByState: fullCounts,
      sparseCandidateCount: sparseCount,
      residualGridScale: 0.1,
      residualRaySteps: 64,
      width: 900,
      height: 960,
    },
    route: {
      requestedRoute: 'native-3d-compute-fluid-raymarch-v0',
      effectiveRoute: null,
      backend: null,
      status: 'unresolved-before-effective-route',
      fallbackReason: null,
    },
    opticalComposition: {
      ownershipAuthority: 'complementary-local-optical-coefficient-ownership-v0',
      recurrenceIdentity: 'ordered-emission-extinction-shared-transmittance-v0',
      recurrenceCount: 1,
      depthAuthority: 'camera-depth-far-to-near-v0',
      targetFormat: 'rgba16float',
      independentlyToneMapped: false,
      postToneMapAddition: false,
    },
    rails: {
      selectionRerun: false,
      residualAwareRetargeting: false,
      supportRedefined: false,
      coefficientsRedefined: false,
      covarianceRedefined: false,
      depositionRedefined: false,
    },
    states: stateIds.map(stateId => {
      const source = fullCounts[stateId];
      const complement = source - sparseCount;
      const sourceDescriptors = {
        nativeCellIndices: descriptor(`${stateId}-source-membership`, source),
        coefficients: descriptor(`${stateId}-source-coefficients`, source, 8),
        kernelDescriptors: descriptor(`${stateId}-source-kernels`, source, 8),
        features: descriptor(`${stateId}-source-features`, source, 24),
        admission: descriptor(`${stateId}-source-admission`, source, 2),
      };
      const sparsePayload = {
        membership: descriptor(`${stateId}-sparse-membership`, sparseCount),
        sourceRowIndices: descriptor(`${stateId}-sparse-source-rows`, sparseCount),
        coefficients: descriptor(`${stateId}-sparse-coefficients`, sparseCount, 8),
        kernelDescriptors: descriptor(`${stateId}-sparse-kernels`, sparseCount, 8),
        features: descriptor(`${stateId}-sparse-features`, sparseCount, 24),
        admission: descriptor(`${stateId}-sparse-admission`, sparseCount, 2),
        footprintScales: descriptor(`${stateId}-sparse-scales`, sparseCount),
        depositMultiplicity: { ...descriptor(`${stateId}-sparse-multiplicity`, sparseCount), bytes: sparseCount },
        retainedQuadratureWeight: descriptor(`${stateId}-sparse-weight`, sparseCount),
      };
      const residualPayload = {
        enabled: true,
        sourceRowIndices: descriptor(`${stateId}-complement-source-rows`, complement),
        nativeCellIndices: descriptor(`${stateId}-complement-membership`, complement),
        coefficientSource: sourceDescriptors.coefficients,
        kernelDescriptorSource: sourceDescriptors.kernelDescriptors,
        featureSource: sourceDescriptors.features,
        admissionSource: sourceDescriptors.admission,
        gatherAuthority: 'source-order-indexed-positive-complement-gather-v0',
      };
      return {
        stateId,
        steps: Number(stateId.slice(-3)),
        population: { source, sparse: sparseCount, complement, exactClosure: true },
        sourceDescriptors,
        arms: armIds.map(armId => ({
          armId,
          stateId,
          requestedCandidateCount: armId === 'full-correct' ? source : sparseCount,
          membershipSha256: armId === 'full-correct'
            ? sourceDescriptors.nativeCellIndices.sha256
            : sparsePayload.membership.sha256,
          coefficientDisposition: {
            'full-correct': 'all-source-coefficients-in-splats-v0',
            'sparse-drop': 'omitted-coefficients-dropped-ablation-v0',
            'sparse-conservative': 'omitted-coefficients-redistributed-to-splats-v0',
            'sparse-positive-complement': 'complementary-coefficients-in-positive-residual-v0',
          }[armId],
          splatPayload: armId === 'full-correct'
            ? { membership: sourceDescriptors.nativeCellIndices, coefficients: sourceDescriptors.coefficients }
            : sparsePayload,
          residualPayload: armId === 'sparse-positive-complement' ? residualPayload : { enabled: false },
          recurrenceIdentity: 'ordered-emission-extinction-shared-transmittance-v0',
          depthAuthority: 'camera-depth-far-to-near-v0',
          route: { requestedRoute: 'native-3d-compute-fluid-raymarch-v0', effectiveRoute: null, fallbackReason: null },
        })),
      };
    }),
  };
}

const artifact = fixtureArtifact();
assert.equal(validateFourArmHeldStateArtifact(artifact), true);

const dropApplication = buildFourArmHeldStateApplication({
  artifact,
  stateId: 'coefficient-state-118',
  armId: 'sparse-drop',
});
assert.equal(dropApplication.requestedStateId, 'coefficient-state-118');
assert.equal(dropApplication.effectiveStateId, 'coefficient-state-118');
assert.equal(dropApplication.requestedArmId, 'sparse-drop');
assert.equal(dropApplication.effectiveArmId, 'sparse-drop');
assert.equal(dropApplication.splatCandidateCount, sparseCount);
assert.equal(dropApplication.residual.enabled, false);
assert.equal(dropApplication.selectionRerun, false);
assert.equal(dropApplication.fallbackReason, null);

assert.throws(
  () => buildFourArmHeldStateApplication({
    artifact,
    stateId: 'coefficient-state-120',
    armId: 'sparse-positive-complement',
  }),
  /residual-grid-admission:resource-missing/,
  'positive-complement arm must not silently substitute another splat layer for its residual march',
);

const complementState = artifact.states[3];
const complementRows = complementState.population.complement;
const positiveApplication = buildFourArmHeldStateApplication({
  artifact,
  stateId: 'coefficient-state-120',
  armId: 'sparse-positive-complement',
  residualGrid: {
    schema: 'kaminos.integration.positive-complement-grid.v0',
    status: 'authenticated',
    stateId: 'coefficient-state-120',
    sourceRowIndicesSha256: complementState.arms[3].residualPayload.sourceRowIndices.sha256,
    coefficientSourceSha256: complementState.arms[3].residualPayload.coefficientSource.sha256,
    sourceRowCount: complementRows,
    gridSize: 16,
    gridScale: 0.1,
    raySteps: 64,
    targetFormat: 'rgba32float',
    independentlyToneMapped: false,
    postToneMapAddition: false,
  },
});
assert.equal(positiveApplication.residual.enabled, true);
assert.equal(positiveApplication.residual.mode, 'positive-complement-coarse-volume-raymarch-v0');
assert.equal(positiveApplication.recurrenceCount, 1);

const scalarAlias = fixtureArtifact();
scalarAlias.request.fullCandidateCount = fullCounts['coefficient-state-120'];
assert.throws(
  () => validateFourArmHeldStateArtifact(scalarAlias),
  /artifact-admission:scalar-full-count-alias-forbidden/,
);

const stateAlias = structuredClone(artifact);
stateAlias.states[0].stateId = 'coefficient-state-120';
assert.throws(
  () => validateFourArmHeldStateArtifact(stateAlias),
  /artifact-admission:state-sequence-drift/,
);

const fallbackArtifact = structuredClone(artifact);
fallbackArtifact.route.fallbackReason = 'raymarch-only-substitution';
assert.throws(
  () => validateFourArmHeldStateArtifact(fallbackArtifact),
  /artifact-admission:fallback-forbidden/,
);

const capture = {
  schema: 'kaminos.integration.four-arm-held-state-capture.v0',
  status: 'captured',
  requestedStateId: dropApplication.requestedStateId,
  effectiveStateId: dropApplication.effectiveStateId,
  requestedArmId: dropApplication.requestedArmId,
  effectiveArmId: dropApplication.effectiveArmId,
  route: {
    requestedRoute: 'native-3d-compute-fluid-raymarch-v0',
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    backend: 'WebGPU:apple',
    fallbackReason: null,
  },
  sourceSimStepCount: 118,
  capturedSimStepCount: 118,
  selectorRerun: false,
  residualAwareRetargeting: false,
  sameStateCaptureId: 'capture-118-drop',
  captureNonce: 'nonce-118-drop-0001',
  freshnessStatus: 'live-controlled-capture',
  width: 900,
  height: 960,
  linearHdrFloatCount: 900 * 960 * 4,
  opticalDepthFloatCount: 900 * 960,
  transmittanceFloatCount: 900 * 960,
  finitePixelCount: 900 * 960,
  litPixels: 1,
  timing: {
    timestampStatus: 'available',
    stages: Object.fromEntries([
      'selection',
      'compaction',
      'deposition',
      'splatRaster',
      'residualMarch',
      'reconstruction',
      'composition',
      'chargedTotal',
    ].map(name => [name, { status: 'sampled', ms: 0 }])),
  },
};
assert.equal(validateFourArmHeldStateCaptureReceipt(capture, dropApplication), true);

const advancingCapture = structuredClone(capture);
advancingCapture.capturedSimStepCount = 119;
assert.throws(
  () => validateFourArmHeldStateCaptureReceipt(advancingCapture, dropApplication),
  /capture-admission:held-state-advanced/,
);

const partialCapture = structuredClone(capture);
partialCapture.transmittanceFloatCount -= 1;
assert.throws(
  () => validateFourArmHeldStateCaptureReceipt(partialCapture, dropApplication),
  /capture-admission:transmittance-partial/,
);

assert.match(core, /applyFourArmHeldStateApplication/, 'volume runtime must expose explicit four-arm application');
const runtimeApplicationBody = core.match(/async function applyFourArmHeldStateApplication\([^]*?\n  }\n\n/)?.[0] || '';
assert.ok(runtimeApplicationBody, 'four-arm runtime application implementation is missing');
assert.doesNotMatch(
  runtimeApplicationBody,
  /gpuRows instanceof Float32Array/,
  'four-arm runtime must admit authenticated Float32Array payloads across the cockpit iframe boundary',
);
assert.match(runtimeApplicationBody, /isFloat32ArrayView\(gpuRows\)/, 'four-arm runtime must use realm-safe row admission');
const residualUploadBody = core.match(/function uploadFourArmHeldStateResidualGrid\([^]*?\n  }\n\n/)?.[0] || '';
assert.ok(residualUploadBody, 'positive-complement residual upload implementation is missing');
assert.match(
  residualUploadBody,
  /fourArmHeldStateResidualTexture\s*=\s*device\.createTexture\(\{[^]*size:\s*\{[^}]+\},\s*dimension:\s*'3d'/,
  'positive-complement residual storage must be an actual 3D texture, not 2D array layers',
);
assert.match(core, /fourArmHeldStateResidualBindGroupLayout\s*=\s*device\.createBindGroupLayout/,
  'residual depth bins must share one explicit bind-group layout');
assert.match(core, /fourArmHeldStateResidualPipelineLayout\s*=\s*device\.createPipelineLayout/,
  'residual depth bins must share one explicit pipeline layout');
assert.match(core, /layout:\s*fourArmHeldStateResidualPipelineLayout/,
  'residual pipelines must not receive distinct auto-layout identities');
assert.match(residualUploadBody, /layout:\s*fourArmHeldStateResidualBindGroupLayout/,
  'residual bind group must use the same explicit layout as every depth-bin pipeline');
assert.match(core, /sampleFourArmHeldStateLedger/, 'volume runtime must expose a dedicated held-state sampler');
const timestampMarkerBody = core.match(/function encodeBoundarySplatTimestampMarker\([^]*?\n  }\n\n/)?.[0] || '';
assert.ok(timestampMarkerBody, 'held-state timestamp marker implementation is missing');
assert.match(timestampMarkerBody, /setPipeline\(fourArmHeldStateTimestampMarkerPipeline\)/,
  'timestamp markers must encode GPU work instead of relying on empty-pass timestamps');
assert.match(timestampMarkerBody, /dispatchWorkgroups\(1\)/,
  'timestamp markers must dispatch one bounded workgroup so Apple WebGPU writes the query');
const samplerBody = core.match(/async function sampleFourArmHeldStateLedger\([^]*?\n  }\n\n/)?.[0] || '';
assert.ok(samplerBody, 'held-state sampler implementation is missing');
assert.doesNotMatch(samplerBody, /encodeSim\s*\(/, 'held-state sampler must not advance the simulation');
assert.match(samplerBody, /const queryCount = 14;/, 'seven timing stages require independent begin/end query pairs');
assert.doesNotMatch(
  samplerBody,
  /timestamps\[index\]\s*<\s*timestamps\[index - 1\]/,
  'independent GPU passes must not be forced into a globally monotonic scheduler order',
);
assert.match(samplerBody, /linearHdr/, 'held-state sampler must expose linear HDR readback');
assert.match(samplerBody, /opticalDepth/, 'held-state sampler must expose optical-depth readback');
assert.match(samplerBody, /transmittance/, 'held-state sampler must expose transmittance readback');
const opticalRecurrenceBody = core.match(/function encodeBoundarySplatOpticalRecurrence\([^]*?\n  }\n\n/)?.[0] || '';
assert.ok(opticalRecurrenceBody, 'operator-visible optical recurrence implementation is missing');
assert.match(
  opticalRecurrenceBody,
  /fourArmHeldStateRuntimeState\?\.application\?\.residual\?\.enabled[^]*encodeFourArmHeldStateResidualMarch\s*\(encoder\)/,
  'operator-visible positive-complement composition must march the same admitted residual before resolve',
);
assert.match(witness, /undeclared-resource-root/, 'witness must reject unmounted resource substitution');
assert.match(witness, /validateFourArmHeldStateCaptureReceipt/, 'witness must validate the live capture before reporting');
assert.match(witness, /failurePhase/, 'witness must preserve phase-specific failures');
assert.match(witness, /capture\.fallbackUsed, false/, 'witness must reject authoritative-looking fallback');

console.log('four-arm held-state runtime contracts passed');
