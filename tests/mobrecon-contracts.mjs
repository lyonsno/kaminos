// kaminos-test: node
// MobRecon port contracts that need no GPU: the parity gates and admission
// checks the browser witness relies on, and the network graph built against a
// recording fake device from the packed tensor shapes (no weight values).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { admitAdapter, admitOutputs, compareTensor, gateCase, PARITY_GATES } from '../models/mobrecon/parity-checks.js';
import { createMobReconNetwork } from '../models/mobrecon/mobrecon-network.js';

// ---- Parity checks ----
const a = Float32Array.from([0, 1, -2, 3]), b = Float32Array.from([0, 1.5, -2, 3]);
const row = compareTensor('t', a, b);
assert.equal(row.maxAbs, 0.5);
assert.equal(row.worstIndex, 1);
assert.equal(row.refMaxAbs, 3);
assert.equal(compareTensor('t', a, a).maxAbs, 0);
assert.throws(() => compareTensor('t', a, new Float32Array(3)), /4 values vs reference 3/);
assert.equal(compareTensor('t', Float32Array.from([NaN, 1, -2, 3]), a).nonFinite, 1);

const mesh = Float32Array.from({ length: 778 * 3 }, (_, i) => Math.sin(i));
const uv = Float32Array.from({ length: 42 }, (_, i) => (i % 7) / 7);
admitOutputs({ mesh, uv });
assert.throws(() => admitOutputs({ mesh: new Float32Array(778 * 3), uv }), /mesh output is degenerate/);
assert.throws(() => admitOutputs({ mesh, uv: new Float32Array(42).fill(0.5) }), /uv output is degenerate/);
assert.throws(() => admitOutputs({ mesh: mesh.slice(3), uv }), /778x3/);
const holed = mesh.slice(); holed[5] = Infinity;
assert.throws(() => admitOutputs({ mesh: holed, uv }), /non-finite/);

const pass = [{ name: 'mesh_pred', maxAbs: 1e-6, nonFinite: 0 }, { name: 'uv_pred', maxAbs: 1e-6, nonFinite: 0 }];
assert.deepEqual(gateCase('c', pass), []);
assert.match(gateCase('c', pass.slice(0, 1))[0], /uv_pred was not compared/);
assert.match(gateCase('c', [{ ...pass[0], maxAbs: PARITY_GATES.mesh_pred * 2 }, pass[1]])[0], /mesh_pred max abs .* exceeds/);
assert.match(gateCase('c', [{ ...pass[0], maxAbs: NaN }, pass[1]])[0], /exceeds/);
assert.match(gateCase('c', [{ ...pass[0], nonFinite: 3 }, pass[1]])[0], /3 non-finite/);

assert.throws(() => admitAdapter(null), /no WebGPU adapter/);
assert.throws(() => admitAdapter({ vendor: 'google', architecture: 'swiftshader', isFallbackAdapter: true }), /fallback WebGPU adapter/);
assert.equal(admitAdapter({ vendor: 'apple', architecture: 'metal-3' }).isFallbackAdapter, false);

// ---- Graph against a recording fake device ----
const shapes = JSON.parse(fs.readFileSync(new URL('../models/mobrecon/fixtures/tensor-shapes.json', import.meta.url), 'utf8'));
function fakeDevice() {
  const log = { buffers: 0, destroyed: 0, pipelines: new Set(), bindGroups: 0 };
  const device = {
    log,
    createBuffer: ({ size }) => { log.buffers++; return { size, destroy: () => { log.destroyed++; } }; },
    createShaderModule: ({ code }) => ({ code }),
    createComputePipeline: ({ label }) => { log.pipelines.add(label); return { getBindGroupLayout: () => ({}) }; },
    createBindGroup: ({ entries }) => {
      log.bindGroups++;
      for (const { resource } of entries) assert.ok(resource?.buffer, 'every binding names a buffer');
      return {};
    },
    queue: { writeBuffer() {} },
  };
  return device;
}
function tensorsFrom(rows, accessed) {
  const allocation = { size: 1 << 30 };
  const table = Object.fromEntries(rows.map((t, i) => [t.name, { name: t.name, dtype: t.dtype, shape: t.shape,
    buffer: allocation, bufferOffset: i * 256, byteLength: t.shape.reduce((x, y) => x * y, 1) * 4 }]));
  return new Proxy(table, { get: (target, key) => { accessed.add(key); return target[key]; } });
}

const accessed = new Set(), device = fakeDevice();
const network = createMobReconNetwork({ device, tensors: tensorsFrom(shapes.tensors, accessed) });
assert.equal(network.dispatchCount, 136);
assert.equal(device.log.bindGroups, 136);
assert.deepEqual(network.input.shape, [3, 128, 128]);
assert.deepEqual(network.outputs.mesh.shape, [778, 3]);
assert.deepEqual(network.outputs.uv.shape, [21, 2]);
// Every packed tensor is consumed by the graph: a skipped layer or a stale
// package with extra tensors shows up here, not as a quiet parity drift.
const unused = shapes.tensors.map(t => t.name).filter(name => !accessed.has(name));
assert.deepEqual(unused, []);
const extraAccessed = new Set();
createMobReconNetwork({ device: fakeDevice(), tensors: tensorsFrom([...shapes.tensors, { name: 'backbone.dense_stack1.dense4.conv1.conv1x1.weight', dtype: 'f32', shape: [768, 1024, 1, 1] }], extraAccessed) }).dispose();
assert.ok(!extraAccessed.has('backbone.dense_stack1.dense4.conv1.conv1x1.weight'), 'the unused-tensor check can see an unconsumed tensor');
for (const key of ['backbone.dense_stack1.dense1', 'backbone.dense_stack2#1', 'decoder3d.lifted', 'decoder3d.de_layer.3', 'mesh_pred', 'uv_pred']) {
  assert.ok(network.view(key), `named tensor ${key}`);
}
assert.deepEqual(network.view('backbone.dense_stack2#1').shape, [1024, 4, 4]);
assert.deepEqual(network.view('decoder3d.lifted').shape, [49, 256]);
network.dispose();
assert.equal(device.log.destroyed, device.log.buffers);

// A missing or reshaped tensor fails at build time, naming it.
const withoutHead = shapes.tensors.filter(t => t.name !== 'decoder3d.head.weight');
assert.throws(() => createMobReconNetwork({ device: fakeDevice(), tensors: tensorsFrom(withoutHead, new Set()) }), /missing MobRecon tensor decoder3d\.head\.weight/);
const reshaped = shapes.tensors.map(t => t.name === 'backbone.thrink2.weight' ? { ...t, shape: [128, 151, 1, 1] } : t);
assert.throws(() => createMobReconNetwork({ device: fakeDevice(), tensors: tensorsFrom(reshaped, new Set()) }), /backbone\.thrink2: input has 152 channels, weight expects 151/);

console.log('mobrecon contracts: passed');

// ---- Crop coordinates: JS tables equal the float32 emulation that matched OpenCV byte for byte ----
{
  const { cropSampleTables, normalizeTable, cropInverseMatrix } = await import('../models/mobrecon/mobrecon-crop.js');
  const fixture = JSON.parse(fs.readFileSync(new URL('../models/mobrecon/fixtures/crop-tables.json', import.meta.url), 'utf8'));
  for (const c of fixture.cases) {
    const t = cropSampleTables(c.box);
    assert.deepEqual([...t.matrix], c.matrix, `matrix for ${c.box}`);
    assert.deepEqual([...t.columns], c.columns, `columns for ${c.box}`);
    assert.deepEqual([...t.rows], c.rows, `rows for ${c.box}`);
  }
  assert.deepEqual([...normalizeTable()], fixture.normalize);
  assert.throws(() => cropInverseMatrix([10, 10, 10, 20]), /invalid crop box/);
  assert.throws(() => cropInverseMatrix([0, 0, NaN, 1]), /invalid crop box/);
  console.log('mobrecon crop tables: passed');
}
