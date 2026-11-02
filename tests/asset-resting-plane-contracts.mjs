import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import { chooseLevelingPlane, findRestingPlanes, levelingWorldDelta, normalizeArrivalLeveling, snapGroundWorldDelta } from '../asset-resting-plane.mjs';
const { Matrix4, Vector3 } = THREE;

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

test('Snap Ground with a selected basePlane levels an arbitrarily tilted object onto that face', () => {
  const tilt = new Matrix4().makeRotationX(65 * Math.PI / 180).premultiply(new Matrix4().makeTranslation(0.4, 1.1, -0.3));
  const tilted = transformed(chairPoints(), tilt);
  assert.equal(snapGroundWorldDelta({ points: tilted, groundY: -0.85 }).choice.reason, 'no-obvious-base');
  const legCorners = transformed([-0.4, 0, -0.4, 0.4, 0, -0.4, 0.4, 0, 0.4, -0.4, 0, 0.4], tilt);
  const normal = new Vector3(0, -1, 0).transformDirection(tilt).toArray();
  const center = new Vector3(0, 0, 0).applyMatrix4(tilt).toArray();
  const { delta, choice } = snapGroundWorldDelta({
    points: tilted,
    groundY: -0.85,
    basePlane: { normal, center, points: legCorners, faceCount: 2 },
  });
  assert.equal(choice.reason, 'selected-face');
  assert.equal(choice.plane.faceCount, 2);
  assert.ok(Math.abs(choice.plane.tiltDeg - 65) < 1e-6);
  const leveled = transformed(tilted, delta);
  const leveledLegs = transformed(legCorners, delta);
  assert.equal(chooseLevelingPlane(findRestingPlanes(leveled)).reason, 'already-level');
  for (let i = 1; i < leveledLegs.length; i += 3) {
    assert.ok(Math.abs(leveledLegs[i] + 0.85) < 1e-6, `selected base vertex rests on groundY: ${leveledLegs[i]}`);
  }
});

test('Snap Ground with a selected basePlane uses the selected polygon as the snap point on groundY', () => {
  // Mesh with a selected base polygon at y=0 in local space, plus a lower bulge at y=-0.3.
  const baseFace = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 0, 0.5];
  const withBulge = [...baseFace, 0, -0.3, 0, 0, 1.0, 0];
  const tilt = new Matrix4().makeRotationZ(120 * Math.PI / 180).premultiply(new Matrix4().makeTranslation(0, 2, 0));
  const tilted = transformed(withBulge, tilt);
  const tiltedBase = transformed(baseFace, tilt);
  const normal = new Vector3(0, -1, 0).transformDirection(tilt).toArray();
  const center = new Vector3(0, 0, -1 / 6).applyMatrix4(tilt).toArray();
  const { delta, choice } = snapGroundWorldDelta({
    points: tilted,
    groundY: -0.5,
    basePlane: { normal, center, points: tiltedBase, faceCount: 1 },
  });
  assert.equal(choice.reason, 'selected-face');
  const snappedBase = transformed(tiltedBase, delta);
  for (let i = 1; i < snappedBase.length; i += 3) {
    assert.ok(Math.abs(snappedBase[i] + 0.5) < 1e-6, `selected face vertex sits at groundY (-0.5), got ${snappedBase[i]}`);
  }
  assert.throws(() => snapGroundWorldDelta({ points: tilted, groundY: 0, basePlane: { normal: [0, 0, 0], center: [0, 0, 0] } }), /normal/i);
});

test('saved arrival leveling is restored only when well formed', () => {
  const valid = { storedQuaternion: [0.0868, 0, 0, 0.9962], leveledQuaternion: [0, 0, 0, 1], tiltDeg: 9.9 };
  assert.deepEqual(normalizeArrivalLeveling(valid), valid);
  for (const bad of [undefined, null, {}, { ...valid, tiltDeg: 'x' }, { ...valid, storedQuaternion: [0, 0, 1] }, { ...valid, leveledQuaternion: [0, 0, 0, 0] }, { ...valid, storedQuaternion: [NaN, 0, 0, 1] }]) {
    assert.equal(normalizeArrivalLeveling(bad), null, JSON.stringify(bad));
  }
});

test('index.html snapToGround and snapFaceToGround route selected Edit Mode faces and arm one-click face picking', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('window.snapToGround = function');
  const end = html.indexOf('// Export the selection', start);
  assert.ok(start >= 0 && end > start);
  const object = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  object.add(mesh);
  object.rotation.x = 65 * Math.PI / 180;
  object.position.set(0, 1.5, 0);
  object.updateMatrixWorld(true);
  const faceCorners = transformed([-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5], object.matrixWorld);
  const normal = new Vector3(0, -1, 0).transformDirection(object.matrixWorld).toArray();
  const center = new Vector3(0, -0.5, 0).applyMatrix4(object.matrixWorld).toArray();
  let selectedPlane = { normal, center, tiltDeg: 65, faceCount: 2, points: faceCorners };
  let armed = 0;
  const infos = [];
  let committed = null;
  const ctx = {
    THREE,
    window: {},
    currentMesh: object,
    groundPlane: { position: { y: -0.85 } },
    polyEdit: {
      active: () => true,
      api: {
        selectedFacePlane: () => selectedPlane,
        armFaceSnap: () => { armed++; return true; },
      },
    },
    sceneObjectWorldGeometry: () => ({ points: faceCorners, triangles: [0, 1, 2, 0, 2, 3] }),
    snapGroundWorldDelta,
    toolbarPoseFromWorld(target, world) {
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      world.decompose(p, q, s);
      const r = new THREE.Euler().setFromQuaternion(q, target.rotation.order);
      return { position: p.toArray(), rotation: [r.x, r.y, r.z], scale: s.toArray() };
    },
    commitToolbarPose(target, pose) {
      committed = pose;
      target.position.fromArray(pose.position);
      target.rotation.set(...pose.rotation);
      target.scale.fromArray(pose.scale);
      return true;
    },
    syncLevelingButton() {},
    setInfo(msg) { infos.push(msg); },
  };
  vm.runInNewContext(html.slice(start, end), ctx);
  assert.equal(typeof ctx.window.snapFaceToGround, 'function', 'snapFaceToGround is defined');
  ctx.window.snapToGround();
  assert.ok(committed, 'pose was committed');
  assert.match(infos.at(-1), /Snapped 2 selected faces \(65\.0°\) to ground/);
  const afterCorners = transformed([-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5], object.matrixWorld);
  for (let i = 1; i < afterCorners.length; i += 3) {
    assert.ok(Math.abs(afterCorners[i] + 0.85) < 1e-6, `selected face rests at groundY (-0.85): ${afterCorners[i]}`);
  }
  selectedPlane = null;
  ctx.window.snapFaceToGround();
  assert.equal(armed, 1, 'with no face selected, snapFaceToGround arms one-click face picking');
});
