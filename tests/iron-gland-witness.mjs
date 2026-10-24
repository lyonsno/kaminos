// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../experiments/iron-gland/witness-checks.mjs').catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  return {};
});
const frame = () => ({ identity: { routeId: 'kaminos.browser-hand-mesh.webgpu-local.v0', backend: 'webgpu-local' },
  running: true, error: null, frameCount: 3, cameraVisible: true, interaction: { visible: true, anchor: [.5, .5], span: .2 },
  threshold: .18, lastAcquisition: { source: 'wilor_yolo_detector_bbox_only', fallback: false, threshold: .18 },
  imageSize: [640, 480] });
test('witness requires fresh real-route detections with effective options', () => {
  assert.equal(typeof api.verifyFrame, 'function');
  assert.doesNotThrow(() => api.verifyFrame(frame(), { after: 2, threshold: .18 }));
  for (const patch of [{ identity: null }, { frameCount: 2 }, { cameraVisible: false },
    { identity: { routeId: 'mock', backend: 'cpu' } }, { error: 'lost' }, { threshold: .8 },
    { interaction: { visible: true, anchor: [NaN, .5], span: .2 } },
    { lastAcquisition: { source: 'manual_crop_fallback_no_detection', fallback: true, threshold: .18 } }]) {
    assert.throws(() => api.verifyFrame({ ...frame(), ...patch }, { after: 2, threshold: .18 }));
  }
});
