import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

for (const exportName of [
  'WEBGPU_INFERENCE_KIT_ADOPTION_PREFLIGHT_SCHEMA',
  'WEBGPU_INFERENCE_KIT_ADOPTION_RECEIPT_SCHEMA',
  'WEBGPU_INFERENCE_KIT_IDENTITY_SCHEMA',
  'WEBGPU_INFERENCE_KIT_CAPABILITIES',
  'assertWebGpuInferenceKitAdoption',
  'createWebGpuInferenceKitAdoptionReceipt',
  'createWebGpuInferenceKitIdentity',
]) {
  assert.notEqual(kit[exportName], undefined, `the package must export ${exportName}`);
}

const {
  WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_REPORT_SCHEMA,
  WEBGPU_INFERENCE_KIT_ADOPTION_PREFLIGHT_SCHEMA,
  WEBGPU_INFERENCE_KIT_ADOPTION_RECEIPT_SCHEMA,
  WEBGPU_INFERENCE_KIT_CAPABILITIES,
  WEBGPU_INFERENCE_KIT_IDENTITY_SCHEMA,
  WEBGPU_INFERENCE_KIT_VERSION,
  assertWebGpuInferenceKitAdoption,
  createWebGpuInferenceKitAdoptionReceipt,
  createWebGpuInferenceKitIdentity,
} = kit;

const PACKAGE_NAME = '@kaminos/webgpu-inference-kit';
const ROUTE_ID = 'sharp.image-to-splat.webgpu-local.v0';
const ADAPTER_ID = 'sharp.browser-webgpu.v0';

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
    requestedPackage: {
      name: PACKAGE_NAME,
      version: WEBGPU_INFERENCE_KIT_VERSION,
    },
    consumer: {
      consumerId: 'sharp-webgpu',
      sourceRevision: 'sharp-stage-zero-fixture',
      routeId: ROUTE_ID,
      adapterId: ADAPTER_ID,
    },
    resolver: createResolver(),
    requiredCapabilities: WEBGPU_INFERENCE_KIT_CAPABILITIES.slice(0, 3),
    ...overrides,
  };
}

function createConformanceReport(overrides = {}) {
  return {
    schema: WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_REPORT_SCHEMA,
    status: 'passed',
    conformanceId: 'sharp:adapter:current-kit',
    routeId: ROUTE_ID,
    manifestId: 'sharp.cooperative-boundaries.v0',
    kitVersion: WEBGPU_INFERENCE_KIT_VERSION,
    adapterIdentity: {
      adapterId: ADAPTER_ID,
      routeId: ROUTE_ID,
      packageName: PACKAGE_NAME,
      packageVersion: WEBGPU_INFERENCE_KIT_VERSION,
      sourceRevision: 'sharp-stage-zero-fixture',
    },
    checks: [
      { checkId: 'effective-runtime-identity', status: 'passed' },
      { checkId: 'cooperative-success-terminal-settlement', status: 'passed' },
      { checkId: 'disabled-success-terminal-settlement', status: 'passed' },
      { checkId: 'no-pending-terminal-ranges', status: 'passed' },
    ],
    summary: {
      failedCheckCount: 0,
      failedCheckIds: [],
    },
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
      value: 'sharp-canonical-ply',
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

const identity = createWebGpuInferenceKitIdentity();
assert.equal(identity.schema, WEBGPU_INFERENCE_KIT_IDENTITY_SCHEMA);
assert.equal(identity.packageName, PACKAGE_NAME);
assert.equal(identity.packageVersion, WEBGPU_INFERENCE_KIT_VERSION);
assert.match(identity.moduleUrl, /effective-adoption\.js$/);
assert.deepEqual(identity.capabilities, WEBGPU_INFERENCE_KIT_CAPABILITIES);
assert.ok(Object.isFrozen(identity));
assert.ok(Object.isFrozen(identity.capabilities));

const preflight = assertWebGpuInferenceKitAdoption(createPreflightInput());
assert.equal(preflight.schema, WEBGPU_INFERENCE_KIT_ADOPTION_PREFLIGHT_SCHEMA);
assert.equal(preflight.status, 'passed');
assert.equal(preflight.packageIdentity.packageVersion, WEBGPU_INFERENCE_KIT_VERSION);
assert.equal(preflight.resolver.authority, 'consumer-observed');
assert.equal(preflight.consumer.routeId, ROUTE_ID);
assert.ok(preflight.checks.every(check => check.status === 'passed'));
assert.ok(Object.isFrozen(preflight));

captureFailedReceipt(
  () => assertWebGpuInferenceKitAdoption(createPreflightInput({
    requestedPackage: { name: PACKAGE_NAME, version: '0.1.999' },
  })),
  'requested-package-version',
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
    resolver: createResolver({ locator: '' }),
  })),
  'resolver-identity',
);

captureFailedReceipt(
  () => assertWebGpuInferenceKitAdoption(createPreflightInput({
    requiredCapabilities: [{
      capabilityId: WEBGPU_INFERENCE_KIT_CAPABILITIES[0].capabilityId,
      schema: 'stale.capability.v0',
    }],
  })),
  'required-capabilities',
);

const bundledPreflight = assertWebGpuInferenceKitAdoption(createPreflightInput({
  resolver: createResolver({
    locatorKind: 'bundle-url',
    locator: 'https://app.example/assets/inference-worker.js',
  }),
}));
assert.equal(bundledPreflight.resolver.locatorKind, 'bundle-url');
assert.equal(bundledPreflight.resolver.locator, 'https://app.example/assets/inference-worker.js');
assert.equal(bundledPreflight.resolver.packagePath, undefined);

const receipt = createWebGpuInferenceKitAdoptionReceipt({
  preflight,
  conformanceReport: createConformanceReport(),
  terminalSettlement: createTerminalSettlement(),
});
assert.equal(receipt.schema, WEBGPU_INFERENCE_KIT_ADOPTION_RECEIPT_SCHEMA);
assert.equal(receipt.status, 'passed');
assert.equal(receipt.adoptionId, preflight.adoptionId);
assert.equal(receipt.packageIdentity.packageVersion, WEBGPU_INFERENCE_KIT_VERSION);
assert.equal(receipt.conformance.conformanceId, 'sharp:adapter:current-kit');
assert.equal(receipt.terminalSettlement.outputIdentity.value, 'sharp-canonical-ply');
assert.ok(receipt.checks.every(check => check.status === 'passed'));
assert.ok(Object.isFrozen(receipt));

captureFailedReceipt(
  () => createWebGpuInferenceKitAdoptionReceipt({
    preflight: {
      ...preflight,
      resolver: createResolver({ packageVersion: '0.1.36' }),
      checks: preflight.checks.map(check => ({ ...check, status: 'passed' })),
      summary: {
        ...preflight.summary,
        failedCheckCount: 0,
        failedCheckIds: [],
      },
    },
    conformanceReport: createConformanceReport(),
    terminalSettlement: createTerminalSettlement(),
  }),
  'adoption-preflight',
);

captureFailedReceipt(
  () => createWebGpuInferenceKitAdoptionReceipt({
    preflight,
    conformanceReport: createConformanceReport({
      checks: [
        { checkId: 'effective-runtime-identity', status: 'passed' },
      ],
    }),
    terminalSettlement: createTerminalSettlement(),
  }),
  'conformance-terminal-settlement',
);

captureFailedReceipt(
  () => createWebGpuInferenceKitAdoptionReceipt({
    preflight,
    conformanceReport: createConformanceReport({ kitVersion: '0.1.36' }),
    terminalSettlement: createTerminalSettlement(),
  }),
  'conformance-package-version',
);

captureFailedReceipt(
  () => createWebGpuInferenceKitAdoptionReceipt({
    preflight,
    conformanceReport: createConformanceReport({
      adapterIdentity: {
        ...createConformanceReport().adapterIdentity,
        packageVersion: '0.1.36',
      },
    }),
    terminalSettlement: createTerminalSettlement(),
  }),
  'conformance-consumer-identity',
);

captureFailedReceipt(
  () => createWebGpuInferenceKitAdoptionReceipt({
    preflight,
    conformanceReport: createConformanceReport(),
    terminalSettlement: createTerminalSettlement({
      status: 'failed',
      failurePhase: 'output-capture',
      activeWorkCount: 1,
      outputIdentity: null,
    }),
  }),
  'terminal-settlement',
);

console.log('effective adoption contracts passed');
