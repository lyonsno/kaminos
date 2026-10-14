// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VANTAGE_SCHEMA, vantageCameraId, poseLookingAt, poseAxes, movedPose, turnedPose, orbitPose,
  framingDistance, framePose, objectsInView, resolveTarget, checkedCommand,
} from '../agent-vantage-core.mjs';

const near = (actual, expected, epsilon = 1e-6, message = '') => {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) <= epsilon, `${message} [${i}] ${value} != ${expected[i]}`));
};

test('a pilot owns one stable camera identity and rejects unsafe names', () => {
  assert.equal(VANTAGE_SCHEMA, 'kaminos.agent-vantage.v1');
  assert.equal(vantageCameraId('bebop'), 'vantage-bebop');
  assert.equal(vantageCameraId(), 'vantage-bebop');
  assert.throws(() => vantageCameraId('Bad Pilot!'), /pilot/i);
});

test('a camera pose looks down its local -Z axis at the requested target', () => {
  const ahead = poseLookingAt([0, 0, 5], [0, 0, 0]);
  near(poseAxes(ahead).forward, [0, 0, -1]);
  near(ahead.rotation, [0, 0, 0]);
  near(ahead.scale, [1, 1, 1]);
  near(poseAxes(poseLookingAt([3, 0, 0], [0, 0, 0])).forward, [-1, 0, 0]);
  const down = poseLookingAt([0, 5, 0], [0, 0, 0]);
  near(poseAxes(down).forward, [0, -1, 0], 1e-6, 'looking straight down keeps a finite orientation');
  assert.ok(down.rotation.every(Number.isFinite));
  assert.throws(() => poseLookingAt([1, 1, 1], [1, 1, 1]), /target/i);
});

test('moves swim forward along the view, strafe along local right and rise along world up', () => {
  const pose = poseLookingAt([0, 0, 5], [0, 0, 0]);
  near(movedPose(pose, { forward: 2 }).position, [0, 0, 3]);
  near(movedPose(pose, { right: 1 }).position, [1, 0, 5]);
  near(movedPose(pose, { up: 1 }).position, [0, 1, 5]);
  near(movedPose(pose, { forward: 2 }).rotation, pose.rotation, 1e-9, 'moving keeps the heading');
});

test('turns yaw about world up and pitch about the local right axis', () => {
  const pose = poseLookingAt([0, 0, 5], [0, 0, 0]);
  near(poseAxes(turnedPose(pose, { yaw: 90 })).forward, [-1, 0, 0], 1e-6, 'positive yaw turns left');
  const pitched = poseAxes(turnedPose(pose, { pitch: 30 })).forward;
  near(pitched, [0, Math.sin(Math.PI / 6), -Math.cos(Math.PI / 6)], 1e-6, 'positive pitch raises the nose');
  near(turnedPose(pose, { yaw: 45 }).position, [0, 0, 5]);
});

test('orbit places the sub on a sphere around the target and looks back at it', () => {
  const front = orbitPose([0, 1, 0], { radius: 4, azimuth: 0, elevation: 0 });
  near(front.position, [0, 1, 4]);
  near(poseAxes(front).forward, [0, 0, -1]);
  const side = orbitPose([0, 1, 0], { radius: 4, azimuth: 90, elevation: 0 });
  near(side.position, [4, 1, 0]);
  near(poseAxes(side).forward, [-1, 0, 0]);
  const above = orbitPose([0, 0, 0], { radius: 2, azimuth: 0, elevation: 90 });
  near(above.position, [0, 2, 0], 1e-6);
  assert.ok(above.rotation.every(Number.isFinite));
  assert.throws(() => orbitPose([0, 0, 0], { radius: 0 }), /radius/i);
});

test('framing distance fits a sphere inside the narrower field of view', () => {
  assert.ok(Math.abs(framingDistance(1, { vfovDeg: 60, aspect: 1, margin: 1 }) - 2) < 1e-9);
  const portrait = framingDistance(1, { vfovDeg: 60, aspect: 0.5, margin: 1 });
  assert.ok(portrait > 2, 'a narrow frame backs further away');
  const framed = framePose({ min: [-1, -1, -1], max: [1, 1, 1] }, { direction: [0, 0, -1], vfovDeg: 60, aspect: 1, margin: 1 });
  near(framed.position, [0, 0, 2 * Math.sqrt(3)], 1e-6);
  near(poseAxes(framed).forward, [0, 0, -1]);
});

test('objects in view report image rectangles, distance and bearing without claiming occlusion', () => {
  const view = { position: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0], fov: 60, near: 0.1, far: 100 };
  const objects = [
    { id: 'far-right', label: 'Far right', type: 'mesh', bounds: { min: [19.5, -0.5, -0.5], max: [20.5, 0.5, 0.5] } },
    { id: 'behind', label: 'Behind', type: 'mesh', bounds: { min: [-0.5, -0.5, 9.5], max: [0.5, 0.5, 10.5] } },
    { id: 'centre', label: 'Centre box', type: 'mesh', bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] } },
    { id: 'self', label: 'Bebop', type: 'camera', bounds: { min: [-0.1, -0.1, 4.9], max: [0.1, 0.1, 5.1] } },
  ];
  const result = objectsInView(view, 1, objects, { excludeIds: ['self'] });
  assert.deepEqual(result.inView.map(o => o.id), ['centre']);
  const centre = result.inView[0];
  near(centre.center, [0.5, 0.5], 1e-6);
  assert.ok(centre.rect[0] < 0.5 && centre.rect[2] > 0.5 && centre.rect[1] < 0.5 && centre.rect[3] > 0.5);
  assert.ok(Math.abs(centre.distance - 5) < 1e-6);
  assert.equal(centre.partial, false);
  const byId = Object.fromEntries(result.outOfView.map(o => [o.id, o]));
  assert.ok(Math.abs(byId['far-right'].bearing.right - Math.atan2(20, 5) * 180 / Math.PI) < 1e-3, 'bearings are rounded to 1e-4 degrees');
  assert.ok(Math.abs(Math.abs(byId.behind.bearing.right) - 180) < 1e-6, 'directly behind');
  assert.equal(result.occlusion, 'not-tested');
  assert.ok(!result.outOfView.some(o => o.id === 'self'));
});

test('targets resolve by id, label, unique substring, selection, or explicit point', () => {
  const objects = [
    { id: 'burner-1', label: 'Annular burner', type: 'procedural-mesh', bounds: { min: [-1, 0, -1], max: [1, 0.2, 1] } },
    { id: 'baffle-a', label: 'Baffle', type: 'procedural-mesh', bounds: { min: [2, 0, 0], max: [3, 1, 0.1] } },
    { id: 'baffle-b', label: 'Baffle copy', type: 'procedural-mesh', bounds: { min: [4, 0, 0], max: [5, 1, 0.1] } },
  ];
  near(resolveTarget('burner-1', { objects }).center, [0, 0.1, 0]);
  assert.equal(resolveTarget('annular BURNER', { objects }).id, 'burner-1');
  assert.equal(resolveTarget('burn', { objects }).id, 'burner-1');
  assert.equal(resolveTarget('Baffle', { objects }).id, 'baffle-a', 'an exact label wins over a longer label');
  assert.throws(() => resolveTarget('baf', { objects }), /Baffle.*Baffle copy|ambiguous/i);
  assert.throws(() => resolveTarget('kettle', { objects }), /kettle/);
  const selection = resolveTarget('selection', { objects, selection: ['baffle-a', 'baffle-b'] });
  near(selection.bounds.min, [2, 0, 0]);
  near(selection.bounds.max, [5, 1, 0.1]);
  assert.throws(() => resolveTarget('selection', { objects, selection: [] }), /nothing is selected/i);
  near(resolveTarget([1, 2, 3], { objects }).center, [1, 2, 3]);
  assert.equal(resolveTarget([1, 2, 3], { objects }).bounds, null);
});

test('commands are validated before they reach the page', () => {
  assert.deepEqual(checkedCommand({ command: 'move', args: { forward: 1 } }), { command: 'move', args: { pilot: 'bebop', forward: 1, right: 0, up: 0 } });
  assert.throws(() => checkedCommand({ command: 'teleport-everyone', args: {} }), /Unknown vantage command/);
  assert.throws(() => checkedCommand({ command: 'move', args: { forward: Infinity } }), /finite/);
  assert.throws(() => checkedCommand({ command: 'goto', args: { position: [1, 2] } }), /position/);
  const snap = checkedCommand({ command: 'snap', args: {} });
  assert.equal(snap.args.pilot, 'bebop');
  assert.equal(snap.args.annotate, false);
  assert.ok(Number.isInteger(snap.args.settle) && snap.args.settle >= 1);
  assert.throws(() => checkedCommand({ command: 'burst', args: { count: 0 } }), /count/);
});
