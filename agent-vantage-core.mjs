// Geometry and protocol for the agent vantage: a small camera object that an
// agent pilots from the terminal and the operator places like any scene object.
// Poses use the scene's camera convention: the camera looks down local -Z with
// local +Y up, and rotation is an XYZ Euler triple in radians.
import {Vector3, Vector4, Quaternion, Euler, Matrix4, Box3, Frustum, PerspectiveCamera, WebGLCoordinateSystem, WebGPUCoordinateSystem} from './lib/three.core.js';

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
// camera-frame zoom or offset) and world-to-view matrices, as arrays, with the
// renderer's clip-space convention (WebGPU clips depth to 0..1, WebGL to -1..1).
export function objectsInProjection({projection, viewInverse, near, coordinateSystem = WebGLCoordinateSystem, reversedDepth = false}, objects, {excludeIds = []} = {}) {
  if (!(near > 0)) throw new Error('Projection naming needs a positive near plane');
  const project = new Matrix4().fromArray(projection), view = new Matrix4().fromArray(viewInverse);
  const world = view.clone().invert(), eye = new Vector3().setFromMatrixPosition(world);
  const inverse = new Quaternion().setFromRotationMatrix(world).invert(), excluded = new Set(excludeIds);
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(project, view), coordinateSystem, !!reversedDepth);
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
  return objectsInProjection({projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray(), near: camera.near,
    coordinateSystem: camera.coordinateSystem}, objects, options);
}

// The matrices a camera at `view` renders with on a viewport of this aspect,
// in the renderer's clip convention (WebGL unless told otherwise).
export function opticsOfView(view, aspect, {coordinateSystem = WebGLCoordinateSystem} = {}) {
  const camera = new PerspectiveCamera(view.fov, aspect, view.near, view.far);
  camera.coordinateSystem = coordinateSystem;
  camera.position.fromArray(view.position);
  camera.up.fromArray(view.up);
  camera.lookAt(new Vector3(...view.target));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray(), near: camera.near, far: camera.far, coordinateSystem};
}

// The same optics in another clip convention: WebGL clips depth to -1..1 and
// WebGPU to 0..1, so only the depth row of the projection differs. Reversed
// depth is not converted.
export function opticsInConvention(optics, coordinateSystem) {
  const from = optics.coordinateSystem ?? WebGLCoordinateSystem;
  if (from === coordinateSystem) return {...optics, coordinateSystem};
  const p = optics.projection, z = [2, 6, 10, 14], w = [3, 7, 11, 15], projection = [...p];
  z.forEach((index, i) => {
    projection[index] = coordinateSystem === WebGPUCoordinateSystem ? (p[index] + p[w[i]]) / 2 : 2 * p[index] - p[w[i]];
  });
  return {...optics, projection, coordinateSystem};
}

// The pixel of a width×height picture that `at` falls in, and its centre as
// fractions: a pick names that pixel, through its centre.
export function pixelAt([x, y], width, height) {
  const pixel = [Math.min(width - 1, Math.max(0, Math.floor(x * width))), Math.min(height - 1, Math.max(0, Math.floor(y * height)))];
  return {pixel, centre: [(pixel[0] + 0.5) / width, (pixel[1] + 0.5) / height]};
}

// The point a picture drew at `at`, where the surface there lies at view depth
// `depth`: the distance along the camera's viewing axis, as the pick map keeps
// it. Two points on the ray fix it, so this holds for orthographic cameras too.
export function pointAtViewDepth({projection, viewInverse}, [x, y], depth) {
  const unproject = new Matrix4().fromArray(projection).invert(), world = new Matrix4().fromArray(viewInverse).invert();
  const near = new Vector3(2 * x - 1, 1 - 2 * y, 0.25).applyMatrix4(unproject), far = new Vector3(2 * x - 1, 1 - 2 * y, 0.75).applyMatrix4(unproject);
  const t = (-depth - near.z) / (far.z - near.z);
  return near.clone().lerp(far, t).applyMatrix4(world).toArray();
}

// The world ray through a point of a picture, from the matrices that drew it.
// `at` is [x, y] as fractions of the picture from its top left. Any clip
// depth inside the frustum gives the same ray, so the convention does not matter.
export function rayThrough({projection, viewInverse}, [x, y]) {
  const unproject = new Matrix4().fromArray(projection).invert(), world = new Matrix4().fromArray(viewInverse).invert();
  const origin = new Vector3().setFromMatrixPosition(world);
  const direction = new Vector3(2 * x - 1, 1 - 2 * y, 0.5).applyMatrix4(unproject).applyMatrix4(world).sub(origin).normalize();
  return {origin: origin.toArray(), direction: direction.toArray()};
}

// Whether a world point lies between a camera's near and far planes, from the
// matrices it renders with and its clip convention: WebGPU depth runs 0 to 1,
// WebGL -1 to 1, and a reversed depth runs 0 to 1 in either.
export function insideClipDepth({projection, viewInverse, coordinateSystem = WebGLCoordinateSystem, reversedDepth = false}, point) {
  const clip = new Vector4(...point, 1).applyMatrix4(new Matrix4().fromArray(viewInverse)).applyMatrix4(new Matrix4().fromArray(projection));
  if (!(clip.w > 0)) return false;
  // A reversed depth runs 1 at near to 0 at far in either convention.
  const depth = clip.z / clip.w, low = coordinateSystem === WebGPUCoordinateSystem || reversedDepth ? 0 : -1;
  return depth >= low - 1e-9 && depth <= 1 + 1e-9;
}

// Where a ray enters and leaves an axis-aligned box, as distances along it, or
// null when it misses. A ray starting inside enters at 0.
export function rayCrossesBox({origin, direction}, {min, max}) {
  let enter = -Infinity, exit = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-12) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
      continue;
    }
    let a = (min[axis] - origin[axis]) / direction[axis], b = (max[axis] - origin[axis]) / direction[axis];
    if (a > b) [a, b] = [b, a];
    enter = Math.max(enter, a); exit = Math.min(exit, b);
    if (enter > exit) return null;
  }
  return exit < 0 ? null : {enter: Math.max(enter, 0), exit};
}

// --- pick maps ----------------------------------------------------------------

// A pick map is the renderer's own answer to "what was drawn here": for every
// pixel of a picture, the number of the object the scene renderer drew there
// and its instance. Object 0 is nothing; UNIDENTIFIED marks a drawing the map
// could not number. Pixels run in rows from the top left.
export const PICK_MAP_SCHEMA = 'kaminos.vantage-pick-map.v1';
export const NOTHING_DRAWN = 0;
export const UNIDENTIFIED = 0xffff;

// The numbers in a readback of the ID target (8-bit RGBA): red and green carry
// the object, blue and alpha the instance. WebGPU pads each copied row except
// the last to a multiple of 256 bytes.
export function idsFromReadback(bytes, width, height) {
  const stride = Math.ceil(width * 4 / 256) * 256, needed = stride * (height - 1) + width * 4;
  if (!(width > 0 && height > 0) || !(bytes?.length >= needed)) {
    throw new Error(`A ${width}×${height} pick map needs ${needed} bytes of readback; got ${bytes?.length ?? 0}`);
  }
  const objects = new Uint16Array(width * height), instances = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = y * stride + x * 4, to = y * width + x;
      objects[to] = bytes[from] | (bytes[from + 1] << 8);
      instances[to] = bytes[from + 2] | (bytes[from + 3] << 8);
    }
  }
  return {width, height, objects, instances};
}

// The pick map's depth: the view depth of the surface drawn at each pixel, 0
// where nothing was drawn, read from an R32F readback whose rows WebGPU pads
// to 256 bytes (64 values), except the last.
export function depthsFromReadback(floats, width, height) {
  const stride = Math.ceil(width * 4 / 256) * 64, needed = stride * (height - 1) + width;
  if (!(width > 0 && height > 0) || !(floats?.length >= needed)) {
    throw new Error(`A ${width}×${height} depth readback needs ${needed} values; got ${floats?.length ?? 0}`);
  }
  const depths = new Float32Array(width * height);
  for (let y = 0; y < height; y++) depths.set(floats.subarray(y * stride, y * stride + width), y * width);
  return depths;
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function base64ToBytes(text) {
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
// Depth travels and is kept as little-endian float32, whatever the machine.
const littleEndianFloats = values => {
  const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setFloat32(i * 4, value, true));
  return bytes;
};
// The depth a pick map kept at a pixel, from its little-endian float32 bytes;
// null where nothing was drawn.
export function depthAtPixel(bytes, width, [x, y]) {
  const offset = (y * width + x) * 4;
  if (!(offset >= 0 && offset + 4 <= bytes.length)) throw new Error(`Pixel ${x}, ${y} is outside the pick map's depth`);
  const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(offset, true);
  return value > 0 && Number.isFinite(value) ? value : null;
}

// Runs of equal (object, instance) pixels as one line of text: "object
// instance length" triples, separated by spaces.
export function encodePickRuns({width, height, objects, instances}) {
  const total = width * height, parts = [];
  for (let start = 0; start < total;) {
    let end = start + 1;
    while (end < total && objects[end] === objects[start] && instances[end] === instances[start]) end++;
    parts.push(objects[start], instances[start], end - start);
    start = end;
  }
  return parts.join(' ');
}

// The object and instance a pick map holds at `at`, as fractions of the
// picture from its top left; the pixel is the one that fraction falls in.
export function pickRunAt({width, height, runs}, [x, y]) {
  if (!(width > 0 && height > 0) || typeof runs !== 'string') throw new Error('A pick map needs its width, height and runs');
  const px = Math.min(width - 1, Math.max(0, Math.floor(x * width))), py = Math.min(height - 1, Math.max(0, Math.floor(y * height)));
  const index = py * width + px, values = runs.split(' ').map(Number);
  let end = 0;
  for (let i = 0; i + 2 < values.length; i += 3) {
    end += values[i + 2];
    if (index < end) return {n: values[i], instance: values[i + 1], pixel: [px, py]};
  }
  throw new Error(`The pick map's runs cover ${end} pixels, not ${width * height}`);
}

// A picture's pick map from the numbers read back and the rows the page wrote
// down when the map was drawn. Only the objects the map shows are kept; an
// instanced mesh keeps the matrices of the instances it shows, unless it has
// more instances than the map's 16-bit instance numbers can tell apart.
export function finishPickMap(ids, rows, context = {}) {
  const shown = new Map();
  for (let i = 0; i < ids.objects.length; i++) {
    const n = ids.objects[i];
    if (n === NOTHING_DRAWN || n === UNIDENTIFIED) continue;
    if (!shown.has(n)) shown.set(n, new Set());
    shown.get(n).add(ids.instances[i]);
  }
  const objects = rows.filter(row => shown.has(row.n)).map(({instanceArray, ...row}) => {
    if (!instanceArray || row.instancesBeyondMap) return row;
    const instances = {};
    for (const k of [...shown.get(row.n)].sort((a, b) => a - b)) {
      if ((k + 1) * 16 <= instanceArray.length) instances[k] = Array.from(instanceArray.slice(k * 16, k * 16 + 16));
    }
    return {...row, instances};
  });
  const unknown = [...shown.keys()].filter(n => !rows.some(row => row.n === n));
  return {schema: PICK_MAP_SCHEMA, width: ids.width, height: ids.height, runs: encodePickRuns(ids), objects,
    ...(unknown.length ? {unnumbered: unknown} : {}), clouds: context.clouds ?? [], fields: context.fields ?? [], water: !!context.water,
    ...(ids.depths ? {depth: {encoding: 'float32le-base64', unit: 'view-depth', width: ids.width, height: ids.height,
      data: bytesToBase64(littleEndianFloats(ids.depths))}} : {})};
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
const fraction = at => {
  if (!Array.isArray(at) || at.length !== 2 || !at.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error('Pick needs at: [x, y] as fractions of the picture from its top left, each 0 to 1');
  }
  return [...at];
};
const sixteen = value => Array.isArray(value) && value.length === 16 && value.every(Number.isFinite);
const matrices = optics => {
  if (!optics || !sixteen(optics.projection) || !sixteen(optics.viewInverse)) throw new Error('Pick optics need projection and viewInverse matrices of 16 numbers');
  return {projection: [...optics.projection], viewInverse: [...optics.viewInverse],
    ...(Number.isFinite(optics.near) ? {near: optics.near} : {}),
    ...(Number.isFinite(optics.far) ? {far: optics.far} : {}),
    ...(Number.isFinite(optics.coordinateSystem) ? {coordinateSystem: optics.coordinateSystem} : {}),
    ...(typeof optics.reversedDepth === 'boolean' ? {reversedDepth: optics.reversedDepth} : {})};
};
// What a kept picture's pick map holds at the picked pixel: the object number
// and instance, and for a scene object its entry, mesh path and the matrices
// it was drawn with.
const picturedArg = pictured => {
  const ok = pictured && typeof pictured === 'object' && Number.isInteger(pictured.n) && pictured.n >= 0 && pictured.n <= UNIDENTIFIED
    && Number.isInteger(pictured.instance ?? 0) && (pictured.id == null || (typeof pictured.id === 'string' && Array.isArray(pictured.path)
      && pictured.path.every(Number.isInteger) && sixteen(pictured.matrixWorld) && sixteen(pictured.root)))
    && (pictured.instanceMatrix == null || sixteen(pictured.instanceMatrix));
  if (!ok) throw new Error('A picture pick needs what its pick map holds at the point: an object number, and for a scene object its id, mesh path and matrices');
  if (pictured.depth != null && !(Number.isFinite(pictured.depth) && pictured.depth > 0)) throw new Error('A picture pick\'s depth is a positive view depth, or absent');
  if (pictured.pixel != null && !(Array.isArray(pictured.pixel) && pictured.pixel.length === 2 && pictured.pixel.every(value => Number.isInteger(value) && value >= 0))) {
    throw new Error('A picture pick\'s pixel is two whole numbers from the top left');
  }
  return structuredClone(pictured);
};
// What a picture recorded beside its pick map: point clouds, simulation fields
// and water, which are drawn outside the map.
const sceneContextArg = context => {
  const boxes = list => Array.isArray(list) && list.every(item => item && typeof item.id === 'string' && item.bounds
    && Array.isArray(item.bounds.min) && Array.isArray(item.bounds.max));
  if (!context || !boxes(context.clouds ?? []) || !boxes(context.fields ?? [])) throw new Error('A picture pick needs the clouds and fields its picture recorded');
  return {clouds: structuredClone(context.clouds ?? []), fields: structuredClone(context.fields ?? []), water: context.water === true};
};

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
  glance: args => ({pilot: pilotArg(args), maxSize: count(args.maxSize, 'maxSize', 1280, 64), annotate: flag(args.annotate), map: args.map !== false}),
  burst: args => ({pilot: pilotArg(args), count: count(args.count, 'count', 6), interval: positive(args.interval, 'interval', 250),
    settle: count(args.settle, 'settle', 2), maxSize: count(args.maxSize, 'maxSize', 1280, 64), cell: count(args.cell, 'cell', 480, 64),
    annotate: flag(args.annotate), frames: flag(args.frames), map: args.map !== false, depth: flag(args.depth)}),
  live: args => {
    if (typeof args.on !== 'boolean') throw new Error('Live needs on: true or false');
    const fps = args.fps ?? 4;
    if (!(Number.isFinite(fps) && fps >= 0.5 && fps <= 15)) throw new Error('Live fps is between 0.5 and 15');
    return {pilot: pilotArg(args), on: args.on, fps};
  },
  // Whether the mesh an anchor keeps is still the one picked: the entry id,
  // the mesh path under it, and the geometry identity the pick recorded.
  recheck: args => {
    if (typeof args.id !== 'string' || !args.id) throw new Error('Recheck needs the id of the anchored entry');
    if (!Array.isArray(args.path) || !args.path.every(index => Number.isInteger(index) && index >= 0)) throw new Error('Recheck path is the mesh path under the entry, a list of child indices');
    const identity = args.identity ?? null;
    if (identity !== null && (typeof identity !== 'object' || Array.isArray(identity))) throw new Error('Recheck identity is the geometry identity object a pick recorded, or null');
    return {id: args.id, path: [...args.path], identity};
  },
  // A strip of glances over a window, ending early at the page event `until`
  // (window event `kaminos:<until>`). The window is bounded only by how long
  // the server will hold a command.
  watch: args => {
    const seconds = args.seconds ?? 5, fps = args.fps ?? 2, until = args.until ?? null;
    if (!(Number.isFinite(seconds) && seconds > 0 && seconds <= 3600)) throw new Error('Watch seconds is more than 0 and at most 3600');
    if (!(Number.isFinite(fps) && fps >= 0.5 && fps <= 15)) throw new Error('Watch fps is between 0.5 and 15');
    if (until !== null && !(typeof until === 'string' && /^[a-z0-9][a-z0-9._:-]{0,63}$/i.test(until))) throw new Error('Watch --until names an event: letters, digits, . _ : -');
    return {pilot: pilotArg(args), seconds, fps, until, maxSize: count(args.maxSize, 'maxSize', 320, 64), cell: count(args.cell, 'cell', 240, 64),
      frames: flag(args.frames), map: args.map !== false, depth: flag(args.depth)};
  },
  sketch: () => ({}),
  map: args => ({size: count(args.size, 'size', 480, 64)}),
  pick: args => {
    const from = args.from ?? 'sub';
    if (!['sub', 'operator'].includes(from)) throw new Error('Pick from "sub" or "operator", or give the optics of a picture');
    if (args.pictured != null && args.optics == null) throw new Error('A picture pick needs the optics of the picture');
    return {pilot: pilotArg(args), from, at: fraction(args.at), ...(args.optics != null ? {optics: matrices(args.optics)} : {}),
      ...(args.pictured != null ? {pictured: picturedArg(args.pictured), scene: sceneContextArg(args.scene ?? {})} : {})};
  },
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

const VIEW_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

// The world-space ray through each viewport corner (lower left first,
// counterclockwise), scaled to unit depth along the view, from the matrices a
// camera renders with. A camera frame's zoom and offset live in the
// projection, so these rays follow them where fov and aspect cannot.
export function viewCornerRays({projection, viewInverse}) {
  const unproject = new Matrix4().fromArray(projection).invert(), world = new Matrix4().fromArray(viewInverse).invert();
  const apex = new Vector3().setFromMatrixPosition(world);
  const rays = VIEW_CORNERS.map(([x, y]) => {
    const point = new Vector3(x, y, 0.5).applyMatrix4(unproject);
    return point.multiplyScalar(-1 / point.z).applyMatrix4(world).sub(apex);
  });
  return {apex, rays};
}

// A fixed three-quarter orthographic view, fitted to the scene and both kinds
// of camera, laid out in pixels. Painting is left to the caller. A camera with
// `optics` (its effective matrices) is drawn from them; otherwise from its
// view's lens and the operator's aspect.
export function sketchMapLayout(sketch, {width = 320, height = 240, azimuth = 35, elevation = 30, margin = 0.08} = {}) {
  const az = azimuth * DEG, el = elevation * DEG;
  const eye = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const basis = new Matrix4().lookAt(eye, new Vector3(), new Vector3(0, 1, 0));
  const axes = [0, 1, 2].map(column => new Vector3().setFromMatrixColumn(basis, column));
  const flat = point => axes.map(axis => axis.dot(new Vector3(...point)));
  const aspect = sketch.operator?.aspect ?? 16 / 9;
  const boxes = [...(sketch.objects ?? []).map(object => ({...object, kind: 'object'})),
    ...(sketch.fields ?? []).map(field => ({...field, kind: 'field'}))].filter(box => box.bounds);
  const cone = (kind, label, view, optics) => {
    if (optics) return {kind, label, ...viewCornerRays(optics)};
    const apex = new Vector3(...view.position), forward = new Vector3(...view.target).sub(apex).normalize();
    const up = new Vector3(...view.up);
    up.addScaledVector(forward, -up.dot(forward));
    if (up.lengthSq() < 1e-12) up.set(0, 1, 0);
    up.normalize();
    const right = new Vector3().crossVectors(forward, up).normalize(), vertical = Math.tan(view.fov * DEG / 2), horizontal = vertical * aspect;
    return {kind, label, apex, rays: VIEW_CORNERS.map(([sx, sy]) => forward.clone()
      .addScaledVector(right, sx * horizontal).addScaledVector(up, sy * vertical))};
  };
  const cones = [...(sketch.operator ? [cone('operator', 'you', sketch.operator.view, sketch.operator.optics)] : []),
    ...(sketch.subs ?? []).map(sub => cone('sub', sub.label, sub.view, sub.optics))];
  const world = [...boxes.flatMap(box => cornersOf(box.bounds)), ...cones.map(item => item.apex.toArray()), [0, 0, 0]];
  const extent = new Box3().setFromPoints(world.map(point => new Vector3(...point)));
  // Cones share one length scaled to the scene, so the two read alike.
  const length = Math.min(Math.max(Math.max(extent.getSize(new Vector3()).length() / 2, 1) * 0.6, 0.5), 6);
  for (const item of cones) item.far = item.rays.map(ray => item.apex.clone().addScaledVector(ray, length).toArray());
  // Extremes by iteration: spreading every point into Math.min overflows the
  // call stack in large scenes.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const point of [...world, ...cones.flatMap(item => item.far)]) {
    const [x, y] = flat(point);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
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
