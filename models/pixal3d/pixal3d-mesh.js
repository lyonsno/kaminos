import {
  extractTrellisDualGridMesh,
  createTrellisMeshAdapter,
  compareTrellisMeshes,
} from '../trellis2/trellis-mesh.js';

export {
  extractTrellisDualGridMesh,
  createTrellisMeshAdapter,
  compareTrellisMeshes,
  extractTrellisDualGridMesh as extractPixal3dDualGridMesh,
  createTrellisMeshAdapter as createPixal3dMeshAdapter,
  compareTrellisMeshes as comparePixal3dMeshes,
};

// Upstream Pixal3D grid2mesh applies (x, y, z) -> (x, z, -y), and upstream
// to_glb applies Z-up -> Y-up [[1,0,0],[0,0,-1],[0,1,0]] followed by a 180°
// Y-axis rotation [[-1,0,0],[0,1,0],[0,0,-1]]. The composite map on raw
// dual-grid coordinates (x, y, z) is (-x, y, -z) (det = +1).
export const PIXAL3D_GLB_NODE_MATRIX = Object.freeze([
  -1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -1, 0,
  0, 0, 0, 1,
]);

export function toPixal3dGlbFrame(vertices) {
  if (!(vertices instanceof Float32Array) || vertices.length === 0 || vertices.length % 3 !== 0) {
    throw new TypeError('vertices must be a non-empty Float32Array with length a multiple of 3');
  }
  const out = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    out[i] = x === 0 ? 0 : -x;
    out[i + 1] = y === 0 ? 0 : y;
    out[i + 2] = z === 0 ? 0 : -z;
  }
  return out;
}

export function encodePixal3dGeometryGLB(mesh, { provenance = {} } = {}) {
  const { vertices, triangles } = mesh ?? {};
  const n = vertices?.length / 3;
  if (
    !(vertices instanceof Float32Array) ||
    !(triangles instanceof Uint32Array) ||
    !n ||
    vertices.length % 3 ||
    !triangles.length ||
    triangles.length % 3
  ) {
    throw new Error('nonempty triangle surface required for geometry GLB');
  }
  if (!vertices.every(Number.isFinite) || !triangles.every(i => i < n)) {
    throw new Error('invalid surface coordinates or triangle indices');
  }
  const normals = new Float32Array(vertices.length);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i++) {
    min[i % 3] = Math.min(min[i % 3], vertices[i]);
    max[i % 3] = Math.max(max[i % 3], vertices[i]);
  }
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i] * 3, b = triangles[i + 1] * 3, c = triangles[i + 2] * 3;
    const u = [vertices[b] - vertices[a], vertices[b + 1] - vertices[a + 1], vertices[b + 2] - vertices[a + 2]];
    const v = [vertices[c] - vertices[a], vertices[c + 1] - vertices[a + 1], vertices[c + 2] - vertices[a + 2]];
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const base of [a, b, c]) {
      for (let axis = 0; axis < 3; axis++) normals[base + axis] += cross[axis];
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (length) {
      for (let axis = 0; axis < 3; axis++) normals[i + axis] /= length;
    } else {
      normals[i + 2] = 1;
    }
  }
  const views = [
    { buffer: 0, byteOffset: 0, byteLength: vertices.byteLength, target: 34962 },
    { buffer: 0, byteOffset: vertices.byteLength, byteLength: triangles.byteLength, target: 34963 },
    { buffer: 0, byteOffset: vertices.byteLength + triangles.byteLength, byteLength: normals.byteLength, target: 34962 },
  ];
  const binLength = vertices.byteLength + triangles.byteLength + normals.byteLength;
  const document = {
    asset: { version: '2.0', generator: 'Kaminos Pixal3D geometry consumer' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, matrix: [...PIXAL3D_GLB_NODE_MATRIX] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 2 }, indices: 1, material: 0, mode: 4 }] }],
    materials: [
      {
        name: 'Geometry diagnostic — no learned material',
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [0.65, 0.65, 0.65, 1], metallicFactor: 0, roughnessFactor: 1 },
      },
    ],
    buffers: [{ byteLength: binLength }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5125, count: triangles.length, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: n, type: 'VEC3' },
    ],
    extras: {
      pixal3d: {
        stage: 'learned-geometry-only',
        material: 'diagnostic neutral; not texture-decoder/PBR evidence',
        normals: 'area-weighted unit; +Z only for zero accumulated area',
        provenance,
        geometry: mesh.metadata,
      },
    },
  };
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.byteLength / 4) * 4;
  const buffer = new ArrayBuffer(12 + 8 + jsonLength + 8 + binLength);
  const header = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const binStart = 28 + jsonLength;
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, buffer.byteLength, true);
  header.setUint32(12, jsonLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonLength);
  bytes.set(json, 20);
  header.setUint32(20 + jsonLength, binLength, true);
  header.setUint32(24 + jsonLength, 0x004e4942, true);
  bytes.set(new Uint8Array(vertices.buffer, vertices.byteOffset, vertices.byteLength), binStart);
  bytes.set(new Uint8Array(triangles.buffer, triangles.byteOffset, triangles.byteLength), binStart + vertices.byteLength);
  bytes.set(new Uint8Array(normals.buffer), binStart + vertices.byteLength + triangles.byteLength);
  return buffer;
}
