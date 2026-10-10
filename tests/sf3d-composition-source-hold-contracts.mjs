import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createLoaderMemoryBudget} from '../lib/sf3d/sf3d-producer.js';

const source = fs.readFileSync(new URL('../sf3d-live-flame-inject.mjs', import.meta.url), 'utf8');
const mount = source.slice(source.indexOf('export async function mountComposition')).replace('export ', '');
const acquisition = source.slice(source.indexOf('const hostMemoryBudgets'), source.indexOf('const CANONICAL_DEMO_CHAIR')).replaceAll('export ', '');
let constructorCalls = 0, fetchCalls = 0;
let sourceReport = {
  schema: 'kaminos.sf3d-source-admission.v0', verdict: 'refused',
  authority: 'circuit-breaker-only', modelPayloadBytesServed: 0,
  reason: 'M2 full-model admission remains unresolved',
};
const nodes = new Map();
const context = vm.createContext({
  window: {}, state: {}, hud: id => {
    if (!nodes.has(id)) nodes.set(id, {});
    return nodes.get(id);
  }, injectHud() {}, startFrameMonitor() {}, mirrorFireStatus() {},
  crypto: {randomUUID: () => 'current-test-request'},
  createLoaderMemoryBudget,
  WEIGHTS_URL: './lib/sf3d/weights.bin', createSf3dProducer() {},
  async createSharedDeviceSf3dProducer() {
    constructorCalls++;
    throw new Error('test-unprotected-constructor-called');
  },
  async fetch(url, options) {
    fetchCalls++;
    assert.equal(url, '/api/sf3d-source-admission?requestId=current-test-request');
    assert.equal(options.cache, 'no-store');
    return {ok: true, json: async () => sourceReport && {...sourceReport, requestId: 'current-test-request'}};
  },
});
vm.runInContext(acquisition+mount+'\nthis.mount = mountComposition;', context);
await assert.rejects(context.mount({params: new Map()}), error => error.name === 'SF3DSourceHoldError');
assert.equal(fetchCalls, 1, 'fresh actual source-host preflight before constructor');
assert.equal(constructorCalls, 0, 'held full model never reaches its constructor');
assert.equal(context.window.__sf3dLiveFlameReady, false);
assert.equal(context.state.lastError.sourceAdmission.verdict, 'refused');
for (const bad of [null, {}, {schema: 'kaminos.sf3d-source-admission.v0', verdict: 'admitted', authority: 'circuit-breaker-only'},
                   {schema: 'kaminos.sf3d-source-admission.v0', verdict: 'not-applicable', authority: 'circuit-breaker-only'}]) {
  sourceReport = bad;
  await assert.rejects(context.mount({params: new Map()}), error => error.name === 'SF3DSourceHoldError');
  assert.equal(constructorCalls, 0, 'unknown or positive-looking source projection cannot authorize constructor');
}
console.log('SF3D composition refuses held source before producer construction');
