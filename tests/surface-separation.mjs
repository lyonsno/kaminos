// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  surfacePoint, surfaceCoordinates, clampSurfacePoint, rectangleBetween, handlePoint,
  moveCorner, surfacePatch, materialBands, inspectSeparation, nearestHinge,
} from '../surface-separation.mjs';

const plane = { kind: 'plane', width: 4, height: 2 };
const curve = { ...plane, kind: 'cylinder', radius: 3 };
const patch = [-1, -.7, .8, .7];
const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `${x} differs from ${y}`);

test('planar and curved charts round-trip while preserving arc length and crease ownership', () => {
  for (const surface of [plane, curve]) {
    const start = [-1.6, .3];
    const [u, v] = surfaceCoordinates(surface, surfacePoint(surface, start));
    near(u, start[0]);
    near(v, start[1]);
    assert.deepEqual(clampSurfacePoint(surface, [-5, 10]), [-2, 1]);
  }
  const [x, , z] = surfacePoint(curve, [1.5, .2]);
  near(Math.hypot(x, z + curve.radius), curve.radius);
  near(Math.atan2(x, z + curve.radius) * curve.radius, 1.5);
  assert.equal(surfaceCoordinates(curve, [0, 0, -6]), null, 'Back side cannot wrap onto the front');
});

test('drag direction is free during creation, then each corner retains its opposite anchor', () => {
  assert.deepEqual(rectangleBetween([.8, -.7], [-1, .7]), patch);
  for (let corner = 0; corner < 4; corner++) {
    const opposite = (corner + 2) % 4;
    const result = moveCorner(patch, corner, handlePoint(patch, opposite));
    assert.deepEqual(handlePoint(result, opposite), handlePoint(patch, opposite));
    assert.ok(result[0] < result[2] && result[1] < result[3]);
  }
});

test('surface shading follows curvature and clips out missing front material', () => {
  const gap = [-.3, -.2, .4, .5];
  const bands = materialBands(patch, gap);
  const area = ([a, b, c, d]) => (c - a) * (d - b);
  near(bands.reduce((total, band) => total + area(band), 0), area(patch) - area(gap));
  const vertices = surfacePatch(curve, patch);
  for (let i = 0; i < vertices.length; i += 3) {
    near(Math.hypot(vertices[i], vertices[i + 2] + curve.radius), curve.radius);
  }
});

test('depth witnesses distinguish an obstruction from a face opening and liftable shell', () => {
  const scene = { ...plane, thickness: .18, brace: [-.3, -1, .3, 1], cuttable: true };
  assert.equal(inspectSeparation(scene, patch), 'brace');
  assert.equal(inspectSeparation(scene, [-1.8, -.5, -.31, .5]), 'through');
  assert.equal(inspectSeparation({ ...plane, gap: scene.brace }, patch), 'cavity');
  assert.equal(inspectSeparation(plane, patch), 'footprint');
  assert.equal(inspectSeparation(scene, [-2, -.5, -1, .5]), 'rim');
});

test('nearest edge is continuous on a side, has corner hysteresis, and excludes curved hinge axes', () => {
  assert.equal(nearestHinge(plane, patch, [-.97, .65]), 3);
  assert.equal(nearestHinge(plane, patch, [-.99, .64], 2), 2);
  assert.equal(nearestHinge(curve, patch, [0, -.69]), 1);
  assert.equal(nearestHinge(curve, patch, [-.97, .65]), 3);
});

test('hinge handle travels along its selected side without changing the axis', async () => {
  const {hingeFraction} = await import('../surface-separation.mjs');
  near(hingeFraction(patch, 2, [.35, .66]), .25);
  near(hingeFraction(patch, 2, [-.55, .73]), .75);
  near(hingeFraction(patch, 2, [-3, .73]), 1);
});


test('thick flush patches hit the far rim before clearing the shell', async () => {
  const {flatSwingLimit} = await import('../surface-separation.mjs');
  const angle = flatSwingLimit(.55, .13, .008);
  assert.ok(angle > 0 && angle < .15);
  near((.55 - .008) * Math.cos(angle) + .13 * Math.sin(angle), .55);
  assert.equal(flatSwingLimit(1.3, .13, .008), null);
});
