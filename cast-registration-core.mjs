// Stage A of the cast-correspondence registration instrument.
//
// Solves a similarity transform (uniform scale + rotation + translation)
// registering an authored envelope onto a generated/reconstructed cast, and
// emits a content-addressed transform receipt. The receipt is the shared
// substrate consumed by the registration-success measure and by Stage B
// correspondence mapping.
//
// Design commitments:
// - Fit-based registration only. No longest-extent or heuristic axis frames.
// - Deterministic end to end: seeded low-discrepancy sampling, no wall-clock
//   in the receipt identity, identical inputs -> identical identity.
// - Similarity class only at Stage A. Non-uniform shape differences must
//   surface as residual, never be absorbed (2x2 laundering guard).
// - Fail loud with named phases; a run that cannot produce its receipt still
//   writes a durable failure report.
// - `refinements` carries the future bounded per-limb corrections (ankle
//   first); Stage A global-only receipts declare it empty rather than
//   omitting it.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export const CAST_REGISTRATION_RECEIPT_SCHEMA = 'kaminos.cast-registration-receipt.v0';

// --- GLB parsing ------------------------------------------------------------

const COMPONENT_ARRAYS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};

const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function matMul(a, b) {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function nodeLocalMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx; const y2 = qy + qy; const z2 = qz + qz;
  const xx = qx * x2; const xy = qx * y2; const xz = qx * z2;
  const yy = qy * y2; const yz = qy * z2; const zz = qz * z2;
  const wx = qw * x2; const wy = qw * y2; const wz = qw * z2;
  // Column-major, glTF convention.
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function accessorData(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const ArrayType = COMPONENT_ARRAYS[accessor.componentType];
  const components = TYPE_COMPONENTS[accessor.type];
  if (!ArrayType || !components) {
    throw new Error(`parse-glb: unsupported accessor ${accessor.componentType}/${accessor.type}`);
  }
  const view = gltf.bufferViews[accessor.bufferView];
  const byteOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride;
  if (stride && stride !== components * ArrayType.BYTES_PER_ELEMENT) {
    const out = new ArrayType(accessor.count * components);
    for (let i = 0; i < accessor.count; i += 1) {
      const elem = new ArrayType(bin.buffer, bin.byteOffset + byteOffset + i * stride, components);
      out.set(elem, i * components);
    }
    return out;
  }
  return new ArrayType(bin.buffer, bin.byteOffset + byteOffset, accessor.count * components);
}

export function parseGlbGeometry(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('parse-glb: not a GLB container');
  }
  let offset = 12;
  let gltf = null;
  let bin = null;
  while (offset + 8 <= buf.length) {
    const chunkLength = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const chunk = buf.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 0x4e4f534a) gltf = JSON.parse(chunk.toString('utf8'));
    else if (chunkType === 0x004e4942) bin = chunk;
    offset += 8 + chunkLength + ((4 - (chunkLength % 4)) % 4) * 0;
    offset += (4 - ((8 + chunkLength) % 4)) % 4 === 0 ? 0 : 0; // chunks are 4-aligned by spec
  }
  if (!gltf) throw new Error('parse-glb: missing JSON chunk');
  const positions = [];
  const triangles = [];
  const visit = (nodeIndex, parentMatrix) => {
    const node = gltf.nodes[nodeIndex];
    const world = matMul(parentMatrix, nodeLocalMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes[node.mesh];
      for (const primitive of mesh.primitives ?? []) {
        if (primitive.mode !== undefined && primitive.mode !== 4) continue;
        if (primitive.attributes?.POSITION === undefined) continue;
        const local = accessorData(gltf, bin, primitive.attributes.POSITION);
        const base = positions.length / 3;
        for (let i = 0; i < local.length; i += 3) {
          const x = local[i]; const y = local[i + 1]; const z = local[i + 2];
          positions.push(
            world[0] * x + world[4] * y + world[8] * z + world[12],
            world[1] * x + world[5] * y + world[9] * z + world[13],
            world[2] * x + world[6] * y + world[10] * z + world[14],
          );
        }
        if (primitive.indices !== undefined) {
          const indices = accessorData(gltf, bin, primitive.indices);
          for (const index of indices) triangles.push(base + index);
        } else {
          for (let i = 0; i < local.length / 3; i += 1) triangles.push(base + i);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const roots = scene?.nodes ?? gltf.nodes?.map((_, i) => i) ?? [];
  const referenced = new Set();
  for (const node of gltf.nodes ?? []) for (const child of node.children ?? []) referenced.add(child);
  const effectiveRoots = scene?.nodes ?? roots.filter(i => !referenced.has(i));
  for (const root of effectiveRoots) visit(root, IDENTITY4);
  return {
    positions: Float64Array.from(positions),
    triangles: Uint32Array.from(triangles),
    vertexCount: positions.length / 3,
    triangleCount: triangles.length / 3,
  };
}

// --- geometry guards --------------------------------------------------------

function assertRegistrable(geometry, label) {
  if (!geometry || !geometry.positions || !geometry.triangles || geometry.triangles.length < 3) {
    throw new Error(`degenerate-geometry: ${label} has no triangles`);
  }
  for (let i = 0; i < geometry.positions.length; i += 1) {
    if (!Number.isFinite(geometry.positions[i])) {
      throw new Error(`non-finite-geometry: ${label} position ${i}`);
    }
  }
}

// --- deterministic area-weighted surface sampling ----------------------------

const PHI2 = 1.32471795724474602596; // plastic constant: 2D low-discrepancy

export function sampleSurface(geometry, sampleCount) {
  const { positions, triangles } = geometry;
  const triCount = triangles.length / 3;
  const cumulative = new Float64Array(triCount);
  let total = 0;
  for (let t = 0; t < triCount; t += 1) {
    const a = triangles[t * 3] * 3; const b = triangles[t * 3 + 1] * 3; const c = triangles[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a]; const uy = positions[b + 1] - positions[a + 1]; const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a]; const vy = positions[c + 1] - positions[a + 1]; const vz = positions[c + 2] - positions[a + 2];
    const cx = uy * vz - uz * vy; const cy = uz * vx - ux * vz; const cz = ux * vy - uy * vx;
    total += 0.5 * Math.hypot(cx, cy, cz);
    cumulative[t] = total;
  }
  if (!(total > 0)) throw new Error('degenerate-geometry: zero surface area');
  const samples = new Float64Array(sampleCount * 3);
  const a1 = 1 / PHI2; const a2 = 1 / (PHI2 * PHI2);
  for (let s = 0; s < sampleCount; s += 1) {
    const pick = ((s + 0.5) / sampleCount) * total;
    let lo = 0; let hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < pick) lo = mid + 1; else hi = mid;
    }
    let r1 = (0.5 + a1 * (s + 1)) % 1;
    let r2 = (0.5 + a2 * (s + 1)) % 1;
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    const w0 = 1 - r1 - r2;
    const t = lo;
    const a = triangles[t * 3] * 3; const b = triangles[t * 3 + 1] * 3; const c = triangles[t * 3 + 2] * 3;
    for (let k = 0; k < 3; k += 1) {
      samples[s * 3 + k] = w0 * positions[a + k] + r1 * positions[b + k] + r2 * positions[c + k];
    }
  }
  return samples;
}

// --- BVH nearest point-on-surface --------------------------------------------

function closestPointOnTriangle(px, py, pz, positions, ia, ib, ic) {
  const ax = positions[ia]; const ay = positions[ia + 1]; const az = positions[ia + 2];
  const bx = positions[ib]; const by = positions[ib + 1]; const bz = positions[ib + 2];
  const cx = positions[ic]; const cy = positions[ic + 1]; const cz = positions[ic + 2];
  const abx = bx - ax; const aby = by - ay; const abz = bz - az;
  const acx = cx - ax; const acy = cy - ay; const acz = cz - az;
  const apx = px - ax; const apy = py - ay; const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return [ax, ay, az];
  const bpx = px - bx; const bpy = py - by; const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return [bx, by, bz];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [ax + v * abx, ay + v * aby, az + v * abz];
  }
  const cpx = px - cx; const cpy = py - cy; const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return [cx, cy, cz];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [ax + w * acx, ay + w * acy, az + w * acz];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz)];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
}

export function buildSurfaceIndex(geometry) {
  const { positions, triangles } = geometry;
  const triCount = triangles.length / 3;
  const centroids = new Float64Array(triCount * 3);
  const bounds = new Float64Array(triCount * 6);
  for (let t = 0; t < triCount; t += 1) {
    const a = triangles[t * 3] * 3; const b = triangles[t * 3 + 1] * 3; const c = triangles[t * 3 + 2] * 3;
    for (let k = 0; k < 3; k += 1) {
      const va = positions[a + k]; const vb = positions[b + k]; const vc = positions[c + k];
      centroids[t * 3 + k] = (va + vb + vc) / 3;
      bounds[t * 6 + k] = Math.min(va, vb, vc);
      bounds[t * 6 + 3 + k] = Math.max(va, vb, vc);
    }
  }
  const order = Uint32Array.from({ length: triCount }, (_, i) => i);
  const nodes = [];
  const LEAF_SIZE = 8;
  const build = (start, end) => {
    const nodeIndex = nodes.length;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i += 1) {
      const t = order[i];
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k], bounds[t * 6 + k]);
        max[k] = Math.max(max[k], bounds[t * 6 + 3 + k]);
      }
    }
    const node = { min, max, start, end, left: -1, right: -1 };
    nodes.push(node);
    if (end - start > LEAF_SIZE) {
      let axis = 0;
      let spread = -Infinity;
      for (let k = 0; k < 3; k += 1) {
        const s = max[k] - min[k];
        if (s > spread) { spread = s; axis = k; }
      }
      const slice = Array.from(order.subarray(start, end));
      slice.sort((p, q) => centroids[p * 3 + axis] - centroids[q * 3 + axis]);
      order.set(slice, start);
      const mid = (start + end) >> 1;
      node.left = build(start, mid);
      node.right = build(mid, end);
    }
    return nodeIndex;
  };
  if (triCount > 0) build(0, triCount);
  const boxDistSq = (node, px, py, pz) => {
    let d = 0;
    for (let k = 0; k < 3; k += 1) {
      const v = k === 0 ? px : k === 1 ? py : pz;
      const lo = node.min[k]; const hi = node.max[k];
      const e = v < lo ? lo - v : v > hi ? v - hi : 0;
      d += e * e;
    }
    return d;
  };
  const nearest = (px, py, pz) => {
    let best = Infinity;
    let bestPoint = [0, 0, 0];
    let bestTriangle = -1;
    const stack = [0];
    while (stack.length) {
      const node = nodes[stack.pop()];
      if (!node || boxDistSq(node, px, py, pz) >= best) continue;
      if (node.left === -1) {
        for (let i = node.start; i < node.end; i += 1) {
          const t = order[i];
          const point = closestPointOnTriangle(
            px, py, pz, positions,
            triangles[t * 3] * 3, triangles[t * 3 + 1] * 3, triangles[t * 3 + 2] * 3,
          );
          const dx = point[0] - px; const dy = point[1] - py; const dz = point[2] - pz;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < best) { best = d; bestPoint = point; bestTriangle = t; }
        }
      } else {
        const dl = boxDistSq(nodes[node.left], px, py, pz);
        const dr = boxDistSq(nodes[node.right], px, py, pz);
        if (dl < dr) { stack.push(node.right, node.left); } else { stack.push(node.left, node.right); }
      }
    }
    return { point: bestPoint, distance: Math.sqrt(best), triangle: bestTriangle };
  };
  const faceNormal = t => {
    const a = triangles[t * 3] * 3; const b = triangles[t * 3 + 1] * 3; const c = triangles[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a]; const uy = positions[b + 1] - positions[a + 1]; const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a]; const vy = positions[c + 1] - positions[a + 1]; const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  };
  return { nearest, faceNormal };
}

// Dense symmetric solve (Gaussian elimination, partial pivoting).
function solveLinear(a, b, n) {
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-15) return null;
    if (pivot !== col) {
      [a[pivot], a[col]] = [a[col], a[pivot]];
      [b[pivot], b[col]] = [b[col], b[pivot]];
    }
    for (let r = col + 1; r < n; r += 1) {
      const f = a[r][col] / a[col][col];
      for (let c = col; c < n; c += 1) a[r][c] -= f * a[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = b[r];
    for (let c = r + 1; c < n; c += 1) sum -= a[r][c] * x[c];
    x[r] = sum / a[r][r];
  }
  return x;
}

function rodrigues(omega) {
  const angle = Math.hypot(...omega);
  if (angle < 1e-14) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return axisAngleRotationInternal(omega.map(c => c / angle), angle);
}

function axisAngleRotationInternal([x, y, z], angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

// --- similarity estimation (Umeyama) -----------------------------------------

function jacobiEigen3(m) {
  // Symmetric 3x3 eigen-decomposition via cyclic Jacobi.
  const a = m.map(row => row.slice());
  let v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 32; sweep += 1) {
    let off = 0;
    for (let p = 0; p < 3; p += 1) for (let q = p + 1; q < 3; q += 1) off += a[p][q] * a[p][q];
    if (off < 1e-24) break;
    for (let p = 0; p < 3; p += 1) {
      for (let q = p + 1; q < 3; q += 1) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k += 1) {
          const akp = a[k][p]; const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k += 1) {
          const apk = a[p][k]; const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k += 1) {
          const vkp = v[k][p]; const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: v };
}

function svd3(m) {
  // SVD via eigen-decomposition of M^T M; robust enough for covariance input.
  const mtm = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      for (let k = 0; k < 3; k += 1) mtm[i][j] += m[k][i] * m[k][j];
    }
  }
  const { values, vectors } = jacobiEigen3(mtm);
  const order = [0, 1, 2].sort((p, q) => values[q] - values[p]);
  const singular = order.map(i => Math.sqrt(Math.max(values[i], 0)));
  const vCols = order.map(i => [vectors[0][i], vectors[1][i], vectors[2][i]]);
  const uCols = vCols.map((col, idx) => {
    const s = singular[idx];
    const u = [0, 1, 2].map(r => m[r][0] * col[0] + m[r][1] * col[1] + m[r][2] * col[2]);
    const len = Math.hypot(...u);
    if (s > 1e-12 && len > 1e-12) return u.map(c => c / len);
    return null;
  });
  // Complete missing U columns orthogonally.
  for (let i = 0; i < 3; i += 1) {
    if (uCols[i]) continue;
    const others = uCols.filter(Boolean);
    if (others.length === 2) {
      const [p, q] = others;
      uCols[i] = [
        p[1] * q[2] - p[2] * q[1],
        p[2] * q[0] - p[0] * q[2],
        p[0] * q[1] - p[1] * q[0],
      ];
    } else {
      uCols[i] = [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0];
    }
  }
  return { uCols, singular, vCols };
}

export function estimateSimilarity(sourcePoints, targetPoints, count) {
  const srcMean = [0, 0, 0]; const tgtMean = [0, 0, 0];
  for (let i = 0; i < count; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      srcMean[k] += sourcePoints[i * 3 + k];
      tgtMean[k] += targetPoints[i * 3 + k];
    }
  }
  for (let k = 0; k < 3; k += 1) { srcMean[k] /= count; tgtMean[k] /= count; }
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let srcVar = 0;
  for (let i = 0; i < count; i += 1) {
    const sx = sourcePoints[i * 3] - srcMean[0];
    const sy = sourcePoints[i * 3 + 1] - srcMean[1];
    const sz = sourcePoints[i * 3 + 2] - srcMean[2];
    const tx = targetPoints[i * 3] - tgtMean[0];
    const ty = targetPoints[i * 3 + 1] - tgtMean[1];
    const tz = targetPoints[i * 3 + 2] - tgtMean[2];
    cov[0][0] += tx * sx; cov[0][1] += tx * sy; cov[0][2] += tx * sz;
    cov[1][0] += ty * sx; cov[1][1] += ty * sy; cov[1][2] += ty * sz;
    cov[2][0] += tz * sx; cov[2][1] += tz * sy; cov[2][2] += tz * sz;
    srcVar += sx * sx + sy * sy + sz * sz;
  }
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) cov[r][c] /= count;
  srcVar /= count;
  const { uCols, singular, vCols } = svd3(cov);
  const det = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
    - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
    + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const u = [0, 1, 2].map(r => [uCols[0][r], uCols[1][r], uCols[2][r]]);
  const vt = vCols.map(col => col.slice());
  const rotation = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const sign = det(u) * det([0, 1, 2].map(r => [vt[0][r], vt[1][r], vt[2][r]])) < 0 ? -1 : 1;
  const d = [1, 1, sign];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += u[r][k] * d[k] * vt[k][c];
      rotation[r][c] = sum;
    }
  }
  const traceDS = singular[0] * d[0] + singular[1] * d[1] + singular[2] * d[2];
  const scale = srcVar > 1e-18 ? traceDS / srcVar : 1;
  const translation = [0, 1, 2].map(r => tgtMean[r] - scale * (
    rotation[r][0] * srcMean[0] + rotation[r][1] * srcMean[1] + rotation[r][2] * srcMean[2]
  ));
  return { scale, rotation, translation };
}

function applyTransform(points, { scale, rotation, translation }, out) {
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i]; const y = points[i + 1]; const z = points[i + 2];
    for (let r = 0; r < 3; r += 1) {
      out[i + r] = scale * (rotation[r][0] * x + rotation[r][1] * y + rotation[r][2] * z)
        + translation[r];
    }
  }
}

function composeSimilarity(second, first) {
  // second ∘ first
  const rotation = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += second.rotation[r][k] * first.rotation[k][c];
      rotation[r][c] = sum;
    }
  }
  const translation = [0, 1, 2].map(r => second.scale * (
    second.rotation[r][0] * first.translation[0]
    + second.rotation[r][1] * first.translation[1]
    + second.rotation[r][2] * first.translation[2]
  ) + second.translation[r]);
  return { scale: second.scale * first.scale, rotation, translation };
}

// --- registration loop --------------------------------------------------------

function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Principal frame of a sampled point set: covariance eigenvectors ordered by
// decreasing eigenvalue, right-handed. PCA alignment gives a near-exact
// rotational init for asymmetric shapes; the four proper sign flips cover the
// eigenvector sign ambiguity.
function principalFrame(points, count) {
  const mean = [0, 0, 0];
  for (let i = 0; i < count; i += 1) {
    for (let k = 0; k < 3; k += 1) mean[k] += points[i * 3 + k];
  }
  for (let k = 0; k < 3; k += 1) mean[k] /= count;
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < count; i += 1) {
    const d = [0, 1, 2].map(k => points[i * 3 + k] - mean[k]);
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) cov[r][c] += d[r] * d[c];
  }
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) cov[r][c] /= count;
  const { values, vectors } = jacobiEigen3(cov);
  const order = [0, 1, 2].sort((p, q) => values[q] - values[p]);
  const axes = order.map(i => [vectors[0][i], vectors[1][i], vectors[2][i]]);
  // Right-handed: flip the third axis if needed.
  const cross = [
    axes[0][1] * axes[1][2] - axes[0][2] * axes[1][1],
    axes[0][2] * axes[1][0] - axes[0][0] * axes[1][2],
    axes[0][0] * axes[1][1] - axes[0][1] * axes[1][0],
  ];
  if (cross[0] * axes[2][0] + cross[1] * axes[2][1] + cross[2] * axes[2][2] < 0) {
    axes[2] = axes[2].map(c => -c);
  }
  return { mean, axes };
}

// Candidate rotations aligning the source principal frame onto the target
// principal frame, over the four proper sign combinations, plus identity as
// a guard for near-symmetric shapes where PCA is unstable.
function pcaCandidateRotations(sourceFrame, targetFrame) {
  const candidates = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]]];
  const signs = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  for (const sign of signs) {
    const rotation = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        let sum = 0;
        for (let k = 0; k < 3; k += 1) {
          sum += targetFrame.axes[k][r] * sign[k] * sourceFrame.axes[k][c];
        }
        rotation[r][c] = sum;
      }
    }
    candidates.push(rotation);
  }
  return candidates;
}

export function registerMeshes({
  source,
  target,
  sampleCount = 2000,
  maxIterations = 200,
  trialIterations = 10,
  trimFraction = 0.1,
  convergenceTolerance = 1e-7,
  debug = null,
}) {
  assertRegistrable(source, 'source');
  assertRegistrable(target, 'target');
  const samples = sampleSurface(source, sampleCount);
  const index = buildSurfaceIndex(target);

  // Coarse init: centroids + RMS-radius scale, multi-start over rotations.
  const srcMean = [0, 0, 0]; const tgtMean = [0, 0, 0];
  for (let i = 0; i < samples.length; i += 3) {
    for (let k = 0; k < 3; k += 1) srcMean[k] += samples[i + k];
  }
  for (let k = 0; k < 3; k += 1) srcMean[k] /= sampleCount;
  const targetSamples = sampleSurface(target, sampleCount);
  for (let i = 0; i < targetSamples.length; i += 3) {
    for (let k = 0; k < 3; k += 1) tgtMean[k] += targetSamples[i + k];
  }
  for (let k = 0; k < 3; k += 1) tgtMean[k] /= sampleCount;
  let srcRms = 0; let tgtRms = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      srcRms += (samples[i * 3 + k] - srcMean[k]) ** 2;
      tgtRms += (targetSamples[i * 3 + k] - tgtMean[k]) ** 2;
    }
  }
  const initScale = Math.sqrt(tgtRms / (srcRms || 1));
  const scaleReference = Math.sqrt(tgtRms / sampleCount); // target RMS radius
  const initFor = rotation => ({
    scale: initScale,
    rotation,
    translation: [0, 1, 2].map(r => tgtMean[r] - initScale * (
      rotation[r][0] * srcMean[0] + rotation[r][1] * srcMean[1] + rotation[r][2] * srcMean[2]
    )),
  });

  const moved = new Float64Array(samples.length);
  const matchedTargets = new Float64Array(samples.length);
  const distances = new Float64Array(sampleCount);
  const keepCount = Math.max(16, Math.floor(sampleCount * (1 - trimFraction)));
  const keptSource = new Float64Array(keepCount * 3);
  const keptTarget = new Float64Array(keepCount * 3);
  const orderIdx = new Uint32Array(sampleCount);

  const iterate = (start, iterationBudget) => {
    let current = start;
    let iterations = 0;
    let converged = false;
    let previousError = Infinity;
    let error = Infinity;
    for (let iter = 0; iter < iterationBudget; iter += 1) {
      iterations = iter + 1;
      applyTransform(samples, current, moved);
      for (let i = 0; i < sampleCount; i += 1) {
        const { point, distance } = index.nearest(moved[i * 3], moved[i * 3 + 1], moved[i * 3 + 2]);
        matchedTargets[i * 3] = point[0];
        matchedTargets[i * 3 + 1] = point[1];
        matchedTargets[i * 3 + 2] = point[2];
        distances[i] = distance;
      }
      for (let i = 0; i < sampleCount; i += 1) orderIdx[i] = i;
      orderIdx.sort((a, b) => distances[a] - distances[b]);
      error = 0;
      for (let i = 0; i < keepCount; i += 1) {
        const s = orderIdx[i];
        for (let k = 0; k < 3; k += 1) {
          keptSource[i * 3 + k] = samples[s * 3 + k];
          keptTarget[i * 3 + k] = matchedTargets[s * 3 + k];
        }
        error += distances[s] * distances[s];
      }
      error = Math.sqrt(error / keepCount);
      current = estimateSimilarity(keptSource, keptTarget, keepCount);
      if (Math.abs(previousError - error) < convergenceTolerance * Math.max(1e-12, error)) {
        converged = true;
        break;
      }
      previousError = error;
    }
    return { current, iterations, converged, error };
  };

  // Point-to-plane refinement: linearized 7-DoF (rotation, translation,
  // log-scale) similarity update. Point-to-point ICP slides along surfaces
  // and converges geometrically-slowly; the plane metric converges in tens
  // of iterations once inside the right basin.
  const refinePlane = (start, iterationBudget) => {
    let current = start;
    let iterations = 0;
    let converged = false;
    let previousError = Infinity;
    for (let iter = 0; iter < iterationBudget; iter += 1) {
      iterations = iter + 1;
      applyTransform(samples, current, moved);
      for (let i = 0; i < sampleCount; i += 1) {
        const hit = index.nearest(moved[i * 3], moved[i * 3 + 1], moved[i * 3 + 2]);
        matchedTargets[i * 3] = hit.point[0];
        matchedTargets[i * 3 + 1] = hit.point[1];
        matchedTargets[i * 3 + 2] = hit.point[2];
        distances[i] = hit.distance;
        orderIdx[i] = hit.triangle;
      }
      const rank = Array.from({ length: sampleCount }, (_, i) => i)
        .sort((a, b) => distances[a] - distances[b]);
      const ata = Array.from({ length: 7 }, () => new Array(7).fill(0));
      const atb = new Array(7).fill(0);
      let error = 0;
      for (let i = 0; i < keepCount; i += 1) {
        const s = rank[i];
        const n = index.faceNormal(orderIdx[s]);
        const px = moved[s * 3]; const py = moved[s * 3 + 1]; const pz = moved[s * 3 + 2];
        const r = (px - matchedTargets[s * 3]) * n[0]
          + (py - matchedTargets[s * 3 + 1]) * n[1]
          + (pz - matchedTargets[s * 3 + 2]) * n[2];
        // d/dδ of ((ω×p + t + ds·p)·n): rows [p×n, n, p·n]
        const j = [
          py * n[2] - pz * n[1],
          pz * n[0] - px * n[2],
          px * n[1] - py * n[0],
          n[0], n[1], n[2],
          px * n[0] + py * n[1] + pz * n[2],
        ];
        for (let a = 0; a < 7; a += 1) {
          atb[a] -= j[a] * r;
          for (let b = a; b < 7; b += 1) ata[a][b] += j[a] * j[b];
        }
        error += r * r;
      }
      for (let a = 0; a < 7; a += 1) for (let b = 0; b < a; b += 1) ata[a][b] = ata[b][a];
      error = Math.sqrt(error / keepCount);
      if (debug) debug('plane', iter, error, current.scale);
      const delta = solveLinear(ata.map(row => row.slice()), atb.slice(), 7);
      if (!delta || delta.some(v => !Number.isFinite(v))) break;
      // Trust-region clamps: an unclamped Gauss-Newton step from a poor basin
      // can collapse scale toward zero (observed on a real cast pair). Bound
      // per-iteration rotation, translation, and log-scale steps.
      const omega = [delta[0], delta[1], delta[2]];
      const omegaLen = Math.hypot(...omega);
      const maxRotation = 0.5;
      if (omegaLen > maxRotation) {
        for (let k = 0; k < 3; k += 1) omega[k] *= maxRotation / omegaLen;
      }
      const translationStep = [delta[3], delta[4], delta[5]];
      const translationLen = Math.hypot(...translationStep);
      const maxTranslation = scaleReference * 2;
      if (translationLen > maxTranslation) {
        for (let k = 0; k < 3; k += 1) translationStep[k] *= maxTranslation / translationLen;
      }
      const logScaleStep = Math.max(-0.2, Math.min(0.2, delta[6]));
      const update = {
        scale: Math.exp(logScaleStep),
        rotation: rodrigues(omega),
        translation: translationStep,
      };
      current = composeSimilarity(update, current);
      // Cumulative scale band: trimmed point-to-plane can collapse scale by
      // shrinking the source into a locally consistent patch (observed on a
      // real cast pair). The RMS init scale is trustworthy to tens of
      // percent, so project the cumulative scale back into a bounded band
      // instead of letting the solve walk out of it.
      const scaleLo = initScale / 1.5;
      const scaleHi = initScale * 1.5;
      if (current.scale < scaleLo || current.scale > scaleHi) {
        current = {
          ...current,
          scale: Math.max(scaleLo, Math.min(scaleHi, current.scale)),
        };
      }
      // Scale-aware floor: at machine-precision residuals the relative test
      // degenerates, so treat errors far below the model scale as converged.
      const floor = scaleReference * 1e-9;
      if (error < floor
        || Math.abs(previousError - error) < convergenceTolerance * Math.max(floor, error)) {
        converged = true;
        break;
      }
      previousError = error;
    }
    return { current, iterations, converged };
  };

  // Multi-start: PCA principal-frame alignment (4 proper sign combinations)
  // plus identity, each refined briefly with the fast plane stage; the best
  // basin gets the full refinement budget.
  const sourceFrame = principalFrame(samples, sampleCount);
  const targetFrame = principalFrame(targetSamples, sampleCount);
  const trimmedRms = transform => {
    applyTransform(samples, transform, moved);
    for (let i = 0; i < sampleCount; i += 1) {
      distances[i] = index.nearest(moved[i * 3], moved[i * 3 + 1], moved[i * 3 + 2]).distance;
    }
    const sortedD = Array.from(distances).sort((a, b) => a - b);
    let sum = 0;
    for (let i = 0; i < keepCount; i += 1) sum += sortedD[i] * sortedD[i];
    return Math.sqrt(sum / keepCount);
  };
  let best = null;
  for (const rotation of pcaCandidateRotations(sourceFrame, targetFrame)) {
    const trial = refinePlane(initFor(rotation), trialIterations);
    const error = trimmedRms(trial.current);
    if (debug) debug('trial', -1, error, trial.current.scale);
    if (!best || error < best.error) best = { ...trial, error };
  }
  const refined = refinePlane(best.current, maxIterations);
  const current = refined.current;
  const iterations = refined.iterations;
  const converged = refined.converged;

  applyTransform(samples, current, moved);
  const finalDistances = new Float64Array(sampleCount);
  const matchedTriangles = new Int32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const hit = index.nearest(moved[i * 3], moved[i * 3 + 1], moved[i * 3 + 2]);
    finalDistances[i] = hit.distance;
    matchedTriangles[i] = hit.triangle;
  }
  const sorted = Array.from(finalDistances).sort((a, b) => a - b);
  const mean = sorted.reduce((acc, v) => acc + v, 0) / sorted.length;
  // Collapse veto: a completed receipt must never carry a degenerate solve.
  // Scale collapse or residuals beyond the target's own extent are solver
  // failure, not measurement.
  const targetDiameter = scaleReference * 8;
  if (!Number.isFinite(current.scale) || current.scale <= initScale * 0.05
    || current.scale >= initScale * 20
    || !Number.isFinite(mean) || sorted[sorted.length - 1] > targetDiameter * 4) {
    throw new Error(
      `register-collapse: scale ${current.scale} (init ${initScale}), max residual ${sorted[sorted.length - 1]}`,
    );
  }
  const round = v => Number(v.toPrecision(9));
  return {
    transform: current,
    residuals: {
      mean,
      q50: quantile(sorted, 0.5),
      q95: quantile(sorted, 0.95),
      max: sorted[sorted.length - 1],
      sampleCount,
      trimFraction,
    },
    // Restrictable residual field (consumer request, Golden T025855Z):
    // source-space sample points, matched target triangle, and distance per
    // sample, so a downstream region manifest can restrict the field and a
    // sabotage transform can be re-evaluated without re-running the solver.
    field: {
      sourceSamples: Array.from(samples, round),
      matchedTriangles: Array.from(matchedTriangles),
      distances: Array.from(finalDistances, round),
    },
    iterations,
    converged,
  };
}

// --- receipts -------------------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/;

export function buildCastRegistrationReceipt({
  sourceLabel,
  targetLabel,
  sourceSha256,
  targetSha256,
  effectiveRoute,
  result,
  refinements = [],
  generatedAt = new Date().toISOString(),
}) {
  return {
    schema: CAST_REGISTRATION_RECEIPT_SCHEMA,
    status: 'completed',
    inputs: {
      sourceLabel,
      targetLabel,
      sourceSha256,
      targetSha256,
    },
    effectiveRoute,
    registration: {
      transform: result.transform,
      residuals: result.residuals,
      residualField: result.field,
      iterations: result.iterations,
      converged: result.converged,
      sampleCount: result.residuals.sampleCount,
    },
    refinements,
    generatedAt,
  };
}

export function castRegistrationReceiptIdentity(receipt) {
  const { generatedAt, receiptSha256, ...identityBearing } = receipt;
  const canonical = JSON.stringify(identityBearing, Object.keys(flatten(identityBearing)).sort());
  // JSON.stringify with a sorted key array does not recurse the way we need;
  // canonicalize manually instead.
  return createHash('sha256').update(canonicalJson(identityBearing)).digest('hex');
}

function flatten(value) {
  return typeof value === 'object' && value !== null ? value : {};
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateCastRegistrationReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') throw new Error('receipt: not an object');
  if (receipt.schema !== CAST_REGISTRATION_RECEIPT_SCHEMA) {
    throw new Error(`receipt: schema ${receipt.schema} != ${CAST_REGISTRATION_RECEIPT_SCHEMA}`);
  }
  if (receipt.status !== 'completed') throw new Error(`receipt: status ${receipt.status}`);
  const { inputs, registration, refinements } = receipt;
  if (!inputs || !HEX64.test(inputs.sourceSha256) || !HEX64.test(inputs.targetSha256)) {
    throw new Error('receipt: input hashes missing or malformed');
  }
  if (typeof receipt.effectiveRoute !== 'string' || !receipt.effectiveRoute) {
    throw new Error('receipt: effectiveRoute missing');
  }
  if (!registration || typeof registration.iterations !== 'number'
    || typeof registration.sampleCount !== 'number'
    || typeof registration.converged !== 'boolean') {
    throw new Error('receipt: registration accounting missing');
  }
  const residuals = registration.residuals;
  if (!residuals || ['mean', 'q50', 'q95', 'max'].some(k => typeof residuals[k] !== 'number')) {
    throw new Error('receipt: residual statistics missing');
  }
  const field = registration.residualField;
  if (!field || !Array.isArray(field.sourceSamples) || !Array.isArray(field.distances)
    || !Array.isArray(field.matchedTriangles)
    || field.distances.length !== registration.sampleCount
    || field.sourceSamples.length !== registration.sampleCount * 3
    || field.matchedTriangles.length !== registration.sampleCount) {
    throw new Error('receipt: restrictable residual field missing or inconsistent');
  }
  const transform = registration.transform;
  if (!transform || typeof transform.scale !== 'number'
    || !Array.isArray(transform.rotation) || transform.rotation.length !== 3
    || !Array.isArray(transform.translation) || transform.translation.length !== 3) {
    throw new Error('receipt: transform missing');
  }
  if (!Array.isArray(refinements)) {
    throw new Error('receipt: refinements array missing (bounded per-limb corrections)');
  }
  return true;
}

// --- durable runner ---------------------------------------------------------------

export async function runCastRegistration({ sourcePath, targetPath, outputPath, sampleCount = 2000 }) {
  const failLoud = async (phase, error) => {
    const report = {
      schema: CAST_REGISTRATION_RECEIPT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: String(error?.message ?? error),
      inputs: { sourcePath, targetPath },
      generatedAt: new Date().toISOString(),
    };
    if (outputPath) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    throw new Error(`${phase}: ${report.error}`);
  };
  let sourceBytes; let targetBytes;
  try {
    sourceBytes = await readFile(sourcePath);
    targetBytes = await readFile(targetPath);
  } catch (error) { await failLoud('read-inputs', error); }
  let sourceGeometry; let targetGeometry;
  try { sourceGeometry = parseGlbGeometry(sourceBytes); } catch (error) { await failLoud('parse-source', error); }
  try { targetGeometry = parseGlbGeometry(targetBytes); } catch (error) { await failLoud('parse-target', error); }
  let result;
  try {
    result = registerMeshes({ source: sourceGeometry, target: targetGeometry, sampleCount });
  } catch (error) { await failLoud('register', error); }
  const receipt = buildCastRegistrationReceipt({
    sourceLabel: sourcePath,
    targetLabel: targetPath,
    sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
    targetSha256: createHash('sha256').update(targetBytes).digest('hex'),
    effectiveRoute: `cast-registration-core.mjs runCastRegistration sampleCount=${sampleCount}`,
    result,
  });
  receipt.receiptSha256 = castRegistrationReceiptIdentity(receipt);
  try {
    validateCastRegistrationReceipt(receipt);
    if (outputPath) await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) { await failLoud('write-receipt', error); }
  return receipt;
}
