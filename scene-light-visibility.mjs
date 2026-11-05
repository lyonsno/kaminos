const LEAF_SIZE = 8;
const finite3 = (v) => Array.isArray(v) && v.length === 3 && Number.isFinite(v[0] + v[1] + v[2]);

export function buildTriangleVisibility(triangles) {
  if (!Array.isArray(triangles)) throw new TypeError('triangles must be an array');
  const n = triangles.length;
  const p0x = new Float64Array(n), p0y = new Float64Array(n), p0z = new Float64Array(n);
  const e1x = new Float64Array(n), e1y = new Float64Array(n), e1z = new Float64Array(n);
  const e2x = new Float64Array(n), e2y = new Float64Array(n), e2z = new Float64Array(n);
  const bMinX = new Float64Array(n), bMinY = new Float64Array(n), bMinZ = new Float64Array(n);
  const bMaxX = new Float64Array(n), bMaxY = new Float64Array(n), bMaxZ = new Float64Array(n);
  const cX = new Float64Array(n), cY = new Float64Array(n), cZ = new Float64Array(n);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const source = triangles[i];
    if (!source || !finite3(source.a) || !finite3(source.b) || !finite3(source.c)) {
      throw new TypeError(`triangle ${i} vertices must contain finite 3D coordinates`);
    }
    const ax = source.a[0], ay = source.a[1], az = source.a[2];
    const bx = source.b[0], by = source.b[1], bz = source.b[2];
    const cx = source.c[0], cy = source.c[1], cz = source.c[2];
    const u0 = bx - ax, u1 = by - ay, u2 = bz - az;
    const v0 = cx - ax, v1 = cy - ay, v2 = cz - az;
    const rnx = u1 * v2 - u2 * v1, rny = u2 * v0 - u0 * v2, rnz = u0 * v1 - u1 * v0;
    const normalLength = Math.hypot(rnx, rny, rnz);
    if (!Number.isFinite(normalLength) || normalLength === 0) throw new RangeError(`triangle ${i} is degenerate`);
    p0x[i] = ax; p0y[i] = ay; p0z[i] = az;
    e1x[i] = u0; e1y[i] = u1; e1z[i] = u2;
    e2x[i] = v0; e2y[i] = v1; e2z[i] = v2;
    bMinX[i] = ax < bx ? (ax < cx ? ax : cx) : (bx < cx ? bx : cx);
    bMinY[i] = ay < by ? (ay < cy ? ay : cy) : (by < cy ? by : cy);
    bMinZ[i] = az < bz ? (az < cz ? az : cz) : (bz < cz ? bz : cz);
    bMaxX[i] = ax > bx ? (ax > cx ? ax : cx) : (bx > cx ? bx : cx);
    bMaxY[i] = ay > by ? (ay > cy ? ay : cy) : (by > cy ? by : cy);
    bMaxZ[i] = az > bz ? (az > cz ? az : cz) : (bz > cz ? bz : cz);
    cX[i] = (ax + bx + cx) / 3;
    cY[i] = (ay + by + cy) / 3;
    cZ[i] = (az + bz + cz) / 3;
    order[i] = i;
  }
  const Cs = [cX, cY, cZ];
  function selectNth(C, start, end, k) {
    let l = start, r = end - 1;
    while (l < r) {
      const mid = (l + r) >> 1;
      let p = order[mid];
      const pl = order[l], pr = order[r];
      const cl = C[pl], cm = C[p], cr = C[pr];
      if ((cl < cm || (cl === cm && pl < p)) !== (cl < cr || (cl === cr && pl < pr))) p = pl;
      else if ((cr < cm || (cr === cm && pr < p)) !== (cr < cl || (cr === cl && pr < pl))) p = pr;
      const pv = C[p];
      let i = l, j = r;
      while (i <= j) {
        while (C[order[i]] < pv || (C[order[i]] === pv && order[i] < p)) i++;
        while (C[order[j]] > pv || (C[order[j]] === pv && order[j] > p)) j--;
        if (i <= j) {
          const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
          i++; j--;
        }
      }
      if (k <= j) r = j;
      else if (k >= i) l = i;
      else break;
    }
  }
  function sortLeaf(C, start, end) {
    for (let i = start + 1; i < end; i++) {
      const v = order[i], cv = C[v];
      let j = i - 1;
      while (j >= start && (C[order[j]] > cv || (C[order[j]] === cv && order[j] > v))) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = v;
    }
  }
  const maxNodes = n ? Math.max(1, 2 * Math.ceil(n / 4)) : 1;
  const nodeMin = new Float64Array(maxNodes * 3), nodeMax = new Float64Array(maxNodes * 3);
  const nodeEscape = new Uint32Array(maxNodes), nodeStart = new Uint32Array(maxNodes), nodeLen = new Uint32Array(maxNodes);
  let nodeCount = 0;
  function build(start, end) {
    const id = nodeCount++, base = id * 3, len = end - start;
    let min0 = Infinity, min1 = Infinity, min2 = Infinity;
    let max0 = -Infinity, max1 = -Infinity, max2 = -Infinity;
    if (len <= LEAF_SIZE) {
      for (let k = start; k < end; k++) {
        const i = order[k];
        if (bMinX[i] < min0) min0 = bMinX[i]; if (bMinY[i] < min1) min1 = bMinY[i]; if (bMinZ[i] < min2) min2 = bMinZ[i];
        if (bMaxX[i] > max0) max0 = bMaxX[i]; if (bMaxY[i] > max1) max1 = bMaxY[i]; if (bMaxZ[i] > max2) max2 = bMaxZ[i];
      }
      nodeMin[base] = min0; nodeMin[base + 1] = min1; nodeMin[base + 2] = min2;
      nodeMax[base] = max0; nodeMax[base + 1] = max1; nodeMax[base + 2] = max2;
      nodeStart[id] = start; nodeLen[id] = len; nodeEscape[id] = nodeCount;
      return;
    }
    let cMin0 = Infinity, cMin1 = Infinity, cMin2 = Infinity;
    let cMax0 = -Infinity, cMax1 = -Infinity, cMax2 = -Infinity;
    for (let k = start; k < end; k++) {
      const i = order[k];
      if (bMinX[i] < min0) min0 = bMinX[i]; if (bMinY[i] < min1) min1 = bMinY[i]; if (bMinZ[i] < min2) min2 = bMinZ[i];
      if (bMaxX[i] > max0) max0 = bMaxX[i]; if (bMaxY[i] > max1) max1 = bMaxY[i]; if (bMaxZ[i] > max2) max2 = bMaxZ[i];
      if (cX[i] < cMin0) cMin0 = cX[i]; if (cY[i] < cMin1) cMin1 = cY[i]; if (cZ[i] < cMin2) cMin2 = cZ[i];
      if (cX[i] > cMax0) cMax0 = cX[i]; if (cY[i] > cMax1) cMax1 = cY[i]; if (cZ[i] > cMax2) cMax2 = cZ[i];
    }
    nodeMin[base] = min0; nodeMin[base + 1] = min1; nodeMin[base + 2] = min2;
    nodeMax[base] = max0; nodeMax[base + 1] = max1; nodeMax[base + 2] = max2;
    let axis = 0, span = cMax0 - cMin0;
    if (cMax1 - cMin1 > span) { axis = 1; span = cMax1 - cMin1; }
    if (cMax2 - cMin2 > span) { axis = 2; }
    const C = Cs[axis], middle = start + (len >> 1);
    selectNth(C, start, end, middle);
    if (middle - start <= LEAF_SIZE) sortLeaf(C, start, middle);
    if (end - middle <= LEAF_SIZE) sortLeaf(C, middle, end);
    build(start, middle);
    build(middle, end);
    nodeEscape[id] = nodeCount;
  }
  if (n) build(0, n);

  function trace(origin, direction, { minDistance = 0, maxDistance = Infinity } = {}) {
    if (!finite3(origin) || !finite3(direction)) throw new TypeError('origin and direction must be finite 3D vectors');
    if (!Number.isFinite(minDistance) || minDistance < 0 || !(maxDistance >= minDistance)) {
      throw new RangeError('distance bounds must satisfy 0 <= minDistance <= maxDistance');
    }
    const directionLength = Math.hypot(direction[0], direction[1], direction[2]);
    if (!Number.isFinite(directionLength) || directionLength === 0) throw new RangeError('direction must be nonzero');
    const rx = direction[0] / directionLength, ry = direction[1] / directionLength, rz = direction[2] / directionLength;
    const ox = origin[0], oy = origin[1], oz = origin[2], ray = [rx, ry, rz];
    let closest = maxDistance, result = null;
    for (let id = 0; id < nodeCount; ) {
      const b = id * 3;
      let near = minDistance, far = closest, hit = true;
      for (let axis = 0; axis < 3; axis++) {
        const d = ray[axis], o = origin[axis], lo = nodeMin[b + axis], hi = nodeMax[b + axis];
        if (d === 0) {
          if (o < lo || o > hi) { hit = false; break; }
        } else {
          let t0 = (lo - o) / d, t1 = (hi - o) / d;
          if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
          if (t0 > near) near = t0;
          if (t1 < far) far = t1;
          if (near > far) { hit = false; break; }
        }
      }
      if (!hit) { id = nodeEscape[id]; continue; }
      const len = nodeLen[id];
      if (len) {
        const start = nodeStart[id];
        for (let k = start; k < start + len; k++) {
          const i = order[k];
          const u0 = e1x[i], u1 = e1y[i], u2 = e1z[i], v0 = e2x[i], v1 = e2y[i], v2 = e2z[i];
          const px = ry * v2 - rz * v1, py = rz * v0 - rx * v2, pz = rx * v1 - ry * v0;
          const det = u0 * px + u1 * py + u2 * pz;
          const tol = Number.EPSILON * 8 * Math.hypot(u0, u1, u2) * Math.hypot(v0, v1, v2);
          if (Math.abs(det) <= tol) continue;
          const inv = 1 / det;
          const sx = ox - p0x[i], sy = oy - p0y[i], sz = oz - p0z[i];
          const u = (sx * px + sy * py + sz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = sy * u2 - sz * u1, qy = sz * u0 - sx * u2, qz = sx * u1 - sy * u0;
          const v = (rx * qx + ry * qy + rz * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const distance = (v0 * qx + v1 * qy + v2 * qz) * inv;
          if (distance < minDistance || distance >= closest) continue;
          closest = distance;
          const rnx = u1 * v2 - u2 * v1, rny = u2 * v0 - u0 * v2, rnz = u0 * v1 - u1 * v0;
          const nl = Math.hypot(rnx, rny, rnz);
          const src = triangles[i];
          result = {
            distance, triangleIndex: i, identity: src.identity,
            position: [ox + rx * distance, oy + ry * distance, oz + rz * distance],
            normal: [rnx / nl, rny / nl, rnz / nl],
            barycentric: [1 - u - v, u, v], materialIndex: src.materialIndex,
          };
        }
      }
      id++;
    }
    return result;
  }
  function packGpu() {
    // Preorder + escape index permits stackless GPU traversal. Leaf triangle
    // order is explicit; no geometry or winding information is discarded.
    const nodes = new Float32Array(Math.max(1, nodeCount) * 12);
    const words = new Uint32Array(nodes.buffer);
    const trisOut = new Float32Array(Math.max(1, n) * 12);
    for (let id = 0; id < nodeCount; id++) {
      const at = id * 12, b = id * 3;
      nodes[at] = nodeMin[b]; nodes[at + 1] = nodeMin[b + 1]; nodes[at + 2] = nodeMin[b + 2];
      nodes[at + 4] = nodeMax[b]; nodes[at + 5] = nodeMax[b + 1]; nodes[at + 6] = nodeMax[b + 2];
      words[at + 8] = nodeEscape[id];
      if (nodeLen[id]) { words[at + 9] = nodeStart[id]; words[at + 10] = nodeLen[id]; }
    }
    for (let k = 0; k < n; k++) {
      const i = order[k], offset = k * 12;
      trisOut[offset] = p0x[i]; trisOut[offset + 1] = p0y[i]; trisOut[offset + 2] = p0z[i];
      trisOut[offset + 4] = e1x[i]; trisOut[offset + 5] = e1y[i]; trisOut[offset + 6] = e1z[i];
      trisOut[offset + 8] = e2x[i]; trisOut[offset + 9] = e2y[i]; trisOut[offset + 10] = e2z[i];
    }
    return { nodes, triangles: trisOut, nodeCount, triangleCount: n, triangleIndices: order.slice() };
  }
  return Object.freeze({ trace, packGpu, triangleCount: n, nodeCount });
}
