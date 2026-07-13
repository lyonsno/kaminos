export function classifySam31MemoryAttentionAdapter(input = {}) {
  if (typeof input.explicitFallback === 'boolean') {
    return { isFallbackAdapter: input.explicitFallback, fallbackEvidenceSource: 'adapter-fallback-boolean' };
  }
  const vendor = String(input.vendor || '').trim().toLowerCase();
  const architecture = String(input.architecture || '').trim().toLowerCase();
  const identity = `${vendor} ${architecture}`;
  if (/swiftshader|llvmpipe|software|basic render|warp/.test(identity)) {
    return { isFallbackAdapter: true, fallbackEvidenceSource: 'software-adapter-info' };
  }
  if (/^(apple|amd|nvidia|intel|qualcomm)$/.test(vendor) && architecture) {
    return { isFallbackAdapter: false, fallbackEvidenceSource: 'recognized-hardware-adapter-info' };
  }
  return { isFallbackAdapter: null, fallbackEvidenceSource: null };
}

export function evaluateSam31MemoryAttentionEvidence(input = {}) {
  const routeIdentity = input.requestedRouteId === input.receipt?.requestedRouteId
    && input.requestedRouteId === input.receipt?.effectiveRouteId;
  const adapterPassed = input.adapterInfo?.isFallbackAdapter === false;
  const receiptPassed = input.receipt?.status === 'real' && input.receipt?.fallbackReason === null;
  const errorsPassed = Array.isArray(input.uncapturedErrors) && input.uncapturedErrors.length === 0;
  const memoryMaxAbsDiff = Number(input.parity?.memoryMaxAbsDiff);
  const tolerance = Number(input.tolerance);
  const parityPassed = Number.isFinite(memoryMaxAbsDiff) && Number.isFinite(tolerance) && memoryMaxAbsDiff <= tolerance;
  const packetPassed = input.packet?.mappedTensorCount === 122
    && input.packet?.layerCount === 4
    && input.packet?.numObjPtrTokens === 16;
  return {
    passed: adapterPassed && receiptPassed && routeIdentity && errorsPassed && parityPassed && packetPassed,
    adapterPassed,
    receiptPassed,
    routeIdentity,
    errorsPassed,
    parityPassed,
    packetPassed,
  };
}
