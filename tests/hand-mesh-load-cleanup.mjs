// kaminos-test: node
// Execute the production MobRecon loader with deterministic allocation/readback failures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
globalThis.GPUBufferUsage = { MAP_READ: 1, COPY_DST: 2 };
globalThis.GPUMapMode = { READ: 1 };
const counts = { created: 0, disposed: 0, staging: 0, destroyed: 0, unmapped: 0, released: 0 };
let mode;
const metadata = { schema: 'mobrecon.browser-weight-package.v0', status: 'succeeded', resources: [{ manifest: { modelId: 'fixture', bundle: { sha256: 'fixture' } } }] };
const device = {
  queue: { submit() {} },
  createCommandEncoder() { return { copyBufferToBuffer() { if (mode === 'copy') throw Error('copy failed'); }, finish() { return {}; } }; },
  createBuffer() {
    counts.staging++;
    return { async mapAsync() { if (mode === 'map') throw Error('map failed'); },
      getMappedRange() {
        if (mode === 'range') throw Error('range failed');
        return Uint32Array.from({ length: 1538 * 3 }, (_, i) => mode === 'invalid' ? 0 : i % 778).buffer;
      }, unmap() { counts.unmapped++; }, destroy() { counts.destroyed++; } };
  },
};
globalThis.__handLoadFixture = {
  defineWebGpuModelResourceManifest: value => value,
  createMobReconNetwork() { counts.created++; return { dispatchCount: 1, dispose() { counts.disposed++; } }; },
  MOBRECON_LANDMARKS: 21, MOBRECON_VERTICES: 778,
  async readModelPackage() { return { metadata, source: {}, row: metadata.resources[0] }; },
};
let body = await fs.readFile(new URL('../models/mobrecon/mobrecon-route.js', import.meta.url), 'utf8');
body = body.replace(/^import \{([^}]+)\} from .*;$/gm, (_, names) => `const {${names}} = globalThis.__handLoadFixture;`);
const { loadMobRecon } = await import(`data:text/javascript;base64,${Buffer.from(body).toString('base64')}`);
const route = { runtime: { device }, async loadModelResourcesFromSource() { return { tensors: { 'topology.faces': { byteLength: 1538 * 12, buffer: {}, bufferOffset: 0 } }, release() { counts.released++; } }; } };
const failures = [];
for (mode of ['invalid', 'map', 'range', 'copy']) {
  await assert.rejects(loadMobRecon({ route }), mode === 'invalid' ? /all 778 vertices/ : new RegExp(`${mode} failed`));
  if (counts.created !== counts.disposed) failures.push(`${mode}: constructed network survives failed load`);
  if (counts.staging !== counts.destroyed) failures.push(`${mode}: staging survives failed readback`);
  assert.equal(counts.released, counts.created, 'failed model weight leases retire');
}
assert.deepEqual(failures, [], 'every post-construction failure must retire its network and staging');
assert.equal(counts.unmapped, 2, 'only successful mappings are unmapped, including a range-copy failure');
mode = 'valid';
const loaded = await loadMobRecon({ route });
assert.equal(loaded.faces.length, 1538 * 3);
assert.equal(new Set(loaded.faces).size, 778);
assert.equal(counts.created, counts.disposed + 1, 'successful retry stays resident');
loaded.release(); loaded.release();
assert.equal(counts.created, counts.disposed);
assert.equal(counts.released, counts.created);
assert.equal(counts.staging, counts.destroyed);
delete globalThis.__handLoadFixture;
console.log('Production MobRecon loader retires failed networks/readbacks and supports retry');
