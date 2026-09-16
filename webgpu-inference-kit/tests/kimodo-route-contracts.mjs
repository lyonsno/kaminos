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

// The shape law must be reachable from EVERY public authority boundary,
// not only the minting factory: the r2 review carried the disavowed pair
// through request validation, worker-result validation, the authoritative
// assertion, and evidence classification — all said ok. The route now
// declares its output-artifact validator and the generic machinery applies
// it wherever authority is conferred.
{
  const badRequest = createRouteInvocationRequest(route, {
    requestId: 'req:kimodo-bad',
    inputs: {
      'text-prompt': { artifactId: 'prompt:bad', sha256: 'sha256:p', shape: [1] },
    },
    outputs: {
      'soma-joints': { artifactId: 'motion:bad-joints', shape: [90, 77, 3] },
      'motion-clip': { artifactId: 'motion:bad-clip', shape: [1] },
    },
    routeConfig: {},
  });
  const requestVerdict = validateRouteInvocationRequest(badRequest, route);
  assert.equal(requestVerdict.ok, false, 'request validation must reject the disavowed shapes');
  assert.match(requestVerdict.errors.join('\n'), /somaJoints shape|soma-joints/);

  const badReceipt = JSON.parse(JSON.stringify(receipt));
  badReceipt.outputs[0].shape = [90, 77, 3];
  badReceipt.outputs[1].shape = [1];
  const badResult = createRouteWorkerResult(route, { request: badRequest, receipt: badReceipt });
  const resultVerdict = validateRouteWorkerResult(badResult, route);
  assert.equal(resultVerdict.ok, false, 'worker-result validation must reject the disavowed shapes');
  assert.throws(() => assertAuthoritativeRouteWorkerResult(badResult, route));

  const evidence = classifyWebGpuRouteReceiptEvidence(badReceipt, { route });
  assert.notEqual(evidence.classification, 'authoritative-live-webgpu',
    'route-aware evidence classification must not call the disavowed shapes authoritative');
  assert.equal(evidence.authoritative, false);

  // Mismatched frame counts fail the same boundaries.
  const mismatched = JSON.parse(JSON.stringify(receipt));
  mismatched.outputs[0].shape = [180, 30, 3];
  mismatched.outputs[1].shape = [120, 369];
  assert.equal(validateRouteWorkerResult(
    createRouteWorkerResult(route, { request, receipt: mismatched }), route).ok, false);

  // The good receipt still classifies authoritative WITH the route applied.
  const goodEvidence = classifyWebGpuRouteReceiptEvidence(receipt, { route });
  assert.equal(goodEvidence.authoritative, true);
}

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

// --- Transport durability and route binding (r3 findings) ------------------
// The law must survive serialization (descriptor + trusted registry, not a
// bare function), its loss must fail loud, and {route} must BIND the
// classifier to the receipt's route identity.

{
  const roundTripped = JSON.parse(JSON.stringify(route));
  assert.equal(validateRouteDefinition(roundTripped).ok, true,
    'a JSON round-tripped Kimodo route with its law descriptor stays valid');

  const badReceipt = JSON.parse(JSON.stringify(receipt));
  badReceipt.outputs[0].shape = [90, 77, 3];
  badReceipt.outputs[1].shape = [1];
  const rtEvidence = classifyWebGpuRouteReceiptEvidence(badReceipt, { route: roundTripped });
  assert.equal(rtEvidence.authoritative, false,
    'the law survives a JSON round-trip of the route definition');

  const cloned = structuredClone(route);
  assert.equal(validateRouteDefinition(cloned).ok, true,
    'route definitions must be structured-cloneable');
  assert.equal(classifyWebGpuRouteReceiptEvidence(badReceipt, { route: cloned }).authoritative, false);

  const lawless = JSON.parse(JSON.stringify(route));
  delete lawless.outputArtifactLaw;
  const lawlessVerdict = validateRouteDefinition(lawless);
  assert.equal(lawlessVerdict.ok, false,
    'a Kimodo definition that lost its required law must be rejected, not silently lawless');
  assert.match(lawlessVerdict.errors.join('\n'), /artifact law/i);
  const lawlessEvidence = classifyWebGpuRouteReceiptEvidence(badReceipt, { route: lawless });
  assert.equal(lawlessEvidence.authoritative, false,
    'a lawless route cannot confer authority');
}

{
  // Route-identity binding: a mismatched route must yield a legible
  // route-mismatch, not wrong-law application or silent authority.
  const { createMogeDepthNormalRouteDefinition } = await import('../src/index.js');
  const mogeRoute = createMogeDepthNormalRouteDefinition();
  const badReceipt = JSON.parse(JSON.stringify(receipt));
  badReceipt.outputs[0].shape = [90, 77, 3];
  badReceipt.outputs[1].shape = [1];
  const mismatch = classifyWebGpuRouteReceiptEvidence(badReceipt, { route: mogeRoute });
  assert.equal(mismatch.authoritative, false,
    'a mismatched validator-less route must not confer authority');
  assert.match((mismatch.reasons ?? []).join('\n'), /route/i);

  const inverse = classifyWebGpuRouteReceiptEvidence(
    { ...JSON.parse(JSON.stringify(receipt)), requestedRouteId: mogeRoute.routeId, effectiveRouteId: mogeRoute.routeId },
    { route });
  assert.equal(inverse.authoritative, false);
  assert.match((inverse.reasons ?? []).join('\n'), /route/i,
    'the inverse mismatch names the route identity, not shape law of the wrong contract');

  const conflicting = classifyWebGpuRouteReceiptEvidence(receipt,
    { route, expectedRouteId: mogeRoute.routeId });
  assert.equal(conflicting.authoritative, false,
    'a conflicting expectedRouteId and route.routeId cannot both be satisfied');
}

{
  // Route-bound receipt authority: the advertised assertion must have a
  // route-aware form that rejects the disavowed pair.
  const badReceipt = JSON.parse(JSON.stringify(receipt));
  badReceipt.outputs[0].shape = [90, 77, 3];
  badReceipt.outputs[1].shape = [1];
  assert.throws(() => assertAuthoritativeRouteReceipt(badReceipt, route),
    /somaJoints shape|artifact law/i,
    'route-bound assertion must reject the disavowed pair');
  assert.doesNotThrow(() => assertAuthoritativeRouteReceipt(receipt, route));
  // The generic (route-less) form is envelope authority ONLY — a documented
  // narrowing this test records deliberately.
  assert.doesNotThrow(() => assertAuthoritativeRouteReceipt(badReceipt));
}

// --- At-cap closure: required-law-by-route-id + sealed registry -----------
// The at-cap review demonstrated two bypasses: (1) a hand-built lawless
// route object with the Kimodo route id passed the route-bound authority
// APIs (they applied only whatever descriptor the caller carried), and
// (2) a duplicate registerArtifactLaw call replaced the canonical
// validator. Required-law resolution is now centralized and canonical
// bindings are sealed.

{
  const { registerArtifactLaw, requireArtifactLaw, KIMODO_OUTPUT_ARTIFACT_LAW } = await import('../src/index.js');
  const badReceipt = JSON.parse(JSON.stringify(receipt));
  badReceipt.outputs[0].shape = [90, 77, 3];
  badReceipt.outputs[1].shape = [1];

  // (1a) Lawless route object with the Kimodo id: route-bound assertion
  // must resolve the REQUIRED law by route id and reject.
  const lawlessRoute = { routeId: KIMODO_TEXT_TO_MOTION_ROUTE_ID };
  assert.throws(() => assertAuthoritativeRouteReceipt(badReceipt, lawlessRoute),
    /somaJoints shape|artifact law/i,
    'a lawless route object must not bypass the required Kimodo law');

  // (1b) Same through the classifier.
  const lawlessEvidence = classifyWebGpuRouteReceiptEvidence(badReceipt, { route: lawlessRoute });
  assert.equal(lawlessEvidence.authoritative, false,
    'classifier must resolve the required law by route id');

  // (1c) A route object carrying the WRONG descriptor under the Kimodo id
  // must be rejected for the mismatch, not have its carried law honored.
  registerArtifactLaw('permissive-law-for-test', 1, () => ({ ok: true, errors: [] }));
  const wrongLawRoute = {
    routeId: KIMODO_TEXT_TO_MOTION_ROUTE_ID,
    outputArtifactLaw: { id: 'permissive-law-for-test', version: 1 },
  };
  assert.throws(() => assertAuthoritativeRouteReceipt(badReceipt, wrongLawRoute),
    /required|somaJoints shape|artifact law/i,
    'a carried descriptor cannot substitute for the required law');
  const wrongLawEvidence = classifyWebGpuRouteReceiptEvidence(badReceipt, { route: wrongLawRoute });
  assert.equal(wrongLawEvidence.authoritative, false);

  // (2) Sealed canonical bindings: duplicate registration must throw...
  assert.throws(() => registerArtifactLaw(
    KIMODO_OUTPUT_ARTIFACT_LAW.id, KIMODO_OUTPUT_ARTIFACT_LAW.version,
    () => ({ ok: true, errors: [] })),
    /already registered|sealed/i,
    'canonical law bindings must not be silently replaceable');
  // ...and re-pointing a route requirement to a different law must throw,
  // while idempotent same-ref re-registration of the requirement is lawful.
  assert.throws(() => requireArtifactLaw(
    KIMODO_TEXT_TO_MOTION_ROUTE_ID, 'permissive-law-for-test', 1),
    /already requires|sealed/i);
  assert.doesNotThrow(() => requireArtifactLaw(
    KIMODO_TEXT_TO_MOTION_ROUTE_ID,
    KIMODO_OUTPUT_ARTIFACT_LAW.id, KIMODO_OUTPUT_ARTIFACT_LAW.version));

  // The canonical route + good receipt still hold authority end to end.
  assert.doesNotThrow(() => assertAuthoritativeRouteReceipt(receipt, route));
  assert.equal(classifyWebGpuRouteReceiptEvidence(receipt, { route }).authoritative, true);
}

console.log('kimodo route contracts passed');
