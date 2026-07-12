import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  SAM3_PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID,
  createSam3PromptTextIngressPhaseProgramCpuOracle,
  createSam3PromptTextIngressPhaseProgramRouteDefinition,
  validateRouteDefinition,
} from '../src/index.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-prompt-text-ingress-phase-program.js', import.meta.url);
const stackExporterUrl = new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url);
const browserSmokeUrl = new URL('../smokes/sam-mask-island-parity.js', import.meta.url);
const witnessUrl = new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url);

assert.match(packageJson.scripts.test, /sam-prompt-text-ingress-phase-program-contracts\.mjs/, 'default test must include portable prompt/text ingress phase-program contracts');
assert.equal(existsSync(routeSourceUrl), true, 'prompt/text ingress route source must exist');

const routeSource = readFileSync(routeSourceUrl, 'utf8');
assert.match(routeSource, /defineProgram/, 'prompt/text ingress route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'prompt/text ingress route must execute through runProgram');
assert.match(routeSource, /prompt-token-position-embedding/, 'prompt/text ingress route must include token plus position embedding phase names');
assert.match(routeSource, /prompt-text-layernorm1/, 'prompt/text ingress route must include CLIP layernorm1 phase names');
assert.match(routeSource, /prompt-text-qkv/, 'prompt/text ingress route must include CLIP q/k/v phase names');
assert.match(routeSource, /prompt-text-causal-attention/, 'prompt/text ingress route must include CLIP causal attention phase names');
assert.match(routeSource, /prompt-text-mlp/, 'prompt/text ingress route must include CLIP MLP phase names');
assert.match(routeSource, /prompt-text-final-layernorm/, 'prompt/text ingress route must include CLIP final layernorm phase names');
assert.match(routeSource, /prompt-text-projection/, 'prompt/text ingress route must include detector projection phase names');
assert.match(routeSource, /prompt-mask-copy/, 'prompt/text ingress route must include attention-mask copy phase names');
assert.match(routeSource, /readback-prompt-text-ingress/, 'prompt/text ingress route must expose a readback boundary');
assert.match(routeSource, /sam3-prompt-text-ingress-phase-program-v0/, 'prompt/text ingress route must stamp kernel profile identity');
assert.match(routeSource, /erfApprox/, 'prompt/text CLIP MLP GELU must match MLX nn.gelu exact-erf semantics, not the tanh approximation');
assert.doesNotMatch(routeSource, /0\.044715/, 'prompt/text CLIP MLP GELU must not use the tanh approximation constant');
assert.match(routeSource, /gatherPromptTokenEmbeddings/, 'prompt/text GPU route must gather requested token embedding rows before upload');
assert.doesNotMatch(routeSource, /tokenEmbeddingWeight: createWeightTensor\('sam3\.prompt-text\.token-embedding-weight', weights\.tokenEmbeddingWeight, \[shape\.vocabSize, shape\.hiddenSize\]\)/, 'prompt/text GPU route must not bind the full CLIP vocab embedding table as one storage buffer');

const route = createSam3PromptTextIngressPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-prompt-text-ingress-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID);
assert.equal(route.backendKind, 'webgpu-local');
assert.deepEqual(route.requiredInputRoles, ['source-image', 'sam3-prompt-text-tensors', 'sam3-prompt-text-weights']);
assert.deepEqual(route.requiredOutputRoles, ['prompt-features', 'prompt-mask']);
assert.equal(validateRouteDefinition(route).ok, true);

const oracle = createSam3PromptTextIngressPhaseProgramCpuOracle({
  inputIds: new Uint32Array([2, 0]),
  attentionMask: new Float32Array([1, 0]),
  weights: {
    tokenEmbeddingWeight: new Float32Array([0, 0, 10, 10, 2, 4]),
    positionEmbeddingWeight: new Float32Array([1, 1, 0, 0]),
    finalLayerNormWeight: new Float32Array([1, 1]),
    finalLayerNormBias: new Float32Array([0, 0]),
    textProjectionWeight: new Float32Array([1, 0, 0, 1]),
    textProjectionBias: new Float32Array([0, 0]),
    layers: [{
      layerNorm1Weight: new Float32Array([1, 1]),
      layerNorm1Bias: new Float32Array([0, 0]),
      qWeight: new Float32Array([0, 0, 0, 0]),
      qBias: new Float32Array([0, 0]),
      kWeight: new Float32Array([0, 0, 0, 0]),
      kBias: new Float32Array([0, 0]),
      vWeight: new Float32Array([0, 0, 0, 0]),
      vBias: new Float32Array([0, 0]),
      oWeight: new Float32Array([0, 0, 0, 0]),
      oBias: new Float32Array([0, 0]),
      layerNorm2Weight: new Float32Array([1, 1]),
      layerNorm2Bias: new Float32Array([0, 0]),
      fc1Weight: new Float32Array([0, 0, 0, 0]),
      fc1Bias: new Float32Array([0, 0]),
      fc2Weight: new Float32Array([0, 0, 0, 0]),
      fc2Bias: new Float32Array([0, 0]),
    }],
  },
  shape: { batch: 1, promptTokens: 2, hiddenSize: 2, channels: 2, intermediateSize: 2, heads: 1, layerCount: 1, vocabSize: 3, maxPositionEmbeddings: 2 },
});
assert.ok(Math.abs(oracle.promptFeatures[0] + 0.999995) < 0.00001, `prompt feature[0] ${oracle.promptFeatures[0]}`);
assert.ok(Math.abs(oracle.promptFeatures[1] - 0.999995) < 0.00001, `prompt feature[1] ${oracle.promptFeatures[1]}`);
assert.deepEqual(Array.from(oracle.promptFeatures.slice(2)), [0, 0], 'zero residual path should keep padded second token at projected zero');
assert.deepEqual(Array.from(oracle.promptMask), [1, 0], 'prompt mask must copy the exported attention mask exactly');

const exporterSource = readFileSync(stackExporterUrl, 'utf8');
assert.match(exporterSource, /prompt-input-ids/, 'detector-stack exporter must preserve prompt input ids for browser prompt/text ingress');
assert.match(exporterSource, /prompt-attention-mask/, 'detector-stack exporter must preserve prompt attention mask for browser prompt/text ingress');
assert.match(exporterSource, /prompt-token-embedding-weight/, 'detector-stack exporter must export token embedding weights for browser prompt/text ingress');
assert.match(exporterSource, /prompt-position-embedding-weight/, 'detector-stack exporter must export position embedding weights for browser prompt/text ingress');
assert.match(exporterSource, /prompt-text-projection-weight/, 'detector-stack exporter must export detector text projection weights for browser prompt/text ingress');
assert.match(exporterSource, /expected-prompt-features/, 'detector-stack exporter must keep reference prompt features separate from browser-owned prompt output');
assert.match(exporterSource, /expected-prompt-mask/, 'detector-stack exporter must keep reference prompt mask separate from browser-owned prompt output');
assert.match(exporterSource, /browser-derived-from-prompt-text-ingress/, 'detector-stack ownership metadata must mark prompt features as browser-derived in image-FPN mode');
assert.match(exporterSource, /browser-copied-from-prompt-attention-mask/, 'detector-stack ownership metadata must mark prompt mask as browser-derived in image-FPN mode');
assert.match(exporterSource, /browser-fpn-prompt-text-pixel-detector-stack/, 'detector-stack tolerance source must distinguish prompt/text ingress ownership');

const browserSmokeSource = readFileSync(browserSmokeUrl, 'utf8');
assert.match(browserSmokeSource, /SAM3_PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID/, 'browser smoke must import prompt/text ingress route identity');
assert.match(browserSmokeSource, /createSam3PromptTextIngressPhaseProgramCpuOracle/, 'browser smoke must CPU-check prompt/text ingress');
assert.match(browserSmokeSource, /runSam3PromptTextIngressPhaseProgramRoute/, 'browser smoke must execute browser prompt/text ingress before DETR');
assert.match(browserSmokeSource, /browserPromptTextEvidence/, 'browser smoke must expose browser prompt/text evidence');
assert.match(browserSmokeSource, /promptTextMaxAbsDiff/, 'browser smoke must report prompt feature parity from prompt/text ingress');
assert.match(browserSmokeSource, /promptMaskMaxAbsDiff/, 'browser smoke must report prompt mask parity from prompt/text ingress');
assert.match(browserSmokeSource, /textTensorOwner: 'browser-local-prompt-text-ingress',\s*nonClaims:\s*\{\s*browserTokenizer: false/, 'browser smoke FPN->DETR evidence must affirm browser tokenization after Gate S owns runtime prompt tensors');
assert.match(browserSmokeSource, /promptTensorOwner: 'browser-local-prompt-text-ingress'/, 'browser smoke prompt-FPN evidence must name browser prompt/text ingress as the prompt tensor owner');
assert.match(browserSmokeSource, /promptTensorOwner: 'browser-local-prompt-text-ingress',[\s\S]*?nonClaims:\s*\{\s*browserTokenizer: false/, 'browser smoke prompt-FPN evidence must carry browser tokenizer ownership downstream');
assert.match(browserSmokeSource, /sam3-prompt-text-tensors:browser-image-fpn-detector-stack-composition/, 'browser smoke must give prompt/text tensors a composition artifact id');
assert.match(browserSmokeSource, /sam3-prompt-features:browser-image-fpn-detector-stack-composition/, 'browser smoke must give browser prompt-features a composition artifact id');
assert.match(browserSmokeSource, /sam3-prompt-mask:browser-image-fpn-detector-stack-composition/, 'browser smoke must give browser prompt-mask a composition artifact id');

const witnessSource = readFileSync(witnessUrl, 'utf8');
assert.match(witnessSource, /PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID/, 'witness must import prompt/text ingress route identity');
assert.match(witnessSource, /browserPromptTextEvidence/, 'witness report must preserve prompt/text evidence');
assert.match(witnessSource, /promptTextMaxAbsDiff/, 'witness must gate prompt/text parity');
assert.match(witnessSource, /text ingress evidence still non-claims browser-local text encoder/, 'witness must reject browser prompt/text ownership paired with a stale text-encoder non-claim');
assert.match(witnessSource, /prompt-FPN\/pixel evidence still non-claims browser-local text encoder/, 'witness must reject browser prompt-FPN ownership paired with a stale text-encoder non-claim');
assert.match(witnessSource, /compositionRouteReceipts\.length !== 13/, 'image-FPN prompt/text composition must require thirteen route receipts');
assert.match(witnessSource, /browser-fpn-prompt-text-pixel-detector-stack/, 'witness must require the prompt/text ingress tolerance source');

console.log('sam prompt/text ingress phase-program contracts passed');
