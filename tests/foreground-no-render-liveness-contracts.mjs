import assert from 'node:assert/strict';
import * as volumeCore from '../volume-core.js';

assert.equal(
  typeof volumeCore.waitForForegroundNoRenderOpportunity,
  'function',
  'no-render foreground service must expose a directly testable rAF-suspension liveness primitive',
);

const waitForOpportunity = volumeCore.waitForForegroundNoRenderOpportunity;

function controlledOpportunity({
  visibilityState = 'visible',
  hiddenDocumentPolicy = 'non-present-fallback',
} = {}) {
  let currentVisibilityState = visibilityState;
  let rafCallback = null;
  let fallbackCallback = null;
  let visibilityCallback = null;
  const canceled = { raf: [], fallback: [] };
  let nowMs = 100;
  const promise = waitForOpportunity({
    hiddenDocumentPolicy,
    fallbackDelayMs: 250,
    requestFrame(callback) {
      rafCallback = callback;
      return 11;
    },
    cancelFrame(handle) {
      canceled.raf.push(handle);
    },
    scheduleFallback(callback, delayMs) {
      assert.equal(delayMs, 250);
      fallbackCallback = callback;
      return 22;
    },
    cancelFallback(handle) {
      canceled.fallback.push(handle);
    },
    readVisibilityState() {
      return currentVisibilityState;
    },
    subscribeVisibilityChange(callback) {
      visibilityCallback = callback;
      return () => {
        visibilityCallback = null;
      };
    },
    now() {
      return nowMs;
    },
  });
  return {
    promise,
    canceled,
    fireRaf(timestampMs = 116.67) {
      assert.equal(typeof rafCallback, 'function');
      rafCallback(timestampMs);
    },
    fireFallback(nextNowMs = 350) {
      assert.equal(typeof fallbackCallback, 'function');
      nowMs = nextNowMs;
      fallbackCallback();
    },
    setVisibility(nextVisibilityState, nextNowMs) {
      currentVisibilityState = nextVisibilityState;
      nowMs = nextNowMs;
      visibilityCallback?.();
    },
    get rafArmed() {
      return typeof rafCallback === 'function';
    },
    get fallbackArmed() {
      return typeof fallbackCallback === 'function';
    },
  };
}

{
  const controlled = controlledOpportunity();
  controlled.fireRaf();
  const receipt = await controlled.promise;
  assert.deepEqual(
    {
      serviceMode: receipt.serviceMode,
      serviceAuthority: receipt.serviceAuthority,
      presentationObserved: receipt.presentationObserved,
      rafTimestampMs: receipt.rafTimestampMs,
      visibilityStateAtRequest: receipt.visibilityStateAtRequest,
      visibilityStateAtService: receipt.visibilityStateAtService,
    },
    {
      serviceMode: 'presented-raf',
      serviceAuthority: 'browser-request-animation-frame',
      presentationObserved: true,
      rafTimestampMs: 116.67,
      visibilityStateAtRequest: 'visible',
      visibilityStateAtService: 'visible',
    },
  );
  assert.deepEqual(controlled.canceled.fallback, [22]);
}

{
  const controlled = controlledOpportunity();
  controlled.fireFallback();
  const receipt = await controlled.promise;
  assert.equal(receipt.serviceMode, 'non-present-fallback');
  assert.equal(receipt.serviceAuthority, 'browser-task-fallback-no-presentation');
  assert.equal(receipt.presentationObserved, false);
  assert.equal(receipt.rafTimestampMs, null);
  assert.equal(receipt.fallbackReason, 'raf-suspended-or-delayed');
  assert.equal(receipt.fallbackDelayMs, 250);
  assert.deepEqual(controlled.canceled.raf, [11]);
}

{
  const controlled = controlledOpportunity({
    visibilityState: 'hidden',
    hiddenDocumentPolicy: 'pause-until-visible',
  });
  assert.equal(controlled.rafArmed, false);
  assert.equal(controlled.fallbackArmed, false);
  controlled.setVisibility('visible', 600);
  assert.equal(controlled.rafArmed, true);
  assert.equal(controlled.fallbackArmed, true);
  controlled.fireRaf(616.67);
  const receipt = await controlled.promise;
  assert.equal(receipt.serviceMode, 'presented-raf');
  assert.equal(receipt.visibilityPause.status, 'resumed');
  assert.equal(receipt.visibilityPause.pausedAtMs, 100);
  assert.equal(receipt.visibilityPause.resumedAtMs, 600);
}

{
  const controller = new AbortController();
  let canceledRaf = null;
  let canceledFallback = null;
  const promise = waitForOpportunity({
    signal: controller.signal,
    requestFrame() {
      return 31;
    },
    cancelFrame(handle) {
      canceledRaf = handle;
    },
    scheduleFallback() {
      return 32;
    },
    cancelFallback(handle) {
      canceledFallback = handle;
    },
    readVisibilityState: () => 'visible',
    subscribeVisibilityChange: () => () => {},
  });
  controller.abort(new Error('operator stopped firing'));
  await assert.rejects(promise, /operator stopped firing|aborted/i);
  assert.equal(canceledRaf, 31);
  assert.equal(canceledFallback, 32);
}

{
  let canceledRaf = null;
  await assert.rejects(
    waitForOpportunity({
      requestFrame() {
        return 41;
      },
      cancelFrame(handle) {
        canceledRaf = handle;
      },
      scheduleFallback() {
        throw new Error('fallback scheduler unavailable');
      },
      cancelFallback() {},
      readVisibilityState: () => 'visible',
      subscribeVisibilityChange: () => () => {},
    }),
    /fallback scheduler unavailable/,
  );
  assert.equal(
    canceledRaf,
    41,
    'arming failure must not leave an outstanding browser frame callback',
  );
}

console.log('foreground no-render liveness contracts passed');
