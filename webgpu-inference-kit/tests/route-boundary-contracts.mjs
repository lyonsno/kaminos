import assert from 'node:assert/strict';

import {
  MOGE_DEPTH_NORMAL_ROUTE_ID,
  assertAuthoritativeRouteWorkerResult,
  createMogeDepthNormalRouteDefinition,
  createMogeDepthNormalRouteReceipt,
  createRouteInvocationRequest,
  createRouteWorkerResult,
  createWebGpuRouteRegistry,
  validateRouteDefinition,
  validateRouteInvocationRequest,
  validateRouteWorkerResult,
} from '../src/index.js';

const mogeRoute = createMogeDepthNormalRouteDefinition({
  kernel: {
    profile: 'conv-transpose2d-stride2',
    commit: '15d2dea',
  },
});

assert.equal(mogeRoute.schema, 'kaminos.webgpu-route-definition.v0');
assert.equal(mogeRoute.routeId, MOGE_DEPTH_NORMAL_ROUTE_ID);
assert.equal(mogeRoute.backendKind, 'webgpu-local');
assert.deepEqual(mogeRoute.requiredOutputRoles, ['depth', 'normal']);
assert.deepEqual(mogeRoute.optionalOutputRoles, ['pointmap', 'mask']);
assert.equal(validateRouteDefinition(mogeRoute).ok, true);

const registry = createWebGpuRouteRegistry([mogeRoute]);
assert.equal(registry.get(MOGE_DEPTH_NORMAL_ROUTE_ID).routeId, MOGE_DEPTH_NORMAL_ROUTE_ID);
assert.deepEqual(registry.list().map(route => route.routeId), [MOGE_DEPTH_NORMAL_ROUTE_ID]);
assert.throws(() => registry.register(mogeRoute), /duplicate route/i);
assert.throws(() => registry.get('missing.route'), /unknown route/i);

const request = createRouteInvocationRequest(mogeRoute, {
  requestId: 'req:moge-bunnycake',
  inputs: {
    'source-image': {
      artifactId: 'image:bunnycake',
      sha256: 'sha256:input',
      shape: [518, 518, 3],
    },
  },
  outputs: {
    depth: { artifactId: 'depth:bunnycake', shape: [592, 592] },
    normal: { artifactId: 'normal:bunnycake', shape: [3, 592, 592] },
    pointmap: { artifactId: 'pointmap:bunnycake', shape: [3, 592, 592] },
  },
  routeConfig: {
    targetSize: [592, 592],
    source: 'kiln.specimen-packet-cockpit.v0',
  },
});

assert.equal(request.schema, 'kaminos.webgpu-route-request.v0');
assert.equal(request.routeId, MOGE_DEPTH_NORMAL_ROUTE_ID);
assert.equal(request.inputs[0].artifactId, 'image:bunnycake');
assert.equal(request.outputs.length, 3);
assert.equal(validateRouteInvocationRequest(request, mogeRoute).ok, true);

const missingInputHash = {
  ...request,
  inputs: [{ ...request.inputs[0], sha256: '' }],
};
const missingInputHashResult = validateRouteInvocationRequest(missingInputHash, mogeRoute);
assert.equal(missingInputHashResult.ok, false);
assert.match(missingInputHashResult.errors.join('\n'), /sha256/);

const backend = {
  kind: 'webgpu-local',
  runtime: 'browser',
  adapterName: 'Apple M4 Max',
  browser: 'Chrome Headless',
  features: ['shader-f16', 'timestamp-query'],
  requestedFeatures: ['timestamp-query'],
  limits: { maxBufferSize: 4294967296, maxStorageBufferBindingSize: 2147483648 },
  timestampQuery: 'requested',
};

const profile = {
  schema: 'kaminos.webgpu-staged-profile.v0',
  route: 'staged-submits',
  timingSource: 'queue-submit-wait',
  requiredStages: ['backbone', 'decoder-heads', 'output-readback'],
  stages: [
    { name: 'backbone', ms: 997.6 },
    { name: 'decoder-heads', ms: 854.3 },
    { name: 'output-readback', ms: 1.9 },
  ],
  stageNames: ['backbone', 'decoder-heads', 'output-readback'],
  totalMs: 1853.8,
};

const receipt = createMogeDepthNormalRouteReceipt({
  input: request.inputs[0],
  outputs: {
    depth: { artifactId: 'depth:bunnycake', sha256: 'sha256:depth', shape: [592, 592] },
    normal: { artifactId: 'normal:bunnycake', sha256: 'sha256:normal', shape: [3, 592, 592] },
    pointMap: { artifactId: 'pointmap:bunnycake', sha256: 'sha256:pointmap', shape: [3, 592, 592] },
  },
  backend,
  model: {
    revision: 'local-vitl-normal',
    weightsHash: 'sha256:weights',
    dtype: 'fp16',
  },
  kernel: mogeRoute.kernel,
  profile,
});

const result = createRouteWorkerResult(mogeRoute, { request, receipt });
assert.equal(result.schema, 'kaminos.webgpu-route-result.v0');
assert.equal(result.requestId, request.requestId);
assert.equal(result.status, 'real');
assert.equal(result.outputs.length, 3);
assert.equal(validateRouteWorkerResult(result, mogeRoute).ok, true);
assert.doesNotThrow(() => assertAuthoritativeRouteWorkerResult(result, mogeRoute));

const routeMismatch = createRouteWorkerResult(mogeRoute, {
  request,
  receipt: { ...receipt, effectiveRouteId: 'moge.depth-normal.fixture.v0' },
});
const routeMismatchResult = validateRouteWorkerResult(routeMismatch, mogeRoute);
assert.equal(routeMismatchResult.ok, false);
assert.match(routeMismatchResult.errors.join('\n'), /effectiveRouteId/);

const fallbackResult = createRouteWorkerResult(mogeRoute, {
  request,
  receipt: {
    ...receipt,
    status: 'fallback',
    fallbackReason: 'WebGPU unavailable',
  },
});
assert.equal(validateRouteWorkerResult(fallbackResult, mogeRoute).ok, true);
assert.throws(
  () => assertAuthoritativeRouteWorkerResult(fallbackResult, mogeRoute),
  /not authoritative.*fallback/i,
);

const missingOutputHash = createRouteWorkerResult(mogeRoute, {
  request,
  receipt: {
    ...receipt,
    outputs: [{ ...receipt.outputs[0], sha256: '' }],
  },
});
const missingOutputHashResult = validateRouteWorkerResult(missingOutputHash, mogeRoute);
assert.equal(missingOutputHashResult.ok, false);
assert.match(missingOutputHashResult.errors.join('\n'), /outputs.*sha256/);

console.log('route boundary contracts passed');
