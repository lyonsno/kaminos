export function classifySam31PropagationMemoryAdapter(input = {}) {
  const vendor = String(input.vendor || '').trim().toLowerCase();
  const architecture = String(input.architecture || '').trim().toLowerCase();
  const identity = `${vendor} ${architecture}`;
  if (/swiftshader|llvmpipe|software|basic render|warp/.test(identity)) {
    return { isFallbackAdapter: true, fallbackEvidenceSource: 'software-adapter-info' };
  }
  if (typeof input.explicitFallback === 'boolean') {
    return { isFallbackAdapter: input.explicitFallback, fallbackEvidenceSource: 'adapter-fallback-boolean' };
  }
  if (/^(apple|amd|nvidia|intel|qualcomm)$/.test(vendor) && architecture) {
    return { isFallbackAdapter: false, fallbackEvidenceSource: 'recognized-hardware-adapter-info' };
  }
  return { isFallbackAdapter: null, fallbackEvidenceSource: null };
}

export function evaluateSam31PropagationMemoryEvidence(input = {}) {
  const adapterInfo = input.adapterInfo || {};
  const receipts = Array.isArray(input.receipts) ? input.receipts : [];
  const requestedRouteIds = Array.isArray(input.requestedRouteIds) ? input.requestedRouteIds : [];
  const parity = input.parity || {};
  const tolerances = input.tolerances || {};
  const uncapturedErrors = Array.isArray(input.uncapturedErrors) ? input.uncapturedErrors : [];
  const effectiveRouteIds = receipts.map(receipt => receipt.effectiveRouteId);
  const requestedRouteIdsMatch = requestedRouteIds.length === receipts.length
    && receipts.every((receipt, index) => receipt.requestedRouteId === requestedRouteIds[index]
      && receipt.effectiveRouteId === requestedRouteIds[index]);
  const receiptIdentityPassed = receipts.length > 0
    && receipts.every(receipt => receipt.status === 'real' && receipt.fallbackReason === null);
  const parityPassed = Number.isFinite(parity.propagationMaxAbsDiff)
    && Number.isFinite(parity.memoryMaxAbsDiff)
    && Number.isFinite(parity.positionMaxAbsDiff)
    && parity.propagationMaxAbsDiff <= tolerances.webGpuPropagationMaxAbsDiff
    && parity.memoryMaxAbsDiff <= tolerances.webGpuMemoryMaxAbsDiff
    && parity.positionMaxAbsDiff <= tolerances.webGpuPositionMaxAbsDiff;
  const adapterPassed = adapterInfo.isFallbackAdapter === false;
  const errorsPassed = uncapturedErrors.length === 0;
  return {
    passed: parityPassed && adapterPassed && receiptIdentityPassed && requestedRouteIdsMatch && errorsPassed,
    parityPassed,
    adapterPassed,
    receiptIdentityPassed,
    requestedRouteIdsMatch,
    requestedRouteIds,
    effectiveRouteIds,
    errorsPassed,
  };
}
