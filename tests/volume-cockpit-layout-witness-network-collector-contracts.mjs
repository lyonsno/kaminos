import assert from 'node:assert/strict';

import * as witnessContract from '../volume-cockpit-layout-witness-contract.mjs';

assert.equal(
  typeof witnessContract.recordCdpBrowserEvent,
  'function',
  'the browser-event collector must be independently executable',
);

const browserEvents = [];
const networkRequestUrls = new Map();
const collect = message => witnessContract.recordCdpBrowserEvent({
  message,
  browserEvents,
  networkRequestUrls,
  phase: 'network-collector-contract',
});

collect({
  method: 'Network.requestWillBeSent',
  params: {
    requestId: 'unrelated-request',
    request: { url: 'http://127.0.0.1:18421/unrelated-resource' },
  },
});
collect({
  method: 'Network.loadingFailed',
  params: {
    requestId: 'unrelated-request',
    errorText: 'net::ERR_CONNECTION_REFUSED',
    canceled: false,
  },
});

assert.equal(browserEvents.length, 1, 'an unrelated Network.loadingFailed event was filtered before audit');
assert.equal(browserEvents[0].witnessRequestUrl, 'http://127.0.0.1:18421/unrelated-resource');
assert.equal(browserEvents[0].witnessSequence, 0);
assert.equal(browserEvents[0].witnessPhase, 'network-collector-contract');
assert.equal(browserEvents[0].params.errorText, 'net::ERR_CONNECTION_REFUSED');

collect({
  method: 'Network.loadingFailed',
  params: {
    requestId: 'missing-correlation',
    errorText: 'net::ERR_ABORTED',
    canceled: true,
  },
});
assert.equal(browserEvents.length, 2, 'a loading failure without URL correlation was silently dropped');
assert.equal(browserEvents[1].witnessRequestUrl, null);

console.log('volume cockpit layout witness network collector contracts passed');
