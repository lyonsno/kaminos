import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  WEBGPU_BUFFER_USAGE,
  defineWebGpuModelResourceManifest,
  defineWebGpuModelResourcePackage,
  loadWebGpuModelResourcePackageFromSources,
} from '../src/index.js';

// Bounded concurrent package acquisition: overlapping several resources' fetch/verify/upload under a
// declared-byte budget, without changing results, order, or failure cleanup. Sequential remains the default.
function manifestFor(resourceId, bytes) {
  return defineWebGpuModelResourceManifest({
    modelId: 'acme/concurrent', revision: 'r1',
    bundle: { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') },
    allocations: [{ allocationId: resourceId, byteOffset: 0, byteLength: bytes.byteLength, usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
      tensors: [{ name: `${resourceId}.weight`, dtype: 'u32', shape: [bytes.byteLength / 4], byteOffset: 0, byteLength: bytes.byteLength }] }],
  });
}
const sizes = [16, 16, 32, 16, 64, 16];
const ids = sizes.map((_, i) => `r${i}`);
const bytes = Object.fromEntries(ids.map((id, i) => [id, new Uint8Array(sizes[i]).fill(i + 1)]));
const modelPackage = defineWebGpuModelResourcePackage({
  packageId: 'acme/concurrent:pkg', modelId: 'acme/concurrent', revision: 'r1',
  resources: ids.map(id => ({ resourceId: id, manifest: manifestFor(id, bytes[id]) })),
});
const sources = Object.fromEntries(ids.map(id => [id, new Blob([bytes[id]])]));
const sizeOf = Object.fromEntries(ids.map((id, i) => [id, sizes[i]]));

function routeFixture({ failId = null, order = null } = {}) {
  const started = [], released = [], gates = new Map();
  let inFlight = 0, inFlightBytes = 0, maxInFlight = 0, maxBytes = 0;
  const route = {
    routeId: 'concurrency-route',
    async loadModelResourcesFromSource({ manifest }) {
      const id = manifest.allocations[0].allocationId;
      started.push(id);
      inFlight += 1; inFlightBytes += sizeOf[id];
      maxInFlight = Math.max(maxInFlight, inFlight); maxBytes = Math.max(maxBytes, inFlightBytes);
      let release; const gate = new Promise(resolve => { release = resolve; }); gates.set(id, release);
      await gate;
      inFlight -= 1; inFlightBytes -= sizeOf[id];
      if (id === failId) throw new Error(`load of ${id} failed`);
      return { allocations: [], tensors: { [`${id}.weight`]: { id } }, acquisitionReport: { id }, release() { released.push(id); return { id }; } };
    },
  };
  // Settle loads as they start, in the requested completion order where several are in flight.
  // After a failure, keep settling whatever is still in flight (the loader drains before cleanup) and stop once
  // nothing new starts.
  const pump = async () => {
    const done = new Set();
    let failed = false, idle = 0;
    while (done.size < ids.length && idle < 50) {
      await new Promise(resolve => setImmediate(resolve));
      const ready = [...gates.keys()].filter(id => !done.has(id));
      if (ready.length === 0) { idle += failed ? 1 : 0; continue; }
      idle = 0;
      const next = order ? order.find(id => ready.includes(id)) ?? ready[0] : ready[0];
      done.add(next); gates.get(next)();
      if (next === failId) failed = true;
    }
  };
  return { route, started, released, pump, stats: () => ({ maxInFlight, maxBytes }) };
}

// Default: strictly sequential, as before.
{
  const fixture = routeFixture();
  const loading = loadWebGpuModelResourcePackageFromSources({ package: modelPackage, route: fixture.route, sources });
  await fixture.pump();
  const lease = await loading;
  assert.equal(fixture.stats().maxInFlight, 1);
  assert.equal(lease.report.sourceMemoryBound.authority, 'sequential-resource-acquisition-declared-byte-length');
  assert.deepEqual(lease.resources.map(resource => resource.resourceId), ids);
}

// Opt-in: up to 3 in flight within a 48-byte declared budget; the 64-byte resource runs alone.
{
  const fixture = routeFixture({ order: ['r2', 'r1', 'r0', 'r4', 'r5', 'r3'] });
  const loading = loadWebGpuModelResourcePackageFromSources({ package: modelPackage, route: fixture.route, sources, acquisition: { concurrency: 3, byteBudget: 48 } });
  await fixture.pump();
  const lease = await loading;
  const { maxInFlight, maxBytes } = fixture.stats();
  assert.ok(maxInFlight > 1 && maxInFlight <= 3, `in flight ${maxInFlight}`);
  assert.ok(maxBytes <= 64, `declared bytes in flight ${maxBytes}`);
  assert.deepEqual(fixture.started.slice(0, 2), ['r0', 'r1'], 'acquisition starts in package order');
  assert.deepEqual(lease.resources.map(resource => resource.resourceId), ids, 'results stay in package order');
  assert.deepEqual(lease.report.resources.map(resource => resource.resourceId), ids);
  assert.deepEqual(Object.keys(lease.tensors).sort(), ids.map(id => `${id}.weight`).sort());
  assert.equal(lease.report.sourceMemoryBound.authority, 'bounded-concurrent-resource-acquisition-declared-byte-length');
  assert.equal(lease.report.sourceMemoryBound.concurrency, 3);
  assert.equal(lease.report.sourceMemoryBound.declaredByteBudget, 48);
  assert.equal(lease.release().releasedResourceCount ?? 6, 6);
}

// A failure releases every acquired lease, including loads that finish after the failure, and reports it.
{
  const fixture = routeFixture({ failId: 'r1', order: ['r1', 'r0', 'r2'] });
  const loading = loadWebGpuModelResourcePackageFromSources({ package: modelPackage, route: fixture.route, sources, acquisition: { concurrency: 3, byteBudget: 64 } });
  const pumping = fixture.pump();
  let failure;
  try { await loading; } catch (error) { failure = error; }
  await pumping;
  assert.ok(failure, 'package load rejects');
  assert.match(failure.message, /load of r1 failed/);
  assert.equal(failure.packageReport.status, 'failed');
  assert.equal(failure.packageReport.failedResourceId, 'r1');
  assert.equal(failure.packageReport.sourceMemoryBound.authority, 'bounded-concurrent-resource-acquisition-declared-byte-length');
  assert.deepEqual(fixture.started, ['r0', 'r1', 'r2'], 'no new resource starts after the failure');
  assert.deepEqual([...fixture.released].sort(), ['r0', 'r2'], 'loads that finished around the failure are released');
}

for (const acquisition of [{ concurrency: 0 }, { concurrency: 2.5 }, { concurrency: 2, byteBudget: 0 }]) {
  await assert.rejects(() => loadWebGpuModelResourcePackageFromSources({ package: modelPackage, route: routeFixture().route, sources, acquisition }), /acquisition/);
}

console.log('model resource package concurrency contracts passed');
