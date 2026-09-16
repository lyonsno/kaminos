import assert from 'node:assert/strict';

import {
  KIMODO_TEXT_TO_MOTION_ROUTE_ID,
  assertAuthoritativeRouteReceipt,
  assertAuthoritativeRouteWorkerResult,
  classifyWebGpuRouteReceiptEvidence,
  createKimodoTextToMotionRouteDefinition,
  createKimodoTextToMotionRouteReceipt,
  createRouteInvocationRequest,
  createRouteWorkerResult,
  validateRouteDefinition,
  validateRouteInvocationRequest,
  validateRouteReceipt,
  validateRouteWorkerResult,
} from '../src/index.js';

// This contract tracks the SHIPPED browser port (lyonsno/kimodo-webgpu):
// 30-joint SOMA skeleton FK-decoded client-side, variable frame count
// (duration x 30fps; 180 at the default 6s), 369-dim feature rows as the
// motion clip, 100 DDIM steps by default. The original v0 declaration
// ([90, 77, 3] soma77-joints) was never exercised by any tracked Kaminos
// consumer (external emitters not surveyed); the route id stays v0 because
// this is a fiction repair, not a break of a consumer-exercised contract.

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
    { name: 'ddim-sampling', ms: 50000, metadata: { steps: 100, forwardPasses: 200 } },
    { name: 'fk-decode', ms: 2 },
    { name: 'output-capture', ms: 40 },
  ],
  stageNames: ['text-embedding', 'ddim-sampling', 'fk-decode', 'output-capture'],
  totalMs: 51242,
};

const route = createKimodoTextToMotionRouteDefinition({
  kernel: {
    profile: 'kimodo-text-to-motion',
    commit: '171016c',
  },
});

assert.equal(KIMODO_TEXT_TO_MOTION_ROUTE_ID, 'kimodo.text-to-motion.webgpu-local.v0');
assert.equal(route.routeId, KIMODO_TEXT_TO_MOTION_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['text-prompt']);
assert.deepEqual(route.requiredOutputRoles, ['soma-joints', 'motion-clip']);
assert.deepEqual(route.optionalOutputRoles, ['filmstrip']);

// Frame count varies with requested duration: the declaration must not pin a
// fixed shape on either variable-dim output. Dimension semantics live in the
// worker motion format, not in a shape the emitter can never satisfy.
const declaredJoints = route.outputRoles.find(output => output.role === 'soma-joints');
const declaredClip = route.outputRoles.find(output => output.role === 'motion-clip');
assert.equal(declaredJoints.shape, undefined);
assert.equal(declaredClip.shape, undefined);

assert.equal(route.worker.motionFormat, 'kimodo-soma30-explicit-joints');
assert.equal(route.worker.textEmbedding, 'external-llama3-8b');

assert.equal(route.scheduler.requestedScheduler.mode, 'cooperative');
assert.equal(route.scheduler.requestedScheduler.phaseChunkSize['ddim-sampling'], 1);
assert.equal(route.scheduler.breathability.spans.find(span => span.stage === 'ddim-sampling').kind, 'gpu-submit-loop');
assert.equal(route.scheduler.breathability.checkpoints.find(checkpoint => checkpoint.kind === 'diffusion-step').yieldable, true);
assert.equal(route.backpressure.effectiveBudget, 'visible-wait');
assert.equal(validateRouteDefinition(route).ok, true);

// Default kernel profile names the shipped kernel graph, not the ddim50
// fiction. (The explicit override above proves overrides still work.)
const defaultRoute = createKimodoTextToMotionRouteDefinition();
assert.equal(defaultRoute.kernel.profile, 'kimodo-text-to-motion');

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
    'soma-joints': { artifactId: 'motion:bow-joints', shape: [180, 30, 3] },
    'motion-clip': { artifactId: 'motion:bow-features', shape: [180, 369] },
    filmstrip: { artifactId: 'motion:bow-filmstrip', shape: [12, 640, 360, 4] },
  },
  routeConfig: {
    textEmbedding: 'external-llama3-8b',
    diffusionSteps: 100,
    classifierFreeGuidance: 2.0,
  },
});

const receipt = createKimodoTextToMotionRouteReceipt({
  input: request.inputs[0],
  outputs: {
    somaJoints: { artifactId: 'motion:bow-joints', sha256: 'sha256:joints', shape: [180, 30, 3] },
    motionClip: { artifactId: 'motion:bow-features', sha256: 'sha256:clip', shape: [180, 369] },
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
assert.deepEqual(receipt.outputs.map(output => output.role), ['soma-joints', 'motion-clip', 'filmstrip']);
assert.deepEqual(receipt.outputs[0].shape, [180, 30, 3]);
assert.deepEqual(receipt.outputs[1].shape, [180, 369]);
assert.equal(validateRouteReceipt(receipt).ok, true);
assert.doesNotThrow(() => assertAuthoritativeRouteReceipt(receipt));

// A different requested duration produces a different frame count through
// the SAME route: 4s x 30fps = 120 frames must be as valid as 180.
const shortReceipt = createKimodoTextToMotionRouteReceipt({
  input: request.inputs[0],
  outputs: {
    somaJoints: { artifactId: 'motion:short-joints', sha256: 'sha256:sjoints', shape: [120, 30, 3] },
    motionClip: { artifactId: 'motion:short-features', sha256: 'sha256:sclip', shape: [120, 369] },
  },
  backend,
  model: { revision: 'SOMA-RP-v1.1', weightsHash: 'sha256:weights', dtype: 'fp16' },
  kernel: route.kernel,
  profile,
});
assert.equal(validateRouteReceipt(shortReceipt).ok, true);

// The disavowed and malformed shapes must fail BEFORE a receipt can become
// authoritative: the review demonstrated that removing the fixed declaration
// also removed every machine-checkable invariant, so the old fictional pair
// still classified authoritative under the repaired route.
const shapeCase = (outputs) => () => createKimodoTextToMotionRouteReceipt({
  input: request.inputs[0],
  outputs,
  backend,
  model: { revision: 'SOMA-RP-v1.1', weightsHash: 'sha256:weights', dtype: 'fp16' },
  kernel: route.kernel,
  profile,
});
const j = (shape) => ({ artifactId: 'motion:x-joints', sha256: 'sha256:xj', shape });
const c = (shape) => ({ artifactId: 'motion:x-clip', sha256: 'sha256:xc', shape });

assert.throws(shapeCase({ somaJoints: j([90, 77, 3]), motionClip: c([1]) }),
  /somaJoints shape/, 'the old fictional pair must be rejected');
assert.throws(shapeCase({ somaJoints: j([180, 30, 3]), motionClip: c([120, 369]) }),
  /same frame count/, 'mismatched frame counts must be rejected');
assert.throws(shapeCase({ somaJoints: j([180, 30]), motionClip: c([180, 369]) }),
  /somaJoints shape/, 'wrong joint rank must be rejected');
assert.throws(shapeCase({ somaJoints: j([180, 30, 3]), motionClip: c([180]) }),
  /motionClip shape/, 'wrong clip rank must be rejected');
assert.throws(shapeCase({ somaJoints: j([0, 30, 3]), motionClip: c([0, 369]) }),
  /somaJoints shape/, 'zero frames must be rejected');

const result = createRouteWorkerResult(route, { request, receipt });
assert.equal(validateRouteWorkerResult(result, route).ok, true);

assert.throws(
  () => createKimodoTextToMotionRouteReceipt({
    input: request.inputs[0],
    outputs: {
      somaJoints: { artifactId: 'motion:bow-joints', sha256: 'sha256:joints', shape: [180, 30, 3] },
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
      somaJoints: { artifactId: 'motion:bow-joints', sha256: 'sha256:joints', shape: [180, 30, 3] },
      motionClip: { artifactId: 'motion:bow-features', sha256: 'sha256:clip', shape: [180, 369] },
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

{
  const { readFileSync } = await import('node:fs');
  const doc = readFileSync(new URL('../docs/integration-reference.md', import.meta.url), 'utf8');
  assert.ok(!/SOMA77 joints/.test(doc),
    'integration reference must not describe the fictional SOMA77 route');
  assert.match(doc, /soma-joints/);
  assert.match(doc, /369/);
}

// --- Direct verification + plain-data definitions --------------------------
// The shape law is enforced at the factory (negatives above) and offered to
// consumers as one exported function; route definitions are plain data.

{
  const { validateKimodoOutputArtifacts } = await import('../src/index.js');
  const badArray = [
    { role: 'soma-joints', shape: [90, 77, 3] },
    { role: 'motion-clip', shape: [1] },
  ];
  assert.equal(validateKimodoOutputArtifacts(badArray).ok, false,
    'array-form verification rejects the disavowed pair');
  assert.equal(validateKimodoOutputArtifacts(receipt.outputs).ok, true,
    'a factory-minted receipt verifies clean');
  // Duplicate required roles are ambiguous, not first-match-wins: a
  // cooperative emitter that accidentally doubles a role must fail loud
  // whichever occurrence is lawful.
  assert.equal(validateKimodoOutputArtifacts([
    { role: 'soma-joints', shape: [120, 30, 3] },
    { role: 'soma-joints', shape: [90, 77, 3] },
    { role: 'motion-clip', shape: [120, 369] },
  ]).ok, false, 'valid-then-invalid duplicate soma-joints must fail');
  assert.equal(validateKimodoOutputArtifacts([
    { role: 'soma-joints', shape: [90, 77, 3] },
    { role: 'soma-joints', shape: [120, 30, 3] },
    { role: 'motion-clip', shape: [120, 369] },
  ]).ok, false, 'invalid-then-valid duplicate soma-joints must fail');
  assert.equal(validateKimodoOutputArtifacts([
    { role: 'soma-joints', shape: [120, 30, 3] },
    { role: 'motion-clip', shape: [120, 369] },
    { role: 'motion-clip', shape: [90, 369] },
  ]).ok, false, 'duplicate motion-clip with conflicting frames must fail');
  assert.equal(validateKimodoOutputArtifacts({
    somaJoints: { shape: [120, 30, 3] }, motionClip: { shape: [120, 369] },
  }).ok, true, 'keyed-form verification accepts lawful shapes');
}

{
  // Definitions are plain serializable data: JSON round-trip and
  // structuredClone both preserve a valid definition.
  const roundTripped = JSON.parse(JSON.stringify(route));
  assert.equal(validateRouteDefinition(roundTripped).ok, true);
  assert.equal(validateRouteDefinition(structuredClone(route)).ok, true);
}

{
  const { readFileSync } = await import('node:fs');
  const doc = readFileSync(new URL('../docs/integration-reference.md', import.meta.url), 'utf8');
  assert.ok(!/SOMA77 joints/.test(doc),
    'integration reference must not describe the fictional SOMA77 route');
  assert.match(doc, /soma-joints/);
  assert.match(doc, /validateKimodoOutputArtifacts/);
}

console.log('kimodo route contracts passed');
