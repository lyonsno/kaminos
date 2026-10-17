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
export function remeshLevel({vertices: V, faces: F}, target, {closestPoint, oversample = 10, minCells = 24, smoothPasses = 2} = {}) {
  if (typeof closestPoint !== 'function') throw TypeError('closestPoint(x, y, z) onto the source surface is required');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], V[i+a]); hi[a] = Math.max(hi[a], V[i+a]); }
  const ext = Math.max(hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2]);
  const h = Math.min(Math.sqrt(2 * surfaceArea(V, F) / (oversample * target)), ext / minCells);
  const N = [0, 1, 2].map(a => Math.ceil((hi[a] - lo[a]) / h) + 5), o = lo.map(x => x - 2 * h);
  const idx = (i, j, k) => (k * N[1] + j) * N[0] + i, nn = N[0] * N[1] * N[2];
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
  const Index = order.length <= 65536 ? Uint16Array : Uint32Array;
  return {positions: pick(positions, 3), normals: pick(normals, 3), uvs: pick(uvs, 2), indices: Index.from(corner)};
}
