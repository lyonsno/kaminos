import assert from 'node:assert/strict';

import {
  SHARP_IMAGE_TO_SPLAT_ROUTE_ID,
  assertAuthoritativeRouteReceipt,
  createRouteInvocationRequest,
  createRouteWorkerResult,
  createSharpImageToSplatRouteDefinition,
  createSharpImageToSplatRouteReceipt,
  createWebGpuRouteRegistry,
  validateRouteDefinition,
  validateRouteReceipt,
  validateRouteWorkerResult,
} from '../src/index.js';

const backend = {
  kind: 'webgpu-local',
  runtime: 'browser',
  adapterName: 'Apple M4 Max',
  browser: 'Chrome Headless',
  features: ['shader-f16'],
  requestedFeatures: [],
  limits: {
    maxBufferSize: 4294967296,
    maxStorageBufferBindingSize: 2147483648,
  },
  timestampQuery: 'unavailable',
};

const profile = {
  schema: 'kaminos.webgpu-staged-profile.v0',
  route: 'browser-adapter',
  timingSource: 'adapter-phase-wall-clock',
  requiredStages: ['spn', 'monodepth', 'gaussian-decoder', 'compose-ply', 'output-capture'],
  stages: [
    { name: 'spn', ms: 18000 },
    { name: 'monodepth', ms: 2100 },
    { name: 'gaussian-decoder', ms: 2300 },
    { name: 'compose-ply', ms: 700 },
    { name: 'output-capture', ms: 400 },
  ],
  stageNames: ['spn', 'monodepth', 'gaussian-decoder', 'compose-ply', 'output-capture'],
  totalMs: 23500,
};

const route = createSharpImageToSplatRouteDefinition({
  kernel: {
    profile: 'spn-dinov2l16-monodepth-gaussian-ply',
    commit: 'b84aece',
  },
});

assert.equal(SHARP_IMAGE_TO_SPLAT_ROUTE_ID, 'sharp.image-to-splat.webgpu-local.v0');
assert.equal(route.routeId, SHARP_IMAGE_TO_SPLAT_ROUTE_ID);
assert.equal(route.backendKind, 'webgpu-local');
assert.deepEqual(route.requiredOutputRoles, ['splat-candidate', 'depth-map', 'sharp-webgpu-metadata']);
assert.deepEqual(route.optionalOutputRoles, ['splat-autocrop-evidence']);
assert.equal(validateRouteDefinition(route).ok, true);

const registry = createWebGpuRouteRegistry([route]);
assert.equal(registry.get(SHARP_IMAGE_TO_SPLAT_ROUTE_ID).routeId, SHARP_IMAGE_TO_SPLAT_ROUTE_ID);

const request = createRouteInvocationRequest(route, {
  requestId: 'req:sharp-cake',
  inputs: {
    'source-image': {
      artifactId: 'image:cake',
      sha256: 'sha256:input',
      shape: [1536, 1536, 3],
    },
  },
  outputs: {
    'splat-candidate': { artifactId: 'splat:cake-ply', shape: [1179648, 14] },
    'depth-map': { artifactId: 'depth:cake-png', shape: [768, 768, 4] },
    'sharp-webgpu-metadata': { artifactId: 'metadata:cake-json', shape: [1] },
    'splat-autocrop-evidence': { artifactId: 'autocrop:cake-json', shape: [1] },
  },
  routeConfig: {
    adapterReportSchema: 'kaminos.sharp-webgpu-adapter-report.v0',
    pipelineRouteId: 'adapter.sharp-image-to-splat-live.v0',
  },
});

const receipt = createSharpImageToSplatRouteReceipt({
  input: request.inputs[0],
  outputs: {
    splat: { artifactId: 'splat:cake-ply', sha256: 'sha256:ply', shape: [1179648, 14] },
    depthMap: { artifactId: 'depth:cake-png', sha256: 'sha256:depth', shape: [768, 768, 4] },
    metadata: { artifactId: 'metadata:cake-json', sha256: 'sha256:metadata', shape: [1] },
    autoCropEvidence: { artifactId: 'autocrop:cake-json', sha256: 'sha256:autocrop', shape: [1] },
  },
  backend,
  model: {
    revision: 'local-sharp-webgpu',
    weightsHash: 'sha256:weights',
    dtype: 'fp16',
  },
  kernel: route.kernel,
  profile,
});

assert.equal(receipt.requestedRouteId, SHARP_IMAGE_TO_SPLAT_ROUTE_ID);
assert.equal(receipt.model.id, 'apple/ml-sharp');
assert.equal(receipt.backend.runtime, 'browser');
assert.equal(receipt.outputs.map(output => output.role).join(','), 'splat-candidate,depth-map,sharp-webgpu-metadata,splat-autocrop-evidence');
assert.equal(validateRouteReceipt(receipt).ok, true);
assert.doesNotThrow(() => assertAuthoritativeRouteReceipt(receipt));

const result = createRouteWorkerResult(route, { request, receipt });
assert.equal(validateRouteWorkerResult(result, route).ok, true);

assert.throws(
  () => createSharpImageToSplatRouteReceipt({
    input: request.inputs[0],
    outputs: {
      splat: { artifactId: 'splat:cake-ply', sha256: 'sha256:ply', shape: [1179648, 14] },
      depthMap: { artifactId: 'depth:cake-png', sha256: 'sha256:depth', shape: [768, 768, 4] },
    },
    backend,
    model: {
      revision: 'local-sharp-webgpu',
      weightsHash: 'sha256:weights',
      dtype: 'fp16',
    },
    kernel: route.kernel,
    profile,
  }),
  /metadata output is required/,
);

assert.throws(
  () => createSharpImageToSplatRouteReceipt({
    input: request.inputs[0],
    outputs: {
      splat: { artifactId: 'splat:cake-ply', sha256: 'sha256:ply', shape: [1179648, 14] },
      depthMap: { artifactId: 'depth:cake-png', sha256: 'sha256:depth', shape: [768, 768, 4] },
      metadata: { artifactId: 'metadata:cake-json', sha256: 'sha256:metadata', shape: [1] },
    },
    backend,
    model: {
      revision: 'local-sharp-webgpu',
      weightsHash: 'sha256:weights',
      dtype: 'fp16',
    },
    kernel: route.kernel,
    profile: {
      ...profile,
      stages: profile.stages.filter(stage => stage.name !== 'output-capture'),
      stageNames: profile.stageNames.filter(name => name !== 'output-capture'),
      totalMs: 23100,
    },
  }),
  /missing required stage output-capture/,
);

console.log('sharp route contracts passed');
