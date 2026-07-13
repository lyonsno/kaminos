import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const routeSource = readFileSync(new URL('../src/sam31-interactive-pointer-phase-program.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const smokeSource = readFileSync(new URL('../smokes/sam31-interactive-pointer-parity.js', import.meta.url), 'utf8');
const runnerUrl = new URL('../tools/sam31-interactive-pointer-browser-parity-smoke.mjs', import.meta.url);

for (const token of [
  'SAM31_INTERACTIVE_POINTER_PHASE_PROGRAM_ROUTE_ID',
  'createSam31InteractivePointerPhaseProgramCpuOracle',
  'createSam31InteractivePointerPhaseProgramRouteDefinition',
  'createSam31InteractivePointerPhaseProgramRouteReceipt',
  'runSam31InteractivePointerPhaseProgramRoute',
]) assert.match(indexSource, new RegExp(token), `package surface must export ${token}`);

assert.match(packageSource, /sam31-interactive-pointer-phase-program-contracts\.mjs/, 'aggregate tests must cover the interactive pointer route');
assert.equal(existsSync(runnerUrl), true, 'interactive pointer browser evidence runner must exist');
const runnerSource = readFileSync(runnerUrl, 'utf8');
assert.match(packageSource, /test:live:sam31-interactive-pointer-webgpu/, 'package scripts must expose the live interactive pointer witness');
for (const token of [
  'generate_official_packet',
  'verify_packet_authority',
  'window.sam31InteractivePointerParityState',
  'primary_output_written',
  'screenshotPixelCheck',
  'requestedRouteId',
  'effectiveRouteId',
  'failure_phase',
]) assert.match(runnerSource, new RegExp(token), `interactive pointer runner must preserve ${token}`);
for (const token of [
  'expectedManifestSha256',
  'manifestSha256',
  'manifest digest mismatch',
]) {
  assert.match(runnerSource, new RegExp(token), `interactive pointer runner must bind ${token}`);
  assert.match(smokeSource, new RegExp(token), `interactive pointer browser must bind ${token}`);
}
assert.ok(
  smokeSource.includes("tensors: { shape: manifest.shape, tensors: { binaryMasks: tensors['binary-mask-inputs'], imageEmbedding: tensors['image-embedding'] }, weights }"),
  'browser route invocation must preserve the shared oracle input envelope',
);
for (const token of [
  'interactive-pointer-mask-downsample',
  'interactive-pointer-prompt-encode',
  'interactive-pointer-two-way-transformer',
  'interactive-pointer-object-projection',
  'interactive-pointer-final-no-object-transition',
  'createWebGpuInferenceRuntime',
  'defineProgram',
  'runProgram',
  'MEMORY_ATTENTION_ONLINE_SOFTMAX_WGSL',
  'sam31-interactive-object-pointers',
]) assert.match(routeSource, new RegExp(token), `interactive pointer route must make ${token} load-bearing`);

for (const token of [
  "imagePosition: create('image-position', 16384)",
  'let position = (index / 256u) % 4u',
  'const dispatch = (name, kernel, total)',
  'dispatch(`interactive-pointer-layer-${layer}-self-q`, `layer${layer}SelfQ`, 32768)',
  "dispatch('interactive-pointer-final-q', 'finalQ', 16384)",
  "dispatch('interactive-pointer-object-head-0', 'objectHead0', 4096)",
  'slice(0, 1024)',
]) assert.ok(routeSource.includes(token), `interactive pointer execution contract must include ${token}`);

const {
  SAM31_INTERACTIVE_POINTER_PHASE_PROGRAM_ROUTE_ID,
  createSam31InteractivePointerPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');
const route = createSam31InteractivePointerPhaseProgramRouteDefinition({
  kernel: { profile: 'sam31-interactive-pointer-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM31_INTERACTIVE_POINTER_PHASE_PROGRAM_ROUTE_ID);
assert.equal(route.backendKind, 'webgpu-local');
assert.deepEqual(route.requiredInputRoles, ['source-frame', 'sam31-binary-mask-inputs', 'sam31-interactive-image-embedding', 'sam31-interactive-pointer-weights']);
assert.deepEqual(route.requiredOutputRoles, ['sam31-interactive-object-pointers']);
assert.equal(validateRouteDefinition(route).ok, true);

console.log('sam3.1 interactive pointer phase-program contracts passed');
