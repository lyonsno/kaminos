import assert from 'node:assert/strict';

import {
  assertAuthoritativeRouteReceipt,
  createWebGpuLocalRouteReceipt,
  validateRouteReceipt,
} from '../src/index.js';

const baseReceipt = createWebGpuLocalRouteReceipt({
  requestedRouteId: 'moge.depth-normal.webgpu-local.v0',
  effectiveRouteId: 'moge.depth-normal.webgpu-local.v0',
  backend: {
    kind: 'webgpu-local',
    runtime: 'browser',
    adapterName: 'Apple M4 Max',
    features: ['timestamp-query'],
    timestampQuery: 'available',
  },
  model: {
    id: 'Ruicheng/moge-2-vitl-normal',
    revision: 'local-fixture',
    weightsHash: 'sha256:weights',
    dtype: 'fp16',
  },
  kernel: {
    kitVersion: '0.0.0',
    profile: 'conv-transpose2d-stride2',
    commit: '003763d',
  },
  inputs: [
    { role: 'source-image', artifactId: 'image:fixture', sha256: 'sha256:input' },
  ],
  outputs: [
    { role: 'depth', artifactId: 'depth:fixture', sha256: 'sha256:depth', shape: [592, 592], status: 'real' },
    { role: 'normal', artifactId: 'normal:fixture', sha256: 'sha256:normal', shape: [3, 592, 592], status: 'real' },
  ],
  timings: {
    source: 'staged-submit',
    totalMs: 2078.4,
    stages: [
      { name: 'backbone', ms: 1005.2 },
      { name: 'decoder-heads', ms: 1073.2 },
    ],
  },
});

assert.equal(baseReceipt.schema, 'kaminos.webgpu-route-receipt.v0');
assert.equal(baseReceipt.backend.kind, 'webgpu-local');
assert.equal(baseReceipt.status, 'real');
assert.equal(validateRouteReceipt(baseReceipt).ok, true);
assert.doesNotThrow(() => assertAuthoritativeRouteReceipt(baseReceipt));

const fallbackReceipt = {
  ...baseReceipt,
  status: 'fallback',
  fallbackReason: 'WebGPU unavailable; would use WASM',
};
assert.equal(validateRouteReceipt(fallbackReceipt).ok, true, 'fallback receipts are valid evidence');
assert.throws(
  () => assertAuthoritativeRouteReceipt(fallbackReceipt),
  /not authoritative.*fallback/i,
  'fallback evidence must not masquerade as authoritative route output',
);

const partialOutputReceipt = {
  ...baseReceipt,
  outputs: [
    { role: 'depth', artifactId: 'depth:fixture', sha256: 'sha256:depth', shape: [592, 592], status: 'partial' },
  ],
};
assert.throws(
  () => assertAuthoritativeRouteReceipt(partialOutputReceipt),
  /partial output/i,
  'partial output must fail loud before becoming authoritative Kaminos evidence',
);

const missingEffectiveRoute = {
  ...baseReceipt,
  effectiveRouteId: '',
};
const missingResult = validateRouteReceipt(missingEffectiveRoute);
assert.equal(missingResult.ok, false);
assert.match(missingResult.errors.join('\n'), /effectiveRouteId/);

console.log('receipt contracts passed');
