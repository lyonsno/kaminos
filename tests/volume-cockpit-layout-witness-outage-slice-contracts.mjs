import assert from 'node:assert/strict';

import {
  TerminalWitnessError,
  auditBrowserEvents,
} from '../volume-cockpit-layout-witness-contract.mjs';

const expectedStoreUrl = 'http://example.test/api/volume-cockpit-layouts';

function blockedStoreEvent(sequence, phase, label) {
  return {
    witnessSequence: sequence,
    witnessPhase: phase,
    method: 'Log.entryAdded',
    params: {
      entry: {
        level: 'error',
        text: `${label}: Failed to load resource: net::ERR_BLOCKED_BY_CLIENT`,
        url: 'http://example.test/api/volume-cockpit-layouts',
      },
    },
  };
}

function blockedStoreNetworkEvent(sequence, phase) {
  return {
    witnessSequence: sequence,
    witnessPhase: phase,
    witnessRequestUrl: 'http://example.test/api/volume-cockpit-layouts',
    method: 'Network.loadingFailed',
    params: {
      requestId: 'blocked-layout-store-request',
      type: 'Fetch',
      errorText: 'net::ERR_BLOCKED_BY_CLIENT',
      blockedReason: 'inspector',
      canceled: false,
    },
  };
}

const preOutage = blockedStoreEvent(10, 'named-layout-selection-persistence', 'pre-outage');
const intendedOutage = blockedStoreEvent(11, 'layout-store-outage-isolation', 'intended-outage');
const postOutage = blockedStoreEvent(12, 'layout-store-degraded-control-isolation', 'post-outage');
const liveChromeOutage = blockedStoreNetworkEvent(13, 'layout-store-outage-isolation');

const admitted = auditBrowserEvents([intendedOutage], {
  allowedExpectedLayoutStoreBlockSequences: [11],
  expectedStoreUrl,
});
assert.equal(admitted.allowedExpectedFailureCount, 1);
assert.deepEqual(
  admitted.allowed.map(event => ({ sequence: event.sequence, phase: event.phase })),
  [{ sequence: 11, phase: 'layout-store-outage-isolation' }],
  'the admitted outage stimulus must retain its exact event sequence and witness phase',
);
assert.equal(
  auditBrowserEvents([liveChromeOutage], {
    allowedExpectedLayoutStoreBlockSequences: [13],
    expectedStoreUrl,
  }).allowedExpectedFailureCount,
  1,
  'the exact Chrome Network.loadingFailed form is an admissible store-block stimulus only inside the declared outage slice',
);

assert.throws(
  () => auditBrowserEvents([preOutage, intendedOutage], {
    allowedExpectedLayoutStoreBlockSequences: [11],
    expectedStoreUrl,
  }),
  error => error instanceof TerminalWitnessError && /pre-outage/.test(error.message),
  'an identical blocked-store error before the declared outage slice must remain terminal',
);
assert.throws(
  () => auditBrowserEvents([intendedOutage, postOutage], {
    allowedExpectedLayoutStoreBlockSequences: [11],
    expectedStoreUrl,
  }),
  error => error instanceof TerminalWitnessError && /post-outage/.test(error.message),
  'an identical blocked-store error after the declared outage slice must remain terminal',
);

for (const [label, url] of [
  ['different origin', 'http://other.test/api/volume-cockpit-layouts'],
  ['suffix route', 'http://example.test/api/volume-cockpit-layouts-unrelated'],
  ['child route', 'http://example.test/api/volume-cockpit-layouts/child'],
  ['query-bearing substitute', 'http://example.test/api/volume-cockpit-layouts?alternate=1'],
  ['missing correlated URL', null],
]) {
  const event = {
    ...liveChromeOutage,
    witnessRequestUrl: url,
  };
  assert.throws(
    () => auditBrowserEvents([event], {
      allowedExpectedLayoutStoreBlockSequences: [13],
      expectedStoreUrl,
    }),
    TerminalWitnessError,
    `${label} must not impersonate the exact intended layout-store outage`,
  );
}

console.log('volume cockpit layout witness outage slice contracts passed');
