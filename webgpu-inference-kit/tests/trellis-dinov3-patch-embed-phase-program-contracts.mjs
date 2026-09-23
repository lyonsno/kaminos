import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const implementation = await readFile(new URL('../src/trellis-dinov3-patch-embed-phase-program.js', import.meta.url), 'utf8');
const browserSmoke = await readFile(new URL('../smokes/trellis-dinov3-patch-embed-browser.html', import.meta.url), 'utf8');
const browserRunner = await readFile(new URL('../tools/trellis-dinov3-patch-embed-browser-smoke.mjs', import.meta.url), 'utf8');

const {
  TRELLIS_DINOV3_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID,
  createTrellisDinoV3PatchEmbedDispatchPlan,
  createTrellisDinoV3PatchEmbedPhaseProgramCpuOracle,
  createTrellisDinoV3PatchEmbedPhaseProgramRouteDefinition,
} = await import('../src/trellis-dinov3-patch-embed-phase-program.js');
const { validateRouteDefinition } = await import('../src/index.js');

assert.equal(
  TRELLIS_DINOV3_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID,
  'trellis2.dinov3.patch-embed.phase-program.webgpu-local.v0',
  'the first TRELLIS browser boundary must have a stable WebGPU-local identity',
);

const route = createTrellisDinoV3PatchEmbedPhaseProgramRouteDefinition({
  kernel: { profile: 'trellis2-dinov3-patch-embed-phase-program-v0', commit: 'test-fixture' },
});
assert.deepEqual(
  route.requiredInputRoles,
  ['source-image', 'trellis-dinov3-normalized-pixels', 'trellis-dinov3-patch-embed-weights'],
  'the route must preserve original-image, normalized-input, and source-layout weight custody',
);
assert.deepEqual(route.requiredOutputRoles, ['trellis-dinov3-patch-embeddings']);
assert.equal(validateRouteDefinition(route).ok, true);
assert.match(implementation, /consume-trellis-dinov3-patch-embeddings-on-gpu/,
  'the patch output must have a separately profiled downstream GPU consumer stage');
assert.match(implementation, /resource: 'tensor:output'[\s\S]*?access: 'read-only-storage'/,
  'the downstream GPU consumer must bind the patch output as device-resident read-only storage');
assert.ok(
  implementation.indexOf("name: 'consume-trellis-dinov3-patch-embeddings-on-gpu'") < implementation.indexOf("name: 'readback-trellis-dinov3-patch-embeddings', readbacks"),
  'the downstream GPU consumer must execute before receipt-required patch output readback',
);
assert.doesNotMatch(implementation, /sam-phase-cleanup|sam-readback/,
  'the TRELLIS phase program must own its cleanup and explicit debug readback boundary');
assert.match(implementation, /input\.includeReadback === true \? WEBGPU_BUFFER_USAGE\.copySrc/,
  'consumer output must request mapping usage only for explicit diagnostic readback');
assert.match(implementation, /input\.includeReadback === true \? \[\{ name: 'tokenEnergy'/,
  'consumer result readback must remain opt-in');
assert.match(browserSmoke, /if \(!navigator\.gpu\) throw new Error\('WebGPU unavailable/,
  'browser smoke must fail explicitly when the WebGPU API is absent');
assert.match(browserSmoke, /if \(!adapter\) throw new Error\('WebGPU unavailable/,
  'browser smoke must fail explicitly when adapter acquisition is unavailable');
assert.match(browserSmoke, /receipt\?\.status !== 'real'/,
  'browser smoke must reject fallback or unknown route receipts');
assert.match(browserSmoke, /!actual \|\| actual\.length !== expected\.length/,
  'browser smoke must reject missing or blank patch output before parity acceptance');
assert.match(browserSmoke, /const expected = \[22\.5, 25\.5\]/,
  'browser smoke must compare against hand-computable expected embeddings');
assert.match(browserSmoke, /sha256: await sha256\(sourcePixels\)/,
  'the source artifact hash must come from the actual source bytes');
assert.match(browserSmoke, /sha256: await sha256\(pixelValues\)/,
  'the normalized-input artifact hash must come from the actual pixel bytes');
assert.match(browserSmoke, /const weightHash = await sha256\(weightBytes\)[\s\S]*weightsHash: weightHash[\s\S]*sha256: weightHash/,
  'model identity and request artifact hash must share the digest of the actual weight bytes');
assert.match(browserSmoke, /actualTokenEnergy[\s\S]*expectedTokenEnergy/,
  'browser smoke must verify downstream GPU consumer values');
assert.match(browserSmoke, /const weightHash = await sha256\(weightBytes\)[\s\S]*?fixtureModel\s*=\s*\{[\s\S]*?weightsHash:\s*weightHash/,
  'the authoritative receipt must identify the exact synthetic model weights by their observed bytes');
assert.ok(
  browserSmoke.indexOf('const fixtureModel =') < browserSmoke.indexOf('const route = routeModule.createTrellisDinoV3PatchEmbedPhaseProgramRouteDefinition'),
  'the route must be constructed from the same synthetic model identity later used for its receipt',
);
assert.match(browserSmoke, /createTrellisDinoV3PatchEmbedPhaseProgramRouteDefinition\(\{ kernel, model: fixtureModel \}\)/,
  'the synthetic route must not retain the default pretrained-model identity');
assert.match(browserSmoke, /receipt\?\.model\?\.id !== request\.model\?\.id[\s\S]*receipt\?\.model\?\.revision !== request\.model\?\.revision/,
  'the smoke must reject route receipts whose model identity contradicts the invocation request');
assert.match(browserSmoke, /receipt\?\.model\?\.weightsHash !== weightsInput\?\.sha256/,
  'the route receipt model hash must equal the exact request weight-artifact hash');
assert.match(browserSmoke, /isFallbackAdapter/,
  'the browser report must distinguish a known software fallback adapter from hardware classification');
assert.match(browserSmoke, /adapterClassification/,
  'the passing result must report whether its adapter is non-fallback, fallback, or unreported');
assert.match(browserSmoke, /witnessClaim: state\.status === 'passed'[\s\S]*intended only; no successful route execution observed/,
  'browser state must distinguish an intended witness from a successfully observed route');
assert.match(browserSmoke, /state\.witnessClaim = 'intended only; no successful route execution observed'/,
  'browser exceptions must lower any earlier witness label to intended-only');
assert.match(browserSmoke, /effectiveRouteId/,
  'browser smoke must capture the effective route identity');
assert.match(browserSmoke, /adapterInfo[\s\S]*device: \{ label: device\.label/,
  'browser smoke must report observed adapter and requested device identity');
assert.match(browserRunner, /failure_phase: phase/,
  'browser runner must preserve the last failure phase when it cannot produce route evidence');
assert.match(browserRunner, /requestedRouteId:[\s\S]*effectiveRouteId:/,
  'browser report must separate requested and effective route identities');
assert.match(browserRunner, /randomUUID\(\)/,
  'each smoke invocation must get an identity that cannot be inherited from a stale Chrome page');
assert.match(browserRunner, /browserState\?\.status === 'passed'[\s\S]*?witnessClaim = hasObservedExecution[\s\S]*intended only; no successful route execution observed/,
  'a failed or pre-route report must not claim that WebGPU execution was observed');
assert.match(browserRunner, /invocationId[\s\S]*chromeProcessPid:\s*chromeProcess\?\.pid/,
  'the report must bind the route witness to this invocation and spawned Chrome process');
assert.match(browserRunner, /phase = 'create_browser_profile'[\s\S]*mkdtempSync/,
  'temporary Chrome profile creation must occur inside the failure-reporting path');

const productionDispatch = createTrellisDinoV3PatchEmbedDispatchPlan({
  shape: { batch: 1, imageHeight: 512, imageWidth: 512, patchSize: 16, hiddenSize: 1024 },
  maxWorkgroupsPerDimension: 65_535,
});
assert.equal(productionDispatch.patchConv2dStride.logicalInvocations, 1_048_576);
assert.deepEqual(productionDispatch.patchConv2dStride.dispatch, [16_384]);

const oracle = createTrellisDinoV3PatchEmbedPhaseProgramCpuOracle({
  pixelValues: new Float32Array([
    1, 2, 3,
    4, 5, 6,
    7, 8, 9,
    10, 11, 12,
  ]),
  weights: {
    // TRELLIS MLX loader's explicit layout: [out, kH, kW, in].
    projection: new Float32Array([
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
      0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    ]),
    bias: new Float32Array([0.5, -0.5]),
  },
  shape: { batch: 1, imageHeight: 2, imageWidth: 2, patchSize: 2, hiddenSize: 2 },
});

assert.deepEqual(
  Array.from(oracle.patchEmbeddings),
  [22.5, 25.5],
  'the kernel contract must preserve channel-last pixels and [out,kH,kW,in] DINO weights with bias',
);

assert.throws(
  () => createTrellisDinoV3PatchEmbedPhaseProgramCpuOracle({
    pixelValues: new Float32Array(12),
    weights: { projection: new Float32Array(24), bias: new Float32Array(2) },
    shape: { batch: 1, imageHeight: 2, imageWidth: 2, patchSize: 2, hiddenSize: 2, weightLayout: 'out,in,kH,kW' },
  }),
  /weightLayout must be out,kH,kW,in/,
  'the port must fail loud instead of silently treating source checkpoint layout as MLX/WebGPU layout',
);

console.log('TRELLIS DINOv3 patch-embed phase-program contracts passed');
