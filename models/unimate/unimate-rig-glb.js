// Read a rigged skeleton from a binary glTF (.glb): the skin's joints, their hierarchy and
// their rest-pose world transforms, for the browser rig importer.
//
// The rest pose is the scene's node transforms (translation, rotation, scale or matrix) composed
// down the node tree. The bind pose (the inverse of each joint's inverse bind matrix) is reported
// too; most exporters write the two equal. Parents are the nearest ancestor node that is also a
// joint of the same skin (-1 for a root). Matrices are column-major 4x4 (glTF layout).

const GLB_MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;

export function parseGlb(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a binary glTF (.glb) file');
  if (view.getUint32(4, true) !== 2) throw new Error(`unsupported glTF version ${view.getUint32(4, true)}`);
  let json = null, bin = null;
  for (let at = 12; at + 8 <= view.byteLength;) {
    const length = view.getUint32(at, true), type = view.getUint32(at + 4, true);
    const body = new Uint8Array(buffer, at + 8, length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === CHUNK_BIN && !bin) bin = body;
    at += 8 + length;
  }
  if (!json) throw new Error('glb has no JSON chunk');
  return { json, bin };
}

const COMPONENTS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

// An accessor's values as a flat typed array (tightly packed, normalized integers not rescaled).
export function readAccessor({ json, bin }, index) {
  const acc = json.accessors[index];
  const Type = COMPONENTS[acc.componentType], width = WIDTH[acc.type];
  const out = new Type(acc.count * width);
  if (acc.bufferView === undefined) return out;
  const bv = json.bufferViews[acc.bufferView];
  if ((bv.buffer ?? 0) !== 0 || !bin) throw new Error('only the glb binary chunk is supported as a buffer');
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0), size = Type.BYTES_PER_ELEMENT;
  const stride = bv.byteStride ?? width * size;
  const view = new DataView(bin.buffer, bin.byteOffset);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[acc.componentType];
  for (let i = 0; i < acc.count; i++) for (let c = 0; c < width; c++) out[i * width + c] = view[get](base + i * stride + c * size, true);
  return out;
}

export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function multiply(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
export function invert(m) {
  // General 4x4 inverse (cofactors).
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) throw new Error('singular matrix');
  const d = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
}
export function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0], [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

// The skeleton of one skin (the one with the most joints unless skinIndex is given).
export function readSkeleton(gltf, { skinIndex = null } = {}) {
  const { json } = gltf;
  if (!json.skins?.length) throw new Error('this file has no skin (rig): export it with its armature');
  const skin = skinIndex ?? json.skins.reduce((best, s, i) => (s.joints.length > json.skins[best].joints.length ? i : best), 0);
  const joints = json.skins[skin].joints;
  const parentOf = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parentOf.set(c, i)));
  // World transform of every node, composed from the scene roots down.
  const world = new Map();
  const visit = (i, parent) => {
    const m = multiply(parent, nodeMatrix(json.nodes[i]));
    world.set(i, m);
    for (const c of json.nodes[i].children ?? []) visit(c, m);
  };
  json.nodes.forEach((_, i) => { if (!parentOf.has(i)) visit(i, identity()); });
  const slot = new Map(joints.map((node, j) => [node, j]));
  const parents = joints.map(node => {
    for (let p = parentOf.get(node); p !== undefined; p = parentOf.get(p)) if (slot.has(p)) return slot.get(p);
    return -1;
  });
  const ibm = json.skins[skin].inverseBindMatrices !== undefined ? readAccessor(gltf, json.skins[skin].inverseBindMatrices) : null;
  return {
    skin,
    names: joints.map((node, j) => json.nodes[node].name ?? `joint_${j}`),
    nodes: joints,
    parents,
    restWorld: joints.map(node => world.get(node)),
    bindWorld: ibm ? joints.map((_, j) => invert(Array.from(ibm.subarray(j * 16, j * 16 + 16)))) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// importRig: the skeleton UniMate's preprocessing would export from this file, the way its
// Blender import and static export prune it (data_process/rig_preprocess/export.py,
// utils/blender_export.py):
//
// - Bones: the skin's joints plus every node between a joint and the joints' deepest common
//   ancestor (the armature; when that ancestor is itself a joint, its parent is).
// - Rest pose: Blender's guess of the bind pose (see below): from the inverse bind matrices
//   where a bone and its parent both have one; otherwise the node transform. Scale is dropped
//   from each local transform, as Blender's edit bones carry none; the root also takes the
//   armature's world rotation. Joint positions are bone heads.
// - Pruning, repeated until nothing changes or 4 joints remain: remove prunable leaves, collapse
//   an unskinned single-child root into its child, merge prunable pass-through bones into their
//   child. A bone is prunable only without skin weight (max weight < 1e-5) and with a control-rig
//   name (MCH-/ORG-/VIS-, _ik, _pole, _target, _ctrl, _tweak, _helper; a _tip leaf is kept) or a
//   rest offset under 1e-3 of the mean bone length.
//
// Returns { names, parents (root first, parents before children), positions (J x [x, y, z],
// glTF world axes, Y up), restLocalPos / restLocalRot (each bone relative to its parent, quaternions
// w, x, y, z: the export NPZ's rest arrays), weights (max skin weight per joint), pruned (removed
// bone names) }.

function decomposeRigid(m) {
  const col = c => { const v = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]], l = Math.hypot(...v) || 1; return v.map(x => x / l); };
  return { r: [col(0), col(1), col(2)], t: [m[12], m[13], m[14]] };   // r: columns of the rotation
}
// Rotation (columns r) to a unit quaternion [w, x, y, z].
function quatFromRot(r) {
  const m00 = r[0][0], m10 = r[0][1], m20 = r[0][2], m01 = r[1][0], m11 = r[1][1], m21 = r[1][2], m02 = r[2][0], m12 = r[2][1], m22 = r[2][2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s]; }
  const n = Math.hypot(...q);
  return q.map(x => x / n);
}
const rotApply = (r, v) => [0, 1, 2].map(i => r[0][i] * v[0] + r[1][i] * v[1] + r[2][i] * v[2]);
const rotMul = (a, b) => b.map(col => rotApply(a, col));
const compose = (a, b) => ({ r: rotMul(a.r, b.r), t: rotApply(a.r, b.t).map((x, i) => x + a.t[i]) });

const CONTROL_PREFIXES = ['MCH-', 'ORG-', 'VIS-'];
const CONTROL_SUFFIXES = ['_ik', '.ik', '_pole', '.pole', '_target', '_tip', '_ctrl', '.ctrl', '_tweak', '_helper'];
const isControlName = name => CONTROL_PREFIXES.some(p => name.startsWith(p)) || CONTROL_SUFFIXES.some(s => name.toLowerCase().endsWith(s));

function skinWeights(gltf, skin, nJoints) {
  const { json } = gltf;
  const max = new Float64Array(nJoints), sum = new Float64Array(nJoints);
  const scaleOf = { 5121: 1 / 255, 5123: 1 / 65535, 5126: 1 };
  let meshes = 0;
  for (const node of json.nodes) {
    if (node.skin !== skin || node.mesh === undefined) continue;
    for (const prim of json.meshes[node.mesh].primitives) {
      for (let set = 0; prim.attributes[`JOINTS_${set}`] !== undefined; set++) {
        const joints = readAccessor(gltf, prim.attributes[`JOINTS_${set}`]);
        const wAcc = prim.attributes[`WEIGHTS_${set}`];
        const weights = readAccessor(gltf, wAcc), ws = scaleOf[json.accessors[wAcc].componentType] ?? 1;
        for (let i = 0; i < joints.length; i++) { const w = weights[i] * ws; sum[joints[i]] += w; if (w > max[joints[i]]) max[joints[i]] = w; }
        meshes++;
      }
    }
  }
  return { max, sum, meshes };
}

export function importRig(gltf, { skinIndex = null, minJoints = 4 } = {}) {
  const { json } = gltf;
  if (!json.skins?.length) throw new Error('this file has no skin (rig): export it with its armature');
  const skin = skinIndex ?? json.skins.reduce((best, s, i) => (s.joints.length > json.skins[best].joints.length ? i : best), 0);
  const jointNodes = json.skins[skin].joints;
  const parentOf = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parentOf.set(c, i)));
  const ancestors = node => { const out = []; for (let p = node; p !== undefined; p = parentOf.get(p)) out.unshift(p); return out; };

  // Armature: the joints' deepest common ancestor, or its parent when it is a joint.
  const chains = jointNodes.map(ancestors);
  let common = chains[0].length;
  for (const c of chains) { let k = 0; while (k < Math.min(common, c.length) && c[k] === chains[0][k]) k++; common = k; }
  const jointSet = new Set(jointNodes);
  let deepest = common > 0 ? chains[0][common - 1] : undefined;
  const armature = deepest !== undefined && jointSet.has(deepest) ? parentOf.get(deepest) : deepest;
  if (common === 0) throw new Error('the skin\'s joints are not under one node');

  // Bones: joints and the nodes between them and the armature, in depth-first order from the root.
  const boneSet = new Set();
  for (const j of jointNodes) for (let p = j; p !== undefined && p !== armature; p = parentOf.get(p)) boneSet.add(p);
  // Several root bones: keep the one whose subtree carries the most skin weight (summed over
  // vertices), as UniMate's export does (blender_export.prune_secondary_roots).
  const { max: jointWeight, sum: jointWeightSum, meshes } = skinWeights(gltf, skin, jointNodes.length);
  const jointSlot = new Map(jointNodes.map((n, j) => [n, j]));
  let roots = [...boneSet].filter(b => !boneSet.has(parentOf.get(b)));
  const secondary = [];
  if (roots.length > 1) {
    const subtree = r => { const out = []; for (const st = [r]; st.length;) { const b = st.pop(); out.push(b); st.push(...(json.nodes[b].children ?? []).filter(c => boneSet.has(c))); } return out; };
    const weightOf = r => subtree(r).reduce((w, b) => w + (jointSlot.has(b) ? jointWeightSum[jointSlot.get(b)] : 0), 0);
    const best = roots.reduce((a, b) => (weightOf(b) > weightOf(a) ? b : a));
    for (const r of roots) if (r !== best) for (const b of subtree(r)) { boneSet.delete(b); secondary.push(json.nodes[b].name ?? `Node_${b}`); }
    roots = [best];
  }
  if (roots.length !== 1) throw new Error(`the rig has ${roots.length} root bones; UniMate needs one`);
  const order = [];
  for (const stack = [roots[0]]; stack.length;) {
    const b = stack.pop();
    order.push(b);
    stack.push(...(json.nodes[b].children ?? []).filter(c => boneSet.has(c)).reverse());
  }
  const slot = new Map(order.map((b, i) => [b, i]));

  // Rest pose (rigid local transforms) and skin weights.
  // Blender's guess of the original bind pose (io_scene_gltf2 vnode.pick_bind_pose): inverse
  // binds are taken relative to the skin's skeleton node (or its parent, when that is a joint)
  // and to the scene root, both identity; a bone whose parent also has one takes its local pose
  // from them, any other bone keeps its node transform.
  const ibmData = json.skins[skin].inverseBindMatrices !== undefined ? readAccessor(gltf, json.skins[skin].inverseBindMatrices) : null;
  const ibm = new Map([['root', identity()]]);
  if (ibmData) {
    let skel = json.skins[skin].skeleton;
    if (skel !== undefined) { if (jointSet.has(skel)) skel = parentOf.get(skel) ?? 'root'; ibm.set(skel, identity()); }
    jointNodes.forEach((n, j) => ibm.set(n, Array.from(ibmData.subarray(j * 16, j * 16 + 16))));
  }
  const armatureWorld = armature === undefined ? identity() : ancestors(armature).reduce((m, n) => multiply(m, nodeMatrix(json.nodes[n])), identity());
  let bones = order.map(b => {
    const p = parentOf.get(b), pKey = boneSet.has(p) ? p : (armature ?? 'root');
    const local = ibmData && ibm.has(b) && ibm.has(pKey) ? multiply(ibm.get(pKey), invert(ibm.get(b))) : nodeMatrix(json.nodes[b]);
    // An unnamed node gets Blender's name for it, Node_<index>.
    return { node: b, name: json.nodes[b].name ?? `Node_${b}`, parent: boneSet.has(p) ? slot.get(p) : -1, local: decomposeRigid(local),
      weight: jointSlot.has(b) ? jointWeight[jointSlot.get(b)] : 0 };
  });
  const arm = decomposeRigid(armatureWorld), armScale = Math.hypot(armatureWorld[0], armatureWorld[1], armatureWorld[2]) || 1;
  const rootWorld = compose(arm, bones[0].local);
  bones[0].local = { r: rootWorld.r, t: [0, 1, 2].map(i => (multiply(armatureWorld, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...bones[0].local.t, 1])[12 + i]) / armScale) };

  // Pruning.
  const pruned = [...secondary];
  const childrenOf = list => { const ch = list.map(() => []); list.forEach((b, j) => { if (b.parent >= 0) ch[b.parent].push(j); }); return ch; };
  const meanBone = list => { const l = list.slice(1).map(b => Math.hypot(...b.local.t)).filter(x => x > 1e-6); return l.length ? l.reduce((a, b) => a + b) / l.length : 1; };
  const prunable = (b, leaf, mbl) => {
    if (b.weight >= 1e-5) return false;
    if (isControlName(b.name) && !(leaf && b.name.toLowerCase().endsWith('_tip'))) return true;
    return Math.hypot(...b.local.t) / Math.max(mbl, 1e-9) < 1e-3;
  };
  // Depth-first from the root, root first, parents remapped.
  const reorder = list => {
    const ch = childrenOf(list), out = [];
    for (const stack = [list.findIndex(b => b.parent < 0)]; stack.length;) { const j = stack.pop(); out.push(j); stack.push(...ch[j].slice().reverse()); }
    const at = new Map(out.map((j, i) => [j, i]));
    return out.map(j => ({ ...list[j], parent: list[j].parent < 0 ? -1 : at.get(list[j].parent) }));
  };
  const remove = (list, drop) => {
    const keep = list.map((_, j) => j).filter(j => !drop.has(j)), at = new Map(keep.map((j, i) => [j, i]));
    return keep.map(j => ({ ...list[j], parent: list[j].parent < 0 ? -1 : at.get(list[j].parent) }));
  };
  while (bones.length > minJoints) {
    let changed = 0;
    for (;;) {                                                          // 1. leaves
      const ch = childrenOf(bones), mbl = meanBone(bones);
      const drop = new Set(bones.map((b, j) => j).filter(j => !ch[j].length && prunable(bones[j], true, mbl)));
      if (!drop.size || bones.length - drop.size < minJoints) break;
      drop.forEach(j => pruned.push(bones[j].name));
      bones = remove(bones, drop); changed += drop.size;
    }
    for (;;) {                                                          // 2. unskinned single-child root
      const ch = childrenOf(bones);
      if (ch[0].length !== 1 || bones[0].weight >= 1e-5) break;
      const c = ch[0][0];
      bones[c] = { ...bones[c], parent: -1, local: compose(bones[0].local, bones[c].local) };
      pruned.push(bones[0].name);
      bones = reorder(remove(bones, new Set([0])));
      changed++;
    }
    for (;;) {                                                          // 3. pass-through bones, deepest first
      const ch = childrenOf(bones), mbl = meanBone(bones);
      const cands = new Set(bones.map((b, j) => j).filter(j => j !== 0 && ch[j].length === 1 && prunable(bones[j], false, mbl)));
      if (!cands.size) break;
      let j = [...cands][0];
      while (cands.has(ch[j][0])) j = ch[j][0];
      const c = ch[j][0];
      bones[c] = { ...bones[c], parent: bones[j].parent, local: compose(bones[j].local, bones[c].local) };
      pruned.push(bones[j].name);
      bones = remove(bones, new Set([j]));
      changed++;
    }
    if (!changed) break;
  }
  bones = reorder(bones);
  const world = [];
  bones.forEach((b, j) => { world[j] = b.parent < 0 ? b.local : compose(world[b.parent], b.local); });
  return { names: bones.map(b => b.name), parents: bones.map(b => b.parent), positions: world.map(w => w.t),
    restLocalPos: bones.map(b => b.local.t), restLocalRot: bones.map(b => quatFromRot(b.local.r)),
    weights: bones.map(b => b.weight), pruned, skinnedMeshes: meshes, armature: armature ?? null };
}
