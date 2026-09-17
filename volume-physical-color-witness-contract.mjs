import assert from 'node:assert/strict';

// Optional exact control-isolation relation, never an artistic completion test.
// Caller has already checked effective route, frozen state and complete RGBA.
export function assertArmEquivalent(arm, rgba, earlier) {
  if (arm.equalTo === undefined) return;
  assert.equal(typeof arm.equalTo,'string','equalTo must name a prior arm');
  assert.ok(earlier.has(arm.equalTo),`prior arm missing: ${arm.equalTo}`);
  assert.ok(rgba.equals(earlier.get(arm.equalTo)),`raw RGBA differs: ${arm.id} != ${arm.equalTo}`);
}
