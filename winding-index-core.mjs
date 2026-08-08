// Fast generalized winding number (hierarchical dipole approximation in the
// style of Barill et al.): BVH over triangles; far nodes contribute their
// aggregated area-weighted normal as a single dipole, near nodes recurse to
// exact per-triangle solid angles. Needed because exact winding is O(tris)
// per query and the Trellis casts carry ~200k triangles.
//
// The inside threshold matches frame-link-core's exact test: |w| > 0.25,
// tolerant of the authored assets' mixed face orientation.

export function buildWindingIndex(geometry, { leafSize = 24, beta = 2.0 } = {}) {
  const { positions, triangles } = geometry;
  const triCount = triangles.length / 3;

  const centroids = new Float64Array(triCount * 3);
  const areaNormals = new Float64Array(triCount * 3); // 0.5 * cross = area-weighted normal
  for (let t = 0; t < triCount; t += 1) {
    const a = triangles[t * 3] * 3; const b = triangles[t * 3 + 1] * 3; const c = triangles[t * 3 + 2] * 3;
    for (let k = 0; k < 3; k += 1) {
      centroids[t * 3 + k] = (positions[a + k] + positions[b + k] + positions[c + k]) / 3;
    }
    const ux = positions[b] - positions[a]; const uy = positions[b + 1] - positions[a + 1]; const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a]; const vy = positions[c + 1] - positions[a + 1]; const vz = positions[c + 2] - positions[a + 2];
    areaNormals[t * 3] = 0.5 * (uy * vz - uz * vy);
    areaNormals[t * 3 + 1] = 0.5 * (uz * vx - ux * vz);
    areaNormals[t * 3 + 2] = 0.5 * (ux * vy - uy * vx);
  }

  const order = Uint32Array.from({ length: triCount }, (_, i) => i);
  const nodes = [];
  const build = (start, end) => {
    const index = nodes.length;
    const node = {
      start, end, left: -1, right: -1,
      center: [0, 0, 0], normal: [0, 0, 0], radius: 0,
    };
    nodes.push(node);
    let areaSum = 0;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i += 1) {
      const t = order[i];
      const area = Math.hypot(areaNormals[t * 3], areaNormals[t * 3 + 1], areaNormals[t * 3 + 2]) || 1e-18;
      areaSum += area;
      for (let k = 0; k < 3; k += 1) {
        node.center[k] += centroids[t * 3 + k] * area;
        node.normal[k] += areaNormals[t * 3 + k];
        min[k] = Math.min(min[k], centroids[t * 3 + k]);
        max[k] = Math.max(max[k], centroids[t * 3 + k]);
      }
    }
    for (let k = 0; k < 3; k += 1) node.center[k] /= areaSum || 1;
    // Conservative radius: farthest triangle VERTEX from the node center.
    let radiusSq = 0;
    for (let i = start; i < end; i += 1) {
      const t = order[i];
      for (const vi of [triangles[t * 3], triangles[t * 3 + 1], triangles[t * 3 + 2]]) {
        const dx = positions[vi * 3] - node.center[0];
        const dy = positions[vi * 3 + 1] - node.center[1];
        const dz = positions[vi * 3 + 2] - node.center[2];
        radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
      }
    }
    node.radius = Math.sqrt(radiusSq);
    if (end - start > leafSize) {
      let axis = 0; let spread = -Infinity;
      for (let k = 0; k < 3; k += 1) {
        if (max[k] - min[k] > spread) { spread = max[k] - min[k]; axis = k; }
      }
      const slice = Array.from(order.subarray(start, end));
      slice.sort((p, q) => centroids[p * 3 + axis] - centroids[q * 3 + axis]);
      order.set(slice, start);
      const mid = (start + end) >> 1;
      node.left = build(start, mid);
      node.right = build(mid, end);
    }
    return index;
  };
  if (triCount > 0) build(0, triCount);

  const exactTriangle = (t, px, py, pz) => {
    const ia = triangles[t * 3] * 3; const ib = triangles[t * 3 + 1] * 3; const ic = triangles[t * 3 + 2] * 3;
    const ax = positions[ia] - px; const ay = positions[ia + 1] - py; const az = positions[ia + 2] - pz;
    const bx = positions[ib] - px; const by = positions[ib + 1] - py; const bz = positions[ib + 2] - pz;
    const cx = positions[ic] - px; const cy = positions[ic + 1] - py; const cz = positions[ic + 2] - pz;
    const la = Math.hypot(ax, ay, az); const lb = Math.hypot(bx, by, bz); const lc = Math.hypot(cx, cy, cz);
    const num = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    const den = la * lb * lc
      + (ax * bx + ay * by + az * bz) * lc
      + (bx * cx + by * cy + bz * cz) * la
      + (ax * cx + ay * cy + az * cz) * lb;
    return Math.atan2(num, den);
  };

  const windingAt = (px, py, pz) => {
    let w = 0;
    const stack = [0];
    while (stack.length) {
      const node = nodes[stack.pop()];
      if (!node) continue;
      const dx = node.center[0] - px; const dy = node.center[1] - py; const dz = node.center[2] - pz;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > beta * node.radius && dist > 1e-12) {
        // Far: dipole approximation, solid angle of aggregated normal.
        w += (node.normal[0] * dx + node.normal[1] * dy + node.normal[2] * dz)
          / (2 * dist * dist * dist); // atan-free far field: A.d/(4pi r^3) * 2pi normalization below
        continue;
      }
      if (node.left === -1) {
        for (let i = node.start; i < node.end; i += 1) w += exactTriangle(order[i], px, py, pz);
      } else {
        stack.push(node.left, node.right);
      }
    }
    return w / (2 * Math.PI);
  };

  return {
    winding: windingAt,
    inside: (px, py, pz) => Math.abs(windingAt(px, py, pz)) > 0.25,
  };
}
