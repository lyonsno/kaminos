import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSf3dProducer, createLoaderMemoryBudget} from '../lib/sf3d/sf3d-producer.js';
import {createSharedDeviceSf3dProducer} from '../sf3d-host-device.mjs';

// Exercise the actual mount -> host helper -> bundled producer -> loader join.
// Tiny synthetic source metadata and an intentional fetch sentinel establish
// the handoff, not model numerics, native GPU behavior or positive memory fit.
const source = readFileSync(new URL('../sf3d-live-flame-inject.mjs', import.meta.url), 'utf8');
const mount = source.slice(source.indexOf('export async function mountComposition')).replace('export ', '');
const acquisition = source.slice(source.indexOf('const hostMemoryBudgets'), source.indexOf('const CANONICAL_DEMO_CHAIR')).replaceAll('export ', '');
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
let allocations = 0, weightFetches = 0;
const device = {
  queue: {submit() {}}, features: new Set(),
  limits: {maxBufferSize: 2147483648, maxStorageBufferBindingSize: 1073741824},
  createBuffer({size}) {allocations++; return {size, destroy() {}};}, destroy() {},
};
const adapter = {limits: device.limits, info: {vendor: 'synthetic', description: 'local contract fixture'}, requestDevice: async () => device};
let sourceReport = {
  schema: 'kaminos.sf3d-source-admission.v0', authority: 'circuit-breaker-only', verdict: 'not-applicable',
  requestId: 'real-producer-contract', sourcePath: '/synthetic/lib/sf3d/weights.bin',
  observation: {source: 'live-source-host', platform: 'linux', atUnixMs: 1},
  weightSource: {source: 'live-source-file-stat', requestedPath: '/lib/sf3d/weights.bin',
    sourcePath: '/synthetic/lib/sf3d/weights.bin', bytes: 177300},
};
const sentinel = new Error('test-real-producer-weight-fetch-reached');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith('/api/sf3d-source-admission?')) {
    assert.equal(options.cache, 'no-store');
    return {ok: true, json: async () => sourceReport};
  }
  assert.equal(url, './lib/sf3d/weights.bin');
  weightFetches++;
  throw sentinel;
};
const window = {location: new URL('http://localhost/index.html')}, state = {}, nodes = new Map();
const invoke = new AsyncFunction('window', 'state', 'createLoaderMemoryBudget', 'createSf3dProducer',
  'createSharedDeviceSf3dProducer', 'fetch', 'crypto', 'WEIGHTS_URL', 'hud', 'injectHud',
  'startFrameMonitor', 'mirrorFireStatus', 'sharedGpu',
  `${acquisition}${mount}\nawait acquireSharedGpuDevice(sharedGpu.adapter, {});
   const baseline = sharedGpu.device.createBuffer({size: 32});
   try {await mountComposition({params: new Map(), sharedGpu});}
   finally {this.observation = snapshotSf3dHostMemory(sharedGpu.device); baseline.destroy(); sharedGpu.device.destroy();}`);
const run = () => {
  // Each mount owns a genuinely fresh device; do not reacquire a destroyed
  // object whose authenticated budget intentionally remains associated.
  const freshDevice = {...device, queue: {...device.queue}, features: new Set()};
  const freshAdapter = {...adapter, requestDevice: async () => freshDevice};
  return invoke.call(window, window, state, createLoaderMemoryBudget, createSf3dProducer,
    createSharedDeviceSf3dProducer, globalThis.fetch, {randomUUID: () => 'real-producer-contract'},
    './lib/sf3d/weights.bin', id => {if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id);},
    () => {}, () => {}, () => {}, {device: freshDevice, adapter: freshAdapter, queue: freshDevice.queue});
};
try {
  await assert.rejects(run(), error => error === sentinel,
    'actual budgeted loader must consume observed source size and reach its exact weight fetch');
  assert.equal(weightFetches, 1);
  assert.equal(allocations, 1, 'no producer GPU allocation before the weight fetch sentinel');
  assert.equal(window.observation.budget.cpu.liveBytes, 0, 'failed fetch retires source reservation');
  assert.equal(window.observation.budget.gpu.liveBytes, 32, 'producer failure preserves the host baseline');
  for (const weightSource of [null, {...sourceReport.weightSource, bytes: true},
    {...sourceReport.weightSource, bytes: 15}, {...sourceReport.weightSource, bytes: 1.5},
    {...sourceReport.weightSource, requestedPath: '/other.bin'}, {...sourceReport.weightSource, source: 'cache'},
    {...sourceReport.weightSource, sourcePath: '/different/weights.bin'}]) {
    sourceReport = {...sourceReport, weightSource};
    await assert.rejects(run(), error => error.name === 'SF3DSourceHoldError');
    assert.equal(weightFetches, 1, 'invalid source-size authority must fail before weight fetch');
  }
} finally {globalThis.fetch = originalFetch;}
console.log('Actual bundled SF3D loader consumes bound source size; malformed metadata fails before fetching');
