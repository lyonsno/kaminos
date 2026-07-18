import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const modulePath = join(root, 'volume-persistent-sparse-hybrid-frontier.mjs');

assert.ok(existsSync(modulePath), 'persistent sparse hybrid frontier consumer is missing');
const {
  EXPECTED_MANIFEST_SHA256,
  validatePersistentSparseCohortManifest,
} = await import(pathToFileURL(modulePath));

const ROWS = 481447;
const SHA = 'a'.repeat(64);
const arrays = () => ({
  sourceRowIndices: { path: 'states/state/sourceRowIndices.u32', bytes: ROWS * 4, sha256: SHA, dtype: '<u4', shape: [ROWS] },
  nativeCellIndices: { path: 'states/state/nativeCellIndices.u32', bytes: ROWS * 4, sha256: SHA, dtype: '<u4', shape: [ROWS] },
  coefficients: { path: 'states/state/coefficients.f32', bytes: ROWS * 8 * 4, sha256: SHA, dtype: '<f4', shape: [ROWS, 8] },
  kernelDescriptors: { path: 'states/state/kernelDescriptors.f32', bytes: ROWS * 8 * 4, sha256: SHA, dtype: '<f4', shape: [ROWS, 8] },
  features: { path: 'states/state/features.f32', bytes: ROWS * 24 * 4, sha256: SHA, dtype: '<f4', shape: [ROWS, 24] },
  admission: { path: 'states/state/admission.f32', bytes: ROWS * 2 * 4, sha256: SHA, dtype: '<f4', shape: [ROWS, 2] },
  footprintScales: { path: 'states/state/footprintScales.f32', bytes: ROWS * 4, sha256: SHA, dtype: '<f4', shape: [ROWS] },
  depositMultiplicity: { path: 'states/state/depositMultiplicity.u8', bytes: ROWS, sha256: SHA, dtype: '|u1', shape: [ROWS] },
  retainedQuadratureWeight: { path: 'states/state/retainedQuadratureWeight.f32', bytes: ROWS * 4, sha256: SHA, dtype: '<f4', shape: [ROWS] },
});

function fixture() {
  return {
    schema: 'persistent-sparse-cohort-export-v0',
    status: 'complete',
    failurePhase: null,
    authority: 'accepted-report-replayed-native-membership-consumer-arrays-v0',
    role: 'complete-image-selection-control',
    policy: 'optical-hysteresis-adaptive-mean-contribution-footprint-charged-deposition',
    retargetingStatus: 'forbidden-until-bailiff-analytical-hybrid-frontier-v0',
    source: { acceptedReportSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64), motionReportSha256: 'd'.repeat(64), implementationBundle: { sha256: 'e'.repeat(64) } },
    selection: { targetPixelsUsed: false, candidateBudget: ROWS, membershipPolicy: 'optical-hysteresis-adaptive-mean', stableIdentity: 'native-cell-index' },
    opticalOwnership: {
      authority: 'complementary-local-optical-coefficient-ownership-v0',
      splatEmission: 'w_j * j',
      residualEmission: '(1 - w_j) * j',
      splatExtinction: 'w_sigma * sigma',
      residualExtinction: '(1 - w_sigma) * sigma',
      duplicationForbidden: true,
      imageResidualForbidden: true,
    },
    arrayContract: {
      rowAlignment: 'all arrays share sourceRowIndices/nativeCellIndices order',
      consumerSelection: 'do-not-rerun-selection',
      consumerDeposition: 'fixed-five-flow-taps-with-exported-footprint-scales-and-top-three-bilinear-neighbors',
      dtypes: Object.fromEntries(Object.entries(arrays()).map(([name, descriptor]) => [name, descriptor.dtype])),
    },
    states: [114, 116, 118, 120].map(steps => ({
      stateId: `coefficient-state-${steps}`,
      steps,
      rowCount: ROWS,
      arrays: arrays(),
      selectionReceipt: { membershipPolicy: 'optical-hysteresis-adaptive-mean', bilinearNeighborLimit: 3 },
      depositionReceipt: {
        bilinearNeighborLimit: 3,
        maximumDepositsPerCandidate: 15,
        contributionPlan: { targetUsed: false, tapCount: 5, requestedMinimumFootprintScale: 0.6875, effectiveMinimumFootprintScale: 0.6875, bilinearNeighborLimit: 3 },
      },
      sourceRows: { count: 1924725, coefficients: { path: '/source/coefficients.f32', bytes: 1924725 * 8 * 4, sha256: SHA, shape: [1924725, 8] }, nativeCellIndices: { path: '/source/native.u32', bytes: 1924725 * 4, sha256: SHA, shape: [1924725] } },
    })),
  };
}

test('exact immutable producer contract is admitted without selection authority', () => {
  assert.equal(EXPECTED_MANIFEST_SHA256, '4a93aeefe7eebec06f039dd35bd2947e4e76f292eadd7b7719e02235d062ac20');
  const receipt = validatePersistentSparseCohortManifest(fixture());
  assert.equal(receipt.ok, true);
  assert.equal(receipt.selectionRerunAuthorized, false);
  assert.equal(receipt.coefficientConservationEligible, true);
});

for (const [name, mutate, pattern] of [
  ['partial state cohort', value => value.states.pop(), /four held states/],
  ['image residual authority', value => { value.opticalOwnership.imageResidualForbidden = false; }, /image residual/],
  ['duplicated optical ownership', value => { value.opticalOwnership.residualEmission = 'j'; }, /residual emission ownership/],
  ['selection rerun', value => { value.arrayContract.consumerSelection = 'rerun-selection'; }, /selection rerun/],
  ['target-aware deposition', value => { value.states[0].depositionReceipt.contributionPlan.targetUsed = true; }, /target pixels/],
  ['row substitution', value => { value.states[0].rowCount -= 1; }, /row count/],
  ['array omission', value => { delete value.states[0].arrays.coefficients; }, /array set/],
  ['deposition drift', value => { value.states[0].depositionReceipt.bilinearNeighborLimit = 4; }, /top-three/],
]) {
  test(`${name} is rejected`, () => {
    const value = fixture();
    mutate(value);
    assert.throws(() => validatePersistentSparseCohortManifest(value), pattern);
  });
}

console.log('persistent sparse hybrid frontier contracts: ok');
