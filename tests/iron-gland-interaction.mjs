// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../experiments/iron-gland/interaction.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const hand = ({ pinch = 0.6, x = 0, side = 'right' } = {}) => {
  const uv = new Float32Array(42).fill(0.5);
  for (const [joint, u, v] of [[0, .5, .8], [5, .3, .5], [9, .5, .4], [17, .7, .5], [4, .4, .25], [8, .4 + pinch * .4, .25]]) {
    uv[joint * 2] = u + x; uv[joint * 2 + 1] = v;
  }
  return { hasHand: true, handedness: side, cropUV: uv, cropBox: [100, 40, 300, 240], acquisition: { fallback: false } };
};
test('camera crop landmarks become image-relative points, mirrored once', () => {
  assert.equal(typeof api.handObservation, 'function', 'the hovering consumer needs a crop-to-camera observation');
  const a = api.handObservation(hand(), { width: 640, height: 480, mirror: false });
  const b = api.handObservation(hand(), { width: 640, height: 480, mirror: true });
  assert.ok(Math.abs(a.wrist[0] - 200 / 640) < 1e-6);
  assert.ok(Math.abs(a.wrist[1] - 200 / 480) < 1e-6);
  assert.ok(Math.abs(a.wrist[0] + b.wrist[0] - 1) < 1e-6);
  assert.ok(Math.abs(a.pinchRatio - 0.6) < 1e-6);
  assert.ok(Math.abs(a.pinchRatio - b.pinchRatio) < 1e-6);
});
test('misses, fallback and degenerate predictions never drive a mechanism', () => {
  assert.equal(typeof api.handObservation, 'function');
  const config = { width: 640, height: 480 };
  assert.equal(api.handObservation({ hasHand: false }, config), null);
  assert.equal(api.handObservation({ ...hand(), acquisition: { fallback: true } }, config), null);
  assert.equal(api.handObservation({ ...hand(), cropUV: new Float32Array(42).fill(.5) }, config), null);
  const bad = hand(); bad.cropUV[0] = NaN;
  assert.equal(api.handObservation(bad, config), null);
  assert.throws(() => api.handObservation(hand(), { width: 0, height: 480 }), /dimensions/);
});
test('pinch hysteresis, held rotation, release, loss and reacquisition', () => {
  assert.equal(typeof api.createHoverController, 'function', 'the hovering consumer needs a gesture controller');
  const c = api.createHoverController();
  const observe = options => api.handObservation(hand(options), { width: 640, height: 480 });
  assert.equal(c.update(observe({ pinch: .6 }), .1).mode, 'hover');
  const grabbed = c.update(observe({ pinch: .2 }), .1);
  assert.equal(grabbed.mode, 'grab');
  assert.equal(c.update(observe({ pinch: .32 }), .1).mode, 'grab');
  const moved = c.update(observe({ pinch: .2, x: .2 }), .1);
  assert.ok(Math.abs(moved.rotation[1] - grabbed.rotation[1]) > .3);
  const released = c.update(observe({ pinch: .6, x: .2 }), .1);
  assert.equal(released.mode, 'hover');
  assert.deepEqual(released.rotation, moved.rotation);
  assert.equal(c.update(null, .1).visible, false);
  const reacquired = c.update(observe({ pinch: .2 }), .1);
  assert.equal(reacquired.mode, 'hover', 'reacquisition while already pinched must wait for an open hand');
  c.update(observe({ pinch: .6 }), .1);
  assert.equal(c.update(observe({ pinch: .2 }), .1).mode, 'grab');
});
test('handedness changes reset the pinch latch and output reads are detached', () => {
  assert.equal(typeof api.createHoverController, 'function');
  const c = api.createHoverController();
  const observe = options => api.handObservation(hand(options), { width: 640, height: 480 });
  c.update(observe({}), .1); c.update(observe({ pinch: .2 }), .1);
  assert.equal(c.update(observe({ pinch: .2, side: 'left' }), .1).mode, 'hover');
  const s = c.read(); s.rotation[0] = 999;
  assert.notEqual(c.read().rotation[0], 999);
});
