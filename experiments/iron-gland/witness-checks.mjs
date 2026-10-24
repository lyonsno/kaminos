import assert from 'node:assert/strict';

export function missObserved(state) {
  if (state.error) throw Error(state.error);
  return state.frameCount > 0 && !state.interaction.visible && state.lastAcquisition?.source === 'no_detection';
}

export function verifyFrame(state, { after = 0, threshold }) {
  assert.equal(state.identity?.routeId, 'kaminos.browser-hand-mesh.webgpu-local.v0');
  assert.equal(state.identity?.backend, 'webgpu-local');
  assert.equal(state.running, true);
  assert.equal(state.error, null);
  assert.ok(state.frameCount > after, 'a new inference result must be presented');
  assert.equal(state.cameraVisible, true);
  assert.equal(state.interaction.visible, true);
  assert.ok(state.interaction.anchor.every(Number.isFinite));
  assert.ok(Number.isFinite(state.interaction.span) && state.interaction.span > 0);
  assert.equal(state.threshold, threshold);
  assert.equal(state.lastAcquisition?.threshold, threshold);
  assert.equal(state.lastAcquisition?.source, 'wilor_yolo_detector_bbox_only');
  assert.equal(state.lastAcquisition?.fallback, false);
  assert.ok(state.imageSize.every(v => Number.isInteger(v) && v > 0));
}
