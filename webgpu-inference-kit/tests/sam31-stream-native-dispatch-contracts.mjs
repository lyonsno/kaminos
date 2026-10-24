// kaminos-test: node
import assert from 'node:assert/strict';
import * as temporal from '../src/sam31-temporal-memory-bank-phase-program.js';
import { createSam31MemoryAttentionDispatchPlan } from '../src/sam31-memory-attention-phase-program.js';
assert.equal(typeof temporal.createSam31TemporalMemoryDispatchPlan, 'function', 'production temporal memory must tile beyond one dispatch dimension');
function coverage({ dispatch, logicalInvocations }, limit = 65535) {
  assert.ok(dispatch.every(n => Number.isSafeInteger(n) && n > 0 && n <= limit));
  const [nx, ny = 1, nz = 1] = dispatch;
  let next = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const first = (x + y * nx + z * nx * ny) * 64;
    assert.equal(first, next, 'flattened dispatch covers each workgroup exactly once'); next += 64;
  }
  assert.ok(next >= logicalInvocations);
  assert.ok((nx * ny * (nz - 1)) * 64 < logicalInvocations, 'no wholly redundant depth plane');
}
for (let frameIndex = 1; frameIndex <= 16; frameIndex++) {
  const plan = temporal.createSam31TemporalMemoryBankPlan({ frameIndex, numFrames: null, frameTokenCount: 72 * 72,
    multiplexCount: 16, numMaskmem: 7, maxConditioningFrames: 4, maxObjectPointerFrames: 16,
    memoryTemporalStride: 1, conditioningFrameIndices: [0], nonConditioningFrameIndices: Array.from({ length: frameIndex - 1 }, (_, i) => i + 1) });
  const bank = temporal.createSam31TemporalMemoryDispatchPlan({ plan, channels: 256, batch: 1, maxWorkgroupsPerDimension: 65535 });
  coverage(bank.spatial); coverage(bank.pointer);
  assert.equal(bank.spatial.logicalInvocations, plan.spatialTokenCount * 256);
  const attention = createSam31MemoryAttentionDispatchPlan({ shape: { batch: 1, queryHeight: 72, queryWidth: 72,
    queryTokens: 5184, memorySpatialTokens: plan.spatialTokenCount, memoryTokens: plan.memoryTokenCount,
    numObjPtrTokens: plan.objectPointerTokenCount, channels: 256, heads: 8, headDim: 32, mlpHidden: 2048, layerCount: 4 }, maxWorkgroupsPerDimension: 65535 });
  coverage(attention.memory); coverage(attention.mlp1);
  assert.equal(attention.memory.logicalInvocations, plan.memoryTokenCount * 256);
  if (frameIndex >= 4) { assert.ok(bank.spatial.dispatch.length > 1); assert.ok(attention.memory.dispatch.length > 1); }
}
for (const code of [temporal.TEMPORAL_SPATIAL_ASSEMBLY_WGSL, temporal.TEMPORAL_POINTER_POSITION_WGSL]) {
  assert.match(code, /@builtin\(num_workgroups\)/);
  assert.match(code, /gid\.y \* dispatch_grid\.x \* 64u/);
  assert.match(code, /gid\.z \* dispatch_grid\.x \* dispatch_grid\.y \* 64u/);
}
console.log('Native SAM memory dispatch covers the full spatial/pointer window within device dimensions');
