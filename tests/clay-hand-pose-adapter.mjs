import assert from 'node:assert/strict';
import { normalizeClayHandPoseColliders } from '../clay-core.js';

const nowMs = 10_000;
const keypoints3d = Array.from({ length: 21 }, (_, i) => [
  -0.24 + i * 0.024,
  -0.66 + i * 0.013,
  -0.04 + i * 0.004,
]);

const fresh = normalizeClayHandPoseColliders({
  requestedBackend: 'mlx',
  effectiveBackend: 'wilor-mlx',
  evidenceKind: 'captured',
  coordinateSpace: 'volume-local',
  timestampMs: nowMs - 40,
  frameId: 'mlx-clay-frame-7',
  hands: [{ hand_side: 'right', confidence: 0.93, keypoints_3d: keypoints3d, radius: 0.18, strength: 1.2 }],
}, nowMs);

assert.equal(fresh.mode, 'hand_pose:wilor-mlx');
assert.equal(fresh.coordinateSpace, 'volume-local');
assert.equal(fresh.requestedHandPoseBackend, 'mlx');
assert.equal(fresh.effectiveHandPoseBackend, 'wilor-mlx');
assert.equal(fresh.handPoseEvidenceKind, 'captured');
assert.equal(fresh.handPoseStale, false);
assert.equal(fresh.handPoseFrameId, 'mlx-clay-frame-7');
assert.equal(fresh.handPoseHandCount, 1);
assert.equal(fresh.handPoseColliderCount, 5);
assert.equal(fresh.colliders.length, 5);
assert.equal(fresh.colliders[0].id, 'hand-right-tip-4');
assert.deepEqual(fresh.handPoseAdapterWarnings, []);
assert.ok(fresh.colliders.every(collider => collider.source === 'hand_pose:wilor-mlx'));
assert.ok(fresh.colliders.every(collider => collider.strength > 0));
assert.ok(fresh.colliders.every(collider => collider.radius >= 0.06));

const stale = normalizeClayHandPoseColliders({
  requestedBackend: 'mlx',
  effectiveBackend: 'wilor-mlx',
  evidenceKind: 'live',
  coordinateSpace: 'volume-local',
  timestampMs: nowMs - 1_000,
  frameId: 'mlx-clay-stale',
  hands: [{ keypoints_3d: keypoints3d }],
}, nowMs);

assert.equal(stale.handPoseStale, true);
assert.equal(stale.handPoseHandCount, 1);
assert.equal(stale.handPoseColliderCount, 0);
assert.equal(stale.colliders.length, 0);
assert.ok(stale.handPoseAdapterWarnings.includes('stale-live-hand-pose-frame'));

const palmDaddyKeypoints = Array.from({ length: 21 }, (_, i) => [
  -0.35 + i * 0.035,
  i % 2 === 0 ? 0.82 : -0.36,
  -0.24 + i * 0.018,
]);

const palmDaddyLive = normalizeClayHandPoseColliders({
  requestedBackend: 'mlx',
  effectiveBackend: 'native_wilor_mini_mlx_detector_sidecar_live',
  evidenceKind: 'live',
  coordinateSpace: 'clay-local',
  timestampMs: nowMs - 40,
  frameId: '1781568700752211000-20989',
  source_backend: 'native_wilor_mini_mlx_detector_sidecar_live',
  sample_age_ms: 40,
  sample_authority: 0.45,
  hands: [{ hand_side: 'right', confidence: 0.94, keypoints_3d: palmDaddyKeypoints, radius: 0.17875, strength: 0.761 }],
}, nowMs);

assert.equal(palmDaddyLive.effectiveHandPoseBackend, 'native_wilor_mini_mlx_detector_sidecar_live');
assert.equal(palmDaddyLive.handPoseEvidenceKind, 'live');
assert.equal(palmDaddyLive.sourceBackend, 'native_wilor_mini_mlx_detector_sidecar_live');
assert.equal(palmDaddyLive.sampleAuthority, 0.45);
assert.equal(palmDaddyLive.handPosePressureContract, 'clay_local_y_axis_drives_fingertip_pressure');
assert.deepEqual(palmDaddyLive.handPoseAdapterWarnings, []);
assert.ok(palmDaddyLive.colliders.some(collider => collider.pressureAxis > 0.8), 'clay-local Y pressure axis was not preserved');
assert.ok(palmDaddyLive.colliders.some(collider => collider.strength > 0.761), 'clay-local Y pressure did not amplify fingertip strength');

const visualOnly = normalizeClayHandPoseColliders({
  requestedBackend: 'mlx',
  effectiveBackend: 'native_wilor_mini_mlx_detector_sidecar_live',
  evidenceKind: 'stale_visual_only',
  coordinateSpace: 'clay-local',
  timestampMs: nowMs - 1_400,
  frameId: '1293',
  source_backend: 'native_wilor_mini_mlx_detector_sidecar_live',
  sample_age_ms: 1_400,
  sample_authority: 0.35,
  hands: [{ hand_side: 'right', keypoints_3d: palmDaddyKeypoints, radius: 0.264, strength: 1.0825 }],
}, nowMs);

assert.equal(visualOnly.handPoseEvidenceKind, 'stale_visual_only');
assert.equal(visualOnly.handPoseVisualOnly, true);
assert.equal(visualOnly.handPoseStale, false);
assert.equal(visualOnly.sampleAuthority, 0.35);
assert.equal(visualOnly.handPoseColliderCount, 5);
assert.equal(visualOnly.colliders.length, 5);
assert.deepEqual(visualOnly.handPoseAdapterWarnings, []);
