import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const stackExporter = readFileSync(new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /sam-detr-stack-scoring-composition-contracts\.mjs/, 'default test must include portable DETR stack -> scoring composition contracts');

assert.match(stackExporter, /--include-scoring/, 'DETR stack exporter must expose an explicit scoring-inclusion switch');
assert.match(stackExporter, /expected-pred-logits/, 'DETR stack scoring packet must export MLX expected scoring logits');
assert.match(stackExporter, /add_scoring_weights/, 'DETR stack scoring packet must export dot-product scoring weights');

assert.match(witness, /mlx-detr-stack-scoring-export/, 'witness must allow a real DETR stack -> scoring packet mode');
assert.match(witness, /DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve the composed DETR stack scoring route identity');
assert.match(witness, /scoringTensorSha256/, 'witness must assert browser decoder hidden states compose into scoring receipt input');
assert.match(witness, /scoringOutput/, 'witness must assert scoring receipt output identity');
assert.match(witness, /compositionRouteReceipts\.length !== 4/, 'witness must require encoder, decoder, scoring, and mask-tail route receipts');

assert.match(smokeJs, /detr-encoder-detr-decoder-scoring-mask-tail-composition/, 'browser smoke must expose contiguous DETR encoder -> decoder -> scoring -> mask-tail composition');
assert.match(smokeJs, /scoringTensorSha256/, 'browser smoke must bind decoder hidden-state output into the scoring tensor receipt');
assert.match(smokeJs, /scoringOutput/, 'browser smoke must preserve scoring pred-logits output identity');
assert.match(smokeJs, /runSam3ScoringPhaseProgramRoute/, 'browser smoke must execute the scoring route inside the composed DETR stack');
assert.match(smokeJs, /expectedPredLogits/, 'browser smoke must compare composed scoring logits against MLX expected logits');

console.log('sam detr stack scoring composition contracts passed');
