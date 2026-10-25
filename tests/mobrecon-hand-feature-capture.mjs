// kaminos-test: node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

globalThis.GPUBufferUsage = { MAP_READ: 1, COPY_DST: 2 };
globalThis.GPUMapMode = { READ: 1 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 };
let current;
globalThis.__featureCapture = {
  MOBRECON_ROUTE_ID: 'mesh', HAND_DETECTOR_ROUTE_ID: 'detector',
  loadMobRecon: async () => current.model,
  loadHandDetector: async () => ({ identity: {}, detect: async () => [], release() {} }),
  createMobReconCrop: () => ({ encode() {}, dispose() {} }), squareCrop: box => box,
};
const source = (await readFile(new URL('../models/mobrecon/hand-mesh-route.js', import.meta.url), 'utf8'))
  .replace(/import \{([^}]+)\} from '[^']+';/g, (_, names) => `const {${names}} = globalThis.__featureCapture;`);
const { createBrowserHandMeshRoute } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

async function fixture({ nonfinite = false, fail = false, hold = null } = {}) {
  const feature = { buffer: Float32Array.from([99, 98, 1, 2, 3, nonfinite ? NaN : 4]), offset: 2, shape: [2, 2] };
  const log = { reads: [], staging: [], encodes: 0, uploads: 0 };
  const device = {
    createBuffer({ size }) {
      const buffer = { bytes: new ArrayBuffer(size), destroyed: false, mapped: false,
        async mapAsync() { if (this.feature) { if (hold) await hold; if (fail) throw Error('map failed'); } this.mapped = true; },
        getMappedRange() { return this.bytes; }, unmap() { this.mapped = false; }, destroy() { this.destroyed = true; } };
      log.staging.push(buffer); return buffer;
    },
    createCommandEncoder() { return { copyBufferToBuffer(buffer, offset, dest, _, bytes) {
      log.reads.push({ buffer, offset, bytes }); dest.feature = buffer === feature.buffer;
      new Uint8Array(dest.bytes).set(new Uint8Array(buffer.buffer, offset, bytes));
    }, finish() { return {}; } }; },
    createTexture() { return { destroy() {} }; },
    queue: { submit() {}, copyExternalImageToTexture() { log.uploads++; } },
  };
  const mesh = Float32Array.from({ length: 778 * 3 }, (_, i) => i / 100);
  const uv = new Float32Array(42).fill(0.25);
  current = { model: { identity: { model: 'fixture' }, faces: [0, 1, 2], release() {}, network: {
    input: {}, outputs: { mesh: { buffer: mesh, offset: 0 }, uv: { buffer: uv, offset: 0 } },
    view: name => name === 'decoder3d.sampled' ? feature : undefined,
    encode() { log.encodes++; },
  } } };
  const route = await createBrowserHandMeshRoute({ session: { registerRoute: async () => ({ runtime: { device } }), unregisterRoute() {} } });
  const args = { source: {}, width: 10, height: 10, handedness: 'left', acquisition: { mode: 'manual', manualBox: [0, 0, 10, 10] } };
  return { route, args, log, feature, mesh };
}

test('ordinary contract and geometry remain unchanged; capture reads exact named view', async () => {
  const { route, args, log, feature, mesh } = await fixture();
  try {
    const ordinary = await route.infer(args);
    assert.equal('captures' in ordinary, false);
    assert.equal(log.reads.length, 2);
    assert.deepEqual(ordinary.nativeVertices, mesh);
    const captured = await route.infer({ ...args, capture: ['decoder3d.sampled'] });
    assert.deepEqual(captured.captures['decoder3d.sampled'], { shape: [2, 2], data: Float32Array.of(1, 2, 3, 4) });
    assert.notEqual(captured.captures['decoder3d.sampled'].shape, feature.shape);
    assert.deepEqual(log.reads[4], { buffer: feature.buffer, offset: 8, bytes: 16 });
    assert.equal(log.encodes, 2);
    assert.equal(captured.identity, ordinary.identity);
    assert.deepEqual(captured.verticesMeters, ordinary.verticesMeters);
    assert.deepEqual(captured.cropUV, ordinary.cropUV);
    assert.ok(log.staging.every(b => b.destroyed && !b.mapped));
  } finally { route.release(); }
});

test('capture validates before inference, including unknown names and duplicates', async () => {
  const { route, args, log } = await fixture();
  try {
    for (const capture of ['decoder3d.sampled', null, [1], ['decoder3d.sampled', 'decoder3d.sampled'], ['missing']]) {
      await assert.rejects(route.infer({ ...args, capture }), /capture|tensor named/);
    }
    assert.equal(log.encodes, 0); assert.equal(log.uploads, 0); assert.equal(log.reads.length, 0);
  } finally { route.release(); }
});

test('no-hand requested capture is empty without reads', async () => {
  const { route, args, log } = await fixture();
  try {
    const result = await route.infer({ ...args, capture: ['decoder3d.sampled'], acquisition: { mode: 'detector', onMiss: 'skip' } });
    assert.equal(result.hasHand, false); assert.deepEqual(result.captures, {}); assert.equal(log.reads.length, 0);
  } finally { route.release(); }
});

test('nonfinite feature rejects and failed maps destroy staging; both release busy guard', async () => {
  for (const options of [{ nonfinite: true }, { fail: true }]) {
    const { route, args, log } = await fixture(options);
    try {
      await assert.rejects(route.infer({ ...args, capture: ['decoder3d.sampled'] }), options.fail ? /map failed/ : /non-finite.*decoder3d.sampled/);
      assert.ok(log.staging.every(b => b.destroyed && !b.mapped));
      await route.infer(args);
    } finally { route.release(); }
  }
});

test('busy guard spans feature readback', async () => {
  let resolve;
  const hold = new Promise(r => { resolve = r; });
  const { route, args, log } = await fixture({ hold });
  const pending = route.infer({ ...args, capture: ['decoder3d.sampled'] });
  try {
    await new Promise(r => setImmediate(r));
    assert.equal(log.reads.length, 3);
    await assert.rejects(route.infer(args), /in flight/);
  } finally { resolve(); await pending; route.release(); }
});
