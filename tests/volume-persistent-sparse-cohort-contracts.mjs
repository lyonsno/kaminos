import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  loadPersistentSparseCohortState,
  validatePersistentSparseCohortManifest,
} from '../volume-persistent-sparse-cohort.mjs';

const STATE_IDS = [114, 116, 118, 120].map(step => `coefficient-state-${step}`);
const ARRAY_LAYOUT = {
  sourceRowIndices: ['<u4', 4, rowCount => [rowCount]],
  nativeCellIndices: ['<u4', 4, rowCount => [rowCount]],
  coefficients: ['<f4', 4, rowCount => [rowCount, 8]],
  kernelDescriptors: ['<f4', 4, rowCount => [rowCount, 8]],
  features: ['<f4', 4, rowCount => [rowCount, 24]],
  admission: ['<f4', 4, rowCount => [rowCount, 2]],
  footprintScales: ['<f4', 4, rowCount => [rowCount]],
  depositMultiplicity: ['|u1', 1, rowCount => [rowCount]],
  retainedQuadratureWeight: ['<f4', 4, rowCount => [rowCount]],
};

function sha256(bytes) {
  return createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

function product(values) {
  return values.reduce((total, value) => total * value, 1);
}

function artifact(stateId, name, bytes, rowCount) {
  const [dtype, bytesPerValue, shapeForRows] = ARRAY_LAYOUT[name];
  const shape = shapeForRows(rowCount);
  assert.equal(bytes.byteLength, product(shape) * bytesPerValue);
  const extension = name === 'depositMultiplicity' ? 'u8' : (dtype === '<u4' ? 'u32' : 'f32');
  return {
    path: `states/${stateId}/${name}.${extension}`,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    dtype,
    shape,
  };
}

function stateArrays(rowCount = 2) {
  const kernelDescriptors = new Float32Array(rowCount * 8).fill(0.5);
  kernelDescriptors[3] = 101;
  kernelDescriptors[11] = 303;
  return {
    sourceRowIndices: new Uint32Array([3, 9]).buffer,
    nativeCellIndices: new Uint32Array([101, 303]).buffer,
    coefficients: new Float32Array(rowCount * 8).fill(0.25).buffer,
    kernelDescriptors: kernelDescriptors.buffer,
    features: new Float32Array(rowCount * 24).fill(0.75).buffer,
    admission: new Float32Array([1, 0, 0, 1]).buffer,
    footprintScales: new Float32Array([0.6875, 1]).buffer,
    depositMultiplicity: new Uint8Array([12, 15]).buffer,
    retainedQuadratureWeight: new Float32Array([0.8, 1]).buffer,
  };
}

function makeManifest() {
  const rowCount = 2;
  const states = STATE_IDS.map((stateId, index) => {
    const step = Number(stateId.split('-').at(-1));
    const arrays = stateArrays(rowCount);
    const nativeSha = sha256(arrays.nativeCellIndices);
    const emptySha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const previousSha = index === 0 ? emptySha : nativeSha;
    return {
      stateId,
      rowCount,
      arrays: Object.fromEntries(Object.entries(arrays).map(([name, bytes]) => [name, artifact(stateId, name, bytes, rowCount)])),
      steps: step,
      selectionReceipt: {
        initializedFromStatelessOptical: index === 0,
        previous: { count: index === 0 ? 0 : rowCount, distinctCount: index === 0 ? 0 : rowCount, sha256: previousSha },
        selected: { count: rowCount, distinctCount: rowCount, sha256: nativeSha },
        retained: { count: index === 0 ? 0 : 1, distinctCount: index === 0 ? 0 : 1, sha256: index === 0 ? emptySha : sha256Text(`retained-${index}`) },
        entered: { count: index === 0 ? rowCount : 1, distinctCount: index === 0 ? rowCount : 1, sha256: index === 0 ? nativeSha : sha256Text(`entered-${index}`) },
        exited: { count: index === 0 ? 0 : 1, distinctCount: index === 0 ? 0 : 1, sha256: index === 0 ? emptySha : sha256Text(`exited-${index}`) },
        authority: 'matched-mean-membership-plus-target-free-fixed-five-charged-deposition-v0',
        predictionSource: 'previous-state-causal-native-cell-survival-v0',
        membershipPolicy: 'optical-hysteresis-adaptive-mean',
        footprintPolicy: 'optical-hysteresis-adaptive-mean-contribution-footprint',
        depositionPolicy: 'contribution-ranked-five-flow-taps-variable-footprint-top-three-of-four-bilinear-neighbors-renormalized-clipped-to-frame-v0',
        bilinearNeighborLimit: 3,
      },
      depositionReceipt: {
        depositRule: 'contribution-ranked-five-flow-taps-variable-footprint-top-three-of-four-bilinear-neighbors-renormalized-clipped-to-frame-v0',
        bilinearNeighborLimit: 3,
        maximumDepositsPerCandidate: 15,
        nominalTapEvaluationBudget: rowCount * 5,
        nominalDepositEvaluationBudget: rowCount * 20,
        requestedChargedDepositEvaluationBudget: rowCount * 15,
        actualInBoundsPositiveWeightDepositCount: 27,
        retainedQuadratureWeightFraction: { sum: 1.8, meanPerCandidate: 0.9, minimumPerCandidate: 0.8 },
        contributionPlan: {
          authority: 'fixed-five-target-free-contribution-ranked-footprint-v0',
          scoreAuthority: 'local-emission-divided-by-one-plus-local-extinction-v0',
          quotaAuthority: 'projected-eight-by-eight-screen-times-eight-depth-quota-v0',
          targetUsed: false,
          candidateRows: rowCount,
          visibleRows: rowCount,
          quotaCount: 1,
          tapCount: 5,
          nominalTapEvaluations: rowCount * 5,
          nominalDepositEvaluations: rowCount * 20,
          requestedMinimumFootprintScale: 0.6875,
          effectiveMinimumFootprintScale: 0.6875,
          scaleDistribution: { minimum: 0.6875, p50: 0.8, p95: 1, maximum: 1 },
          bilinearNeighborLimit: 3,
          logicalTapCount: 5,
          maximumDepositsPerCandidate: 15,
        },
      },
      sourceRows: { count: 10 },
      camera: { cameraIndex: 0, width: 900, height: 960, cameraPose: {} },
    };
  });
  for (let index = 1; index < states.length; index += 1) {
    states[index].selectionReceipt.previous.sha256 = states[index - 1].selectionReceipt.selected.sha256;
  }
  return {
    schema: 'persistent-sparse-cohort-export-v0',
    status: 'complete',
    failurePhase: null,
    authority: 'accepted-report-replayed-native-membership-consumer-arrays-v0',
    role: 'complete-image-selection-control',
    policy: 'optical-hysteresis-adaptive-mean-contribution-footprint-charged-deposition',
    retargetingStatus: 'forbidden-until-analytical-hybrid-frontier-is-positive',
    source: {
      acceptedReportSha256: '16af31a7d4c34c78324f9bec547cbddab68e69f7f1e38a6731a82b67a10c9386',
      manifestSha256: 'c29ca1dbdbba7102415b2acc14812d196fdbf4524c454855dbcef0e8301267c9',
      motionReportSha256: 'c96ae82508466234c67d2166f42758eab2bbf339027e008c8a360bd2a44cc429',
      implementationBundle: {
        authority: 'sha256-length-delimited-three-file-python-runtime-bundle-v0',
        payloadSource: 'captured-bound-execution',
        sha256: '603398858e2c8dac638f82a43a13f45d5e8f72c88ae1d2eb0d96f761e5e0853f',
      },
    },
    selection: {
      targetPixelsUsed: false,
      candidateBudget: rowCount,
      membershipPolicy: 'optical-hysteresis-adaptive-mean',
      stableIdentity: 'native-cell-index',
      temporalReceipts: 'previous-selected-retained-entered-exited-native-id-sets',
    },
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
      dtypes: Object.fromEntries(Object.entries(ARRAY_LAYOUT).map(([name, [dtype]]) => [name, dtype])),
    },
    states,
  };
}

function response(bytes, { json = false } = {}) {
  return {
    ok: true,
    status: 200,
    async arrayBuffer() { return bytes.slice(0); },
    async json() { return json ? JSON.parse(new TextDecoder().decode(bytes)) : null; },
  };
}

function fixture(manifest = makeManifest(), requestedStateId = STATE_IDS[3], arrayOverrides = {}) {
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest)).buffer;
  const state = manifest.states.find(entry => entry.stateId === requestedStateId);
  const arrays = { ...stateArrays(state.rowCount), ...arrayOverrides };
  const resources = new Map([["https://example.test/cohort-manifest.json", manifestBytes]]);
  for (const [name, bytes] of Object.entries(arrays)) {
    resources.set(new URL(state.arrays[name].path, 'https://example.test/cohort-manifest.json').href, bytes);
  }
  const requested = [];
  return {
    manifest,
    manifestBytes,
    expectedManifestSha256: sha256(manifestBytes),
    requested,
    fetchImpl: async url => {
      requested.push(String(url));
      const bytes = resources.get(String(url));
      return bytes ? response(bytes) : { ok: false, status: 404 };
    },
  };
}

function retainedWeightFixture(values) {
  const manifest = makeManifest();
  const state = manifest.states.at(-1);
  const retainedQuadratureWeight = new Float32Array(values).buffer;
  state.arrays.retainedQuadratureWeight = artifact(
    state.stateId,
    'retainedQuadratureWeight',
    retainedQuadratureWeight,
    state.rowCount,
  );
  return fixture(manifest, state.stateId, { retainedQuadratureWeight });
}

const good = fixture();
const loaded = await loadPersistentSparseCohortState({
  manifestUrl: 'https://example.test/cohort-manifest.json',
  expectedManifestSha256: good.expectedManifestSha256,
  stateId: 'coefficient-state-120',
  fetchImpl: good.fetchImpl,
});
assert.equal(loaded.receipt.status, 'complete');
assert.equal(loaded.receipt.rendererApplied, false);
assert.equal(loaded.receipt.selectorRerun, false);
assert.equal(loaded.receipt.rowCap, null);
assert.equal(loaded.receipt.rowCount, 2);
assert.equal(loaded.receipt.stateId, 'coefficient-state-120');
assert.equal(loaded.receipt.manifestSha256, good.expectedManifestSha256);
assert.equal(loaded.receipt.opticalOwnership.authority, 'complementary-local-optical-coefficient-ownership-v0');
assert.deepEqual(Object.keys(loaded.arrays), Object.keys(ARRAY_LAYOUT));
assert.equal(good.requested.length, 10, 'one state load must fetch one manifest plus all nine uncapped arrays');
assert.equal('manifest' in loaded, false, 'raw producer manifest must not escape the validated receipt boundary');
assert.equal('state' in loaded, false, 'raw producer state must not escape the validated receipt boundary');
assert.equal(loaded.receipt.rowAlignmentAuthority, 'producer-declared-common-order-checksum-bound-v0');
assert.deepEqual(loaded.receipt.rowAlignmentValidation.independentlyDecodedWitnesses, [
  'distinct-source-row-and-native-cell-identities-v0',
  'kernel-descriptor-native-cell-column-v0',
]);
assert.equal(loaded.receipt.hostEndianness, 'little');

const float32Tolerance = retainedWeightFixture([0.8, 1 + (2 * (2 ** -23))]);
const toleranceLoaded = await loadPersistentSparseCohortState({
  manifestUrl: 'https://example.test/cohort-manifest.json',
  expectedManifestSha256: float32Tolerance.expectedManifestSha256,
  stateId: 'coefficient-state-120',
  fetchImpl: float32Tolerance.fetchImpl,
});
assert.equal(toleranceLoaded.receipt.audit.retainedQuadratureWeight.observedMaximum, 1.000000238418579);

const inflatedWeight = retainedWeightFixture([0.8, 1.01]);
await assert.rejects(
  loadPersistentSparseCohortState({
    manifestUrl: 'https://example.test/cohort-manifest.json',
    expectedManifestSha256: inflatedWeight.expectedManifestSha256,
    stateId: 'coefficient-state-120',
    fetchImpl: inflatedWeight.fetchImpl,
  }),
  /retained quadrature weights contains 1 out-of-range values/,
);

const validated = validatePersistentSparseCohortManifest(makeManifest());
assert.deepEqual(validated.stateIds, STATE_IDS);
assert.equal(validated.rowCount, 2);

await assert.rejects(
  loadPersistentSparseCohortState({
    manifestUrl: 'https://example.test/cohort-manifest.json',
    expectedManifestSha256: '0'.repeat(64),
    stateId: 'coefficient-state-120',
    fetchImpl: fixture().fetchImpl,
  }),
  /manifest sha256 mismatch/,
);

for (const [label, mutate, pattern] of [
  ['incomplete manifest', manifest => { manifest.status = 'failed'; }, /manifest is incomplete/],
  ['retargeting drift', manifest => { manifest.retargetingStatus = 'allowed'; }, /retargeting status drift/],
  ['consumer selector rerun', manifest => { manifest.arrayContract.consumerSelection = 'rerun'; }, /consumer selection drift/],
  ['target-dependent selector', manifest => { manifest.selection.targetPixelsUsed = true; }, /target pixels were used/],
  ['hidden row cap', manifest => { manifest.selection.candidateBudget = 1; }, /candidate budget mismatch/],
  ['duplicate optical ownership', manifest => { manifest.opticalOwnership.duplicationForbidden = false; }, /optical ownership drift/],
  ['image residual', manifest => { manifest.opticalOwnership.imageResidualForbidden = false; }, /optical ownership drift/],
  ['state omission', manifest => { manifest.states.pop(); }, /state identity sequence drift/],
  ['selection chain drift', manifest => { manifest.states[2].selectionReceipt.previous.sha256 = 'd'.repeat(64); }, /previous selected sha256 chain drift/],
  ['empty set digest drift', manifest => { manifest.states[0].selectionReceipt.retained.sha256 = 'd'.repeat(64); }, /retained empty-set sha256 drift/],
  ['subset digest impersonation', manifest => { manifest.states[1].selectionReceipt.retained.sha256 = manifest.states[1].selectionReceipt.selected.sha256; }, /retained digest impersonates selected set/],
  ['disjoint temporal digest reuse', manifest => {
    manifest.states[1].selectionReceipt.entered.sha256 = manifest.states[1].selectionReceipt.retained.sha256;
  }, /retained and entered disjoint sets share a digest/],
  ['accepted report substitution', manifest => { manifest.source.acceptedReportSha256 = 'd'.repeat(64); }, /accepted report source binding drift/],
  ['artifact path drift', manifest => { manifest.states[3].arrays.features.path = '../features.f32'; }, /features path drift/],
]) {
  const manifest = makeManifest();
  mutate(manifest);
  assert.throws(() => validatePersistentSparseCohortManifest(manifest), pattern, label);
}

const badArrayHash = fixture();
badArrayHash.manifest.states[3].arrays.coefficients.sha256 = 'f'.repeat(64);
const badArrayManifestBytes = new TextEncoder().encode(JSON.stringify(badArrayHash.manifest)).buffer;
await assert.rejects(
  loadPersistentSparseCohortState({
    manifestUrl: 'https://example.test/cohort-manifest.json',
    expectedManifestSha256: sha256(badArrayManifestBytes),
    stateId: 'coefficient-state-120',
    fetchImpl: async url => String(url).endsWith('cohort-manifest.json')
      ? response(badArrayManifestBytes)
      : badArrayHash.fetchImpl(url),
  }),
  /coefficients sha256 mismatch/,
);

console.log('persistent sparse cohort contracts passed');
