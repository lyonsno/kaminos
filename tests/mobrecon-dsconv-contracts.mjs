// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMobReconNetwork } from '../models/mobrecon/mobrecon-network.js';

const original = JSON.parse(fs.readFileSync(new URL('../models/mobrecon/fixtures/tensor-shapes.json', import.meta.url))).tensors;
const rows = original.flatMap(row => {
  if (!/^decoder3d\.(de_layer\.\d+\.conv|head)\.(weight|bias)$/.test(row.name)) return [row];
  if (row.name.endsWith('.bias')) return [];
  const prefix = row.name.slice(0, -7), [cout, k] = row.shape, cin = k / 9;
  return [
    { name: `${prefix}.spatial_layer.weight`, dtype: 'f32', shape: [cin, 1, 3, 3] },
    { name: `${prefix}.channel_layer.weight`, dtype: 'f32', shape: [cout, cin] },
  ];
});
const accessed = new Set(), destroyed = new Set(), buffers = new Set(), dispatches = [];
const device = {
  createBuffer({ size }) { const b = { size, destroy: () => destroyed.add(b) }; buffers.add(b); return b; },
  createShaderModule: x => x,
  createComputePipeline: x => ({ ...x, getBindGroupLayout: () => ({}) }),
  createBindGroup: x => x,
  queue: { writeBuffer() {} },
};
const allocation = { size: 1 << 30 };
const table = Object.fromEntries(rows.map((t, i) => [t.name, { ...t, buffer: allocation,
  bufferOffset: i * 256, byteLength: t.shape.reduce((a, b) => a * b, 1) * 4 }]));
const tensors = new Proxy(table, { get: (t, k) => { accessed.add(k); return t[k]; } });
const network = createMobReconNetwork({ device, tensors, decoder: 'dsconv' });
assert.deepEqual(network.outputs.mesh.shape, [778, 3]);
assert.deepEqual(network.outputs.uv.shape, [21, 2]);
assert.equal(network.dispatchCount, 141); // five depthwise stages plus the existing channel projections
assert.deepEqual(rows.map(t => t.name).filter(n => !accessed.has(n)), []);
network.encode({ beginComputePass() { return {
  setPipeline(p) { dispatches.push(p.label); }, setBindGroup() {}, dispatchWorkgroups() {}, end() {},
}; } });
assert.equal(dispatches.filter(label => label.endsWith(':spiralDepthwise')).length, 5);
network.dispose();
assert.equal(destroyed.size, buffers.size);
assert.throws(() => createMobReconNetwork({ device, tensors, decoder: 'unknown' }), /unsupported MobRecon decoder/);
const malformed = { ...table, 'decoder3d.head.spatial_layer.weight': { ...table['decoder3d.head.spatial_layer.weight'], shape: [32, 1, 1, 9] } };
assert.throws(() => createMobReconNetwork({ device, tensors: malformed, decoder: 'dsconv' }), /DSConv spatial shape/);
console.log('mobrecon DSConv graph contracts: passed');
