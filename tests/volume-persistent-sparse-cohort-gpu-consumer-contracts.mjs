import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PERSISTENT_COHORT_GPU_ROW_FLOATS,
  PERSISTENT_COHORT_GPU_SOURCE_AUTHORITY,
  packPersistentSparseCohortGpuRows,
} from '../volume-persistent-sparse-cohort-gpu-consumer.mjs';

const root = join(import.meta.dirname, '..');
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const cockpit = readFileSync(join(root, 'index.html'), 'utf8');
const session = readFileSync(join(root, 'volume-full-support-cockpit-session.mjs'), 'utf8');
const witness = readFileSync(join(root, 'volume-full-support-cockpit-witness.mjs'), 'utf8');

const arrays = {
  sourceRowIndices: new Uint32Array([17, 29]),
  nativeCellIndices: new Uint32Array([101, 303]),
  coefficients: new Float32Array([
    1, 2, 3, 4, 5, 6, 7, 8,
    11, 12, 13, 14, 15, 16, 17, 18,
  ]),
  kernelDescriptors: new Float32Array([
    0.1, 0.2, 0.3, 101, 0.4, 0.5, 0.6, 0.7,
    1.1, 1.2, 1.3, 303, 1.4, 1.5, 1.6, 1.7,
  ]),
  features: new Float32Array([
    0, 0, 0.2, 0.4, ...new Array(20).fill(0),
    0, 0, 0.6, 0.8, ...new Array(20).fill(0),
  ]),
  admission: new Float32Array([1, 0, 0, 1]),
  footprintScales: new Float32Array([0.6875, 1]),
  depositMultiplicity: new Uint8Array([15, 12]),
  retainedQuadratureWeight: new Float32Array([1, 0.75]),
};

const receipt = {
  identity: 'persistent-sparse-cohort-state-load-receipt-v0',
  status: 'complete',
  authority: 'checksum-bound-authenticated-persistent-sparse-cohort-loader-v0',
  manifestUrl: 'https://example.test/cohort-manifest.json',
  manifestSha256: 'a'.repeat(64),
  stateId: 'coefficient-state-120',
  steps: 120,
  rowCount: 2,
  rowCap: null,
  droppedRowCount: 0,
  selectorRerun: false,
  depositionAuthority: 'contribution-ranked-five-flow-taps-variable-footprint-top-three-of-four-bilinear-neighbors-renormalized-clipped-to-frame-v0',
  opticalOwnership: {
    authority: 'complementary-local-optical-coefficient-ownership-v0',
    splatEmission: 'w_j * j',
    residualEmission: '(1 - w_j) * j',
    splatExtinction: 'w_sigma * sigma',
    residualExtinction: '(1 - w_sigma) * sigma',
    duplicationForbidden: true,
    imageResidualForbidden: true,
  },
  rendererApplied: false,
};

const packed = packPersistentSparseCohortGpuRows({ arrays, receipt });
assert.equal(PERSISTENT_COHORT_GPU_ROW_FLOATS, 24);
assert.equal(packed.rows.length, 2 * PERSISTENT_COHORT_GPU_ROW_FLOATS);
assert.deepEqual(packed.rows.slice(0, 24), new Float32Array([
  0.1, 0.2, 0.3, 1,
  1, 2, 3, 4,
  0.02195, 0.6875, 1, 15,
  0.4, 0.5, 0.6, 0.7,
  5, 6, 7, 8,
  101, 1, 0, 17,
]));
assert.equal(packed.receipt.identity, 'persistent-sparse-cohort-gpu-pack-receipt-v0');
assert.equal(packed.receipt.sourceAuthority, PERSISTENT_COHORT_GPU_SOURCE_AUTHORITY);
assert.equal(packed.receipt.requestedRowCount, 2);
assert.equal(packed.receipt.encodedRowCount, 2);
assert.equal(packed.receipt.rowCap, null);
assert.equal(packed.receipt.droppedRowCount, 0);
assert.equal(packed.receipt.selectorRerun, false);
assert.equal(packed.receipt.rendererRequested, true);
assert.equal(packed.receipt.rendererEncoded, false);
assert.equal(packed.receipt.rendererApplied, false);
assert.equal(packed.receipt.depositsPerCandidate, 15);
assert.equal(packed.receipt.requestedDepositCount, 30);
assert.equal(packed.receipt.coefficientOwnership, 'exact-exported-complementary-splat-share-v0');

for (const [label, mutate, expected] of [
  ['hidden cap', value => { value.receipt.rowCap = 1; }, /row cap/],
  ['dropped row', value => { value.receipt.droppedRowCount = 1; }, /dropped rows/],
  ['selector rerun', value => { value.receipt.selectorRerun = true; }, /selector rerun/],
  ['duplicate ownership', value => { value.receipt.opticalOwnership.duplicationForbidden = false; }, /optical ownership/],
  ['row mismatch', value => { value.arrays.nativeCellIndices = new Uint32Array([101]); }, /nativeCellIndices length/],
  ['kernel identity mismatch', value => { value.arrays.kernelDescriptors[3] = 999; }, /kernel native-cell mismatch/],
]) {
  const value = structuredClone({ arrays, receipt });
  mutate(value);
  assert.throws(() => packPersistentSparseCohortGpuRows(value), expected, label);
}

assert.match(core, /applyPersistentSparseCohortGpuState/, 'volume runtime must expose an explicit cohort GPU application API');
assert.match(core, /persistentSparseCohortGpuState[^]*encodeBoundarySplats/, 'cohort source state must reach the splat encoder explicitly');
assert.match(core, /persistent-cohort-source-substitution/, 'requested persistent rows must fail loud instead of falling back to live compaction');
assert.match(core, /rendererRequested[^]*rendererEncoded[^]*rendererApplied/, 'runtime receipt must separate requested, encoded, and applied renderer phases');
assert.match(core, /PERSISTENT_COHORT_CHARGED_DEPOSITS_PER_CANDIDATE\s*=\s*15/, 'runtime must charge exactly fifteen top-three deposits per candidate');
assert.match(core, /persistentCohortTopThreeBilinearWeight/, 'runtime shader must implement stable top-three bilinear renormalization');
assert.match(core, /appendPersistentCohortPassIdentity/, 'runtime must accumulate persistent cohort pass identities instead of overwriting prior bins');
assert.match(core, /effectivePipeline\?\.label/, 'runtime pass receipt must name the effective deposition pipeline');
assert.match(cockpit, /loadPersistentSparseCohortState/, 'cockpit must use the authenticated cohort loader');
assert.match(cockpit, /full_support_persistent_cohort_manifest_sha256/, 'cockpit route must bind the requested manifest checksum');
assert.match(cockpit, /full_support_persistent_cohort_state/, 'cockpit route must expose the exact held-state identity');
assert.match(cockpit, /persistent-cohort-route-hash-pair-incomplete/, 'an incomplete cohort route must fail loud');
assert.match(cockpit, /applyPersistentSparseCohortGpuState/, 'cockpit must invoke the explicit GPU consumer');
assert.match(
  cockpit,
  /setSelectiveHeadLiveCapturePaused\(true\)[^]*applyPersistentSparseCohortGpuState[^]*sampleFrame/,
  'cockpit must admit the persistent cohort against a paused queue and render one receipt-bearing frame',
);
assert.match(cockpit, /persistentSparseCohortGpuReceipt/, 'cockpit must report the effective runtime receipt');
assert.match(cockpit, /rendererRequested[^]*rendererEncoded[^]*rendererApplied/, 'cockpit status must preserve requested, encoded, and applied phases');
assert.match(session, /--persistent-cohort-manifest/, 'session launcher must mount an explicit cohort manifest');
assert.match(session, /--persistent-cohort-manifest-sha256/, 'session launcher must bind the cohort manifest checksum');
assert.match(session, /--persistent-cohort-state/, 'session launcher must bind the requested held state');
assert.match(session, /full_support_persistent_cohort_manifest/, 'session launcher must encode the effective cohort route');
assert.match(witness, /__kaminosPersistentSparseCohortReceipt/, 'browser witness must inspect the effective cohort receipt');
assert.match(witness, /7_221_705/, 'browser witness must require the exact state-120 charged deposit count');
assert.match(witness, /persistent cohort fallback looked authoritative/, 'browser witness must reject persistent source fallback');
assert.match(witness, /persistentCohortReceipt,/, 'passing witness report must preserve the exact cohort receipt it admitted');
assert.match(witness, /persistentCohortVisualProbe,/, 'passing witness report must preserve cohort pixel metrics');
assert.match(witness, /persistent cohort frame was blank/, 'browser witness must reject blank cohort pixels');
assert.match(witness, /persistent cohort optical pass ledger drifted/, 'browser witness must require every effective optical depth-bin pass');

console.log('persistent sparse cohort GPU consumer contracts passed');
