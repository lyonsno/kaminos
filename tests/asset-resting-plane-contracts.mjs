import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from '../lib/three.core.js';
import { chooseLevelingPlane, findRestingPlanes, levelingWorldDelta, normalizeArrivalLeveling, snapGroundWorldDelta } from '../asset-resting-plane.mjs';

// A chair-like cloud: four thin legs under a seat, back rising at the rear.
function chairPoints() {
  const points = [];
  const box = (x0, x1, y0, y1, z0, z1, n = 4) => {
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) for (let k = 0; k <= n; k++) {
      points.push(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * j / n, z0 + (z1 - z0) * k / n);
    }
  };
  for (const x of [-0.4, 0.35]) for (const z of [-0.4, 0.35]) box(x, x + 0.05, 0, 0.45, z, z + 0.05);
  box(-0.4, 0.4, 0.45, 0.5, -0.4, 0.4);
  box(-0.4, 0.4, 0.5, 1.2, -0.4, -0.35);
  return points;
}

function transformed(points, matrix) {
  const out = [], v = new Vector3();
  for (let i = 0; i < points.length; i += 3) out.push(...v.fromArray(points, i).applyMatrix4(matrix).toArray());
  return out;
}

const lowestY = points => Math.min(...points.filter((_, i) => i % 3 === 1));

test('a chair standing level is left alone', () => {
  assert.equal(chooseLevelingPlane(findRestingPlanes(chairPoints())).reason, 'already-level');
});

test('a chair tilted ten degrees is stood back up on its legs and grounded', () => {
  const tilt = new Matrix4().makeRotationX(10 * Math.PI / 180).premultiply(new Matrix4().makeTranslation(0.3, 0.7, -0.2));
  const tilted = transformed(chairPoints(), tilt);
  const analysis = findRestingPlanes(tilted);
  const choice = chooseLevelingPlane(analysis);
  assert.equal(choice.reason, 'level');
  assert.ok(Math.abs(choice.plane.tiltDeg - 10) < 0.5, `chose the leg plane: ${choice.plane.tiltDeg}`);
  const leveled = transformed(tilted, levelingWorldDelta({ plane: choice.plane, hullPoints: analysis.hullPoints, groundY: -0.85 }));
  assert.equal(chooseLevelingPlane(findRestingPlanes(leveled)).reason, 'already-level');
  assert.ok(Math.abs(lowestY(leveled) + 0.85) < 1e-9, 'resting on the ground');
});

// Leveling finds a flat base, not "upright": a chair lying flat on its side is
// already resting level and stays that way.
test('a chair lying flat on its side is left on its side', () => {
  const onItsSide = transformed(chairPoints(), new Matrix4().makeRotationZ(Math.PI / 2));
  assert.equal(chooseLevelingPlane(findRestingPlanes(onItsSide)).reason, 'already-level');
});

test('a round object with no flat base is not rotated', () => {
  const points = [];
  for (let i = 0; i < 400; i++) {
    const y = 1 - 2 * (i + 0.5) / 400, r = Math.sqrt(1 - y * y), a = i * 2.399963;
    points.push(r * Math.cos(a), y, r * Math.sin(a));
  }
  assert.equal(chooseLevelingPlane(findRestingPlanes(points)).reason, 'no-obvious-base');
});

test('geometry that cannot form a hull yields no resting analysis instead of throwing', () => {
  assert.equal(findRestingPlanes([0, 2, 0, 1, 2, 0, 0, 2, 1]), null, 'a single triangle');
  assert.equal(findRestingPlanes([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]), null, 'collinear points');
});

test('Snap Ground still grounds geometry with no usable hull', () => {
  for (const points of [[0, 2, 0, 1, 2, 0, 0, 2, 1], [0, 3, 0, 1, 3, 0, 2, 3, 0, 3, 3, 0]]) {
    const { delta, choice } = snapGroundWorldDelta({ points, groundY: -0.85 });
    assert.equal(choice.reason, 'no-geometry');
    assert.ok(Math.abs(lowestY(transformed(points, delta)) + 0.85) < 1e-9, 'lowest point rests on the ground');
  }
});

test('Snap Ground levels a tilted chair and grounds it through the same entry point', () => {
  const tilted = transformed(chairPoints(), new Matrix4().makeRotationX(10 * Math.PI / 180));
  const { delta, choice } = snapGroundWorldDelta({ points: tilted, groundY: 0 });
  assert.equal(choice.reason, 'level');
  const leveled = transformed(tilted, delta);
  assert.equal(chooseLevelingPlane(findRestingPlanes(leveled)).reason, 'already-level');
  assert.ok(Math.abs(lowestY(leveled)) < 1e-9);
});

test('saved arrival leveling is restored only when well formed', () => {
  const valid = { storedQuaternion: [0.0868, 0, 0, 0.9962], leveledQuaternion: [0, 0, 0, 1], tiltDeg: 9.9 };
  assert.deepEqual(normalizeArrivalLeveling(valid), valid);
  for (const bad of [undefined, null, {}, { ...valid, tiltDeg: 'x' }, { ...valid, storedQuaternion: [0, 0, 1] }, { ...valid, leveledQuaternion: [0, 0, 0, 0] }, { ...valid, storedQuaternion: [NaN, 0, 0, 1] }]) {
    assert.equal(normalizeArrivalLeveling(bad), null, JSON.stringify(bad));
  }
});
