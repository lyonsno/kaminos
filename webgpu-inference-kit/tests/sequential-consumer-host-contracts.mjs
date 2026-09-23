import assert from 'node:assert/strict';
import { createSequentialConsumerHost } from '../examples/sequential-consumer-host.mjs';

const device = {};
const order = [];
const states = [];
let samClosed = 0;
let sf3dDisposed = 0;
const sam = {
  device,
  async run(_manifest, request) { order.push(`sam:${request.invocationId}`); return { mask: new Uint8Array([1]) }; },
  async close() { samClosed += 1; },
};
const sf3d = {
  device,
  async run(_image, { onProgress }) { order.push('sf3d'); onProgress('mesh export'); return { glb: new Uint8Array([2]) }; },
  dispose() { return { completion: Promise.resolve().then(() => { sf3dDisposed += 1; }) }; },
};
const host = createSequentialConsumerHost({ device, sam, sf3d, onState: state => states.push(state) });
const first = await host.runSam('/manifest.json', { invocationId: 'sam-1' });
const mesh = await host.runSf3d({}, { runId: 'sf3d-1' });
const second = await host.runSam('/manifest.json', { invocationId: 'sam-2' });
assert.deepEqual(order, ['sam:sam-1', 'sf3d', 'sam:sam-2']);
assert.equal(host.snapshot().outputs.length, 3);
assert.equal(host.snapshot().outputs[0].output, first);
assert.equal(host.snapshot().outputs[1].output, mesh);
assert.equal(host.snapshot().outputs[2].output, second);
assert(states.some(state => state.phase === 'mesh export'));
await host.dispose();
assert.equal(samClosed, 1);
assert.equal(sf3dDisposed, 1);
assert.equal(host.snapshot().status, 'closed');
await assert.rejects(host.runSam('/manifest.json', {}), /closed/);

assert.throws(() => createSequentialConsumerHost({ device, sam, sf3d: { ...sf3d, device: {} } }), /host device/);
console.log('sequential consumer host contracts passed');
