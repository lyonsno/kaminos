import assert from 'node:assert/strict';

import {
  TerminalWitnessError,
  auditBrowserEvents,
} from '../volume-cockpit-layout-witness-contract.mjs';

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

const preOutage = blockedStoreEvent(10, 'named-layout-selection-persistence', 'pre-outage');
const intendedOutage = blockedStoreEvent(11, 'layout-store-outage-isolation', 'intended-outage');
const postOutage = blockedStoreEvent(12, 'layout-store-degraded-control-isolation', 'post-outage');

const admitted = auditBrowserEvents([intendedOutage], {
  allowedExpectedLayoutStoreBlockSequences: [11],
});
assert.equal(admitted.allowedExpectedFailureCount, 1);
assert.deepEqual(
  admitted.allowed.map(event => ({ sequence: event.sequence, phase: event.phase })),
  [{ sequence: 11, phase: 'layout-store-outage-isolation' }],
  'the admitted outage stimulus must retain its exact event sequence and witness phase',
);

assert.throws(
  () => auditBrowserEvents([preOutage, intendedOutage], {
    allowedExpectedLayoutStoreBlockSequences: [11],
  }),
  error => error instanceof TerminalWitnessError && /pre-outage/.test(error.message),
  'an identical blocked-store error before the declared outage slice must remain terminal',
);
assert.throws(
  () => auditBrowserEvents([intendedOutage, postOutage], {
    allowedExpectedLayoutStoreBlockSequences: [11],
  }),
  error => error instanceof TerminalWitnessError && /post-outage/.test(error.message),
  'an identical blocked-store error after the declared outage slice must remain terminal',
);

console.log('volume cockpit layout witness outage slice contracts passed');
