import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = new URL('../smoke-splat-slot-cache.mjs', import.meta.url);
const source = await readFile(moduleUrl, 'utf8').catch(() => '');

assert.match(
  source,
  /export function createSmokeSplatSlotCache/,
  'phase-matched smoke decoding must be an explicit reusable slot-cache contract',
);

const {
  SMOKE_SPLAT_PRODUCER_AUTHORITY,
  createSmokeSplatSlotCache,
  decodeReferenceSmokeHierarchy,
  makeSmokeSplatPhaseInstances,
} = await import(moduleUrl);

function makePayload(slot, slotWriteTick) {
  return {
    identity: `smoke-payload:${slot}:${slotWriteTick}`,
    cells: [
      { position: [slot, 0, 0], density: 0.1, temperature: 0.2, velocity: [0, 1, 0] },
      { position: [slot, 1, 0], density: 0.4, temperature: 0.7, velocity: [0.1, 1.2, 0] },
      { position: [slot, 2, 0], density: 0.005, temperature: 0.1, velocity: [0, 0.5, 0] },
    ],
  };
}

function makeInstances(count, slots, historyWriteTick = 20) {
  return Array.from({ length: count }, (_, index) => {
    const phaseHistorySlot = slots[index % slots.length];
    const phaseHistoryOffsetSlots = slots.length - 1 - slots.indexOf(phaseHistorySlot);
    return {
      identity: 'boundary-splat-instance-descriptor-v1',
      index,
      phaseHistorySlot,
      phaseHistoryOffsetSlots,
      phaseHistoryOffsetFrames: phaseHistoryOffsetSlots * 2,
      transform: { translate: [index, 0, 0], scale: 1 },
      phaseSourceAuthority: phaseHistoryOffsetSlots > 0
        ? 'live-gpu-candidate-history-ring'
        : 'current-live-candidate-buffer',
      slotWriteTick: historyWriteTick - phaseHistoryOffsetSlots,
    };
  });
}

const livePhaseDescriptors = makeInstances(4, [5, 6, 7, 8]).map(({ slotWriteTick: _slotWriteTick, ...instance }) => instance);
const epochBoundDescriptors = makeSmokeSplatPhaseInstances({
  instances: livePhaseDescriptors,
  historyWriteTick: 20,
});
assert.deepEqual(
  epochBoundDescriptors.map(instance => instance.slotWriteTick),
  [17, 18, 19, 20],
  'live phase descriptors bind to their exact circular-ring write epochs',
);
assert.deepEqual(livePhaseDescriptors.map(instance => instance.slotWriteTick), [undefined, undefined, undefined, undefined]);
assert.throws(
  () => makeSmokeSplatPhaseInstances({
    historyWriteTick: 20,
    instances: [{
      index: 0,
      phaseHistorySlot: 0,
      phaseHistoryOffsetSlots: 4,
      historyDepth: 4,
    }],
  }),
  /outside retained smoke history.*depth 4/i,
  'an overwritten circular-ring epoch cannot masquerade as a retained phase source',
);

const decodeCalls = [];
const cache = createSmokeSplatSlotCache({
  decodeSlot(request) {
    decodeCalls.push(request.slotIdentity);
    return decodeReferenceSmokeHierarchy(request);
  },
});

const instances = makeInstances(100, [5, 6, 7, 8]);
const payloads = new Map([5, 6, 7, 8].map(slot => [slot, makePayload(slot, 20 - (8 - slot))]));
const request = {
  instances,
  payloadForSlot: slot => payloads.get(slot),
  simulatorGeneration: 3,
  modelIdentity: 'smoke-model:alpha',
  sparseDensityThreshold: 0.02,
};

const first = cache.resolve(request);
assert.equal(first.instanceCount, 100);
assert.equal(first.uniqueSlotCount, 4);
assert.equal(first.decodeCount, 4, 'first resolve decodes each unique phase slot exactly once');
assert.equal(first.cacheHitCount, 0);
assert.equal(first.instanceBindings.length, 100);
assert.equal(new Set(first.instanceBindings.map(binding => binding.productIdentity)).size, 4);
assert.equal(decodeCalls.length, 4, 'decode work scales with unique slots, not visible instances');
assert.equal(first.requestedProducerAuthority, SMOKE_SPLAT_PRODUCER_AUTHORITY);
assert.equal(first.effectiveProducerAuthority, SMOKE_SPLAT_PRODUCER_AUTHORITY);

const second = cache.resolve(request);
assert.equal(second.decodeCount, 0);
assert.equal(second.cacheHitCount, 4);
assert.equal(decodeCalls.length, 4, 'identical slot epochs reuse all decoded products');

const identityCacheCalls = [];
const identityCache = createSmokeSplatSlotCache({
  decodeSlot(slotRequest) {
    identityCacheCalls.push(slotRequest);
    return decodeReferenceSmokeHierarchy(slotRequest);
  },
});
identityCache.resolve(request);
const changedDecoderConfig = identityCache.resolve({ ...request, sparseDensityThreshold: 0.25 });
assert.equal(changedDecoderConfig.decodeCount, 4, 'decoder configuration changes cannot return stale slot products');
const correctedPayload = identityCache.resolve({
  ...request,
  sparseDensityThreshold: 0.25,
  payloadForSlot(slot) {
    const payload = structuredClone(payloads.get(slot));
    if (slot === 6) payload.identity = `${payload.identity}:corrected`;
    return payload;
  },
});
assert.equal(correctedPayload.decodeCount, 1, 'correcting one payload identity invalidates only its slot product');
assert.equal(correctedPayload.cacheHitCount, 3);

const reusedSlotInstances = makeInstances(100, [5, 6, 7, 8]);
for (const instance of reusedSlotInstances) {
  if (instance.phaseHistorySlot === 6) instance.slotWriteTick += 4;
}
const reusedSlotPayloads = new Map(payloads);
reusedSlotPayloads.set(6, makePayload(6, 20));
const slotReuse = cache.resolve({
  ...request,
  instances: reusedSlotInstances,
  payloadForSlot: slot => reusedSlotPayloads.get(slot),
});
assert.equal(slotReuse.decodeCount, 1, 'reusing a circular slot at a new write tick cannot return stale smoke');
assert.equal(slotReuse.cacheHitCount, 3);

const changedModel = cache.resolve({ ...request, modelIdentity: 'smoke-model:beta' });
assert.equal(changedModel.decodeCount, 4, 'model identity changes invalidate every affected product');
assert.equal(changedModel.invalidation.identityChanged, true);

const changedSimulation = cache.resolve({ ...request, simulatorGeneration: 4 });
assert.equal(changedSimulation.decodeCount, 4, 'simulation reset invalidates every phase product');
assert.equal(changedSimulation.invalidation.identityChanged, true);

const hierarchy = decodeReferenceSmokeHierarchy({
  slotIdentity: {
    historySlot: 2,
    slotWriteTick: 12,
    simulatorGeneration: 9,
    modelIdentity: 'smoke-model:mass-test',
  },
  payload: {
    identity: 'smoke-payload:mass-test',
    cells: [
      { position: [0, 0, 0], density: 0.5, temperature: 0.8, velocity: [0, 1, 0] },
      { position: [0.2, 0, 0], density: 0.01, temperature: 0.1, velocity: [0, 0.2, 0] },
      { position: [1.2, 0, 0], density: 0.3, temperature: 0.5, velocity: [0.1, 1, 0] },
      { position: [2.3, 0, 0], density: 0.02, temperature: 0.2, velocity: [0, 0.4, 0] },
    ],
  },
  sparseDensityThreshold: 0.05,
  coarseCellSize: 1,
  capacity: 2,
});

assert.equal(hierarchy.producerAuthority, SMOKE_SPLAT_PRODUCER_AUTHORITY);
assert.equal(hierarchy.coarseSplats.every(splat => splat.hierarchyRole === 'transport-coarse'), true);
assert.equal(hierarchy.fineSplats.every(splat => splat.hierarchyRole === 'articulation-fine'), true);
assert.ok(hierarchy.coarseSplats.length > 0);
assert.ok(hierarchy.fineSplats.length > 0);
assert.ok(Math.abs(hierarchy.accounting.sourceExtinctionMass - hierarchy.accounting.representedExtinctionMass) < 1e-12);
assert.equal(hierarchy.accounting.rejectedExtinctionMass, 0, 'sparse occupancy loss rolls sub-threshold mass into coarse transport splats');
assert.equal(hierarchy.splats.length, hierarchy.requiredSplatCount, 'capacity pressure must not silently truncate splats');
assert.equal(hierarchy.capacity.status, 'capacity-overflow-untruncated');
assert.equal(hierarchy.capacity.overflowCount, hierarchy.requiredSplatCount - 2);
assert.equal(hierarchy.diagnostics.some(item => item.code === 'smoke-splat-capacity-overflow'), true);

assert.throws(
  () => cache.resolve({ ...request, payloadForSlot: slot => (slot === 7 ? null : payloads.get(slot)) }),
  /missing smoke payload.*slot 7/i,
  'missing phase payload fails loud instead of using current or fallback smoke',
);

assert.throws(
  () => createSmokeSplatSlotCache({}),
  /decodeSlot/i,
  'the cache cannot silently install a fallback decoder',
);

console.log('smoke splat slot cache contracts passed');
