import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SF3D_PRODUCER_COMMIT} from '../sf3d-host-device.mjs';
import {createLoaderMemoryBudget} from '../lib/sf3d/sf3d-producer.js';

const source = readFileSync(new URL('../sf3d-live-flame-inject.mjs', import.meta.url), 'utf8');
const mountSource = source.slice(source.indexOf('export async function mountComposition'));
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const device = {queue: {submit() {}}, limits: {maxBufferSize: 1073741824, maxStorageBufferBindingSize: 1073741824}, features: new Set(),
  createBuffer: descriptor => ({size: descriptor.size, destroy() {}}), destroy() {}};
const sharedGpu = {device, queue: device.queue, adapter: {limits: {maxBufferSize: 2147483648}}};
const budget = createLoaderMemoryBudget({cpuBytes: Number.MAX_SAFE_INTEGER, gpuBytes: Number.MAX_SAFE_INTEGER, totalBytes: Number.MAX_SAFE_INTEGER});
await budget.requestOwnedDevice({requestDevice: async () => device});
const hostMemoryBudgets = new WeakMap([[device, budget]]);
// Synthetic unmatched-host policy fixture only; live source conformance is not
// established by this local host/device forwarding contract.
const preflight = async url => ({ok: true, json: async () => ({
  schema: 'kaminos.sf3d-source-admission.v0', authority: 'circuit-breaker-only', verdict: 'not-applicable',
  requestId: new URL(url, 'http://localhost').searchParams.get('requestId'),
  observation: {source: 'live-source-host', platform: 'linux', atUnixMs: 1},
  sourcePath: '/synthetic/lib/sf3d/weights.bin',
  weightSource: {source: 'live-source-file-stat', requestedPath: '/lib/sf3d/weights.bin',
    sourcePath: '/synthetic/lib/sf3d/weights.bin', bytes: 177300},
})});
let calls = [];
const window = {location: new URL('http://localhost/index.html')};
const elements = new Map();
const hud = id => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); };
const producerFactory = async options => {
  budget.assertDeviceAcquiredHere(options.device);
  calls.push(options);
  return {device: options.device, deviceInjected: Boolean(options.device), resources: {weightsSource: 'fixture'}, kitVersion: '0.1.48'};
};
const invoke = new AsyncFunction('window','injectHud','startFrameMonitor','mirrorFireStatus','state','createSf3dProducer','WEIGHTS_URL','IMAGE_URL','loadImage','hud','runSf3d','createSharedDeviceSf3dProducer','snapshotSf3dSharedDevice','connectSf3dForeground','snapshotSf3dHostMemory','hostMemoryBudgets','fetch','crypto','input',
  `${mountSource.replace('export ', '')}; return mountComposition(input);`);
const run = input => invoke(window, () => {}, () => {}, () => {}, {}, producerFactory,
  './lib/sf3d/weights.bin', './fixtures/sf3d-demo-chair.png', async () => ({}), hud, () => {},
  async (...args) => (await import('../sf3d-host-device.mjs')).createSharedDeviceSf3dProducer(...args),
  (...args) => host.snapshotSf3dSharedDevice(...args), () => {},
  value => ({authority: hostMemoryBudgets.has(value) ? 'observation-only' : 'unverified'}), hostMemoryBudgets,
  preflight, {randomUUID: () => 'current-injection-test'}, input);
let host;
// Baseline mount never calls the new helpers, and fails below on the actual
// missing device forwarding, not an import error.
if (source.includes('createSharedDeviceSf3dProducer')) host = await import('../sf3d-host-device.mjs');
await run({prototype: {}, params: new URLSearchParams(), sharedGpu});
assert.equal(calls[0].device, device, 'mount must pass the exact host device into the real producer factory');
assert.equal(calls[0].adapter, sharedGpu.adapter);
assert.equal(calls[0].commit, SF3D_PRODUCER_COMMIT, 'producer factory and host receipt must share one commit authority');
assert.equal(calls[0].memoryBudget, budget, 'actual mounted producer consumes the acquisition authority');
assert.equal(calls[0].expectedWeightBytes, 177300, 'source metadata forwards through the actual helper');
assert.equal(window.__compositionRoute.deviceTopology, 'same-device');
assert.equal(window.__compositionRoute.foregroundScheduling, 'producer-foreground-opportunities');
assert.equal(window.__compositionRoute.deviceReceipt.effectiveLimits.maxBufferSize, device.limits.maxBufferSize, 'effective device, not adapter capacity');
calls = [];
for (const bad of [null, {...sharedGpu, queue: {}}, {...sharedGpu, device: {...device, limits: {maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728}}}]) {
  await assert.rejects(run({prototype: {}, params: new URLSearchParams(), sharedGpu: bad}), /shared.*device|buffer requirement|acquisition instrumentation/);
}
assert.equal(calls.length, 0, 'invalid context must refuse before weights/producer setup, never acquire a fallback device');
assert.equal(window.__compositionRoute.deviceTopology, 'unverified', 'failure cannot retain successful topology');
assert.equal(window.__sf3dLiveFlameReady, false);
assert.equal(window.__sf3dLiveFlame.lastError.phase, 'producer-initialization');
await assert.rejects(host.createSharedDeviceSf3dProducer(async () => ({device: {}, deviceInjected: true}), sharedGpu, {}), /device-mismatch/);
console.log('SF3D host injection and failure contracts passed');
