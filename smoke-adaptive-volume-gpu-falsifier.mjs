export const ADAPTIVE_VOLUME_GPU_REPORT_SCHEMA = 'kaminos.smoke-adaptive-volume-gpu-falsifier.v0';
export const ADAPTIVE_VOLUME_GPU_ROUTE = 'isolated-adaptive-volume-webgpu-v0';
export const ADAPTIVE_VOLUME_SCALE_LAW_SCHEMA = 'kaminos.smoke-adaptive-volume-scale-law.v0';
export const ADAPTIVE_VOLUME_PRODUCTION_SURVIVAL_SCHEMA = 'kaminos.smoke-adaptive-volume-production-survival.v0';
export const COMPACT_SMOKE_PRODUCT_IDENTITY = 'compact-parent-mean-halo-atlas-v0';
export const DENSE_DENIAL_METHOD = 'destroy-dense-source-before-compact-rerender-v0';
export const ADAPTIVE_VOLUME_GPU_ERROR_LIMITS = Object.freeze({
  denseAgainstCommittedReferenceMaximumAbsoluteError: 1e-5,
  compactPrebuiltAgainstDenseMaximumAbsoluteError: 1e-3,
  buildCompactAgainstDenseMaximumAbsoluteError: 1e-3,
});
export const FULL_SELECTION_AGAINST_DENSE_MAXIMUM_ABSOLUTE_ERROR = 1e-5;

function isSha256Digest(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/i.test(value);
}

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

function hasPositiveIdentityToken(value, token) {
  if (typeof value !== 'string') return false;
  const text = value.trim().toLowerCase();
  const identityToken = token.toLowerCase();
  if (!new RegExp(`\\b${identityToken}\\b`).test(text)) return false;
  return !new RegExp(`\\b(?:not|no|non|without)\\b(?:\\s+\\w+){0,2}\\s+${identityToken}\\b`).test(text)
    && !new RegExp(`\\bnon[-_]${identityToken}\\b`).test(text);
}

function hasAppleAdapterEvidence(adapterInfo) {
  if (!adapterInfo || typeof adapterInfo !== 'object' || Array.isArray(adapterInfo)) return false;
  return ['vendor', 'architecture', 'device', 'description']
    .some(field => hasPositiveIdentityToken(adapterInfo[field], 'apple'));
}

function hasAppleCdpEvidence(cdpGpuInfo) {
  if (cdpGpuInfo?.source !== 'cdp-system-info'
    || cdpGpuInfo?.appleDeviceObserved !== true
    || !Array.isArray(cdpGpuInfo?.devices)
    || cdpGpuInfo.devices.length === 0) return false;
  return cdpGpuInfo.devices.some(device => device && typeof device === 'object' && !Array.isArray(device)
    && [device.vendorString, device.driverVendor].some(value => hasPositiveIdentityToken(value, 'apple'))
    && hasPositiveIdentityToken(device.deviceString, 'apple')
    && hasPositiveIdentityToken(device.deviceString, 'metal'));
}

export function validateAdaptiveVolumeGpuReport(report) {
  const reasons = [];
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
    if (!isSha256Digest(report?.source?.[key])) reasons.push(`source-identity-missing:${key}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(report?.runtime?.gitCommit || '') || typeof report?.runtime?.gitBranch !== 'string' || !report.runtime.gitBranch) {
    reasons.push('git-identity-missing');
  }
  for (const key of ['module', 'browser', 'witness', 'html', 'productionVolume']) {
    if (!isSha256Digest(report?.runtime?.sourceFileSha256s?.[key])) reasons.push(`source-file-identity-missing:${key}`);
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

export function validateAdaptiveVolumeScaleLawReport(report) {
  const reasons = [];
  const base = validateAdaptiveVolumeGpuReport(report);
  if (!base.optimizationClaimAllowed) reasons.push(...base.reasons.map(reason => `base:${reason}`));
  const scaleLaw = report?.scaleLaw;
  if (scaleLaw?.schema !== ADAPTIVE_VOLUME_SCALE_LAW_SCHEMA) reasons.push('scale-law-schema-mismatch');
  if (scaleLaw?.status !== 'passed') reasons.push('scale-law-not-passed');
  if (scaleLaw?.requested?.hiddenWorkloadCapApplied !== false) reasons.push('scale-law-hidden-workload-cap');
  const dispatchRepeats = Number(scaleLaw?.requested?.dispatchRepeats);
  const steadySamples = Number(scaleLaw?.requested?.steadySamples);
  const minimumAggregateGpuMs = Number(scaleLaw?.requested?.minimumAggregateGpuMs);
  if (!Number.isInteger(dispatchRepeats) || dispatchRepeats <= 1) reasons.push('scale-law-timing-amplification-missing');
  if (!Number.isInteger(steadySamples) || steadySamples < 3) reasons.push('scale-law-steady-samples-invalid');
  if (!finitePositive(minimumAggregateGpuMs)) reasons.push('scale-law-aggregate-floor-missing');
  const workloads = scaleLaw?.effective?.workloads;
  if (!Array.isArray(workloads) || workloads.length < 3) {
    reasons.push('scale-law-workload-surface-incomplete');
  } else {
    let previousPixels = 0;
    for (const [index, workload] of workloads.entries()) {
      const prefix = `scale-law-workload-${index}`;
      const width = Number(workload?.width);
      const height = Number(workload?.height);
      const pixelCount = Number(workload?.pixelCount);
      const intersectingRayCount = Number(workload?.intersectingRayCount);
      const denseStepCount = Number(workload?.denseStepCount);
      if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 || pixelCount !== width * height) reasons.push(`${prefix}:shape-invalid`);
      if (!(pixelCount > previousPixels)) reasons.push(`${prefix}:pixel-scale-not-increasing`);
      previousPixels = pixelCount;
      if (!Number.isInteger(intersectingRayCount) || intersectingRayCount <= 0 || intersectingRayCount > pixelCount) reasons.push(`${prefix}:ray-coverage-invalid`);
      if (!Number.isInteger(denseStepCount) || denseStepCount < intersectingRayCount) reasons.push(`${prefix}:dense-step-count-invalid`);
      if (Number(workload?.dispatchRepeats) !== dispatchRepeats) reasons.push(`${prefix}:dispatch-repeat-mismatch`);
      if (workload?.timingProtocol !== 'paired-alternating-submit-v0' || Number(workload?.submissionCountPerPair) !== 2) reasons.push(`${prefix}:timing-protocol-invalid`);
      const pairedSamples = workload?.pairedSamples;
      if (!Array.isArray(pairedSamples) || pairedSamples.length !== steadySamples) {
        reasons.push(`${prefix}:paired-samples-incomplete`);
      } else {
        for (const [sampleIndex, sample] of pairedSamples.entries()) {
          const expectedOrder = sampleIndex % 2 === 0 ? 'dense-compact' : 'compact-dense';
          if (sample?.order !== expectedOrder) reasons.push(`${prefix}:paired-order-invalid`);
          if (!finitePositive(sample?.denseAggregateGpuMs)
            || !finitePositive(sample?.compactAggregateGpuMs)
            || !finitePositive(sample?.compactOverDenseRatio)) reasons.push(`${prefix}:paired-timing-invalid`);
        }
        const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
        const denseMedian = median(pairedSamples.map(sample => Number(sample.denseAggregateGpuMs)));
        const compactMedian = median(pairedSamples.map(sample => Number(sample.compactAggregateGpuMs)));
        const ratioMedian = median(pairedSamples.map(sample => Number(sample.compactOverDenseRatio)));
        const denseCompactRatioMedian = median(pairedSamples.filter(sample => sample.order === 'dense-compact').map(sample => Number(sample.compactOverDenseRatio)));
        const compactDenseRatioMedian = median(pairedSamples.filter(sample => sample.order === 'compact-dense').map(sample => Number(sample.compactOverDenseRatio)));
        if (Number(workload?.profiles?.dense?.aggregate?.median) !== denseMedian
          || Number(workload?.profiles?.compact?.aggregate?.median) !== compactMedian
          || Number(workload?.profiles?.dense?.perDispatch?.median) !== denseMedian / dispatchRepeats
          || Number(workload?.profiles?.compact?.perDispatch?.median) !== compactMedian / dispatchRepeats
          || Number(workload?.pairedRatio?.median) !== ratioMedian
          || Number(workload?.pairedRatioByOrder?.denseCompact?.median) !== denseCompactRatioMedian
          || Number(workload?.pairedRatioByOrder?.compactDense?.median) !== compactDenseRatioMedian
          || Number(workload?.compactOverDenseRatio) !== ratioMedian) reasons.push(`${prefix}:paired-summary-mismatch`);
      }
      for (const arm of ['dense', 'compact']) {
        const profile = workload?.profiles?.[arm];
        if (!finitePositive(profile?.aggregate?.median) || profile.aggregate.median < minimumAggregateGpuMs) reasons.push(`${prefix}:${arm}-aggregate-below-floor`);
        if (!finitePositive(profile?.perDispatch?.median)) reasons.push(`${prefix}:${arm}-per-dispatch-invalid`);
      }
      if (!finiteNonNegative(workload?.comparison?.maximumAbsoluteError)
        || Number(workload.comparison.maximumAbsoluteError) > ADAPTIVE_VOLUME_GPU_ERROR_LIMITS.compactPrebuiltAgainstDenseMaximumAbsoluteError) {
        reasons.push(`${prefix}:output-error`);
      }
      const comparison = workload?.comparison;
      const quantiles = comparison?.absoluteErrorQuantiles;
      if (!finiteNonNegative(comparison?.meanSquaredError)
        || !finiteNonNegative(comparison?.meanAbsoluteError)
        || !Number.isFinite(Number(comparison?.maximumPair?.left))
        || !Number.isFinite(Number(comparison?.maximumPair?.right))
        || Number(comparison?.sampleCount) !== pixelCount
        || !Number.isInteger(Number(comparison?.maximumAbsoluteErrorIndex))
        || Number(comparison.maximumAbsoluteErrorIndex) < 0
        || Number(comparison.maximumAbsoluteErrorIndex) >= pixelCount
        || Number(comparison?.maximumAbsoluteErrorPixel?.x) !== Number(comparison.maximumAbsoluteErrorIndex) % width
        || Number(comparison?.maximumAbsoluteErrorPixel?.y) !== Math.floor(Number(comparison.maximumAbsoluteErrorIndex) / width)) {
        reasons.push(`${prefix}:error-location-invalid`);
      }
      if (![quantiles?.p99, quantiles?.p999, quantiles?.p9999].every(finiteNonNegative)
        || !(Number(quantiles.p99) <= Number(quantiles.p999))
        || !(Number(quantiles.p999) <= Number(quantiles.p9999))
        || !(Number(quantiles.p9999) <= Number(comparison?.maximumAbsoluteError))) reasons.push(`${prefix}:error-quantiles-invalid`);
      const aboveLimitCount = Number(comparison?.aboveErrorLimitCount);
      if (Number(comparison?.errorLimit) !== ADAPTIVE_VOLUME_GPU_ERROR_LIMITS.compactPrebuiltAgainstDenseMaximumAbsoluteError
        || !Number.isInteger(aboveLimitCount)
        || aboveLimitCount < 0
        || aboveLimitCount > pixelCount
        || Math.abs(Number(comparison?.aboveErrorLimitFraction) - aboveLimitCount / pixelCount) > 1e-12
        || (Number(comparison?.maximumAbsoluteError) > Number(comparison?.errorLimit)) !== (aboveLimitCount > 0)) {
        reasons.push(`${prefix}:error-exceedance-invalid`);
      }
    }
  }
  const displayResolution = scaleLaw?.requested?.displayResolution;
  if (displayResolution != null) {
    const displayWidth = Number(displayResolution?.width);
    const displayHeight = Number(displayResolution?.height);
    const displayPixels = Number(displayResolution?.pixelCount);
    if (displayResolution?.authority !== 'system-profiler-liquid-retina-xdr-device-pixels-v0') reasons.push('display-resolution-authority-mismatch');
    if (displayResolution?.hiddenResolutionCapApplied !== false) reasons.push('display-resolution-hidden-cap');
    if (displayWidth !== 3456 || displayHeight !== 2234 || displayPixels !== displayWidth * displayHeight) reasons.push('display-resolution-identity-mismatch');
    const finalWorkload = Array.isArray(workloads) ? workloads.at(-1) : null;
    if (Number(finalWorkload?.width) !== displayWidth
      || Number(finalWorkload?.height) !== displayHeight
      || Number(finalWorkload?.pixelCount) !== displayPixels
      || !(Number(finalWorkload?.intersectingRayCount) > 0)
      || !(Number(finalWorkload?.denseStepCount) >= Number(finalWorkload?.intersectingRayCount))) {
      reasons.push('display-resolution-workload-mismatch');
    }
  }
  if (Number(report?.compactProduct?.selectedBrickCount) === Number(report?.effective?.physicalBrickCount)
    && Array.isArray(workloads)
    && workloads.some(workload => Number(workload?.comparison?.maximumAbsoluteError) > FULL_SELECTION_AGAINST_DENSE_MAXIMUM_ABSOLUTE_ERROR)) {
    reasons.push('full-selection-parity-error');
  }
  const attribution = scaleLaw?.productionAttribution;
  if (attribution?.authority !== 'static-production-shader-source-inspection-v0') reasons.push('production-attribution-authority-missing');
  if (attribution?.measuredProductionBottleneck !== false) reasons.push('production-attribution-overclaim');
  if (!isSha256Digest(attribution?.sourceSha256)) reasons.push('production-attribution-source-missing');
  if (attribution?.sourceSha256 !== report?.runtime?.sourceFileSha256s?.productionVolume) reasons.push('production-attribution-source-mismatch');
  for (const mechanism of ['majorant-grid', 'occupancy-skip', 'adaptive-rays', 'early-transmittance', 'five-live-field-samples']) {
    if (!attribution?.observedMechanisms?.includes(mechanism)) reasons.push(`production-attribution-mechanism-missing:${mechanism}`);
  }
  for (const [name, value] of Object.entries(scaleLaw?.falseClosureChecks || {})) {
    if (value) reasons.push(`scale-law-false-closure:${name}`);
  }
  return { scaleLawEvidenceAllowed: reasons.length === 0, reasons };
}

export function validateAdaptiveVolumeProductionSurvivalReport(report) {
  const reasons = [];
  const survival = report?.productionSurvival;
  if (survival?.schema !== ADAPTIVE_VOLUME_PRODUCTION_SURVIVAL_SCHEMA) reasons.push('production-survival-schema-mismatch');
  if (survival?.status !== 'passed') reasons.push('production-survival-not-passed');
  const requested = survival?.requested;
  if (Number(requested?.width) !== 3456
    || Number(requested?.height) !== 2234
    || Number(requested?.pixelCount) !== 3456 * 2234) reasons.push('production-survival-workload-mismatch');
  if (!Number.isInteger(Number(requested?.dispatchRepeats)) || Number(requested.dispatchRepeats) <= 0) reasons.push('production-survival-dispatch-invalid');
  if (!Number.isInteger(Number(requested?.steadySamples)) || Number(requested.steadySamples) < 3) reasons.push('production-survival-samples-incomplete');
  if (requested?.hiddenWorkloadCapApplied !== false) reasons.push('production-survival-hidden-cap');

  const effective = survival?.effective;
  if (effective?.sourceAuthority !== 'exact-step45-sidecar-production-field-proxy-v0') reasons.push('production-survival-source-authority-mismatch');
  if (!isSha256Digest(effective?.sourceSha256) || effective?.sourceSha256 !== report?.source?.sourceSidecarSha256) reasons.push('production-survival-source-mismatch');
  if (!isSha256Digest(effective?.productionVolumeSha256)
    || effective?.productionVolumeSha256 !== report?.runtime?.sourceFileSha256s?.productionVolume) reasons.push('production-survival-production-source-mismatch');
  if (effective?.differingMechanism !== 'smoke-extinction-scalar-lookup-only-v0') reasons.push('production-survival-arm-difference-invalid');
  for (const mechanism of ['majorant-grid', 'occupancy-skip', 'adaptive-rays', 'early-transmittance', 'five-live-field-samples']) {
    if (!effective?.matchedMechanisms?.includes(mechanism)) reasons.push(`production-survival-mechanism-missing:${mechanism}`);
  }

  const workload = effective?.workload;
  const pixelCount = Number(requested?.pixelCount);
  if (Number(workload?.width) !== 3456 || Number(workload?.height) !== 2234 || Number(workload?.pixelCount) !== pixelCount) reasons.push('production-survival-effective-workload-mismatch');
  if (!Number.isInteger(Number(workload?.intersectingRayCount)) || Number(workload.intersectingRayCount) <= 0) reasons.push('production-survival-rays-empty');
  if (!Number.isInteger(Number(workload?.productionStepCount)) || Number(workload.productionStepCount) <= 0) reasons.push('production-survival-step-count-empty');
  if (Number(workload?.fieldSampleCount) !== Number(workload?.productionStepCount) * 5) reasons.push('production-survival-field-sample-count-invalid');
  if (!Number.isInteger(Number(workload?.majorantSkipCount)) || Number(workload.majorantSkipCount) < 0) reasons.push('production-survival-majorant-skip-invalid');
  if (!Number.isInteger(Number(workload?.earlyTerminationCount)) || Number(workload.earlyTerminationCount) < 0) reasons.push('production-survival-early-termination-invalid');
  if (workload?.timingProtocol !== 'paired-alternating-submit-v0' || Number(workload?.submissionCountPerPair) !== 2) reasons.push('production-survival-timing-protocol-invalid');
  if (!Array.isArray(workload?.pairedSamples) || workload.pairedSamples.length !== Number(requested?.steadySamples)) reasons.push('production-survival-paired-samples-incomplete');
  for (const arm of ['dense', 'compact']) {
    if (!finitePositive(workload?.profiles?.[arm]?.aggregate?.median)
      || !finitePositive(workload?.profiles?.[arm]?.perDispatch?.median)) reasons.push(`production-survival-${arm}-timing-invalid`);
  }
  const comparison = workload?.comparison;
  if (Number(comparison?.sampleCount) !== pixelCount
    || !finiteNonNegative(comparison?.maximumAbsoluteError)
    || Number(comparison?.maximumAbsoluteError) > ADAPTIVE_VOLUME_GPU_ERROR_LIMITS.compactPrebuiltAgainstDenseMaximumAbsoluteError
    || Number(comparison?.errorLimit) !== ADAPTIVE_VOLUME_GPU_ERROR_LIMITS.compactPrebuiltAgainstDenseMaximumAbsoluteError
    || Number(comparison?.aboveErrorLimitCount) !== 0) reasons.push('production-survival-output-error');

  const updateCost = survival?.updateCost;
  if (updateCost?.authority !== 'same-run-gpu-hierarchy-selection-pack-timestamps-v0') reasons.push('production-survival-update-authority-mismatch');
  if (updateCost?.separatelyCharged !== true
    || !finitePositive(updateCost?.buildGpuMs)
    || !finitePositive(updateCost?.prebuiltCompactGpuMs)
    || !finitePositive(updateCost?.rebuildAndRenderGpuMs)
    || Math.abs(Number(updateCost?.rebuildAndRenderGpuMs) - Number(updateCost?.buildGpuMs) - Number(updateCost?.prebuiltCompactGpuMs)) > 1e-9) {
    reasons.push('production-survival-update-cost-hidden');
  }
  for (const [name, value] of Object.entries(survival?.falseClosureChecks || {})) {
    if (value) reasons.push(`production-survival-false-closure:${name}`);
  }
  return { productionSurvivalEvidenceAllowed: reasons.length === 0, reasons };
}
