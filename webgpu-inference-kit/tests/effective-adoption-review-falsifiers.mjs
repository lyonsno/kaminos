import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_REPORT_SCHEMA,
  WEBGPU_INFERENCE_KIT_EXPECTATION_SCHEMA,
  WEBGPU_INFERENCE_KIT_VERSION,
  assertWebGpuInferenceKitAdoption,
  createWebGpuInferenceKitAdoptionReceipt,
  defineWebGpuCooperativeBoundaryManifest,
  runWebGpuCooperativeAdapterConformance,
  validateWebGpuCooperativeAdapterConformanceReport,
} from '../src/index.js';

const PACKAGE_NAME = '@kaminos/webgpu-inference-kit';
const ROUTE_ID = 'sharp.image-to-splat.webgpu-local.v0';
const ADAPTER_ID = 'sharp.browser-webgpu.v0';
const ADAPTER_PACKAGE_NAME = '@kaminos/sharp-webgpu';
const ADAPTER_PACKAGE_VERSION = '0.1.0';
const SOURCE_REVISION = 'sharp-stage-zero-review-falsifier';
const VALID_SHA256 = 'a'.repeat(64);

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

function createLegacyPreflightInput(overrides = {}) {
  return {
    adoptionId: 'sharp:stage-zero:review-falsifier',
    requestedPackage: {
      name: PACKAGE_NAME,
      version: WEBGPU_INFERENCE_KIT_VERSION,
    },
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
    requiredCapabilities: [{
      capabilityId: 'adaptive-command-duty',
      schema: 'kaminos.webgpu-adaptive-command-duty-planner.v0',
    }],
    ...overrides,
  };
}

function createPreflightInput(overrides = {}) {
  return {
    adoptionId: 'sharp:stage-zero:review-falsifier',
    expectation: {
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
    },
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
      value: VALID_SHA256,
    },
    ...overrides,
  };
}

function expectFailedReceipt(run, expectedCheckId) {
  assert.throws(run, error => {
    assert.equal(error.name, 'WebGpuInferenceKitAdoptionError');
    assert.equal(error.receipt.status, 'failed');
    assert.ok(error.receipt.checks.some(
      check => check.checkId === expectedCheckId && check.status === 'failed',
    ));
    return true;
  });
}

const manifest = defineWebGpuCooperativeBoundaryManifest({
  manifestId: 'sharp.stage-zero-review-falsifier.v0',
  routeId: ROUTE_ID,
  phases: [{
    phaseId: 'image-feature-extraction',
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

const actualConformance = await runWebGpuCooperativeAdapterConformance({
  conformanceId: 'sharp:stage-zero:actual-conformance',
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
    return { outputFingerprint: `sha256:${VALID_SHA256}` };
  },
});
const actualConformanceValidation = validateWebGpuCooperativeAdapterConformanceReport(
  actualConformance,
);
assert.deepEqual(actualConformanceValidation.errors, []);
assert.equal(actualConformanceValidation.ok, true);

test('consumer expectations cannot be derived from legacy loaded-package exports', () => {
  expectFailedReceipt(
    () => assertWebGpuInferenceKitAdoption(createLegacyPreflightInput()),
    'consumer-expectation',
  );
});

test('terminal certification rejects sparse contradictory conformance objects', () => {
  const preflight = assertWebGpuInferenceKitAdoption(createPreflightInput());
  expectFailedReceipt(
    () => createWebGpuInferenceKitAdoptionReceipt({
      preflight,
      conformanceReport: {
        schema: WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_REPORT_SCHEMA,
        status: 'passed',
        conformanceId: 'sharp:forged-conformance',
        routeId: ROUTE_ID,
        kitVersion: WEBGPU_INFERENCE_KIT_VERSION,
        adapterIdentity: {
          adapterId: ADAPTER_ID,
          routeId: ROUTE_ID,
          packageName: PACKAGE_NAME,
          packageVersion: WEBGPU_INFERENCE_KIT_VERSION,
          sourceRevision: SOURCE_REVISION,
        },
        checks: [
          { checkId: 'explicit-conformance-failure', status: 'failed' },
          { checkId: 'invented-terminal-settlement', status: 'passed' },
          { checkId: 'no-pending-terminal-ranges', status: 'passed' },
        ],
        summary: { failedCheckCount: 0, failedCheckIds: [] },
      },
      terminalSettlement: createTerminalSettlement(),
    }),
    'conformance-report',
  );
});

test('terminal receipts embed canonical revalidation rather than a forged preflight', () => {
  const preflight = assertWebGpuInferenceKitAdoption(createPreflightInput());
  const forgedPreflight = {
    ...preflight,
    checks: [{ checkId: 'explicit-preflight-failure', status: 'failed' }],
    summary: { failedCheckCount: 0, failedCheckIds: [] },
  };
  const receipt = createWebGpuInferenceKitAdoptionReceipt({
    preflight: forgedPreflight,
    conformanceReport: actualConformance,
    terminalSettlement: createTerminalSettlement(),
  });
  assert.notStrictEqual(receipt.preflight, forgedPreflight);
  assert.ok(receipt.preflight.checks.every(check => check.status === 'passed'));
  assert.equal(receipt.preflight.summary.failedCheckCount, 0);
});

test('direct module URL observations bind to package-owned module identity', () => {
  expectFailedReceipt(
    () => assertWebGpuInferenceKitAdoption(createPreflightInput({
      resolver: createResolver({
        locatorKind: 'module-url',
        locator: 'https://stale.example/other-package.js',
      }),
    })),
    'resolver-locator-binding',
  );
});

test('sha256 terminal identity rejects labels and malformed digests', () => {
  const preflight = assertWebGpuInferenceKitAdoption(createPreflightInput());
  expectFailedReceipt(
    () => createWebGpuInferenceKitAdoptionReceipt({
      preflight,
      conformanceReport: actualConformance,
      terminalSettlement: createTerminalSettlement({
        outputIdentity: { kind: 'sha256', value: 'not-a-sha256-digest' },
      }),
    }),
    'terminal-settlement',
  );
});
