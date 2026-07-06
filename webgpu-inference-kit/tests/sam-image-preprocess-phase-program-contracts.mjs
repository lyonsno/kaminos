import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-image-preprocess-phase-program.js', import.meta.url);
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const stackExporter = readFileSync(new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /sam-image-preprocess-phase-program-contracts\.mjs/, 'default test must include portable SAM3 image-preprocess ingress contracts');
assert.equal(existsSync(routeSourceUrl), true, 'SAM3 image-preprocess route source must exist');

const routeSource = existsSync(routeSourceUrl) ? readFileSync(routeSourceUrl, 'utf8') : '';
assert.match(routeSource, /SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID/, 'image-preprocess route must export stable route identity');
assert.match(routeSource, /defineProgram/, 'image-preprocess route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'image-preprocess route must execute through runProgram');
assert.match(routeSource, /image-u8-to-normalized-f32/, 'image-preprocess route must include u8 RGB to normalized f32 phase metadata');
assert.match(routeSource, /readback-pixel-values/, 'image-preprocess route must expose readback identity for ingress parity');

assert.match(stackExporter, /expected-pixel-values/, 'detector-stack packet must export expected normalized image pixel values');
assert.match(stackExporter, /imagePreprocess/, 'detector-stack packet must identify the image-preprocess ingress boundary');

assert.match(witness, /mlx-detector-stack-preprocess-export/, 'witness must allow detector-stack packet mode with browser-local image preprocess ingress');
assert.match(witness, /IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve SAM3 image-preprocess route identity');
assert.match(witness, /imagePreprocessReport/, 'witness must emit compact imagePreprocess report evidence');
assert.match(witness, /pixelValuesMaxAbsDiff/, 'witness must assert normalized pixel-values parity');

assert.match(smokeJs, /runSam3ImagePreprocessPhaseProgramRoute/, 'browser smoke must execute image-preprocess ingress route');
assert.match(smokeJs, /image-preprocess-detector-stack-composition/, 'browser smoke must expose detector-stack composition with browser-local image preprocess ingress');
assert.match(smokeJs, /imagePreprocessEvidence/, 'browser smoke state must preserve image-preprocess evidence');
assert.match(smokeJs, /pixelValuesOutput/, 'browser smoke must preserve normalized pixel-values output identity as an ingress edge');

const {
  SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID,
  createSam3ImagePreprocessPhaseProgramCpuOracle,
  createSam3ImagePreprocessPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');

const route = createSam3ImagePreprocessPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-image-preprocess-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['source-image', 'sam3-image-preprocess-tensors']);
assert.deepEqual(route.requiredOutputRoles, ['pixel-values']);
assert.equal(validateRouteDefinition(route).ok, true);

const oracle = createSam3ImagePreprocessPhaseProgramCpuOracle({
  rgba: new Uint8ClampedArray([
    0, 127, 255, 255,
    255, 127, 0, 255,
  ]),
  shape: { batch: 1, height: 1, width: 2, channels: 3 },
});
assert.deepEqual(Array.from(oracle.pixelValues), [-1, -0.003921568859368563, 1, 1, -0.003921568859368563, -1]);

console.log('sam image preprocess phase-program contracts passed');
