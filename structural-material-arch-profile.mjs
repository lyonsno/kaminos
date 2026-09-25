import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { rasterizeArchTriangles, rasterizeArchTriangleDepthEnvelope } from './structural-material-arch-core.js';

export function readArchGlbTriangles(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 28 || bytes.toString('ascii', 0, 4) !== 'glTF' ||
      bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error('invalid GLB v2 container');
  }
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength + 8 > bytes.length) {
    throw new Error('invalid GLB JSON chunk');
  }
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binaryHeader = 20 + jsonLength;
  const binaryLength = bytes.readUInt32LE(binaryHeader);
  const binaryStart = binaryHeader + 8;
  if (bytes.readUInt32LE(binaryHeader + 4) !== 0x004e4942 || binaryStart + binaryLength > bytes.length) {
    throw new Error('invalid GLB binary chunk');
  }
  if (gltf.nodes?.some(node => node.matrix || node.translation || node.rotation || node.scale)) {
    throw new Error('arch GLB extraction does not admit node transforms');
  }
  const primitives = gltf.meshes?.flatMap(mesh => mesh.primitives || []) || [];
  if (primitives.length !== 1 || primitives[0].mode !== 4) {
    throw new Error('arch GLB extraction requires one triangle primitive');
  }
  const primitive = primitives[0];
  const indices = gltf.accessors?.[primitive.indices];
  const positions = gltf.accessors?.[primitive.attributes?.POSITION];
  if (!indices || !positions || indices.type !== 'SCALAR' || ![5123, 5125].includes(indices.componentType) ||
      positions.type !== 'VEC3' || positions.componentType !== 5126 || indices.count % 3 !== 0 ||
      indices.sparse || positions.sparse) {
    throw new Error('unsupported arch GLB position/index accessors');
  }
  const viewOf = (accessor, stride) => {
    const view = gltf.bufferViews?.[accessor.bufferView];
    if (!view || view.buffer !== 0 || (view.byteStride && view.byteStride !== stride)) {
      throw new Error('unsupported arch GLB buffer view');
    }
    const offset = binaryStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    if (offset < binaryStart || offset + accessor.count * stride > binaryStart + binaryLength ||
        offset + accessor.count * stride > binaryStart + (view.byteOffset || 0) + view.byteLength) {
      throw new Error('arch GLB accessor exceeds binary bounds');
    }
    return offset;
  };
  const indexSize = indices.componentType === 5125 ? 4 : 2;
  const indicesStart = viewOf(indices, indexSize);
  const positionsStart = viewOf(positions, 12);
  const readIndex = index => indices.componentType === 5125
    ? bytes.readUInt32LE(indicesStart + index * 4)
    : bytes.readUInt16LE(indicesStart + index * 2);
  const vertices = [];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < positions.count; index += 1) {
    const x = bytes.readFloatLE(positionsStart + index * 12);
    const y = bytes.readFloatLE(positionsStart + index * 12 + 4);
    const z = bytes.readFloatLE(positionsStart + index * 12 + 8);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error('arch GLB position is not finite');
    vertices.push([x, y, z]);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const triangles = [];
  const edgeIncidence = new Map();
  const countEdge = (a, b) => {
    const id = a < b ? `${a}:${b}` : `${b}:${a}`;
    edgeIncidence.set(id, (edgeIncidence.get(id) || 0) + 1);
  };
  for (let index = 0; index < indices.count; index += 3) {
    const a = readIndex(index);
    const b = readIndex(index + 1);
    const c = readIndex(index + 2);
    if (a >= vertices.length || b >= vertices.length || c >= vertices.length) {
      throw new Error('arch GLB index exceeds position count');
    }
    countEdge(a, b);
    countEdge(b, c);
    countEdge(c, a);
    triangles.push([vertices[a], vertices[b], vertices[c]]);
  }
  const incidences = [...edgeIncidence.values()];
  const boundaryEdges = incidences.filter(count => count === 1).length;
  const nonManifoldEdges = incidences.filter(count => count > 2).length;
  return {
    triangles,
    bounds: { min: [minX, minY], max: [maxX, maxY] },
    bounds3d: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    meshTopology: {
      uniqueEdges: edgeIncidence.size,
      boundaryEdges,
      manifoldInteriorEdges: incidences.filter(count => count === 2).length,
      nonManifoldEdges,
      edgeIncidenceClosed: boundaryEdges === 0 && nonManifoldEdges === 0,
    },
  };
}

export function buildArchProfileFromGlb(path, columns = 48, rows = 36, sharedBounds = null) {
  const bytes = readFileSync(path);
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const { triangles, bounds, bounds3d, meshTopology } = readArchGlbTriangles(bytes);
  const rasterBounds = sharedBounds || bounds;
  return {
    ...rasterizeArchTriangles(triangles, rasterBounds, columns, rows),
    depthEnvelope: rasterizeArchTriangleDepthEnvelope(triangles, rasterBounds, columns, rows),
    depthBounds: bounds3d,
    depthSource: { kind: 'triangle-barycentric-z-envelope-v0' },
    meshTopology,
    source: { kind: 'trellis-glb', sha256: sourceSha256 },
    extraction: 'triangle-xy-occupancy-and-barycentric-z-envelope-cell-centers-v1',
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [input, output, ...limits] = process.argv.slice(2);
  if (!input || !output) throw new Error('usage: node structural-material-arch-profile.mjs input.glb output.json');
  const sharedBounds = limits.length === 4 ? {
    min: [Number(limits[0]), Number(limits[1])],
    max: [Number(limits[2]), Number(limits[3])],
  } : null;
  if (limits.length && limits.length !== 4) throw new Error('provide either zero or four shared bound values');
  writeFileSync(output, `${JSON.stringify(buildArchProfileFromGlb(input, 48, 36, sharedBounds), null, 2)}\n`);
}
