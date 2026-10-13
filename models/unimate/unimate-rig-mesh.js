// The skinned mesh of an imported rig, bound to the skeleton UniMate animates.
//
// UniMate generates motion for the canonical skeleton (rest pose turned to face +Z, centred,
// scaled to tree diameter 2, grounded; rig_preprocess bakes the asset into the same frame). Each
// vertex is bound there through its own skin joints: v_c = sum_g w_g * C * RestWorld_g * IBM_g * v,
// C the canonical similarity and RestWorld_g the joint's rest transform as the importer reads it
// (Blender's bind pose, armature rotation, any rest turn). Weights move onto the kept joints in
// UniMate's (BFS) order: a pruned joint's weight goes to the kept joint it follows, influences are
// merged, the 8 largest kept and renormalized.
//
// In that bind, joint u rests at tpos_u with identity rotation, so the skinning matrix of a frame
// is World_u(t) * Translate(-tpos_u) (skinMatrices below), and the same holds for the glTF export.
import { readAccessor, multiply, invert } from './unimate-rig-glb.js';

const INFLUENCES = 8;
const NORMALIZED = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

function readFloats(gltf, index) {
  const acc = gltf.json.accessors[index], raw = readAccessor(gltf, index);
  if (acc.componentType === 5126 || !acc.normalized) return Float32Array.from(raw);
  return Float32Array.from(raw, v => Math.max(v / NORMALIZED[acc.componentType], -1));
}
const rigidMatrix = ({ r, t }) => [...r[0], 0, ...r[1], 0, ...r[2], 0, ...t, 1];

// rig: importRig/turnRest output; bfsOrder: { order } (BFS index -> rig index); canonical: canonicalTransform().
export function extractSkinnedMesh(gltf, rig, bfs, canonical) {
  const { json } = gltf;
  const toBfs = new Map(bfs.order.map((rigIndex, u) => [rigIndex, u]));
  const C = (() => {
    const s = canonical.scale, R = canonical.rotation, o = canonical.apply([0, 0, 0]);
    return [...R[0].map(v => v * s), 0, ...R[1].map(v => v * s), 0, ...R[2].map(v => v * s), 0, ...o, 1];
  })();
  const bind = rig.skinBind.map(b => {
    if (!b.restWorld) return null;
    const m = multiply(C, multiply(rigidMatrix(b.restWorld), b.inverseBind ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    return { m, kept: toBfs.get(b.kept) ?? 0 };
  });
  const positions = [], normals = [], uvs = [], joints = [], weights = [], indices = [], groups = [];
  const materials = new Map();
  let base = 0;
  for (const node of json.nodes) {
    if (node.skin !== rig.skin || node.mesh === undefined) continue;
    for (const prim of json.meshes[node.mesh].primitives) {
      if ((prim.mode ?? 4) !== 4 || prim.attributes.POSITION === undefined || prim.attributes.JOINTS_0 === undefined) continue;
      const P = readFloats(gltf, prim.attributes.POSITION), n = P.length / 3;
      const N = prim.attributes.NORMAL !== undefined ? readFloats(gltf, prim.attributes.NORMAL) : null;
      const UV = prim.attributes.TEXCOORD_0 !== undefined ? readFloats(gltf, prim.attributes.TEXCOORD_0) : null;
      const sets = [];
      for (let k = 0; prim.attributes[`JOINTS_${k}`] !== undefined; k++) {
        sets.push([readAccessor(gltf, prim.attributes[`JOINTS_${k}`]), readFloats(gltf, prim.attributes[`WEIGHTS_${k}`])]);
      }
      for (let i = 0; i < n; i++) {
        const v = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 1], nv = N ? [N[i * 3], N[i * 3 + 1], N[i * 3 + 2], 0] : [0, 1, 0, 0];
        const pos = [0, 0, 0], nor = [0, 0, 0], kept = new Map();
        let total = 0;
        for (const [J, W] of sets) for (let c = 0; c < 4; c++) {
          const w = W[i * 4 + c], b = bind[J[i * 4 + c]];
          if (!(w > 0) || !b) continue;
          for (let r = 0; r < 3; r++) {
            pos[r] += w * (b.m[r] * v[0] + b.m[4 + r] * v[1] + b.m[8 + r] * v[2] + b.m[12 + r]);
            nor[r] += w * (b.m[r] * nv[0] + b.m[4 + r] * nv[1] + b.m[8 + r] * nv[2]);
          }
          kept.set(b.kept, (kept.get(b.kept) ?? 0) + w);
          total += w;
        }
        if (total > 0) for (let r = 0; r < 3; r++) pos[r] /= total;
        const nl = Math.hypot(...nor) || 1;
        positions.push(...pos); normals.push(...nor.map(x => x / nl));
        uvs.push(UV ? UV[i * 2] : 0, UV ? UV[i * 2 + 1] : 0);
        const top = [...kept].sort((a, b) => b[1] - a[1]).slice(0, INFLUENCES);
        const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
        for (let c = 0; c < INFLUENCES; c++) { joints.push(top[c]?.[0] ?? 0); weights.push(top[c] ? top[c][1] / sum : 0); }
      }
      const first = indices.length;
      if (prim.indices !== undefined) for (const x of readAccessor(gltf, prim.indices)) indices.push(base + x);
      else for (let i = 0; i < n; i++) indices.push(base + i);
      const matIndex = prim.material ?? -1;
      if (!materials.has(matIndex)) materials.set(matIndex, readMaterial(gltf, matIndex));
      groups.push({ first, count: indices.length - first, material: matIndex });
      base += n;
    }
  }
  if (!positions.length) return null;
  return {
    positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs),
    joints: Uint32Array.from(joints), weights: Float32Array.from(weights), indices: Uint32Array.from(indices),
    groups, materials: Object.fromEntries(materials), vertexCount: positions.length / 3,
  };
}

// Base colour factor and texture (image bytes and type) of a material; -1 is the default material.
function readMaterial(gltf, index) {
  const { json, bin } = gltf;
  const m = index >= 0 ? json.materials?.[index] ?? {} : {};
  const pbr = m.pbrMetallicRoughness ?? {};
  let image = null;
  const tex = pbr.baseColorTexture ? json.textures?.[pbr.baseColorTexture.index] : null;
  const img = tex?.source !== undefined ? json.images?.[tex.source] : null;
  if (img?.bufferView !== undefined && bin) {
    const bv = json.bufferViews[img.bufferView];
    image = { bytes: bin.slice(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength), mimeType: img.mimeType ?? 'image/png' };
  }
  return { name: m.name ?? null, baseColor: pbr.baseColorFactor ?? [1, 1, 1, 1], image, doubleSided: Boolean(m.doubleSided) };
}

// Per-frame skinning matrices (column-major 4x4 per joint) for a decoded motion: World_u(t) * T(-tpos_u).
// motion: { frames, positions [T, J, 3], localRotations [T, J, 4] (w, x, y, z) }; parents in the same order.
export function skinMatrices(motion, parents, rest) {
  const T = motion.frames, J = parents.length, out = new Float32Array(T * J * 16);
  const qmul = ([w1, x1, y1, z1], [w2, x2, y2, z2]) => [w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2];
  for (let t = 0; t < T; t++) {
    const g = new Array(J);
    for (let j = 0; j < J; j++) {
      const l = Array.from(motion.localRotations.subarray((t * J + j) * 4, (t * J + j) * 4 + 4));
      g[j] = parents[j] < 0 ? l : qmul(g[parents[j]], l);
      const [w, x, y, z] = g[j];
      const R = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
      const P = [0, 1, 2].map(c => motion.positions[(t * J + j) * 3 + c]), r0 = rest[j];
      const o = (t * J + j) * 16;
      out.set([R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0,
        P[0] - (R[0] * r0[0] + R[3] * r0[1] + R[6] * r0[2]), P[1] - (R[1] * r0[0] + R[4] * r0[1] + R[7] * r0[2]),
        P[2] - (R[2] * r0[0] + R[5] * r0[1] + R[8] * r0[2]), 1], o);
    }
  }
  return out;
}
export { invert };
