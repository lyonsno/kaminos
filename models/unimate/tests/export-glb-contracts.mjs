// The downloadable .glb must play back the generated motion: read back with the page's own glTF
// reader, its joint hierarchy (rest translations) animated by its rotation and root-translation
// tracks must put every joint where the decoded motion does, at every frame; its skin must bind
// the mesh at rest (inverse bind = translate by -rest); and the mesh, weights and materials must
// survive the round trip. Synthetic motion (random local rotations on a small tree) keeps the
// test self-contained; the decode's own forward kinematics is the reference.
import assert from 'node:assert/strict';
import { exportMotionGlb } from '../unimate-export-glb.js';
import { parseGlb, readAccessor } from '../unimate-rig-glb.js';

const parents = [-1, 0, 1, 0, 3, 4];
const J = parents.length, T = 7;
let seed = 7;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 - 0.5; };
const rest = parents.map((p, j) => (p < 0 ? [0, 0.6, 0] : [rand(), 0.2 + Math.abs(rand()), rand()]));
for (let j = 1; j < J; j++) rest[j] = rest[j].map((v, c) => v + rest[parents[j]][c]);
const localRotations = new Float64Array(T * J * 4), rootTranslation = new Float64Array(T * 3);
for (let t = 0; t < T; t++) {
  for (let j = 0; j < J; j++) {
    const q = [1 + rand(), rand(), rand(), rand()], n = Math.hypot(...q);
    localRotations.set(q.map(v => v / n), (t * J + j) * 4);
  }
  rootTranslation.set([0.1 * t, 0.6 + 0.05 * rand(), 0.02 * t], t * 3);
}
// Reference: the decode's FK (global = parent global * local; offsets from the rest).
const qmul = ([w1, x1, y1, z1], [w2, x2, y2, z2]) => [w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
  w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2];
const qrot = (q, v) => qmul(qmul(q, [0, ...v]), [q[0], -q[1], -q[2], -q[3]]).slice(1);
const positions = new Float64Array(T * J * 3);
for (let t = 0; t < T; t++) {
  const g = [], p = [];
  for (let j = 0; j < J; j++) {
    const l = Array.from(localRotations.subarray((t * J + j) * 4, (t * J + j) * 4 + 4));
    if (parents[j] < 0) { g[j] = l; p[j] = Array.from(rootTranslation.subarray(t * 3, t * 3 + 3)); }
    else { const pp = parents[j]; g[j] = qmul(g[pp], l); p[j] = qrot(g[pp], rest[j].map((v, c) => v - rest[pp][c])).map((v, c) => v + p[pp][c]); }
    positions.set(p[j], (t * J + j) * 3);
  }
}
const mesh = {
  vertexCount: 3, positions: Float32Array.from([0, 0.5, 0, 0.2, 0.9, 0, 0, 0.9, 0.2]), normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  uvs: Float32Array.from([0, 0, 1, 0, 0, 1]), joints: Uint32Array.from([0, 1, 0, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0]),
  weights: Float32Array.from([0.7, 0.3, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
  indices: Uint32Array.from([0, 1, 2]), groups: [{ first: 0, count: 3, material: 0 }], materials: { 0: { name: 'skin', baseColor: [0.5, 0.4, 0.3, 1], image: null } },
};
const names = parents.map((_, j) => `joint_${j}`);
const glb = exportMotionGlb({ name: 'test', jointNames: names, parents, rest, motion: { frames: T, localRotations, rootTranslation }, mesh });
const gltf = parseGlb(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
const { json } = gltf;

// Hierarchy and tracks.
assert.equal(json.skins[0].joints.length, J);
const anim = json.animations[0];
const track = (node, path) => {
  const ch = anim.channels.find(c => c.target.node === node && c.target.path === path);
  return ch ? readAccessor(gltf, anim.samplers[ch.sampler].output) : null;
};
const times = readAccessor(gltf, anim.samplers[0].input);
assert.equal(times.length, T);
assert.ok(Math.abs(times[T - 1] - (T - 1) / 30) < 1e-6, 'times at 30 fps');
const childOf = new Map();
json.nodes.forEach((n, i) => (n.children ?? []).forEach(c => childOf.set(c, i)));
let worst = 0;
for (let t = 0; t < T; t++) {
  const g = [], p = [];
  for (let j = 0; j < J; j++) {
    const r = track(j, 'rotation'), q = [r[t * 4 + 3], r[t * 4], r[t * 4 + 1], r[t * 4 + 2]];
    const tr = j === 0 ? Array.from(track(0, 'translation').subarray(t * 3, t * 3 + 3)) : json.nodes[j].translation;
    const pp = childOf.get(j);
    if (pp === undefined) { g[j] = q; p[j] = tr; } else { g[j] = qmul(g[pp], q); p[j] = qrot(g[pp], tr).map((v, c) => v + p[pp][c]); }
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(p[j][c] - positions[(t * J + j) * 3 + c]));
  }
}
assert.ok(worst < 1e-5, `exported animation misplaces joints by ${worst}`);

// Skin binds at rest; mesh, weights and material survive.
const ibm = readAccessor(gltf, json.skins[0].inverseBindMatrices);
for (let j = 0; j < J; j++) for (let c = 0; c < 3; c++) assert.ok(Math.abs(ibm[j * 16 + 12 + c] + rest[j][c]) < 1e-6, 'inverse bind translates by -rest');
const prim = json.meshes[0].primitives[0];
assert.deepEqual(Array.from(readAccessor(gltf, prim.attributes.JOINTS_0)), [0, 1, 0, 0, 1, 2, 0, 0, 3, 0, 0, 0]);
assert.deepEqual(Array.from(readAccessor(gltf, prim.attributes.WEIGHTS_0)).map(v => +v.toFixed(4)), [0.7, 0.3, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0]);
assert.deepEqual(json.materials[0].pbrMetallicRoughness.baseColorFactor, [0.5, 0.4, 0.3, 1]);
assert.equal(json.nodes.find(n => n.mesh === 0)?.skin, 0);
console.log(`export glb contracts: pass (${J} joints, ${T} frames, worst joint error ${worst.toExponential(1)})`);
