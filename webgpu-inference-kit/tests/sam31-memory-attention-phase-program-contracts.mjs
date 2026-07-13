import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SAM31_MEMORY_ATTENTION_PHASE_PROGRAM_ROUTE_ID,
  applySam31AxialRope,
  createSam31MemoryAttentionPhaseProgramCpuOracle,
  createSam31MemoryAttentionPhaseProgramRouteDefinition,
  validateRouteDefinition,
} from '../src/index.js';

const routeSource = readFileSync(new URL('../src/sam31-memory-attention-phase-program.js', import.meta.url), 'utf8');
assert.doesNotMatch(routeSource, /gpuExecutor/, 'memory attention must own native WebGPU execution');
assert.match(routeSource, /MEMORY_ATTENTION_ONLINE_SOFTMAX_WGSL/, 'memory attention must use a bounded-memory online-softmax kernel');
assert.match(routeSource, /numObjPtrTokens/, 'memory attention must preserve the pointer-tail exclusion contract');
assert.doesNotMatch(routeSource, /dimension >= dims\.head_dim\) \{ return; \}/, 'online-softmax must not put a lane-dependent return above workgroup barriers');
assert.match(routeSource, /CrossKAdd[\s\S]*addBindings\('keyA', 'keyB', 'keyRope', 'memoryAdd'\)/, 'cross-key composition must cover all spatial and pointer-tail memory tokens');
assert.match(routeSource, /CrossKPosAdd[\s\S]*addBindings\('keyRope', 'memoryImagePos', 'keyA', 'memoryAdd'\)/, 'cross-key positional composition must cover the pointer tail');

assert.equal(SAM31_MEMORY_ATTENTION_PHASE_PROGRAM_ROUTE_ID, 'sam3.1.memory-attention.phase-program.webgpu-local.v0');
const route = createSam31MemoryAttentionPhaseProgramRouteDefinition();
assert.deepEqual(route.requiredInputRoles, [
  'source-image',
  'sam31-memory-attention-current-tensors',
  'sam31-memory-attention-bank-tensors',
  'sam31-memory-attention-weights',
]);
assert.deepEqual(route.requiredOutputRoles, ['sam31-memory-conditioned-features']);
assert.equal(validateRouteDefinition(route).ok, true);
for (let layer = 0; layer < 4; layer += 1) {
  for (const stage of ['self-rope', 'self-attention', 'cross-image-query', 'cross-memory-key', 'cross-rope-pointer-tail', 'cross-attention', 'mlp-gelu']) {
    assert.ok(route.requiredStages.includes(`memory-attention-layer-${layer}-${stage}`), `route must expose layer ${layer} ${stage}`);
  }
}
assert.ok(route.requiredStages.includes('memory-attention-final-layernorm'));

const channels = 8;
const mlpHidden = 16;
const zeros = length => new Float32Array(length);
const identity = size => {
  const out = zeros(size * size);
  for (let index = 0; index < size; index += 1) out[index * size + index] = 1;
  return out;
};
const projection = (inputChannels, outputChannels, useIdentity = false) => ({
  weight: useIdentity ? identity(inputChannels) : zeros(inputChannels * outputChannels),
  bias: zeros(outputChannels),
  inChannels: inputChannels,
  outChannels: outputChannels,
});
const norm = () => ({ weight: new Float32Array(channels).fill(1), bias: zeros(channels), epsilon: 1e-5 });
const layer = {
  norm1: norm(),
  selfQ: projection(channels, channels),
  selfK: projection(channels, channels),
  selfV: projection(channels, channels),
  selfOut: projection(channels, channels),
  norm2: norm(),
  crossQ: projection(channels, channels),
  crossK: projection(channels, channels),
  crossV: projection(channels, channels, true),
  crossOut: projection(channels, channels, true),
  imageCrossQ: projection(channels, channels),
  imageCrossK: projection(channels, channels),
  norm3: norm(),
  linear1: projection(channels, mlpHidden),
  linear2: projection(mlpHidden, channels),
};
const shape = {
  batch: 1,
  queryHeight: 2,
  queryWidth: 2,
  queryTokens: 4,
  memorySpatialTokens: 4,
  numObjPtrTokens: 2,
  memoryTokens: 6,
  channels,
  heads: 2,
  headDim: 4,
  mlpHidden,
  layerCount: 1,
};
const current = {
  image: zeros(4 * channels),
  src: new Float32Array(Array.from({ length: 4 * channels }, (_, index) => index % channels + 1)),
  srcPos: zeros(4 * channels),
};
const bank = {
  memoryImage: zeros(4 * channels),
  memory: zeros(6 * channels),
  memoryImagePos: zeros(4 * channels),
  memoryPos: zeros(6 * channels),
};
for (let token = 4; token < 6; token += 1) bank.memory[token * channels] = 1;
const oracle = createSam31MemoryAttentionPhaseProgramCpuOracle({
  shape,
  current,
  bank,
  layers: [layer],
  finalNorm: norm(),
});
assert.deepEqual(oracle.shape, shape);
assert.equal(oracle.memory.length, 4 * channels);
assert.equal(oracle.layerOutputs.length, 1);
assert.deepEqual(Object.keys(oracle.stageOutputs[0]), [
  'selfAttentionResidual',
  'crossQueryRope',
  'crossKeyRope',
  'crossValue',
  'crossAttention',
  'crossAttentionResidual',
  'mlpResidual',
]);
assert.ok(Math.abs(oracle.memory[0] - -1.43906236) < 1e-6, `unexpected pointer-conditioned normalized value ${oracle.memory[0]}`);
assert.ok(Math.abs(oracle.memory[7] - 1.55119709) < 1e-6, `unexpected final normalized value ${oracle.memory[7]}`);
assert.throws(
  () => createSam31MemoryAttentionPhaseProgramCpuOracle({
    shape,
    current,
    bank,
    layers: [{ ...layer, norm1: { ...layer.norm1, epsilon: 1e-6 } }],
    finalNorm: norm(),
  }),
  /epsilon must equal 0\.00001/,
  'route must reject layer-norm epsilon values that disagree with the WGSL-baked official constant',
);

const ropeInput = new Float32Array([
  1, 0, 1, 0,
  1, 0, 1, 0,
  1, 0, 1, 0,
  1, 0, 1, 0,
  1, 0, 1, 0,
  1, 0, 1, 0,
]);
const rope = applySam31AxialRope(ropeInput, {
  batch: 1,
  tokens: 6,
  channels: 4,
  heads: 1,
  headDim: 4,
  baseTokens: 4,
  gridWidth: 2,
  rotatedTokens: 4,
  theta: 10000,
});
assert.ok(Math.abs(rope[4] - Math.cos(1)) < 1e-6);
assert.ok(Math.abs(rope[5] - Math.sin(1)) < 1e-6);
assert.deepEqual(Array.from(rope.slice(16, 24)), [1, 0, 1, 0, 1, 0, 1, 0], 'pointer tail must remain unrotated');

console.log('sam3.1 memory attention phase-program contracts passed');
