import {
  validateWebGpuBackendIdentity,
} from './gpu-environment.js';
import {
  validateRouteReceipt,
} from './route-receipt.js';

export const WEBGPU_ROUTE_EVIDENCE_CLASSIFICATION_SCHEMA = 'kaminos.webgpu-route-evidence-classification.v0';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseTime(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function staleReason(receipt, options) {
  if (!Number.isFinite(options.maxAgeMs)) return null;
  const createdMs = parseTime(receipt.createdAt);
  const nowMs = parseTime(options.now || new Date().toISOString());
  if (createdMs == null) return 'createdAt is missing or invalid for freshness check';
  if (nowMs == null) return 'now is invalid for freshness check';
  return nowMs - createdMs > options.maxAgeMs ? `receipt is older than ${options.maxAgeMs}ms` : null;
}

function classifyNonRealStatus(status) {
  if (status === 'fallback') return 'fallback';
  if (status === 'cached') return 'cache';
  if (status === 'cache') return 'cache';
  if (status === 'demo') return 'demo';
  if (status === 'fixture') return 'demo';
  if (status === 'partial') return 'partial';
  return 'non-real';
}

function outputClassification(outputs = []) {
  if (!Array.isArray(outputs)) return null;
  if (outputs.some(output => output?.status === 'partial')) return 'partial';
  if (outputs.some(output => output?.status === 'cached' || output?.status === 'cache')) return 'cache';
  if (outputs.some(output => output?.status === 'demo' || output?.status === 'fixture')) return 'demo';
  if (outputs.some(output => output?.status !== 'real')) return 'non-real-output';
  return null;
}

function baseClassification(receipt, options = {}) {
  const reasons = [];
  const receiptResult = validateRouteReceipt(receipt);
  if (!receiptResult.ok) reasons.push(...receiptResult.errors);

  const backendResult = validateWebGpuBackendIdentity(receipt?.backend);
  if (!backendResult.ok) reasons.push(...backendResult.errors.map(error => `backend.${error}`));

  if (reasons.length > 0) {
    return { classification: 'invalid', authoritative: false, reasons };
  }

  if (isNonEmptyString(options.expectedRouteId) && receipt.effectiveRouteId !== options.expectedRouteId) {
    return {
      classification: 'route-mismatch',
      authoritative: false,
      reasons: [`effectiveRouteId ${receipt.effectiveRouteId} does not match expected ${options.expectedRouteId}`],
    };
  }

  const stale = staleReason(receipt, options);
  if (stale) {
    return { classification: 'stale', authoritative: false, reasons: [stale] };
  }

  if (receipt.status !== 'real') {
    return {
      classification: classifyNonRealStatus(receipt.status),
      authoritative: false,
      reasons: [`receipt status is ${receipt.status}`],
    };
  }

  if (receipt.fallbackReason) {
    return {
      classification: 'fallback',
      authoritative: false,
      reasons: [`fallback reason present: ${receipt.fallbackReason}`],
    };
  }

  const outputStatus = outputClassification(receipt.outputs);
  if (outputStatus) {
    return {
      classification: outputStatus,
      authoritative: false,
      reasons: [`one or more outputs are ${outputStatus}`],
    };
  }

  return {
    classification: 'authoritative-live-webgpu',
    authoritative: true,
    reasons: [],
  };
}

export function classifyWebGpuRouteReceiptEvidence(receipt, options = {}) {
  const base = baseClassification(receipt, options);
  return {
    schema: WEBGPU_ROUTE_EVIDENCE_CLASSIFICATION_SCHEMA,
    classification: base.classification,
    authoritative: base.authoritative,
    reasons: base.reasons,
    routeId: receipt?.effectiveRouteId || receipt?.requestedRouteId || null,
    requestedRouteId: receipt?.requestedRouteId || null,
    effectiveRouteId: receipt?.effectiveRouteId || null,
    backendKind: receipt?.backend?.kind || null,
    adapterName: receipt?.backend?.adapterName || null,
    timingSource: receipt?.timings?.source || receipt?.timings?.profile?.timingSource || null,
    totalMs: Number.isFinite(receipt?.timings?.totalMs) ? receipt.timings.totalMs : null,
    outputRoles: Array.isArray(receipt?.outputs) ? receipt.outputs.map(output => output.role) : [],
    createdAt: receipt?.createdAt || null,
  };
}

export function classifyWebGpuRouteWorkerResultEvidence(result, options = {}) {
  const classification = classifyWebGpuRouteReceiptEvidence(result?.receipt, options);
  return {
    ...classification,
    requestId: result?.requestId || null,
    resultRouteId: result?.routeId || null,
    resultStatus: result?.status || null,
  };
}
