/**
 * Part-aware low-frequency envelope compilation.
 *
 * The prior compiler is a morphological closing over an undifferentiated point
 * cloud: sample every admitted surface, voxel-bin the samples, place one
 * metaball of fixed radius per occupied voxel, march the union. Measured
 * against the source it inverts the authored mass argument -- fore/aft ratio
 * 0.571 -> 2.925, centroid station 0.374 -> 0.645 -- because a single global
 * radius swallows thin structures and inflates bulk ones. The body's posterior
 * argument lives in its folded rear limb chain, so losing thin structures moves
 * the mass forward.
 *
 * The fix is not a better radius. It is per-part identity: each authored part
 * keeps its own identity through compilation and receives a closing radius
 * scaled to its own local thickness, so a rib and a femur are not smoothed by
 * the same kernel. Source identity survives into the emitted element set, which
 * is also what a correspondence claim will later require.
 *
 * This module is pure geometry. It emits an element plan -- centers, radii, and
 * the source part each element came from -- which a Blender stage converts into
 * a marched surface. Keeping the plan pure means it is testable without
 * Blender.
 */

/**
 * Partition a mesh into connected components by shared vertex index.
 *
 * Each authored anatomical mesh arrives as its own object, but this operates on
 * the merged payload, so components recover part boundaries without depending
 * on naming or collection conventions -- neither of which encodes anatomy in
 * the current source.
 */
export function connectedComponents(mesh) {
  const { positions, triangles } = mesh;
  if (!Array.isArray(positions) || !Array.isArray(triangles)) {
    throw new Error('mesh must supply positions and triangles');
  }
  if (triangles.length === 0) {
    throw new Error('mesh contains no triangles');
  }

  const parent = new Int32Array(positions.length);
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;

  const find = (a) => {
    let root = a;
    while (parent[root] !== root) root = parent[root];
    while (parent[a] !== root) {
      const next = parent[a];
      parent[a] = root;
      a = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (const [a, b, c] of triangles) {
    if (positions[a] === undefined || positions[b] === undefined || positions[c] === undefined) {
      throw new Error('triangle references a missing vertex');
    }
    union(a, b);
    union(b, c);
  }

  const byRoot = new Map();
  for (const triangle of triangles) {
    const root = find(triangle[0]);
    let bucket = byRoot.get(root);
    if (!bucket) {
      bucket = { triangles: [], vertices: new Set() };
      byRoot.set(root, bucket);
    }
    bucket.triangles.push(triangle);
    bucket.vertices.add(triangle[0]);
    bucket.vertices.add(triangle[1]);
    bucket.vertices.add(triangle[2]);
  }

  return [...byRoot.values()].map((bucket, index) => ({
    index,
    triangles: bucket.triangles,
    vertexIndices: [...bucket.vertices],
  }));
}

function boundsOf(positions, vertexIndices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const index of vertexIndices) {
    const p = positions[index];
    for (let axis = 0; axis < 3; axis += 1) {
      if (p[axis] < min[axis]) min[axis] = p[axis];
      if (p[axis] > max[axis]) max[axis] = p[axis];
    }
  }
  return { min, max };
}

/**
 * Local thickness proxy for a part: its second-smallest bounding extent.
 *
 * The smallest extent alone is fragile for a flat part such as a scapular
 * blade, where one axis is genuinely near zero. The second-smallest tracks the
 * cross-section a closing kernel must not erase, so a long thin bone and a
 * broad flat one are each handled on their own terms.
 */
export function partThickness(positions, vertexIndices) {
  const { min, max } = boundsOf(positions, vertexIndices);
  const extents = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].sort((a, b) => a - b);
  return extents[1];
}

/**
 * Plan envelope elements per part.
 *
 * Each part is sampled at a spacing derived from its own thickness and receives
 * a radius derived from the same, bounded by explicit floor and ceiling
 * fractions of the whole-body diagonal so one degenerate part cannot dominate
 * the field or vanish from it.
 *
 * Every emitted element carries its source part index. Identity survives
 * compilation; that is the point.
 */
export function planPartAwareElements(mesh, {
  radiusFraction = 0.55,
  minRadiusFraction = 0.004,
  maxRadiusFraction = 0.020,
  samplesPerRadius = 1.6,
} = {}) {
  const { positions } = mesh;
  const parts = connectedComponents(mesh);

  const whole = boundsOf(positions, positions.map((_, i) => i));
  const diagonal = Math.hypot(
    whole.max[0] - whole.min[0],
    whole.max[1] - whole.min[1],
    whole.max[2] - whole.min[2],
  );
  if (!(diagonal > 0)) throw new Error('mesh bounds are degenerate');

  const minRadius = diagonal * minRadiusFraction;
  const maxRadius = diagonal * maxRadiusFraction;
  if (!(minRadius <= maxRadius)) {
    throw new Error('minRadiusFraction must not exceed maxRadiusFraction');
  }

  const elements = [];
  const partRecords = [];

  for (const part of parts) {
    const thickness = partThickness(positions, part.vertexIndices);
    const radius = Math.min(maxRadius, Math.max(minRadius, thickness * radiusFraction));
    const spacing = radius / samplesPerRadius;

    const buckets = new Map();
    for (const [ia, ib, ic] of part.triangles) {
      const a = positions[ia];
      const b = positions[ib];
      const c = positions[ic];
      const longest = Math.max(
        Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
        Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]),
        Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]),
      );
      const subdivisions = Math.max(1, Math.min(24, Math.ceil(longest / spacing)));
      for (let i = 0; i <= subdivisions; i += 1) {
        for (let j = 0; j <= subdivisions - i; j += 1) {
          const u = i / subdivisions;
          const v = j / subdivisions;
          const point = [
            a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v,
            a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v,
            a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v,
          ];
          const key = `${Math.floor(point[0] / spacing)},${Math.floor(point[1] / spacing)},${Math.floor(point[2] / spacing)}`;
          const existing = buckets.get(key);
          if (existing) {
            existing.sum[0] += point[0];
            existing.sum[1] += point[1];
            existing.sum[2] += point[2];
            existing.count += 1;
          } else {
            buckets.set(key, { sum: [...point], count: 1 });
          }
        }
      }
    }

    if (buckets.size === 0) {
      throw new Error(`part ${part.index} produced no envelope elements`);
    }

    for (const bucket of [...buckets.values()]) {
      elements.push({
        center: [
          bucket.sum[0] / bucket.count,
          bucket.sum[1] / bucket.count,
          bucket.sum[2] / bucket.count,
        ],
        radius,
        partIndex: part.index,
      });
    }

    partRecords.push({
      partIndex: part.index,
      triangleCount: part.triangles.length,
      vertexCount: part.vertexIndices.length,
      thickness,
      radius,
      radiusClamped: radius === minRadius || radius === maxRadius,
      elementCount: buckets.size,
    });
  }

  return {
    diagonal,
    minRadius,
    maxRadius,
    parts: partRecords,
    elements,
  };
}
