import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SAM31_TEMPORAL_MEMORY_BANK_PHASE_PROGRAM_ROUTE_ID,
  createSam31TemporalMemoryBankCpuOracle,
  createSam31TemporalMemoryBankPhaseProgramRouteDefinition,
  createSam31TemporalMemoryBankPlan,
  getSam31TemporalPointerPositionEncoding,
  validateRouteDefinition,
} from '../src/index.js';

const source = readFileSync(new URL('../src/sam31-temporal-memory-bank-phase-program.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /gpuExecutor/, 'temporal bank assembly must own native WebGPU tensor execution');
assert.match(source, /runtime\.defineProgram/, 'temporal bank assembly must use the shared phase-program runtime');
assert.match(source, /TEMPORAL_SPATIAL_ASSEMBLY_WGSL/, 'spatial memory and temporal position addition must execute on WebGPU');
assert.match(source, /TEMPORAL_POINTER_POSITION_WGSL/, 'pointer sine position and checkpoint projection must execute on WebGPU');

assert.equal(SAM31_TEMPORAL_MEMORY_BANK_PHASE_PROGRAM_ROUTE_ID, 'sam3.1.temporal-memory-bank.phase-program.webgpu-local.v0');
const route = createSam31TemporalMemoryBankPhaseProgramRouteDefinition();
assert.deepEqual(route.requiredInputRoles, [
  'source-video-episode',
  'sam31-temporal-spatial-memory-frames',
  'sam31-temporal-object-pointer-frames',
  'sam31-temporal-memory-position-weights',
]);
assert.deepEqual(route.requiredOutputRoles, ['sam31-temporal-memory-attention-bank']);
assert.equal(validateRouteDefinition(route).ok, true);
for (const stage of [
  'temporal-memory-load-tensors',
  'temporal-memory-spatial-assembly',
  'temporal-memory-pointer-copy',
  'temporal-memory-pointer-position',
  'temporal-memory-readback',
]) assert.ok(route.requiredStages.includes(stage), `missing ${stage}`);

const plan = createSam31TemporalMemoryBankPlan({
  frameIndex: 8,
  numFrames: 11,
  conditioningFrameIndices: [0, 1, 3, 9, 10],
  nonConditioningFrameIndices: [2, 4, 5, 6, 7],
  frameTokenCount: 4,
  multiplexCount: 16,
  numMaskmem: 7,
  maxConditioningFrames: 4,
  maxObjectPointerFrames: 16,
  memoryTemporalStride: 1,
  useMaskmemTemporalPositionV2: true,
  trackInReverse: false,
});

assert.deepEqual(plan.selectedConditioningFrameIndices, [3, 9, 10, 1]);
assert.deepEqual(plan.unselectedConditioningFrameIndices, [0]);
assert.deepEqual(plan.spatialFrames.map(frame => frame.frameIndex), [3, 9, 10, 1, 2, 4, 5, 6, 7]);
assert.deepEqual(plan.spatialFrames.map(frame => frame.temporalPositionIndex), [1, 6, 6, 6, 5, 3, 2, 1, 0]);
assert.deepEqual(plan.pointerFrames.map(frame => frame.frameIndex), [3, 9, 10, 1, 7, 6, 5, 4, 2, 0]);
assert.deepEqual(plan.pointerFrames.map(frame => frame.relativePosition), [5, 1, 2, 7, 1, 2, 3, 4, 6, 8]);
assert.equal(plan.spatialTokenCount, 36);
assert.equal(plan.objectPointerTokenCount, 160);
assert.equal(plan.memoryTokenCount, 196);

const channels = 8;
const frameTokens = 2;
const multiplexCount = 2;
const smallPlan = createSam31TemporalMemoryBankPlan({
  frameIndex: 2,
  numFrames: 3,
  conditioningFrameIndices: [0],
  nonConditioningFrameIndices: [1],
  frameTokenCount: frameTokens,
  multiplexCount,
  numMaskmem: 3,
  maxConditioningFrames: 2,
  maxObjectPointerFrames: 3,
  memoryTemporalStride: 1,
  useMaskmemTemporalPositionV2: true,
  trackInReverse: false,
});
const values = (length, offset) => new Float32Array(Array.from({ length }, (_, index) => offset + index / 100));
const spatialFrames = smallPlan.spatialFrames.map((frame, index) => ({
  frameIndex: frame.frameIndex,
  memory: values(frameTokens * channels, 10 + index),
  memoryPosition: values(frameTokens * channels, 20 + index),
  image: values(frameTokens * channels, 30 + index),
  imagePosition: values(frameTokens * channels, 40 + index),
}));
const pointerFrames = smallPlan.pointerFrames.map((frame, index) => ({
  frameIndex: frame.frameIndex,
  pointers: values(multiplexCount * channels, 50 + index),
}));
const temporalEmbeddings = values(3 * channels, 0.25);
const projectionWeight = new Float32Array(channels * channels);
for (let index = 0; index < channels; index += 1) projectionWeight[index * channels + index] = 1;
const projectionBias = new Float32Array(channels);
const oracle = createSam31TemporalMemoryBankCpuOracle({
  plan: smallPlan,
  spatialFrames,
  pointerFrames,
  temporalEmbeddings,
  pointerPositionProjection: { weight: projectionWeight, bias: projectionBias },
  channels,
  multiplexCount,
});
assert.equal(oracle.memoryImage.length, smallPlan.spatialTokenCount * channels);
assert.equal(oracle.memory.length, smallPlan.memoryTokenCount * channels);
assert.equal(oracle.memoryPosition.length, smallPlan.memoryTokenCount * channels);
assert.deepEqual(Array.from(oracle.memory.slice(smallPlan.spatialTokenCount * channels)), pointerFrames.flatMap(frame => Array.from(frame.pointers)));
const expectedPointerPosition = getSam31TemporalPointerPositionEncoding({ relativePosition: smallPlan.pointerFrames[0].relativePosition, maxObjectPointerFrames: 3, channels });
assert.deepEqual(Array.from(oracle.memoryPosition.slice(smallPlan.spatialTokenCount * channels, (smallPlan.spatialTokenCount + 1) * channels)), Array.from(expectedPointerPosition));
assert.deepEqual(Array.from(oracle.memoryPosition.slice((smallPlan.spatialTokenCount + 1) * channels, (smallPlan.spatialTokenCount + 2) * channels)), Array.from(expectedPointerPosition), 'one pointer frame position must repeat across its multiplex slots');

assert.throws(
  () => createSam31TemporalMemoryBankPlan({
    frameIndex: 1,
    numFrames: 3,
    conditioningFrameIndices: [0, 2],
    nonConditioningFrameIndices: [],
    frameTokenCount: 4,
    multiplexCount: 16,
    numMaskmem: 7,
    maxConditioningFrames: 1,
    maxObjectPointerFrames: 16,
  }),
  /2\+ conditioning frames/,
  'the browser planner must preserve Meta selection preconditions',
);

console.log('sam3.1 temporal memory-bank phase-program contracts passed');
