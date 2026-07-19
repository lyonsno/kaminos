#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const artifactRoot = join(root, 'artifacts/structural-bell-citadel-v0-2026-07-18');
const visualRel = 'visual/citadel-bell-v0.glb';
const proxyRel = 'proxy/citadel-bell-v0-proxy.glb';
const descriptorRel = 'structuralAssetDescriptor.json';
const visualPath = join(artifactRoot, visualRel);
const proxyPath = join(artifactRoot, proxyRel);
const descriptorPath = join(artifactRoot, descriptorRel);

function addVec(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function triangleNormal(a, b, c) {
  return normalize(cross(subVec(b, a), subVec(c, a)));
}

function createBuilder() {
  return {
    positions: [],
    normals: [],
    colors: [],
    indicesByMaterial: new Map(),
  };
}

function pushVertex(builder, position, normal, color) {
  const index = builder.positions.length / 3;
  builder.positions.push(...position);
  builder.normals.push(...normal);
  builder.colors.push(...color);
  return index;
}

function pushTriangle(builder, material, a, b, c, color) {
  const normal = triangleNormal(a, b, c);
  const ia = pushVertex(builder, a, normal, color);
  const ib = pushVertex(builder, b, normal, color);
  const ic = pushVertex(builder, c, normal, color);
  if (!builder.indicesByMaterial.has(material)) builder.indicesByMaterial.set(material, []);
  builder.indicesByMaterial.get(material).push(ia, ib, ic);
}

function addQuad(builder, material, a, b, c, d, color) {
  pushTriangle(builder, material, a, b, c, color);
  pushTriangle(builder, material, a, c, d, color);
}

function addLathe(builder, material, profile, segments, color) {
  const rings = profile.map(([y, radius]) => {
    const ring = [];
    for (let i = 0; i < segments; i += 1) {
      const theta = (i / segments) * Math.PI * 2;
      ring.push([Math.cos(theta) * radius, y, Math.sin(theta) * radius]);
    }
    return ring;
  });
  for (let j = 0; j < rings.length - 1; j += 1) {
    for (let i = 0; i < segments; i += 1) {
      const next = (i + 1) % segments;
      addQuad(builder, material, rings[j][i], rings[j + 1][i], rings[j + 1][next], rings[j][next], color);
    }
  }
}

function addBox(builder, material, center, size, color) {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size.map(v => v / 2);
  const p = [
    [cx - sx, cy - sy, cz - sz], [cx + sx, cy - sy, cz - sz],
    [cx + sx, cy + sy, cz - sz], [cx - sx, cy + sy, cz - sz],
    [cx - sx, cy - sy, cz + sz], [cx + sx, cy - sy, cz + sz],
    [cx + sx, cy + sy, cz + sz], [cx - sx, cy + sy, cz + sz],
  ];
  addQuad(builder, material, p[0], p[1], p[2], p[3], color);
  addQuad(builder, material, p[5], p[4], p[7], p[6], color);
  addQuad(builder, material, p[4], p[0], p[3], p[7], color);
  addQuad(builder, material, p[1], p[5], p[6], p[2], color);
  addQuad(builder, material, p[3], p[2], p[6], p[7], color);
  addQuad(builder, material, p[4], p[5], p[1], p[0], color);
}

function addCylinder(builder, material, center, radius, height, segments, color, axis = 'y') {
  const [cx, cy, cz] = center;
  const top = [];
  const bottom = [];
  for (let i = 0; i < segments; i += 1) {
    const theta = (i / segments) * Math.PI * 2;
    const a = Math.cos(theta) * radius;
    const b = Math.sin(theta) * radius;
    if (axis === 'x') {
      top.push([cx + height / 2, cy + a, cz + b]);
      bottom.push([cx - height / 2, cy + a, cz + b]);
    } else {
      top.push([cx + a, cy + height / 2, cz + b]);
      bottom.push([cx + a, cy - height / 2, cz + b]);
    }
  }
  const topCenter = axis === 'x' ? [cx + height / 2, cy, cz] : [cx, cy + height / 2, cz];
  const bottomCenter = axis === 'x' ? [cx - height / 2, cy, cz] : [cx, cy - height / 2, cz];
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments;
    addQuad(builder, material, bottom[i], top[i], top[next], bottom[next], color);
    pushTriangle(builder, material, topCenter, top[i], top[next], color);
    pushTriangle(builder, material, bottomCenter, bottom[next], bottom[i], color);
  }
}

function addTorusYZ(builder, material, center, majorRadius, tubeRadius, majorSegments, tubeSegments, color) {
  const [cx, cy, cz] = center;
  const grid = [];
  for (let i = 0; i < majorSegments; i += 1) {
    const phi = (i / majorSegments) * Math.PI * 2;
    const ring = [];
    const ringCenter = [cx, cy + Math.sin(phi) * majorRadius, cz + Math.cos(phi) * majorRadius];
    for (let j = 0; j < tubeSegments; j += 1) {
      const theta = (j / tubeSegments) * Math.PI * 2;
      ring.push([
        ringCenter[0] + Math.cos(theta) * tubeRadius,
        ringCenter[1] + Math.sin(theta) * Math.sin(phi) * tubeRadius,
        ringCenter[2] + Math.sin(theta) * Math.cos(phi) * tubeRadius,
      ]);
    }
    grid.push(ring);
  }
  for (let i = 0; i < majorSegments; i += 1) {
    const ni = (i + 1) % majorSegments;
    for (let j = 0; j < tubeSegments; j += 1) {
      const nj = (j + 1) % tubeSegments;
      addQuad(builder, material, grid[i][j], grid[ni][j], grid[ni][nj], grid[i][nj], color);
    }
  }
}

function addPatinaFlecks(builder) {
  const color = [0.18, 0.48, 0.42, 1.0];
  const flecks = [
    [-0.22, -0.58, 0.31, 0.07],
    [0.27, -0.72, -0.24, 0.055],
    [-0.08, -0.93, -0.43, 0.06],
    [0.35, -0.38, 0.10, 0.045],
    [-0.38, -1.08, 0.12, 0.05],
  ];
  for (const [x, y, z, s] of flecks) {
    addBox(builder, 'patina', [x, y, z], [s, s * 0.7, 0.012], color);
  }
}

function buildVisualGeometry() {
  const builder = createBuilder();
  const bronze = [0.56, 0.36, 0.16, 1.0];
  const darkBronze = [0.22, 0.13, 0.07, 1.0];
  const iron = [0.08, 0.07, 0.06, 1.0];
  addLathe(builder, 'bronze', [
    [-0.08, 0.12],
    [-0.14, 0.22],
    [-0.24, 0.28],
    [-0.48, 0.36],
    [-0.78, 0.46],
    [-1.05, 0.55],
    [-1.23, 0.66],
    [-1.31, 0.69],
  ], 56, bronze);
  addLathe(builder, 'darkBronze', [
    [-1.22, 0.60],
    [-1.25, 0.69],
    [-1.31, 0.72],
    [-1.36, 0.63],
  ], 56, darkBronze);
  addCylinder(builder, 'bronze', [0, -0.13, 0], 0.19, 0.10, 40, bronze);
  addBox(builder, 'bronze', [-0.12, -0.05, 0], [0.08, 0.16, 0.16], bronze);
  addBox(builder, 'bronze', [0.12, -0.05, 0], [0.08, 0.16, 0.16], bronze);
  addCylinder(builder, 'bronze', [0, -0.03, 0], 0.045, 0.36, 24, bronze, 'x');
  addTorusYZ(builder, 'bronze', [0, -0.13, 0], 0.15, 0.025, 28, 10, bronze);
  addCylinder(builder, 'iron', [0, -0.72, 0], 0.035, 0.74, 18, iron);
  addCylinder(builder, 'iron', [0, -1.12, 0], 0.12, 0.16, 22, iron);
  addPatinaFlecks(builder);
  return builder;
}

function buildProxyGeometry() {
  const builder = createBuilder();
  const color = [0.82, 0.61, 0.24, 1.0];
  addLathe(builder, 'proxy', [
    [-0.02, 0.18],
    [-0.18, 0.28],
    [-0.95, 0.56],
    [-1.34, 0.72],
  ], 12, color);
  addBox(builder, 'proxy', [0, -0.06, 0], [0.34, 0.18, 0.22], color);
  return builder;
}

function align4(value) {
  return (value + 3) & ~3;
}

function pushBuffer(chunks, typedArray, target) {
  const byteOffset = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const raw = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  const padded = Buffer.alloc(align4(raw.length));
  raw.copy(padded);
  chunks.push(padded);
  return { buffer: 0, byteOffset, byteLength: raw.length, target };
}

function minMax(values, stride) {
  const min = Array(stride).fill(Infinity);
  const max = Array(stride).fill(-Infinity);
  for (let i = 0; i < values.length; i += stride) {
    for (let j = 0; j < stride; j += 1) {
      min[j] = Math.min(min[j], values[i + j]);
      max[j] = Math.max(max[j], values[i + j]);
    }
  }
  return { min, max };
}

function materialDefs(kind) {
  if (kind === 'proxy') {
    return [{
      name: 'proxy-warm-mask-v0',
      pbrMetallicRoughness: { baseColorFactor: [0.82, 0.61, 0.24, 1], metallicFactor: 0.0, roughnessFactor: 0.9 },
    }];
  }
  return [
    { name: 'weathered-cast-bronze-v0', pbrMetallicRoughness: { baseColorFactor: [0.56, 0.36, 0.16, 1], metallicFactor: 0.85, roughnessFactor: 0.62 } },
    { name: 'dark-aged-bronze-rim-v0', pbrMetallicRoughness: { baseColorFactor: [0.22, 0.13, 0.07, 1], metallicFactor: 0.7, roughnessFactor: 0.78 } },
    { name: 'oxidized-patina-fleck-v0', pbrMetallicRoughness: { baseColorFactor: [0.18, 0.48, 0.42, 1], metallicFactor: 0.2, roughnessFactor: 0.95 } },
    { name: 'dark-clapper-iron-v0', pbrMetallicRoughness: { baseColorFactor: [0.08, 0.07, 0.06, 1], metallicFactor: 0.6, roughnessFactor: 0.8 } },
  ];
}

function buildGlb(builder, { kind, meshName, nodeName }) {
  const chunks = [];
  const positions = new Float32Array(builder.positions);
  const normals = new Float32Array(builder.normals);
  const colors = new Float32Array(builder.colors);
  const positionView = pushBuffer(chunks, positions, 34962);
  const normalView = pushBuffer(chunks, normals, 34962);
  const colorView = pushBuffer(chunks, colors, 34962);
  const bufferViews = [positionView, normalView, colorView];
  const accessors = [];
  const bounds = minMax(builder.positions, 3);
  accessors.push({ bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: bounds.min, max: bounds.max });
  accessors.push({ bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' });
  accessors.push({ bufferView: 2, componentType: 5126, count: colors.length / 4, type: 'VEC4' });

  const materials = materialDefs(kind);
  const materialIndex = new Map(materials.map((material, index) => [material.name, index]));
  const materialNameByKey = {
    bronze: 'weathered-cast-bronze-v0',
    darkBronze: 'dark-aged-bronze-rim-v0',
    patina: 'oxidized-patina-fleck-v0',
    iron: 'dark-clapper-iron-v0',
    proxy: 'proxy-warm-mask-v0',
  };
  const primitives = [];
  for (const [key, values] of builder.indicesByMaterial.entries()) {
    const indices = positions.length / 3 > 65535 ? new Uint32Array(values) : new Uint16Array(values);
    const bufferView = pushBuffer(chunks, indices, 34963);
    bufferViews.push(bufferView);
    const accessorIndex = accessors.length;
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: indices instanceof Uint32Array ? 5125 : 5123,
      count: indices.length,
      type: 'SCALAR',
    });
    primitives.push({
      attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
      indices: accessorIndex,
      material: materialIndex.get(materialNameByKey[key]),
      mode: 4,
    });
  }

  const bin = Buffer.concat(chunks);
  const gltf = {
    asset: { version: '2.0', generator: 'kaminos Handy Candyman citadel-bell-v0 deterministic builder' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'bell-crown-v0', translation: [0, 0, 0], rotation: [0, 0, 0, 1], children: [1] },
      { name: nodeName, mesh: 0 },
    ],
    meshes: [{ name: meshName, primitives }],
    materials,
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    accessors,
  };
  if (kind === 'proxy') {
    gltf.nodes = [{ name: nodeName, mesh: 0 }];
    gltf.scenes = [{ nodes: [0] }];
  }
  const jsonRaw = Buffer.from(JSON.stringify(gltf));
  const json = Buffer.alloc(align4(jsonRaw.length), 0x20);
  jsonRaw.copy(json);
  const totalLength = 12 + 8 + json.length + 8 + bin.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.write('JSON', 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.write('BIN\0', 4);
  return {
    glb: Buffer.concat([header, jsonHeader, json, binHeader, bin]),
    gltf,
    bounds,
    triangleCount: [...builder.indicesByMaterial.values()].reduce((sum, values) => sum + values.length / 3, 0),
  };
}

function boundingSphere(bounds) {
  const center = bounds.min.map((value, index) => (value + bounds.max[index]) / 2);
  let radius = 0;
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        radius = Math.max(radius, Math.hypot(x - center[0], y - center[1], z - center[2]));
      }
    }
  }
  return { center, radius };
}

function write(path, bufferOrText) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bufferOrText);
}

const visual = buildGlb(buildVisualGeometry(), { kind: 'visual', meshName: 'BellVisualMesh', nodeName: 'BellVisual' });
const proxy = buildGlb(buildProxyGeometry(), { kind: 'proxy', meshName: 'BellProxyMesh', nodeName: 'BellProxy' });
write(visualPath, visual.glb);
write(proxyPath, proxy.glb);

const descriptor = {
  schema: 'kaminos.structural-material.asset-descriptor.v0',
  assetId: 'citadel-bell-v0',
  visualRef: visualRel,
  proxyRef: proxyRel,
  assetRole: 'bell-body',
  instancePolicy: 'single-authored-asset',
  coordinateFrame: { handedness: 'right', up: '+Y', forward: '+Z', unit: 'meter' },
  pivot: { kind: 'attachment-socket', socketId: 'bell-crown-v0', translation: [0, 0, 0] },
  localBounds: visual.bounds,
  proxyBounds: proxy.bounds,
  boundingSphere: boundingSphere(visual.bounds),
  materialProfile: 'weathered-cast-bronze-v0',
  materialSlots: visual.gltf.materials.map(material => material.name),
  triangleCount: { visual: visual.triangleCount, proxy: proxy.triangleCount },
  nodeNames: { visual: 'BellVisual', proxy: 'BellProxy', socket: 'bell-crown-v0' },
  authoredScale: 1,
  transformsBaked: true,
  structuralAuthority: false,
  collisionStatus: 'proxy-unverified',
  routeIdentity: {
    requestedRoute: 'deterministic-procedural-glb',
    effectiveRoute: 'deterministic-procedural-glb',
    backend: 'node-manual-gltf-writer',
    model: null,
    config: {
      visualSegments: 56,
      proxySegments: 12,
      pivot: 'crown-origin',
      bodyAxis: '-Y',
    },
  },
  claimBoundary: [
    'visual/orbitability candidate',
    'proxy is named and bounded for picking/collision experiments only',
    'not structural graph authority',
    'not production collision quality',
    'not a whole castle or fused tower asset',
  ],
};

write(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
console.log(JSON.stringify({
  artifactRoot,
  visual: visualRel,
  proxy: proxyRel,
  descriptor: descriptorRel,
  visualTriangles: visual.triangleCount,
  proxyTriangles: proxy.triangleCount,
  bounds: visual.bounds,
}, null, 2));
