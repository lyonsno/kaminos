import assert from 'node:assert/strict';

import {
  createRouteReceiptArtifacts,
  createRouteReceiptInputArtifact,
  createWebGpuRouteReceiptFromArtifacts,
  finishAndValidateRouteProfile,
  validateRouteReceiptArtifact,
} from '../src/index.js';

const backend = {
  kind: 'webgpu-local',
  runtime: 'browser',
  adapterName: 'Apple M4 Max',
  features: ['timestamp-query'],
  requestedFeatures: ['timestamp-query'],
  limits: { maxBufferSize: 4294967296 },
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

assert.doesNotThrow(() => validateRouteReceiptArtifact(
  { artifactId: 'depth:bunnycake', sha256: 'sha256:depth', shape: [592, 592] },
  'depth',
));
assert.throws(
  () => validateRouteReceiptArtifact({ artifactId: 'depth:bunnycake', sha256: '', shape: [592, 592] }, 'depth'),
  /depth output must include sha256/,
);

const inputArtifact = createRouteReceiptInputArtifact('source-image', {
  artifactId: 'image:bunnycake',
  sha256: 'sha256:input',
  shape: [518, 518, 3],
});
assert.deepEqual(inputArtifact, {
  role: 'source-image',
  artifactId: 'image:bunnycake',
  sha256: 'sha256:input',
  shape: [518, 518, 3],
});

const outputs = createRouteReceiptArtifacts({
  artifacts: {
    depth: { artifactId: 'depth:bunnycake', sha256: 'sha256:depth', shape: [592, 592] },
    normal: { artifactId: 'normal:bunnycake', sha256: 'sha256:normal', shape: [3, 592, 592] },
    pointMap: { artifactId: 'pointmap:bunnycake', sha256: 'sha256:pointmap', shape: [3, 592, 592] },
  },
  roles: [
    { key: 'depth', role: 'depth', required: true },
    { key: 'normal', role: 'normal', required: true },
    { key: 'pointMap', role: 'pointmap', required: false },
    { key: 'mask', role: 'mask', required: false },
  ],
});
assert.deepEqual(outputs.map(output => output.role), ['depth', 'normal', 'pointmap']);
assert.equal(outputs[0].status, 'real');
assert.throws(
  () => createRouteReceiptArtifacts({
    artifacts: { depth: { artifactId: 'depth:bunnycake', sha256: 'sha256:depth', shape: [592, 592] } },
    roles: [
      { key: 'depth', role: 'depth', required: true },
      { key: 'normal', role: 'normal', required: true },
    ],
  }),
  /normal output is required/,
);

const finishedProfile = finishAndValidateRouteProfile(profile);
assert.equal(finishedProfile.totalMs, 1852);
assert.deepEqual(finishedProfile.stageNames, ['backbone', 'decoder-heads', 'output-readback']);
assert.throws(
  () => finishAndValidateRouteProfile({
    ...profile,
    stages: profile.stages.filter(stage => stage.name !== 'decoder-heads'),
  }),
  /missing required stage decoder-heads/,
);

const receipt = createWebGpuRouteReceiptFromArtifacts({
  requestedRouteId: 'moge.depth-normal.webgpu-local.v0',
  backend,
  model: {
    id: 'Ruicheng/moge-2-vitl-normal',
    revision: 'local-vitl-normal',
    weightsHash: 'sha256:weights',
    dtype: 'fp16',
  },
  kernel: {
    kitVersion: '0.0.0',
    profile: 'conv-transpose2d-stride2',
    commit: 'abc123',
  },
  inputs: [inputArtifact],
  outputs,
  profile,
});
assert.equal(receipt.schema, 'kaminos.webgpu-route-receipt.v0');
assert.equal(receipt.effectiveRouteId, 'moge.depth-normal.webgpu-local.v0');
assert.equal(receipt.timings.source, 'queue-submit-wait');
assert.equal(receipt.timings.totalMs, 1852);

assert.throws(
  () => createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: 'moge.depth-normal.webgpu-local.v0',
    backend: { ...backend, adapterName: '' },
    model: receipt.model,
    kernel: receipt.kernel,
    inputs: [inputArtifact],
    outputs,
    profile,
  }),
  /invalid WebGPU backend identity/,
);

console.log('route receipt helper contracts passed');
