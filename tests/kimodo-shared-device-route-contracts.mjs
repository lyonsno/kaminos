import assert from 'node:assert/strict';

const { mountKaminosSharedDeviceComposition } = await import('../kimodo-shared-device-route.mjs');

const events = [];
const state = {
  active: false,
  ordinaryForeground: { mode: 'private-animation-loop' },
};
const prototype = {
  async setActive(active) {
    events.push(`active:${active}`);
    state.active = active;
  },
  debugState() { return structuredClone(state); },
};
const host = {
  snapshot() { return { foregroundServiceActive: state.ordinaryForeground.mode === 'producer-foreground-opportunities' }; },
};
const compositionModule = {
  async mountComposition() {
    events.push('mount');
    assert.equal(state.active, true, 'the real route activates the volume before mounting the persistent service');
    state.ordinaryForeground.mode = 'producer-foreground-opportunities';
    return { loadHandlerInstalled: true, foregroundConnected: true };
  },
};

const receipt = await mountKaminosSharedDeviceComposition({
  compositionModule,
  prototype,
  params: new URLSearchParams('kaminos_volume_smoke=1'),
  sharedGpu: { device: {}, queue: {} },
  host,
});
assert.deepEqual(events, ['active:true', 'mount']);
assert.equal(receipt.status, 'mounted');
assert.equal(receipt.active, true);
assert.equal(receipt.foregroundMode, 'producer-foreground-opportunities');
assert.equal(receipt.loadHandlerInstalled, true);

await assert.rejects(
  () => mountKaminosSharedDeviceComposition({
    compositionModule: { async mountComposition() { return { loadHandlerInstalled: false, foregroundConnected: false }; } },
    prototype: {
      async setActive() {},
      debugState() { return { active: true, ordinaryForeground: { mode: 'private-animation-loop' } }; },
    },
    params: new URLSearchParams(),
    sharedGpu: { device: {}, queue: {} },
    host: { snapshot: () => ({ foregroundServiceActive: false }) },
  }),
  /did not transfer frame ownership/,
  'partial mount cannot be promoted merely because the device receipt exists',
);

console.log('Kimodo shared-device real-route lifecycle contracts passed');
