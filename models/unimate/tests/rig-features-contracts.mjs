// The browser rig importer's skeleton features must reproduce the conditioning UniMate's own
// preprocessing produced for real skeletons. Fixtures: the published skeleton bundles (the
// eight in BasinShapers/unimate-webgpu, skeletons/<key>/demo.{json,bin}), whose arrays are the
// model inputs exported from PyTorch. From each bundle's canonical rest positions and parents,
// the JS features must give the same depths, relations, graph distances and normalized tpos,
// and the same spectral subspaces (eigenvectors are unique only up to sign and, for a repeated
// eigenvalue, up to a basis of its subspace, so subspaces are compared by projector).
// Input: UNIMATE_SKELETONS_DIR. Without it the test reports SKIPPED, exit 3.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { skeletonConditioning, topology, spectralFeatures, canonicalizeRest, bfsOrder, UNIMATE_STATS } from '../unimate-rig-features.js';

const dir = process.env.UNIMATE_SKELETONS_DIR;
if (!dir || !fs.existsSync(path.join(dir, 'index.json'))) {
  console.log(`rig features contracts: SKIPPED (UNIMATE_SKELETONS_DIR=${dir ?? ''} lacks index.json)`);
  process.exit(3);
}

function loadBundle(key) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, key, 'demo.json'), 'utf8'));
  const bin = fs.readFileSync(path.join(dir, key, 'demo.bin'));
  const arrays = {};
  for (const e of index.arrays) {
    const bytes = bin.buffer.slice(bin.byteOffset + e.offset, bin.byteOffset + e.offset + e.byteLength);
    arrays[e.name] = e.dtype === 'int32' ? new Int32Array(bytes) : new Float32Array(bytes);
  }
  return { index, arrays };
}

const keys = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).skeletons.map(s => s.key);
let spectralClusters = 0, spectralSkipped = 0;
for (const key of keys) {
  const { index, arrays } = loadBundle(key);
  const { parents, joints: J } = index.skeleton;
  const rest = Array.from({ length: J }, (_, j) => Array.from(arrays.restPositions.subarray(j * 3, j * 3 + 3)));

  // Normalization constants are the model's, the same for every skeleton.
  assert.deepEqual(Array.from(arrays.mean.subarray(0, 12)), Array.from(UNIMATE_STATS.meanRoot), `${key}: root mean`);
  assert.deepEqual(Array.from(arrays.std.subarray(12, 24)), Array.from(UNIMATE_STATS.stdLocal), `${key}: local std`);

  const c = skeletonConditioning({ rest, parents });
  assert.deepEqual(Array.from(c.depths), Array.from(arrays.depths), `${key}: depths`);
  assert.deepEqual(Array.from(c.jointRelations), Array.from(arrays.jointRelations), `${key}: joint relations`);
  assert.deepEqual(Array.from(c.graphDist), Array.from(arrays.graphDist), `${key}: graph distances`);
  for (const [name, got, want] of [['tpos', c.tpos, arrays.tpos], ['tposParents', c.tposParents, arrays.tposParents],
    ['mean', c.mean, arrays.mean], ['std', c.std, arrays.std]]) {
    assert.equal(got.length, want.length, `${key}: ${name} length`);
    let worst = 0;
    for (let i = 0; i < got.length; i++) worst = Math.max(worst, Math.abs(got[i] - want[i]) / Math.max(1, Math.abs(want[i])));
    assert.ok(worst <= 1e-5, `${key}: ${name} differs by ${worst}`);
  }

  // Spectral: compare each eigenvalue cluster's subspace that lies fully inside the 8 columns.
  const { vectors, values } = spectralFeatures(parents, { withValues: true });
  const k = Math.min(J - 1, 8);
  for (let a = 0; a < k;) {
    let b = a + 1;
    while (b < values.length && Math.abs(values[b] - values[a]) < 1e-6) b++;
    if (b > k) { spectralSkipped++; break; }   // a repeated eigenvalue straddles the cutoff: the stored pick is arbitrary
    for (let r = 0; r < J; r++) for (let s = 0; s < J; s++) {
      let pg = 0, pw = 0;
      for (let q = a; q < b; q++) { pg += vectors[r * 8 + q] * vectors[s * 8 + q]; pw += arrays.spectral[r * 8 + q] * arrays.spectral[s * 8 + q]; }
      assert.ok(Math.abs(pg - pw) < 1e-4, `${key}: spectral subspace ${a}..${b - 1} differs at (${r}, ${s}): ${pg} vs ${pw}`);
    }
    spectralClusters++;
    a = b;
  }
  for (let j = 0; j < J; j++) for (let q = k; q < 8; q++) assert.equal(vectors[j * 8 + q], 0, `${key}: padding column ${q}`);

  // Canonicalization: a moved, turned and scaled copy of the canonical pose comes back to it.
  const yaw = 0.7 + key.length, scale = 1.7, shift = [3, 0.4, -2];
  const moved = rest.map(([x, y, z]) => [scale * (x * Math.cos(yaw) + z * Math.sin(yaw)) + shift[0], scale * y + shift[1],
    scale * (-x * Math.sin(yaw) + z * Math.cos(yaw)) + shift[2]]);
  const facing = { forward: [Math.sin(yaw), 0, Math.cos(yaw)] };   // where +Z went
  const back = canonicalizeRest(moved, parents, facing);
  let worst = 0;
  for (let j = 0; j < J; j++) for (let d = 0; d < 3; d++) worst = Math.max(worst, Math.abs(back[j][d] - rest[j][d]));
  assert.ok(worst < 1e-5, `${key}: canonicalization off by ${worst}`);
  assert.ok(back[0][0] === 0 && back[0][2] === 0, `${key}: root x and z must be exactly 0`);
}

// BFS order puts every parent before its children and the root first.
const order = bfsOrder([3, -1, 1, 1, 2]);
assert.equal(order.order[0], 1);
order.parents.forEach((p, j) => assert.ok(p < j, 'parent after child'));

console.log(`rig features contracts: pass (${keys.length} skeletons, ${spectralClusters} spectral subspaces, ${spectralSkipped} cutoff-straddling clusters skipped)`);
