import {
  WEBGPU_ADAPTIVE_COMMAND_DUTY_PLANNER_SCHEMA,
} from './adaptive-command-duty.js';
import {
  WEBGPU_BOUNDED_GPU_SUBMISSION_REPORT_SCHEMA,
} from './bounded-gpu-submission.js';
import {
  WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_REPORT_SCHEMA,
} from './cooperative-adapter-conformance.js';
import {
  WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
} from './foreground-opportunity.js';
import {
  WEBGPU_INFERENCE_RUNTIME_SCHEMA,
} from './inference-runtime.js';
import {
  WEBGPU_INFERENCE_SESSION_SCHEMA,
} from './inference-session.js';
import { WEBGPU_INFERENCE_KIT_VERSION } from './kernel-profile.js';

export const WEBGPU_INFERENCE_KIT_IDENTITY_SCHEMA =
  'kaminos.webgpu-inference-kit-identity.v0';
export const WEBGPU_INFERENCE_KIT_ADOPTION_PREFLIGHT_SCHEMA =
  'kaminos.webgpu-inference-kit-adoption-preflight.v0';
export const WEBGPU_INFERENCE_KIT_ADOPTION_RECEIPT_SCHEMA =
  'kaminos.webgpu-inference-kit-adoption-receipt.v0';

const PACKAGE_NAME = '@kaminos/webgpu-inference-kit';
const RESOLVER_LOCATOR_KINDS = new Set(['bundle-url', 'module-url', 'package-path']);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function createCheck(checkId, passed, detail = {}) {
  return {
    checkId,
    status: passed ? 'passed' : 'failed',
    detail: clone(detail),
  };
}

function summarize(checks) {
  const failedChecks = checks.filter(check => check.status === 'failed');
  return {
    checkCount: checks.length,
    passedCheckCount: checks.length - failedChecks.length,
    failedCheckCount: failedChecks.length,
    failedCheckIds: failedChecks.map(check => check.checkId),
  };
}

function throwFailedReceipt(message, receipt) {
  const error = new Error(message);
  error.name = 'WebGpuInferenceKitAdoptionError';
  error.receipt = receipt;
  throw error;
}

export const WEBGPU_INFERENCE_KIT_CAPABILITIES = deepFreeze([
  {
    capabilityId: 'adaptive-command-duty',
    schema: WEBGPU_ADAPTIVE_COMMAND_DUTY_PLANNER_SCHEMA,
  },
  {
    capabilityId: 'bounded-gpu-submission',
    schema: WEBGPU_BOUNDED_GPU_SUBMISSION_REPORT_SCHEMA,
  },
  {
    capabilityId: 'cooperative-adapter-conformance',
    schema: WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_REPORT_SCHEMA,
  },
  {
    capabilityId: 'foreground-opportunity-interlock',
    schema: WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
  },
  {
    capabilityId: 'inference-runtime',
    schema: WEBGPU_INFERENCE_RUNTIME_SCHEMA,
  },
  {
    capabilityId: 'shared-inference-session',
    schema: WEBGPU_INFERENCE_SESSION_SCHEMA,
  },
]);

const PACKAGE_IDENTITY = deepFreeze({
  schema: WEBGPU_INFERENCE_KIT_IDENTITY_SCHEMA,
  packageName: PACKAGE_NAME,
  packageVersion: WEBGPU_INFERENCE_KIT_VERSION,
  moduleUrl: import.meta.url,
  capabilities: WEBGPU_INFERENCE_KIT_CAPABILITIES,
});

export function createWebGpuInferenceKitIdentity() {
  return PACKAGE_IDENTITY;
}

function normalizeRequiredCapabilities(value) {
  if (!Array.isArray(value)) return [];
  return value.map(capability => ({
    capabilityId: capability?.capabilityId,
    schema: capability?.schema,
  }));
}

function checkRequiredCapabilities(requiredCapabilities) {
  const available = new Map(
    WEBGPU_INFERENCE_KIT_CAPABILITIES.map(capability => [capability.capabilityId, capability.schema]),
  );
  const failures = [];
  if (requiredCapabilities.length === 0) failures.push('at least one capability is required');
  for (const capability of requiredCapabilities) {
    if (!isNonEmptyString(capability.capabilityId) || !isNonEmptyString(capability.schema)) {
      failures.push('capabilityId and schema must be non-empty strings');
      continue;
    }
    const effectiveSchema = available.get(capability.capabilityId);
    if (effectiveSchema !== capability.schema) {
      failures.push(
        `${capability.capabilityId}: requested ${capability.schema}, effective ${effectiveSchema || 'missing'}`,
      );
    }
  }
  return failures;
}

export function assertWebGpuInferenceKitAdoption(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const requestedPackage = clone(source.requestedPackage) || null;
  const consumer = clone(source.consumer) || null;
  const resolver = clone(source.resolver) || null;
  const callerClaims = clone(source.callerClaims) || null;
  const requiredCapabilities = normalizeRequiredCapabilities(source.requiredCapabilities);
  const checks = [];

  checks.push(createCheck('adoption-identity', isNonEmptyString(source.adoptionId), {
    adoptionId: source.adoptionId || null,
  }));
  checks.push(createCheck(
    'requested-package-name',
    requestedPackage?.name === PACKAGE_IDENTITY.packageName,
    {
      requested: requestedPackage?.name || null,
      effective: PACKAGE_IDENTITY.packageName,
    },
  ));
  checks.push(createCheck(
    'requested-package-version',
    requestedPackage?.version === PACKAGE_IDENTITY.packageVersion,
    {
      requested: requestedPackage?.version || null,
      effective: PACKAGE_IDENTITY.packageVersion,
    },
  ));

  const consumerIdentityValid = isPlainObject(consumer)
    && ['consumerId', 'sourceRevision', 'routeId', 'adapterId']
      .every(key => isNonEmptyString(consumer[key]));
  checks.push(createCheck('consumer-identity', consumerIdentityValid, { consumer }));

  const resolverIdentityValid = isPlainObject(resolver)
    && resolver.authority === 'consumer-observed'
    && RESOLVER_LOCATOR_KINDS.has(resolver.locatorKind)
    && isNonEmptyString(resolver.locator)
    && isNonEmptyString(resolver.packageName)
    && isNonEmptyString(resolver.packageVersion);
  checks.push(createCheck('resolver-identity', resolverIdentityValid, { resolver }));
  checks.push(createCheck(
    'resolver-package-name',
    resolver?.packageName === PACKAGE_IDENTITY.packageName,
    {
      observed: resolver?.packageName || null,
      effective: PACKAGE_IDENTITY.packageName,
    },
  ));
  checks.push(createCheck(
    'resolver-package-version',
    resolver?.packageVersion === PACKAGE_IDENTITY.packageVersion,
    {
      observed: resolver?.packageVersion || null,
      effective: PACKAGE_IDENTITY.packageVersion,
      callerClaim: callerClaims?.kitVersion || null,
    },
  ));

  const capabilityFailures = checkRequiredCapabilities(requiredCapabilities);
  checks.push(createCheck('required-capabilities', capabilityFailures.length === 0, {
    requiredCapabilities,
    failures: capabilityFailures,
  }));
  checks.push(createCheck('caller-claims-non-authoritative', true, {
    callerClaims,
    authority: 'diagnostic-only',
  }));

  const summary = summarize(checks);
  const receipt = deepFreeze({
    schema: WEBGPU_INFERENCE_KIT_ADOPTION_PREFLIGHT_SCHEMA,
    status: summary.failedCheckCount === 0 ? 'passed' : 'failed',
    adoptionId: isNonEmptyString(source.adoptionId) ? source.adoptionId : null,
    packageIdentity: PACKAGE_IDENTITY,
    requestedPackage,
    consumer,
    resolver,
    callerClaims,
    requiredCapabilities,
    checks,
    summary,
  });

  if (receipt.status === 'failed') {
    throwFailedReceipt(
      `WebGPU inference kit adoption preflight failed: ${summary.failedCheckIds.join(', ')}`,
      receipt,
    );
  }
  return receipt;
}

function isPassedCheck(report, checkId) {
  return Array.isArray(report?.checks)
    && report.checks.some(check => check?.checkId === checkId && check?.status === 'passed');
}

function isSettledTerminal(terminalSettlement, routeId) {
  return isPlainObject(terminalSettlement)
    && terminalSettlement.status === 'succeeded'
    && terminalSettlement.routeId === routeId
    && terminalSettlement.pendingRangeCount === 0
    && terminalSettlement.activeWorkCount === 0
    && isPlainObject(terminalSettlement.outputIdentity)
    && isNonEmptyString(terminalSettlement.outputIdentity.kind)
    && isNonEmptyString(terminalSettlement.outputIdentity.value);
}

export function createWebGpuInferenceKitAdoptionReceipt(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const preflight = clone(source.preflight) || null;
  const conformance = clone(source.conformanceReport) || null;
  const terminalSettlement = clone(source.terminalSettlement) || null;
  const checks = [];

  let revalidatedPreflight = null;
  let preflightFailure = null;
  try {
    revalidatedPreflight = assertWebGpuInferenceKitAdoption({
      adoptionId: preflight?.adoptionId,
      requestedPackage: preflight?.requestedPackage,
      consumer: preflight?.consumer,
      resolver: preflight?.resolver,
      callerClaims: preflight?.callerClaims,
      requiredCapabilities: preflight?.requiredCapabilities,
    });
  } catch (error) {
    preflightFailure = error?.receipt || null;
  }

  const preflightIdentityPassed = preflight?.schema === WEBGPU_INFERENCE_KIT_ADOPTION_PREFLIGHT_SCHEMA
    && preflight?.status === 'passed'
    && preflight?.packageIdentity?.packageName === PACKAGE_IDENTITY.packageName
    && preflight?.packageIdentity?.packageVersion === PACKAGE_IDENTITY.packageVersion
    && preflight?.packageIdentity?.moduleUrl === PACKAGE_IDENTITY.moduleUrl
    && preflight?.summary?.failedCheckCount === 0
    && revalidatedPreflight?.status === 'passed';
  checks.push(createCheck('adoption-preflight', preflightIdentityPassed, {
    adoptionId: preflight?.adoptionId || null,
    schema: preflight?.schema || null,
    status: preflight?.status || null,
    revalidatedStatus: revalidatedPreflight?.status || preflightFailure?.status || null,
    revalidationFailedCheckIds: preflightFailure?.summary?.failedCheckIds || [],
  }));

  const conformanceIdentityPassed = conformance?.schema
      === WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_REPORT_SCHEMA
    && conformance?.status === 'passed'
    && conformance?.summary?.failedCheckCount === 0;
  checks.push(createCheck('conformance-report', conformanceIdentityPassed, {
    schema: conformance?.schema || null,
    status: conformance?.status || null,
    failedCheckIds: conformance?.summary?.failedCheckIds || null,
  }));
  checks.push(createCheck(
    'conformance-package-version',
    conformance?.kitVersion === PACKAGE_IDENTITY.packageVersion,
    {
      conformance: conformance?.kitVersion || null,
      effective: PACKAGE_IDENTITY.packageVersion,
    },
  ));

  const routeId = preflight?.consumer?.routeId;
  const adapterId = preflight?.consumer?.adapterId;
  checks.push(createCheck(
    'conformance-consumer-identity',
    isNonEmptyString(routeId)
      && conformance?.routeId === routeId
      && conformance?.adapterIdentity?.routeId === routeId
      && conformance?.adapterIdentity?.adapterId === adapterId
      && conformance?.adapterIdentity?.packageName === PACKAGE_IDENTITY.packageName
      && conformance?.adapterIdentity?.packageVersion === PACKAGE_IDENTITY.packageVersion
      && conformance?.adapterIdentity?.sourceRevision === preflight?.consumer?.sourceRevision,
    {
      expectedRouteId: routeId || null,
      expectedAdapterId: adapterId || null,
      conformanceRouteId: conformance?.routeId || null,
      conformanceAdapterIdentity: conformance?.adapterIdentity || null,
    },
  ));

  const conformanceTerminalPassed = isPassedCheck(
    conformance,
    'no-pending-terminal-ranges',
  ) && Array.isArray(conformance?.checks)
    && conformance.checks.some(check => (
      isNonEmptyString(check?.checkId)
      && check.checkId.endsWith('-terminal-settlement')
      && check.status === 'passed'
    ));
  checks.push(createCheck('conformance-terminal-settlement', conformanceTerminalPassed, {
    terminalCheckIds: conformance?.checks
      ?.filter(check => check?.checkId?.endsWith('-terminal-settlement'))
      .map(check => ({ checkId: check.checkId, status: check.status })) || [],
    noPendingTerminalRanges: isPassedCheck(conformance, 'no-pending-terminal-ranges'),
  }));

  checks.push(createCheck(
    'terminal-settlement',
    isSettledTerminal(terminalSettlement, routeId),
    { terminalSettlement },
  ));

  const summary = summarize(checks);
  const receipt = deepFreeze({
    schema: WEBGPU_INFERENCE_KIT_ADOPTION_RECEIPT_SCHEMA,
    status: summary.failedCheckCount === 0 ? 'passed' : 'failed',
    adoptionId: preflight?.adoptionId || null,
    packageIdentity: PACKAGE_IDENTITY,
    preflight,
    conformance,
    terminalSettlement,
    checks,
    summary,
  });

  if (receipt.status === 'failed') {
    throwFailedReceipt(
      `WebGPU inference kit adoption receipt failed: ${summary.failedCheckIds.join(', ')}`,
      receipt,
    );
  }
  return receipt;
}
