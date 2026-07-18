import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const modulePath = join(root, 'volume-persistent-sparse-hybrid-frontier.mjs');

assert.ok(existsSync(modulePath), 'persistent sparse hybrid frontier consumer is missing');
const {
  EXPECTED_MANIFEST_SHA256,
  authenticatePersistentSparseCohort,
  descriptorPath,
  failedFrontierReceipt,
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
    retargetingStatus: 'forbidden-until-analytical-hybrid-frontier-is-positive',
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

test('structural admission cannot claim coefficient conservation', () => {
  assert.equal(EXPECTED_MANIFEST_SHA256, '4a93aeefe7eebec06f039dd35bd2947e4e76f292eadd7b7719e02235d062ac20');
  const receipt = validatePersistentSparseCohortManifest(fixture());
  assert.equal(receipt.ok, true);
  assert.equal(receipt.selectionRerunAuthorized, false);
  assert.equal(receipt.coefficientConservationEligible, false);
});

test('unauthorized manifest binding fails before evidence can claim parity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'persistent-sparse-frontier-'));
  const manifestPath = join(directory, 'manifest.json');
  writeFileSync(manifestPath, '{}\n');
  try {
    await assert.rejects(
      authenticatePersistentSparseCohort({ manifestPath, expectedManifestSha256: 'f'.repeat(64) }),
      error => {
        assert.equal(error.failurePhase, 'manifest-admission');
        const receipt = failedFrontierReceipt(error);
        assert.equal(receipt.status, 'failed');
        assert.equal(receipt.coefficientConservationEligible, false);
        assert.equal(receipt.visualClaimEligible, false);
        assert.equal(receipt.productionEconomicsEligible, false);
        return true;
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('local array descriptors reject symlink escape from the manifest root', () => {
  const directory = mkdtempSync(join(tmpdir(), 'persistent-sparse-frontier-path-'));
  const root = join(directory, 'cohort');
  const outside = join(directory, 'outside.bin');
  mkdirSync(root);
  writeFileSync(join(root, 'manifest.json'), '{}\n');
  writeFileSync(outside, 'outside\n');
  symlinkSync(outside, join(root, 'escaped.bin'));
  try {
    assert.throws(
      () => descriptorPath({ path: 'escaped.bin' }, join(root, 'manifest.json'), true),
      /escaped the manifest root/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI argument failure writes a phase-specific ineligible receipt', () => {
  const directory = mkdtempSync(join(tmpdir(), 'persistent-sparse-frontier-cli-'));
  const reportPath = join(directory, 'nested', 'failure.json');
  try {
    const result = spawnSync(process.execPath, [modulePath, '--report', reportPath], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    const receipt = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.failurePhase, 'argument-validation');
    assert.equal(receipt.coefficientConservationEligible, false);
    assert.equal(receipt.visualClaimEligible, false);
    assert.equal(receipt.productionEconomicsEligible, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
