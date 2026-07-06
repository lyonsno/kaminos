import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-scoring-phase-program.js', import.meta.url);

assert.match(packageJson.scripts.test, /sam-scoring-phase-program-contracts\.mjs/, 'default test must include portable SAM3 scoring phase-program contracts');
assert.ok(packageJson.scripts['test:live:sam-scoring']?.includes('sam-scoring-mlx-packet-contracts.mjs'), 'live SAM3 scoring MLX packet contract must be explicit');
assert.doesNotMatch(packageJson.scripts.test, /sam-scoring-mlx-packet-contracts\.mjs/, 'default test must not require private MLX SAM3 scoring packet export');
assert.equal(existsSync(new URL('../tools/sam-scoring-mlx-packet.py', import.meta.url)), true, 'SAM3 scoring MLX packet exporter must exist');
assert.equal(existsSync(routeSourceUrl), true, 'SAM3 scoring route source must exist');

const routeSource = readFileSync(routeSourceUrl, 'utf8');
assert.match(routeSource, /defineProgram/, 'SAM3 scoring route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'SAM3 scoring route must execute through runProgram');
assert.match(routeSource, /scoring-text-mlp-fc1-relu/, 'SAM3 scoring route must include text MLP expansion phase');
assert.match(routeSource, /scoring-mask-pool-text/, 'SAM3 scoring route must include masked text pooling phase');
assert.match(routeSource, /scoring-query-proj/, 'SAM3 scoring route must include query projection phase');
assert.match(routeSource, /scoring-dot-product/, 'SAM3 scoring route must include scaled dot-product phase');
assert.match(routeSource, /sam3-scoring-phase-program-v0/, 'SAM3 scoring route must stamp kernel profile identity');

const {
  SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID,
  createSam3ScoringPhaseProgramCpuOracle,
  createSam3ScoringPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');

const route = createSam3ScoringPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-scoring-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID);
assert.equal(route.backendKind, 'webgpu-local');
assert.deepEqual(route.requiredInputRoles, ['source-image', 'sam3-scoring-tensors', 'sam3-scoring-weights']);
assert.deepEqual(route.requiredOutputRoles, ['pred-logits']);
assert.equal(validateRouteDefinition(route).ok, true);

const oracle = createSam3ScoringPhaseProgramCpuOracle({
  hiddenStates: new Float32Array([1, 2]),
  promptFeatures: new Float32Array([1, 0, 0, 2]),
  promptMask: new Float32Array([1, 0]),
  weights: {
    textMlpLayer1Weight: new Float32Array([1, 0, 0, 1, -1, 0, 0, -1]),
    textMlpLayer1Bias: new Float32Array([0, 0, 0, 0]),
    textMlpLayer2Weight: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0]),
    textMlpLayer2Bias: new Float32Array([0, 0]),
    textMlpOutNormWeight: new Float32Array([1, 1]),
    textMlpOutNormBias: new Float32Array([0, 0]),
    textProjWeight: new Float32Array([1, 0, 0, 1]),
    textProjBias: new Float32Array([0, 0]),
    queryProjWeight: new Float32Array([1, 0, 0, 1]),
    queryProjBias: new Float32Array([0, 0]),
  },
  shape: { layerCount: 1, batch: 1, queryTokens: 1, promptTokens: 2, channels: 2, mlpHidden: 4 },
});

assert.equal(oracle.predLogits.length, 1);
assert.ok(Math.abs(oracle.predLogits[0] + 0.70710677) < 0.00001, `predLogits[0] ${oracle.predLogits[0]}`);

console.log('sam scoring phase-program contracts passed');
