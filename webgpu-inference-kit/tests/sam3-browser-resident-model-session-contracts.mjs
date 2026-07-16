import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as kit from '../src/index.js';

assert.equal(typeof kit.createSam3BrowserResidentModelSession, 'function');
assert.equal(typeof kit.createSam3BrowserResidentModelSessionForTest, 'function');

const packageRuntime = { packageId: 'sam3-model-package:resident-session-fixture' };
const source = new Float32Array([1, 2]);
const binding = { sourceData: source, allocationId: 'resident-allocation' };
let bindCount = 0;
const lifecycle = [];
const ownerRoute = { routeId: 'sam3.resident-model-owner.webgpu-local.v0' };
const residentResources = {
  packageId: packageRuntime.packageId,
  loadFloat32(entry) {
    assert.equal(entry.role, 'fixture-weight');
    return source;
  },
  residentTensorResolver(input) {
    assert.strictEqual(input.sourceData, source);
    return binding;
  },
  bind(entry, loadedSource) {
    assert.equal(entry.role, 'fixture-weight');
    assert.strictEqual(loadedSource, source);
    bindCount += 1;
    return binding;
  },
  evidence() {
    return { packageId: packageRuntime.packageId, uploadCount: 1, bindingCount: 1 };
  },
  release() {
    lifecycle.push('resident-release');
  },
};
const inferenceSession = {
  async drain() {
    lifecycle.push('session-drain');
  },
  unregisterRoute(routeId) {
    assert.equal(routeId, ownerRoute.routeId);
    lifecycle.push('owner-route-unregister');
  },
  close() {
    lifecycle.push('session-close');
  },
  snapshot() {
    return { sessionId: 'fixture-session', deviceOwnership: 'borrowed' };
  },
};

const session = kit.createSam3BrowserResidentModelSessionForTest({
  packageRuntime,
  inferenceSession,
  ownerRoute,
  residentResources,
  commit: 'fixture-commit',
  preparationMilliseconds: 12.5,
});
assert.equal(session.packageId, packageRuntime.packageId);
assert.strictEqual(session.loadFloat32({ role: 'fixture-weight' }), source);
assert.equal(bindCount, 1, 'resident loads must bind the exact authenticated view to its semantic declaration');
assert.strictEqual(session.residentTensorResolver({ sourceData: source }), binding);
assert.deepEqual(session.evidence(), {
  schema: 'kaminos.sam3-browser-resident-model-session-evidence.v0',
  status: 'active',
  packageId: packageRuntime.packageId,
  commit: 'fixture-commit',
  preparationMilliseconds: 12.5,
  inferenceSession: { sessionId: 'fixture-session', deviceOwnership: 'borrowed' },
  residentResources: { packageId: packageRuntime.packageId, uploadCount: 1, bindingCount: 1 },
});

await session.close();
await session.close();
assert.deepEqual(lifecycle, [
  'session-drain',
  'resident-release',
  'owner-route-unregister',
  'session-close',
]);
assert.equal(session.evidence().status, 'closed');
assert.throws(() => session.loadFloat32({ role: 'fixture-weight' }), /closed/i);

const failedCloseLifecycle = [];
const failedCloseSession = kit.createSam3BrowserResidentModelSessionForTest({
  packageRuntime,
  ownerRoute,
  residentResources: {
    ...residentResources,
    release() { failedCloseLifecycle.push('resident-release'); },
  },
  inferenceSession: {
    async drain() {
      failedCloseLifecycle.push('session-drain');
      throw new Error('fixture drain failed');
    },
    unregisterRoute() { failedCloseLifecycle.push('owner-route-unregister'); },
    close() { failedCloseLifecycle.push('session-close'); },
    snapshot() { return { sessionId: 'failed-close-session', deviceOwnership: 'borrowed' }; },
  },
  preparationMilliseconds: 1,
});
await assert.rejects(() => failedCloseSession.close(), /fixture drain failed/);
assert.deepEqual(
  failedCloseLifecycle,
  ['session-drain', 'resident-release', 'owner-route-unregister', 'session-close'],
  'a drain failure must remain visible without stranding resident resources or route/session ownership',
);
assert.equal(failedCloseSession.evidence().status, 'closed');

const sourceText = readFileSync(new URL('../src/sam3-browser-resident-model-session.js', import.meta.url), 'utf8');
assert.match(sourceText, /createWebGpuInferenceSession/);
assert.match(sourceText, /deviceOwnership:\s*['"]borrowed['"]/);
assert.match(sourceText, /createSam31ResidentModelResources/);
assert.match(sourceText, /resident-model-owner/);

console.log('sam3 browser resident model session contracts passed');
