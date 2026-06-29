import assert from 'node:assert/strict';

import {
  KIMODO_TEXT_TO_MOTION_ROUTE_ID,
  assertAuthoritativeRouteReceipt,
  createKimodoTextToMotionRouteDefinition,
  createKimodoTextToMotionRouteReceipt,
  createRouteInvocationRequest,
  createRouteWorkerResult,
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
  route: 'browser-motion-diffusion',
  timingSource: 'adapter-phase-wall-clock',
  requiredStages: ['text-embedding', 'ddim-sampling', 'fk-decode', 'output-capture'],
  stages: [
    { name: 'text-embedding', ms: 1200, metadata: { substrate: 'external-llama3-8b' } },
    { name: 'ddim-sampling', ms: 25000, metadata: { steps: 50, forwardPasses: 200 } },
    { name: 'fk-decode', ms: 2 },
    { name: 'output-capture', ms: 40 },
  ],
  stageNames: ['text-embedding', 'ddim-sampling', 'fk-decode', 'output-capture'],
  totalMs: 26242,
};

const route = createKimodoTextToMotionRouteDefinition({
  kernel: {
    profile: 'twostage-denoiser-ddim50-fk',
    commit: '171016c',
  },
});

assert.equal(KIMODO_TEXT_TO_MOTION_ROUTE_ID, 'kimodo.text-to-motion.webgpu-local.v0');
assert.equal(route.routeId, KIMODO_TEXT_TO_MOTION_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['text-prompt']);
assert.deepEqual(route.requiredOutputRoles, ['soma77-joints', 'motion-clip']);
assert.deepEqual(route.optionalOutputRoles, ['filmstrip']);
assert.equal(validateRouteDefinition(route).ok, true);

const request = createRouteInvocationRequest(route, {
  requestId: 'req:kimodo-bow',
  inputs: {
    'text-prompt': {
      artifactId: 'prompt:kimodo-bow',
      sha256: 'sha256:prompt',
      shape: [1],
    },
  },
  outputs: {
    'soma77-joints': { artifactId: 'motion:bow-soma77', shape: [90, 77, 3] },
    'motion-clip': { artifactId: 'motion:bow-sidecar', shape: [1] },
    filmstrip: { artifactId: 'motion:bow-filmstrip', shape: [12, 640, 360, 4] },
  },
  routeConfig: {
    textEmbedding: 'external-llama3-8b',
    diffusionSteps: 50,
    classifierFreeGuidance: 2.0,
  },
});

const receipt = createKimodoTextToMotionRouteReceipt({
  input: request.inputs[0],
  outputs: {
    soma77Joints: { artifactId: 'motion:bow-soma77', sha256: 'sha256:joints', shape: [90, 77, 3] },
    motionClip: { artifactId: 'motion:bow-sidecar', sha256: 'sha256:clip', shape: [1] },
    filmstrip: { artifactId: 'motion:bow-filmstrip', sha256: 'sha256:filmstrip', shape: [12, 640, 360, 4] },
  },
  backend,
  model: {
    revision: 'SOMA-RP-v1.1',
    weightsHash: 'sha256:weights',
    dtype: 'fp16',
  },
  kernel: route.kernel,
  profile,
});

assert.equal(receipt.requestedRouteId, KIMODO_TEXT_TO_MOTION_ROUTE_ID);
assert.equal(receipt.model.id, 'NVIDIA/Kimodo-SOMA-RP-v1.1');
assert.deepEqual(receipt.outputs.map(output => output.role), ['soma77-joints', 'motion-clip', 'filmstrip']);
assert.equal(validateRouteReceipt(receipt).ok, true);
assert.doesNotThrow(() => assertAuthoritativeRouteReceipt(receipt));

const result = createRouteWorkerResult(route, { request, receipt });
assert.equal(validateRouteWorkerResult(result, route).ok, true);

assert.throws(
  () => createKimodoTextToMotionRouteReceipt({
    input: request.inputs[0],
    outputs: {
      soma77Joints: { artifactId: 'motion:bow-soma77', sha256: 'sha256:joints', shape: [90, 77, 3] },
    },
    backend,
    model: { revision: 'SOMA-RP-v1.1', weightsHash: 'sha256:weights', dtype: 'fp16' },
    kernel: route.kernel,
    profile,
  }),
  /motionClip output is required/,
);

assert.throws(
  () => createKimodoTextToMotionRouteReceipt({
    input: request.inputs[0],
    outputs: {
      soma77Joints: { artifactId: 'motion:bow-soma77', sha256: 'sha256:joints', shape: [90, 77, 3] },
      motionClip: { artifactId: 'motion:bow-sidecar', sha256: 'sha256:clip', shape: [1] },
    },
    backend,
    model: { revision: 'SOMA-RP-v1.1', weightsHash: 'sha256:weights', dtype: 'fp16' },
    kernel: route.kernel,
    profile: {
      ...profile,
      stages: profile.stages.filter(stage => stage.name !== 'ddim-sampling'),
      stageNames: profile.stageNames.filter(name => name !== 'ddim-sampling'),
    },
  }),
  /missing required stage ddim-sampling/,
);

console.log('kimodo route contracts passed');
