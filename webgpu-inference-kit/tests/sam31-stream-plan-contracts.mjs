// kaminos-test: node
import assert from 'node:assert/strict';
import { createSam31TemporalMemoryBankPlan } from '../src/sam31-temporal-memory-bank-phase-program.js';

const base = { numFrames: null, frameTokenCount: 4, multiplexCount: 16, numMaskmem: 7,
  maxConditioningFrames: 4, maxObjectPointerFrames: 16, memoryTemporalStride: 1,
  conditioningFrameIndices: [0], useMaskmemTemporalPositionV2: true };
const first = createSam31TemporalMemoryBankPlan({ ...base, frameIndex: 1, nonConditioningFrameIndices: [] });
assert.equal(first.numFrames, null);
assert.equal(first.maxObjectPointerFrames, 16, 'unknown stream length must not shrink the pointer time scale');
assert.deepEqual(first.spatialFrames.map(f => f.frameIndex), [0]);
const later = createSam31TemporalMemoryBankPlan({ ...base, frameIndex: 25,
  nonConditioningFrameIndices: Array.from({ length: 24 }, (_, i) => i + 1) });
assert.deepEqual(later.spatialFrames.map(f => f.frameIndex), [0, 19, 20, 21, 22, 23, 24]);
assert.deepEqual(later.pointerFrames.map(f => f.frameIndex), [0, ...Array.from({ length: 15 }, (_, i) => 24 - i)]);
assert.equal(later.memoryTokenCount, 7 * 4 + 16 * 16);
assert.throws(() => createSam31TemporalMemoryBankPlan({ ...base, frameIndex: 1,
  nonConditioningFrameIndices: [], trackInReverse: true }), /stream.*reverse/i);
const finite = createSam31TemporalMemoryBankPlan({ ...base, numFrames: 2, frameIndex: 1, nonConditioningFrameIndices: [] });
assert.equal(finite.maxObjectPointerFrames, 2, 'finite fixture behavior must stay unchanged');
console.log('SAM3.1 unbounded forward stream planning contracts passed');
