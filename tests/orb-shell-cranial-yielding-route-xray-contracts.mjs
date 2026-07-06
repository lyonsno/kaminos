import assert from 'node:assert/strict';

import {
  createTargetOrbShellCompositionFixture,
} from '../orb-shell-composition-core.js';
import {
  SCHEDULER_VERIFICATION_RECEIPT_SCHEMA,
  SHARP_IMAGE_TO_SPLAT_ROUTE_ID,
  WEBGPU_INFERENCE_KIT_VERSION,
  WEBGPU_PHASE_PROGRAM_RUN_SCHEMA,
  WEBGPU_PHASE_PROGRAM_SCHEMA,
  createCooperativeYield,
  defineWebGpuPhaseProgram,
  runWebGpuPhaseProgram,
} from '../webgpu-inference-kit/src/index.js';

const fixture = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
});

const inventory = fixture.proceduralArchitectureInventory;
assert.equal(inventory?.schema, 'OrbShellProceduralArchitectureInventory');

const xray = inventory.externalRouteXrays?.find(record => (
  record.id === 'cranial-depth-enema-yielding-route-xray'
));

assert.ok(xray, 'Lamellar architecture inventory exposes Cranial yielding-route x-ray');
assert.equal(xray.schema, 'ExternalYieldingRouteXray');
assert.equal(xray.mode, 'cranial-phase-program-yielding-route-xray-v0');
assert.equal(xray.sourceDiaulos, 'cranial-depth-enema');
assert.equal(xray.routeIdentity.phaseProgramSchema, WEBGPU_PHASE_PROGRAM_SCHEMA);
assert.equal(xray.routeIdentity.phaseProgramRunSchema, WEBGPU_PHASE_PROGRAM_RUN_SCHEMA);
assert.equal(xray.routeIdentity.schedulerVerificationReceiptSchema, SCHEDULER_VERIFICATION_RECEIPT_SCHEMA);
assert.equal(xray.routeIdentity.sharpRouteId, SHARP_IMAGE_TO_SPLAT_ROUTE_ID);
assert.equal(xray.routeIdentity.packageVersion, WEBGPU_INFERENCE_KIT_VERSION);

assert.equal(xray.localSubstrate.functionAvailability.defineWebGpuPhaseProgram, typeof defineWebGpuPhaseProgram);
assert.equal(xray.localSubstrate.functionAvailability.runWebGpuPhaseProgram, typeof runWebGpuPhaseProgram);
assert.equal(xray.localSubstrate.functionAvailability.createCooperativeYield, typeof createCooperativeYield);
assert.equal(xray.yieldingContract.primitive, 'createCooperativeYield');
assert.deepEqual(
  xray.yieldingContract.phaseProgramFields,
  ['phase.yieldAfter', 'phase.yieldReason', 'yieldPolicy.afterEachKernel'],
);
assert.ok(
  xray.yieldingContract.schedulerFields.includes('phaseChunkSize.vitBlock'),
  'x-ray keeps Cranial vitBlock phase-chunk scheduler field visible',
);
assert.ok(
  xray.yieldingContract.observedBoundaries.includes('vit-block-chunk'),
  'x-ray keeps observed ViT block boundary visible',
);

assert.equal(xray.positiveSmokeEvidence.routeEvidence, 'authoritative-live-webgpu');
assert.equal(xray.positiveSmokeEvidence.valid, 'OK');
assert.equal(xray.positiveSmokeEvidence.gaussianCount, 1179648);
assert.equal(xray.positiveSmokeEvidence.schedulerVerificationState, 'verified');
assert.equal(xray.evidenceBoundary.contentionPastGaussianPostSpn, 'not-proven');
assert.equal(xray.evidenceBoundary.lamellarGeometryImpact, 'diagnostic-substrate-only');
assert.ok(
  xray.sourceReceipts.includes('webgpu-kit-phase-program-019-landed-2026-07-05'),
  'x-ray points to the source-signed Cranial phase-program landing receipt by public-safe id',
);
assert.ok(
  xray.sourceReceipts.includes('cranial-sharp-vit-block-chunking-2026-07-05'),
  'x-ray points to SHARP ViT chunk smoke evidence by public-safe id',
);
assert.equal(inventory.externalRouteXrayCount, inventory.externalRouteXrays.length);
