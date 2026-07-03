import assert from 'node:assert/strict';

import {
  MOGE_DEPTH_NORMAL_ROUTE_ID,
  assertAuthoritativeRouteReceipt,
  createMogeDepthNormalRouteReceipt,
  validateRouteReceipt,
} from '../src/index.js';

const receipt = createMogeDepthNormalRouteReceipt({
  input: {
    artifactId: 'image:bunnycake',
    sha256: 'sha256:input',
    shape: [518, 518, 3],
  },
  outputs: {
    depth: { artifactId: 'depth:bunnycake', sha256: 'sha256:depth', shape: [592, 592] },
    normal: { artifactId: 'normal:bunnycake', sha256: 'sha256:normal', shape: [3, 592, 592] },
    pointMap: { artifactId: 'pointmap:bunnycake', sha256: 'sha256:pointmap', shape: [3, 592, 592] },
  },
  backend: {
    kind: 'webgpu-local',
    runtime: 'browser',
    adapterName: 'Apple M4 Max',
    features: ['timestamp-query'],
    requestedFeatures: ['timestamp-query'],
    limits: { maxBufferSize: 4294967296 },
    timestampQuery: 'requested',
  },
  model: {
    revision: 'local-vitl-normal',
    weightsHash: 'sha256:weights',
    dtype: 'fp16',
  },
  kernel: {
    profile: 'conv-transpose2d-stride2',
    commit: '003763d',
  },
  profile: {
    schema: 'kaminos.webgpu-staged-profile.v0',
    route: 'staged-submits',
    timingSource: 'queue-submit-wait',
    requiredStages: ['backbone', 'decoder-heads', 'output-readback'],
    stages: [
      { name: 'backbone', ms: 1007.9 },
      { name: 'decoder-heads', ms: 854.2 },
      { name: 'output-readback', ms: 1.8 },
    ],
    stageNames: ['backbone', 'decoder-heads', 'output-readback'],
    totalMs: 1863.9,
  },
});

assert.equal(MOGE_DEPTH_NORMAL_ROUTE_ID, 'moge.depth-normal.webgpu-local.v0');
assert.equal(receipt.requestedRouteId, MOGE_DEPTH_NORMAL_ROUTE_ID);
assert.equal(receipt.effectiveRouteId, MOGE_DEPTH_NORMAL_ROUTE_ID);
assert.equal(receipt.model.id, 'Ruicheng/moge-2-vitl-normal');
assert.equal(receipt.kernel.profile, 'conv-transpose2d-stride2');
assert.equal(receipt.outputs.length, 3);
assert.equal(validateRouteReceipt(receipt).ok, true);
assert.doesNotThrow(() => assertAuthoritativeRouteReceipt(receipt));

const fallback = createMogeDepthNormalRouteReceipt({
  ...receipt,
  status: 'fallback',
  fallbackReason: 'WebGPU unavailable',
  input: {
    artifactId: 'image:bunnycake',
    sha256: 'sha256:input',
    shape: [518, 518, 3],
  },
  outputs: {
    depth: { artifactId: 'depth:bunnycake', sha256: 'sha256:depth', shape: [592, 592] },
    normal: { artifactId: 'normal:bunnycake', sha256: 'sha256:normal', shape: [3, 592, 592] },
  },
  backend: receipt.backend,
  model: receipt.model,
  kernel: receipt.kernel,
  profile: receipt.timings.profile,
});
assert.throws(() => assertAuthoritativeRouteReceipt(fallback), /not authoritative.*fallback/i);

assert.throws(
  () => createMogeDepthNormalRouteReceipt({
    input: { artifactId: 'image:bunnycake', sha256: 'sha256:input', shape: [518, 518, 3] },
    outputs: {},
    backend: receipt.backend,
    model: receipt.model,
    kernel: receipt.kernel,
    profile: receipt.timings.profile,
  }),
  /depth output/,
);

console.log('moge route contracts passed');
