// Tangent-space normal maps for coarse levels, baked from a finer surface (normally the hero).
//
// A level's own geometry cannot carry the hero's fine relief (fur, carving); its shading normals
// are smooth across large triangles. For each covered texel of the level's UV atlas the bake takes
// the level's surface point and finds the source surface's shading normal there, and stores it
// in the level's tangent frame, so lighting sees the hero's relief on the coarse shape.
//
// Tangent frame (glTF 2.0, as three.js decodes it with a TANGENT attribute): T follows +u; the
// bitangent is cross(N, T) * w, with w chosen so the bitangent points toward decreasing v, which
// is "up" in a glTF image. The decoder rebuilds normalize(T*x + B*y + N*z) from interpolated,
// normalized T, B and N; the bake inverts exactly that per texel.
import {rasterizeTrellisMaterialUV, nearestCovered, encodeTrellisTexturePNG} from './models/trellis2/trellis-material.js';
import {glbNodeWorldMatrices, normalMatrixOf} from './mesh-lod-ladder.mjs';

const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = v => { const l = Math.hypot(v[0], v[1], v[2]); return l > 0 ? [v[0]/l, v[1]/l, v[2]/l] : null; };
const at = (array, i, width = 3) => Array.from(array.subarray(i * width, i * width + width));

// Per-vertex glTF tangents [x, y, z, w] from UV gradients, orthogonalized against each normal.
export function vertexTangents({positions, normals, uvs, indices}) {
  const n = positions.length / 3, tAcc = new Float64Array(n * 3), vAcc = new Float64Array(n * 3);
  for (let f = 0; f < indices.length; f += 3) {
    const [a, b, c] = [indices[f], indices[f+1], indices[f+2]];
    const e1 = sub(at(positions, b), at(positions, a)), e2 = sub(at(positions, c), at(positions, a));
    const du1 = uvs[b*2] - uvs[a*2], dv1 = uvs[b*2+1] - uvs[a*2+1], du2 = uvs[c*2] - uvs[a*2], dv2 = uvs[c*2+1] - uvs[a*2+1];
    const det = du1 * dv2 - du2 * dv1;
    if (!(Math.abs(det) > 1e-20)) continue; // no UV area: no gradient to follow
    const r = 1 / det;
    for (let k = 0; k < 3; k++) {
      const dPdu = (e1[k] * dv2 - e2[k] * dv1) * r, dPdv = (e2[k] * du1 - e1[k] * du2) * r;
      for (const v of [a, b, c]) { tAcc[v*3+k] += dPdu; vAcc[v*3+k] += dPdv; }
    }
  }
  const tangents = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const N = unit(at(normals, v)) ?? [0, 0, 1], t = [tAcc[v*3], tAcc[v*3+1], tAcc[v*3+2]];
    let T = unit(sub(t, N.map(x => x * dot(N, t))));
    if (!T) T = unit(cross(N, Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])); // no UV gradient here: any frame decodes consistently
    const up = [-vAcc[v*3], -vAcc[v*3+1], -vAcc[v*3+2]]; // toward decreasing v
    tangents.set([...T, dot(cross(N, T), up) < 0 ? -1 : 1], v * 4);
  }
  return tangents;
}

// sampleNormal(point, levelNormal, texelSize) -> source normal (any length, either orientation) in the
// mesh's frame, or null where the source has nothing to offer (texel keeps the level's own normal).
export function bakeTangentNormalMap({positions, normals, uvs, indices, textureSize, sampleNormal}) {
  const tangents = vertexTangents({positions, normals, uvs, indices});
  const {faces, bary} = rasterizeTrellisMaterialUV({vertices: positions, triangles: indices, uvs, textureSize});
  const count = textureSize * textureSize, pixels = new Uint8Array(count * 4), mask = new Uint8Array(count);
  const byte = v => Math.round((Math.max(-1, Math.min(1, v)) * 0.5 + 0.5) * 255);
  let coveredPixels = 0, unsampled = 0, maxDegrees = 0;
  // How large one texel is on the surface: area over covered texels. Samplers can average over it.
  let area = 0, covered = 0;
  for (let f = 0; f < indices.length; f += 3) {
    const a = indices[f] * 3, b = indices[f + 1] * 3, c = indices[f + 2] * 3;
    const e1x = positions[b] - positions[a], e1y = positions[b + 1] - positions[a + 1], e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a], e2y = positions[c + 1] - positions[a + 1], e2z = positions[c + 2] - positions[a + 2];
    area += Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x) / 2;
  }
  for (let p = 0; p < count; p++) if (faces[p] >= 0) covered++;
  const texelSize = covered ? Math.sqrt(area / covered) : 0;

  // Precompute per-vertex bitangent B = cross(unit(N_v) ?? [0,0,1], T_v) * w_v once.
  const vCount = positions.length / 3;
  const vBitangents = new Float64Array(vCount * 3);
  for (let v = 0; v < vCount; v++) {
    const nv = unit([normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]]) ?? [0, 0, 1];
    const tx = tangents[v * 4], ty = tangents[v * 4 + 1], tz = tangents[v * 4 + 2], tw = tangents[v * 4 + 3];
    const b = cross(nv, [tx, ty, tz]);
    vBitangents[v * 3] = b[0] * tw;
    vBitangents[v * 3 + 1] = b[1] * tw;
    vBitangents[v * 3 + 2] = b[2] * tw;
  }

  for (let p = 0; p < count; p++) {
    const face = faces[p]; if (face < 0) continue;
    mask[p] = 1; coveredPixels++;
    const w0 = bary[p * 3], w1 = bary[p * 3 + 1], w2 = bary[p * 3 + 2];
    const v0 = indices[face * 3], v1 = indices[face * 3 + 1], v2 = indices[face * 3 + 2];
    const point = [
      w0 * positions[v0 * 3] + w1 * positions[v1 * 3] + w2 * positions[v2 * 3],
      w0 * positions[v0 * 3 + 1] + w1 * positions[v1 * 3 + 1] + w2 * positions[v2 * 3 + 1],
      w0 * positions[v0 * 3 + 2] + w1 * positions[v1 * 3 + 2] + w2 * positions[v2 * 3 + 2],
    ];
    const N = unit([
      w0 * normals[v0 * 3] + w1 * normals[v1 * 3] + w2 * normals[v2 * 3],
      w0 * normals[v0 * 3 + 1] + w1 * normals[v1 * 3 + 1] + w2 * normals[v2 * 3 + 1],
      w0 * normals[v0 * 3 + 2] + w1 * normals[v1 * 3 + 2] + w2 * normals[v2 * 3 + 2],
    ]) ?? [0, 0, 1];
    // As the decoder does: per-vertex B = cross(N, T) * w, then T, B, N interpolated and normalized.
    const T = unit([
      w0 * tangents[v0 * 4] + w1 * tangents[v1 * 4] + w2 * tangents[v2 * 4],
      w0 * tangents[v0 * 4 + 1] + w1 * tangents[v1 * 4 + 1] + w2 * tangents[v2 * 4 + 1],
      w0 * tangents[v0 * 4 + 2] + w1 * tangents[v1 * 4 + 2] + w2 * tangents[v2 * 4 + 2],
    ]) ?? [1, 0, 0];
    const B = unit([
      w0 * vBitangents[v0 * 3] + w1 * vBitangents[v1 * 3] + w2 * vBitangents[v2 * 3],
      w0 * vBitangents[v0 * 3 + 1] + w1 * vBitangents[v1 * 3 + 1] + w2 * vBitangents[v2 * 3 + 1],
      w0 * vBitangents[v0 * 3 + 2] + w1 * vBitangents[v1 * 3 + 2] + w2 * vBitangents[v2 * 3 + 2],
    ]) ?? cross(N, T);
    let source = sampleNormal(point, N, texelSize);
    source = source && unit(source);
    if (!source) { unsampled++; source = N; }
    if (dot(source, N) < 0) source = [-source[0], -source[1], -source[2]]; // a normal map never turns the surface inside out
    maxDegrees = Math.max(maxDegrees, Math.acos(Math.min(1, dot(source, N))) * 180 / Math.PI);
    // Solve [T B N] m = source (the basis need not be orthonormal), then normalize m.
    const cBN = cross(B, N), det = dot(T, cBN);
    let m = Math.abs(det) > 1e-9 ? unit([dot(source, cBN) / det, dot(source, cross(N, T)) / det, dot(source, cross(T, B)) / det]) : null;
    if (!m || m[2] < 0) m = [0, 0, 1]; // degenerate frame or unrepresentable: keep the level's normal
    const idx4 = p * 4;
    pixels[idx4] = byte(m[0]);
    pixels[idx4 + 1] = byte(m[1]);
    pixels[idx4 + 2] = byte(m[2]);
    pixels[idx4 + 3] = 255;
  }
  if (!coveredPixels) throw Error('no covered UV texels to bake');
  const seeds = nearestCovered(mask, textureSize);
  for (let p = 0; p < count; p++) if (!mask[p]) pixels.set(pixels.subarray(seeds[p] * 4, seeds[p] * 4 + 4), p * 4);
  return {pixels, tangents, coveredPixels, unsampled, maxDegrees, texelSize};
}

// The source's normal for a level point: the nearest source surface hit by a ray along the level
// normal (both ways) within `reach` (and within `maxTexels * texelSize` when `texelSize > 0`), or
// null when nothing is within reach so the texel keeps the level's own smooth normal instead of
// projecting an unrelated nearby detail across an air gap. Looking along the normal keeps a nearby
// strand or sheet beside the point (fur, fins) from standing in for the surface the level approximates
// there. THREE and MeshBVH are passed in by the caller.
// With `footprint`, the normal is averaged over a 3x3 grid across the texel in the surface plane,
// so detail finer than a texel (fur, or raw-decode facets) shades as its average rather than as one
// aliased sample. With `faceNormals`, hit triangles supply their geometric face normals directly
// (for TRELLIS's raw decode, whose face winding is inconsistent), turned toward the level normal.
export function createHeroNormalSampler({hero: {vertices, faces, normals = null}, THREE, MeshBVH, reach = Infinity, maxTexels = reach === Infinity ? 2 : Infinity, footprint = false, bvh: prebuilt = null, faceNormals = false}) {
  if (!normals && !faceNormals) throw Error('source has no shading normals');
  if (!(reach >= 0) || !(maxTexels > 0)) throw Error('reach must be non-negative and maxTexels positive');
  // A caller that already built a BVH over these same vertices and faces passes it as `bvh`.
  let bvh = prebuilt;
  if (!bvh) { const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3)); geometry.setIndex(new THREE.BufferAttribute(faces, 1)); bvh = new MeshBVH(geometry); }
  const ray = new THREE.Ray(), tri = new THREE.Triangle(), weights = new THREE.Vector3(), hitPt = new THREE.Vector3();
  const c0 = new THREE.Vector3(), c1 = new THREE.Vector3(), c2 = new THREE.Vector3();
  const normalAt = (face, at) => {
    const f3 = face * 3;
    const v0 = faces[f3], v1 = faces[f3 + 1], v2 = faces[f3 + 2];
    const i0 = v0 * 3, i1 = v1 * 3, i2 = v2 * 3;
    c0.set(vertices[i0], vertices[i0 + 1], vertices[i0 + 2]);
    c1.set(vertices[i1], vertices[i1 + 1], vertices[i1 + 2]);
    c2.set(vertices[i2], vertices[i2 + 1], vertices[i2 + 2]);
    tri.set(c0, c1, c2);
    if (faceNormals) {
      tri.getNormal(weights);
      return (weights.x || weights.y || weights.z) ? [weights.x, weights.y, weights.z] : null;
    }
    tri.getBarycoord(at, weights);
    const wx = weights.x, wy = weights.y, wz = weights.z;
    if (!(Number.isFinite(wx) && Number.isFinite(wy) && Number.isFinite(wz))) return null;
    return [
      wx * normals[i0] + wy * normals[i1] + wz * normals[i2],
      wx * normals[i0 + 1] + wy * normals[i1 + 1] + wz * normals[i2 + 1],
      wx * normals[i0 + 2] + wy * normals[i1 + 2] + wz * normals[i2 + 2],
    ];
  };

  const canFastTraverse = bvh._roots?.length === 1 && !bvh._indirectBuffer && bvh.geometry?.index && bvh.geometry?.attributes?.position;
  let sample;
  if (canFastTraverse) {
    const rootBuf = bvh._roots[0];
    const f32 = new Float32Array(rootBuf);
    const u16 = new Uint16Array(rootBuf);
    const u32 = new Uint32Array(rootBuf);
    const bvhIdx = bvh.geometry.index.array;
    const bvhPos = bvh.geometry.attributes.position.array;
    let ox = 0, oy = 0, oz = 0, dx = 0, dy = 0, dz = 0, invDx = 0, invDy = 0, invDz = 0;
    let hitDist = Infinity, hitFace = -1, hitX = 0, hitY = 0, hitZ = 0;

    const intersectBox = (minX, minY, minZ, maxX, maxY, maxZ, far) => {
      let tmin, tmax, tymin, tymax, tzmin, tzmax;
      if (invDx >= 0) { tmin = (minX - ox) * invDx; tmax = (maxX - ox) * invDx; }
      else { tmin = (maxX - ox) * invDx; tmax = (minX - ox) * invDx; }
      if (invDy >= 0) { tymin = (minY - oy) * invDy; tymax = (maxY - oy) * invDy; }
      else { tymin = (maxY - oy) * invDy; tymax = (minY - oy) * invDy; }
      if (tmin > tymax || tymin > tmax) return false;
      if (tymin > tmin || tmin !== tmin) tmin = tymin;
      if (tymax < tmax || tmax !== tmax) tmax = tymax;
      if (invDz >= 0) { tzmin = (minZ - oz) * invDz; tzmax = (maxZ - oz) * invDz; }
      else { tzmin = (maxZ - oz) * invDz; tzmax = (minZ - oz) * invDz; }
      if (tmin > tzmax || tzmin > tmax) return false;
      if (tzmin > tmin || tmin !== tmin) tmin = tzmin;
      if (tzmax < tmax || tmax !== tmax) tmax = tzmax;
      return tmin <= far && tmax >= 0;
    };

    const raycastSubtree = (node32, far) => {
      const node16 = node32 << 1;
      const isLeaf = u16[node16 + 15] === 0xffff;
      if (isLeaf) {
        const offset = u32[node32 + 6];
        const count = u16[node16 + 14];
        hitDist = Infinity;
        hitFace = -1;
        for (let i = offset, end = offset + count; i < end; i++) {
          const i3 = i * 3;
          const a = bvhIdx[i3] * 3, b = bvhIdx[i3 + 1] * 3, c = bvhIdx[i3 + 2] * 3;
          const ax = bvhPos[a], ay = bvhPos[a + 1], az = bvhPos[a + 2];
          const e1x = bvhPos[b] - ax, e1y = bvhPos[b + 1] - ay, e1z = bvhPos[b + 2] - az;
          const e2x = bvhPos[c] - ax, e2y = bvhPos[c + 1] - ay, e2z = bvhPos[c + 2] - az;
          const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
          let DdN = dx * nx + dy * ny + dz * nz;
          let sign;
          if (DdN > 0) { sign = 1; }
          else if (DdN < 0) { sign = -1; DdN = -DdN; }
          else continue;
          const diffx = ox - ax, diffy = oy - ay, diffz = oz - az;
          const DdQxE2 = sign * (dx * (diffy * e2z - diffz * e2y) + dy * (diffz * e2x - diffx * e2z) + dz * (diffx * e2y - diffy * e2x));
          if (DdQxE2 < 0) continue;
          const DdE1xQ = sign * (dx * (e1y * diffz - e1z * diffy) + dy * (e1z * diffx - e1x * diffz) + dz * (e1x * diffy - e1y * diffx));
          if (DdE1xQ < 0 || DdQxE2 + DdE1xQ > DdN) continue;
          const QdN = -sign * (diffx * nx + diffy * ny + diffz * nz);
          if (QdN < 0) continue;
          const t = QdN / DdN;
          const px = ox + t * dx, py = oy + t * dy, pz = oz + t * dz;
          const d = Math.hypot(px - ox, py - oy, pz - oz);
          if (d < 0 || d > far) continue;
          if (d < hitDist) {
            hitDist = d;
            hitFace = i;
            hitX = px; hitY = py; hitZ = pz;
          }
        }
        return hitFace >= 0;
      }

      const splitAxis = u32[node32 + 7];
      const dAxis = splitAxis === 0 ? dx : splitAxis === 1 ? dy : dz;
      const l2r = dAxis >= 0;
      const c1 = l2r ? node32 + 8 : u32[node32 + 6];
      const c2 = l2r ? u32[node32 + 6] : node32 + 8;

      const in1 = intersectBox(f32[c1], f32[c1 + 1], f32[c1 + 2], f32[c1 + 3], f32[c1 + 4], f32[c1 + 5], far);
      let hit1 = false, c1Dist = Infinity, c1Face = -1, c1Px = 0, c1Py = 0, c1Pz = 0;
      if (in1 && raycastSubtree(c1, far)) {
        hit1 = true;
        c1Dist = hitDist; c1Face = hitFace; c1Px = hitX; c1Py = hitY; c1Pz = hitZ;
        const pAxis = splitAxis === 0 ? c1Px : splitAxis === 1 ? c1Py : c1Pz;
        const to2 = l2r ? pAxis <= f32[c2 + splitAxis] : pAxis >= f32[c2 + splitAxis + 3];
        if (to2) {
          return true;
        }
      }

      const far2 = hit1 && c1Dist < far ? c1Dist : far;
      const in2 = intersectBox(f32[c2], f32[c2 + 1], f32[c2 + 2], f32[c2 + 3], f32[c2 + 4], f32[c2 + 5], far2);
      if (in2 && raycastSubtree(c2, far2)) {
        if (!hit1 || hitDist < c1Dist) {
          return true;
        }
      }
      if (hit1) {
        hitDist = c1Dist; hitFace = c1Face; hitX = c1Px; hitY = c1Py; hitZ = c1Pz;
        return true;
      }
      return false;
    };

    const rMinX = f32[0], rMinY = f32[1], rMinZ = f32[2], rMaxX = f32[3], rMaxY = f32[4], rMaxZ = f32[5];
    sample = (p, n, texelSize = 0) => {
      const limit = Math.min(reach, maxTexels < Infinity && texelSize > 0 ? maxTexels * texelSize : Infinity);
      if (!n || !(limit > 0 && limit < Infinity)) return null;
      ox = p[0]; oy = p[1]; oz = p[2];
      let bestDist = Infinity, bestFace = -1, bestX = 0, bestY = 0, bestZ = 0;
      for (let s = 0; s < 2; s++) {
        const side = s === 0 ? 1 : -1;
        dx = n[0] * side; dy = n[1] * side; dz = n[2] * side;
        invDx = 1 / dx; invDy = 1 / dy; invDz = 1 / dz;
        const far = bestFace >= 0 ? bestDist : limit;
        if (intersectBox(rMinX, rMinY, rMinZ, rMaxX, rMaxY, rMaxZ, far)) {
          if (raycastSubtree(0, far) && hitDist <= limit && hitDist < bestDist) {
            bestDist = hitDist; bestFace = hitFace; bestX = hitX; bestY = hitY; bestZ = hitZ;
          }
        }
      }
      if (bestFace < 0) return null;
      hitPt.set(bestX, bestY, bestZ);
      const out = normalAt(bestFace, hitPt);
      return out && faceNormals && dot(out, n) < 0 ? [-out[0], -out[1], -out[2]] : out;
    };
  } else {
    sample = (p, n, texelSize = 0) => {
      const limit = Math.min(reach, maxTexels < Infinity && texelSize > 0 ? maxTexels * texelSize : Infinity);
      if (!n || !(limit > 0 && limit < Infinity)) return null;
      let best = null;
      for (const side of [1, -1]) {
        ray.origin.set(p[0], p[1], p[2]); ray.direction.set(n[0] * side, n[1] * side, n[2] * side);
        const h = bvh.raycastFirst(ray, THREE.DoubleSide, 0, best ? best.distance : limit);
        if (h && h.distance <= limit && (!best || h.distance < best.distance)) best = h;
      }
      if (!best) return null;
      const out = normalAt(best.faceIndex, best.point);
      return out && faceNormals && dot(out, n) < 0 ? [-out[0], -out[1], -out[2]] : out;
    };
  }
  const method = `ray along the level normal within reach (both ways, nearest hit), else level normal; ${faceNormals ? 'face geometric normal' : 'interpolated shading normal'}`;
  if (!footprint) { sample.method = method; return sample; }
  const samplePt = [0, 0, 0];
  const averaged = (p, n, texelSize) => {
    if (!(texelSize > 0) || !n) return sample(p, n, texelSize);
    const u = unit(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross(n, u), sum = [0, 0, 0], step = texelSize / 3;
    let any = false;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      samplePt[0] = p[0] + (u[0] * i + v[0] * j) * step;
      samplePt[1] = p[1] + (u[1] * i + v[1] * j) * step;
      samplePt[2] = p[2] + (u[2] * i + v[2] * j) * step;
      const h = sample(samplePt, n, texelSize), hn = h && unit(h);
      if (!hn) continue;
      const side = dot(hn, n) < 0 ? -1 : 1; for (let a = 0; a < 3; a++) sum[a] += side * hn[a]; any = true;
    }
    return any ? sum : null;
  };
  averaged.method = method + ', averaged over the texel footprint (3x3 in the surface plane)';
  return averaged;
}

// Adds a baked normal map and TANGENT attribute to a one-mesh, one-primitive GLB with float
// POSITION, NORMAL and TEXCOORD_0. sampleWorldNormal(point, levelNormal) works in world space
// (after the node transform), so the source can be any mesh in the same world frame.
// Or sampleLocalNormal(point, levelNormal, texelSize) in the mesh's own frame, when the source shares it.
export async function addNormalMapToGLB(glb, {sampleWorldNormal, sampleLocalNormal, textureSize, source = null}) {
  if (!sampleWorldNormal === !sampleLocalNormal) throw Error('exactly one of sampleWorldNormal and sampleLocalNormal is required');
  const view = new DataView(glb), jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength))), binStart = 28 + jsonLength, binLength = view.getUint32(20 + jsonLength, true);
  if (json.meshes?.length !== 1 || json.meshes[0].primitives.length !== 1) throw Error('one mesh with one primitive required');
  const primitive = json.meshes[0].primitives[0], {POSITION, NORMAL, TEXCOORD_0} = primitive.attributes;
  if (primitive.attributes.TANGENT !== undefined) throw Error('mesh already has a TANGENT attribute');
  for (const [name, index] of Object.entries({POSITION, NORMAL, TEXCOORD_0})) if (index === undefined || json.accessors[index].componentType !== 5126) throw Error(`float ${name} required`);
  if (json.bufferViews.some(bv => bv.byteStride)) throw Error('interleaved buffer views are not read');
  if (primitive.indices === undefined) throw Error('indexed primitive required');
  const material = json.materials?.[primitive.material ?? -1];
  if (!material) throw Error('primitive material required');
  if (material.normalTexture) throw Error('material already has a normal map');
  const nodes = json.nodes.map((node, i) => [node, i]).filter(([node]) => node.mesh === 0);
  if (nodes.length !== 1) throw Error('mesh must be placed by exactly one node');
  const world = glbNodeWorldMatrices(json).get(nodes[0][1]);
  if (!world) throw Error('mesh node is not in the scene');
  // three.js rebuilds the tangent frame from separately transformed normal and tangent; under
  // nonuniform scale, shear or a mirror that frame is not the one this bake inverts, so those are refused.
  const columns = [0, 4, 8].map(c => [world[c], world[c+1], world[c+2]]), lengths = columns.map(c => Math.hypot(...c));
  const similar = lengths.every(l => Math.abs(l - lengths[0]) <= 1e-6 * lengths[0]) &&
    [[0, 1], [0, 2], [1, 2]].every(([i, j]) => Math.abs(dot(columns[i], columns[j])) <= 1e-6 * lengths[0] ** 2);
  if (!(lengths[0] > 0) || !similar) throw Error('mesh node transform must be rotation, translation and uniform scale');
  // A mirror keeps lengths and right angles but reverses the renderer's bitangent.
  if (dot(columns[0], cross(columns[1], columns[2])) < 0) throw Error('mesh node transform is a mirror; normal maps are baked only for rotation and uniform scale');
  const read = (index, width) => { const a = json.accessors[index], bv = json.bufferViews[a.bufferView], T = {5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array}[a.componentType];
    if (!T) throw Error(`unsupported component type ${a.componentType}`);
    const start = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0); return new T(glb.slice(start, start + a.count * width * T.BYTES_PER_ELEMENT)); };
  const positions = read(POSITION, 3), normals = read(NORMAL, 3), uvs = read(TEXCOORD_0, 2), indices = Uint32Array.from(read(primitive.indices, 1));
  // Local to world: points by the node matrix, normals by its inverse transpose; world normals back
  // to local by the transpose of the linear part (the inverse of the inverse transpose).
  const toWorld = p => [0, 1, 2].map(r => world[r]*p[0] + world[4+r]*p[1] + world[8+r]*p[2] + world[12+r]);
  const nm = normalMatrixOf(world), normalToWorld = n => [0, 1, 2].map(r => nm[r]*n[0] + nm[3+r]*n[1] + nm[6+r]*n[2]);
  const linear = [world[0], world[1], world[2], world[4], world[5], world[6], world[8], world[9], world[10]];
  const normalToLocal = n => [0, 1, 2].map(c => linear[c*3]*n[0] + linear[c*3+1]*n[1] + linear[c*3+2]*n[2]); // transpose of the linear part
  const baked = bakeTangentNormalMap({positions, normals, uvs, indices, textureSize,
    sampleNormal: sampleLocalNormal ?? ((p, n, texelSize) => { const s = sampleWorldNormal(toWorld(p), unit(normalToWorld(n)), texelSize * lengths[0]); return s && normalToLocal(s); })});
  const png = new Uint8Array(await encodeTrellisTexturePNG({pixels: baked.pixels, width: textureSize, height: textureSize}));
  // Append the tangents and the image after the existing binary chunk.
  const extra = []; let offset = Math.ceil(binLength / 4) * 4;
  const push = (bytes, target) => { const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4); padded.set(bytes); extra.push(padded);
    json.bufferViews.push({buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? {target} : {})}); offset += padded.length; return json.bufferViews.length - 1; };
  json.accessors.push({bufferView: push(new Uint8Array(baked.tangents.buffer), 34962), componentType: 5126, count: positions.length / 3, type: 'VEC4'});
  primitive.attributes.TANGENT = json.accessors.length - 1;
  json.images = [...(json.images ?? []), {bufferView: push(png), mimeType: 'image/png'}];
  if (!json.samplers?.length) json.samplers = [{magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071}];
  json.textures = [...(json.textures ?? []), {source: json.images.length - 1, sampler: 0}];
  material.normalTexture = {index: json.textures.length - 1};
  json.extras = {...json.extras, lodNormalMap: {source, textureSize, texelSize: baked.texelSize * lengths[0], coveredPixels: baked.coveredPixels, unsampledTexels: baked.unsampled,
    maxDegreesFromLevel: +baked.maxDegrees.toFixed(3), method: (sampleWorldNormal ?? sampleLocalNormal).method ?? 'caller-supplied sampler',
    tangentFrame: 'glTF: T along +u from UV gradients, Gram-Schmidt to N; B = cross(N, T) * w toward decreasing v'}};
  json.buffers[0].byteLength = offset;
  const text = new TextEncoder().encode(JSON.stringify(json)), textLength = Math.ceil(text.length / 4) * 4;
  const out = new ArrayBuffer(28 + textLength + offset), header = new DataView(out), bytes = new Uint8Array(out);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, out.byteLength, true);
  header.setUint32(12, textLength, true); header.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + textLength); bytes.set(text, 20);
  header.setUint32(20 + textLength, offset, true); header.setUint32(24 + textLength, 0x004e4942, true);
  bytes.set(new Uint8Array(glb, binStart, binLength), 28 + textLength);
  let cursor = 28 + textLength + Math.ceil(binLength / 4) * 4; for (const part of extra) { bytes.set(part, cursor); cursor += part.length; }
  return out;
}
