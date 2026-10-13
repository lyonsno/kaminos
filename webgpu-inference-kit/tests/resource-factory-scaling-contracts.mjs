import assert from 'node:assert/strict';

import { createWebGpuResourceFactory, createWebGpuResourceResidency } from '../src/index.js';

// Acquiring a resource must not serialize every resident resource: a model package of N resources loaded
// through the factory used to clone and freeze the whole residency snapshot once per resource (O(N^2)).
const residency = createWebGpuResourceResidency({ sessionId: 'factory-scaling' });
let fullSnapshots = 0;
const counted = { ...residency, snapshot() { fullSnapshots += 1; return residency.snapshot(); } };
const factory = createWebGpuResourceFactory({ sessionId: 'factory-scaling', residency: counted });
const created = [];
const request = id => ({
  resourceId: `resource-${id}`, routeId: 'route', declaredBytes: 16, kind: 'buffer', metadata: { id },
  create: () => { created.push(id); return { id, destroy() {} }; }, dispose: () => {},
});
const leases = [];
for (let id = 0; id < 200; id++) leases.push(await factory.acquireOrCreate(request(id)));
assert.equal(created.length, 200);
assert.equal(fullSnapshots, 0, 'acquiring absent resources reads residency without a full snapshot');

// A resident resource is still re-acquired from residency without running its creator again.
const again = await factory.acquireOrCreate(request(7));
assert.equal(created.length, 200, 'resident resource reused');
assert.equal(again.resourceId, 'resource-7');
assert.equal(fullSnapshots, 0, 'resident lookup reads one resource, not a full snapshot');

// Warm re-acquisition of every resident resource (each invocation does this) also avoids full snapshots.
for (let id = 0; id < 200; id++) await factory.acquireExisting(request(id));
assert.equal(fullSnapshots, 0, 'acquireExisting reads one resource, not a full snapshot');

// Residency implementations without the direct lookup keep working through their snapshot.
{
  const plain = createWebGpuResourceResidency({ sessionId: 'factory-scaling-plain' });
  const legacy = { acquire: plain.acquire, snapshot: plain.snapshot };
  const legacyFactory = createWebGpuResourceFactory({ sessionId: 'factory-scaling-plain', residency: legacy });
  const made = [];
  const legacyRequest = { ...request(1), create: () => { made.push(1); return { destroy() {} }; } };
  await legacyFactory.acquireOrCreate(legacyRequest);
  await legacyFactory.acquireOrCreate(legacyRequest);
  assert.equal(made.length, 1, 'snapshot fallback still finds the resident resource');
}

console.log('resource factory scaling contracts passed');
