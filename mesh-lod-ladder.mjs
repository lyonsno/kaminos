// Coarse stand-ins ("LOD levels") for TRELLIS meshes.
//
// Upper levels (tens of thousands of faces and up) use TRELLIS's own fast-quadric
// simplifier and cleanup, with non-manifold edges resolved by pairing between passes:
// the raw decode joins thin sheets (fur spikes, fins) to bodies along edges shared by
// more than two faces, the simplifier stalls on those edges, and splitting all of them
// tears the surface open. Lower levels (a few thousand faces and below) cannot be
// reached by simplification on decoded topology, so they are rebuilt as a closed
// surface on a grid sized to the level, projected back onto the source surface, then
// simplified. Both routes keep the TRELLIS material bake as a separate step.
import {simplifyMesh} from './models/trellis2/mesh-simplify.js';
import {fillSmallHoles, fixNormals} from './models/trellis2/mesh-cleanup.js';

const edgeKey = (a, b, nv) => a < b ? a * nv + b : b * nv + a;

export function edgeCensus(vertices, faces) {
  const nv = vertices.length / 3, counts = new Map();
  for (let t = 0; t < faces.length; t += 3) for (let j = 0; j < 3; j++) {
    const k = edgeKey(faces[t + j], faces[t + (j + 1) % 3], nv); counts.set(k, (counts.get(k) || 0) + 1);
  }
  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const c of counts.values()) { if (c === 1) boundaryEdges++; else if (c > 2) nonManifoldEdges++; }
  return {faces: faces.length / 3, vertices: nv, boundaryEdges, nonManifoldEdges};
}

export function surfaceArea(vertices, faces) {
  let a = 0;
  for (let t = 0; t < faces.length; t += 3) {
    const i = faces[t] * 3, j = faces[t + 1] * 3, k = faces[t + 2] * 3, V = vertices;
    const ux = V[j]-V[i], uy = V[j+1]-V[i+1], uz = V[j+2]-V[i+2], wx = V[k]-V[i], wy = V[k+1]-V[i+1], wz = V[k+2]-V[i+2];
    a += 0.5 * Math.hypot(uy*wz-uz*wy, uz*wx-ux*wz, ux*wy-uy*wx);
  }
  return a;
}

// At an edge shared by more than two faces, join faces pairwise: only faces that cross
// the edge in opposite directions (consistent winding) pair, smoothest continuation
// first. Faces left without a partner detach along that edge. Manifold edges join.
export function resolveNonManifoldEdges(vertices, faces) {
  const n = faces.length / 3, nv = vertices.length / 3;
  const normals = new Float64Array(n * 3);
  for (let f = 0; f < n; f++) {
    const a = faces[f*3]*3, b = faces[f*3+1]*3, c = faces[f*3+2]*3, V = vertices;
    const ux = V[b]-V[a], uy = V[b+1]-V[a+1], uz = V[b+2]-V[a+2], wx = V[c]-V[a], wy = V[c+1]-V[a+1], wz = V[c+2]-V[a+2];
    const x = uy*wz-uz*wy, y = uz*wx-ux*wz, z = ux*wy-uy*wx, l = Math.hypot(x, y, z) || 1;
    normals[f*3] = x / l; normals[f*3+1] = y / l; normals[f*3+2] = z / l;
  }
  const groups = new Map();
  for (let f = 0; f < n; f++) for (let i = 0; i < 3; i++) {
    const va = faces[f*3+i], vb = faces[f*3+(i+1)%3], lo = Math.min(va, vb), key = edgeKey(va, vb, nv);
    let g = groups.get(key); if (!g) groups.set(key, g = []);
    g.push({f, cLo: f*3 + (va === lo ? i : (i+1)%3), cHi: f*3 + (va === lo ? (i+1)%3 : i), forward: va === lo});
  }
  const parent = new Int32Array(n * 3); for (let i = 0; i < n * 3; i++) parent[i] = i;
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; } };
  const join = (p, q) => { union(p.cLo, q.cLo); union(p.cHi, q.cHi); };
  const dot = (p, q) => normals[p.f*3]*normals[q.f*3] + normals[p.f*3+1]*normals[q.f*3+1] + normals[p.f*3+2]*normals[q.f*3+2];
  let pairedNonManifold = 0, detachedFaces = 0;
  for (const g of groups.values()) {
    if (g.length === 2) { join(g[0], g[1]); continue; }
    if (g.length < 2) continue;
    const left = g.slice();
    while (left.length >= 2) {
      let best = null, score = -Infinity;
      for (let i = 0; i < left.length; i++) for (let j = i + 1; j < left.length; j++) {
        if (left[i].forward === left[j].forward) continue;
        const s = dot(left[i], left[j]); if (s > score) { score = s; best = [i, j]; }
      }
      if (!best) break;
      join(left[best[0]], left[best[1]]); pairedNonManifold++;
      left.splice(best[1], 1); left.splice(best[0], 1);
    }
    detachedFaces += left.length;
  }
  const rank = new Int32Array(n * 3).fill(-1); let count = 0;
  for (let i = 0; i < n * 3; i++) { const r = find(i); if (rank[r] < 0) rank[r] = count++; }
  const out = new Float32Array(count * 3), f = new Uint32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const id = rank[find(i)], v = faces[i] * 3; f[i] = id;
    out[id*3] = vertices[v]; out[id*3+1] = vertices[v+1]; out[id*3+2] = vertices[v+2];
  }
  return {vertices: out, faces: f, stats: {pairedNonManifold, detachedFaces}};
}

// Upper levels: simplify, re-resolve non-manifold edges, close holes below the level's
// feature size, repeat until within 10% of the target or no progress.
export function reduceLevel({vertices, faces}, target, {holeScale = 6, maxPasses = 12, sourceArea} = {}) {
  let v = Float32Array.from(vertices), f = Uint32Array.from(faces);
  const area = sourceArea ?? surfaceArea(v, f), feature = Math.sqrt(area / target), passes = [];
  for (let pass = 0; pass < maxPasses && f.length / 3 > target * 1.1; pass++) {
    const before = f.length / 3, s = simplifyMesh(v, f, {targetCount: target});
    const r = resolveNonManifoldEdges(Float32Array.from(s.points), Uint32Array.from(s.triangles));
    const h = fillSmallHoles(r.vertices, r.faces, feature * holeScale);
    v = Float32Array.from(h.vertices); f = Uint32Array.from(h.faces);
    passes.push([before, f.length / 3]);
    if (f.length / 3 >= before * 0.99) break;
  }
  const m = fixNormals(v, f);
  return {vertices: Float32Array.from(m.vertices), faces: Uint32Array.from(m.faces), passes, route: 'trellis-simplify+pairing'};
}

// Lower levels: closed surface on a grid sized from the target, projected onto the source.
// closestPoint(x, y, z) -> [x, y, z] on the source surface (for example a three-mesh-bvh query).
export function remeshLevel({vertices: V, faces: F}, target, {closestPoint, oversample = 10, minCells = 24, smoothPasses = 2, maxGridNodes = 2 ** 26} = {}) {
  if (typeof closestPoint !== 'function') throw TypeError('closestPoint(x, y, z) onto the source surface is required');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], V[i+a]); hi[a] = Math.max(hi[a], V[i+a]); }
  const ext = Math.max(hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2]);
  const h = Math.min(Math.sqrt(2 * surfaceArea(V, F) / (oversample * target)), ext / minCells);
  const N = [0, 1, 2].map(a => Math.ceil((hi[a] - lo[a]) / h) + 5), o = lo.map(x => x - 2 * h);
  const idx = (i, j, k) => (k * N[1] + j) * N[0] + i, nn = N[0] * N[1] * N[2];
  // Thin, sparse shapes in a large box can ask for enormous grids; refuse before allocating.
  if (nn > maxGridNodes) throw RangeError(`remesh grid of ${N.join('x')} = ${nn} nodes exceeds maxGridNodes ${maxGridNodes}; lower the target or raise maxGridNodes`);
  const surface = new Uint8Array(nn);
  for (let t = 0; t < F.length; t += 3) {
    const a = F[t]*3, b = F[t+1]*3, c = F[t+2]*3;
    const e = Math.max(Math.hypot(V[a]-V[b], V[a+1]-V[b+1], V[a+2]-V[b+2]), Math.hypot(V[b]-V[c], V[b+1]-V[c+1], V[b+2]-V[c+2]), Math.hypot(V[c]-V[a], V[c+1]-V[a+1], V[c+2]-V[a+2]));
    const s = Math.max(1, Math.ceil(e / (0.5 * h)));
    for (let u = 0; u <= s; u++) for (let w = 0; w <= s - u; w++) {
      const p = u / s, q = w / s, r = 1 - p - q;
      surface[idx(Math.round((r*V[a]+p*V[b]+q*V[c]-o[0])/h), Math.round((r*V[a+1]+p*V[b+1]+q*V[c+1]-o[1])/h), Math.round((r*V[a+2]+p*V[b+2]+q*V[c+2]-o[2])/h))] = 1;
    }
  }
  const outside = new Uint8Array(nn), stack = [0]; outside[0] = 1;
  while (stack.length) {
    const m = stack.pop(), i = m % N[0], j = Math.floor(m / N[0]) % N[1], k = Math.floor(m / (N[0] * N[1]));
    for (const [di, dj, dk] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const x = i+di, y = j+dj, z = k+dk;
      if (x < 0 || y < 0 || z < 0 || x >= N[0] || y >= N[1] || z >= N[2]) continue;
      const q = idx(x, y, z); if (!outside[q] && !surface[q]) { outside[q] = 1; stack.push(q); }
    }
  }
  const solid = m => !outside[m];
  const cidx = (i, j, k) => (k * (N[1]-1) + j) * (N[0]-1) + i, cellVert = new Int32Array((N[0]-1) * (N[1]-1) * (N[2]-1)).fill(-1), verts = [];
  for (let k = 0; k < N[2]-1; k++) for (let j = 0; j < N[1]-1; j++) for (let i = 0; i < N[0]-1; i++) {
    let cnt = 0; for (let c = 0; c < 8; c++) cnt += solid(idx(i + (c&1), j + ((c>>1)&1), k + ((c>>2)&1)));
    if (cnt > 0 && cnt < 8) { cellVert[cidx(i, j, k)] = verts.length / 3; verts.push(o[0] + (i+0.5)*h, o[1] + (j+0.5)*h, o[2] + (k+0.5)*h); }
  }
  const tris = [], quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) tris.push(a, c, b, a, d, c); else tris.push(a, b, c, a, c, d); };
  for (let k = 1; k < N[2]-1; k++) for (let j = 1; j < N[1]-1; j++) for (let i = 0; i < N[0]-1; i++) {
    const s0 = solid(idx(i, j, k)); if (s0 === solid(idx(i+1, j, k))) continue;
    quad(cellVert[cidx(i, j-1, k-1)], cellVert[cidx(i, j, k-1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j-1, k)], !s0);
  }
  for (let k = 1; k < N[2]-1; k++) for (let j = 0; j < N[1]-1; j++) for (let i = 1; i < N[0]-1; i++) {
    const s0 = solid(idx(i, j, k)); if (s0 === solid(idx(i, j+1, k))) continue;
    quad(cellVert[cidx(i-1, j, k-1)], cellVert[cidx(i-1, j, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k-1)], !s0);
  }
  for (let k = 0; k < N[2]-1; k++) for (let j = 1; j < N[1]-1; j++) for (let i = 1; i < N[0]-1; i++) {
    const s0 = solid(idx(i, j, k)); if (s0 === solid(idx(i, j, k+1))) continue;
    quad(cellVert[cidx(i-1, j-1, k)], cellVert[cidx(i, j-1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i-1, j, k)], !s0);
  }
  let pv = Float32Array.from(verts); const pf = Uint32Array.from(tris);
  const project = () => { for (let i = 0; i < pv.length; i += 3) { const p = closestPoint(pv[i], pv[i+1], pv[i+2]); pv[i] = p[0]; pv[i+1] = p[1]; pv[i+2] = p[2]; } };
  project();
  const nbr = Array.from({length: pv.length / 3}, () => new Set());
  for (let t = 0; t < pf.length; t += 3) for (let e = 0; e < 3; e++) { nbr[pf[t+e]].add(pf[t+(e+1)%3]); nbr[pf[t+(e+1)%3]].add(pf[t+e]); }
  for (let pass = 0; pass < smoothPasses; pass++) {
    const next = pv.slice();
    for (let i = 0; i < nbr.length; i++) {
      if (!nbr[i].size) continue; let x = 0, y = 0, z = 0;
      for (const m of nbr[i]) { x += pv[m*3]; y += pv[m*3+1]; z += pv[m*3+2]; }
      const c = nbr[i].size; next[i*3] = 0.5*pv[i*3] + 0.5*x/c; next[i*3+1] = 0.5*pv[i*3+1] + 0.5*y/c; next[i*3+2] = 0.5*pv[i*3+2] + 0.5*z/c;
    }
    pv = next; project();
  }
  const netFaces = pf.length / 3;
  let sv = pv, sf = pf;
  for (let pass = 0; pass < 8 && sf.length / 3 > target; pass++) {
    const before = sf.length / 3, s = simplifyMesh(sv, sf, {targetCount: target});
    sv = Float32Array.from(s.points); sf = Uint32Array.from(s.triangles);
    if (sf.length / 3 >= before * 0.99) break;
  }
  const m = fixNormals(sv, sf);
  return {vertices: Float32Array.from(m.vertices), faces: Uint32Array.from(m.faces), grid: N, cell: h, netFaces, route: 'closed-remesh+projection+trellis-simplify'};
}

// Lossless compaction: merge corners whose position, normal and UV are bit-identical.
export function dedupCorners({positions, normals, uvs}) {
  const n = positions.length / 3, map = new Map(), order = [];
  const pb = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
  const nb = normals && new Uint32Array(normals.buffer, normals.byteOffset, normals.length);
  const ub = uvs && new Uint32Array(uvs.buffer, uvs.byteOffset, uvs.length);
  const corner = new Uint32Array(n);
  for (let c = 0; c < n; c++) {
    let key = `${pb[c*3]},${pb[c*3+1]},${pb[c*3+2]}`;
    if (nb) key += `|${nb[c*3]},${nb[c*3+1]},${nb[c*3+2]}`;
    if (ub) key += `|${ub[c*2]},${ub[c*2+1]}`;
    let id = map.get(key); if (id === undefined) { id = order.length; map.set(key, id); order.push(c); }
    corner[c] = id;
  }
  const pick = (src, width) => { if (!src) return undefined; const out = new Float32Array(order.length * width);
    order.forEach((c, i) => { for (let k = 0; k < width; k++) out[i*width+k] = src[c*width+k]; }); return out; };
  const Index = order.length <= 65535 ? Uint16Array : Uint32Array; // 65535 is reserved for primitive restart
  return {positions: pick(positions, 3), normals: pick(normals, 3), uvs: pick(uvs, 2), indices: Index.from(corner)};
}

// The low tiers Generate prepares before it releases the decoded fields: each target is a
// closed remesh projected onto the raw TRELLIS surface, then the caller's TRELLIS finisher
// (finishTrellisMesh) unwraps it and bakes PBR textures from the same material field.
// closestPoint projects onto the raw surface (for example a three-mesh-bvh query over it).
export async function prepareLowTiers({mesh, materialFields, closestPoint, finish, unwrapMesh, WorkerClass,
  targets = [5000, 1000, 500], textureSizeFor = target => target >= 5000 ? 512 : 256, provenance = {}, compact = true, measure = null}) {
  if (typeof finish !== 'function') throw TypeError('TRELLIS finisher (finishTrellisMesh) required');
  const tiers = [];
  for (const target of targets) {
    const level = remeshLevel({vertices: mesh.vertices, faces: mesh.triangles}, target, {closestPoint});
    const census = edgeCensus(level.vertices, level.faces), textureSize = textureSizeFor(target);
    const finished = await finish({vertices: level.vertices.slice(), triangles: level.faces.slice(), metadata: {lod: {target, route: level.route}}},
      {WorkerClass, unwrapMesh, textureSize, materialFields, provenance: {...provenance, lod: {target, route: level.route, grid: level.grid, cell: level.cell}}});
    // measure: {closestSource(x,y,z) -> {point, normal}, closestFor(vertices, faces) -> same for a level, samples?}
    const error = measure ? measureGeometricError({source: {vertices: mesh.vertices, faces: mesh.triangles}, level,
      closestSource: measure.closestSource, closestLevel: measure.closestFor(level.vertices, level.faces), samples: measure.samples ?? 20000,
      reference: measure.reference ?? null}) : null;
    const glb = compact ? compactTrellisGLB(finished.glb, {dropTimings: true}) : finished.glb;
    const timing = {uvSeconds: glb.timings?.['extras.trellis.uv.elapsedSeconds'] ?? finished.mesh?.uvMetadata?.elapsedSeconds ?? null, ...(glb.timings ? {dropped: glb.timings} : {})};
    tiers.push({target, error, timing, glb, compacted: compact, faces: level.faces.length / 3, route: level.route, textureSize,
      closed: census.boundaryEdges === 0, boundaryEdges: census.boundaryEdges, nonManifoldEdges: census.nonManifoldEdges, grid: level.grid});
  }
  return tiers;
}

// Rewrite a TRELLIS-finished GLB (one primitive, one vertex per corner) with exact duplicate
// corners merged and a real index buffer. Triangles, positions, normals, UVs, images,
// materials, nodes and extras are unchanged; only the vertex layout shrinks.
export function compactTrellisGLB(glb, {dropTimings = false} = {}) {
  const view = new DataView(glb), jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength))), bin = 28 + jsonLength;
  if (json.meshes?.length !== 1 || json.meshes[0].primitives.length !== 1) throw Error('one mesh with one primitive required');
  const primitive = json.meshes[0].primitives[0];
  // Refuse anything this rewrite would silently drop.
  const unknown = Object.keys(primitive.attributes).filter(k => !['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(k));
  if (unknown.length) throw Error(`compaction does not carry attributes ${unknown.join(', ')}`);
  if (primitive.targets) throw Error('compaction does not carry morph targets');
  if (json.bufferViews.some(bv => bv.byteStride)) throw Error('compaction does not read interleaved buffer views');
  if ((json.images || []).some(im => im.bufferView === undefined)) throw Error('compaction requires embedded images');
  // Wall-clock fields make identical work publish different bytes; move them out of the asset.
  const timings = {};
  if (dropTimings) {
    const strip = (node, path) => { if (!node || typeof node !== 'object') return;
      for (const key of Object.keys(node)) {
        if (/Seconds$/.test(key) || key === 'startedAt' || key === 'finishedAt') { timings[[...path, key].join('.')] = node[key]; delete node[key]; }
        else strip(node[key], [...path, key]); } };
    strip(json.extras, ['extras']); for (const mesh of json.meshes) strip(mesh.extras, ['mesh', 'extras']);
  }
  const viewBytes = index => { const bv = json.bufferViews[index]; return new Uint8Array(glb.slice(bin + (bv.byteOffset || 0), bin + (bv.byteOffset || 0) + bv.byteLength)); };
  const accessor = (index, width) => { const a = json.accessors[index], bv = json.bufferViews[a.bufferView], T = {5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array}[a.componentType];
    const start = bin + (bv.byteOffset || 0) + (a.byteOffset || 0); return new T(glb.slice(start, start + a.count * width * T.BYTES_PER_ELEMENT)); };
  const {POSITION, NORMAL, TEXCOORD_0} = primitive.attributes;
  const corners = accessor(primitive.indices, 1), pos = accessor(POSITION, 3), nrm = NORMAL !== undefined ? accessor(NORMAL, 3) : null, uv = TEXCOORD_0 !== undefined ? accessor(TEXCOORD_0, 2) : null;
  const gather = (src, width) => { if (!src) return undefined; const out = new Float32Array(corners.length * width);
    for (let c = 0; c < corners.length; c++) for (let k = 0; k < width; k++) out[c*width+k] = src[corners[c]*width+k]; return out; };
  const merged = dedupCorners({positions: gather(pos, 3), normals: gather(nrm, 3), uvs: gather(uv, 2)});
  const parts = [], bufferViews = [], accessors = [];
  let offset = 0;
  const push = (bytes, target) => { const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4); padded.set(bytes); parts.push(padded);
    bufferViews.push({buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? {target} : {})}); offset += padded.length; return bufferViews.length - 1; };
  const bytesOf = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const addAccessor = (array, type, componentType, target, extra = {}) => { accessors.push({bufferView: push(bytesOf(array), target), componentType, count: array.length / {VEC3: 3, VEC2: 2, SCALAR: 1}[type], type, ...extra}); return accessors.length - 1; };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < merged.positions.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], merged.positions[i+a]); hi[a] = Math.max(hi[a], merged.positions[i+a]); }
  const attributes = {POSITION: addAccessor(merged.positions, 'VEC3', 5126, 34962, {min: lo, max: hi})};
  if (merged.normals) attributes.NORMAL = addAccessor(merged.normals, 'VEC3', 5126, 34962);
  if (merged.uvs) attributes.TEXCOORD_0 = addAccessor(merged.uvs, 'VEC2', 5126, 34962);
  const indices = addAccessor(merged.indices, 'SCALAR', merged.indices instanceof Uint16Array ? 5123 : 5125, 34963);
  const images = (json.images || []).map(image => ({...image, bufferView: push(viewBytes(image.bufferView))}));
  const out = {...json, accessors, bufferViews, buffers: [{byteLength: offset}], images: json.images ? images : undefined,
    meshes: [{...json.meshes[0], primitives: [{...primitive, attributes, indices}]}]};
  if (!json.images) delete out.images;
  const text = new TextEncoder().encode(JSON.stringify(out)), textLength = Math.ceil(text.length / 4) * 4;
  const result = new ArrayBuffer(28 + textLength + offset), header = new DataView(result), bytes = new Uint8Array(result);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, result.byteLength, true);
  header.setUint32(12, textLength, true); header.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + textLength); bytes.set(text, 20);
  header.setUint32(20 + textLength, offset, true); header.setUint32(24 + textLength, 0x004e4942, true);
  let at = 28 + textLength; for (const part of parts) { bytes.set(part, at); at += part.length; }
  if (dropTimings) Object.defineProperty(result, 'timings', {value: timings});
  return result;
}

// Symmetric object-space error between a source surface and one of its levels: area-weighted
// samples on each surface (fixed seed), nearest distance to the other surface, and the angle
// between the two surfaces' normals at each matched pair. closestSource / closestLevel map
// (x, y, z) to {point, normal} on that surface (for example a three-mesh-bvh query).
// Distances are in source units; `relative` divides them by the source bounding diagonal.
// `max` is a sampled maximum: it approaches the true Hausdorff distance from below, because
// worst points such as sharp corners have no area. Raise `samples` for a tighter bound.
// Channels stay separate so each consumer can read the one it cares about.
// Normal angles are unoriented (0-90 degrees): opposite normals read as agreeing, so inverted
// winding does not show here. Every channel is reported per direction, never pooled.
export function measureGeometricError({source, level, closestSource, closestLevel, samples = 20000, seed = 1, reference = null}) {
  let state = seed >>> 0 || 1;
  const random = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296; };
  const faceNormal = (V, F, t) => { const a = F[t*3]*3, b = F[t*3+1]*3, c = F[t*3+2]*3;
    const ux = V[b]-V[a], uy = V[b+1]-V[a+1], uz = V[b+2]-V[a+2], wx = V[c]-V[a], wy = V[c+1]-V[a+1], wz = V[c+2]-V[a+2];
    const x = uy*wz-uz*wy, y = uz*wx-ux*wz, z = ux*wy-uy*wx, l = Math.hypot(x, y, z); return {area: l / 2, n: l ? [x/l, y/l, z/l] : [0, 0, 0]}; };
  function direction(from, to) {
    const {vertices: V, faces: F} = from, n = F.length / 3, cumulative = new Float64Array(n), normals = [];
    let total = 0;
    for (let t = 0; t < n; t++) { const fn = faceNormal(V, F, t); total += fn.area; cumulative[t] = total; normals.push(fn.n); }
    const distances = new Float64Array(samples), angles = new Float64Array(samples);
    for (let s = 0; s < samples; s++) {
      const target = random() * total; let lo = 0, hi = n - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] < target) lo = mid + 1; else hi = mid; }
      let u = random(), v = random(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const a = F[lo*3]*3, b = F[lo*3+1]*3, c = F[lo*3+2]*3, w = 1 - u - v;
      const p = [0, 1, 2].map(k => w*V[a+k] + u*V[b+k] + v*V[c+k]), hit = to(p[0], p[1], p[2]);
      distances[s] = Math.hypot(hit.point[0]-p[0], hit.point[1]-p[1], hit.point[2]-p[2]);
      const m = normals[lo], d = Math.min(1, Math.abs(m[0]*hit.normal[0] + m[1]*hit.normal[1] + m[2]*hit.normal[2]));
      angles[s] = Math.acos(d) * 180 / Math.PI;
    }
    return {distances, angles};
  }
  const stats = values => { const sorted = Float64Array.from(values).sort(); let sum = 0; for (const x of sorted) sum += x;
    return {max: sorted[sorted.length - 1], p95: sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))], mean: sum / sorted.length}; };
  const forward = direction(level, closestSource), backward = direction(source, closestLevel);
  const both = new Float64Array(samples * 2); both.set(forward.distances); both.set(backward.distances, samples);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], V = source.vertices;
  for (let i = 0; i < V.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], V[i+a]); hi[a] = Math.max(hi[a], V[i+a]); }
  const diagonal = Math.hypot(hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2]), all = stats(both);
  return {schema: 'kaminos.lod-geometric-error.v1', reference, samplesPerSide: samples, seed, diagonal, normalAngle: 'unoriented-0-90', ...all,
    relative: {max: all.max / diagonal, p95: all.p95 / diagonal, mean: all.mean / diagonal},
    levelToSource: {...stats(forward.distances), normalDeviationDegrees: stats(forward.angles)},
    sourceToLevel: {...stats(backward.distances), normalDeviationDegrees: stats(backward.angles)}};
}

// World-space triangles of a GLB: every triangle primitive in the default scene, with each
// node's matrix or translation/rotation/scale applied down the hierarchy. Positions must be
// float32 (quantized or compressed positions are refused rather than misread). Used to compare
// a level with the hero a consumer would otherwise draw, in the frame both are drawn in.
// glTF node transforms: column-major 4x4.
const mat4Mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k]; return o; };
const nodeLocalMatrix = node => {
  if (node.matrix) return node.matrix.slice();
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1], [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [(1-2*(y*y+z*z))*sx, 2*(x*y+z*w)*sx, 2*(x*z-y*w)*sx, 0, 2*(x*y-z*w)*sy, (1-2*(x*x+z*z))*sy, 2*(y*z+x*w)*sy, 0,
          2*(x*z+y*w)*sz, 2*(y*z-x*w)*sz, (1-2*(x*x+y*y))*sz, 0, tx, ty, tz, 1];
};
// Inverse transpose of a column-major 4x4's linear part, as a column-major 3x3: carries normals.
export function normalMatrixOf(m) {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]; // rows
  const det = a*(e*i-f*h) - b*(d*i-f*g) + c*(d*h-e*g);
  if (!(Math.abs(det) > 1e-12)) throw Error('singular node transform');
  // cofactor matrix / det is the inverse transpose; store column-major
  const cof = [e*i-f*h, -(d*i-f*g), d*h-e*g, -(b*i-c*h), a*i-c*g, -(a*h-b*g), b*f-c*e, -(a*f-c*d), a*e-b*d]; // rows
  return [cof[0], cof[3], cof[6], cof[1], cof[4], cof[7], cof[2], cof[5], cof[8]].map(v => v / det);
}
// World matrix of every node that is reached from the scene, by node index.
export function glbNodeWorldMatrices(json) {
  const worlds = new Map();
  const visit = (index, parent) => { const world = mat4Mul(parent, nodeLocalMatrix(json.nodes[index])); worlds.set(index, world);
    for (const child of json.nodes[index].children ?? []) visit(child, world); };
  for (const root of json.scenes?.[json.scene ?? 0]?.nodes ?? json.nodes.map((_, i) => i)) visit(root, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  return worlds;
}

// World-space triangles of a GLB, with world shading normals when every primitive carries float
// normals (otherwise normals is null).
export function readGLBWorldMesh(glb) {
  const view = new DataView(glb);
  if (view.getUint32(0, true) !== 0x46546c67) throw Error('not a GLB');
  const jsonLength = view.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength)));
  const binStart = 28 + jsonLength;
  const read = (index, width) => {
    const a = json.accessors[index]; if (a.sparse) throw Error('sparse accessors are not read');
    const bv = json.bufferViews[a.bufferView], T = {5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5122: Int16Array, 5121: Uint8Array, 5120: Int8Array}[a.componentType];
    if (!T) throw Error(`unsupported component type ${a.componentType}`);
    const stride = bv.byteStride || width * T.BYTES_PER_ELEMENT, base = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0), out = new T(a.count * width);
    for (let i = 0; i < a.count; i++) out.set(new T(glb.slice(base + i * stride, base + i * stride + width * T.BYTES_PER_ELEMENT)), i * width);
    return {array: out, componentType: a.componentType};
  };
  const vertices = [], faces = [];
  let normals = [];
  for (const [index, world] of glbNodeWorldMatrices(json)) {
    const node = json.nodes[index];
    if (node.mesh !== undefined) for (const primitive of json.meshes[node.mesh].primitives) {
      if ((primitive.mode ?? 4) !== 4) throw Error('only triangle primitives are read');
      if (primitive.extensions?.KHR_draco_mesh_compression) throw Error('compressed primitives are not read');
      const p = read(primitive.attributes.POSITION, 3);
      if (p.componentType !== 5126) throw Error('float positions required (quantized positions are not read)');
      const base = vertices.length / 3;
      for (let i = 0; i < p.array.length; i += 3) { const [x, y, z] = [p.array[i], p.array[i+1], p.array[i+2]];
        vertices.push(world[0]*x + world[4]*y + world[8]*z + world[12], world[1]*x + world[5]*y + world[9]*z + world[13], world[2]*x + world[6]*y + world[10]*z + world[14]); }
      const ix = primitive.indices !== undefined ? read(primitive.indices, 1).array : Uint32Array.from({length: p.array.length / 3}, (_, i) => i);
      for (const i of ix) faces.push(base + i);
      const n = normals && primitive.attributes.NORMAL !== undefined ? read(primitive.attributes.NORMAL, 3) : null;
      if (!n || n.componentType !== 5126) { normals = null; continue; }
      const nm = normalMatrixOf(world);
      for (let i = 0; i < n.array.length; i += 3) { const [x, y, z] = [n.array[i], n.array[i+1], n.array[i+2]];
        const w = [nm[0]*x + nm[3]*y + nm[6]*z, nm[1]*x + nm[4]*y + nm[7]*z, nm[2]*x + nm[5]*y + nm[8]*z], l = Math.hypot(...w) || 1;
        normals.push(w[0] / l, w[1] / l, w[2] / l); }
    }
  }
  return {vertices: Float32Array.from(vertices), faces: Uint32Array.from(faces), normals: normals && Float32Array.from(normals)};
}
