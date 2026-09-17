import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../sf3d-live-flame-inject.mjs', import.meta.url), 'utf8');
const mountSource = source.slice(source.indexOf('export async function mountComposition'));
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const device = {queue: {submit() {}}, limits: {maxBufferSize: 1073741824, maxStorageBufferBindingSize: 1073741824}, features: new Set()};
const sharedGpu = {device, queue: device.queue, adapter: {limits: {maxBufferSize: 2147483648}}};
let calls = [];
const window = {};
const elements = new Map();
const hud = id => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); };
const producerFactory = async options => {
  calls.push(options);
  return {device: options.device, deviceInjected: Boolean(options.device), resources: {weightsSource: 'fixture'}, kitVersion: '0.1.48'};
};
const invoke = new AsyncFunction('window','injectHud','startFrameMonitor','mirrorFireStatus','state','createSf3dProducer','WEIGHTS_URL','IMAGE_URL','loadImage','hud','runSf3d','createSharedDeviceSf3dProducer','snapshotSf3dSharedDevice','input',
  `${mountSource.replace('export ', '')}; return mountComposition(input);`);
const run = input => invoke(window, () => {}, () => {}, () => {}, {}, producerFactory,
  './lib/sf3d/weights.bin', './fixtures/sf3d-demo-chair.png', async () => ({}), hud, () => {},
  async (...args) => (await import('../sf3d-host-device.mjs')).createSharedDeviceSf3dProducer(...args),
  (...args) => host.snapshotSf3dSharedDevice(...args), input);
let host;
// Baseline mount never calls the new helpers, and fails below on the actual
// missing device forwarding, not an import error.
if (source.includes('createSharedDeviceSf3dProducer')) host = await import('../sf3d-host-device.mjs');
await run({prototype: {}, params: new URLSearchParams(), sharedGpu});
assert.equal(calls[0].device, device, 'mount must pass the exact host device into the real producer factory');
assert.equal(calls[0].adapter, sharedGpu.adapter);
assert.equal(calls[0].commit, '0ff8dc4527ba5513f2f6a9f5a7a6497e710af691');
assert.equal(window.__compositionRoute.deviceTopology, 'same-device');
assert.equal(window.__compositionRoute.foregroundScheduling, 'independent-render-loops');
assert.equal(window.__compositionRoute.deviceReceipt.effectiveLimits.maxBufferSize, device.limits.maxBufferSize, 'effective device, not adapter capacity');
calls = [];
for (const bad of [null, {...sharedGpu, queue: {}}, {...sharedGpu, device: {...device, limits: {maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728}}}]) {
  await assert.rejects(run({prototype: {}, params: new URLSearchParams(), sharedGpu: bad}), /shared.*device|buffer requirement/);
}
assert.equal(calls.length, 0, 'invalid context must refuse before weights/producer setup, never acquire a fallback device');
assert.equal(window.__compositionRoute.deviceTopology, 'unverified', 'failure cannot retain successful topology');
assert.equal(window.__sf3dLiveFlameReady, false);
assert.equal(window.__sf3dLiveFlame.lastError.phase, 'producer-initialization');
await assert.rejects(host.createSharedDeviceSf3dProducer(async () => ({device: {}, deviceInjected: true}), sharedGpu, {}), /device-mismatch/);
console.log('SF3D host injection and failure contracts passed');
