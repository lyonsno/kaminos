import {
  WEBGPU_ADAPTIVE_COMMAND_DUTY_PLANNER_SCHEMA,
} from './adaptive-command-duty.js';
import {
  WEBGPU_BOUNDED_GPU_SUBMISSION_REPORT_SCHEMA,
} from './bounded-gpu-submission.js';
import {
  WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_REPORT_SCHEMA,
  validateWebGpuCooperativeAdapterConformanceReport,
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
export const WEBGPU_INFERENCE_KIT_EXPECTATION_SCHEMA =
  'kaminos.webgpu-inference-kit-expectation.v0';
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
  authority: 'package-owned',
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

function normalizeExpectation(value) {
  if (!isPlainObject(value)) return null;
  return {
    schema: value.schema,
    authority: value.authority,
    expectationId: value.expectationId,
    packageName: value.packageName,
    packageVersion: value.packageVersion,
    requiredCapabilities: normalizeRequiredCapabilities(value.requiredCapabilities),
  };
}

function checkRequiredCapabilities(requiredCapabilities) {
  const available = new Map(
    WEBGPU_INFERENCE_KIT_CAPABILITIES.map(capability => [capability.capabilityId, capability.schema]),
  );
  const failures = [];
  if (requiredCapabilities.length === 0) failures.push('at least one capability is required');
  const seen = new Set();
  for (const capability of requiredCapabilities) {
    if (!isNonEmptyString(capability.capabilityId) || !isNonEmptyString(capability.schema)) {
      failures.push('capabilityId and schema must be non-empty strings');
      continue;
    }
    if (seen.has(capability.capabilityId)) {
      failures.push(`${capability.capabilityId}: duplicate required capability`);
      continue;
    }
    seen.add(capability.capabilityId);
    const effectiveSchema = available.get(capability.capabilityId);
    if (effectiveSchema !== capability.schema) {
      failures.push(
        `${capability.capabilityId}: expected ${capability.schema}, effective ${effectiveSchema || 'missing'}`,
      );
    }
  }
  return failures;
}

function assessResolverLocator(resolver) {
  if (!isPlainObject(resolver) || !RESOLVER_LOCATOR_KINDS.has(resolver.locatorKind)) {
    return {
      passed: false,
      verification: 'invalid',
      authority: 'none',
      loadBearing: false,
      reason: 'resolver locator kind is invalid',
    };
  }
  if (resolver.locatorKind === 'module-url') {
    const passed = resolver.locator === PACKAGE_IDENTITY.moduleUrl;
    return {
      passed,
      verification: passed ? 'package-bound' : 'mismatch',
      authority: 'package-module-url-comparison',
      loadBearing: true,
      expectedModuleUrl: PACKAGE_IDENTITY.moduleUrl,
      observedModuleUrl: resolver.locator || null,
    };
  }
  return {
    passed: true,
    verification: 'unverified-diagnostic',
    authority: 'consumer-observed-locator',
    loadBearing: false,
    reason: `${resolver.locatorKind} requires a consumer or bundler manifest for location binding`,
  };
}

function assertWebGpuInferenceKitAdoptionCore(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const expectation = normalizeExpectation(source.expectation);
  const consumer = clone(source.consumer) || null;
  const resolver = clone(source.resolver) || null;
  const callerClaims = clone(source.callerClaims) || null;
  const requiredCapabilities = expectation?.requiredCapabilities || [];
  const resolverAssessment = assessResolverLocator(resolver);
  const checks = [];

  checks.push(createCheck('adoption-identity', isNonEmptyString(source.adoptionId), {
    adoptionId: source.adoptionId || null,
  }));
  checks.push(createCheck(
    'consumer-expectation',
    expectation?.schema === WEBGPU_INFERENCE_KIT_EXPECTATION_SCHEMA
      && expectation?.authority === 'consumer-declared'
      && isNonEmptyString(expectation?.expectationId),
    {
      schema: expectation?.schema || null,
      authority: expectation?.authority || null,
      expectationId: expectation?.expectationId || null,
    },
  ));
  checks.push(createCheck(
    'expected-package-name',
    expectation?.packageName === PACKAGE_IDENTITY.packageName,
    {
      expected: expectation?.packageName || null,
      effective: PACKAGE_IDENTITY.packageName,
    },
  ));
  checks.push(createCheck(
    'expected-package-version',
    expectation?.packageVersion === PACKAGE_IDENTITY.packageVersion,
    {
      expected: expectation?.packageVersion || null,
      effective: PACKAGE_IDENTITY.packageVersion,
    },
  ));

  const consumerIdentityValid = isPlainObject(consumer)
    && ['consumerId', 'sourceRevision', 'routeId', 'adapterId']
      .every(key => isNonEmptyString(consumer[key]))
    && isPlainObject(consumer.adapterPackage)
    && isNonEmptyString(consumer.adapterPackage.name)
    && isNonEmptyString(consumer.adapterPackage.version);
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
  checks.push(createCheck(
    'resolver-locator-binding',
    resolverAssessment.passed,
    resolverAssessment,
  ));

  const capabilityFailures = checkRequiredCapabilities(requiredCapabilities);
  checks.push(createCheck('required-capabilities', capabilityFailures.length === 0, {
    authority: 'consumer-declared-expectation',
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
    expectation,
    consumer,
    resolver,
    resolverAssessment,
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

function createInputNormalizationFailure(schema, phase, error) {
  const checks = [createCheck('input-normalization', false, {
    phase,
    error: {
      name: isNonEmptyString(error?.name) ? error.name : 'Error',
      message: isNonEmptyString(error?.message) ? error.message : String(error),
    },
  })];
  return deepFreeze({
    schema,
    status: 'failed',
    packageIdentity: PACKAGE_IDENTITY,
    failurePhase: phase,
    checks,
    summary: summarize(checks),
  });
}

export function assertWebGpuInferenceKitAdoption(input = {}) {
  try {
    return assertWebGpuInferenceKitAdoptionCore(input);
  } catch (error) {
    if (error?.name === 'WebGpuInferenceKitAdoptionError') throw error;
    const receipt = createInputNormalizationFailure(
      WEBGPU_INFERENCE_KIT_ADOPTION_PREFLIGHT_SCHEMA,
      'preflight-input-normalization',
      error,
    );
    throwFailedReceipt('WebGPU inference kit adoption preflight input normalization failed', receipt);
  }
}

function validateOutputIdentity(outputIdentity) {
  if (!isPlainObject(outputIdentity)) return false;
  if (outputIdentity.kind === 'sha256') {
    return /^[0-9a-f]{64}$/.test(outputIdentity.value || '');
  }
  return outputIdentity.kind === 'caller-fingerprint'
    && outputIdentity.authority === 'caller-declared'
    && isNonEmptyString(outputIdentity.value);
}

function isSettledTerminal(terminalSettlement, routeId) {
  return isPlainObject(terminalSettlement)
    && terminalSettlement.status === 'succeeded'
    && terminalSettlement.routeId === routeId
    && terminalSettlement.pendingRangeCount === 0
    && terminalSettlement.activeWorkCount === 0
    && validateOutputIdentity(terminalSettlement.outputIdentity);
}

function createWebGpuInferenceKitAdoptionReceiptCore(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const submittedPreflight = clone(source.preflight) || null;
  const conformance = clone(source.conformanceReport) || null;
  const terminalSettlement = clone(source.terminalSettlement) || null;
  const checks = [];

  let revalidatedPreflight = null;
  let preflightFailure = null;
  try {
    revalidatedPreflight = assertWebGpuInferenceKitAdoption({
      adoptionId: submittedPreflight?.adoptionId,
      expectation: submittedPreflight?.expectation,
      consumer: submittedPreflight?.consumer,
      resolver: submittedPreflight?.resolver,
      callerClaims: submittedPreflight?.callerClaims,
    });
  } catch (error) {
    preflightFailure = error?.receipt || null;
  }

  const preflightIdentityPassed = submittedPreflight?.schema
      === WEBGPU_INFERENCE_KIT_ADOPTION_PREFLIGHT_SCHEMA
    && submittedPreflight?.packageIdentity?.packageName === PACKAGE_IDENTITY.packageName
    && submittedPreflight?.packageIdentity?.packageVersion === PACKAGE_IDENTITY.packageVersion
    && submittedPreflight?.packageIdentity?.moduleUrl === PACKAGE_IDENTITY.moduleUrl
    && revalidatedPreflight?.status === 'passed';
  checks.push(createCheck('adoption-preflight', preflightIdentityPassed, {
    adoptionId: submittedPreflight?.adoptionId || null,
    schema: submittedPreflight?.schema || null,
    submittedStatus: submittedPreflight?.status || null,
    revalidatedStatus: revalidatedPreflight?.status || preflightFailure?.status || null,
    revalidationFailedCheckIds: preflightFailure?.summary?.failedCheckIds || [],
    authority: 'canonical-revalidation',
  }));

  const authoritativePreflight = revalidatedPreflight || preflightFailure;
  const routeId = authoritativePreflight?.consumer?.routeId;
  const adapterId = authoritativePreflight?.consumer?.adapterId;
  const conformanceValidation = validateWebGpuCooperativeAdapterConformanceReport(
    conformance,
    {
      expectedKitVersion: PACKAGE_IDENTITY.packageVersion,
      expectedRouteId: routeId,
      expectedAdapterId: adapterId,
      expectedAdapterPackageName: authoritativePreflight?.consumer?.adapterPackage?.name,
      expectedAdapterPackageVersion: authoritativePreflight?.consumer?.adapterPackage?.version,
      expectedSourceRevision: authoritativePreflight?.consumer?.sourceRevision,
    },
  );
  checks.push(createCheck('conformance-report', conformanceValidation.ok, {
    validationSchema: conformanceValidation.schema,
    errors: conformanceValidation.errors,
    effective: conformanceValidation.effective,
    authority: 'semantically-validated-caller-report',
  }));

  checks.push(createCheck(
    'terminal-settlement',
    isSettledTerminal(terminalSettlement, routeId),
    {
      terminalSettlement,
      recognizedOutputIdentityKinds: ['sha256', 'caller-fingerprint'],
      sha256Encoding: '64-lowercase-hex',
    },
  ));

  const summary = summarize(checks);
  const receipt = deepFreeze({
    schema: WEBGPU_INFERENCE_KIT_ADOPTION_RECEIPT_SCHEMA,
    status: summary.failedCheckCount === 0 ? 'passed' : 'failed',
    adoptionId: authoritativePreflight?.adoptionId || submittedPreflight?.adoptionId || null,
    packageIdentity: PACKAGE_IDENTITY,
    preflight: authoritativePreflight,
    conformance,
    conformanceValidation,
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

export function createWebGpuInferenceKitAdoptionReceipt(input = {}) {
  try {
    return createWebGpuInferenceKitAdoptionReceiptCore(input);
  } catch (error) {
    if (error?.name === 'WebGpuInferenceKitAdoptionError') throw error;
    const receipt = createInputNormalizationFailure(
      WEBGPU_INFERENCE_KIT_ADOPTION_RECEIPT_SCHEMA,
      'terminal-input-normalization',
      error,
    );
    throwFailedReceipt('WebGPU inference kit adoption terminal input normalization failed', receipt);
  }
}
