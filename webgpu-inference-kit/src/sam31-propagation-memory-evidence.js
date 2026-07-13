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
