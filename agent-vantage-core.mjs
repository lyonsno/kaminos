// Geometry and protocol for the agent vantage: a small camera object that an
// agent pilots from the terminal and the operator places like any scene object.
// Poses use the scene's camera convention: the camera looks down local -Z with
// local +Y up, and rotation is an XYZ Euler triple in radians.
import {Vector3, Quaternion, Euler, Matrix4, Box3, Frustum, PerspectiveCamera} from './lib/three.core.js';

export const VANTAGE_SCHEMA = 'kaminos.agent-vantage.v1';
export const DEFAULT_PILOT = 'bebop';
const DEG = Math.PI / 180;

export function vantageCameraId(pilot = DEFAULT_PILOT) {
  if (typeof pilot !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(pilot)) {
    throw new Error('A pilot name uses lowercase letters, digits and dashes');
  }
  return `vantage-${pilot}`;
}

function triple(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`Vantage ${name} needs three finite numbers`);
  }
  return new Vector3(...value);
}

function finite(value, name) {
  if (!Number.isFinite(value)) throw new Error(`Vantage ${name} must be a finite number`);
  return value;
}

function poseFromQuaternion(position, quaternion) {
  const euler = new Euler().setFromQuaternion(quaternion);
  return {position: position.toArray(), rotation: [euler.x, euler.y, euler.z], scale: [1, 1, 1]};
}

const quaternionOf = pose => new Quaternion().setFromEuler(new Euler(...triple(pose.rotation, 'rotation').toArray()));

export function poseLookingAt(position, target, up = [0, 1, 0]) {
  const eye = triple(position, 'position'), at = triple(target, 'target');
  const direction = at.clone().sub(eye);
  if (direction.lengthSq() < 1e-18) throw new Error('The vantage target must differ from the sub position');
  let upward = triple(up, 'up').normalize();
  const along = direction.clone().normalize().dot(upward);
  // Looking straight along the up axis has no horizon; keep image-up toward -Z
  // when looking down and +Z when looking up.
  if (Math.abs(along) > 0.999999) upward = new Vector3(0, 0, along > 0 ? 1 : -1);
  const rotation = new Matrix4().lookAt(eye, at, upward);
  return poseFromQuaternion(eye, new Quaternion().setFromRotationMatrix(rotation));
}

export function poseAxes(pose) {
  const q = quaternionOf(pose);
  return {
    forward: new Vector3(0, 0, -1).applyQuaternion(q).toArray(),
    right: new Vector3(1, 0, 0).applyQuaternion(q).toArray(),
    up: new Vector3(0, 1, 0).applyQuaternion(q).toArray(),
  };
}

// Forward follows the view (a sub swims toward what it looks at), right is the
// sub's own right, and up rises along world up.
export function movedPose(pose, {forward = 0, right = 0, up = 0} = {}) {
  const axes = poseAxes(pose), position = triple(pose.position, 'position');
  position.addScaledVector(new Vector3(...axes.forward), finite(forward, 'forward'));
  position.addScaledVector(new Vector3(...axes.right), finite(right, 'right'));
  position.y += finite(up, 'up');
  return {position: position.toArray(), rotation: [...pose.rotation], scale: [1, 1, 1]};
}

// Positive yaw turns left about world up; positive pitch raises the nose about
// the sub's own right axis.
export function turnedPose(pose, {yaw = 0, pitch = 0} = {}) {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), finite(yaw, 'yaw') * DEG)
    .multiply(quaternionOf(pose))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), finite(pitch, 'pitch') * DEG));
  return poseFromQuaternion(triple(pose.position, 'position'), q);
}

// Azimuth 0 looks from +Z toward the target, 90 from +X; elevation raises the sub.
export function orbitPose(center, {radius, azimuth = 0, elevation = 20} = {}) {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Orbit radius must be a positive number');
  const c = triple(center, 'orbit target'), az = finite(azimuth, 'azimuth') * DEG, el = finite(elevation, 'elevation') * DEG;
  const position = c.clone().add(new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(radius));
  return poseLookingAt(position.toArray(), c.toArray());
}

export function framingDistance(radius, {vfovDeg, aspect, margin = 1.15}) {
  if (!(radius > 0) || !(vfovDeg > 0 && vfovDeg < 180) || !(aspect > 0) || !(margin > 0)) {
    throw new Error('Framing needs a positive radius, field of view, aspect and margin');
  }
  const vertical = vfovDeg * DEG, horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  return radius * margin / Math.sin(Math.min(vertical, horizontal) / 2);
}

export function boundsBox(bounds) {
  return new Box3(triple(bounds.min, 'bounds min'), triple(bounds.max, 'bounds max'));
}

export function framePose(bounds, {direction, vfovDeg, aspect, margin = 1.15}) {
  const box = boundsBox(bounds), center = box.getCenter(new Vector3());
  const radius = Math.max(box.getSize(new Vector3()).length() / 2, 1e-3);
  const along = triple(direction, 'direction');
  if (along.lengthSq() < 1e-18) throw new Error('Framing direction must be nonzero');
  along.normalize();
  const distance = framingDistance(radius, {vfovDeg, aspect, margin});
  return poseLookingAt(center.clone().addScaledVector(along, -distance).toArray(), center.toArray());
}

function viewCamera(view, aspect) {
  const camera = new PerspectiveCamera(view.fov, aspect, view.near, view.far);
  camera.position.fromArray(view.position);
  camera.up.fromArray(view.up);
  camera.lookAt(new Vector3(...view.target));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

const round = value => Math.round(value * 1e4) / 1e4;

// Bounds-based: an object reported in view may still be hidden behind another.
// Image coordinates are normalized with the origin at the top left. `optics`
// is the camera actually used for the picture: its projection (including any
// camera-frame zoom or offset) and world-to-view matrices, as arrays.
export function objectsInProjection({projection, viewInverse, near}, objects, {excludeIds = []} = {}) {
  if (!(near > 0)) throw new Error('Projection naming needs a positive near plane');
  const project = new Matrix4().fromArray(projection), view = new Matrix4().fromArray(viewInverse);
  const world = view.clone().invert(), eye = new Vector3().setFromMatrixPosition(world);
  const inverse = new Quaternion().setFromRotationMatrix(world).invert(), excluded = new Set(excludeIds);
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(project, view));
  const inView = [], outOfView = [];
  for (const object of objects) {
    if (excluded.has(object.id) || !object.bounds) continue;
    const box = boundsBox(object.bounds), center = box.getCenter(new Vector3());
    const local = center.clone().sub(eye).applyQuaternion(inverse);
    const bearing = {right: round(Math.atan2(local.x, -local.z) / DEG), up: round(Math.atan2(local.y, Math.hypot(local.x, local.z)) / DEG)};
    const entry = {id: object.id, label: object.label, type: object.type, distance: eye.distanceTo(center), bearing};
    if (!frustum.intersectsBox(box)) { outOfView.push(entry); continue; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = false;
    for (let i = 0; i < 8; i++) {
      const corner = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(view);
      if (corner.z > -near) { behind = true; continue; }
      const ndc = corner.applyMatrix4(project);
      x0 = Math.min(x0, (ndc.x + 1) / 2); x1 = Math.max(x1, (ndc.x + 1) / 2);
      y0 = Math.min(y0, (1 - ndc.y) / 2); y1 = Math.max(y1, (1 - ndc.y) / 2);
    }
    // A box reaching behind the camera has no bounded image extent.
    if (behind) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
    const rect = [x0, y0, x1, y1].map(value => Math.min(1, Math.max(0, value)));
    const partial = behind || rect.some((value, i) => value !== [x0, y0, x1, y1][i]);
    const middle = center.clone().applyMatrix4(view);
    let image = null;
    if (middle.z < -near) {
      const ndc = middle.applyMatrix4(project);
      image = [(ndc.x + 1) / 2, (1 - ndc.y) / 2];
    }
    inView.push({...entry, rect: rect.map(round), center: image && image.map(round), coverage: round((rect[2] - rect[0]) * (rect[3] - rect[1])), partial});
  }
  const byDistance = (a, b) => a.distance - b.distance;
  return {inView: inView.sort(byDistance), outOfView: outOfView.sort(byDistance), occlusion: 'not-tested'};
}

// The same naming from a nominal view (position, target, up, fov, clipping)
// and an aspect, for planning where the sub would look.
export function objectsInView(view, aspect, objects, options = {}) {
  const camera = viewCamera(view, aspect);
  return objectsInProjection({projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray(), near: camera.near}, objects, options);
}

const unit = values => { const v = new Vector3(...values); return v.lengthSq() > 1e-18 ? v.normalize() : v; };
const angleBetween = (a, b) => Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) / DEG;

// How far an effective view moved from the requested one, counting roll
// and lens as well as position and heading. Sub-millimetre drift is noise.
export function viewChange(requested, effective) {
  const heading = view => unit(view.target.map((v, i) => v - view.position[i]));
  const forward = heading(effective);
  const level = up => { const v = unit(up); return v.addScaledVector(forward, -v.dot(forward)); };
  const was = level(requested.up), now = level(effective.up);
  const relative = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);
  const change = {
    position: new Vector3(...requested.position).distanceTo(new Vector3(...effective.position)),
    angle: angleBetween(heading(requested), forward),
    roll: was.lengthSq() > 1e-12 && now.lengthSq() > 1e-12 ? angleBetween(was.normalize(), now.normalize()) : 0,
    fov: Math.abs(requested.fov - effective.fov),
    near: relative(requested.near, effective.near),
    far: relative(requested.far, effective.far),
  };
  change.changed = change.position > 0.01 || change.angle > 0.5 || change.roll > 0.5 || change.fov > 0.1 || change.near > 0.01 || change.far > 0.01;
  return change;
}

function unionBounds(list) {
  const box = new Box3();
  for (const bounds of list) box.union(boundsBox(bounds));
  return box.isEmpty() ? null : {min: box.min.toArray(), max: box.max.toArray()};
}

const describe = object => `${object.label} (${object.id})`;

// A target is a scene object by id, exact label or unique label/id fragment,
// the operator's current selection, or an explicit world point.
export function resolveTarget(spec, {objects = [], selection = []} = {}) {
  if (Array.isArray(spec)) {
    const point = triple(spec, 'target point').toArray();
    return {kind: 'point', id: null, label: `point (${point.map(v => round(v)).join(', ')})`, center: point, bounds: null};
  }
  if (typeof spec !== 'string' || !spec.trim()) throw new Error('Name a scene object, "selection", or give x y z');
  const name = spec.trim(), lower = name.toLowerCase(), candidates = objects.filter(object => object.bounds);
  const asTarget = object => ({kind: 'object', id: object.id, label: object.label, type: object.type,
    center: boundsBox(object.bounds).getCenter(new Vector3()).toArray(), bounds: object.bounds});
  if (lower === 'selection' || lower === 'selected') {
    const chosen = candidates.filter(object => selection.includes(object.id));
    if (!chosen.length) throw new Error('Nothing is selected in Kaminos');
    const bounds = unionBounds(chosen.map(object => object.bounds));
    return {kind: 'selection', id: null, label: `selection (${chosen.map(o => o.label).join(', ')})`,
      ids: chosen.map(object => object.id), center: boundsBox(bounds).getCenter(new Vector3()).toArray(), bounds};
  }
  const byId = candidates.find(object => object.id === name);
  if (byId) return asTarget(byId);
  const pick = (matches, kind) => {
    if (matches.length === 1) return asTarget(matches[0]);
    if (matches.length > 1) throw new Error(`"${name}" is ambiguous (${kind}): ${matches.map(describe).join(', ')}`);
    return null;
  };
  return pick(candidates.filter(object => String(object.label).toLowerCase() === lower), 'same label')
    ?? pick(candidates.filter(object => String(object.label).toLowerCase().includes(lower) || object.id.toLowerCase().includes(lower)), 'partial match')
    ?? (() => { throw new Error(`No scene object matches "${name}". Known: ${candidates.map(describe).join(', ') || 'none'}`); })();
}

const pilotArg = args => {
  const pilot = args.pilot ?? DEFAULT_PILOT;
  vantageCameraId(pilot);
  return pilot;
};
const targetArg = value => {
  if (Array.isArray(value)) return triple(value, 'target').toArray();
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error('Name a target object, "selection", or give x y z');
};
const positive = (value, name, fallback) => {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result <= 0) throw new Error(`Vantage ${name} must be a positive number`);
  return result;
};
const count = (value, name, fallback, min = 1) => {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min) throw new Error(`Vantage ${name} must be an integer of at least ${min}`);
  return result;
};
const flag = value => value === true;

const COMMANDS = {
  status: () => ({}),
  objects: args => ({pilot: pilotArg(args)}),
  launch: args => ({pilot: pilotArg(args), label: typeof args.label === 'string' && args.label.trim() ? args.label.trim() : null,
    placement: ['ahead', 'operator'].includes(args.placement ?? 'ahead') ? args.placement ?? 'ahead' : (() => { throw new Error('Launch placement is "ahead" or "operator"'); })(),
    lens: positive(args.lens, 'lens', 24)}),
  remove: args => ({pilot: pilotArg(args)}),
  goto: args => ({pilot: pilotArg(args), position: triple(args.position, 'position').toArray(), ...(args.lookAt != null ? {lookAt: targetArg(args.lookAt)} : {})}),
  move: args => ({pilot: pilotArg(args), forward: finite(args.forward ?? 0, 'forward'), right: finite(args.right ?? 0, 'right'), up: finite(args.up ?? 0, 'up')}),
  turn: args => ({pilot: pilotArg(args), yaw: finite(args.yaw ?? 0, 'yaw'), pitch: finite(args.pitch ?? 0, 'pitch')}),
  look: args => ({pilot: pilotArg(args), target: targetArg(args.target)}),
  orbit: args => ({pilot: pilotArg(args), target: targetArg(args.target), ...(args.radius != null ? {radius: positive(args.radius, 'radius')} : {}),
    azimuth: finite(args.azimuth ?? 0, 'azimuth'), elevation: finite(args.elevation ?? 20, 'elevation')}),
  frame: args => ({pilot: pilotArg(args), target: targetArg(args.target), margin: positive(args.margin, 'margin', 1.15)}),
  align: args => ({pilot: pilotArg(args)}),
  snap: args => ({pilot: pilotArg(args), settle: count(args.settle, 'settle', 2), maxSize: count(args.maxSize, 'maxSize', 1280, 64),
    annotate: flag(args.annotate), helpers: flag(args.helpers), map: args.map !== false}),
  peek: args => ({maxSize: count(args.maxSize, 'maxSize', 1280, 64), annotate: flag(args.annotate), clean: flag(args.clean), map: args.map !== false}),
  burst: args => ({pilot: pilotArg(args), count: count(args.count, 'count', 6), interval: positive(args.interval, 'interval', 250),
    settle: count(args.settle, 'settle', 2), maxSize: count(args.maxSize, 'maxSize', 1280, 64), cell: count(args.cell, 'cell', 480, 64),
    annotate: flag(args.annotate), frames: flag(args.frames), map: args.map !== false}),
  sketch: () => ({}),
  map: args => ({size: count(args.size, 'size', 480, 64)}),
};
export const VANTAGE_COMMANDS = Object.freeze(Object.keys(COMMANDS));

export function checkedCommand(raw) {
  const command = raw?.command;
  if (typeof command !== 'string' || !Object.hasOwn(COMMANDS, command)) throw new Error(`Unknown vantage command: ${command}`);
  const args = raw.args ?? {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Vantage command arguments must be an object');
  return {command, args: COMMANDS[command](args)};
}


// --- scene sketch and map ---------------------------------------------------

// A light representation of the scene that needs no rendering: named boxes,
// simulation fields, the operator's camera and every sub.
export const SKETCH_SCHEMA = 'kaminos.scene-sketch.v1';

function hull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const chain = list => list.reduce((out, point) => {
    while (out.length >= 2 && cross(out.at(-2), out.at(-1), point) <= 0) out.pop();
    out.push(point);
    return out;
  }, []);
  const lower = chain(sorted), upper = chain([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const BOX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const cornersOf = ({min, max}) => Array.from({length: 8}, (_, i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
const niceStep = span => {
  const raw = span / 8, power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(factor => factor * power).find(step => step >= raw);
};

// A fixed three-quarter orthographic view, fitted to the scene and both kinds
// of camera, laid out in pixels. Painting is left to the caller.
export function sketchMapLayout(sketch, {width = 320, height = 240, azimuth = 35, elevation = 30, margin = 0.08} = {}) {
  const az = azimuth * DEG, el = elevation * DEG;
  const eye = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const basis = new Matrix4().lookAt(eye, new Vector3(), new Vector3(0, 1, 0));
  const axes = [0, 1, 2].map(column => new Vector3().setFromMatrixColumn(basis, column));
  const flat = point => axes.map(axis => axis.dot(new Vector3(...point)));
  const aspect = sketch.operator?.aspect ?? 16 / 9;
  const boxes = [...(sketch.objects ?? []).map(object => ({...object, kind: 'object'})),
    ...(sketch.fields ?? []).map(field => ({...field, kind: 'field'}))].filter(box => box.bounds);
  const cone = (kind, label, view) => {
    const apex = new Vector3(...view.position), forward = new Vector3(...view.target).sub(apex).normalize();
    const up = new Vector3(...view.up);
    up.addScaledVector(forward, -up.dot(forward));
    if (up.lengthSq() < 1e-12) up.set(0, 1, 0);
    up.normalize();
    const tangent = Math.tan(view.fov * DEG / 2);
    return {kind, label, apex, forward, up, right: new Vector3().crossVectors(forward, up).normalize(), vertical: tangent, horizontal: tangent * aspect};
  };
  const cones = [...(sketch.operator ? [cone('operator', 'you', sketch.operator.view)] : []),
    ...(sketch.subs ?? []).map(sub => cone('sub', sub.label, sub.view))];
  const world = [...boxes.flatMap(box => cornersOf(box.bounds)), ...cones.map(item => item.apex.toArray()), [0, 0, 0]];
  const extent = new Box3().setFromPoints(world.map(point => new Vector3(...point)));
  // Cones share one length scaled to the scene, so the two read alike.
  const length = Math.min(Math.max(Math.max(extent.getSize(new Vector3()).length() / 2, 1) * 0.6, 0.5), 6);
  for (const item of cones) {
    item.far = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => item.apex.clone().addScaledVector(item.forward, length)
      .addScaledVector(item.right, sx * item.horizontal * length).addScaledVector(item.up, sy * item.vertical * length).toArray());
  }
  const flats = [...world, ...cones.flatMap(item => item.far)].map(flat);
  const xs = flats.map(point => point[0]), ys = flats.map(point => point[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(width * (1 - 2 * margin) / Math.max(x1 - x0, 1e-6), height * (1 - 2 * margin) / Math.max(y1 - y0, 1e-6));
  const project = point => {
    const [x, y] = flat(point);
    return [width / 2 + (x - (x0 + x1) / 2) * scale, height / 2 - (y - (y0 + y1) / 2) * scale];
  };
  const laidBoxes = boxes.map(box => {
    const corners = cornersOf(box.bounds), points = corners.map(project);
    const center = box.bounds.min.map((value, i) => (value + box.bounds.max[i]) / 2);
    return {id: box.id, label: box.label, type: box.type, kind: box.kind, polygon: hull(points),
      edges: BOX_EDGES.map(([a, b]) => [...points[a], ...points[b]]), center: project(center),
      labelAt: project([center[0], box.bounds.max[1], center[2]]), depth: flat(center)[2]};
  }).sort((a, b) => a.depth - b.depth);
  const laidCones = cones.map(item => {
    const apex = project(item.apex.toArray()), far = item.far.map(project);
    return {kind: item.kind, label: item.label, apex, polygon: hull([apex, ...far]),
      edges: [...far.map(point => [...apex, ...point]), ...far.map((point, i) => [...point, ...far[(i + 1) % 4]])]};
  });
  const step = niceStep(Math.max(extent.max.x - extent.min.x, extent.max.z - extent.min.z, 1));
  const gx = [Math.floor(extent.min.x / step) * step, Math.ceil(extent.max.x / step) * step];
  const gz = [Math.floor(extent.min.z / step) * step, Math.ceil(extent.max.z / step) * step];
  const grid = [];
  for (let x = gx[0]; x <= gx[1] + 1e-9; x += step) grid.push([...project([x, 0, gz[0]]), ...project([x, 0, gz[1]])]);
  for (let z = gz[0]; z <= gz[1] + 1e-9; z += step) grid.push([...project([gx[0], 0, z]), ...project([gx[1], 0, z])]);
  return {width, height, azimuth, elevation, scale, project, boxes: laidBoxes, cones: laidCones, grid,
    axes: {x: [...project([0, 0, 0]), ...project([step, 0, 0])], z: [...project([0, 0, 0]), ...project([0, 0, step])]},
    scaleBar: {meters: step, pixels: step * scale}};
}
