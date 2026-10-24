// kaminos-test: node
// Hand detector port contracts without a GPU: the graph against a recording
// fake device from the packed tensor shapes, the letterbox sampling tables
// against MLX's own grid arithmetic, and the post-processing (threshold, NMS,
// class choice, mapping back to source pixels, Good/Bad's square crop).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandDetectorNetwork, DETECTOR_ANCHORS } from '../models/wilor-hand-detector/detector-network.js';
import { letterboxTables, unitTable } from '../models/wilor-hand-detector/detector-kernels.js';
import { decodeDetections, squareCrop } from '../models/wilor-hand-detector/detections.js';

const read = name => JSON.parse(fs.readFileSync(new URL(`../models/wilor-hand-detector/fixtures/${name}`, import.meta.url), 'utf8'));

// ---- Graph ----
const shapes = read('tensor-shapes.json');
function fakeDevice() {
  const log = { buffers: 0, destroyed: 0, bindGroups: 0 };
  return { log,
    createBuffer: ({ size }) => { log.buffers++; return { size, destroy: () => { log.destroyed++; } }; },
    createShaderModule: ({ code }) => ({ code }),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: ({ entries }) => { log.bindGroups++; for (const { resource } of entries) assert.ok(resource?.buffer); return {}; },
    queue: { writeBuffer() {} } };
}
function tensorsFrom(rows, accessed) {
  const allocation = { size: 1 << 30 };
  const table = Object.fromEntries(rows.map((t, i) => [t.name, { ...t, buffer: allocation, bufferOffset: i * 256,
    byteLength: t.shape.reduce((x, y) => x * y, 1) * 4 }]));
  return new Proxy(table, { get: (target, key) => { accessed.add(key); return target[key]; } });
}
const accessed = new Set(), device = fakeDevice();
const network = createHandDetectorNetwork({ device, tensors: tensorsFrom(shapes.tensors, accessed) });
assert.equal(DETECTOR_ANCHORS, 5376);
assert.deepEqual(network.output.shape, [69, 5376]);
assert.deepEqual(network.input.shape, [3, 512, 512]);
assert.deepEqual(shapes.tensors.map(t => t.name).filter(n => !accessed.has(n)), [], 'every packed tensor is consumed');
for (const [key, shape] of [['b0', [48, 256, 256]], ['b4', [192, 64, 64]], ['b9', [576, 16, 16]], ['h15', [192, 64, 64]],
  ['h21', [576, 16, 16]], ['pose.cv2.0', [64, 64, 64]], ['pose.cv3.2', [2, 16, 16]], ['pose.cv4.1', [63, 32, 32]]]) {
  assert.deepEqual(network.view(key)?.shape, shape, key);
}
// p4 lands inside h12's concat input, and p5 inside h21's: no copies.
assert.equal(network.view('b6').offset, 576 * 32 * 32, 'p4 sits after up(p5) in the h12 input');
assert.equal(network.view('b9').offset, 384 * 16 * 16, 'p5 sits after f19 in the h21 input');
assert.equal(network.view('h19').buffer, network.view('b9').buffer);
network.dispose();
assert.equal(device.log.destroyed, device.log.buffers);
assert.throws(() => createHandDetectorNetwork({ device: fakeDevice(), tensors: tensorsFrom(shapes.tensors.filter(t => t.name !== 'h21.cv2.bias'), new Set()) }),
  /missing hand detector tensor h21\.cv2\.bias/);

// ---- Letterbox tables equal MLX's own grid arithmetic ----
for (const c of read('letterbox-tables.json').cases) {
  const t = letterboxTables(c.width, c.height);
  assert.deepEqual([...t.columns], c.columns, `columns ${c.width}x${c.height}`);
  assert.deepEqual([...t.rows], c.rows, `rows ${c.width}x${c.height}`);
}
assert.equal(unitTable()[255], 1);
assert.equal(unitTable()[1], Math.fround(1 / 255));

// ---- Post-processing ----
const anchors = 8, out = new Float32Array(69 * anchors);
const put = (a, { box, left = 0, right = 0, kp = 0 }) => {
  box.forEach((v, r) => { out[r * anchors + a] = v; });
  out[4 * anchors + a] = left; out[5 * anchors + a] = right;
  for (let k = 0; k < 21; k++) { out[(6 + 3 * k) * anchors + a] = kp + k; out[(7 + 3 * k) * anchors + a] = kp + 2 * k; out[(8 + 3 * k) * anchors + a] = 0.5; }
};
put(0, { box: [256, 256, 100, 100], right: 0.9, kp: 200 });   // kept
put(1, { box: [258, 256, 100, 100], right: 0.8 });            // IoU > 0.5 with 0: suppressed
put(2, { box: [100, 100, 40, 60], left: 0.4, right: 0.4 });   // tie: class 0 (left), as argmax
put(3, { box: [400, 400, 30, 30], left: 0.1 });               // below threshold
const dets = decodeDetections(out, { width: 640, height: 480, threshold: 0.3, anchors });
assert.deepEqual(dets.map(d => [d.anchor, d.handSide]), [[0, 'right'], [2, 'left']]);
// 640x480 letterboxed into 512: scale 1.25, rows offset 80.
assert.deepEqual(dets[0].bbox, [257.5, 177.5, 382.5, 302.5]);
assert.deepEqual(dets[0].keypoints[1], [Math.fround(201 * 1.25), Math.fround(202 * 1.25 - 80)]);
assert.equal(decodeDetections(out, { width: 640, height: 480, threshold: 0.95, anchors }).length, 0);
assert.throws(() => decodeDetections(new Float32Array(70), { width: 1, height: 1 }), /\[69, anchors\]/);

assert.deepEqual(squareCrop([10, 20, 30, 60], 1.5), [-10, 10, 50, 70]);
assert.throws(() => squareCrop([10, 20, 10, 60], 1.4), /invalid detector box/);
assert.throws(() => squareCrop([10, 20, 30, 60], 0.9), /invalid crop padding/);
console.log('wilor hand detector contracts: passed');
