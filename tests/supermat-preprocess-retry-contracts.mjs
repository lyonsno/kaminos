// kaminos-test: node
// The real producer must retire its busy flag even when its actual CPU worker fails before GPU work.
import assert from 'node:assert/strict';
import { createSuperMatAdapter } from '../models/supermat/supermat-route.js';
const previous = { fetch: globalThis.fetch, Worker: globalThis.Worker };
let attempts = 0;
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ schema: 'supermat.browser-weight-package.v0',
    status: 'succeeded', constants: { vScale: 1 }, resources: [] }));
  globalThis.Worker = class { constructor() { attempts++; throw Error('worker failed before GPU'); } };
  const adapter = await createSuperMatAdapter({ route: { runtime: { device: { features: new Set() } }, loadModelResourcesFromSource() {} },
    weightsUrl: 'https://example.invalid/weights/' });
  try {
    const request = { image: { width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) }, size: 64 };
    await assert.rejects(adapter.run(request), /worker failed before GPU/);
    await assert.rejects(adapter.run(request), /worker failed before GPU/);
    assert.equal(attempts, 2, 'retry must re-enter the actual worker path');
  } finally { adapter.release(); }
} finally {
  globalThis.fetch = previous.fetch;
  if (previous.Worker === undefined) delete globalThis.Worker; else globalThis.Worker = previous.Worker;
}
console.log('SuperMat actual preprocessing failure permits retry');
