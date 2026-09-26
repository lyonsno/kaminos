import assert from 'node:assert/strict';
import { assertEffectiveSceneCollision } from './volume-scene-solid.mjs';

const NATIVE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const PRESET_AUTHORITY = 'shared-volume-settings-preset-v2';
const IMAGE_AUTHORITY = 'gpu-presentation-texture-rgba8-readback-frozen-sim-state';

export function admitFrameOnlySource(route, receipt, state, servingSource, expectedSource) {
  const parsedRoute = new URL(route);
  const params = parsedRoute.searchParams;
  const sceneHash = new URLSearchParams(parsedRoute.hash.slice(1));
  if (sceneHash.has('scene')) {
    assert.equal(sceneHash.get('authoring'), '1', 'authored scene route was not mounted');
  }
  const requestedCollision = sceneHash.get('volume_collision');
  assert.ok(requestedCollision === null || requestedCollision === 'kiln',
    'unsupported scene collision route');
  if (requestedCollision === 'kiln') {
    assert.ok(sceneHash.has('scene'), 'kiln collision lacks an authored scene route');
    assertEffectiveSceneCollision(state?.sceneCollision, 'kiln');
  }
  const requested = params.get('settings_preset');
  assert.match(requested || '', /^vsp-[0-9a-f]{64}$/, 'frame-only capture requires an immutable saved preset');
  assert.equal(params.get('settings_preset_authority'), PRESET_AUTHORITY, 'preset route authority mismatch');
  assert.equal(receipt?.presetId, requested, 'requested/effective preset mismatch');
  assert.equal(receipt?.contentHash, `sha256:${requested.slice(4)}`, 'preset content identity mismatch');
  assert.equal(receipt?.sourcePresetAuthority, PRESET_AUTHORITY, 'preset receipt authority mismatch');
  assert.equal(state?.active, true, 'volume route inactive');
  assert.equal(state?.effectiveRoute, NATIVE_ROUTE, 'native GPU route not effective');
  assert.match(state?.backend || '', /^WebGPU:/, 'native WebGPU backend not effective');
  assert.ok(Number.isInteger(state?.simStepCount) && state.simStepCount > 0, 'simulation has not advanced');
  assert.equal(servingSource?.repoRoot, expectedSource?.repoRoot, 'serving checkout mismatch');
  assert.equal(servingSource?.commit, expectedSource?.commit, 'serving source revision mismatch');
  assert.equal(servingSource?.dirty, false, 'serving source is dirty');
  return { requestedPresetId: requested, presetId: receipt.presetId, contentHash: receipt.contentHash,
    sourcePresetAuthority: receipt.sourcePresetAuthority, effectiveRoute: state.effectiveRoute,
    backend: state.backend, initialSimStepCount: state.simStepCount, servingSource,
    sceneFile: sceneHash.get('scene') || null,
    sceneCollision: requestedCollision === 'kiln' ? state.sceneCollision : null };
}

export function verifyFrameOnlyReadback(capture, sample, expectedSimStepCount) {
  assert.equal(capture?.ok, true, 'frozen canvas capture failed');
  assert.equal(capture.imageAuthority, IMAGE_AUTHORITY, 'GPU image authority mismatch');
  const image = capture.image;
  assert.equal(image?.authority, IMAGE_AUTHORITY, 'GPU readback authority mismatch');
  assert.ok(Number.isInteger(image?.width) && image.width > 1, 'GPU image width missing');
  assert.ok(Number.isInteger(image?.height) && image.height > 1, 'GPU image height missing');
  assert.equal(image.width, capture.renderWidth, 'GPU image/render width mismatch');
  assert.equal(image.height, capture.renderHeight, 'GPU image/render height mismatch');
  assert.equal(image.width, sample.renderWidth, 'GPU image/sample width mismatch');
  assert.equal(image.height, sample.renderHeight, 'GPU image/sample height mismatch');
  assert.equal(capture.simStepCount, expectedSimStepCount, 'GPU image stale simulation step');
  assert.equal(capture.sameStateCaptureId, sample.sameStateCaptureId, 'GPU image state identity mismatch');
  const bytes = Buffer.from(image.rgbaBase64 || '', 'base64');
  assert.equal(bytes.length, image.width * image.height * 4, 'GPU image partial bytes');
  assert.equal(image.byteLength, bytes.length, 'GPU image declared byte length mismatch');
  let visibleColorPixelCount = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    if (Math.max(bytes[offset], bytes[offset + 1], bytes[offset + 2]) >= 8) visibleColorPixelCount += 1;
  }
  const minimumVisiblePixels = Math.max(2, Math.ceil(image.width * image.height * 0.001));
  assert.ok(visibleColorPixelCount >= minimumVisiblePixels,
    `GPU image has insufficient visible color support: ${visibleColorPixelCount}/${minimumVisiblePixels}`);
  return { bytes, visibleColorPixelCount, minimumVisiblePixels };
}
