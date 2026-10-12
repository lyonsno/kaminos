import assert from 'node:assert/strict';
import {createFixture, createTracker, diagnostics, field, boneField} from '../muscle-support-assay-core.mjs';

const fixture = createFixture({rings: 25, sides: 24});
const neutral = {quaternion: [0, 0, 0, 1], bulge: 0};
assert.equal(fixture.positions.length, 25 * 24 * 3);
assert.ok([...fixture.positions].every(Number.isFinite));
assert.equal(fixture.restValues.length, 25 * 24);
assert.ok(fixture.restValues.every(value => value > 0));
assert.throws(() => field([0, 0, 0], {quaternion: [0, 0, 0, 0], bulge: 0}), /quaternion/);
const angle = Math.PI / 3;
const twist = {quaternion: [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)], bulge: 0};
const point = [1.1, 0.3, 0.1];
// A round distal bone's occupancy is unchanged by axial rotation. A field
// alone therefore cannot determine which way a material marker should travel.
assert.ok(Math.abs(boneField(point, neutral) - boneField(point, twist)) < 1e-12);
const tracked = createTracker(fixture, 'transport-field');
const stationary = createTracker(fixture, 'field-only');
tracked.step(twist);
stationary.step(twist);
const distal = fixture.positions.length - 3;
const delta = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
assert.ok(delta([...tracked.positions.slice(distal, distal + 3)], [...fixture.positions.slice(distal, distal + 3)]) > 0.1);
assert.ok(delta([...stationary.positions.slice(distal, distal + 3)], [...fixture.positions.slice(distal, distal + 3)]) < 1e-8);
const swelling = {quaternion: neutral.quaternion, bulge: 0.35};
const support = createTracker(fixture, 'transport-field');
const bones = createTracker(fixture, 'bone-blend');
support.step(swelling);
bones.step(swelling);
assert.ok(diagnostics(fixture, support.positions, swelling).fieldErrorMax < 0.005);
assert.ok(diagnostics(fixture, bones.positions, swelling).fieldErrorMax > 0.04);
assert.throws(() => createTracker(fixture, 'made-up'), /mode/);
assert.throws(() => support.step({quaternion: neutral.quaternion, bulge: NaN}), /bulge/);
console.log('support assay contracts passed: finite fixture, explicit invalid inputs, occupancy/transport distinction, support response');
