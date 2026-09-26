const LEAF_SIZE = 8;
const finite3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (v) => Math.hypot(v[0], v[1], v[2]);
function bounds(items, select, useMax) {
  const result = [0, 1, 2].map(() => useMax ? -Infinity : Infinity);
  for (const item of items) {
    const value = select(item);
    for (let axis = 0; axis < 3; axis += 1) result[axis] = useMax
      ? Math.max(result[axis], value[axis]) : Math.min(result[axis], value[axis]);
  }
  return result;
}

export function buildTriangleVisibility(triangles) {
  if (!Array.isArray(triangles)) throw new TypeError('triangles must be an array');
  const records = triangles.map((source, triangleIndex) => {
    if (!source || !finite3(source.a) || !finite3(source.b) || !finite3(source.c)) {
      throw new TypeError(`triangle ${triangleIndex} vertices must contain finite 3D coordinates`);
    }
    const edge1 = sub(source.b, source.a);
    const edge2 = sub(source.c, source.a);
    const rawNormal = cross(edge1, edge2);
    const normalLength = length(rawNormal);
    if (!Number.isFinite(normalLength) || normalLength === 0) throw new RangeError(`triangle ${triangleIndex} is degenerate`);
    const points = [source.a.slice(), source.b.slice(), source.c.slice()];
    const boundsMin = [0, 1, 2].map((axis) => Math.min(...points.map((p) => p[axis])));
    const boundsMax = [0, 1, 2].map((axis) => Math.max(...points.map((p) => p[axis])));
    return {
      triangleIndex, identity: source.identity, materialIndex: source.materialIndex,
      points, edge1, edge2, edge1Length: length(edge1), edge2Length: length(edge2),
      normal: rawNormal.map((v) => v / normalLength), boundsMin, boundsMax,
      centroid: [0, 1, 2].map((axis) => (points[0][axis] + points[1][axis] + points[2][axis]) / 3),
    };
  });
  let nodeCount = 0;
  function build(items) {
    nodeCount += 1;
    const min = bounds(items, (t) => t.boundsMin, false);
    const max = bounds(items, (t) => t.boundsMax, true);
    if (items.length <= LEAF_SIZE) return { min, max, items };
    const centroidMin = bounds(items, (t) => t.centroid, false);
    const centroidMax = bounds(items, (t) => t.centroid, true);
    let axis = 0;
    if (centroidMax[1] - centroidMin[1] > centroidMax[axis] - centroidMin[axis]) axis = 1;
    if (centroidMax[2] - centroidMin[2] > centroidMax[axis] - centroidMin[axis]) axis = 2;
    items.sort((a, b) => a.centroid[axis] - b.centroid[axis] || a.triangleIndex - b.triangleIndex);
    const middle = Math.floor(items.length / 2);
    return { min, max, left: build(items.slice(0, middle)), right: build(items.slice(middle)) };
  }
  const root = records.length ? build(records) : null;

  function trace(origin, direction, { minDistance = 0, maxDistance = Infinity } = {}) {
    if (!finite3(origin) || !finite3(direction)) throw new TypeError('origin and direction must be finite 3D vectors');
    if (!Number.isFinite(minDistance) || minDistance < 0 || !(maxDistance >= minDistance)) {
      throw new RangeError('distance bounds must satisfy 0 <= minDistance <= maxDistance');
    }
    const directionLength = length(direction);
    if (!Number.isFinite(directionLength) || directionLength === 0) throw new RangeError('direction must be nonzero');
    const ray = direction.map((v) => v / directionLength);
    let closest = maxDistance;
    let result = null;
    const boundsHit = (node) => {
      let near = minDistance;
      let far = closest;
      for (let axis = 0; axis < 3; axis += 1) {
        if (ray[axis] === 0) {
          if (origin[axis] < node.min[axis] || origin[axis] > node.max[axis]) return false;
        } else {
          let a = (node.min[axis] - origin[axis]) / ray[axis];
          let b = (node.max[axis] - origin[axis]) / ray[axis];
          if (a > b) [a, b] = [b, a];
          near = Math.max(near, a);
          far = Math.min(far, b);
          if (near > far) return false;
        }
      }
      return true;
    };
    const visit = (node) => {
      if (!node || !boundsHit(node)) return;
      if (node.items) {
        for (const t of node.items) {
          const p = cross(ray, t.edge2);
          const determinant = dot(t.edge1, p);
          const parallelTolerance = Number.EPSILON * 8 * t.edge1Length * t.edge2Length;
          if (Math.abs(determinant) <= parallelTolerance) continue;
          const inverse = 1 / determinant;
          const fromA = sub(origin, t.points[0]);
          const u = dot(fromA, p) * inverse;
          if (u < 0 || u > 1) continue;
          const q = cross(fromA, t.edge1);
          const v = dot(ray, q) * inverse;
          if (v < 0 || u + v > 1) continue;
          const distance = dot(t.edge2, q) * inverse;
          if (distance < minDistance || distance >= closest) continue;
          closest = distance;
          result = {
            distance, triangleIndex: t.triangleIndex, identity: t.identity,
            position: [0, 1, 2].map((axis) => origin[axis] + ray[axis] * distance),
            normal: t.normal.slice(), barycentric: [1 - u - v, u, v], materialIndex: t.materialIndex,
          };
        }
      } else {
        visit(node.left);
        visit(node.right);
      }
    };
    visit(root);
    return result;
  }
  return Object.freeze({ trace, triangleCount: records.length, nodeCount });
}
