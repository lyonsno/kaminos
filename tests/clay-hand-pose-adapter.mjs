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
