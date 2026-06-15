import assert from 'node:assert/strict';
import { normalizeHandPoseEmitters } from '../volume-core.js';

const nowMs = 10_000;
const keypoints3d = Array.from({ length: 21 }, (_, i) => [
  -0.2 + i * 0.02,
  -0.7 + i * 0.015,
  -0.05 + i * 0.004,
]);

const fresh = normalizeHandPoseEmitters({
  requestedBackend: 'mlx',
  effectiveBackend: 'wilor-mlx',
  evidenceKind: 'live',
  coordinateSpace: 'volume-local',
  timestampMs: nowMs - 40,
  frameId: 'mlx-frame-7',
  hands: [{ hand_side: 'right', confidence: 0.93, keypoints_3d: keypoints3d }],
}, nowMs);

assert.equal(fresh.mode, 'hand_pose:wilor-mlx');
assert.equal(fresh.coordinateSpace, 'volume-local');
assert.equal(fresh.requestedHandPoseBackend, 'mlx');
assert.equal(fresh.effectiveHandPoseBackend, 'wilor-mlx');
assert.equal(fresh.handPoseEvidenceKind, 'live');
assert.equal(fresh.handPoseStale, false);
assert.equal(fresh.handPoseFrameId, 'mlx-frame-7');
assert.equal(fresh.handPoseHandCount, 1);
assert.equal(fresh.handPoseSegmentCount, 5);
assert.equal(fresh.count, 5);
assert.deepEqual(fresh.handPoseAdapterWarnings, []);

const stale = normalizeHandPoseEmitters({
  requestedBackend: 'mlx',
  effectiveBackend: 'wilor-mlx',
  evidenceKind: 'live',
  coordinateSpace: 'volume-local',
  timestampMs: nowMs - 1_000,
  frameId: 'mlx-frame-stale',
  hands: [{ keypoints_3d: keypoints3d }],
}, nowMs);

assert.equal(stale.handPoseStale, true);
assert.ok(stale.handPoseAdapterWarnings.includes('stale-live-hand-pose-frame'));
assert.equal(stale.handPoseHandCount, 1);
assert.equal(stale.handPoseSegmentCount, 0);
assert.equal(stale.count, 0);
