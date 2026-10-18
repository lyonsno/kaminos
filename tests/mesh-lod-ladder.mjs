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

test('prepareLowTiers returns closed, textured GLBs for each tier through the TRELLIS bake', async () => {
  const {prepareLowTiers} = await import('../mesh-lod-ladder.mjs');
  const {finishTrellisMesh} = await import('../models/trellis2/trellis-material.js');
  const {createWasmXatlasUnwrapper} = await import('../models/trellis2/wasm-xatlas.js');
  const {NodeTrellisUVWorker} = await import('../models/trellis2/node-uv-worker.mjs');
  // Raw mesh: a closed sphere of radius 0.4 (subdivided octahedron).
  let v = [1,0,0, -1,0,0, 0,1,0, 0,-1,0, 0,0,1, 0,0,-1], f = [0,2,4, 2,1,4, 1,3,4, 3,0,4, 2,0,5, 1,2,5, 3,1,5, 0,3,5];
  for (let s = 0; s < 5; s++) {
    const mid = new Map(), next = [];
    const m = (a, b) => { const k = a < b ? `${a},${b}` : `${b},${a}`; if (!mid.has(k)) { const p = [0,1,2].map(i => (v[a*3+i] + v[b*3+i]) / 2), l = Math.hypot(...p); v.push(...p.map(t => t / l)); mid.set(k, v.length / 3 - 1); } return mid.get(k); };
    for (let t = 0; t < f.length; t += 3) { const [a,b,c] = f.slice(t, t+3), ab = m(a,b), bc = m(b,c), ca = m(c,a); next.push(a,ab,ca, ab,b,bc, ca,bc,c, ab,bc,ca); }
    f = next;
  }
  const vertices = Float32Array.from(v, x => x * 0.4), triangles = Uint32Array.from(f);
  // Material field: voxels on the sphere shell at resolution 32, colour by height.
  const R = 32, coords = [], feats = [];
  for (let i = 0; i < R; i++) for (let j = 0; j < R; j++) for (let k = 0; k < R; k++) {
    const p = [i, j, k].map(c => (c + 0.5) / R - 0.5);
    if (Math.abs(Math.hypot(...p) - 0.4) < 1.5 / R) { coords.push(i, j, k); feats.push(p[2] * 2, 0, -p[2] * 2, 0, 0.6, 1); }
  }
  const materialFields = {coordinates: Int32Array.from(coords), features: Float32Array.from(feats), resolution: R};
  const closestPoint = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l * 0.4, y / l * 0.4, z / l * 0.4]; };
  const tiers = await prepareLowTiers({mesh: {vertices, triangles}, materialFields, targets: [1000, 200], closestPoint,
    finish: finishTrellisMesh, unwrapMesh: createWasmXatlasUnwrapper(), WorkerClass: NodeTrellisUVWorker});
  assert.deepEqual(tiers.map(t => t.target), [1000, 200]);
  for (const tier of tiers) {
    assert.ok(tier.faces <= tier.target && tier.faces >= tier.target * 0.9, `faces ${tier.faces}`);
    assert.equal(tier.closed, true);
    assert.equal(tier.route, 'closed-remesh+projection+trellis-simplify');
    const bytes = new Uint8Array(tier.glb), json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + new DataView(tier.glb).getUint32(12, true))));
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'glTF');
    assert.ok(json.meshes[0].primitives[0].attributes.TEXCOORD_0 !== undefined && json.images.length === 2, 'textured');
    assert.equal(tier.textureSize, tier.target >= 5000 ? 512 : 256);
  }
});

test('compactTrellisGLB merges exact duplicate corners without changing any triangle, attribute or image', async () => {
  const {prepareLowTiers, compactTrellisGLB} = await import('../mesh-lod-ladder.mjs');
  const {finishTrellisMesh} = await import('../models/trellis2/trellis-material.js');
  const {createWasmXatlasUnwrapper} = await import('../models/trellis2/wasm-xatlas.js');
  const {NodeTrellisUVWorker} = await import('../models/trellis2/node-uv-worker.mjs');
  let v = [1,0,0, -1,0,0, 0,1,0, 0,-1,0, 0,0,1, 0,0,-1], f = [0,2,4, 2,1,4, 1,3,4, 3,0,4, 2,0,5, 1,2,5, 3,1,5, 0,3,5];
  for (let s = 0; s < 4; s++) {
    const mid = new Map(), next = [];
    const m = (a, b) => { const k = a < b ? `${a},${b}` : `${b},${a}`; if (!mid.has(k)) { const p = [0,1,2].map(i => (v[a*3+i] + v[b*3+i]) / 2), l = Math.hypot(...p); v.push(...p.map(t => t / l)); mid.set(k, v.length / 3 - 1); } return mid.get(k); };
    for (let t = 0; t < f.length; t += 3) { const [a,b,c] = f.slice(t, t+3), ab = m(a,b), bc = m(b,c), ca = m(c,a); next.push(a,ab,ca, ab,b,bc, ca,bc,c, ab,bc,ca); }
    f = next;
  }
  const R = 16, coords = [], feats = [];
  for (let i = 0; i < R; i++) for (let j = 0; j < R; j++) for (let k = 0; k < R; k++) {
    const p = [i, j, k].map(c => (c + 0.5) / R - 0.5);
    if (Math.abs(Math.hypot(...p) - 0.4) < 1.5 / R) { coords.push(i, j, k); feats.push(p[2] * 2, 0, -p[2] * 2, 0, 0.6, 1); }
  }
  const [tier] = await prepareLowTiers({mesh: {vertices: Float32Array.from(v, x => x * 0.4), triangles: Uint32Array.from(f)},
    materialFields: {coordinates: Int32Array.from(coords), features: Float32Array.from(feats), resolution: R}, targets: [300], compact: false,
    closestPoint: (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l * 0.4, y / l * 0.4, z / l * 0.4]; },
    finish: finishTrellisMesh, unwrapMesh: createWasmXatlasUnwrapper(), WorkerClass: NodeTrellisUVWorker});
  const read = buffer => {
    const view = new DataView(buffer), jl = view.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jl)));
    const bin = 28 + jl, accessor = i => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = {SCALAR: 1, VEC2: 2, VEC3: 3}[a.type];
      const T = {5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array}[a.componentType];
      return new T(buffer.slice(bin + (bv.byteOffset || 0) + (a.byteOffset || 0), bin + (bv.byteOffset || 0) + (a.byteOffset || 0) + a.count * n * T.BYTES_PER_ELEMENT)); };
    const p = json.meshes[0].primitives[0];
    const images = json.images.map(im => { const bv = json.bufferViews[im.bufferView]; return new Uint8Array(buffer, bin + (bv.byteOffset || 0), bv.byteLength).join(); });
    return {json, pos: accessor(p.attributes.POSITION), nrm: accessor(p.attributes.NORMAL), uv: accessor(p.attributes.TEXCOORD_0), idx: accessor(p.indices), images};
  };
  const before = read(tier.glb), compact = compactTrellisGLB(tier.glb), after = read(compact);
  assert.ok(compact.byteLength < tier.glb.byteLength, `${compact.byteLength} < ${tier.glb.byteLength}`);
  assert.ok(after.pos.length < before.pos.length, 'fewer vertices');
  assert.equal(after.idx.length, before.idx.length, 'same triangles');
  for (let c = 0; c < before.idx.length; c++) {
    const b = before.idx[c], a = after.idx[c];
    assert.deepEqual([...after.pos.slice(a*3, a*3+3)], [...before.pos.slice(b*3, b*3+3)]);
    assert.deepEqual([...after.nrm.slice(a*3, a*3+3)], [...before.nrm.slice(b*3, b*3+3)]);
    assert.deepEqual([...after.uv.slice(a*2, a*2+2)], [...before.uv.slice(b*2, b*2+2)]);
  }
  assert.deepEqual(after.images, before.images, 'textures byte-identical');
  assert.deepEqual(after.json.materials, before.json.materials);
  assert.deepEqual(after.json.nodes, before.json.nodes, 'node transform kept');
  assert.deepEqual(after.json.extras, before.json.extras, 'provenance kept');
});

test('geometric error is symmetric, deterministic and matches a known offset', async () => {
  const {measureGeometricError} = await import('../mesh-lod-ladder.mjs');
  const box = (lo, hi) => { const v = [], f = [];
    for (let i = 0; i < 8; i++) v.push(i & 1 ? hi : lo, (i >> 1) & 1 ? hi : lo, (i >> 2) & 1 ? hi : lo);
    for (const [a,b,c,d] of [[0,2,3,1],[4,5,7,6],[0,1,5,4],[2,6,7,3],[0,4,6,2],[1,3,7,5]]) f.push(a,b,c, a,c,d);
    return {vertices: new Float32Array(v), faces: new Uint32Array(f)}; };
  // Closest point and outward normal on the surface of the axis-aligned cube [lo, hi]^3.
  const closestOnBox = (lo, hi) => (x, y, z) => {
    const p = [x, y, z], c = p.map(t => Math.min(hi, Math.max(lo, t)));
    if (c.some((t, i) => t !== p[i])) { // outside: clamp; normal along the largest excursion
      const d = p.map((t, i) => t - c[i]), axis = d.map(Math.abs).indexOf(Math.max(...d.map(Math.abs)));
      const n = [0, 0, 0]; n[axis] = Math.sign(d[axis]); return {point: c, normal: n}; }
    const options = c.flatMap((t, i) => [[t - lo, i, lo, -1], [hi - t, i, hi, 1]]).sort((a, b) => a[0] - b[0])[0];
    c[options[1]] = options[2]; const n = [0, 0, 0]; n[options[1]] = options[3]; return {point: c, normal: n}; };
  const source = box(0, 1), level = box(0.05, 0.95);
  const run = () => measureGeometricError({source, level, closestSource: closestOnBox(0, 1), closestLevel: closestOnBox(0.05, 0.95), samples: 4000, seed: 7});
  const e = run();
  assert.deepEqual(e, run(), 'same seed, same numbers');
  assert.ok(Math.abs(e.levelToSource.max - 0.05) < 1e-6, `level->source max ${e.levelToSource.max}`);
  assert.ok(Math.abs(e.levelToSource.mean - 0.05) < 1e-6);
  // Sampled max approaches the true corner distance (sqrt(3)*0.05) from below: corners have no area.
  assert.ok(e.sourceToLevel.max > Math.sqrt(2) * 0.05 && e.sourceToLevel.max <= Math.sqrt(3) * 0.05 + 1e-6, `source->level max ${e.sourceToLevel.max}`);
  assert.equal(e.max, Math.max(e.levelToSource.max, e.sourceToLevel.max));
  assert.ok(Math.abs(e.diagonal - Math.sqrt(3)) < 1e-6);
  assert.ok(Math.abs(e.relative.max - e.max / Math.sqrt(3)) < 1e-12);
  assert.ok(e.p95 >= e.mean && e.p95 <= e.max);
  assert.ok(e.normalDeviationDegrees.mean >= 0 && e.normalDeviationDegrees.max <= 90 + 1e-6);
});
