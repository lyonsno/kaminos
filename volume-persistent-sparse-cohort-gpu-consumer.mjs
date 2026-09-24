export const PERSISTENT_COHORT_GPU_ROW_FLOATS = 24;
export const PERSISTENT_COHORT_GPU_SOURCE_AUTHORITY = 'authenticated-persistent-sparse-cohort-gpu-source-v0';
export const PERSISTENT_COHORT_DEPOSITION_AUTHORITY = 'contribution-ranked-five-flow-taps-variable-footprint-top-three-of-four-bilinear-neighbors-renormalized-clipped-to-frame-v0';

const LOADER_RECEIPT_IDENTITY = 'persistent-sparse-cohort-state-load-receipt-v0';
const LOADER_AUTHORITY = 'checksum-bound-authenticated-persistent-sparse-cohort-loader-v0';
const OPTICAL_OWNERSHIP_AUTHORITY = 'complementary-local-optical-coefficient-ownership-v0';
const ARRAY_WIDTHS = Object.freeze({
  sourceRowIndices: 1,
  nativeCellIndices: 1,
  coefficients: 8,
  kernelDescriptors: 8,
  features: 24,
  admission: 2,
  footprintScales: 1,
  depositMultiplicity: 1,
  retainedQuadratureWeight: 1,
});

function requireContract(condition, message) {
  if (!condition) throw new Error(`persistent sparse cohort GPU consumer ${message}`);
}

function validateReceipt(receipt) {
  requireContract(receipt?.identity === LOADER_RECEIPT_IDENTITY, 'loader receipt identity drift');
  requireContract(receipt.status === 'complete' && receipt.authority === LOADER_AUTHORITY, 'authenticated complete loader receipt is required');
  requireContract(Number.isSafeInteger(receipt.rowCount) && receipt.rowCount > 0, 'row count is invalid');
  requireContract(receipt.rowCap === null, 'row cap is forbidden');
  requireContract(receipt.droppedRowCount === 0, 'dropped rows are forbidden');
  requireContract(receipt.selectorRerun === false, 'selector rerun is forbidden');
  requireContract(receipt.depositionAuthority === PERSISTENT_COHORT_DEPOSITION_AUTHORITY, 'deposition authority drift');
  const ownership = receipt.opticalOwnership;
  requireContract(
    ownership?.authority === OPTICAL_OWNERSHIP_AUTHORITY
      && ownership.splatEmission === 'w_j * j'
      && ownership.residualEmission === '(1 - w_j) * j'
      && ownership.splatExtinction === 'w_sigma * sigma'
      && ownership.residualExtinction === '(1 - w_sigma) * sigma'
      && ownership.duplicationForbidden === true
      && ownership.imageResidualForbidden === true,
    'optical ownership drift',
  );
  requireContract(receipt.rendererApplied === false, 'loader receipt falsely claims renderer application');
}

function validateArrays(arrays, rowCount) {
  requireContract(arrays && typeof arrays === 'object', 'decoded arrays are required');
  for (const [name, width] of Object.entries(ARRAY_WIDTHS)) {
    requireContract(ArrayBuffer.isView(arrays[name]), `${name} array is missing`);
    requireContract(arrays[name].length === rowCount * width, `${name} length mismatch`);
  }
}

export function packPersistentSparseCohortGpuRows({ arrays, receipt } = {}) {
  validateReceipt(receipt);
  const rowCount = receipt.rowCount;
  validateArrays(arrays, rowCount);
  const rows = new Float32Array(rowCount * PERSISTENT_COHORT_GPU_ROW_FLOATS);
  let kernelNativeCellMismatchCount = 0;
  for (let row = 0; row < rowCount; row += 1) {
    const sourceOffset = row * 8;
    const featureOffset = row * 24;
    const outputOffset = row * PERSISTENT_COHORT_GPU_ROW_FLOATS;
    const nativeCellIndex = arrays.nativeCellIndices[row];
    if (arrays.kernelDescriptors[sourceOffset + 3] !== nativeCellIndex) kernelNativeCellMismatchCount += 1;
    const baseRadius = (2 / 160) * (
      0.60
      + arrays.features[featureOffset + 3] * 2.65
      + arrays.features[featureOffset + 2] * 0.48
    );
    rows.set([
      arrays.kernelDescriptors[sourceOffset],
      arrays.kernelDescriptors[sourceOffset + 1],
      arrays.kernelDescriptors[sourceOffset + 2],
      Math.max(arrays.admission[row * 2], arrays.admission[row * 2 + 1]),
      arrays.coefficients[sourceOffset],
      arrays.coefficients[sourceOffset + 1],
      arrays.coefficients[sourceOffset + 2],
      arrays.coefficients[sourceOffset + 3],
      baseRadius,
      arrays.footprintScales[row],
      arrays.retainedQuadratureWeight[row],
      arrays.depositMultiplicity[row],
      arrays.kernelDescriptors[sourceOffset + 4],
      arrays.kernelDescriptors[sourceOffset + 5],
      arrays.kernelDescriptors[sourceOffset + 6],
      arrays.kernelDescriptors[sourceOffset + 7],
      arrays.coefficients[sourceOffset + 4],
      arrays.coefficients[sourceOffset + 5],
      arrays.coefficients[sourceOffset + 6],
      arrays.coefficients[sourceOffset + 7],
      nativeCellIndex,
      arrays.admission[row * 2],
      arrays.admission[row * 2 + 1],
      arrays.sourceRowIndices[row],
    ], outputOffset);
  }
  requireContract(kernelNativeCellMismatchCount === 0, `kernel native-cell mismatch count ${kernelNativeCellMismatchCount}`);
  return {
    rows,
    receipt: {
      identity: 'persistent-sparse-cohort-gpu-pack-receipt-v0',
      status: 'complete',
      sourceAuthority: PERSISTENT_COHORT_GPU_SOURCE_AUTHORITY,
      manifestUrl: receipt.manifestUrl,
      manifestSha256: receipt.manifestSha256,
      stateId: receipt.stateId,
      steps: receipt.steps,
      requestedRowCount: rowCount,
      encodedRowCount: rowCount,
      rowStrideFloats: PERSISTENT_COHORT_GPU_ROW_FLOATS,
      rowStrideBytes: PERSISTENT_COHORT_GPU_ROW_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      uploadBytes: rows.byteLength,
      rowCap: null,
      droppedRowCount: 0,
      selectorRerun: false,
      depositionAuthority: receipt.depositionAuthority,
      depositsPerCandidate: 15,
      requestedDepositCount: rowCount * 15,
      coefficientOwnership: 'exact-exported-complementary-splat-share-v0',
      opticalOwnership: { ...receipt.opticalOwnership },
      rendererRequested: true,
      rendererEncoded: false,
      rendererApplied: false,
      fallbackReason: null,
    },
  };
}
