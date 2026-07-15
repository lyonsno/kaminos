import assert from 'node:assert/strict';

import {
  SMOKE_SPLAT_DIRECT_DRAW_AUTHORITY,
  SMOKE_SPLAT_GPU_PRODUCT_SCHEMA,
  SMOKE_SPLAT_INDIRECT_DRAW_AUTHORITY,
  SMOKE_SPLAT_PACKING_IDENTITY,
  destroySmokeSplatGpuProduct,
  validateSmokeSplatGpuProduct,
} from '../smoke-splat-gpu-product.mjs';
import { buildPhaseMatchedHybridSmokePlan } from '../smoke-splat-motion-source.mjs';

const device = { queue: {} };

function product({
  tick = 20,
  activeCount = 3,
  capacity = 8,
  draw = { authority: SMOKE_SPLAT_DIRECT_DRAW_AUTHORITY, mode: 'direct' },
} = {}) {
  const coarseCount = Math.min(2, activeCount);
  return {
    identity: `synthetic-smoke:${tick}`,
    schema: SMOKE_SPLAT_GPU_PRODUCT_SCHEMA,
    producerAuthority: 'synthetic-smoke-producer-v0',
    compilerIdentity: 'synthetic-packed-smoke-compiler-v0',
    ownership: 'renderer-owned-destroy-on-evict-v0',
    device,
    phaseToken: { generation: 4, retainedHistoryEpoch: 2, writeTick: tick },
    slotIdentity: {
      simulatorGeneration: 4,
      historySlot: tick % 2,
      slotWriteTick: tick,
      modelIdentity: 'synthetic-smoke-producer-v0',
    },
    representation: {
      requestedIdentity: 'synthetic-sparse-smoke-v0',
      effectiveIdentity: 'synthetic-sparse-smoke-v0',
      fallbackReason: null,
      packingIdentity: SMOKE_SPLAT_PACKING_IDENTITY,
      activeRecordsPackedFirst: true,
      outputWasTruncated: false,
    },
    packedBuffer: { label: `synthetic-buffer:${tick}`, destroyCount: 0, destroy() { this.destroyCount += 1; } },
    packedByteLength: capacity * 16 * Float32Array.BYTES_PER_ELEMENT,
    capacity,
    activeCount,
    hierarchyCounts: { coarse: coarseCount, fine: activeCount - coarseCount, total: activeCount },
    draw,
  };
}

const sparse = validateSmokeSplatGpuProduct(product(), { device });
assert.equal(sparse.capacity, 8);
assert.equal(sparse.activeCount, 3);
assert.equal(sparse.draw.mode, 'direct');
assert.equal(sparse.representation.activeRecordsPackedFirst, true);

assert.throws(
  () => validateSmokeSplatGpuProduct(product({ activeCount: 9 }), { device }),
  /activeCount.*capacity/i,
  'active records cannot address beyond product capacity',
);
assert.throws(
  () => validateSmokeSplatGpuProduct({
    ...product(),
    representation: { ...product().representation, effectiveIdentity: 'silent-fallback-v0' },
  }, { device }),
  /requested.*effective/i,
  'a fallback representation cannot present as the requested product',
);
assert.throws(
  () => validateSmokeSplatGpuProduct({
    ...product(),
    representation: { ...product().representation, activeRecordsPackedFirst: false },
  }, { device }),
  /packed first/i,
  'activeCount is authoritative only when active records form a packed prefix',
);
assert.throws(
  () => validateSmokeSplatGpuProduct(product({
    draw: { authority: SMOKE_SPLAT_INDIRECT_DRAW_AUTHORITY, mode: 'indirect' },
  }), { device }),
  /indirectBuffer/i,
  'an indirect claim requires actual GPU draw arguments',
);
assert.throws(
  () => validateSmokeSplatGpuProduct(product({
    draw: {
      authority: SMOKE_SPLAT_INDIRECT_DRAW_AUTHORITY,
      mode: 'indirect',
      indirectBuffer: { label: 'non-destroyable-product-owned-indirect-buffer' },
      indirectOffset: 0,
      ownership: 'product-owned-destroy-on-evict-v0',
    },
  }), { device }),
  /indirectBuffer.*destroy/i,
  'product-owned indirect arguments must satisfy their destroy-on-evict claim',
);

const indirectBuffer = { destroyCount: 0, destroy() { this.destroyCount += 1; } };
const indirect = validateSmokeSplatGpuProduct(product({
  draw: {
    authority: SMOKE_SPLAT_INDIRECT_DRAW_AUTHORITY,
    mode: 'indirect',
    indirectBuffer,
    indirectOffset: 16,
    ownership: 'product-owned-destroy-on-evict-v0',
  },
}), { device });
assert.equal(indirect.draw.indirectBuffer, indirectBuffer);

const disposable = product({
  draw: {
    authority: SMOKE_SPLAT_INDIRECT_DRAW_AUTHORITY,
    mode: 'indirect',
    indirectBuffer,
    indirectOffset: 16,
    ownership: 'product-owned-destroy-on-evict-v0',
  },
});
destroySmokeSplatGpuProduct(disposable);
assert.equal(disposable.packedBuffer.destroyCount, 1);
assert.equal(indirectBuffer.destroyCount, 1);
destroySmokeSplatGpuProduct(disposable);
assert.equal(disposable.packedBuffer.destroyCount, 1, 'product destruction is idempotent');
assert.equal(indirectBuffer.destroyCount, 1, 'indirect argument destruction is idempotent');

const products = [product({ tick: 20 }), product({ tick: 21, activeCount: 5, capacity: 12 })];
const plan = buildPhaseMatchedHybridSmokePlan({
  products,
  flameInstances: [
    { index: 0, phaseHistoryOffsetSlots: 0, transform: { translate: [0, 0, 0], scale: 1 } },
    { index: 1, phaseHistoryOffsetSlots: 1, transform: { translate: [2, 0, 0], scale: 1 } },
  ],
  requestedRoute: 'spatial-strata-hybrid-smoke-live-coupled-v0',
  effectiveRoute: 'spatial-strata-hybrid-smoke-live-coupled-v0',
});
assert.deepEqual(plan.productUploads.map(upload => upload.selectedCount), [3, 5]);
assert.deepEqual(plan.productUploads.map(upload => upload.sourceCount), [8, 12]);
assert.equal(plan.maxSelectedProductCount, 5);
assert.equal(plan.drawInstanceCount, 10, 'direct draw uses active records, not allocation capacity');
assert.equal(plan.drawAuthority, SMOKE_SPLAT_DIRECT_DRAW_AUTHORITY);

const emptyPlan = buildPhaseMatchedHybridSmokePlan({
  products: [product({ tick: 30, activeCount: 0 }), product({ tick: 31, activeCount: 0 })],
  flameInstances: [
    { index: 0, phaseHistoryOffsetSlots: 0, transform: { translate: [0, 0, 0], scale: 1 } },
  ],
  requestedRoute: 'spatial-strata-hybrid-smoke-live-coupled-v0',
  effectiveRoute: 'spatial-strata-hybrid-smoke-live-coupled-v0',
});
assert.equal(emptyPlan.status, 'bound');
assert.equal(emptyPlan.maxSelectedProductCount, 0);
assert.equal(emptyPlan.drawInstanceCount, 0, 'lawful empty smoke submits a zero-instance direct draw');

console.log('smoke splat GPU product contracts passed');
