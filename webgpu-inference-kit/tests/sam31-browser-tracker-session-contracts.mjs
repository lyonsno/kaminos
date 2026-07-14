import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as kit from '../src/index.js';

assert.equal(kit.SAM31_BROWSER_TRACKER_SESSION_SCHEMA, 'kaminos.sam31-browser-tracker-session.v0');
assert.equal(typeof kit.createSam31BrowserTrackerSession, 'function', 'the inference kit must export the package-backed tracker session');
assert.equal(typeof kit.runSam31TwoImageBackbone, 'function', 'the inference kit must export the promoted two-image backbone');
assert.equal(typeof kit.runSam31BrowserTrackerPackageInvocation, 'function', 'the inference kit must export the package-backed invocation driver');

const lifecycle = [];
let resolveLost;
const device = {
  queue: {
    async onSubmittedWorkDone() {
      lifecycle.push('queue-drained');
    },
  },
  lost: new Promise(resolve => { resolveLost = resolve; }),
  destroy() {
    lifecycle.push('device-destroyed');
    resolveLost({ reason: 'destroyed', message: 'test close' });
  },
};
const packageRuntime = {
  packageId: 'sam31-tracker-model-package:test',
  invocationId: 'sam31-tracker-invocation:test',
  verificationAttached: false,
};
const completeInvocationResult = () => ({
  evidence: { passed: true },
  receipts: Array.from({ length: 19 }, (_, index) => ({ index })),
  requestIds: Array.from({ length: 19 }, (_, index) => `request-${index}`),
  requestedRouteIds: Array.from({ length: 19 }, (_, index) => `route-${index}`),
  effectiveRouteIds: Array.from({ length: 19 }, (_, index) => `route-${index}`),
});
let invocationRuns = 0;
const session = await kit.createSam31BrowserTrackerSession({
  packageRuntime,
  executionContext: { adapter: { info: { vendor: 'test', architecture: 'test' } }, device, errors: [] },
  executeInvocation: async input => {
    invocationRuns += 1;
    assert.equal(input.packageRuntime, packageRuntime);
    assert.equal(input.device, device);
    return completeInvocationResult();
  },
});
assert.equal(session.schema, kit.SAM31_BROWSER_TRACKER_SESSION_SCHEMA);
assert.equal(session.status, 'open');
assert.equal(session.packageRuntime, packageRuntime);
assert.deepEqual(await session.run(), completeInvocationResult());
assert.equal(session.status, 'completed');
await assert.rejects(() => session.run(), /already executed/);
const closeEvidence = await session.close();
assert.deepEqual(lifecycle, ['queue-drained', 'device-destroyed']);
assert.equal(closeEvidence.queueDrained, true);
assert.equal(closeEvidence.deviceDestroyed, true);
assert.equal(closeEvidence.deviceLossAwaited, true);
assert.equal(session.status, 'closed');
assert.equal(invocationRuns, 1);
await assert.rejects(() => session.run(), /closed/);
assert.equal(await session.close(), closeEvidence, 'close must be idempotent and preserve its first evidence object');

let resolveUnexpectedLoss;
const unexpectedLossDevice = {
  queue: {
    async onSubmittedWorkDone() {
      resolveUnexpectedLoss({ reason: 'unknown', message: 'lost while draining' });
      await Promise.resolve();
    },
  },
  lost: new Promise(resolve => { resolveUnexpectedLoss = resolve; }),
  destroy() {},
};
const unexpectedLossSession = await kit.createSam31BrowserTrackerSession({
  packageRuntime,
  executionContext: { adapter: { info: { vendor: 'test', architecture: 'test' } }, device: unexpectedLossDevice, errors: [] },
  executeInvocation: async () => completeInvocationResult(),
});
await unexpectedLossSession.run();
const unexpectedLossClose = await unexpectedLossSession.close();
assert.deepEqual(
  unexpectedLossClose.deviceLoss,
  { reason: 'unknown', message: 'lost while draining' },
  'device loss during queue drain must not be laundered into intentional close evidence',
);

let resolveIncompleteLost;
const incompleteDevice = {
  queue: { async onSubmittedWorkDone() {} },
  lost: new Promise(resolve => { resolveIncompleteLost = resolve; }),
  destroy() { resolveIncompleteLost({ reason: 'destroyed', message: 'test close' }); },
};
const incompleteSession = await kit.createSam31BrowserTrackerSession({
  packageRuntime,
  executionContext: { adapter: { info: { vendor: 'test', architecture: 'test' } }, device: incompleteDevice, errors: [] },
  executeInvocation: async () => ({ ...completeInvocationResult(), receipts: Array.from({ length: 18 }, (_, index) => ({ index })) }),
});
await assert.rejects(
  () => incompleteSession.run(),
  /complete 19-route evidence/,
  'the public session must reject an incomplete driver result even when it claims passage',
);
assert.equal(incompleteSession.status, 'failed');
await incompleteSession.close();

await assert.rejects(
  () => kit.createSam31BrowserTrackerSession({ packageRuntime, executionContext: {} }),
  /execution context requires an adapter and device/,
);
await assert.rejects(
  () => kit.createSam31BrowserTrackerSession({ executionContext: { adapter: {}, device } }),
  /package root and shared cache are required/,
);

const smokeSource = await readFile(new URL('../smokes/sam31-two-frame-tracker-parity.js', import.meta.url), 'utf8');
assert.match(smokeSource, /createSam31BrowserTrackerSession/, 'package smoke must consume the exported session');
assert.doesNotMatch(smokeSource, /invocations\.push\(await runInvocation\(packageRoots\[index\]/, 'package smoke must not bypass the exported session with its private invocation function');
assert.match(smokeSource, /runtimeSession:\s*\{/, 'package smoke must preserve public session identity in each invocation row');
assert.match(smokeSource, /closeEvidence:\s*sessionClose/, 'package smoke must preserve session close evidence after awaiting device loss');

console.log('sam3.1 browser tracker session contracts passed');
