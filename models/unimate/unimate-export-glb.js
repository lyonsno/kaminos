// A generated motion as an animated glTF binary (.glb), for download.
//
// The skeleton is UniMate's for the clip: one node per joint at its canonical rest pose (joint
// translations from the rest positions, identity rest rotations), animated with the decoded local
// rotations of every joint and the root's translation, 30 fps by default. With a mesh
// (unimate-rig-mesh.js, an imported rig's skinned mesh bound to this skeleton) the file also holds
// the mesh, its skin (inverse bind matrices translate by -rest) and its materials and textures,
// the way rig_preprocess's canonical asset and its animation export pair up.
//
// exportMotionGlb({ name, jointNames, parents, rest, motion: { frames, localRotations [T, J, 4] (w, x, y, z),
//   rootTranslation [T, 3] }, fps, mesh, extras }) -> Uint8Array

export function exportMotionGlb({ name = 'unimate-motion', jointNames, parents, rest, motion, fps = 30, mesh = null, extras = {} }) {
  const J = parents.length, T = motion.frames;
  const chunks = [], bufferViews = [], accessors = [];
  let byteLength = 0;
  const addView = (bytes, target) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    byteLength += bytes.byteLength;
    return bufferViews.length - 1;
  };
  const addAccessor = (array, type, componentType, { target, minmax = false, count = null } = {}) => {
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const acc = { bufferView: addView(array, target), componentType, count: count ?? array.length / width, type };
    if (minmax) {
      acc.min = Array(width).fill(Infinity); acc.max = Array(width).fill(-Infinity);
      for (let i = 0; i < array.length; i++) { const c = i % width; acc.min[c] = Math.min(acc.min[c], array[i]); acc.max[c] = Math.max(acc.max[c], array[i]); }
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const FLOAT = 5126, USHORT = 5123, UINT = 5125, ARRAY = 34962, ELEMENTS = 34963;

  // Joint nodes.
  const children = parents.map(() => []);
  parents.forEach((p, j) => { if (p >= 0) children[p].push(j); });
  const nodes = parents.map((p, j) => ({
    name: jointNames[j],
    translation: p < 0 ? [...rest[j]] : [0, 1, 2].map(c => rest[j][c] - rest[p][c]),
    ...(children[j].length ? { children: children[j] } : {}),
  }));
  const root = parents.findIndex(p => p < 0);

  // Animation: local rotations (glTF quaternions are x, y, z, w) and the root's translation.
  const times = Float32Array.from({ length: T }, (_, t) => t / fps);
  const input = addAccessor(times, 'SCALAR', FLOAT, { minmax: true });
  const samplers = [], channels = [];
  for (let j = 0; j < J; j++) {
    const q = new Float32Array(T * 4);
    for (let t = 0; t < T; t++) {
      const o = (t * J + j) * 4;
      q.set([motion.localRotations[o + 1], motion.localRotations[o + 2], motion.localRotations[o + 3], motion.localRotations[o]], t * 4);
    }
    samplers.push({ input, output: addAccessor(q, 'VEC4', FLOAT), interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: j, path: 'rotation' } });
  }
  samplers.push({ input, output: addAccessor(Float32Array.from(motion.rootTranslation), 'VEC3', FLOAT), interpolation: 'LINEAR' });
  channels.push({ sampler: samplers.length - 1, target: { node: root, path: 'translation' } });

  const json = {
    asset: { version: '2.0', generator: 'Kaminos UniMate WebGPU' },
    scene: 0, scenes: [{ name, nodes: [root] }], nodes,
    animations: [{ name, samplers, channels }],
    accessors, bufferViews, buffers: [{ byteLength: 0 }],
    extras,
  };

  // The skin (inverse bind matrices translate by -rest), written with or without a mesh so that
  // tools such as Blender import the joints as an armature.
  const ibm = new Float32Array(J * 16);
  for (let j = 0; j < J; j++) ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -rest[j][0], -rest[j][1], -rest[j][2], 1], j * 16);
  json.skins = [{ joints: parents.map((_, j) => j), inverseBindMatrices: addAccessor(ibm, 'MAT4', FLOAT), skeleton: root }];
  if (mesh) {
    const n = mesh.vertexCount;
    const split = (arr, k) => { const out = new Uint16Array(n * 4); for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) out[i * 4 + c] = arr[i * 8 + k * 4 + c]; return out; };
    const splitF = (arr, k) => { const out = new Float32Array(n * 4); for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) out[i * 4 + c] = arr[i * 8 + k * 4 + c]; return out; };
    const attributes = {
      POSITION: addAccessor(mesh.positions, 'VEC3', FLOAT, { target: ARRAY, minmax: true }),
      NORMAL: addAccessor(mesh.normals, 'VEC3', FLOAT, { target: ARRAY }),
      TEXCOORD_0: addAccessor(mesh.uvs, 'VEC2', FLOAT, { target: ARRAY }),
      JOINTS_0: addAccessor(split(mesh.joints, 0), 'VEC4', USHORT, { target: ARRAY }),
      WEIGHTS_0: addAccessor(splitF(mesh.weights, 0), 'VEC4', FLOAT, { target: ARRAY }),
      JOINTS_1: addAccessor(split(mesh.joints, 1), 'VEC4', USHORT, { target: ARRAY }),
      WEIGHTS_1: addAccessor(splitF(mesh.weights, 1), 'VEC4', FLOAT, { target: ARRAY }),
    };
    // Materials (base colour and texture) in the order the groups use them.
    const materialIndex = new Map();
    json.materials = []; json.textures = []; json.images = []; json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    for (const [key, m] of Object.entries(mesh.materials)) {
      const pbr = { baseColorFactor: m.baseColor, metallicFactor: 0, roughnessFactor: 1 };
      if (m.image) {
        json.images.push({ bufferView: addView(m.image.bytes), mimeType: m.image.mimeType });
        json.textures.push({ source: json.images.length - 1, sampler: 0 });
        pbr.baseColorTexture = { index: json.textures.length - 1 };
      }
      json.materials.push({ ...(m.name ? { name: m.name } : {}), pbrMetallicRoughness: pbr, doubleSided: true });
      materialIndex.set(String(key), json.materials.length - 1);
    }
    if (!json.textures.length) { delete json.textures; delete json.images; delete json.samplers; }
    const primitives = mesh.groups.map(g => ({
      attributes,
      indices: addAccessor(mesh.indices.slice(g.first, g.first + g.count), 'SCALAR', UINT, { target: ELEMENTS }),
      material: materialIndex.get(String(g.material)),
    }));
    json.meshes = [{ name: `${name} mesh`, primitives }];
    nodes.push({ name: `${name} mesh`, mesh: 0, skin: 0 });
    json.scenes[0].nodes.push(nodes.length - 1);
  }

  // GLB container: header, JSON chunk (space-padded), BIN chunk (zero-padded).
  const pad4 = n => (4 - (n % 4)) % 4;
  json.buffers[0].byteLength = byteLength;
  const binPad = pad4(byteLength);
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonBytes = new Uint8Array(text.length + pad4(text.length)).fill(0x20);
  jsonBytes.set(text);
  const total = 12 + 8 + jsonBytes.length + 8 + byteLength + binPad;
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true); view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  let at = 20 + jsonBytes.length;
  view.setUint32(at, byteLength + binPad, true); view.setUint32(at + 4, 0x004e4942, true);
  at += 8;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}
