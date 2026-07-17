export const ADAPTIVE_VOLUME_GPU_REPORT_SCHEMA = 'kaminos.smoke-adaptive-volume-gpu-falsifier.v0';
export const ADAPTIVE_VOLUME_GPU_ROUTE = 'isolated-adaptive-volume-webgpu-v0';
export const COMPACT_SMOKE_PRODUCT_IDENTITY = 'compact-parent-mean-halo-atlas-v0';
export const DENSE_DENIAL_METHOD = 'destroy-dense-source-before-compact-rerender-v0';
export const ADAPTIVE_VOLUME_GPU_ERROR_LIMITS = Object.freeze({
  denseAgainstCommittedReferenceMaximumAbsoluteError: 1e-5,
  compactPrebuiltAgainstDenseMaximumAbsoluteError: 1e-3,
  buildCompactAgainstDenseMaximumAbsoluteError: 1e-3,
});

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

function cellIndex(x, y, z, grid) {
  return x + y * grid + z * grid * grid;
}

function brickCoordinates(index, coarseGrid) {
  return [index % coarseGrid, Math.floor(index / coarseGrid) % coarseGrid, Math.floor(index / (coarseGrid ** 2))];
}

function brickIndexForCell(x, y, z, grid, blockSize) {
  const coarseGrid = grid / blockSize;
  return Math.floor(x / blockSize)
    + Math.floor(y / blockSize) * coarseGrid
    + Math.floor(z / blockSize) * coarseGrid ** 2;
}

export function parseSelectedBrickArtifact(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.byteLength < 8) throw new Error('SBRK artifact is partial');
  if (String.fromCharCode(...view.subarray(0, 4)) !== 'SBRK') throw new Error('SBRK artifact header mismatch');
  const data = new DataView(view.buffer, view.byteOffset, view.byteLength);
  const count = data.getUint32(4, true);
  if (view.byteLength !== 8 + count * 4) throw new Error('SBRK artifact byte length mismatch');
  const indices = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) indices[index] = data.getUint32(8 + index * 4, true);
  for (let index = 1; index < indices.length; index += 1) {
    if (!(indices[index] > indices[index - 1])) throw new Error('SBRK indices must be unique and sorted');
  }
  return indices;
}

export function buildBitonicSortStages(count) {
  const size = positiveInteger(count, 'count');
  if ((size & (size - 1)) !== 0) throw new Error('bitonic sort count must be a power of two');
  const stages = [];
  for (let k = 2; k <= size; k *= 2) {
    for (let j = k / 2; j >= 1; j /= 2) stages.push([j, k, size, 0]);
  }
  return stages;
}

export function bitonicSortRecordCount(count) {
  const size = positiveInteger(count, 'count');
  return 2 ** Math.ceil(Math.log2(size));
}

export function buildCompactSmokeProduct({ source, grid, blockSize, selectedBrickIndices } = {}) {
  const size = positiveInteger(grid, 'grid');
  const block = positiveInteger(blockSize, 'blockSize');
  if (size % block !== 0) throw new Error('blockSize must divide grid');
  if (!(source instanceof Float32Array) || source.length !== size ** 3) throw new Error('dense source shape mismatch');
  if (!(selectedBrickIndices instanceof Uint32Array) && !Array.isArray(selectedBrickIndices)) {
    throw new Error('selectedBrickIndices must be an array or Uint32Array');
  }
  const selected = Uint32Array.from(selectedBrickIndices);
  const coarseGrid = size / block;
  const brickCount = coarseGrid ** 3;
  for (let index = 0; index < selected.length; index += 1) {
    if (selected[index] >= brickCount) throw new Error(`selected brick ${selected[index]} is outside ${brickCount}`);
    if (index > 0 && !(selected[index] > selected[index - 1])) throw new Error('selected brick indices must be unique and sorted');
  }

  const coarseValues = new Float32Array(brickCount);
  for (let z = 0; z < size; z += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        coarseValues[brickIndexForCell(x, y, z, size, block)] += source[cellIndex(x, y, z, size)];
      }
    }
  }
  const cellsPerBrick = block ** 3;
  for (let index = 0; index < coarseValues.length; index += 1) coarseValues[index] /= cellsPerBrick;

  const indirection = new Int32Array(brickCount);
  indirection.fill(-1);
  for (let slot = 0; slot < selected.length; slot += 1) indirection[selected[slot]] = slot;
  const haloEdge = block + 2;
  const atlasCellsPerBrick = haloEdge ** 3;
  const atlasValues = new Float32Array(selected.length * atlasCellsPerBrick);
  for (let slot = 0; slot < selected.length; slot += 1) {
    const [bx, by, bz] = brickCoordinates(selected[slot], coarseGrid);
    for (let hz = 0; hz < haloEdge; hz += 1) {
      for (let hy = 0; hy < haloEdge; hy += 1) {
        for (let hx = 0; hx < haloEdge; hx += 1) {
          const x = Math.max(0, Math.min(size - 1, bx * block + hx - 1));
          const y = Math.max(0, Math.min(size - 1, by * block + hy - 1));
          const z = Math.max(0, Math.min(size - 1, bz * block + hz - 1));
          const atlasIndex = slot * atlasCellsPerBrick + hx + hy * haloEdge + hz * haloEdge ** 2;
          atlasValues[atlasIndex] = source[cellIndex(x, y, z, size)];
        }
      }
    }
  }

  const allocationBytes = {
    coarse: coarseValues.byteLength,
    indirection: indirection.byteLength,
    fineAtlas: atlasValues.byteLength,
    total: coarseValues.byteLength + indirection.byteLength + atlasValues.byteLength,
  };
  return {
    identity: COMPACT_SMOKE_PRODUCT_IDENTITY,
    grid: size,
    blockSize: block,
    coarseGrid,
    brickCount,
    selectedBrickCount: selected.length,
    haloEdge,
    atlasCellsPerBrick,
    selectedBrickIndices: selected,
    coarseValues,
    indirection,
    atlasValues,
    allocationBytes,
    denseSourceRetained: false,
  };
}

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function finiteNonNegative(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function identityEvidenceText(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return '';
  }
}

function hasAppleAdapterEvidence(adapterInfo) {
  return identityEvidenceText(adapterInfo).includes('apple');
}

function hasAppleCdpEvidence(cdpGpuInfo) {
  if (cdpGpuInfo?.source !== 'cdp-system-info'
    || cdpGpuInfo?.appleDeviceObserved !== true
    || !Array.isArray(cdpGpuInfo?.devices)
    || cdpGpuInfo.devices.length === 0) return false;
  return cdpGpuInfo.devices.some(device => {
    const text = identityEvidenceText(device);
    return text.includes('apple') && text.includes('metal');
  });
}

export function validateAdaptiveVolumeGpuReport(report) {
  const reasons = [];
  const isSha256 = value => typeof value === 'string' && /^sha256:[0-9a-f]+$/i.test(value);
  if (report?.schema !== ADAPTIVE_VOLUME_GPU_REPORT_SCHEMA) reasons.push('schema-mismatch');
  if (report?.status !== 'passed') reasons.push('report-not-passed');
  if (report?.effective?.route !== ADAPTIVE_VOLUME_GPU_ROUTE) reasons.push('effective-route-mismatch');
  if (report?.effective?.backend !== 'WebGPU:apple') reasons.push('effective-backend-mismatch');
  const backendIdentitySource = report?.effective?.backendIdentitySource;
  if (!['adapter-info', 'cdp-system-info'].includes(backendIdentitySource)) {
    reasons.push('backend-identity-authority-missing');
  } else if (backendIdentitySource === 'adapter-info' && !hasAppleAdapterEvidence(report?.effective?.adapterInfo)) {
    reasons.push('backend-identity-evidence-invalid:adapter-info');
  } else if (backendIdentitySource === 'cdp-system-info' && !hasAppleCdpEvidence(report?.effective?.cdpGpuInfo)) {
    reasons.push('backend-identity-evidence-invalid:cdp-system-info');
  }
  if (report?.effective?.timestampFeature !== 'timestamp-query' || report?.effective?.timestampStatus !== 'available') reasons.push('timestamp-authority-missing');
  if (report?.requested?.hiddenBrickCapApplied !== false) reasons.push('hidden-cap');
  for (const key of ['matchedReportSha256', 'fitReportSha256', 'sourceSidecarSha256', 'selectionArtifactSha256', 'referenceDepthSha256']) {
    if (!isSha256(report?.source?.[key])) reasons.push(`source-identity-missing:${key}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(report?.runtime?.gitCommit || '') || typeof report?.runtime?.gitBranch !== 'string' || !report.runtime.gitBranch) {
    reasons.push('git-identity-missing');
  }
  for (const key of ['module', 'browser', 'witness', 'html']) {
    if (!isSha256(report?.runtime?.sourceFileSha256s?.[key])) reasons.push(`source-file-identity-missing:${key}`);
  }
  if (!finitePositive(report?.arms?.dense?.gpuMs) || report?.arms?.dense?.outputComplete !== true) reasons.push('dense-arm-incomplete');
  if (!finitePositive(report?.arms?.compactPrebuilt?.gpuMs) || report?.arms?.compactPrebuilt?.outputComplete !== true) reasons.push('compact-prebuilt-arm-incomplete');
  if (!finitePositive(report?.arms?.buildCompactRender?.buildGpuMs)
    || !finitePositive(report?.arms?.buildCompactRender?.renderGpuMs)
    || !finitePositive(report?.arms?.buildCompactRender?.totalGpuMs)
    || report?.arms?.buildCompactRender?.outputComplete !== true) reasons.push('build-compact-arm-incomplete');
  if (report?.arms?.compactPrebuilt?.denseBindingCount !== 0 || report?.arms?.buildCompactRender?.denseBindingCountDuringRender !== 0) reasons.push('hidden-dense-binding');
  if (report?.compactProduct?.hiddenDenseAllocationBytes !== 0) reasons.push('hidden-dense-allocation');
  if (report?.compactProduct?.allocationComplete !== true || !finitePositive(report?.compactProduct?.allocationBytes?.total)) reasons.push('allocation-incomplete');
  if (report?.compactProduct?.selectionMismatchCount !== 0) reasons.push('stale-selection');
  if (report?.compactProduct?.sortOrderViolationCount !== 0) reasons.push('sort-order-invalid');
  if (report?.denseDenial?.method !== DENSE_DENIAL_METHOD
    || report?.denseDenial?.passed !== true
    || report?.denseDenial?.preDenialOutputSha256 !== report?.denseDenial?.postDenialOutputSha256
    || Number(report?.denseDenial?.maximumAbsoluteOutputDelta) !== 0) reasons.push('dense-denial-failed');
  if (report?.validation?.complete !== true) reasons.push('validation-incomplete');
  for (const [key, limit] of Object.entries(ADAPTIVE_VOLUME_GPU_ERROR_LIMITS)) {
    if (Number(report?.validation?.thresholds?.[key]) !== limit) reasons.push(`numerical-threshold-mismatch:${key}`);
  }
  const numericalChecks = [
    ['dense-reference-error', report?.validation?.denseAgainstCommittedReference?.maximumAbsoluteError, ADAPTIVE_VOLUME_GPU_ERROR_LIMITS.denseAgainstCommittedReferenceMaximumAbsoluteError],
    ['compact-prebuilt-error', report?.validation?.compactPrebuiltAgainstDense?.maximumAbsoluteError, ADAPTIVE_VOLUME_GPU_ERROR_LIMITS.compactPrebuiltAgainstDenseMaximumAbsoluteError],
    ['build-compact-error', report?.validation?.buildCompactAgainstDense?.maximumAbsoluteError, ADAPTIVE_VOLUME_GPU_ERROR_LIMITS.buildCompactAgainstDenseMaximumAbsoluteError],
  ];
  for (const [reason, value, limit] of numericalChecks) {
    if (!finiteNonNegative(value) || Number(value) > limit) reasons.push(reason);
  }
  for (const [name, value] of Object.entries(report?.falseClosureChecks || {})) {
    if (value) reasons.push(`false-closure:${name}`);
  }
  return { optimizationClaimAllowed: reasons.length === 0, reasons };
}
