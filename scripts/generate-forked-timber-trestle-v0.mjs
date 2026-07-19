import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const assetId = 'forked-timber-reliquary-trestle-v0';
const outDir = join(repoRoot, 'artifacts/sinter-forked-timber-trestle-v0-2026-07-18');
const visualPath = join(outDir, 'visual/forked-timber-reliquary-trestle-v0.glb');
const bindingPath = join(outDir, 'binding/forked-timber-reliquary-trestle-v0-binding.glb');
const descriptorPath = join(outDir, 'structuralMeshAssetDescriptor.json');

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
  const len = length(v) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function lerp(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function align4(n) {
  return (n + 3) & ~3;
}

function pushMesh(dst, src) {
  const offset = dst.positions.length / 3;
  dst.positions.push(...src.positions);
  dst.normals.push(...src.normals);
  dst.indices.push(...src.indices.map(index => index + offset));
}

function irregular(scaleSeed, ring, side) {
  const a = Math.sin((scaleSeed + 1) * 0.63 + ring * 1.91 + side * 0.73);
  const b = Math.cos((scaleSeed + 3) * 0.41 + ring * 0.59 - side * 1.17);
  return 1 + 0.105 * a + 0.06 * b;
}

function makeBeam({ start, end, radius = [0.08, 0.1], sides = 8, rings = 5, twist = 0, seed = 1, taper = [1.08, 0.86] }) {
  const positions = [];
  const normals = [];
  const indices = [];
  const axis = normalize(sub(end, start));
  const helper = Math.abs(dot(axis, [0, 1, 0])) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = normalize(cross(axis, helper));
  const v = normalize(cross(u, axis));

  for (let ring = 0; ring < rings; ring += 1) {
    const t = ring / (rings - 1);
    const centerBase = lerp(start, end, t);
    const crook = Math.sin(t * Math.PI) * 0.025;
    const center = add(centerBase, add(scale(u, crook * Math.sin(seed)), scale(v, crook * Math.cos(seed * 0.7))));
    const taperAtRing = taper[0] + (taper[1] - taper[0]) * t;
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2 + twist * t;
      const localU = Math.cos(angle);
      const localV = Math.sin(angle);
      const sideScale = irregular(seed, ring, side) * taperAtRing;
      const radial = normalize(add(scale(u, localU / radius[0]), scale(v, localV / radius[1])));
      const point = add(center, add(
        scale(u, localU * radius[0] * sideScale),
        scale(v, localV * radius[1] * sideScale),
      ));
      positions.push(...point);
      normals.push(...radial);
    }
  }

  for (let ring = 0; ring < rings - 1; ring += 1) {
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      const a = ring * sides + side;
      const b = ring * sides + next;
      const c = (ring + 1) * sides + side;
      const d = (ring + 1) * sides + next;
      indices.push(a, c, b, b, c, d);
    }
  }

  const startCenter = positions.length / 3;
  positions.push(...start);
  normals.push(...scale(axis, -1));
  const endCenter = positions.length / 3;
  positions.push(...end);
  normals.push(...axis);
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides;
    indices.push(startCenter, next, side);
    const a = (rings - 1) * sides + side;
    const b = (rings - 1) * sides + next;
    indices.push(endCenter, a, b);
  }

  return { positions, normals, indices };
}

function makeGeometry({ sides, rings }) {
  const body = { positions: [], normals: [], indices: [] };
  const brace = { positions: [], normals: [], indices: [] };

  [
    { start: [-0.58, 0.02, -0.26], end: [-0.14, 0.86, 0.02], radius: [0.082, 0.108], seed: 2, twist: 0.38 },
    { start: [0.60, 0.02, 0.20], end: [0.13, 0.84, 0.00], radius: [0.092, 0.101], seed: 7, twist: -0.31 },
    { start: [-0.45, 0.06, 0.34], end: [0.18, 0.78, 0.06], radius: [0.064, 0.082], seed: 11, twist: 0.24 },
    { start: [-0.25, 0.88, 0.04], end: [0.29, 0.83, -0.02], radius: [0.074, 0.095], seed: 17, twist: 0.18, taper: [0.98, 0.94] },
    { start: [-0.72, -0.01, -0.28], end: [-0.40, 0.03, -0.20], radius: [0.05, 0.075], seed: 23, twist: -0.14, taper: [1.15, 0.9] },
    { start: [0.42, -0.01, 0.18], end: [0.76, 0.03, 0.24], radius: [0.05, 0.075], seed: 29, twist: 0.16, taper: [0.9, 1.12] },
  ].forEach(beam => pushMesh(body, makeBeam({ sides, rings, ...beam })));

  [
    { start: [-0.59, 0.36, 0.29], end: [0.58, 0.48, 0.30], radius: [0.055, 0.076], seed: 31, twist: 0.42, taper: [1.05, 0.98] },
    { start: [-0.13, 0.39, 0.28], end: [0.12, 0.45, 0.31], radius: [0.068, 0.089], seed: 37, twist: -0.22, taper: [0.9, 1.08] },
  ].forEach(beam => pushMesh(brace, makeBeam({ sides, rings, ...beam })));

  return { body, brace };
}

function boundsFor(meshes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], mesh.positions[i + axis]);
        max[axis] = Math.max(max[axis], mesh.positions[i + axis]);
      }
    }
  }
  return { min: min.map(v => Number(v.toFixed(6))), max: max.map(v => Number(v.toFixed(6))) };
}

function arrayBufferFromTyped(values, Type) {
  const typed = new Type(values);
  return Buffer.from(typed.buffer);
}

function minMaxVec3(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  return { min, max };
}

function componentStats(meshes) {
  return {
    vertexCount: meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0),
    triangleCount: meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0),
  };
}

function buildGlb({ body, brace, materialPrefix }) {
  const chunks = [];
  const bufferViews = [];
  const accessors = [];

  function addAccessor(values, Type, componentType, type, target, minMax = null) {
    const raw = arrayBufferFromTyped(values, Type);
    const offset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const paddedLength = align4(raw.length);
    const padded = Buffer.alloc(paddedLength);
    raw.copy(padded);
    chunks.push(padded);
    const bufferView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: raw.length, target });
    const accessor = {
      bufferView,
      componentType,
      count: type === 'SCALAR' ? values.length : values.length / 3,
      type,
    };
    if (minMax) {
      accessor.min = minMax.min.map(v => Number(v.toFixed(6)));
      accessor.max = minMax.max.map(v => Number(v.toFixed(6)));
    }
    accessors.push(accessor);
    return accessors.length - 1;
  }

  function primitiveFor(mesh) {
    const posAccessor = addAccessor(mesh.positions, Float32Array, 5126, 'VEC3', 34962, minMaxVec3(mesh.positions));
    const normalAccessor = addAccessor(mesh.normals, Float32Array, 5126, 'VEC3', 34962);
    const indexAccessor = addAccessor(mesh.indices, Uint32Array, 5125, 'SCALAR', 34963);
    return { attributes: { POSITION: posAccessor, NORMAL: normalAccessor }, indices: indexAccessor, mode: 4 };
  }

  const bodyPrimitive = primitiveFor(body);
  const bracePrimitive = primitiveFor(brace);
  bodyPrimitive.material = 0;
  bracePrimitive.material = 1;

  const bin = Buffer.concat(chunks);
  const json = {
    asset: {
      version: '2.0',
      generator: 'Kaminos Handy Candyman deterministic forked timber trestle generator',
      copyright: 'Generated asset for Kaminos internal witness use',
    },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2] }],
    nodes: [
      { name: 'reliquary_trestle_body', mesh: 0 },
      { name: 'sacrificial_crossbrace', mesh: 1 },
      { name: 'support_loss_tenon_0', translation: [0, 0.43, 0.30] },
    ],
    meshes: [
      { name: 'reliquary_trestle_body_mesh', primitives: [bodyPrimitive] },
      { name: 'sacrificial_crossbrace_mesh', primitives: [bracePrimitive] },
    ],
    materials: [
      {
        name: `${materialPrefix}_weathered_dark_timber`,
        pbrMetallicRoughness: {
          baseColorFactor: [0.43, 0.31, 0.18, 1],
          metallicFactor: 0,
          roughnessFactor: 0.86,
        },
      },
      {
        name: `${materialPrefix}_sacrificial_crossbrace_raw_edge`,
        pbrMetallicRoughness: {
          baseColorFactor: [0.64, 0.47, 0.27, 1],
          metallicFactor: 0,
          roughnessFactor: 0.82,
        },
      },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    accessors,
  };

  const jsonBuffer = Buffer.from(JSON.stringify(json));
  const jsonPadded = Buffer.alloc(align4(jsonBuffer.length), 0x20);
  jsonBuffer.copy(jsonPadded);
  const binPadded = Buffer.alloc(align4(bin.length));
  bin.copy(binPadded);
  const totalLength = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 4, 'utf8');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.write('JSON', 4, 4, 'utf8');
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.write('BIN\0', 4, 4, 'utf8');
  return { buffer: Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]), json, stats: componentStats([body, brace]) };
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

mkdirSync(dirname(visualPath), { recursive: true });
mkdirSync(dirname(bindingPath), { recursive: true });

const visualGeometry = makeGeometry({ sides: 9, rings: 6 });
const bindingGeometry = makeGeometry({ sides: 7, rings: 5 });
const visual = buildGlb({ ...visualGeometry, materialPrefix: 'visual' });
const binding = buildGlb({ ...bindingGeometry, materialPrefix: 'binding' });
writeFileSync(visualPath, visual.buffer);
writeFileSync(bindingPath, binding.buffer);

const visualRel = 'visual/forked-timber-reliquary-trestle-v0.glb';
const bindingRel = 'binding/forked-timber-reliquary-trestle-v0-binding.glb';
const descriptor = {
  schema: 'kaminos.structural-mesh-asset-descriptor.v0',
  assetId,
  title: 'Forked Timber Reliquary Trestle V0',
  source: {
    kind: 'authored-generated-cast',
    promptBasin: 'asymmetric forked timber reliquary trestle with visibly detachable sacrificial crossbrace',
    sourceEnvelope: 'internal operator mesh-combustion asset consultation, 2026-07-18',
    strategyEnvelope: 'internal generation-strategy return, 2026-07-18',
    routeDecision: 'deterministic authored GLB chosen over opaque reconstruction so seam topology and named islands are inspectable',
  },
  coordinateFrame: {
    handedness: 'right',
    upAxis: '+Y',
    forwardAxis: '+Z',
    unit: 'meter',
    transformsBaked: true,
  },
  bounds: boundsFor([visualGeometry.body, visualGeometry.brace]),
  seam: {
    id: 'support_loss_tenon_0',
    nodeName: 'support_loss_tenon_0',
    translation: [0, 0.43, 0.30],
    contract: 'authored separation seam; runtime may release sacrificial_crossbrace without cutting triangles',
  },
  islands: [
    {
      id: 'reliquary_trestle_body',
      nodeName: 'reliquary_trestle_body',
      role: 'load-bearing forked trestle body',
      motion: 'carrier island',
      materialHint: 'weathered timber, accepts semantic wood-to-char response',
    },
    {
      id: 'sacrificial_crossbrace',
      nodeName: 'sacrificial_crossbrace',
      role: 'detachable support-loss crossbrace',
      motion: 'separable island at support_loss_tenon_0',
      materialHint: 'sacrificial timber, expected first failure carrier',
    },
  ],
  visualRef: {
    path: visualRel,
    nodeNames: ['reliquary_trestle_body', 'sacrificial_crossbrace', 'support_loss_tenon_0'],
    vertexCount: visual.stats.vertexCount,
    triangleCount: visual.stats.triangleCount,
  },
  bindingRef: {
    path: bindingRel,
    nodeNames: ['reliquary_trestle_body', 'sacrificial_crossbrace', 'support_loss_tenon_0'],
    vertexCount: binding.stats.vertexCount,
    triangleCount: binding.stats.triangleCount,
  },
  downgradeState: {
    collision: 'not-claimed',
    runtimeCutting: 'excluded',
    uvQuality: 'plain-material-only',
    photorealism: 'not-claimed',
  },
  files: {
    [visualRel]: {
      sha256: sha256(visual.buffer),
      bytes: visual.buffer.length,
    },
    [bindingRel]: {
      sha256: sha256(binding.buffer),
      bytes: binding.buffer.length,
    },
  },
};

writeJson(descriptorPath, descriptor);
console.log(JSON.stringify({
  assetId,
  outDir,
  visual: { path: visualPath, ...visual.stats, sha256: descriptor.files[visualRel].sha256 },
  binding: { path: bindingPath, ...binding.stats, sha256: descriptor.files[bindingRel].sha256 },
  descriptor: descriptorPath,
}, null, 2));
