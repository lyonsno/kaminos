// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNonManifoldEdges, reduceLevel, remeshLevel, dedupCorners, edgeCensus} from '../mesh-lod-ladder.mjs';

// Two coplanar triangles sharing edge (0,1), plus a fin standing up on the same edge.
const finVertices = new Float32Array([0,0,0, 1,0,0, 0.5,-1,0, 0.5,1,0, 0.5,0,1]);
const finFaces = new Uint32Array([0,1,3, 1,0,2, 0,1,4]);

test('a junction keeps the continuing surface joined and detaches the fin', () => {
  assert.equal(edgeCensus(finVertices, finFaces).nonManifoldEdges, 1);
  const out = resolveNonManifoldEdges(finVertices, finFaces);
  const census = edgeCensus(out.vertices, out.faces);
  assert.equal(census.nonManifoldEdges, 0);
  assert.equal(out.faces.length, finFaces.length);
  // The two flat faces still share an edge; the fin's base edge is open.
  const shared = (a, b) => { const e = f => new Set([0,1,2].map(i => [out.faces[f*3+i], out.faces[f*3+(i+1)%3]].sort().join()));
    return [...e(a)].some(k => e(b).has(k)); };
  assert.ok(shared(0, 1), 'flat pair stays joined');
  assert.ok(!shared(0, 2) && !shared(1, 2), 'fin detaches');
});

// Unit cube surface (6 faces x 2 tris). With `slit`, the top face is inset by 0.01 on
// every side, leaving a crack narrower than any remesh cell all the way around it.
function cube(slit = false) {
  const v = [], f = [];
  for (let i = 0; i < 8; i++) v.push(i & 1, (i >> 1) & 1, (i >> 2) & 1);
  const quads = [[0,2,3,1],[4,5,7,6],[0,1,5,4],[2,6,7,3],[0,4,6,2],[1,3,7,5]];
  for (const [a,b,c,d] of quads) {
    if (slit && [a,b,c,d].every(i => (i >> 2) & 1)) { // top face (z = 1): own inset vertices
      const base = v.length / 3;
      for (const i of [a,b,c,d]) v.push(0.01 + 0.98 * (i & 1), 0.01 + 0.98 * ((i >> 1) & 1), 1);
      f.push(base, base+1, base+2, base, base+2, base+3);
    } else f.push(a,b,c, a,c,d);
  }
  return {vertices: new Float32Array(v), faces: new Uint32Array(f)};
}
const cubeClosestPoint = (x, y, z) => { // nearest point on the unit cube's surface
  const c = [x, y, z].map(t => Math.min(1, Math.max(0, t)));
  const inside = c.every((t, i) => t === [x, y, z][i]);
  if (!inside) return c;
  const d = c.flatMap((t, i) => [[t, i, 0], [1 - t, i, 1]]).sort((a, b) => a[0] - b[0])[0];
  c[d[1]] = d[2]; return c;
};

test('remeshing a cracked box seals the crack and lands on the original surface at the target', () => {
  const box = cube(true);
  assert.ok(edgeCensus(box.vertices, box.faces).boundaryEdges > 0);
  const out = remeshLevel(box, 200, {closestPoint: cubeClosestPoint});
  const census = edgeCensus(out.vertices, out.faces);
  assert.equal(census.boundaryEdges, 0, 'closed');
  assert.ok(out.faces.length / 3 <= 200 && out.faces.length / 3 >= 180, `faces ${out.faces.length / 3}`);
  for (let i = 0; i < out.vertices.length; i += 3) {
    const p = cubeClosestPoint(out.vertices[i], out.vertices[i+1], out.vertices[i+2]);
    assert.ok(Math.hypot(p[0]-out.vertices[i], p[1]-out.vertices[i+1], p[2]-out.vertices[i+2]) < 0.06, 'vertex near the source surface');
  }
});

test('decimation reaches its target on a closed mesh and reports its passes', () => {
  // Subdivided octahedron sphere: closed and manifold.
  let v = [1,0,0, -1,0,0, 0,1,0, 0,-1,0, 0,0,1, 0,0,-1], f = [0,2,4, 2,1,4, 1,3,4, 3,0,4, 2,0,5, 1,2,5, 3,1,5, 0,3,5];
  for (let s = 0; s < 5; s++) {
    const mid = new Map(), next = [];
    const m = (a, b) => { const k = a < b ? `${a},${b}` : `${b},${a}`; if (!mid.has(k)) { const p = [0,1,2].map(i => (v[a*3+i] + v[b*3+i]) / 2), l = Math.hypot(...p); v.push(...p.map(t => t / l)); mid.set(k, v.length / 3 - 1); } return mid.get(k); };
    for (let t = 0; t < f.length; t += 3) { const [a,b,c] = f.slice(t, t+3), ab = m(a,b), bc = m(b,c), ca = m(c,a); next.push(a,ab,ca, ab,b,bc, ca,bc,c, ab,bc,ca); }
    f = next;
  }
  const out = reduceLevel({vertices: new Float32Array(v), faces: new Uint32Array(f)}, 2000);
  assert.ok(out.faces.length / 3 <= 2200 && out.faces.length / 3 >= 1800, `faces ${out.faces.length / 3}`);
  assert.equal(edgeCensus(out.vertices, out.faces).boundaryEdges, 0);
  assert.ok(Array.isArray(out.passes) && out.passes.length >= 1);
});

test('exact corner dedup merges only bit-identical corners and keeps every attribute', () => {
  // Four corners: 0 and 2 identical in every attribute, 3 differs only in UV.
  const positions = new Float32Array([0,0,0, 1,0,0, 0,0,0, 0,0,0]);
  const normals = new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1]);
  const uvs = new Float32Array([0,0, 1,0, 0,0, 0.5,0]);
  const out = dedupCorners({positions, normals, uvs});
  assert.equal(out.positions.length / 3, 3);
  assert.ok(out.indices instanceof Uint16Array);
  assert.deepEqual([...out.indices], [0, 1, 0, 2]);
  for (let c = 0; c < 4; c++) {
    const k = out.indices[c];
    assert.deepEqual([...out.positions.slice(k*3, k*3+3)], [...positions.slice(c*3, c*3+3)]);
    assert.deepEqual([...out.uvs.slice(k*2, k*2+2)], [...uvs.slice(c*2, c*2+2)]);
  }
});
