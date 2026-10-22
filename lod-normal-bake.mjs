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
  for (let f = 0; f < indices.length; f += 3) area += Math.hypot(...cross(sub(at(positions, indices[f+1]), at(positions, indices[f])), sub(at(positions, indices[f+2]), at(positions, indices[f])))) / 2;
  for (let p = 0; p < count; p++) if (faces[p] >= 0) covered++;
  const texelSize = covered ? Math.sqrt(area / covered) : 0;
  for (let p = 0; p < count; p++) {
    const face = faces[p]; if (face < 0) continue;
    mask[p] = 1; coveredPixels++;
    const w = [bary[p*3], bary[p*3+1], bary[p*3+2]], vs = [indices[face*3], indices[face*3+1], indices[face*3+2]];
    const mix = (array, width, map = x => x) => { const o = [0, 0, 0]; vs.forEach((v, i) => { const x = map(at(array, v, width), v); for (let k = 0; k < 3; k++) o[k] += w[i] * x[k]; }); return o; };
    const point = mix(positions, 3), N = unit(mix(normals, 3)) ?? [0, 0, 1];
    // As the decoder does: per-vertex B = cross(N, T) * w, then T, B, N interpolated and normalized.
    const T = unit(mix(tangents, 4)) ?? [1, 0, 0];
    const B = unit(mix(tangents, 4, (t, v) => cross(unit(at(normals, v)) ?? [0, 0, 1], t).map(x => x * t[3]))) ?? cross(N, T);
    let source = sampleNormal(point, N, texelSize);
    source = source && unit(source);
    if (!source) { unsampled++; source = N; }
    if (dot(source, N) < 0) source = source.map(x => -x); // a normal map never turns the surface inside out
    maxDegrees = Math.max(maxDegrees, Math.acos(Math.min(1, dot(source, N))) * 180 / Math.PI);
    // Solve [T B N] m = source (the basis need not be orthonormal), then normalize m.
    const det = dot(T, cross(B, N));
    let m = Math.abs(det) > 1e-9 ? unit([dot(source, cross(B, N)) / det, dot(source, cross(N, T)) / det, dot(source, cross(T, B)) / det]) : null;
    if (!m || m[2] < 0) m = [0, 0, 1]; // degenerate frame or unrepresentable: keep the level's normal
    pixels.set([byte(m[0]), byte(m[1]), byte(m[2]), 255], p * 4);
  }
  if (!coveredPixels) throw Error('no covered UV texels to bake');
  const seeds = nearestCovered(mask, textureSize);
  for (let p = 0; p < count; p++) if (!mask[p]) pixels.set(pixels.subarray(seeds[p] * 4, seeds[p] * 4 + 4), p * 4);
  return {pixels, tangents, coveredPixels, unsampled, maxDegrees, texelSize};
}

// Eigenvector of the largest eigenvalue of a symmetric 3x3 [a00 a01 a02 a11 a12 a22], in closed form
// (trigonometric eigenvalues, then the strongest cross product of the rows of A - lambda I): no seed,
// so nothing about face order can steer it. Null when A is zero.
function dominantAxis(a00, a01, a02, a11, a12, a22) {
  const p1 = a01*a01 + a02*a02 + a12*a12, trace = a00 + a11 + a22;
  if (!(trace > 0)) return null;
  let lambda;
  if (p1 <= 1e-30 * trace * trace) lambda = Math.max(a00, a11, a22);
  else {
    const q = trace / 3, p = Math.sqrt(((a00-q)**2 + (a11-q)**2 + (a22-q)**2 + 2*p1) / 6);
    const b00 = (a00-q)/p, b11 = (a11-q)/p, b22 = (a22-q)/p, b01 = a01/p, b02 = a02/p, b12 = a12/p;
    const r = Math.max(-1, Math.min(1, (b00*(b11*b22-b12*b12) - b01*(b01*b22-b12*b02) + b02*(b01*b12-b11*b02)) / 2));
    lambda = q + 2 * p * Math.cos(Math.acos(r) / 3);
  }
  const r0 = [a00-lambda, a01, a02], r1 = [a01, a11-lambda, a12], r2 = [a02, a12, a22-lambda];
  const cr = (u, v) => [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  let best = null, size = 0;
  for (const c of [cr(r0, r1), cr(r0, r2), cr(r1, r2)]) { const l = Math.hypot(...c); if (l > size) { size = l; best = c; } }
  if (best && size > 1e-12 * trace * trace) return best.map(x => x / size);
  // A repeated largest eigenvalue: every row of A - lambda I is nearly parallel, or zero; take the
  // unit axis whose diagonal entry is largest (any vector in that eigenspace is equally dominant).
  const k = a00 >= a11 && a00 >= a22 ? 0 : a11 >= a22 ? 1 : 2, v = [0, 0, 0]; v[k] = 1; return v;
}

// Shading normals for a surface whose winding is not consistent (TRELLIS's raw decode): each vertex
// takes the dominant axis of its faces' area-weighted normal outer products, which neither the
// winding nor the face order can change. The result is an axis: its sign is arbitrary per vertex, so
// sample it with createHeroNormalSampler({unoriented: true}).
export function windingFreeVertexNormals(vertices, faces) {
  const n = vertices.length / 3, m = new Float32Array(n * 6);
  for (let t = 0; t < faces.length; t += 3) {
    const a = faces[t]*3, b = faces[t+1]*3, c = faces[t+2]*3;
    const ux = vertices[b]-vertices[a], uy = vertices[b+1]-vertices[a+1], uz = vertices[b+2]-vertices[a+2], wx = vertices[c]-vertices[a], wy = vertices[c+1]-vertices[a+1], wz = vertices[c+2]-vertices[a+2];
    let x = uy*wz-uz*wy, y = uz*wx-ux*wz, z = ux*wy-uy*wx; const l = Math.hypot(x, y, z); if (!(l > 0)) continue;
    const area = l / 2; x /= l; y /= l; z /= l;
    for (const v of [faces[t], faces[t+1], faces[t+2]]) {
      const o = v * 6; m[o] += area*x*x; m[o+1] += area*x*y; m[o+2] += area*x*z; m[o+3] += area*y*y; m[o+4] += area*y*z; m[o+5] += area*z*z;
    }
  }
  const out = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) { const o = v * 6, axis = dominantAxis(m[o], m[o+1], m[o+2], m[o+3], m[o+4], m[o+5]); if (axis) out.set(axis, v * 3); }
  return out;
}

// The source's interpolated shading normal for a level point: the nearest source surface hit by a
// ray along the level normal (both ways) within `reach`, else the closest source point. Looking
// along the normal keeps a nearby strand or sheet beside the point (fur, fins) from standing in
// for the surface the level approximates there. THREE and MeshBVH are passed in by the caller.
// With `footprint`, the normal is averaged over a 3x3 grid across the texel in the surface plane,
// so detail finer than a texel (fur) shades as its average rather than as one aliased sample.
// With `unoriented`, vertex normals are axes (windingFreeVertexNormals): each is turned to the hit
// face's side before they are blended.
export function createHeroNormalSampler({hero: {vertices, faces, normals}, THREE, MeshBVH, reach, footprint = false, bvh: prebuilt = null, unoriented = false}) {
  if (!normals) throw Error('source has no shading normals');
  if (!(reach >= 0)) throw Error('reach must be a non-negative distance');
  // A caller that already built a BVH over these same vertices and faces passes it as `bvh`.
  let bvh = prebuilt;
  if (!bvh) { const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3)); geometry.setIndex(new THREE.BufferAttribute(faces, 1)); bvh = new MeshBVH(geometry); }
  const ray = new THREE.Ray(), point = new THREE.Vector3(), hit = {}, tri = new THREE.Triangle(), weights = new THREE.Vector3();
  const corner = i => new THREE.Vector3(vertices[i*3], vertices[i*3+1], vertices[i*3+2]);
  const normalAt = (face, at) => {
    const v = [0, 1, 2].map(k => faces[face * 3 + k]);
    tri.set(corner(v[0]), corner(v[1]), corner(v[2])); tri.getBarycoord(at, weights);
    const w = [weights.x, weights.y, weights.z];
    if (!w.every(Number.isFinite)) return null;
    let sign = [1, 1, 1];
    if (unoriented) { const f = new THREE.Vector3(); tri.getNormal(f);
      sign = v.map(vi => normals[vi*3]*f.x + normals[vi*3+1]*f.y + normals[vi*3+2]*f.z < 0 ? -1 : 1); }
    return [0, 1, 2].map(a => v.reduce((sum, vi, k) => sum + sign[k] * w[k] * normals[vi * 3 + a], 0));
  };
  const sample = (p, n) => {
    let best = null;
    if (n && reach > 0) for (const side of [1, -1]) {
      ray.origin.set(p[0], p[1], p[2]); ray.direction.set(n[0] * side, n[1] * side, n[2] * side);
      const h = bvh.raycastFirst(ray, THREE.DoubleSide);
      if (h && h.distance <= reach && (!best || h.distance < best.distance)) best = h;
    }
    if (best) return normalAt(best.faceIndex, best.point);
    bvh.closestPointToPoint(point.set(p[0], p[1], p[2]), hit);
    return normalAt(hit.faceIndex, hit.point);
  };
  const method = 'ray along the level normal within reach (both ways, nearest hit), else closest point; interpolated shading normal';
  if (!footprint) { sample.method = method; return sample; }
  const averaged = (p, n, texelSize) => {
    if (!(texelSize > 0) || !n) return sample(p, n);
    const u = unit(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross(n, u), sum = [0, 0, 0], step = texelSize / 3;
    let any = false;
    for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) {
      const h = sample([0, 1, 2].map(a => p[a] + (u[a] * i + v[a] * j) * step), n), hn = h && unit(h);
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
