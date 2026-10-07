// Resting planes: the flat faces an object could stand on. A rigid object
// rests on a face of its convex hull, and stays put when its centre of mass
// projects inside that face. Leveling turns the closest such face straight
// down when the object is not already standing on a level one, which corrects
// generated assets that arrive a few degrees off without guessing at objects
// with no obvious base.
import { Matrix4, Quaternion, Vector3 } from './lib/three.core.js';
import { ConvexHull } from './lib/addons/math/ConvexHull.js';

export const LEVELING_DEFAULTS = Object.freeze({
  levelTolDeg: 2,     // a base within this of straight down already counts as level
  // Generated assets that are merely off-level sit within a few degrees of
  // their base; ones stored on the wrong axis lean 18-36 degrees onto some
  // other face, and rolling those flatter would make them worse.
  maxTiltDeg: 15,
  minRelArea: 0.01,   // base area relative to the squared bounding diagonal
  minMargin: 0.03,    // centre of mass inset from the base edge, relative to the diagonal
});

const SEED_DIRECTIONS = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) SEED_DIRECTIONS.push(new Vector3(x, y, z).normalize());

// Points strictly inside the hull of the 26 directional extremes can never be
// hull vertices; discarding them keeps multi-million-vertex meshes cheap.
function hullCandidates(points) {
  const count = points.length / 3, best = SEED_DIRECTIONS.map(() => [-Infinity, -1]);
  for (let i = 0; i < count; i++) {
    const x = points[3 * i], y = points[3 * i + 1], z = points[3 * i + 2];
    SEED_DIRECTIONS.forEach((d, k) => { const s = d.x * x + d.y * y + d.z * z; if (s > best[k][0]) best[k] = [s, i]; });
  }
  const seedIndices = [...new Set(best.map(([, i]) => i))];
  const toVector = i => new Vector3(points[3 * i], points[3 * i + 1], points[3 * i + 2]);
  if (seedIndices.length < 4) return Array.from({ length: count }, (_, i) => toVector(i));
  const seed = new ConvexHull().setFromPoints(seedIndices.map(toVector));
  if (!seed.faces.length) return Array.from({ length: count }, (_, i) => toVector(i));
  const planes = seed.faces.map(face => [face.normal.x, face.normal.y, face.normal.z, face.constant]);
  const kept = [];
  for (let i = 0; i < count; i++) {
    const x = points[3 * i], y = points[3 * i + 1], z = points[3 * i + 2];
    if (planes.some(([a, b, c, d]) => a * x + b * y + c * z - d > -1e-9)) kept.push(toVector(i));
  }
  return kept;
}

function convexPolygon2d(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Signed distance from q to the nearest edge of a counter-clockwise polygon;
// positive inside.
function insetDistance(polygon, q) {
  let inset = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    inset = Math.min(inset, (ex * (q[1] - a[1]) - ey * (q[0] - a[0])) / Math.hypot(ex, ey));
  }
  return inset;
}

// points: flat world-space xyz. triangles: optional flat vertex indices, used
// to weight the centre of mass by surface area rather than vertex density.
export function findRestingPlanes(points, triangles = null, { coplanarDeg = 6 } = {}) {
  const count = Math.floor(points.length / 3);
  if (count < 4) return null;
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity), v = new Vector3();
  for (let i = 0; i < count; i++) { v.fromArray(points, 3 * i); min.min(v); max.max(v); }
  const size = max.distanceTo(min);
  if (!(size > 0)) return null;
  const com = new Vector3();
  let weight = 0;
  if (triangles?.length) {
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), e1 = new Vector3(), e2 = new Vector3();
    for (let t = 0; t < triangles.length; t += 3) {
      a.fromArray(points, 3 * triangles[t]); b.fromArray(points, 3 * triangles[t + 1]); c.fromArray(points, 3 * triangles[t + 2]);
      const area = e1.subVectors(b, a).cross(e2.subVectors(c, a)).length() / 2;
      com.addScaledVector(a, area / 3).addScaledVector(b, area / 3).addScaledVector(c, area / 3);
      weight += area;
    }
  }
  if (!(weight > 0)) { for (let i = 0; i < count; i++) com.add(v.fromArray(points, 3 * i)); weight = count; }
  com.divideScalar(weight);

  const hull = new ConvexHull().setFromPoints(hullCandidates(points));
  const faces = hull.faces.map(face => {
    const corners = []; let edge = face.edge;
    do { corners.push(edge.head().point); edge = edge.next; } while (edge !== face.edge);
    return { normal: face.normal, area: face.area, corners };
  }).sort((a, b) => b.area - a.area);
  const hullPoints = [...new Set(faces.flatMap(face => face.corners))].flatMap(point => [point.x, point.y, point.z]);

  const coplanarCos = Math.cos(coplanarDeg * Math.PI / 180), used = new Set(), patches = [];
  for (let i = 0; i < faces.length; i++) {
    if (used.has(i)) continue;
    const n = faces[i].normal, members = [i];
    for (let k = i + 1; k < faces.length; k++) if (!used.has(k) && faces[k].normal.dot(n) > coplanarCos) members.push(k);
    const support = Math.max(...members.flatMap(m => faces[m].corners.map(p => p.dot(n))));
    const onPlane = members.filter(m => faces[m].corners.every(p => support - p.dot(n) < 0.01 * size));
    onPlane.forEach(m => used.add(m));
    const corners = onPlane.flatMap(m => faces[m].corners);
    const u = new Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
    const w = new Vector3().crossVectors(n, u);
    const polygon = convexPolygon2d(corners.map(p => [p.dot(u), p.dot(w)]));
    if (polygon.length < 3) continue;
    let area = 0;
    for (let k = 0; k < polygon.length; k++) { const a = polygon[k], b = polygon[(k + 1) % polygon.length]; area += a[0] * b[1] - a[1] * b[0]; }
    const center = corners.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(corners.length);
    patches.push({
      normal: n.toArray(),
      center: center.toArray(),
      tiltDeg: Math.acos(Math.max(-1, Math.min(1, -n.y))) * 180 / Math.PI,
      relArea: Math.abs(area) / 2 / (size * size),
      stableMargin: insetDistance(polygon, [com.dot(u), com.dot(w)]) / size,
    });
  }
  return { size, com: com.toArray(), hullPoints, patches };
}

export function chooseLevelingPlane(analysis, options = {}) {
  const { levelTolDeg, maxTiltDeg, minRelArea, minMargin } = { ...LEVELING_DEFAULTS, ...options };
  if (!analysis) return { reason: 'no-geometry', plane: null };
  const bases = analysis.patches.filter(p => p.relArea >= minRelArea && p.stableMargin >= minMargin);
  const level = bases.find(p => p.tiltDeg <= levelTolDeg);
  if (level) return { reason: 'already-level', plane: level };
  const candidates = bases.filter(p => p.tiltDeg <= maxTiltDeg)
    .sort((a, b) => a.tiltDeg - b.tiltDeg || b.relArea * b.stableMargin - a.relArea * a.stableMargin);
  return candidates.length ? { reason: 'level', plane: candidates[0] } : { reason: 'no-obvious-base', plane: null };
}

// World-space change that turns `plane` straight down about its centre and
// then drops the hull onto groundY. Returns a Matrix4 to premultiply onto the
// object's world matrix.
export function levelingWorldDelta({ plane = null, hullPoints, groundY }) {
  const delta = new Matrix4();
  if (plane) {
    const pivot = new Vector3().fromArray(plane.center);
    const turn = new Quaternion().setFromUnitVectors(new Vector3().fromArray(plane.normal).normalize(), new Vector3(0, -1, 0));
    delta.makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(new Matrix4().makeRotationFromQuaternion(turn))
      .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  }
  let lowest = Infinity;
  const v = new Vector3();
  for (let i = 0; i < hullPoints.length; i += 3) lowest = Math.min(lowest, v.fromArray(hullPoints, i).applyMatrix4(delta).y);
  if (Number.isFinite(lowest)) delta.premultiply(new Matrix4().makeTranslation(0, groundY - lowest, 0));
  return delta;
}
