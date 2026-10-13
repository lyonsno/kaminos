// The browser rig importer must reproduce UniMate's own preprocessing of real rigged GLBs.
// Fixtures (tests/export-rig-fixtures.py, upstream preprocess under Blender, static path):
// UNIMATE_RIG_FIXTURES holds <name>/fixture.json and UNIMATE_RIG_GLBS the source GLBs
// (<Name>.glb, matched case-insensitively). For each:
// - importRig gives the export stage's joints in the same order, the same parents and the same
//   local rest arrays (positions to 1e-5 of the rig's size, rotations to 1e-6);
// - with the fixture's facing pair, BFS order + canonical pose + topology give the cond entry's
//   joint order, tpos_first_frame (to 1e-5), depths, relations and graph distances, and its
//   spectral subspaces (compared by projector inside each eigenvalue cluster).
// Without both directories the test reports SKIPPED, exit 3.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importRig, parseGlb } from '../unimate-rig-glb.js';
import { bfsOrder, canonicalizeRest, topology, spectralFeatures } from '../unimate-rig-features.js';

const fixtures = process.env.UNIMATE_RIG_FIXTURES, glbs = process.env.UNIMATE_RIG_GLBS;
if (!fixtures || !glbs || !fs.existsSync(fixtures) || !fs.existsSync(glbs)) {
  console.log(`rig import contracts: SKIPPED (UNIMATE_RIG_FIXTURES=${fixtures ?? ''}, UNIMATE_RIG_GLBS=${glbs ?? ''})`);
  process.exit(3);
}
const glbFor = name => fs.readdirSync(glbs).find(f => f.toLowerCase() === `${name}.glb`);
let checked = 0;
for (const name of fs.readdirSync(fixtures).filter(d => fs.existsSync(path.join(fixtures, d, 'fixture.json'))).sort()) {
  const fx = JSON.parse(fs.readFileSync(path.join(fixtures, name, 'fixture.json'), 'utf8'));
  const file = glbFor(name);
  assert.ok(file, `${name}: no source GLB in ${glbs}`);
  const bytes = fs.readFileSync(path.join(glbs, file));
  const rig = importRig(parseGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));

  // Export stage.
  assert.deepEqual(rig.names, fx.export.names, `${name}: exported joints and their order`);
  assert.deepEqual(rig.parents, fx.export.parents, `${name}: exported parents`);
  const size = Math.max(...fx.export.rest_local_pos.map(p => Math.hypot(...p)));
  rig.restLocalPos.forEach((p, j) => {
    const err = Math.hypot(...p.map((v, d) => v - fx.export.rest_local_pos[j][d]));
    assert.ok(err <= 1e-5 * size, `${name}: ${rig.names[j]} rest position off by ${err}`);
  });
  rig.restLocalRot.forEach((q, j) => {
    const dot = Math.abs(q.reduce((s, v, d) => s + v * fx.export.rest_local_rot[j][d], 0));
    assert.ok(1 - dot <= 1e-6, `${name}: ${rig.names[j]} rest rotation off (|dot| ${dot})`);
  });

  // Features, with the fixture's facing pair.
  const bo = bfsOrder(rig.parents, rig.positions);
  const names = bo.order.map(i => rig.names[i]), P = bo.order.map(i => rig.positions[i]);
  const face = fx.annotation.face ?? {};
  const r = face.r_hip?.raw, l = face.l_hip?.raw;
  const T = canonicalizeRest(P, bo.parents, r && l ? { right: names.indexOf(r), left: names.indexOf(l), bodyAxis: Boolean(face.body_axis) } : null);
  assert.deepEqual(names, fx.cond.joint_names, `${name}: BFS joint order`);
  T.forEach((p, j) => {
    const err = Math.hypot(...p.map((v, d) => v - fx.cond.tpos_first_frame[j][d]));
    assert.ok(err <= 1e-5, `${name}: ${names[j]} canonical position off by ${err}`);
  });
  const topo = topology(bo.parents), J = names.length;
  assert.deepEqual(Array.from(topo.depths), fx.cond.joint_depths, `${name}: depths`);
  assert.deepEqual(Array.from(topo.jointRelations), fx.cond.joint_relations.flat(), `${name}: relations`);
  assert.deepEqual(Array.from(topo.graphDist), fx.cond.joint_graph_dists.flat(), `${name}: graph distances`);
  const { vectors, values } = spectralFeatures(bo.parents, { withValues: true });
  const k = Math.min(J - 1, 8);
  for (let a = 0; a < k;) {
    let b = a + 1;
    while (b < values.length && Math.abs(values[b] - values[a]) < 1e-6) b++;
    if (b > k) break;
    for (let x = 0; x < J; x++) for (let y = 0; y < J; y++) {
      let pg = 0, pw = 0;
      for (let q = a; q < b; q++) { pg += vectors[x * 8 + q] * vectors[y * 8 + q]; pw += fx.cond.spectral_feats[x][q] * fx.cond.spectral_feats[y][q]; }
      assert.ok(Math.abs(pg - pw) < 1e-4, `${name}: spectral subspace ${a}..${b - 1}`);
    }
    a = b;
  }
  checked++;
  console.log(`  ${name}: ${J} joints, ${rig.pruned.length} pruned`);
}
assert.ok(checked > 0, 'no fixtures found');
console.log(`rig import contracts: pass (${checked} rigs)`);
