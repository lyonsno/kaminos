import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

for (const exportName of [
  'WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_VALIDATION_SCHEMA',
  'WEBGPU_INFERENCE_KIT_ADOPTION_PREFLIGHT_SCHEMA',
  'WEBGPU_INFERENCE_KIT_ADOPTION_RECEIPT_SCHEMA',
  'WEBGPU_INFERENCE_KIT_EXPECTATION_SCHEMA',
  'WEBGPU_INFERENCE_KIT_IDENTITY_SCHEMA',
  'WEBGPU_INFERENCE_KIT_CAPABILITIES',
  'assertWebGpuInferenceKitAdoption',
  'createWebGpuInferenceKitAdoptionReceipt',
  'createWebGpuInferenceKitIdentity',
  'validateWebGpuCooperativeAdapterConformanceReport',
]) {
  assert.notEqual(kit[exportName], undefined, `the package must export ${exportName}`);
}

const {
  WEBGPU_INFERENCE_KIT_ADOPTION_PREFLIGHT_SCHEMA,
  WEBGPU_INFERENCE_KIT_ADOPTION_RECEIPT_SCHEMA,
  WEBGPU_INFERENCE_KIT_CAPABILITIES,
  WEBGPU_INFERENCE_KIT_EXPECTATION_SCHEMA,
  WEBGPU_INFERENCE_KIT_IDENTITY_SCHEMA,
  WEBGPU_INFERENCE_KIT_VERSION,
  assertWebGpuInferenceKitAdoption,
  createWebGpuInferenceKitAdoptionReceipt,
  createWebGpuInferenceKitIdentity,
  defineWebGpuCooperativeBoundaryManifest,
  runWebGpuCooperativeAdapterConformance,
  validateWebGpuCooperativeAdapterConformanceReport,
} = kit;

const PACKAGE_NAME = '@kaminos/webgpu-inference-kit';
const ROUTE_ID = 'sharp.image-to-splat.webgpu-local.v0';
const ADAPTER_ID = 'sharp.browser-webgpu.v0';
const ADAPTER_PACKAGE_NAME = '@kaminos/sharp-webgpu';
const ADAPTER_PACKAGE_VERSION = '0.1.0';
const SOURCE_REVISION = 'sharp-stage-zero-fixture';
const OUTPUT_SHA256 = 'b'.repeat(64);

function createExpectation(overrides = {}) {
  return {
    schema: WEBGPU_INFERENCE_KIT_EXPECTATION_SCHEMA,
    authority: 'consumer-declared',
    expectationId: 'sharp:webgpu-kit-contract:0.1.43',
    packageName: PACKAGE_NAME,
    packageVersion: '0.1.43',
    requiredCapabilities: [
      {
        capabilityId: 'adaptive-command-duty',
        schema: 'kaminos.webgpu-adaptive-command-duty-planner.v0',
      },
      {
        capabilityId: 'bounded-gpu-submission',
        schema: 'kaminos.webgpu-bounded-gpu-submission-report.v0',
      },
      {
        capabilityId: 'cooperative-adapter-conformance',
        schema: 'kaminos.webgpu-cooperative-adapter-conformance-report.v0',
      },
    ],
    ...overrides,
  };
}

function createResolver(overrides = {}) {
  return {
    authority: 'consumer-observed',
    locatorKind: 'package-path',
    locator: '/app/node_modules/@kaminos/webgpu-inference-kit/src/index.js',
    packageName: PACKAGE_NAME,
    packageVersion: WEBGPU_INFERENCE_KIT_VERSION,
    ...overrides,
  };
}

function createPreflightInput(overrides = {}) {
  return {
    adoptionId: 'sharp:current-kit:stage-zero',
    expectation: createExpectation(),
    consumer: {
      consumerId: 'sharp-webgpu',
      sourceRevision: SOURCE_REVISION,
      routeId: ROUTE_ID,
      adapterId: ADAPTER_ID,
      adapterPackage: {
        name: ADAPTER_PACKAGE_NAME,
        version: ADAPTER_PACKAGE_VERSION,
      },
    },
    resolver: createResolver(),
    ...overrides,
  };
}

function createTerminalSettlement(overrides = {}) {
  return {
    status: 'succeeded',
    routeId: ROUTE_ID,
    pendingRangeCount: 0,
    activeWorkCount: 0,
    outputIdentity: {
      kind: 'sha256',
      value: OUTPUT_SHA256,
    },
    ...overrides,
  };
}

function captureFailedReceipt(run, expectedCheckId) {
  assert.throws(run, error => {
    assert.equal(error.name, 'WebGpuInferenceKitAdoptionError');
    assert.equal(error.receipt.status, 'failed');
    assert.ok(error.receipt.checks.some(
      check => check.checkId === expectedCheckId && check.status === 'failed',
    ));
    assert.ok(Object.isFrozen(error.receipt));
    return true;
  });
}

function captureNormalizationFailure(run, expectedPhase) {
  assert.throws(run, error => {
    assert.equal(error.name, 'WebGpuInferenceKitAdoptionError');
    assert.equal(error.receipt.status, 'failed');
    assert.equal(error.receipt.failurePhase, expectedPhase);
    assert.equal(error.receipt.checks[0].checkId, 'input-normalization');
    assert.ok(Object.isFrozen(error.receipt));
    return true;
  });
}

const manifest = defineWebGpuCooperativeBoundaryManifest({
  manifestId: 'sharp.stage-zero-conformance.v0',
  routeId: ROUTE_ID,
  phases: [{
    phaseId: 'feature-extraction',
    boundaries: [{
      boundaryId: 'feature-blocks',
      kind: 'gpu-command',
      commandDutyKind: 'compute',
      unit: 'block',
      totalItems: 2,
      progressWeight: 1,
      chunking: { mode: 'fixed', chunkItems: 1 },
      yieldPolicy: 'after-duty',
      resources: {
        retain: ['sharp.weights'],
        produce: ['sharp.features'],
        release: [],
      },
    }],
  }],
});

const conformance = await runWebGpuCooperativeAdapterConformance({
  conformanceId: 'sharp:adapter:current-kit',
  adapterIdentity: {
    adapterId: ADAPTER_ID,
    routeId: ROUTE_ID,
    packageName: ADAPTER_PACKAGE_NAME,
    packageVersion: ADAPTER_PACKAGE_VERSION,
    sourceRevision: SOURCE_REVISION,
  },
  manifest,
  initialResources: ['sharp.weights'],
  expectedFinalResources: ['sharp.features', 'sharp.weights'],
  async runAdapter({ cooperative }) {
    const boundary = cooperative.startBoundary('feature-blocks');
    for (let range = boundary.nextRange(); range; range = boundary.nextRange()) {
      await boundary.runGpuDuty(range, { encode() { return {}; } });
    }
    return { outputFingerprint: `sha256:${OUTPUT_SHA256}` };
  },
});

const conformanceValidation = validateWebGpuCooperativeAdapterConformanceReport(
  conformance,
  {
    expectedKitVersion: WEBGPU_INFERENCE_KIT_VERSION,
    expectedRouteId: ROUTE_ID,
    expectedAdapterId: ADAPTER_ID,
    expectedAdapterPackageName: ADAPTER_PACKAGE_NAME,
    expectedAdapterPackageVersion: ADAPTER_PACKAGE_VERSION,
    expectedSourceRevision: SOURCE_REVISION,
  },
);
assert.equal(conformanceValidation.ok, true);
assert.deepEqual(conformanceValidation.errors, []);
assert.ok(Object.isFrozen(conformanceValidation));

const identity = createWebGpuInferenceKitIdentity();
assert.equal(identity.schema, WEBGPU_INFERENCE_KIT_IDENTITY_SCHEMA);
assert.equal(identity.authority, 'package-owned');
assert.equal(identity.packageName, PACKAGE_NAME);
assert.equal(identity.packageVersion, WEBGPU_INFERENCE_KIT_VERSION);
assert.match(identity.moduleUrl, /effective-adoption\.js$/);
assert.deepEqual(identity.capabilities, WEBGPU_INFERENCE_KIT_CAPABILITIES);
assert.ok(Object.isFrozen(identity));
assert.ok(Object.isFrozen(identity.capabilities));

const preflight = assertWebGpuInferenceKitAdoption(createPreflightInput());
assert.equal(preflight.schema, WEBGPU_INFERENCE_KIT_ADOPTION_PREFLIGHT_SCHEMA);
assert.equal(preflight.status, 'passed');
assert.equal(preflight.expectation.authority, 'consumer-declared');
assert.equal(preflight.expectation.packageVersion, '0.1.43');
assert.equal(preflight.packageIdentity.packageVersion, WEBGPU_INFERENCE_KIT_VERSION);
assert.equal(preflight.resolverAssessment.verification, 'unverified-diagnostic');
assert.equal(preflight.resolverAssessment.loadBearing, false);
assert.ok(preflight.checks.every(check => check.status === 'passed'));
assert.ok(Object.isFrozen(preflight));

captureFailedReceipt(
  () => assertWebGpuInferenceKitAdoption({
    ...createPreflightInput(),
    requestedPackage: { name: PACKAGE_NAME, version: WEBGPU_INFERENCE_KIT_VERSION },
    expectation: undefined,
    requiredCapabilities: WEBGPU_INFERENCE_KIT_CAPABILITIES,
  }),
  'consumer-expectation',
);

captureFailedReceipt(
  () => assertWebGpuInferenceKitAdoption(createPreflightInput({
    expectation: createExpectation({ packageVersion: '0.1.999' }),
  })),
  'expected-package-version',
);

captureFailedReceipt(
  () => assertWebGpuInferenceKitAdoption(createPreflightInput({
    callerClaims: { kitVersion: WEBGPU_INFERENCE_KIT_VERSION },
    resolver: createResolver({ packageVersion: '0.1.36' }),
  })),
  'resolver-package-version',
);

captureFailedReceipt(
  () => assertWebGpuInferenceKitAdoption(createPreflightInput({
    expectation: createExpectation({
      requiredCapabilities: [{
        capabilityId: 'adaptive-command-duty',
        schema: 'stale.capability.v0',
      }],
    }),
  })),
  'required-capabilities',
);

const directModulePreflight = assertWebGpuInferenceKitAdoption(createPreflightInput({
  resolver: createResolver({
    locatorKind: 'module-url',
    locator: identity.moduleUrl,
  }),
}));
assert.equal(directModulePreflight.resolverAssessment.verification, 'package-bound');
assert.equal(directModulePreflight.resolverAssessment.loadBearing, true);

captureFailedReceipt(
  () => assertWebGpuInferenceKitAdoption(createPreflightInput({
    resolver: createResolver({
      locatorKind: 'module-url',
      locator: 'https://stale.example/other-package.js',
    }),
  })),
  'resolver-locator-binding',
);

const bundledPreflight = assertWebGpuInferenceKitAdoption(createPreflightInput({
  resolver: createResolver({
    locatorKind: 'bundle-url',
    locator: 'https://app.example/assets/inference-worker.js',
  }),
}));
assert.equal(bundledPreflight.resolverAssessment.verification, 'unverified-diagnostic');
assert.equal(bundledPreflight.resolverAssessment.loadBearing, false);

const selfDeclaredPreflight = assertWebGpuInferenceKitAdoption(createPreflightInput({
  expectation: {
    schema: WEBGPU_INFERENCE_KIT_EXPECTATION_SCHEMA,
    authority: 'consumer-declared',
    expectationId: `self-consistency:${identity.packageVersion}`,
    packageName: identity.packageName,
    packageVersion: identity.packageVersion,
    requiredCapabilities: identity.capabilities,
  },
}));
assert.equal(selfDeclaredPreflight.status, 'passed');
assert.equal(selfDeclaredPreflight.expectation.authority, 'consumer-declared');

captureNormalizationFailure(
  () => assertWebGpuInferenceKitAdoption(createPreflightInput({
    callerClaims: { impossible: 1n },
  })),
  'preflight-input-normalization',
);
const cyclicClaims = {};
cyclicClaims.self = cyclicClaims;
captureNormalizationFailure(
  () => assertWebGpuInferenceKitAdoption(createPreflightInput({ callerClaims: cyclicClaims })),
  'preflight-input-normalization',
);
const throwingClaims = {};
Object.defineProperty(throwingClaims, 'broken', {
  enumerable: true,
  get() { throw new Error('throwing accessor'); },
});
captureNormalizationFailure(
  () => assertWebGpuInferenceKitAdoption(createPreflightInput({ callerClaims: throwingClaims })),
  'preflight-input-normalization',
);

const receipt = createWebGpuInferenceKitAdoptionReceipt({
  preflight,
  conformanceReport: conformance,
  terminalSettlement: createTerminalSettlement(),
});
assert.equal(receipt.schema, WEBGPU_INFERENCE_KIT_ADOPTION_RECEIPT_SCHEMA);
assert.equal(receipt.status, 'passed');
assert.equal(receipt.adoptionId, preflight.adoptionId);
assert.equal(receipt.preflight.status, 'passed');
assert.equal(receipt.conformanceValidation.ok, true);
assert.equal(receipt.terminalSettlement.outputIdentity.value, OUTPUT_SHA256);
assert.ok(receipt.checks.every(check => check.status === 'passed'));
assert.ok(Object.isFrozen(receipt));

const cyclicTerminal = createTerminalSettlement();
cyclicTerminal.self = cyclicTerminal;
captureNormalizationFailure(
  () => createWebGpuInferenceKitAdoptionReceipt({
    preflight,
    conformanceReport: conformance,
    terminalSettlement: cyclicTerminal,
  }),
  'terminal-input-normalization',
);

const forgedPreflight = {
  ...preflight,
  checks: [{ checkId: 'explicit-failure', status: 'failed' }],
  summary: { failedCheckCount: 0, failedCheckIds: [] },
};
const canonicalizedReceipt = createWebGpuInferenceKitAdoptionReceipt({
  preflight: forgedPreflight,
  conformanceReport: conformance,
  terminalSettlement: createTerminalSettlement(),
});
assert.ok(canonicalizedReceipt.preflight.checks.every(check => check.status === 'passed'));
assert.notDeepEqual(canonicalizedReceipt.preflight.checks, forgedPreflight.checks);

captureFailedReceipt(
  () => createWebGpuInferenceKitAdoptionReceipt({
    preflight,
    conformanceReport: {
      ...conformance,
      checks: [
        { checkId: 'explicit-conformance-failure', status: 'failed' },
        { checkId: 'invented-terminal-settlement', status: 'passed' },
      ],
      summary: { failedCheckCount: 0, failedCheckIds: [] },
    },
    terminalSettlement: createTerminalSettlement(),
  }),
  'conformance-report',
);

for (const mutate of [
  execution => { execution.schema = 'forged.execution.schema'; },
  execution => { execution.retention = 'capped'; },
  execution => { execution.inFlightGpuDutyCount = 37; },
  execution => { execution.inFlightGpuDutyIds = ['still-live']; },
  execution => { execution.unfencedSubmittedGpuDutyCount = 11; },
  execution => { execution.progress.schema = 'forged.progress'; },
  execution => { execution.failure.error.name = ''; },
]) {
  const forgedConformance = JSON.parse(JSON.stringify(conformance));
  mutate(forgedConformance.scenarios
    .find(scenario => scenario.scenario === 'runtime-failure').executionReport);
  captureFailedReceipt(
    () => createWebGpuInferenceKitAdoptionReceipt({
      preflight,
      conformanceReport: forgedConformance,
      terminalSettlement: createTerminalSettlement(),
    }),
    'conformance-report',
  );
}

captureFailedReceipt(
  () => createWebGpuInferenceKitAdoptionReceipt({
    preflight,
    conformanceReport: {
      ...conformance,
      adapterIdentity: {
        ...conformance.adapterIdentity,
        packageName: PACKAGE_NAME,
        packageVersion: WEBGPU_INFERENCE_KIT_VERSION,
      },
    },
    terminalSettlement: createTerminalSettlement(),
  }),
  'conformance-report',
);

captureFailedReceipt(
  () => createWebGpuInferenceKitAdoptionReceipt({
    preflight,
    conformanceReport: conformance,
    terminalSettlement: createTerminalSettlement({
      outputIdentity: { kind: 'sha256', value: 'sharp-canonical-ply' },
    }),
  }),
  'terminal-settlement',
);

const callerFingerprintReceipt = createWebGpuInferenceKitAdoptionReceipt({
  preflight,
  conformanceReport: conformance,
  terminalSettlement: createTerminalSettlement({
    outputIdentity: {
      kind: 'caller-fingerprint',
      authority: 'caller-declared',
      value: 'sharp-canonical-ply-v1',
    },
  }),
});
assert.equal(callerFingerprintReceipt.status, 'passed');
assert.equal(
  callerFingerprintReceipt.terminalSettlement.outputIdentity.authority,
  'caller-declared',
);

console.log('effective adoption contracts passed');
