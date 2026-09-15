import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

assert.equal(
  typeof kit.createWebGpuScratchArena,
  'function',
  'the public runtime must expose a scratch arena constructor',
);

const {
  WEBGPU_SCRATCH_ARENA_SCHEMA,
  WEBGPU_SCRATCH_ARENA_USE_SCHEMA,
  createWebGpuScratchArena,
} = kit;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeAllocator({ failAt = null } = {}) {
  const allocations = [];
  return {
    allocations,
    allocateSlot(slot) {
      if (slot.slotId === failAt) throw new Error(`allocation failed for ${slot.slotId}`);
      const resource = {
        slotId: slot.slotId,
        destroyed: 0,
        destroy() {
          this.destroyed += 1;
        },
      };
      allocations.push({ slot, resource });
      return {
        resource,
        allocatedBytes: slot.declaredBytes,
      };
    },
  };
}

const slots = [
  { slotId: 'decoder.input', declaredBytes: 64, metadata: { role: 'input' } },
  { slotId: 'decoder.hidden', declaredBytes: 256, metadata: { role: 'hidden' } },
  { slotId: 'decoder.output', declaredBytes: 96, metadata: { role: 'output' } },
];

assert.throws(
  () => createWebGpuScratchArena({
    arenaId: 'capped',
    slots,
    maxSlots: 2,
    allocateSlot() {},
  }),
  /uncapped/,
);
assert.throws(
  () => createWebGpuScratchArena({
    arenaId: 'duplicate',
    slots: [slots[0], slots[0]],
    allocateSlot() {},
  }),
  /duplicate scratch slot/,
);
{
  const sparseMetadata = new Array(1);
  assert.throws(
    () => createWebGpuScratchArena({
      arenaId: 'sparse-metadata',
      slots: [{ ...slots[0], metadata: sparseMetadata }],
      allocateSlot() {
        return { resource: { destroy() {} } };
      },
    }),
    /metadata must be JSON-compatible; invalid array element/,
  );
}
{
  const namedMetadata = [];
  namedMetadata.role = 'scratch';
  assert.throws(
    () => createWebGpuScratchArena({
      arenaId: 'named-array-metadata',
      slots: [{ ...slots[0], metadata: namedMetadata }],
      allocateSlot() {
        return { resource: { destroy() {} } };
      },
    }),
    /metadata must be JSON-compatible; named array property/,
  );
}

{
  const allocator = makeAllocator({ failAt: 'decoder.hidden' });
  assert.throws(
    () => createWebGpuScratchArena({
      arenaId: 'allocation-rollback',
      slots,
      allocateSlot: allocator.allocateSlot,
    }),
    error => {
      assert.match(error.message, /allocation failed/);
      assert.equal(error.scratchArenaReport.status, 'allocation-failed');
      assert.equal(error.scratchArenaReport.failedSlotId, 'decoder.hidden');
      assert.deepEqual(error.scratchArenaReport.allocatedSlotIds, ['decoder.input']);
      assert.deepEqual(error.scratchArenaReport.disposedSlotIds, ['decoder.input']);
      return true;
    },
  );
  assert.equal(allocator.allocations[0].resource.destroyed, 1);
}

{
  const resource = {
    destroyed: 0,
    destroy() {
      this.destroyed += 1;
    },
  };
  assert.throws(
    () => createWebGpuScratchArena({
      arenaId: 'invalid-allocation-accounting',
      slots: [slots[0]],
      allocateSlot() {
        return {
          resource,
          allocatedBytes: Number.POSITIVE_INFINITY,
        };
      },
    }),
    error => {
      assert.match(error.message, /allocatedBytes must be a non-negative safe integer/);
      assert.deepEqual(error.scratchArenaReport.allocatedSlotIds, ['decoder.input']);
      assert.deepEqual(error.scratchArenaReport.disposedSlotIds, ['decoder.input']);
      return true;
    },
  );
  assert.equal(resource.destroyed, 1, 'a malformed allocation result remains arena-owned');
}

{
  const resources = [];
  assert.throws(
    () => createWebGpuScratchArena({
      arenaId: 'allocation-accounting-overflow',
      slots: [
        { slotId: 'large', declaredBytes: 0 },
        { slotId: 'overflow', declaredBytes: 0 },
      ],
      allocateSlot(slot) {
        const resource = {
          destroyed: 0,
          destroy() {
            this.destroyed += 1;
          },
        };
        resources.push(resource);
        return {
          resource,
          allocatedBytes: slot.slotId === 'large' ? Number.MAX_SAFE_INTEGER : 1,
        };
      },
    }),
    error => {
      assert.match(error.message, /allocated bytes exceed the safe integer range/);
      assert.deepEqual(error.scratchArenaReport.allocatedSlotIds, ['large', 'overflow']);
      assert.deepEqual(error.scratchArenaReport.disposedSlotIds, ['overflow', 'large']);
      return true;
    },
  );
  assert.deepEqual(
    resources.map(resource => resource.destroyed),
    [1, 1],
    'aggregate-accounting failure retires the complete owned graph',
  );
}

const allocator = makeAllocator();
const arena = createWebGpuScratchArena({
  arenaId: 'sf3d.decoder',
  slots,
  allocateSlot: allocator.allocateSlot,
});

assert.equal(arena.schema, WEBGPU_SCRATCH_ARENA_SCHEMA);
assert.equal(allocator.allocations.length, 3);
assert.deepEqual(allocator.allocations.map(entry => entry.slot.slotId), slots.map(slot => slot.slotId));

const initial = arena.snapshot();
assert.equal(initial.status, 'available');
assert.equal(initial.declaredBytes, 416);
assert.equal(initial.allocatedBytes, 416);
assert.equal(initial.activeBytes, 416);
assert.equal(initial.allocationCount, 3);
assert.equal(initial.useCount, 0);
assert.deepEqual(initial.slotIds, slots.map(slot => slot.slotId));
assert.ok(Object.isFrozen(initial));

const first = arena.beginUse({ useId: 'range-0' });
assert.equal(first.schema, WEBGPU_SCRATCH_ARENA_USE_SCHEMA);
assert.equal(first.resource('decoder.input'), allocator.allocations[0].resource);
assert.equal(first.resource('decoder.hidden'), allocator.allocations[1].resource);
assert.throws(() => first.resource('missing'), /unknown scratch slot/);
assert.throws(() => arena.beginUse({ useId: 'range-overlap' }), /already active/);

const firstCompletion = deferred();
const firstSettlement = first.markSubmitted({
  completion: firstCompletion.promise,
  authority: {
    kind: 'queue-prefix',
    submissionId: 'submit-0',
    clockId: 'gpu-queue-0',
  },
});
assert.equal(arena.snapshot().status, 'submitted');
assert.throws(() => first.abandon(), /already submitted/);
assert.throws(() => arena.close(), /submitted use is pending/);
assert.equal(allocator.allocations.some(entry => entry.resource.destroyed !== 0), false);

firstCompletion.resolve({ queueWaitMs: 3.5 });
const settledFirst = await firstSettlement;
assert.equal(settledFirst.status, 'completed');
assert.equal(settledFirst.useId, 'range-0');
assert.equal(settledFirst.authority.kind, 'queue-prefix');
assert.equal(arena.snapshot().status, 'available');

const second = arena.beginUse({ useId: 'range-1' });
assert.equal(second.resource('decoder.input'), allocator.allocations[0].resource);
assert.equal(second.resource('decoder.hidden'), allocator.allocations[1].resource);
assert.equal(allocator.allocations.length, 3, 'reuse must not allocate another slot graph');
const abandoned = second.abandon({ reason: 'encode-canceled' });
assert.equal(abandoned.status, 'abandoned');
assert.equal(arena.snapshot().status, 'available');

const controller = new AbortController();
controller.abort('route canceled');
assert.throws(
  () => arena.beginUse({ useId: 'canceled', signal: controller.signal }),
  error => error.name === 'AbortError' && /route canceled/.test(error.message),
);

const third = arena.beginUse({ useId: 'range-2' });
assert.throws(
  () => third.markSubmitted({
    completion: Promise.resolve(),
    authority: null,
  }),
  /completion authority/,
);
third.abandon();

const closing = arena.beginUse({ useId: 'unsubmitted-close' });
const close = arena.close({ reason: 'route-canceled-before-submit' });
assert.equal(close.status, 'closed');
assert.equal(arena.snapshot().activeBytes, 0);
for (const { resource } of allocator.allocations) assert.equal(resource.destroyed, 1);
assert.throws(() => closing.resource('decoder.input'), /no longer active/);
assert.throws(() => arena.beginUse({ useId: 'after-close' }), /closed/);
assert.equal(arena.close().status, 'already-closed');

{
  const lossAllocator = makeAllocator();
  const lossArena = createWebGpuScratchArena({
    arenaId: 'device-loss',
    slots,
    allocateSlot: lossAllocator.allocateSlot,
  });
  const use = lossArena.beginUse({ useId: 'range-loss' });
  const completion = deferred();
  const settlement = use.markSubmitted({
    completion: completion.promise,
    authority: {
      kind: 'queue-prefix',
      submissionId: 'submit-loss',
      clockId: 'gpu-queue-loss',
    },
  });
  completion.reject(new Error('device lost'));
  await assert.rejects(settlement, error => {
    assert.match(error.message, /device lost/);
    assert.equal(error.scratchArenaReport.status, 'invalidated');
    assert.equal(error.scratchArenaReport.failedUseId, 'range-loss');
    return true;
  });
  assert.equal(lossArena.snapshot().status, 'invalidated');
  assert.equal(lossArena.snapshot().activeBytes, 0);
  for (const { resource } of lossAllocator.allocations) assert.equal(resource.destroyed, 1);
  assert.throws(() => lossArena.beginUse({ useId: 'after-loss' }), /invalidated/);
  assert.equal(lossArena.close().status, 'already-invalidated');
}

{
  const leasedAllocator = makeAllocator();
  let leasedArena;
  const plan = kit.defineWebGpuPhaseResourcePlan({
    planId: 'sf3d.texture-bake-resources',
    resources: [{
      resourceId: 'decoder-scratch-arena',
      declaredBytes: 416,
      metadata: { kind: 'scratch-arena' },
    }],
    phases: [{
      phaseId: 'texture-bake',
      requiredResourceIds: ['decoder-scratch-arena'],
    }],
  });
  const workingSet = kit.createWebGpuPhaseResourceWorkingSet({
    controllerId: 'sf3d.texture-bake-working-set',
    plan,
    async acquireResource({ resource }) {
      leasedArena = createWebGpuScratchArena({
        arenaId: resource.resourceId,
        slots,
        allocateSlot: leasedAllocator.allocateSlot,
      });
      return {
        resourceId: resource.resourceId,
        leaseId: `${resource.resourceId}:1`,
        release() {
          const arenaReport = leasedArena.close({ reason: 'phase-resource-release' });
          return {
            status: 'released',
            resourceId: resource.resourceId,
            arenaReport,
          };
        },
      };
    },
  });

  const transition = await workingSet.transitionToPhase('texture-bake');
  assert.deepEqual(transition.heldResourceIds, ['decoder-scratch-arena']);
  assert.equal(leasedArena.snapshot().status, 'available');
  assert.equal(leasedArena.beginUse({ useId: 'lease-range' }).abandon().status, 'abandoned');

  const closedWorkingSet = workingSet.close();
  assert.equal(closedWorkingSet.status, 'closed');
  assert.deepEqual(closedWorkingSet.releasedResourceIds, ['decoder-scratch-arena']);
  assert.equal(leasedArena.snapshot().status, 'closed');
  for (const { resource } of leasedAllocator.allocations) assert.equal(resource.destroyed, 1);
}

console.log('scratch arena contracts passed');
