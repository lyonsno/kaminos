// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VANTAGE_SCHEMA, vantageCameraId, poseLookingAt, poseAxes, movedPose, turnedPose, orbitPose,
  framingDistance, framePose, objectsInView, objectsInProjection, viewChange, resolveTarget, checkedCommand,
} from '../agent-vantage-core.mjs';
import * as core from '../agent-vantage-core.mjs';
import {PerspectiveCamera, Matrix4, Vector3, Vector4, WebGPUCoordinateSystem, WebGLCoordinateSystem} from '../lib/three.core.js';

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

// The scene camera frame zoom/offset transform from index.html's camera-view projection.
function framedCamera({width, height, frame}) {
  const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(0, 1, 3); camera.lookAt(new Vector3(0, 1, 0)); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  const clip = new Matrix4().set(frame.width / width, 0, 0, 2 * (frame.x + frame.width / 2) / width - 1,
    0, frame.height / height, 0, 1 - 2 * (frame.y + frame.height / 2) / height, 0, 0, 1, 0, 0, 0, 0, 1);
  camera.projectionMatrix.premultiply(clip);
  return camera;
}

test('naming from the effective projection follows a zoomed and panned camera frame', () => {
  const width = 1600, height = 900, frame = {x: 0.12 * width + 120, y: -0.08 * height + 107, width: 1156, height: 650};
  const camera = framedCamera({width, height, frame});
  const objects = [{id: 'probe', label: 'Probe', type: 'mesh', bounds: {min: [0.95, 0.95, -0.05], max: [1.05, 1.05, 0.05]}}];
  const result = objectsInProjection({projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray(), near: 0.1}, objects);
  const ndc = new Vector3(1, 1, 0).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  near(result.inView[0].center, [(ndc.x + 1) / 2, (1 - ndc.y) / 2], 1e-4, 'the reported centre is where the rendered picture puts the object');
  assert.equal(result.occlusion, 'not-tested');
});

test('a view change counts roll and lens, not only position and heading', () => {
  const view = {position: [0, 1, 3], target: [0, 1, 0], up: [0, 1, 0], fov: 50, near: 0.1, far: 100};
  assert.equal(viewChange(view, structuredClone(view)).changed, false);
  const rolled = viewChange(view, {...view, up: [1, 0, 0]});
  assert.equal(rolled.changed, true);
  assert.ok(rolled.roll > 80);
  const zoomed = viewChange(view, {...view, fov: 110});
  assert.equal(zoomed.changed, true);
  assert.ok(Math.abs(zoomed.fov - 60) < 1e-9);
  assert.equal(viewChange(view, {...view, near: 0.5}).changed, true, 'clipping changes what is pictured');
  assert.equal(viewChange(view, {...view, position: [0, 1, 3.0005]}).changed, false, 'sub-millimetre drift is not a change');
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

test('naming uses the renderer clipping convention, so a near-clipped object is not in view', () => {
  const camera = new PerspectiveCamera(50, 1, 1, 100);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const optics = {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray(), near: 1, coordinateSystem: WebGPUCoordinateSystem};
  const objects = [
    {id: 'clipped', label: 'Clipped', type: 'mesh', bounds: {min: [-0.05, -0.05, -0.8], max: [0.05, 0.05, -0.7]}},
    {id: 'straddling', label: 'Straddling', type: 'mesh', bounds: {min: [-0.05, -0.05, -1.2], max: [0.05, 0.05, -0.5]}},
    {id: 'ahead', label: 'Ahead', type: 'mesh', bounds: {min: [-0.5, -0.5, -5.5], max: [0.5, 0.5, -4.5]}},
  ];
  const result = objectsInProjection(optics, objects);
  assert.deepEqual(result.inView.map(object => object.id).sort(), ['ahead', 'straddling']);
  assert.ok(result.outOfView.some(object => object.id === 'clipped'), 'wholly inside the near plane is not pictured');
  assert.equal(result.inView.find(object => object.id === 'straddling').partial, true);
});

test('the scene map lays out a three-quarter view with both cameras and their cones', async () => {
  const {sketchMapLayout, SKETCH_SCHEMA} = await import('../agent-vantage-core.mjs');
  const sketch = {
    schema: SKETCH_SCHEMA,
    objects: [
      {id: 'left', label: 'Left box', type: 'procedural-mesh', bounds: {min: [-3, 0, -0.5], max: [-2, 1, 0.5]}},
      {id: 'right', label: 'Right box', type: 'procedural-mesh', bounds: {min: [2, 0, -0.5], max: [3, 1, 0.5]}},
      {id: 'tall', label: 'Tall box', type: 'procedural-mesh', bounds: {min: [-0.25, 0, -0.25], max: [0.25, 4, 0.25]}},
    ],
    fields: [{id: 'flame-field', label: 'Fire & smoke', type: 'simulation-domain', bounds: {min: [-1, 0, -1], max: [1, 4, 1]}}],
    operator: {view: {position: [0, 1.5, 6], target: [0, 1, 0], up: [0, 1, 0], fov: 40, near: 0.1, far: 100}, aspect: 16 / 9},
    subs: [{pilot: 'bebop', label: 'Bebop', view: {position: [4, 1, 2], target: [2.5, 0.5, 0], up: [0, 1, 0], fov: 60, near: 0.05, far: 100}}],
  };
  const layout = sketchMapLayout(sketch, {width: 320, height: 240});
  const points = [...layout.boxes.flatMap(box => box.polygon), ...layout.cones.flatMap(cone => cone.polygon)];
  assert.ok(points.every(([x, y]) => x >= -1e-6 && x <= 320 + 1e-6 && y >= -1e-6 && y <= 240 + 1e-6), 'everything fits the map');
  const [sub] = layout.cones.filter(cone => cone.kind === 'sub'), [operator] = layout.cones.filter(cone => cone.kind === 'operator');
  near(sub.apex, layout.project([4, 1, 2]), 1e-9, 'the sub cone starts at the sub');
  near(operator.apex, layout.project([0, 1.5, 6]), 1e-9, 'the operator cone starts at the operator camera');
  assert.equal(sub.label, 'Bebop');
  const box = id => layout.boxes.find(item => item.id === id);
  assert.ok(box('right').center[0] > box('left').center[0], '+X reads to the right');
  assert.ok(layout.project([0, 4, 0])[1] < layout.project([0, 0, 0])[1], 'up reads up');
  assert.equal(box('flame-field').kind, 'field');
  assert.deepEqual(layout.boxes.map(item => item.depth), [...layout.boxes.map(item => item.depth)].sort((a, b) => a - b), 'boxes are painted back to front');
  assert.ok(layout.scaleBar.pixels > 0 && layout.scaleBar.meters > 0);
  const empty = sketchMapLayout({...sketch, objects: [], fields: []}, {width: 160, height: 120});
  assert.equal(empty.cones.length, 2, 'an empty scene still shows where both cameras are');
});

// Each cone edge from the apex must follow the ray through that viewport corner,
// with one shared length. Checked in the map's own 2D projection.
function coneFollows(layout, cone, rays, apex) {
  const origin = layout.project(apex), lengths = [];
  cone.edges.slice(0, 4).forEach((edge, i) => {
    const drawn = [edge[2] - edge[0], edge[3] - edge[1]];
    const tip = layout.project(apex.map((value, axis) => value + rays[i][axis]));
    const expected = [tip[0] - origin[0], tip[1] - origin[1]];
    const cross = drawn[0] * expected[1] - drawn[1] * expected[0], dot = drawn[0] * expected[0] + drawn[1] * expected[1];
    assert.ok(Math.abs(cross) <= 1e-6 * Math.hypot(...drawn) * Math.hypot(...expected) && dot > 0, `corner ${i} points along its ray`);
    lengths.push(Math.hypot(...drawn) / Math.hypot(...expected));
  });
  lengths.forEach(length => assert.ok(Math.abs(length - lengths[0]) <= 1e-6 * lengths[0], 'every corner at the same depth'));
}
// The world ray through each viewport corner (lower left first, counterclockwise), at unit depth.
function cornerRays(camera) {
  const inverse = camera.projectionMatrix.clone().invert(), forward = camera.getWorldDirection(new Vector3());
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
    const ray = new Vector3(x, y, 0.5).applyMatrix4(inverse).applyMatrix4(camera.matrixWorld).sub(camera.position);
    return ray.multiplyScalar(1 / ray.dot(forward)).toArray();
  });
}

test('the map draws the operator cone from the matrices the viewport renders with', async () => {
  const {sketchMapLayout} = await import('../agent-vantage-core.mjs');
  const camera = new PerspectiveCamera(45.747, 16 / 9, 0.1, 100);
  camera.position.set(2, 1.5, 6); camera.lookAt(0, 0.5, 0); camera.updateMatrixWorld(true);
  // In scene-camera mode index.html applies the camera frame's zoom and offset to the projection.
  camera.projectionMatrix.premultiply(new Matrix4().set(0.6, 0, 0, 0.12, 0, 0.9, 0, -0.08, 0, 0, 1, 0, 0, 0, 0, 1));
  const view = {position: camera.position.toArray(), target: [0, 0.5, 0], up: [0, 1, 0], fov: camera.fov, near: 0.1, far: 100};
  const optics = {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray()};
  const sketch = {objects: [{id: 'box', label: 'Box', type: 'mesh', bounds: {min: [-1, 0, -1], max: [1, 1, 1]}}], fields: [],
    operator: {view, aspect: 814 / 858, optics}, subs: []};
  const layout = sketchMapLayout(sketch);
  coneFollows(layout, layout.cones[0], cornerRays(camera), camera.position.toArray());
  // Control: without a frame, the matrices and the nominal lens describe the same cone.
  const plain = new PerspectiveCamera(40, 16 / 9, 0.1, 100);
  plain.position.set(2, 1.5, 6); plain.lookAt(0, 0.5, 0); plain.updateMatrixWorld(true);
  const nominal = sketchMapLayout({...sketch, operator: {view: {...view, fov: 40}, aspect: 16 / 9}});
  coneFollows(nominal, nominal.cones[0], cornerRays(plain), plain.position.toArray());
});

test('a very large scene lays out its map without running out of call stack', async () => {
  const {sketchMapLayout} = await import('../agent-vantage-core.mjs');
  const objects = Array.from({length: 20000}, (_, i) => ({id: String(i), label: String(i), type: 'mesh',
    bounds: {min: [i % 100, 0, Math.floor(i / 100)], max: [i % 100 + 1, 1, Math.floor(i / 100) + 1]}}));
  const layout = sketchMapLayout({objects, fields: [], subs: [],
    operator: {view: {position: [50, 20, 260], target: [50, 0, 100], up: [0, 1, 0], fov: 40, near: 0.1, far: 1000}, aspect: 16 / 9}});
  assert.equal(layout.boxes.length, 20000);
  assert.ok(Number.isFinite(layout.scale) && layout.boxes.every(box => box.center.every(Number.isFinite)));
});

test('pick names a point of a picture by fractions from its top left, seen from the sub, the operator or a picture camera', () => {
  assert.deepEqual(checkedCommand({command: 'pick', args: {at: [0.5, 0.25]}}), {command: 'pick', args: {pilot: 'bebop', from: 'sub', at: [0.5, 0.25]}});
  assert.equal(checkedCommand({command: 'pick', args: {at: [0, 1], from: 'operator'}}).args.from, 'operator');
  const optics = {projection: Array.from({length: 16}, (_, i) => i), viewInverse: Array.from({length: 16}, (_, i) => -i)};
  assert.deepEqual(checkedCommand({command: 'pick', args: {at: [1, 0], optics}}).args.optics, optics, 'a picture camera travels as its matrices');
  for (const at of [[1.2, 0.5], [0.5], ['a', 0.5], null]) assert.throws(() => checkedCommand({command: 'pick', args: {at}}), /fractions/);
  assert.throws(() => checkedCommand({command: 'pick', args: {at: [0.5, 0.5], from: 'moon'}}), /"sub" or "operator"/);
  assert.throws(() => checkedCommand({command: 'pick', args: {at: [0.5, 0.5], optics: {projection: [1], viewInverse: []}}}), /matrices/);
});

// --- pick maps ------------------------------------------------------------------

// An 8-bit RGBA readback as WebGPU lays it out: rows padded to 256 bytes, the last row not.
function readback(width, height, at) {
  const stride = Math.ceil(width * 4 / 256) * 256, bytes = new Uint8Array(stride * (height - 1) + width * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [n, k] = at(x, y), i = y * stride + x * 4;
      bytes.set([n & 255, n >> 8, k & 255, k >> 8], i);
    }
  }
  return bytes;
}

test('a pick map reads object and instance numbers from a padded readback, row by row from the top', () => {
  const ids = core.idsFromReadback(readback(3, 2, (x, y) => [y * 300 + x, x === 2 ? 70000 % 65536 : 0]), 3, 2);
  assert.deepEqual([...ids.objects], [0, 1, 2, 300, 301, 302], 'the second row starts after the 256-byte padding, and numbers use two bytes');
  assert.deepEqual([...ids.instances], [0, 0, 4464, 0, 0, 4464]);
  const unpadded = core.idsFromReadback(readback(64, 2, (x, y) => [x + y, 0]), 64, 2);
  assert.equal(unpadded.objects[64], 1, 'a 64-pixel row is already 256 bytes and carries no padding');
  assert.throws(() => core.idsFromReadback(new Uint8Array(10), 3, 2), /needs 268 bytes/, 'a short readback is refused, not read past its end');
});

test('a pick map keeps its pixels as runs and answers which object a fraction of the picture shows', () => {
  const width = 4, height = 3, at = (x, y) => (y === 1 && x > 0 ? [7, x === 3 ? 2 : 0] : [0, 0]);
  const ids = core.idsFromReadback(readback(width, height, at), width, height);
  const runs = core.encodePickRuns(ids);
  assert.equal(runs, '0 0 5 7 0 2 7 2 1 0 0 4');
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const found = core.pickRunAt({width, height, runs}, [(x + 0.5) / width, (y + 0.5) / height]);
      assert.deepEqual([found.n, found.instance, ...found.pixel], [...at(x, y), x, y], `pixel ${x},${y}`);
    }
  }
  assert.deepEqual(core.pickRunAt({width, height, runs}, [1, 1]).pixel, [3, 2], 'the far edge belongs to the last pixel');
  assert.throws(() => core.pickRunAt({width, height, runs: '0 0 5'}, [0.9, 0.9]), /cover 5 pixels, not 12/);
});

test('a finished pick map keeps only what it shows, with the matrices of the instances it shows', () => {
  const ids = {width: 2, height: 1, objects: Uint16Array.of(3, 5), instances: Uint16Array.of(0, 1)};
  const matrices = Float32Array.from({length: 48}, (_, i) => i);
  const rows = [{n: 3, id: 'wall'}, {n: 4, id: 'hidden-behind'}, {n: 5, id: 'rocks', instanceArray: matrices}];
  const map = core.finishPickMap(ids, rows, {clouds: [{id: 'scan', bounds: {min: [0, 0, 0], max: [1, 1, 1]}}], water: true});
  assert.equal(map.schema, core.PICK_MAP_SCHEMA);
  assert.deepEqual(map.objects.map(row => row.n), [3, 5], 'an object drawn but covered everywhere is not in the map');
  assert.deepEqual(map.objects[1].instances, {1: Array.from({length: 16}, (_, i) => 16 + i)});
  assert.equal(map.objects[1].instanceArray, undefined, 'the whole instance buffer is not kept');
  assert.equal(map.runs, '3 0 1 5 1 1');
  assert.equal(map.water, true);
  assert.equal(map.clouds.length, 1);
});

test('view optics can be made in either clip convention, and converted between them', () => {
  const view = {position: [0, 1, 5], target: [0, 1, 0], up: [0, 1, 0], fov: 50, near: 0.1, far: 100};
  const webgl = core.opticsOfView(view, 2), webgpu = core.opticsOfView(view, 2, {coordinateSystem: WebGPUCoordinateSystem});
  assert.equal(webgpu.coordinateSystem, WebGPUCoordinateSystem);
  const depth = (optics, distance) => {
    const clip = new Vector4(0, 1, 5 - distance, 1).applyMatrix4(new Matrix4().fromArray(optics.viewInverse)).applyMatrix4(new Matrix4().fromArray(optics.projection));
    return clip.z / clip.w;
  };
  near([depth(webgpu, 0.1), depth(webgpu, 100)], [0, 1], 1e-6, 'WebGPU clips depth to 0..1');
  near([depth(webgl, 0.1), depth(webgl, 100)], [-1, 1], 1e-6, 'WebGL clips depth to -1..1');
  near(core.opticsInConvention(webgl, WebGPUCoordinateSystem).projection, webgpu.projection, 1e-9, 'converted to WebGPU');
  near(core.opticsInConvention(webgpu, WebGLCoordinateSystem).projection, webgl.projection, 1e-9, 'and back');
});

test('a picture pick carries what its pick map holds at the point, and the clouds and fields beside it', () => {
  const optics = {projection: Array(16).fill(1), viewInverse: Array(16).fill(2)}, matrix = Array(16).fill(0);
  const pictured = {n: 4, instance: 2, id: 'kiln', path: [0, 1], matrixWorld: matrix, root: matrix, instanceMatrix: matrix};
  const scene = {clouds: [{id: 'scan', bounds: {min: [0, 0, 0], max: [1, 1, 1]}}], fields: [], water: true};
  const args = checkedCommand({command: 'pick', args: {at: [0.5, 0.5], optics, pictured, scene}}).args;
  assert.deepEqual(args.pictured, pictured);
  assert.deepEqual(args.scene, scene);
  assert.equal(checkedCommand({command: 'pick', args: {at: [0.5, 0.5], optics, pictured: {n: 0}}}).args.pictured.n, 0, 'nothing drawn is a valid answer');
  assert.throws(() => checkedCommand({command: 'pick', args: {at: [0.5, 0.5], pictured}}), /optics of the picture/);
  assert.throws(() => checkedCommand({command: 'pick', args: {at: [0.5, 0.5], optics, pictured: {n: 4, id: 'kiln'}}}), /mesh path and matrices/);
  assert.throws(() => checkedCommand({command: 'pick', args: {at: [0.5, 0.5], optics, pictured: {n: 70000}}}), /object number/);
});
