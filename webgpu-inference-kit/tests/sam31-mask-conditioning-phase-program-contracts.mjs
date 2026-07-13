import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam31-mask-conditioning-phase-program.js', import.meta.url);

assert.match(packageJson.scripts.test, /sam31-mask-conditioning-phase-program-contracts\.mjs/, 'default tests must cover the native SAM3.1 mask-conditioning route');
assert.equal(existsSync(routeSourceUrl), true, 'the SAM3.1 mask-conditioning phase-program source must exist');

const routeSource = readFileSync(routeSourceUrl, 'utf8');
assert.match(routeSource, /defineProgram/, 'mask conditioning must use the shared phase-program runtime');
assert.match(routeSource, /runProgram/, 'mask conditioning must execute through the shared phase-program runtime');
assert.match(routeSource, /mask-conditioning-logits-and-appearance/, 'the route must execute binary-mask logits and appearance scoring together');
assert.match(routeSource, /sam31-mask-conditioning-phase-program-v0/, 'the route must stamp kernel profile identity');

const {
  SAM31_MASK_CONDITIONING_PHASE_PROGRAM_ROUTE_ID,
  createSam31MaskConditioningPhaseProgramCpuOracle,
  createSam31MaskConditioningPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');

const route = createSam31MaskConditioningPhaseProgramRouteDefinition({
  kernel: { profile: 'sam31-mask-conditioning-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM31_MASK_CONDITIONING_PHASE_PROGRAM_ROUTE_ID);
assert.equal(route.backendKind, 'webgpu-local');
assert.deepEqual(route.requiredInputRoles, ['source-frame', 'sam31-binary-mask-inputs']);
assert.deepEqual(route.requiredOutputRoles, ['sam31-mask-conditioning-logits', 'sam31-mask-conditioning-object-scores']);
assert.equal(validateRouteDefinition(route).ok, true);

const binaryMasks = new Float32Array([
  0, 0, 0, 0,
  0, 1, 0, 0,
  1, 1, 1, 1,
  0, 0, 1, 0,
]);
const oracle = createSam31MaskConditioningPhaseProgramCpuOracle({
  binaryMasks,
  shape: { multiplexCount: 4, maskHeight: 2, maskWidth: 2 },
});
assert.deepEqual(Array.from(oracle.maskLogits), [
  -10, -10, -10, -10,
  -10, 10, -10, -10,
  10, 10, 10, 10,
  -10, -10, 10, -10,
]);
assert.deepEqual(Array.from(oracle.objectScores), [-10, 10, 10, 10]);
assert.deepEqual(Array.from(oracle.appearing), [0, 1, 1, 1]);

assert.throws(
  () => createSam31MaskConditioningPhaseProgramCpuOracle({ binaryMasks: new Float32Array([0, 0.25, 1, 0]), shape: { multiplexCount: 1, maskHeight: 2, maskWidth: 2 } }),
  /binaryMasks.*0 or 1/,
  'fractional masks must not silently become an official binary conditioning transaction',
);
assert.throws(
  () => createSam31MaskConditioningPhaseProgramCpuOracle({ binaryMasks: new Float32Array(3), shape: { multiplexCount: 1, maskHeight: 2, maskWidth: 2 } }),
  /binaryMasks length/,
  'mask geometry must be exact',
);

console.log('sam3.1 mask-conditioning phase-program contracts passed');
