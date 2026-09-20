import assert from 'node:assert/strict';

import {
  createWebGpuBackendIdentity,
  createWebGpuInferenceSession,
  createWebGpuInferenceRuntime,
  requestBrowserWebGpuDevice,
  validateWebGpuBackendIdentity,
} from '../src/index.js';

// Absent-vs-empty feature capture must survive the PUBLIC construction
// paths, not only the low-level identity factory. The 0.1.47 review
// demonstrated that browser, runtime, and session constructors each
// converted a MISSING effective-feature observation into an authoritative
// empty (or substituted) feature list, so downstream validation could not
// distinguish "observed zero-feature device" from "observation missing."
// Contract: an explicitly captured empty collection is lawful; when every
// legitimate effective source is absent, the identity's features stay
// absent and validation fails loud. Requested features and adapter-support
// lists are NOT evidence of a device's enabled features.

const limits = { maxBufferSize: 1024, maxStorageBufferBindingSize: 512 };

function fakeGpu({ deviceFeatures }) {
  const device = {
    limits,
    queue: { submit() {}, onSubmittedWorkDone: async () => {} },
    lost: new Promise(() => {}),
  };
  if (deviceFeatures !== undefined) device.features = deviceFeatures;
  const adapter = {
    features: new Set(['adapter-only-support']),
    limits,
    info: { description: 'Fake Adapter' },
    requestDevice: async () => device,
  };
  return { gpu: { requestAdapter: async () => adapter }, device };
}

// --- requestBrowserWebGpuDevice -------------------------------------------

{
  const { gpu } = fakeGpu({ deviceFeatures: undefined });
  const { backendIdentity } = await requestBrowserWebGpuDevice(gpu, { timestampQuery: 'disable' });
  assert.equal(backendIdentity.features, undefined,
    'missing device.features must not be substituted from requested/adapter features');
  assert.equal(validateWebGpuBackendIdentity(backendIdentity).ok, false);
}

{
  const { gpu } = fakeGpu({ deviceFeatures: new Set() });
  const { backendIdentity } = await requestBrowserWebGpuDevice(gpu, { timestampQuery: 'disable' });
  assert.deepEqual(backendIdentity.features, [],
    'explicitly captured empty device feature set stays an empty list');
  assert.equal(validateWebGpuBackendIdentity(backendIdentity).ok, true);
}

// --- direct runtime wrapping ----------------------------------------------

{
  const { device } = fakeGpu({ deviceFeatures: undefined });
  const runtime = await createWebGpuInferenceRuntime({ device, adapterName: 'fake', routeId: 'test.absence.v0' });
  const identity = runtime.backendIdentity;
  assert.equal(identity.features, undefined,
    'runtime must not substitute adapter support or [] for missing capture');
  assert.equal(validateWebGpuBackendIdentity(identity).ok, false);
}

{
  const { device } = fakeGpu({ deviceFeatures: new Set() });
  const runtime = await createWebGpuInferenceRuntime({ device, adapterName: 'fake', routeId: 'test.absence.v0' });
  assert.deepEqual(runtime.backendIdentity.features, []);
  assert.equal(validateWebGpuBackendIdentity(runtime.backendIdentity).ok, true);
}

// --- borrowed-device session ----------------------------------------------

{
  const { device } = fakeGpu({ deviceFeatures: undefined });
  const session = await createWebGpuInferenceSession({ device, adapterName: 'fake', sessionId: 'test-absence-session' });
  const identity = session.backendIdentity;
  assert.equal(identity.features, undefined,
    'borrowed-device session must not manufacture [] for missing capture');
  assert.equal(validateWebGpuBackendIdentity(identity).ok, false);
  await session.close?.();
}

{
  const { device } = fakeGpu({ deviceFeatures: [] });
  const session = await createWebGpuInferenceSession({ device, adapterName: 'fake', sessionId: 'test-absence-session' });
  assert.deepEqual(session.backendIdentity.features, []);
  assert.equal(validateWebGpuBackendIdentity(session.backendIdentity).ok, true);
  await session.close?.();
}

// --- Limits obey the same absent-vs-observed law ---------------------------
// The r2 review showed adapter-supported limits substituting for a missing
// effective-device observation through the browser and runtime constructors,
// presenting support/request evidence as captured device state.

{
  const device = {
    features: new Set(),
    queue: { submit() {}, onSubmittedWorkDone: async () => {} },
    lost: new Promise(() => {}),
  }; // deliberately NO limits
  const adapter = {
    features: new Set(),
    limits,
    info: { description: 'Fake Adapter' },
    requestDevice: async () => device,
  };
  const { backendIdentity } = await requestBrowserWebGpuDevice(
    { requestAdapter: async () => adapter }, { timestampQuery: 'disable' });
  assert.equal(validateWebGpuBackendIdentity(backendIdentity).ok, false,
    'missing device.limits must not be papered over with adapter support limits');
}

{
  const device = {
    features: new Set(),
    queue: { submit() {}, onSubmittedWorkDone: async () => {} },
    lost: new Promise(() => {}),
  }; // NO limits
  const runtime = await createWebGpuInferenceRuntime({
    device, adapterName: 'fake', routeId: 'test.absence.v0',
    adapter: { limits },
  });
  assert.equal(validateWebGpuBackendIdentity(runtime.backendIdentity).ok, false,
    'runtime must not substitute adapter limits for missing device capture');
}

// Amended contract note (unbuild review, finding 2): 'explicitly observed
// empty is lawful' applies to FEATURES only — a zero-feature device is
// WebGPU-spec-legal. Limits are different physics: every real device
// reports limits, so an empty limits observation is never a lawful
// identity, whether absent or explicitly {}. Both fail loud, deliberately.

{
  const identity = createWebGpuBackendIdentity({
    adapterName: 'Fake Adapter', browser: 'test',
    requestedFeatures: [], effectiveFeatures: [],
    limits: {}, timestampQuery: 'unavailable',
  });
  assert.equal(validateWebGpuBackendIdentity(identity).ok, false,
    'an explicitly empty limits object is not a lawful identity');
}

{
  const device = {
    features: new Set(),
    limits: {},
    queue: { submit() {}, onSubmittedWorkDone: async () => {} },
    lost: new Promise(() => {}),
  };
  const { backendIdentity } = await requestBrowserWebGpuDevice(
    { requestAdapter: async () => ({ features: new Set(), limits, info: {}, requestDevice: async () => device }) },
    { timestampQuery: 'disable' });
  assert.equal(validateWebGpuBackendIdentity(backendIdentity).ok, false,
    'browser acquisition of a device reporting empty limits fails validation');
  const runtime = await createWebGpuInferenceRuntime({ device, adapterName: 'fake', routeId: 'test.absence.v0' });
  assert.equal(validateWebGpuBackendIdentity(runtime.backendIdentity).ok, false);
  const session = await createWebGpuInferenceSession({ device, adapterName: 'fake', sessionId: 'test-empty-limits' });
  assert.equal(validateWebGpuBackendIdentity(session.backendIdentity).ok, false);
}

console.log('feature capture absence contracts passed');
