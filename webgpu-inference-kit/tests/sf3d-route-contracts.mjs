import assert from 'node:assert/strict';

import {
  SF3D_IMAGE_TO_MESH_ROUTE_ID,
  assertAuthoritativeRouteReceipt,
  createRouteInvocationRequest,
  createRouteWorkerResult,
  createSf3dImageToMeshRouteDefinition,
  createSf3dImageToMeshRouteReceipt,
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
  limits: { maxBufferSize: 4294967296, maxStorageBufferBindingSize: 2147483648 },
  timestampQuery: 'unavailable',
};

const profile = {
  schema: 'kaminos.webgpu-staged-profile.v0',
  route: 'browser-mesh-generation',
  timingSource: 'adapter-phase-wall-clock',
  requiredStages: ['image-preprocess', 'dinov2-tokenizer', 'two-stream-backbone', 'triplane-decode', 'marching-tet', 'texture-bake', 'glb-export'],
  stages: [
    { name: 'image-preprocess', ms: 20 },
    { name: 'dinov2-tokenizer', ms: 1800 },
    { name: 'two-stream-backbone', ms: 4200 },
    { name: 'triplane-decode', ms: 1600 },
    { name: 'marching-tet', ms: 900 },
    { name: 'texture-bake', ms: 1300 },
    { name: 'glb-export', ms: 300 },
  ],
  stageNames: ['image-preprocess', 'dinov2-tokenizer', 'two-stream-backbone', 'triplane-decode', 'marching-tet', 'texture-bake', 'glb-export'],
  totalMs: 10120,
};

const route = createSf3dImageToMeshRouteDefinition({
  kernel: {
    profile: 'dinov2-two-stream-triplane-marching-tet-texture-bake',
    commit: '153c7a7',
  },
});

assert.equal(SF3D_IMAGE_TO_MESH_ROUTE_ID, 'sf3d.image-to-mesh.webgpu-local.v0');
assert.equal(route.routeId, SF3D_IMAGE_TO_MESH_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['source-image']);
assert.deepEqual(route.requiredOutputRoles, ['mesh-glb', 'albedo-texture', 'normal-map']);
assert.deepEqual(route.optionalOutputRoles, ['mesh-obj']);
assert.equal(validateRouteDefinition(route).ok, true);

const request = createRouteInvocationRequest(route, {
  requestId: 'req:sf3d-chair',
  inputs: {
    'source-image': { artifactId: 'image:demo-chair', sha256: 'sha256:input', shape: [512, 512, 4] },
  },
  outputs: {
    'mesh-glb': { artifactId: 'mesh:chair-glb', shape: [1] },
    'albedo-texture': { artifactId: 'texture:chair-albedo', shape: [1024, 1024, 4] },
    'normal-map': { artifactId: 'texture:chair-normal', shape: [1024, 1024, 4] },
    'mesh-obj': { artifactId: 'mesh:chair-obj', shape: [1] },
  },
  routeConfig: {
    meshFormat: 'glb',
    textureBake: true,
    normalMap: true,
  },
});

const receipt = createSf3dImageToMeshRouteReceipt({
  input: request.inputs[0],
  outputs: {
    meshGlb: { artifactId: 'mesh:chair-glb', sha256: 'sha256:glb', shape: [1] },
    albedoTexture: { artifactId: 'texture:chair-albedo', sha256: 'sha256:albedo', shape: [1024, 1024, 4] },
    normalMap: { artifactId: 'texture:chair-normal', sha256: 'sha256:normal', shape: [1024, 1024, 4] },
    meshObj: { artifactId: 'mesh:chair-obj', sha256: 'sha256:obj', shape: [1] },
  },
  backend,
  model: {
    revision: 'stable-fast-3d',
    weightsHash: 'sha256:weights',
    dtype: 'fp16',
  },
  kernel: route.kernel,
  profile,
});

assert.equal(receipt.requestedRouteId, SF3D_IMAGE_TO_MESH_ROUTE_ID);
assert.equal(receipt.model.id, 'stabilityai/stable-fast-3d');
assert.deepEqual(receipt.outputs.map(output => output.role), ['mesh-glb', 'albedo-texture', 'normal-map', 'mesh-obj']);
assert.equal(validateRouteReceipt(receipt).ok, true);
assert.doesNotThrow(() => assertAuthoritativeRouteReceipt(receipt));

const result = createRouteWorkerResult(route, { request, receipt });
assert.equal(validateRouteWorkerResult(result, route).ok, true);

assert.throws(
  () => createSf3dImageToMeshRouteReceipt({
    input: request.inputs[0],
    outputs: {
      meshGlb: { artifactId: 'mesh:chair-glb', sha256: 'sha256:glb', shape: [1] },
      albedoTexture: { artifactId: 'texture:chair-albedo', sha256: 'sha256:albedo', shape: [1024, 1024, 4] },
    },
    backend,
    model: { revision: 'stable-fast-3d', weightsHash: 'sha256:weights', dtype: 'fp16' },
    kernel: route.kernel,
    profile,
  }),
  /normalMap output is required/,
);

assert.throws(
  () => createSf3dImageToMeshRouteReceipt({
    input: request.inputs[0],
    outputs: {
      meshGlb: { artifactId: 'mesh:chair-glb', sha256: 'sha256:glb', shape: [1] },
      albedoTexture: { artifactId: 'texture:chair-albedo', sha256: 'sha256:albedo', shape: [1024, 1024, 4] },
      normalMap: { artifactId: 'texture:chair-normal', sha256: 'sha256:normal', shape: [1024, 1024, 4] },
    },
    backend,
    model: { revision: 'stable-fast-3d', weightsHash: 'sha256:weights', dtype: 'fp16' },
    kernel: route.kernel,
    profile: {
      ...profile,
      stages: profile.stages.filter(stage => stage.name !== 'marching-tet'),
      stageNames: profile.stageNames.filter(name => name !== 'marching-tet'),
    },
  }),
  /missing required stage marching-tet/,
);

console.log('sf3d route contracts passed');
