import assert from 'node:assert/strict';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createLayeredStructuralMaterial } from '../structural-material-3d-core.js';

const root = new URL('..', import.meta.url).pathname;
const liveDragPath = join(root, 'structural-material-3d-live-drag.js');
const pagePath = join(root, 'structural-material-3d.html');
const witnessPath = join(root, 'structural-material-3d-webgpu-tear-witness.mjs');
const nativeCompanionPath = join(root, 'structural-material-haptic-companion.swift');
const nativeWitnessPath = join(root, 'structural-material-haptic-companion-witness.mjs');
const pageSource = readFileSync(pagePath, 'utf8');
const witnessSource = readFileSync(witnessPath, 'utf8');

assert.match(pageSource, /createLatestStructuralInteractionScheduler/, 'page owns a latest-envelope scheduler');
assert.match(pageSource, /latestGpuOperationTracker/, 'page renders GPU state through latest-operation order');
assert.match(pageSource, /request-invalidated-after-execution/, 'discarded post-execution tears cannot settle as passed');

assert.ok(existsSync(liveDragPath), 'live sympathetic drag has a reusable scheduling and haptic contract');
assert.ok(existsSync(nativeCompanionPath), 'native AppKit companion source is present');
assert.ok(existsSync(nativeWitnessPath), 'native AppKit companion has an adversarial route witness');

const {
  DEFAULT_STRUCTURAL_MATERIAL_NATIVE_HAPTIC_URL,
  STRUCTURAL_MATERIAL_3D_HAPTIC_ROUTE,
  STRUCTURAL_MATERIAL_NATIVE_HAPTIC_ROUTE,
  buildLayeredStructuralHapticImpulse,
  createLatestStructuralGpuOperationTracker,
  createLatestStructuralInteractionScheduler,
  detectStructuralHapticCapabilities,
  dispatchStructuralHapticImpulse,
} = await import('../structural-material-3d-live-drag.js');

assert.equal(STRUCTURAL_MATERIAL_3D_HAPTIC_ROUTE, 'kaminos.structural-material.causal-haptics.v0');
assert.equal(STRUCTURAL_MATERIAL_NATIVE_HAPTIC_ROUTE, 'kaminos.structural-material.native-trackpad-haptics.v0');
assert.equal(DEFAULT_STRUCTURAL_MATERIAL_NATIVE_HAPTIC_URL, 'http://127.0.0.1:8396');
assert.equal(typeof createLatestStructuralGpuOperationTracker, 'function', 'live route exports latest GPU operation ordering');

const operationTracker = createLatestStructuralGpuOperationTracker();
const bindingOperation = operationTracker.begin('binding');
operationTracker.settle(bindingOperation, {
  status: 'passed',
  effectiveRoute: 'binding-route',
  timingsMs: { warmTotal: 4.2 },
});
assert.equal(operationTracker.snapshot().kind, 'binding');
assert.equal(operationTracker.snapshot().status, 'passed');

const failedTearOperation = operationTracker.begin('tear');
operationTracker.settle(failedTearOperation, {
  status: 'failed',
  effectiveRoute: 'tear-route',
  failurePhase: 'forced-test-failure',
});
assert.equal(operationTracker.snapshot().kind, 'tear', 'newer tear supersedes older binding identity');
assert.equal(operationTracker.snapshot().status, 'failed', 'newer tear failure remains operator-visible');
assert.equal(operationTracker.snapshot().receipt.effectiveRoute, 'tear-route');

const staleTearOperation = operationTracker.begin('tear');
const latestBindingOperation = operationTracker.begin('binding');
operationTracker.settle(staleTearOperation, { status: 'failed', effectiveRoute: 'stale-tear-route' });
assert.equal(operationTracker.snapshot().operationId, latestBindingOperation, 'older completion cannot replace newer pending identity');
assert.equal(operationTracker.snapshot().status, 'pending');
operationTracker.clear();
operationTracker.settle(latestBindingOperation, { status: 'passed', effectiveRoute: 'late-binding-route' });
assert.equal(operationTracker.snapshot(), null, 'clear invalidates completion from an earlier operation');
operationTracker.begin('tear', {
  requestedRoute: 'tear-route',
  requestedExecutionRoute: 'hot-sidecar-route',
});
assert.equal(operationTracker.snapshot().receipt.requestedRoute, 'tear-route', 'pending operation preserves requested product route');
assert.equal(operationTracker.snapshot().receipt.requestedExecutionRoute, 'hot-sidecar-route', 'pending operation preserves requested execution route');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const executions = [];
const scheduler = createLatestStructuralInteractionScheduler({
  execute(interaction, context) {
    const gate = deferred();
    executions.push({ interaction, context, gate });
    return gate.promise;
  },
});

const first = scheduler.offer({ id: 'first', magnitude: 0.4 });
const replaced = scheduler.offer({ id: 'replaced', magnitude: 0.8 });
const latest = scheduler.offer({ id: 'latest', magnitude: 1.2 });
assert.equal(executions.length, 1, 'one interaction executes while newer pointer envelopes coalesce');
assert.equal(scheduler.snapshot().maxConcurrentExecutionCount, 1, 'scheduler never overlaps retained-state execution');
assert.equal(scheduler.snapshot().pendingInteractionId, 'latest', 'only the latest unstarted envelope remains pending');
assert.deepEqual(
  await replaced,
  {
    status: 'coalesced',
    interactionId: 'replaced',
    supersededByInteractionId: 'latest',
    generation: 0,
  },
  'superseded envelope resolves with an explicit non-evidence receipt',
);

executions[0].gate.resolve({ status: 'passed', eventEpoch: 1 });
assert.equal((await first).status, 'passed');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(executions.length, 2, 'latest pending envelope starts immediately after the active execution');
assert.equal(executions[1].interaction.id, 'latest');
executions[1].gate.resolve({ status: 'passed', eventEpoch: 2 });
assert.equal((await latest).eventEpoch, 2);

const held = scheduler.offer({ id: 'held', magnitude: 1.3 });
const final = scheduler.flush({ id: 'final', magnitude: 1.4 });
assert.equal(executions.length, 3, 'flush does not overlap an already active interaction');
executions[2].gate.resolve({ status: 'passed', eventEpoch: 3 });
assert.equal((await held).eventEpoch, 3);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(executions[3].interaction.id, 'final', 'release flush executes the final force envelope');
assert.equal(executions[3].context.final, true, 'release identity survives coalescing');
executions[3].gate.resolve({ status: 'passed', eventEpoch: 4 });
assert.equal((await final).eventEpoch, 4);

const invalidatedExecution = scheduler.offer({ id: 'invalidated', magnitude: 1.5 });
const invalidatedPending = scheduler.offer({ id: 'invalidated-pending', magnitude: 1.6 });
assert.equal(scheduler.invalidate(), 1, 'reset or bind advances the scheduler generation');
assert.equal((await invalidatedPending).status, 'invalidated');
executions[4].gate.resolve({ status: 'passed', eventEpoch: 5 });
assert.equal((await invalidatedExecution).status, 'invalidated', 'completion from an old generation cannot become evidence');
assert.equal(scheduler.snapshot().maxConcurrentExecutionCount, 1);

const before = createLayeredStructuralMaterial({ columns: 9, rows: 5, layers: 4, notch: true });
const after = structuredClone(before);
after.bonds[52].alive = false;
after.bonds[52].cause = 'stress-threshold';
after.components = [
  { id: 'g0', label: 0, pinned: true, nodeIds: before.nodes.slice(0, 100).map(node => node.id) },
  { id: 'g100', label: 100, pinned: false, nodeIds: before.nodes.slice(100).map(node => node.id) },
];
const impulse = buildLayeredStructuralHapticImpulse(before, after, {
  status: 'passed',
  effectiveRoute: 'kaminos.structural-material.webgpu-sympathetic-tear.v0',
  eventEpoch: 7,
}, {
  magnitude: 1.4,
  vector: { x: 1, y: 0.1, z: -0.4 },
});
assert.equal(impulse.cause, 'accepted-gpu-connectivity-delta');
assert.equal(impulse.newlyBrokenBondCount, 1);
assert.equal(impulse.componentCountDelta, 1);
assert.ok(impulse.intensity > 0 && impulse.intensity <= 1);
assert.equal(
  buildLayeredStructuralHapticImpulse(after, structuredClone(after), { status: 'passed', eventEpoch: 8 }, {}),
  null,
  'no connectivity change produces no haptic impulse',
);

const hapticNavigator = {
  vibrate() { return true; },
  getGamepads() {
    return [{
      id: 'test-pad',
      vibrationActuator: {
        effects: ['dual-rumble'],
        async playEffect() { return 'complete'; },
      },
    }];
  },
};
let nativeFetchRequest = null;
const capability = detectStructuralHapticCapabilities(hapticNavigator);
assert.equal(capability.hostVibration.supported, true);
assert.equal(capability.gamepadHaptics.supported, true);
assert.equal(capability.macTrackpad.supported, false);
assert.equal(capability.macTrackpad.route, STRUCTURAL_MATERIAL_NATIVE_HAPTIC_ROUTE);

const dispatched = await dispatchStructuralHapticImpulse(impulse, {
  navigatorRef: hapticNavigator,
  nativeCompanionUrl: 'http://127.0.0.1:8396',
  async fetchRef(url, init) {
    nativeFetchRequest = { url, init };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          schema: 'kaminos.structural-material.native-haptic-receipt.v0',
          status: 'passed',
          requestedRoute: 'kaminos.structural-material.native-trackpad-haptics.v0',
          effectiveRoute: 'kaminos.structural-material.native-trackpad-haptics.v0',
          performed: true,
          tactileOutputVerified: false,
        };
      },
    };
  },
});
assert.equal(dispatched.status, 'passed');
assert.equal(dispatched.hostVibration.accepted, true);
assert.equal(dispatched.gamepadHaptics.acceptedCount, 1);
assert.ok(nativeFetchRequest, 'accepted causal impulse is offered to the configured loopback companion');
assert.equal(nativeFetchRequest.url, 'http://127.0.0.1:8396/v1/impulse');
assert.equal(nativeFetchRequest.init.method, 'POST');
assert.equal(JSON.parse(nativeFetchRequest.init.body).cause, 'accepted-gpu-connectivity-delta');
assert.equal(dispatched.macTrackpad.status, 'passed');
assert.equal(dispatched.macTrackpad.effectiveRoute, 'kaminos.structural-material.native-trackpad-haptics.v0');
assert.equal(dispatched.macTrackpad.performed, true);
assert.equal(dispatched.macTrackpad.tactileOutputVerified, false);

const overclaimingDispatch = await dispatchStructuralHapticImpulse(impulse, {
  navigatorRef: {},
  nativeCompanionUrl: 'http://127.0.0.1:8396',
  async fetchRef() {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          schema: 'kaminos.structural-material.native-haptic-receipt.v0',
          status: 'passed',
          requestedRoute: 'kaminos.structural-material.native-trackpad-haptics.v0',
          effectiveRoute: 'kaminos.structural-material.native-trackpad-haptics.v0',
          performed: true,
          tactileOutputVerified: true,
        };
      },
    };
  },
});
assert.equal(overclaimingDispatch.macTrackpad.status, 'failed', 'physical-output overclaim is rejected');
assert.equal(overclaimingDispatch.macTrackpad.tactileOutputVerified, false, 'browser never launders tactile verification');
assert.match(overclaimingDispatch.macTrackpad.error, /physical tactile output/i);

assert.match(
  pageSource,
  /pointermove[\s\S]*?liveDragScheduler\.offer/,
  'pointer movement offers structural work before release',
);
assert.match(
  pageSource,
  /pointerup[\s\S]*?liveDragScheduler\.flush/,
  'pointer release flushes the final envelope instead of initiating the first mutation',
);
assert.match(pageSource, /dispatchStructuralHapticImpulse/, 'accepted GPU connectivity change routes causal haptics');
assert.match(pageSource, /hapticCompanionParameter/, 'native haptic endpoint is invocation-configurable');
assert.match(witnessSource, /preReleaseStructuralMutation/, 'browser witness requires visible mutation while held');
assert.match(witnessSource, /releaseFlushedFinalEnvelope/, 'browser witness proves release flushes the final envelope');
assert.match(witnessSource, /latestEnvelopeCoalescing/, 'browser witness forces dense move events through latest-envelope coalescing');
assert.match(witnessSource, /samplingInvariant/, 'browser witness compares dense and coarse sampling fingerprints');
assert.match(witnessSource, /repeatDragPreservedPriorDisplacement/, 'browser witness rejects second-drag transform replacement');
assert.match(witnessSource, /repeatPointerDownPreservedDisplacement/, 'browser witness rejects snapback before second-drag input');
assert.match(witnessSource, /__structuralMaterial3dPickTarget/, 'browser witness begins from a rendered structural pick target');
assert.match(witnessSource, /immediateInputLoadVisible/, 'browser witness observes input load in the pointer event task');
assert.match(witnessSource, /immediateGpuPendingVisible/, 'browser witness distinguishes pending GPU work from applied input load');
assert.match(witnessSource, /immediateGpuRequestedRouteVisible/, 'browser witness requires requested route identity while GPU work is pending');
assert.match(witnessSource, /latestTearFailureVisible/, 'browser witness rejects a latest tear failure hidden by older bind success');
assert.match(witnessSource, /cancelledInFlightTearRejected/, 'browser witness rejects passed status from a cancelled in-flight tear');
assert.match(witnessSource, /Network\.setCacheDisabled/, 'GPU browser witness cannot consume stale module cache as current evidence');
assert.match(witnessSource, /nativeHapticCompanionRequirementSatisfied/, 'browser witness can require native companion receipt identity');

const invalidBooleanReportPath = `/private/tmp/kaminos-invalid-native-haptics-${process.pid}.json`;
const invalidBooleanRun = spawnSync(process.execPath, [
  witnessPath,
  '--url', 'http://127.0.0.1:1/structural-material-3d.html',
  '--out', invalidBooleanReportPath,
  '--screenshot', `/private/tmp/kaminos-invalid-native-haptics-${process.pid}.png`,
  '--require-native-haptics', 'ture',
], { encoding: 'utf8' });
assert.notEqual(invalidBooleanRun.status, 0, 'invalid native-haptics requirement cannot launch a witness');
assert.equal(existsSync(invalidBooleanReportPath), true, 'configuration failure still writes the requested report');
const invalidBooleanReport = JSON.parse(readFileSync(invalidBooleanReportPath, 'utf8'));
assert.equal(invalidBooleanReport.status, 'failed');
assert.equal(invalidBooleanReport.failurePhase, 'configuration');
assert.match(invalidBooleanReport.error?.message || '', /require-native-haptics.*true.*false/i);
unlinkSync(invalidBooleanReportPath);

console.log('structural-material-3d live drag contracts passed');
