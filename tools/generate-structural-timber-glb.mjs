import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RING = [
  [0.10, 0.04],
  [0.78, 0.02],
  [0.96, 0.18],
  [0.98, 0.76],
  [0.76, 0.96],
  [0.18, 0.98],
  [0.02, 0.74],
  [0.04, 0.20],
];

function crossSection(station, side) {
  return RING.map(([y, z], corner) => {
    const wave = Math.sin((station + 1) * 2.13 + corner * 1.71 + side * 0.83);
    const yBias = Math.cos((station + 1) * 1.37 + corner * 0.91) * 0.028;
    const zBias = wave * 0.024;
    return [Math.max(0.01, Math.min(0.99, y + yBias)), Math.max(0.01, Math.min(0.99, z + zBias))];
  });
}

function makePart(xStations, side) {
  const positions = [];
  const indices = [];
  const ringCount = RING.length;
  for (let station = 0; station < xStations.length; station += 1) {
    for (const [y, z] of crossSection(station + side * 3, side)) {
      positions.push(xStations[station], y, z);
    }
  }
  for (let station = 0; station < xStations.length - 1; station += 1) {
    const current = station * ringCount;
    const next = (station + 1) * ringCount;
    for (let corner = 0; corner < ringCount; corner += 1) {
      const following = (corner + 1) % ringCount;
      indices.push(
        current + corner, next + following, next + corner,
        current + corner, current + following, next + following,
      );
    }
  }
  const addCap = (station, positive) => {
    const section = crossSection(station + side * 3, side);
    const ringStart = positions.length / 3;
    for (const [y, z] of section) positions.push(xStations[station], y, z);
    const center = positions.length / 3;
    const average = section.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0])
      .map(value => value / section.length);
    positions.push(xStations[station], average[0], average[1]);
    for (let corner = 0; corner < ringCount; corner += 1) {
      const following = (corner + 1) % ringCount;
      if (positive) indices.push(center, ringStart + corner, ringStart + following);
      else indices.push(center, ringStart + following, ringStart + corner);
    }
  };
  addCap(0, false);
  addCap(xStations.length - 1, true);
  const normals = new Float32Array(positions.length);
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = indices[triangle] * 3;
    const b = indices[triangle + 1] * 3;
    const c = indices[triangle + 2] * 3;
    const ab = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const ac = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const normal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    for (const vertex of [a, b, c]) {
      normals[vertex] += normal[0];
      normals[vertex + 1] += normal[1];
      normals[vertex + 2] += normal[2];
    }
  }
  for (let vertex = 0; vertex < normals.length; vertex += 3) {
    const length = Math.hypot(normals[vertex], normals[vertex + 1], normals[vertex + 2]);
    normals[vertex] /= length;
    normals[vertex + 1] /= length;
    normals[vertex + 2] /= length;
  }
  return {
    positions: new Float32Array(positions),
    normals,
    indices: new Uint16Array(indices),
  };
}

function padded(bytes, fill = 0) {
  const padding = (4 - (bytes.byteLength % 4)) % 4;
  if (padding === 0) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Buffer.concat([Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), Buffer.alloc(padding, fill)]);
}

const parts = [
  { id: 'root', motionAnchor: [0, 0.5, 0.5], bounds: [[0, 0, 0], [0.5, 1, 1]], geometry: makePart([0, 0.24, 0.5], 0) },
  { id: 'free', motionAnchor: [1, 0.5, 0.5], bounds: [[0.5, 0, 0], [1, 1, 1]], geometry: makePart([0.5, 0.76, 1], 1) },
];
const binaryChunks = [];
const bufferViews = [];
const accessors = [];
let byteOffset = 0;
function addAccessor(array, target, componentType, type, minimum, maximum) {
  const chunk = padded(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  const viewIndex = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset, byteLength: array.byteLength, target });
  binaryChunks.push(chunk);
  byteOffset += chunk.byteLength;
  const accessorIndex = accessors.length;
  const components = type === 'VEC3' ? 3 : 1;
  const accessor = { bufferView: viewIndex, componentType, count: array.length / components, type };
  if (minimum) accessor.min = minimum;
  if (maximum) accessor.max = maximum;
  accessors.push(accessor);
  return accessorIndex;
}
const meshes = parts.map(({ geometry }) => {
  const position = addAccessor(geometry.positions, 34962, 5126, 'VEC3', [0, 0, 0], [1, 1, 1]);
  const normal = addAccessor(geometry.normals, 34962, 5126, 'VEC3');
  const indices = addAccessor(geometry.indices, 34963, 5123, 'SCALAR');
  return { primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices, mode: 4 }] };
});
const binary = Buffer.concat(binaryChunks);
const gltf = {
  asset: { version: '2.0', generator: 'Kaminos structural timber generator v0' },
  scene: 0,
  scenes: [{ nodes: [0, 1] }],
  nodes: parts.map((part, index) => ({
    name: `structural-${part.id}`,
    mesh: index,
    extras: {
      structuralIsland: part.id,
      motionAnchor: part.motionAnchor,
      nodeBounds: { min: part.bounds[0], max: part.bounds[1] },
    },
  })),
  meshes,
  accessors,
  bufferViews,
  buffers: [{ byteLength: binary.byteLength }],
};
const json = padded(Buffer.from(JSON.stringify(gltf)), 0x20);
const totalLength = 12 + 8 + json.byteLength + 8 + binary.byteLength;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(json.byteLength, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(binary.byteLength, 0);
binaryHeader.writeUInt32LE(0x004e4942, 4);

const defaultOutput = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/structural-combustion/irregular-timber-two-island.glb');
const output = resolve(process.argv[2] || defaultOutput);
const manifestOutput = resolve(process.argv[3] || output.replace(/\.glb$/i, '.manifest.json'));
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const glb = Buffer.concat([header, jsonHeader, json, binaryHeader, binary]);
const assetIdentity = `sha256:${createHash('sha256').update(glb).digest('hex')}`;
const manifest = {
  schema: 'kaminos.structural-mesh-asset-manifest.v0',
  assetPath: relative(repositoryRoot, output).split('\\').join('/'),
  assetIdentity,
  byteLength: glb.byteLength,
  vertexCount: parts.reduce((sum, part) => sum + part.geometry.positions.length / 3, 0),
  triangleCount: parts.reduce((sum, part) => sum + part.geometry.indices.length / 3, 0),
  islandIds: parts.map(part => part.id).sort(),
};
mkdirSync(dirname(output), { recursive: true });
mkdirSync(dirname(manifestOutput), { recursive: true });
writeFileSync(output, glb);
writeFileSync(manifestOutput, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, manifestOutput, ...manifest }));
