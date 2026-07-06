import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-selection-postprocess-phase-program.js', import.meta.url);
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const stackExporter = readFileSync(new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /sam-selection-postprocess-phase-program-contracts\.mjs/, 'default test must include portable SAM3 selection postprocess contracts');
assert.equal(existsSync(routeSourceUrl), true, 'SAM3 selection postprocess route source must exist');

const routeSource = existsSync(routeSourceUrl) ? readFileSync(routeSourceUrl, 'utf8') : '';
assert.match(routeSource, /SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID/, 'selection route must export stable route identity');
assert.match(routeSource, /defineProgram/, 'selection route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'selection route must execute through runProgram');
assert.match(routeSource, /selection-score-threshold/, 'selection route must include score-threshold phase metadata');
assert.match(routeSource, /selection-box-cxcywh-to-xyxy/, 'selection route must include box conversion phase metadata');
assert.match(routeSource, /selection-argmax/, 'selection route must include selected-object argmax phase metadata');

assert.match(stackExporter, /--include-selection/, 'DETR stack exporter must expose an explicit selection-inclusion switch');
assert.match(stackExporter, /expected-selection-scores/, 'DETR stack selection packet must export expected postprocess scores');
assert.match(stackExporter, /expected-selected-index/, 'DETR stack selection packet must export expected selected index');

assert.match(witness, /mlx-detr-stack-selection-export/, 'witness must allow a real DETR stack -> scoring -> selection packet mode');
assert.match(witness, /SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve SAM3 selection route identity');
assert.match(witness, /selectionTensorSha256/, 'witness must assert scoring, box, and presence outputs compose into selection receipt input');
assert.match(witness, /selectionOutput/, 'witness must assert selection receipt output identity');
assert.match(witness, /compositionRouteReceipts\.length !== 5/, 'witness must require encoder, decoder, scoring, selection, and mask-tail route receipts');

assert.match(smokeJs, /runSam3SelectionPostprocessPhaseProgramRoute/, 'browser smoke must execute selection route inside the composed stack');
assert.match(smokeJs, /detr-encoder-detr-decoder-scoring-selection-mask-tail-composition/, 'browser smoke must expose contiguous DETR -> scoring -> selection -> mask-tail composition');
assert.match(smokeJs, /selectedIndexMaxAbsDiff/, 'browser smoke must report selected index parity');
assert.match(smokeJs, /selectedScoreMaxAbsDiff/, 'browser smoke must report selected score parity');
assert.match(smokeJs, /selectedBoxMaxAbsDiff/, 'browser smoke must report selected box parity');
assert.match(smokeJs, /selectionKeepMismatchCount/, 'browser smoke must report explicit selection keep-mask parity');

const {
  SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID,
  createSam3SelectionPostprocessPhaseProgramCpuOracle,
  createSam3SelectionPostprocessPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');

const route = createSam3SelectionPostprocessPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-selection-postprocess-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['source-image', 'sam3-selection-tensors']);
assert.deepEqual(route.requiredOutputRoles, ['selection-scores', 'selection-boxes', 'selection-keep', 'selected-index', 'selected-score', 'selected-box']);
assert.equal(validateRouteDefinition(route).ok, true);

const oracle = createSam3SelectionPostprocessPhaseProgramCpuOracle({
  predLogits: new Float32Array([-4, 4, 3]),
  referenceBoxes: new Float32Array([0.5, 0.5, 0.2, 0.2, 0.5, 0.5, 0.4, 0.4, 0.25, 0.25, 0.2, 0.2]),
  presenceLogits: new Float32Array([2]),
  shape: { layerCount: 1, batch: 1, queryTokens: 3, imageHeight: 100, imageWidth: 200, scoreThreshold: 0.5 },
});
assert.equal(oracle.selectedIndex[0], 1);
assert.ok(oracle.keep[1] === 1 && oracle.keep[0] === 0, 'selection threshold must keep only scores above threshold');
assert.ok(Math.abs(oracle.boxes[4] - 60) < 0.00001 && Math.abs(oracle.boxes[6] - 140) < 0.00001, 'selection box conversion must scale x by image width');

console.log('sam selection postprocess phase-program contracts passed');
