import assert from 'node:assert/strict';

import {
  classifyWebGpuRouteReceiptEvidence,
  createMogeDepthNormalRouteDefinition,
  createMogeDepthNormalRouteReceipt,
  createRouteWorkerResult,
  classifyWebGpuRouteWorkerResultEvidence,
} from '../src/index.js';

const route = createMogeDepthNormalRouteDefinition({
  kernel: { profile: 'conv-transpose2d-stride2' },
});

const backend = {
  kind: 'webgpu-local',
  runtime: 'browser',
  adapterName: 'Apple M4 Max',
  browser: 'Chrome Headless',
  features: ['shader-f16', 'timestamp-query'],
  requestedFeatures: ['timestamp-query'],
  limits: {
    maxBufferSize: 4294967296,
    maxStorageBufferBindingSize: 2147483648,
  },
  timestampQuery: 'requested',
};

const profile = {
  schema: 'kaminos.webgpu-staged-profile.v0',
  route: 'staged-submits',
  timingSource: 'queue-submit-wait',
  requiredStages: ['backbone', 'decoder-heads', 'output-readback'],
  stages: [
    { name: 'backbone', ms: 1000 },
    { name: 'decoder-heads', ms: 850 },
    { name: 'output-readback', ms: 2 },
  ],
};

const receipt = createMogeDepthNormalRouteReceipt({
  input: {
    artifactId: 'image:bunnycake',
    sha256: 'sha256:input',
    shape: [518, 518, 3],
  },
  outputs: {
    depth: { artifactId: 'depth:bunnycake', sha256: 'sha256:depth', shape: [592, 592] },
    normal: { artifactId: 'normal:bunnycake', sha256: 'sha256:normal', shape: [3, 592, 592] },
  },
  backend,
  model: {
    revision: 'local-vitl-normal',
    weightsHash: 'sha256:weights',
    dtype: 'fp16',
  },
  kernel: route.kernel,
  profile,
});

const authoritative = classifyWebGpuRouteReceiptEvidence(receipt, {
  expectedRouteId: route.routeId,
  now: receipt.createdAt,
});
assert.equal(authoritative.schema, 'kaminos.webgpu-route-evidence-classification.v0');
assert.equal(authoritative.classification, 'authoritative-live-webgpu');
assert.equal(authoritative.authoritative, true);
assert.equal(authoritative.routeId, route.routeId);
assert.deepEqual(authoritative.outputRoles, ['depth', 'normal']);
assert.equal(authoritative.timingSource, 'queue-submit-wait');

const fallback = classifyWebGpuRouteReceiptEvidence({
  ...receipt,
  status: 'fallback',
  fallbackReason: 'WebGPU unavailable',
});
assert.equal(fallback.classification, 'fallback');
assert.equal(fallback.authoritative, false);
assert.match(fallback.reasons.join('\n'), /fallback/);

const partial = classifyWebGpuRouteReceiptEvidence({
  ...receipt,
  outputs: [{ ...receipt.outputs[0], status: 'partial' }],
});
assert.equal(partial.classification, 'partial');
assert.equal(partial.authoritative, false);

const cached = classifyWebGpuRouteReceiptEvidence({
  ...receipt,
  status: 'cached',
});
assert.equal(cached.classification, 'cache');
assert.equal(cached.authoritative, false);

const stale = classifyWebGpuRouteReceiptEvidence(receipt, {
  maxAgeMs: 1000,
  now: new Date(Date.parse(receipt.createdAt) + 2000).toISOString(),
});
assert.equal(stale.classification, 'stale');
assert.equal(stale.authoritative, false);

const invalid = classifyWebGpuRouteReceiptEvidence({
  ...receipt,
  backend: { ...receipt.backend, adapterName: '' },
});
assert.equal(invalid.classification, 'invalid');
assert.equal(invalid.authoritative, false);
assert.match(invalid.reasons.join('\n'), /adapterName/);

const workerResult = createRouteWorkerResult(route, {
  request: {
    requestId: 'req:moge-bunnycake',
  },
  receipt,
});
const workerClassification = classifyWebGpuRouteWorkerResultEvidence(workerResult, {
  expectedRouteId: route.routeId,
  now: receipt.createdAt,
});
assert.equal(workerClassification.classification, 'authoritative-live-webgpu');
assert.equal(workerClassification.requestId, 'req:moge-bunnycake');

console.log('route receipt consumer contracts passed');
