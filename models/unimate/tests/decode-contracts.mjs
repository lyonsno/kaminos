// The JS decode must reproduce UniMate's upstream recover_unimate_joint_pos_from_rot
// on retained features: same world joint positions from the same skeleton.
// Fixture (generated motion, kept out of the repository): export-decode-fixture.py,
// path in UNIMATE_DECODE_FIXTURE. Without it the test reports SKIPPED and exits 3.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeUniMateMotion, groundedOffsets } from '../unimate-decode.js';

const fixturePath = process.env.UNIMATE_DECODE_FIXTURE;
if (!fixturePath || !fs.existsSync(fixturePath)) {
  console.log(`decode contracts: SKIPPED (UNIMATE_DECODE_FIXTURE=${fixturePath ?? ''} not present)`);
  process.exit(3);
}
const fx = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const J = fx.parents.length;

// Offsets: grounded rest pose -> parent-relative, cast to float32.
const offsets = groundedOffsets(fx.tpos_first_frame, fx.parents);
let maxOffsetDiff = 0;
fx.offsets.forEach((row, j) => row.forEach((v, c) => { maxOffsetDiff = Math.max(maxOffsetDiff, Math.abs(offsets[j * 3 + c] - v)); }));
assert.equal(maxOffsetDiff, 0, `offsets differ by ${maxOffsetDiff}`);

for (const clip of fx.clips) {
  const [T, Jc, D] = clip.shape;
  assert.equal(Jc, J);
  assert.equal(D, 12);
  const out = decodeUniMateMotion({ features: Float32Array.from(clip.features), frames: T, parents: fx.parents, offsets });
  assert.equal(out.positions.length, T * J * 3);
  let maxErr = 0, maxRef = 0;
  clip.positions.forEach((v, i) => { maxErr = Math.max(maxErr, Math.abs(out.positions[i] - v)); maxRef = Math.max(maxRef, Math.abs(v)); });
  assert.ok(maxErr <= 1e-5, `${clip.source}: world positions max abs diff ${maxErr} (reference abs max ${maxRef})`);
  // Local rotations are unit quaternions with w >= 0, one per frame and joint.
  for (let i = 0; i < T * J; i++) {
    const q = out.localRotations.subarray(i * 4, i * 4 + 4);
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-9 && q[0] >= 0, `rotation ${i} not a canonical unit quaternion`);
  }
  console.log(`${clip.source.split('/').pop()}: ${T} frames, ${J} joints, max abs diff ${maxErr.toExponential(2)} (reference abs max ${maxRef.toFixed(3)})`);
}
console.log('decode contracts: pass');
