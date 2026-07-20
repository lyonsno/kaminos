import assert from 'node:assert/strict';

import {
  WEBGPU_PHASE_RESOURCE_PLAN_SCHEMA,
  WEBGPU_PHASE_RESOURCE_WORKING_SET_SCHEMA,
  WEBGPU_PHASE_RESOURCE_TRANSITION_SCHEMA,
  createWebGpuPhaseResourceWorkingSet,
  createWebGpuResourceResidency,
  defineWebGpuPhaseResourcePlan,
} from '../src/index.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function resource(resourceId, declaredBytes) {
  return { resourceId, declaredBytes, metadata: { role: resourceId } };
}

const plan = defineWebGpuPhaseResourcePlan({
  planId: 'sam3.browser-static-working-set',
  resources: [
    resource('encoder', 8),
    resource('shared', 4),
    resource('decoder', 12),
    resource('head', 16),
    resource('scratch', 20),
    resource('broken', 24),
    resource('cancel', 28),
  ],
  phases: [
    {
      phaseId: 'encode',
      requiredResourceIds: ['encoder', 'shared'],
      prefetchResourceIds: ['decoder'],
    },
    {
      phaseId: 'decode',
      requiredResourceIds: ['shared', 'decoder'],
      prefetchResourceIds: ['head', 'decoder'],
    },
    {
      phaseId: 'failing',
      requiredResourceIds: ['shared', 'scratch', 'broken'],
    },
    {
      phaseId: 'canceling',
      requiredResourceIds: ['shared', 'cancel'],
    },
  ],
  metadata: { model: 'sam3' },
});

assert.equal(plan.schema, WEBGPU_PHASE_RESOURCE_PLAN_SCHEMA);
assert.equal(Object.isFrozen(plan), true);
assert.equal(Object.isFrozen(plan.resources), true);
assert.deepEqual(plan.resourceIds, ['encoder', 'shared', 'decoder', 'head', 'scratch', 'broken', 'cancel']);
assert.deepEqual(plan.phaseIds, ['encode', 'decode', 'failing', 'canceling']);
assert.deepEqual(plan.phases[1].holdResourceIds, ['shared', 'decoder', 'head']);
assert.equal(plan.totalDeclaredBytes, 112);
assert.match(plan.identity, /sam3\.browser-static-working-set/);

assert.throws(
  () => defineWebGpuPhaseResourcePlan({
    planId: 'capped',
    maxResources: 2,
    resources: [resource('a', 4)],
    phases: [{ phaseId: 'a', requiredResourceIds: ['a'] }],
  }),
  /uncapped|maxResources/i,
);
assert.throws(
  () => defineWebGpuPhaseResourcePlan({
    planId: 'unknown-resource',
    resources: [resource('a', 4)],
    phases: [{ phaseId: 'a', requiredResourceIds: ['missing'] }],
  }),
  /unknown.*missing/i,
);
assert.throws(
  () => defineWebGpuPhaseResourcePlan({
    planId: 'duplicate-resource',
    resources: [resource('a', 4), resource('a', 4)],
    phases: [{ phaseId: 'a', requiredResourceIds: ['a'] }],
  }),
  /duplicate.*resource/i,
);
assert.throws(
  () => defineWebGpuPhaseResourcePlan({
    planId: 'non-json-metadata',
    resources: [{ resourceId: 'a', declaredBytes: 4, metadata: { load() {} } }],
    phases: [{ phaseId: 'a', requiredResourceIds: ['a'] }],
  }),
  /metadata.*JSON-compatible/i,
);

const manyResources = Array.from({ length: 48 }, (_, index) => resource(`resource-${index}`, 4));
const uncappedPlan = defineWebGpuPhaseResourcePlan({
  planId: 'uncapped-plan',
  resources: manyResources,
  phases: [{ phaseId: 'all', requiredResourceIds: manyResources.map(item => item.resourceId) }],
});
assert.equal(uncappedPlan.resources.length, 48);
assert.equal(uncappedPlan.phases[0].holdResourceIds.length, 48);

let nowMs = 100;
const loadCalls = [];
const releaseCalls = [];
const liveLeases = new Map();
const leaseSequence = new Map();
const residency = {
  totalResidentDeclaredBytes: 0,
  evictionCandidates: [],
};

function leaseFor(descriptor) {
  const sequence = (leaseSequence.get(descriptor.resourceId) || 0) + 1;
  leaseSequence.set(descriptor.resourceId, sequence);
  const leaseId = `${descriptor.resourceId}:${sequence}`;
  let released = false;
  const lease = {
    resourceId: descriptor.resourceId,
    leaseId,
    release() {
      if (released) return { status: 'already-released', resourceId: descriptor.resourceId, leaseId };
      released = true;
      liveLeases.delete(leaseId);
      releaseCalls.push(descriptor.resourceId);
      return { status: 'released', resourceId: descriptor.resourceId, leaseId };
    },
  };
  liveLeases.set(leaseId, lease);
  return Object.freeze(lease);
}

const controller = createWebGpuPhaseResourceWorkingSet({
  controllerId: 'sam3-working-set-controller',
  plan,
  now: () => ++nowMs,
  residencySnapshot: () => ({ ...residency }),
  async acquireResource({ resource: descriptor, phaseId, purpose, signal }) {
    loadCalls.push({ resourceId: descriptor.resourceId, phaseId, purpose, aborted: signal?.aborted === true });
    if (descriptor.resourceId === 'broken') throw new Error('broken resource fixture');
    return leaseFor(descriptor);
  },
});

assert.equal(controller.schema, WEBGPU_PHASE_RESOURCE_WORKING_SET_SCHEMA);
assert.equal(controller.snapshot().status, 'active');
assert.equal(controller.snapshot().currentPhaseId, null);
assert.equal(controller.snapshot().heldDeclaredBytes, 0);

const encode = await controller.transitionToPhase('encode');
assert.equal(encode.schema, WEBGPU_PHASE_RESOURCE_TRANSITION_SCHEMA);
assert.equal(encode.status, 'prepared');
assert.deepEqual(encode.acquiredResourceIds, ['encoder', 'shared', 'decoder']);
assert.deepEqual(encode.retainedResourceIds, []);
assert.deepEqual(encode.releasedResourceIds, []);
assert.deepEqual(encode.heldResourceIds, ['encoder', 'shared', 'decoder']);
assert.equal(encode.heldDeclaredBytes, 24);
assert.deepEqual(
  loadCalls.map(call => [call.resourceId, call.purpose]),
  [['encoder', 'required'], ['shared', 'required'], ['decoder', 'prefetch']],
);

residency.totalResidentDeclaredBytes = 24;
const decode = await controller.transitionToPhase('decode');
assert.equal(decode.status, 'prepared');
assert.deepEqual(decode.acquiredResourceIds, ['head']);
assert.deepEqual(decode.retainedResourceIds, ['shared', 'decoder']);
assert.deepEqual(decode.releasedResourceIds, ['encoder']);
assert.deepEqual(decode.heldResourceIds, ['shared', 'decoder', 'head']);
assert.equal(decode.heldDeclaredBytes, 32);
assert.deepEqual(releaseCalls, ['encoder']);
assert.equal(controller.snapshot().currentPhaseId, 'decode');
assert.equal(controller.snapshot().heldDeclaredBytes, 32);
assert.equal(controller.snapshot().residency.totalResidentDeclaredBytes, 24);

const samePhase = await controller.transitionToPhase('decode');
assert.deepEqual(samePhase.acquiredResourceIds, []);
assert.deepEqual(samePhase.releasedResourceIds, []);
assert.deepEqual(samePhase.retainedResourceIds, ['shared', 'decoder', 'head']);

await assert.rejects(
  () => controller.transitionToPhase('failing'),
  error => {
    assert.equal(error.workingSetReport.schema, WEBGPU_PHASE_RESOURCE_TRANSITION_SCHEMA);
    assert.equal(error.workingSetReport.status, 'failed');
    assert.equal(error.workingSetReport.fromPhaseId, 'decode');
    assert.equal(error.workingSetReport.toPhaseId, 'failing');
    assert.equal(error.workingSetReport.failedResourceId, 'broken');
    assert.deepEqual(error.workingSetReport.acquiredResourceIds, ['scratch']);
    assert.deepEqual(error.workingSetReport.cleanup.releasedResourceIds, ['scratch']);
    assert.deepEqual(error.workingSetReport.heldResourceIds, ['shared', 'decoder', 'head']);
    return true;
  },
);
assert.equal(controller.snapshot().currentPhaseId, 'decode');
assert.deepEqual(controller.snapshot().heldResourceIds, ['shared', 'decoder', 'head']);
assert.deepEqual(releaseCalls, ['encoder', 'scratch']);

const cancelController = new AbortController();
const cancelingController = createWebGpuPhaseResourceWorkingSet({
  controllerId: 'canceling-working-set-controller',
  plan,
  now: () => ++nowMs,
  async acquireResource({ resource: descriptor }) {
    const lease = leaseFor(descriptor);
    if (descriptor.resourceId === 'cancel') cancelController.abort('cancel-after-acquire');
    return lease;
  },
});
await assert.rejects(
  () => cancelingController.transitionToPhase('canceling', { signal: cancelController.signal }),
  error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.workingSetReport.status, 'canceled');
    assert.equal(error.workingSetReport.failedResourceId, 'cancel');
    assert.deepEqual(error.workingSetReport.acquiredResourceIds, ['shared', 'cancel']);
    assert.deepEqual(error.workingSetReport.cleanup.releasedResourceIds, ['cancel', 'shared']);
    assert.deepEqual(error.workingSetReport.heldResourceIds, []);
    return true;
  },
);
assert.equal(cancelingController.snapshot().currentPhaseId, null);
assert.deepEqual(cancelingController.snapshot().heldResourceIds, []);

const releasesBeforeDiagnostic = releaseCalls.length;
const diagnosticController = createWebGpuPhaseResourceWorkingSet({
  controllerId: 'diagnostic-failure-controller',
  plan,
  residencySnapshot() {
    throw new Error('residency snapshot unavailable');
  },
  async acquireResource({ resource: descriptor }) {
    return leaseFor(descriptor);
  },
});
const diagnosticTransition = await diagnosticController.transitionToPhase('encode');
assert.equal(diagnosticTransition.status, 'prepared');
assert.equal(diagnosticTransition.residency, null);
assert.equal(diagnosticTransition.residencyError.message, 'residency snapshot unavailable');
assert.deepEqual(diagnosticController.snapshot().heldResourceIds, ['encoder', 'shared', 'decoder']);
assert.equal(diagnosticController.snapshot().residency, null);
assert.equal(diagnosticController.snapshot().residencyError.message, 'residency snapshot unavailable');
assert.equal(releaseCalls.length, releasesBeforeDiagnostic, 'diagnostic failure must not release prepared leases');
diagnosticController.close();

const residencyLedger = createWebGpuResourceResidency({ sessionId: 'phase-working-set-residency' });
const residentObjects = new Map();
const residencyController = createWebGpuPhaseResourceWorkingSet({
  controllerId: 'residency-working-set-controller',
  plan,
  residencySnapshot: () => residencyLedger.snapshot(),
  async acquireResource({ resource: descriptor }) {
    let liveResource = residentObjects.get(descriptor.resourceId);
    if (!liveResource) {
      liveResource = { resourceId: descriptor.resourceId };
      residentObjects.set(descriptor.resourceId, liveResource);
    }
    return residencyLedger.acquire({
      resourceId: descriptor.resourceId,
      routeId: 'phase-working-set-route',
      declaredBytes: descriptor.declaredBytes,
      kind: 'model-weight',
      ownership: 'borrowed',
      metadata: descriptor.metadata,
      resource: liveResource,
    });
  },
});
const residentEncode = await residencyController.transitionToPhase('encode');
assert.equal(residentEncode.heldDeclaredBytes, 24);
assert.equal(residentEncode.residency.totalResidentDeclaredBytes, 24);
const residentDecode = await residencyController.transitionToPhase('decode');
assert.equal(residentDecode.heldDeclaredBytes, 32);
assert.equal(residentDecode.residency.totalResidentDeclaredBytes, 40);
assert.deepEqual(
  residentDecode.residency.evictionCandidates.map(candidate => candidate.resourceId),
  ['encoder'],
  'departed resources become caller-visible candidates instead of being evicted automatically',
);
assert.equal(residencyLedger.evict('encoder').status, 'evicted');
assert.equal(residencyLedger.snapshot().totalResidentDeclaredBytes, 32);
residencyController.close();

const releaseFailurePlan = defineWebGpuPhaseResourcePlan({
  planId: 'release-failure-recovery',
  resources: [resource('old-a', 4), resource('old-b', 8), resource('next', 16)],
  phases: [
    { phaseId: 'old', requiredResourceIds: ['old-a', 'old-b'] },
    { phaseId: 'next', requiredResourceIds: ['next'] },
  ],
});
const transitionReleaseAttempts = [];
let failOldBTransitionRelease = true;
const releaseFailureController = createWebGpuPhaseResourceWorkingSet({
  controllerId: 'transition-release-failure-controller',
  plan: releaseFailurePlan,
  async acquireResource({ resource: descriptor }) {
    let released = false;
    return {
      resourceId: descriptor.resourceId,
      release() {
        transitionReleaseAttempts.push(descriptor.resourceId);
        if (descriptor.resourceId === 'old-b' && failOldBTransitionRelease) {
          failOldBTransitionRelease = false;
          throw new Error('old-b release fixture');
        }
        if (released) return { status: 'already-released' };
        released = true;
        return { status: 'released' };
      },
    };
  },
});
await releaseFailureController.transitionToPhase('old');
await assert.rejects(
  () => releaseFailureController.transitionToPhase('next'),
  error => {
    assert.equal(error.workingSetReport.status, 'release-failed');
    assert.deepEqual(error.workingSetReport.releasedResourceIds, ['old-a']);
    assert.deepEqual(error.workingSetReport.cleanup.releasedResourceIds, ['next']);
    assert.deepEqual(error.workingSetReport.heldResourceIds, ['old-b']);
    assert.equal(error.workingSetReport.heldDeclaredBytes, 8);
    return true;
  },
);
assert.equal(releaseFailureController.snapshot().status, 'release-failed');
assert.equal(releaseFailureController.snapshot().currentPhaseId, null);
assert.deepEqual(releaseFailureController.snapshot().heldResourceIds, ['old-b']);
assert.equal(releaseFailureController.snapshot().heldDeclaredBytes, 8);
const transitionRecovery = releaseFailureController.close();
assert.equal(transitionRecovery.status, 'closed');
assert.deepEqual(transitionRecovery.releasedResourceIds, ['old-b']);
assert.deepEqual(releaseFailureController.snapshot().heldResourceIds, []);
assert.deepEqual(transitionReleaseAttempts, ['old-b', 'old-a', 'next', 'old-b']);

const rollbackFailurePlan = defineWebGpuPhaseResourcePlan({
  planId: 'rollback-failure-recovery',
  resources: [resource('temporary', 8), resource('acquire-failure', 16)],
  phases: [{ phaseId: 'failing', requiredResourceIds: ['temporary', 'acquire-failure'] }],
});
let failTemporaryRollback = true;
const rollbackFailureController = createWebGpuPhaseResourceWorkingSet({
  controllerId: 'rollback-release-failure-controller',
  plan: rollbackFailurePlan,
  async acquireResource({ resource: descriptor }) {
    if (descriptor.resourceId === 'acquire-failure') throw new Error('acquisition fixture');
    return {
      resourceId: descriptor.resourceId,
      release() {
        if (failTemporaryRollback) {
          failTemporaryRollback = false;
          throw new Error('temporary rollback release fixture');
        }
        return { status: 'released' };
      },
    };
  },
});
await assert.rejects(
  () => rollbackFailureController.transitionToPhase('failing'),
  error => {
    assert.equal(error.workingSetReport.status, 'failed');
    assert.equal(error.workingSetReport.workingSetStatus, 'release-failed');
    assert.equal(error.workingSetReport.cleanup.status, 'release-failed');
    assert.deepEqual(error.workingSetReport.heldResourceIds, ['temporary']);
    assert.equal(error.workingSetReport.heldDeclaredBytes, 8);
    return true;
  },
);
assert.equal(rollbackFailureController.snapshot().status, 'release-failed');
assert.equal(rollbackFailureController.snapshot().currentPhaseId, null);
assert.deepEqual(rollbackFailureController.snapshot().heldResourceIds, ['temporary']);
assert.equal(rollbackFailureController.close().status, 'closed');

let failMismatchedLeaseCleanup = true;
const mismatchedLeaseController = createWebGpuPhaseResourceWorkingSet({
  controllerId: 'mismatched-lease-controller',
  plan: rollbackFailurePlan,
  async acquireResource({ resource: descriptor }) {
    return {
      resourceId: `foreign-${descriptor.resourceId}`,
      release() {
        if (failMismatchedLeaseCleanup) {
          failMismatchedLeaseCleanup = false;
          throw new Error('foreign lease cleanup fixture');
        }
        return { status: 'released' };
      },
    };
  },
});
await assert.rejects(
  () => mismatchedLeaseController.transitionToPhase('failing'),
  error => {
    assert.match(error.message, /returned lease for foreign-temporary/i);
    assert.equal(error.workingSetReport.workingSetStatus, 'release-failed');
    assert.equal(error.workingSetReport.cleanup.status, 'release-failed');
    assert.deepEqual(error.workingSetReport.heldResourceIds, ['temporary']);
    return true;
  },
);
assert.deepEqual(mismatchedLeaseController.snapshot().heldResourceIds, ['temporary']);
assert.equal(mismatchedLeaseController.close().status, 'closed');

let failOldBCloseRelease = true;
const closeFailureController = createWebGpuPhaseResourceWorkingSet({
  controllerId: 'close-release-failure-controller',
  plan: releaseFailurePlan,
  async acquireResource({ resource: descriptor }) {
    let released = false;
    return {
      resourceId: descriptor.resourceId,
      release() {
        if (descriptor.resourceId === 'old-b' && failOldBCloseRelease) {
          failOldBCloseRelease = false;
          throw new Error('old-b close release fixture');
        }
        if (released) return { status: 'already-released' };
        released = true;
        return { status: 'released' };
      },
    };
  },
});
await closeFailureController.transitionToPhase('old');
const closeFailure = closeFailureController.close();
assert.equal(closeFailure.status, 'close-failed');
assert.deepEqual(closeFailure.releasedResourceIds, ['old-a']);
assert.deepEqual(closeFailure.heldResourceIds, ['old-b']);
assert.equal(closeFailure.heldDeclaredBytes, 8);
assert.equal(closeFailureController.snapshot().status, 'close-failed');
assert.deepEqual(closeFailureController.snapshot().heldResourceIds, ['old-b']);
const closeRecovery = closeFailureController.close();
assert.equal(closeRecovery.status, 'closed');
assert.deepEqual(closeRecovery.releasedResourceIds, ['old-b']);
assert.deepEqual(closeFailureController.snapshot().heldResourceIds, []);

const invalidatedTransitionController = createWebGpuPhaseResourceWorkingSet({
  controllerId: 'invalidated-transition-controller',
  plan: releaseFailurePlan,
  async acquireResource({ resource: descriptor }) {
    return {
      resourceId: descriptor.resourceId,
      release() {
        return {
          status: descriptor.resourceId === 'old-a' ? 'invalidated' : 'released',
        };
      },
    };
  },
});
await invalidatedTransitionController.transitionToPhase('old');
const invalidatedTransition = await invalidatedTransitionController.transitionToPhase('next');
assert.equal(invalidatedTransition.status, 'prepared-after-invalidation');
assert.deepEqual(invalidatedTransition.releasedResourceIds, ['old-b']);
assert.deepEqual(invalidatedTransition.invalidatedResourceIds, ['old-a']);
assert.deepEqual(invalidatedTransition.heldResourceIds, ['next']);
assert.equal(invalidatedTransitionController.snapshot().status, 'active');
assert.equal(invalidatedTransitionController.snapshot().currentPhaseId, 'next');
invalidatedTransitionController.close();

const invalidatedResidency = createWebGpuResourceResidency({ sessionId: 'invalidated-working-set-residency' });
const invalidatedResidencyController = createWebGpuPhaseResourceWorkingSet({
  controllerId: 'invalidated-residency-controller',
  plan: releaseFailurePlan,
  residencySnapshot: () => invalidatedResidency.snapshot(),
  async acquireResource({ resource: descriptor }) {
    return invalidatedResidency.acquire({
      resourceId: descriptor.resourceId,
      routeId: 'invalidated-working-set-route',
      declaredBytes: descriptor.declaredBytes,
      kind: 'model-weight',
      ownership: 'borrowed',
      resource: { resourceId: descriptor.resourceId },
    });
  },
});
await invalidatedResidencyController.transitionToPhase('old');
invalidatedResidency.invalidateAll({ reason: 'device-lost:test' });
const invalidatedClose = invalidatedResidencyController.close();
assert.equal(invalidatedClose.status, 'closed-after-invalidation');
assert.deepEqual(invalidatedClose.releasedResourceIds, []);
assert.deepEqual(invalidatedClose.invalidatedResourceIds, ['old-b', 'old-a']);
assert.deepEqual(invalidatedClose.heldResourceIds, []);
assert.equal(invalidatedClose.residency.status, 'invalidated');
assert.equal(invalidatedClose.residency.activeLeaseCount, 0);
assert.equal(invalidatedResidencyController.snapshot().status, 'closed-after-invalidation');
assert.deepEqual(invalidatedResidencyController.snapshot().heldResourceIds, []);

const gate = deferred();
const concurrencyController = createWebGpuPhaseResourceWorkingSet({
  controllerId: 'concurrent-working-set-controller',
  plan,
  async acquireResource({ resource: descriptor }) {
    await gate.promise;
    return leaseFor(descriptor);
  },
});
const pendingTransition = concurrencyController.transitionToPhase('encode');
await assert.rejects(
  () => concurrencyController.transitionToPhase('decode'),
  /transition.*already.*progress/i,
);
gate.resolve();
await pendingTransition;
concurrencyController.close();

const closeReport = controller.close();
assert.equal(closeReport.status, 'closed');
assert.deepEqual(closeReport.releasedResourceIds, ['head', 'decoder', 'shared']);
assert.equal(controller.snapshot().status, 'closed');
assert.deepEqual(controller.snapshot().heldResourceIds, []);
assert.equal(controller.close().status, 'already-closed');

assert.throws(
  () => createWebGpuPhaseResourceWorkingSet({
    controllerId: 'capped-controller',
    plan,
    maxHeldResources: 2,
    acquireResource() {},
  }),
  /uncapped|maxHeldResources/i,
);

console.log('phase resource working-set contracts passed');
