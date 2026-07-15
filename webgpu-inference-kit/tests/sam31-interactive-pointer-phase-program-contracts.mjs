import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const routeSource = readFileSync(new URL('../src/sam31-interactive-pointer-phase-program.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const smokeSource = readFileSync(new URL('../smokes/sam31-interactive-pointer-parity.js', import.meta.url), 'utf8');
const runnerUrl = new URL('../tools/sam31-interactive-pointer-browser-parity-smoke.mjs', import.meta.url);

for (const token of [
  'SAM31_INTERACTIVE_POINTER_PHASE_PROGRAM_ROUTE_ID',
  'deriveSam31InteractivePointerGeometry',
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
for (const token of [
  "const reusePacket = args.get('--reuse-packet') === '1'",
  "const requestedExpectedManifestSha256 = args.get('--expected-manifest-sha256') || null",
  '--expected-manifest-sha256 is required with --reuse-packet=1',
  "packetSource: reusePacket ? 'caller-provided-existing' : 'generated'",
]) assert.ok(runnerSource.includes(token), `interactive pointer runner must preserve reused-packet authority through ${token}`);
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
  'const geometry = deriveSam31InteractivePointerGeometry(shape)',
  "imagePosition: create('image-position', geometry.imagePositionLength)",
  "keyA: create('key-a', geometry.keyValueLength)",
  'sourceMaskHeight',
  'promptMaskHeight',
  'decoderMaskHeight',
  "imagePosition: uniform('image-position'",
  "keySeed: uniform('key-seed'",
  "maskBlend: uniform('mask-blend'",
  'dispatch: [geometry.imageTokens, geometry.heads, geometry.batch]',
  'const dispatch = (name, kernel, total)',
  'dispatch(`interactive-pointer-layer-${layer}-self-q`, `layer${layer}SelfQ`, geometry.queryValueLength)',
  "dispatch('interactive-pointer-final-q', 'finalQ', geometry.queryAttentionLength)",
  "dispatch('interactive-pointer-object-head-0', 'objectHead0', geometry.pointerLength)",
]) assert.ok(routeSource.includes(token), `interactive pointer execution contract must include ${token}`);
assert.doesNotMatch(routeSource, /slice\(0, 1024\)/, 'dynamic pointer parity must not truncate image-position readback to the reduced fixture length');
assert.ok(
  routeSource.includes('slice(0, geometry.imageEmbeddingLength)'),
  'dynamic pointer parity must expose one unbatched Meta positional grid at the authenticated geometry',
);

const {
  SAM31_INTERACTIVE_POINTER_PHASE_PROGRAM_ROUTE_ID,
  deriveSam31InteractivePointerGeometry,
  createSam31InteractivePointerPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');
const largerGeometry = deriveSam31InteractivePointerGeometry({
  batch: 16,
  queryTokens: 8,
  sparsePromptTokens: 2,
  imageHeight: 4,
  imageWidth: 4,
  imageTokens: 16,
  sourceImageHeight: 56,
  sourceImageWidth: 56,
  sourceMaskHeight: 64,
  sourceMaskWidth: 64,
  promptMaskHeight: 16,
  promptMaskWidth: 16,
  decoderMaskHeight: 16,
  decoderMaskWidth: 16,
  channels: 256,
  heads: 8,
  attentionChannels: 128,
  mlpHidden: 2048,
  layerCount: 2,
});
assert.deepEqual(
  {
    imageTokens: largerGeometry.imageTokens,
    sourceMaskPixels: largerGeometry.sourceMaskPixels,
    promptMaskPixels: largerGeometry.promptMaskPixels,
    promptIntermediateHeight: largerGeometry.promptIntermediateHeight,
    denseEmbeddingLength: largerGeometry.denseEmbeddingLength,
    keyValueLength: largerGeometry.keyValueLength,
  },
  { imageTokens: 16, sourceMaskPixels: 4096, promptMaskPixels: 256, promptIntermediateHeight: 8, denseEmbeddingLength: 65536, keyValueLength: 65536 },
  'the pointer runtime must derive its larger buffer geometry from the authenticated query/mask shape',
);
assert.throws(
  () => deriveSam31InteractivePointerGeometry({ ...largerGeometry.shape, sourceMaskHeight: 16 }),
  /source mask geometry must be sixteen times feature geometry/,
  'a decoder-resolution mask must not impersonate the authenticated source mask',
);
assert.throws(
  () => deriveSam31InteractivePointerGeometry({ ...largerGeometry.shape, promptMaskHeight: 64 }),
  /prompt mask geometry must be four times feature geometry/,
  'a source-resolution mask must not impersonate the prompt mask',
);
assert.doesNotMatch(routeSource, /resizePromptMask/, 'the learned H*16 to H*4 result must feed PromptEncoder without an H resize round trip');
assert.doesNotMatch(routeSource, /requires witnessed 2x2 \/ 8x8 geometry/, 'the runtime must not retain the reduced-fixture geometry gate');
const route = createSam31InteractivePointerPhaseProgramRouteDefinition({
  kernel: { profile: 'sam31-interactive-pointer-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM31_INTERACTIVE_POINTER_PHASE_PROGRAM_ROUTE_ID);
assert.equal(route.backendKind, 'webgpu-local');
assert.deepEqual(route.requiredInputRoles, ['source-frame', 'sam31-binary-mask-inputs', 'sam31-interactive-image-embedding', 'sam31-interactive-pointer-weights']);
assert.deepEqual(route.requiredOutputRoles, ['sam31-interactive-object-pointers']);
assert.equal(validateRouteDefinition(route).ok, true);

console.log('sam3.1 interactive pointer phase-program contracts passed');
