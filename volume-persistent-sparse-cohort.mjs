const SCHEMA = 'persistent-sparse-cohort-export-v0';
const MANIFEST_AUTHORITY = 'accepted-report-replayed-native-membership-consumer-arrays-v0';
const ROLE = 'complete-image-selection-control';
const POLICY = 'optical-hysteresis-adaptive-mean-contribution-footprint-charged-deposition';
const RETARGETING_STATUS = 'forbidden-until-analytical-hybrid-frontier-is-positive';
const LOADER_AUTHORITY = 'checksum-bound-authenticated-persistent-sparse-cohort-loader-v0';
const ACCEPTED_REPORT_SHA256 = '16af31a7d4c34c78324f9bec547cbddab68e69f7f1e38a6731a82b67a10c9386';
const SOURCE_MANIFEST_SHA256 = 'c29ca1dbdbba7102415b2acc14812d196fdbf4524c454855dbcef0e8301267c9';
const MOTION_REPORT_SHA256 = 'c96ae82508466234c67d2166f42758eab2bbf339027e008c8a360bd2a44cc429';
const IMPLEMENTATION_BUNDLE_SHA256 = '603398858e2c8dac638f82a43a13f45d5e8f72c88ae1d2eb0d96f761e5e0853f';
const SELECTION_AUTHORITY = 'matched-mean-membership-plus-target-free-fixed-five-charged-deposition-v0';
const MEMBERSHIP_POLICY = 'optical-hysteresis-adaptive-mean';
const FOOTPRINT_POLICY = 'optical-hysteresis-adaptive-mean-contribution-footprint';
const DEPOSITION_POLICY = 'contribution-ranked-five-flow-taps-variable-footprint-top-three-of-four-bilinear-neighbors-renormalized-clipped-to-frame-v0';
const OPTICAL_OWNERSHIP = Object.freeze({
  authority: 'complementary-local-optical-coefficient-ownership-v0',
  splatEmission: 'w_j * j',
  residualEmission: '(1 - w_j) * j',
  splatExtinction: 'w_sigma * sigma',
  residualExtinction: '(1 - w_sigma) * sigma',
  duplicationForbidden: true,
  imageResidualForbidden: true,
});
const STATE_IDS = Object.freeze([114, 116, 118, 120].map(step => `coefficient-state-${step}`));
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const RETAINED_WEIGHT_MAXIMUM = 1 + (2 * (2 ** -23));
const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
const ARRAY_LAYOUT = Object.freeze({
  sourceRowIndices: Object.freeze({ dtype: '<u4', bytesPerValue: 4, columns: 1, extension: 'u32' }),
  nativeCellIndices: Object.freeze({ dtype: '<u4', bytesPerValue: 4, columns: 1, extension: 'u32' }),
  coefficients: Object.freeze({ dtype: '<f4', bytesPerValue: 4, columns: 8, extension: 'f32' }),
  kernelDescriptors: Object.freeze({ dtype: '<f4', bytesPerValue: 4, columns: 8, extension: 'f32' }),
  features: Object.freeze({ dtype: '<f4', bytesPerValue: 4, columns: 24, extension: 'f32' }),
  admission: Object.freeze({ dtype: '<f4', bytesPerValue: 4, columns: 2, extension: 'f32' }),
  footprintScales: Object.freeze({ dtype: '<f4', bytesPerValue: 4, columns: 1, extension: 'f32' }),
  depositMultiplicity: Object.freeze({ dtype: '|u1', bytesPerValue: 1, columns: 1, extension: 'u8' }),
  retainedQuadratureWeight: Object.freeze({ dtype: '<f4', bytesPerValue: 4, columns: 1, extension: 'f32' }),
});

function requireContract(condition, message) {
  if (!condition) throw new Error(`persistent sparse cohort ${message}`);
}

function validSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function exactObject(actual, expected) {
  return actual && typeof actual === 'object'
    && JSON.stringify(actual) === JSON.stringify(expected);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object'
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

async function sha256Hex(bytes) {
  requireContract(globalThis.crypto?.subtle, 'WebCrypto SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function expectedShape(rowCount, columns) {
  return columns === 1 ? [rowCount] : [rowCount, columns];
}

function validateCountSet(receipt, label, maximum) {
  requireContract(receipt && typeof receipt === 'object', `${label} receipt is missing`);
  requireContract(Number.isSafeInteger(receipt.count) && receipt.count >= 0 && receipt.count <= maximum, `${label} count is invalid`);
  requireContract(receipt.distinctCount === receipt.count, `${label} contains duplicate native-cell identities`);
  requireContract(validSha256(receipt.sha256), `${label} sha256 is invalid`);
  requireContract(
    receipt.count === 0 ? receipt.sha256 === EMPTY_SHA256 : receipt.sha256 !== EMPTY_SHA256,
    `${label} ${receipt.count === 0 ? 'empty-set' : 'nonempty-set'} sha256 drift`,
  );
}

function validateSubsetDigest({ subset, superset, subsetLabel, supersetLabel, stateId }) {
  requireContract(subset.count <= superset.count, `${stateId} ${subsetLabel} count exceeds ${supersetLabel}`);
  if (subset.count === superset.count) {
    requireContract(subset.sha256 === superset.sha256, `${stateId} ${subsetLabel} digest differs from equal ${supersetLabel}`);
  } else if (subset.count > 0) {
    requireContract(subset.sha256 !== superset.sha256, `${stateId} ${subsetLabel} digest impersonates ${supersetLabel} set`);
  }
}

function validateDisjointDigests({ left, right, leftLabel, rightLabel, stateId }) {
  if (left.count > 0 && right.count > 0) {
    requireContract(left.sha256 !== right.sha256, `${stateId} ${leftLabel} and ${rightLabel} disjoint sets share a digest`);
  }
}

function validateArtifact(state, name) {
  const layout = ARRAY_LAYOUT[name];
  const artifact = state.arrays?.[name];
  const shape = expectedShape(state.rowCount, layout.columns);
  const expectedPath = `states/${state.stateId}/${name}.${layout.extension}`;
  requireContract(artifact && typeof artifact === 'object', `${state.stateId} ${name} artifact is missing`);
  requireContract(artifact.path === expectedPath, `${state.stateId} ${name} path drift`);
  requireContract(artifact.dtype === layout.dtype, `${state.stateId} ${name} dtype drift`);
  requireContract(JSON.stringify(artifact.shape) === JSON.stringify(shape), `${state.stateId} ${name} shape drift`);
  requireContract(artifact.bytes === state.rowCount * layout.columns * layout.bytesPerValue, `${state.stateId} ${name} byte length drift`);
  requireContract(validSha256(artifact.sha256), `${state.stateId} ${name} sha256 is invalid`);
}

function validateSelectionReceipt(state, previousState) {
  const receipt = state.selectionReceipt;
  requireContract(receipt?.authority === SELECTION_AUTHORITY, `${state.stateId} selection authority drift`);
  requireContract(receipt.predictionSource === 'previous-state-causal-native-cell-survival-v0', `${state.stateId} prediction source drift`);
  requireContract(receipt.membershipPolicy === MEMBERSHIP_POLICY, `${state.stateId} membership policy drift`);
  requireContract(receipt.footprintPolicy === FOOTPRINT_POLICY, `${state.stateId} footprint policy drift`);
  requireContract(receipt.depositionPolicy === DEPOSITION_POLICY, `${state.stateId} deposition policy drift`);
  requireContract(receipt.bilinearNeighborLimit === 3, `${state.stateId} bilinear neighbor limit drift`);
  for (const label of ['previous', 'selected', 'retained', 'entered', 'exited']) {
    validateCountSet(receipt[label], `${state.stateId} ${label}`, state.rowCount);
  }
  requireContract(receipt.selected.count === state.rowCount, `${state.stateId} selected count differs from row count`);
  requireContract(receipt.selected.sha256 === state.arrays.nativeCellIndices.sha256, `${state.stateId} selected sha256 differs from native-cell artifact`);
  requireContract(receipt.retained.count + receipt.entered.count === state.rowCount, `${state.stateId} retained plus entered count mismatch`);
  if (!previousState) {
    requireContract(receipt.initializedFromStatelessOptical === true, `${state.stateId} initial selection is not stateless`);
    requireContract(receipt.previous.count === 0 && receipt.previous.sha256 === EMPTY_SHA256, `${state.stateId} initial previous set is not empty`);
    requireContract(receipt.retained.count === 0 && receipt.exited.count === 0, `${state.stateId} initial temporal sets are not empty`);
    requireContract(
      receipt.entered.count === receipt.selected.count && receipt.entered.sha256 === receipt.selected.sha256,
      `${state.stateId} initial entered set differs from selected set`,
    );
  } else {
    requireContract(receipt.initializedFromStatelessOptical === false, `${state.stateId} unexpectedly reinitialized selection`);
    requireContract(receipt.previous.count === previousState.rowCount, `${state.stateId} previous count drift`);
    requireContract(
      receipt.previous.sha256 === previousState.selectionReceipt.selected.sha256,
      `${state.stateId} previous selected sha256 chain drift`,
    );
    requireContract(
      receipt.previous.count - receipt.exited.count + receipt.entered.count === state.rowCount,
      `${state.stateId} temporal membership conservation failed`,
    );
    requireContract(
      receipt.entered.count === receipt.selected.count - receipt.retained.count,
      `${state.stateId} entered count differs from selected minus retained`,
    );
    requireContract(
      receipt.exited.count === receipt.previous.count - receipt.retained.count,
      `${state.stateId} exited count differs from previous minus retained`,
    );
    validateSubsetDigest({
      subset: receipt.retained,
      superset: receipt.selected,
      subsetLabel: 'retained',
      supersetLabel: 'selected',
      stateId: state.stateId,
    });
    validateSubsetDigest({
      subset: receipt.retained,
      superset: receipt.previous,
      subsetLabel: 'retained',
      supersetLabel: 'previous',
      stateId: state.stateId,
    });
    validateSubsetDigest({
      subset: receipt.entered,
      superset: receipt.selected,
      subsetLabel: 'entered',
      supersetLabel: 'selected',
      stateId: state.stateId,
    });
    validateSubsetDigest({
      subset: receipt.exited,
      superset: receipt.previous,
      subsetLabel: 'exited',
      supersetLabel: 'previous',
      stateId: state.stateId,
    });
    validateDisjointDigests({
      left: receipt.retained,
      right: receipt.entered,
      leftLabel: 'retained',
      rightLabel: 'entered',
      stateId: state.stateId,
    });
    validateDisjointDigests({
      left: receipt.retained,
      right: receipt.exited,
      leftLabel: 'retained',
      rightLabel: 'exited',
      stateId: state.stateId,
    });
    validateDisjointDigests({
      left: receipt.entered,
      right: receipt.exited,
      leftLabel: 'entered',
      rightLabel: 'exited',
      stateId: state.stateId,
    });
  }
}

function validateDepositionReceipt(state) {
  const receipt = state.depositionReceipt;
  const plan = receipt?.contributionPlan;
  const retainedWeight = receipt?.retainedQuadratureWeightFraction;
  requireContract(receipt?.depositRule === DEPOSITION_POLICY, `${state.stateId} deposit rule drift`);
  requireContract(receipt.bilinearNeighborLimit === 3, `${state.stateId} deposition neighbor limit drift`);
  requireContract(receipt.maximumDepositsPerCandidate === 15, `${state.stateId} maximum deposits drift`);
  requireContract(receipt.nominalTapEvaluationBudget === state.rowCount * 5, `${state.stateId} nominal tap budget drift`);
  requireContract(receipt.nominalDepositEvaluationBudget === state.rowCount * 20, `${state.stateId} nominal deposit budget drift`);
  requireContract(receipt.requestedChargedDepositEvaluationBudget === state.rowCount * 15, `${state.stateId} charged deposit budget drift`);
  requireContract(Number.isSafeInteger(receipt.actualInBoundsPositiveWeightDepositCount), `${state.stateId} actual deposit count is invalid`);
  requireContract(Number.isFinite(retainedWeight?.sum) && retainedWeight.sum >= 0, `${state.stateId} retained quadrature sum is invalid`);
  requireContract(
    Number.isFinite(retainedWeight.meanPerCandidate)
      && retainedWeight.meanPerCandidate >= 0
      && retainedWeight.meanPerCandidate <= 1,
    `${state.stateId} retained quadrature mean is invalid`,
  );
  requireContract(
    Number.isFinite(retainedWeight.minimumPerCandidate)
      && retainedWeight.minimumPerCandidate >= 0
      && retainedWeight.minimumPerCandidate <= 1,
    `${state.stateId} retained quadrature minimum is invalid`,
  );
  requireContract(plan?.authority === 'fixed-five-target-free-contribution-ranked-footprint-v0', `${state.stateId} contribution-plan authority drift`);
  requireContract(plan.scoreAuthority === 'local-emission-divided-by-one-plus-local-extinction-v0', `${state.stateId} contribution score drift`);
  requireContract(plan.quotaAuthority === 'projected-eight-by-eight-screen-times-eight-depth-quota-v0', `${state.stateId} quota authority drift`);
  requireContract(plan.targetUsed === false, `${state.stateId} contribution plan used a target`);
  requireContract(plan.candidateRows === state.rowCount, `${state.stateId} contribution candidate rows drift`);
  requireContract(plan.tapCount === 5 && plan.logicalTapCount === 5, `${state.stateId} tap count drift`);
  requireContract(plan.nominalTapEvaluations === state.rowCount * 5, `${state.stateId} plan tap budget drift`);
  requireContract(plan.nominalDepositEvaluations === state.rowCount * 20, `${state.stateId} plan deposit budget drift`);
  requireContract(plan.bilinearNeighborLimit === 3 && plan.maximumDepositsPerCandidate === 15, `${state.stateId} plan deposition limit drift`);
  requireContract(plan.requestedMinimumFootprintScale === 0.6875, `${state.stateId} requested footprint floor drift`);
  requireContract(plan.effectiveMinimumFootprintScale === 0.6875, `${state.stateId} effective footprint floor drift`);
  requireContract(plan.scaleDistribution?.minimum === 0.6875 && plan.scaleDistribution?.maximum === 1, `${state.stateId} footprint distribution bounds drift`);
}

export function validatePersistentSparseCohortManifest(manifest) {
  requireContract(manifest?.schema === SCHEMA, `schema drift: ${manifest?.schema ?? 'missing'}`);
  requireContract(manifest.status === 'complete' && manifest.failurePhase === null, 'manifest is incomplete');
  requireContract(manifest.authority === MANIFEST_AUTHORITY, 'manifest authority drift');
  requireContract(manifest.role === ROLE, 'manifest role drift');
  requireContract(manifest.policy === POLICY, 'manifest policy drift');
  requireContract(manifest.retargetingStatus === RETARGETING_STATUS, 'retargeting status drift');
  requireContract(manifest.source?.acceptedReportSha256 === ACCEPTED_REPORT_SHA256, 'accepted report source binding drift');
  requireContract(manifest.source?.manifestSha256 === SOURCE_MANIFEST_SHA256, 'source manifest binding drift');
  requireContract(manifest.source?.motionReportSha256 === MOTION_REPORT_SHA256, 'motion report source binding drift');
  requireContract(
    manifest.source?.implementationBundle?.authority === 'sha256-length-delimited-three-file-python-runtime-bundle-v0'
      && manifest.source.implementationBundle.payloadSource === 'captured-bound-execution'
      && manifest.source.implementationBundle.sha256 === IMPLEMENTATION_BUNDLE_SHA256,
    'implementation bundle source binding drift',
  );
  requireContract(manifest.selection?.targetPixelsUsed === false, 'target pixels were used');
  requireContract(Number.isSafeInteger(manifest.selection.candidateBudget) && manifest.selection.candidateBudget > 0, 'candidate budget is invalid');
  requireContract(manifest.selection.membershipPolicy === MEMBERSHIP_POLICY, 'membership policy drift');
  requireContract(manifest.selection.stableIdentity === 'native-cell-index', 'stable identity drift');
  requireContract(manifest.selection.temporalReceipts === 'previous-selected-retained-entered-exited-native-id-sets', 'temporal receipt identity drift');
  requireContract(exactObject(manifest.opticalOwnership, OPTICAL_OWNERSHIP), 'optical ownership drift');
  requireContract(manifest.arrayContract?.rowAlignment === 'all arrays share sourceRowIndices/nativeCellIndices order', 'row alignment drift');
  requireContract(manifest.arrayContract.consumerSelection === 'do-not-rerun-selection', 'consumer selection drift');
  requireContract(
    manifest.arrayContract.consumerDeposition === 'fixed-five-flow-taps-with-exported-footprint-scales-and-top-three-bilinear-neighbors',
    'consumer deposition drift',
  );
  const expectedDtypes = Object.fromEntries(Object.entries(ARRAY_LAYOUT).map(([name, layout]) => [name, layout.dtype]));
  requireContract(exactObject(manifest.arrayContract.dtypes, expectedDtypes), 'array dtype contract drift');
  requireContract(Array.isArray(manifest.states), 'state list is missing');
  requireContract(JSON.stringify(manifest.states.map(state => state.stateId)) === JSON.stringify(STATE_IDS), 'state identity sequence drift');
  const rowCount = manifest.selection.candidateBudget;
  for (let index = 0; index < manifest.states.length; index += 1) {
    const state = manifest.states[index];
    const expectedStep = Number(state.stateId.split('-').at(-1));
    requireContract(state.steps === expectedStep, `${state.stateId} step drift`);
    requireContract(state.rowCount === rowCount, `${state.stateId} candidate budget mismatch`);
    requireContract(Number.isSafeInteger(state.sourceRows?.count) && state.sourceRows.count >= rowCount, `${state.stateId} source row count is invalid`);
    requireContract(exactKeys(state.arrays, Object.keys(ARRAY_LAYOUT)), `${state.stateId} array set drift`);
    for (const name of Object.keys(ARRAY_LAYOUT)) validateArtifact(state, name);
    validateSelectionReceipt(state, manifest.states[index - 1]);
    validateDepositionReceipt(state);
  }
  return {
    schema: SCHEMA,
    authority: MANIFEST_AUTHORITY,
    role: ROLE,
    stateIds: [...STATE_IDS],
    rowCount,
    opticalOwnership: { ...OPTICAL_OWNERSHIP },
    sourceBinding: {
      acceptedReportSha256: ACCEPTED_REPORT_SHA256,
      sourceManifestSha256: SOURCE_MANIFEST_SHA256,
      motionReportSha256: MOTION_REPORT_SHA256,
      implementationBundleSha256: IMPLEMENTATION_BUNDLE_SHA256,
    },
  };
}

async function fetchArtifact({ manifestUrl, state, name, fetchImpl }) {
  const artifact = state.arrays[name];
  const url = new URL(artifact.path, manifestUrl).href;
  const response = await fetchImpl(url, { cache: 'no-store' });
  requireContract(response?.ok === true, `${state.stateId} ${name} fetch failed: ${response?.status ?? 'unknown'}`);
  const bytes = await response.arrayBuffer();
  requireContract(bytes.byteLength === artifact.bytes, `${state.stateId} ${name} byte length mismatch`);
  const actualSha256 = await sha256Hex(bytes);
  requireContract(actualSha256 === artifact.sha256, `${state.stateId} ${name} sha256 mismatch`);
  return { name, url, bytes, sha256: actualSha256 };
}

function decodeArrays(artifacts) {
  requireContract(HOST_LITTLE_ENDIAN, 'little-endian array decoding is unavailable on this host');
  const byName = Object.fromEntries(artifacts.map(artifact => [artifact.name, artifact.bytes]));
  return {
    sourceRowIndices: new Uint32Array(byName.sourceRowIndices),
    nativeCellIndices: new Uint32Array(byName.nativeCellIndices),
    coefficients: new Float32Array(byName.coefficients),
    kernelDescriptors: new Float32Array(byName.kernelDescriptors),
    features: new Float32Array(byName.features),
    admission: new Float32Array(byName.admission),
    footprintScales: new Float32Array(byName.footprintScales),
    depositMultiplicity: new Uint8Array(byName.depositMultiplicity),
    retainedQuadratureWeight: new Float32Array(byName.retainedQuadratureWeight),
  };
}

function auditFloatArray(values, label, { minimum = -Infinity, maximum = Infinity } = {}) {
  let nonfiniteCount = 0;
  let outOfRangeCount = 0;
  let observedMinimum = Infinity;
  let observedMaximum = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) nonfiniteCount += 1;
    else {
      observedMinimum = Math.min(observedMinimum, value);
      observedMaximum = Math.max(observedMaximum, value);
      if (value < minimum || value > maximum) outOfRangeCount += 1;
    }
  }
  requireContract(nonfiniteCount === 0, `${label} contains ${nonfiniteCount} nonfinite values`);
  requireContract(outOfRangeCount === 0, `${label} contains ${outOfRangeCount} out-of-range values`);
  return { nonfiniteCount, outOfRangeCount, observedMinimum, observedMaximum };
}

function auditDecodedState({ state, arrays }) {
  const sourceRows = new Set();
  const nativeCells = new Set();
  let sourceRowRangeErrorCount = 0;
  let kernelNativeCellMismatchCount = 0;
  for (let row = 0; row < state.rowCount; row += 1) {
    const sourceRow = arrays.sourceRowIndices[row];
    const nativeCell = arrays.nativeCellIndices[row];
    if (sourceRow >= state.sourceRows.count) sourceRowRangeErrorCount += 1;
    sourceRows.add(sourceRow);
    nativeCells.add(nativeCell);
    if (arrays.kernelDescriptors[row * 8 + 3] !== nativeCell) kernelNativeCellMismatchCount += 1;
  }
  requireContract(sourceRowRangeErrorCount === 0, `${state.stateId} source-row indices contain ${sourceRowRangeErrorCount} range errors`);
  requireContract(sourceRows.size === state.rowCount, `${state.stateId} source-row indices contain duplicates`);
  requireContract(nativeCells.size === state.rowCount, `${state.stateId} native-cell indices contain duplicates`);
  requireContract(kernelNativeCellMismatchCount === 0, `${state.stateId} kernel/native-cell row alignment has ${kernelNativeCellMismatchCount} mismatches`);
  auditFloatArray(arrays.coefficients, `${state.stateId} coefficients`, { minimum: 0 });
  auditFloatArray(arrays.kernelDescriptors, `${state.stateId} kernel descriptors`);
  auditFloatArray(arrays.features, `${state.stateId} features`);
  auditFloatArray(arrays.admission, `${state.stateId} admission`, { minimum: 0, maximum: 1 });
  auditFloatArray(arrays.footprintScales, `${state.stateId} footprint scales`, { minimum: 0.6875, maximum: 1 });
  const retainedQuadratureWeight = auditFloatArray(
    arrays.retainedQuadratureWeight,
    `${state.stateId} retained quadrature weights`,
    { minimum: 0, maximum: RETAINED_WEIGHT_MAXIMUM },
  );
  let depositionRangeErrorCount = 0;
  for (const count of arrays.depositMultiplicity) {
    if (count > 15) depositionRangeErrorCount += 1;
  }
  requireContract(depositionRangeErrorCount === 0, `${state.stateId} deposit multiplicity contains ${depositionRangeErrorCount} values above 15`);
  return {
    sourceRowDistinctCount: sourceRows.size,
    nativeCellDistinctCount: nativeCells.size,
    sourceRowRangeErrorCount,
    kernelNativeCellMismatchCount,
    depositionRangeErrorCount,
    retainedQuadratureWeight,
    retainedQuadratureWeightMaximumTolerance: RETAINED_WEIGHT_MAXIMUM,
  };
}

export async function loadPersistentSparseCohortState({
  manifestUrl,
  expectedManifestSha256,
  stateId,
  fetchImpl = globalThis.fetch,
} = {}) {
  requireContract(typeof manifestUrl === 'string' && manifestUrl.length > 0, 'manifest URL is required');
  requireContract(validSha256(expectedManifestSha256), 'expected manifest sha256 is required');
  requireContract(STATE_IDS.includes(stateId), `unsupported requested state: ${stateId ?? 'missing'}`);
  requireContract(typeof fetchImpl === 'function', 'fetch implementation is required');
  const response = await fetchImpl(manifestUrl, { cache: 'no-store' });
  requireContract(response?.ok === true, `manifest fetch failed: ${response?.status ?? 'unknown'}`);
  const manifestBytes = await response.arrayBuffer();
  const actualManifestSha256 = await sha256Hex(manifestBytes);
  requireContract(
    actualManifestSha256 === expectedManifestSha256,
    `manifest sha256 mismatch: ${actualManifestSha256} != ${expectedManifestSha256}`,
  );
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch (error) {
    throw new Error(`persistent sparse cohort manifest JSON parse failed: ${error?.message || String(error)}`);
  }
  const manifestReceipt = validatePersistentSparseCohortManifest(manifest);
  const state = manifest.states.find(candidate => candidate.stateId === stateId);
  requireContract(state, `requested state is absent: ${stateId}`);
  const artifacts = await Promise.all(Object.keys(ARRAY_LAYOUT).map(name => (
    fetchArtifact({ manifestUrl, state, name, fetchImpl })
  )));
  const arrays = decodeArrays(artifacts);
  const audit = auditDecodedState({ state, arrays });
  return {
    arrays,
    receipt: {
      identity: 'persistent-sparse-cohort-state-load-receipt-v0',
      status: 'complete',
      authority: LOADER_AUTHORITY,
      manifestUrl,
      manifestSha256: actualManifestSha256,
      manifestAuthority: manifestReceipt.authority,
      role: manifestReceipt.role,
      stateId,
      steps: state.steps,
      rowCount: state.rowCount,
      rowCap: null,
      droppedRowCount: 0,
      selectorRerun: false,
      selectionAuthority: state.selectionReceipt.authority,
      selectionApplication: 'producer-authenticated-no-consumer-rerun-v0',
      temporalSetValidation: 'source-authenticated-receipt-algebra-no-consumer-set-replay-v0',
      depositionAuthority: state.depositionReceipt.depositRule,
      retargetingStatus: manifest.retargetingStatus,
      opticalOwnership: { ...OPTICAL_OWNERSHIP },
      sourceBinding: { ...manifestReceipt.sourceBinding },
      rowAlignmentAuthority: 'producer-declared-common-order-checksum-bound-v0',
      rowAlignmentValidation: {
        producerContract: manifest.arrayContract.rowAlignment,
        independentlyDecodedWitnesses: [
          'distinct-source-row-and-native-cell-identities-v0',
          'kernel-descriptor-native-cell-column-v0',
        ],
        checksumBoundOnlyArrays: [
          'coefficients',
          'features',
          'admission',
          'footprintScales',
          'depositMultiplicity',
          'retainedQuadratureWeight',
        ],
      },
      hostEndianness: 'little',
      rendererApplied: false,
      rendererApplicationReason: 'validated-resources-loaded-awaiting-explicit-gpu-consumer',
      audit,
      artifacts: Object.fromEntries(artifacts.map(artifact => [artifact.name, {
        url: artifact.url,
        bytes: artifact.bytes.byteLength,
        sha256: artifact.sha256,
      }])),
    },
  };
}
