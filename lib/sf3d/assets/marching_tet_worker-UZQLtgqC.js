const TRIANGLE_TABLE = [
  [-1, -1, -1, -1, -1, -1],
  [1, 0, 2, -1, -1, -1],
  [4, 0, 3, -1, -1, -1],
  [1, 4, 2, 1, 3, 4],
  [3, 1, 5, -1, -1, -1],
  [2, 3, 0, 2, 5, 3],
  [1, 4, 0, 1, 5, 4],
  [4, 2, 5, -1, -1, -1],
  [4, 5, 2, -1, -1, -1],
  [4, 1, 0, 4, 5, 1],
  [3, 2, 0, 3, 5, 2],
  [1, 3, 5, -1, -1, -1],
  [4, 1, 2, 4, 3, 1],
  [3, 0, 4, -1, -1, -1],
  [2, 0, 1, -1, -1, -1],
  [-1, -1, -1, -1, -1, -1]
];
const NUM_TRIANGLES_TABLE = [0, 1, 1, 2, 1, 2, 2, 1, 1, 2, 2, 1, 2, 1, 1, 0];
const BASE_TET_EDGES = [0, 1, 0, 2, 0, 3, 1, 2, 1, 3, 2, 3];
const SOURCE_PUBLIC_BASE_PATH = "./";
const SOURCE_PUBLIC_BASE_URL = resolveSourcePublicBaseUrl(
  SOURCE_PUBLIC_BASE_PATH,
  import.meta.url,
  false
);
const DEFAULT_TET_BASE_PATH = new URL("tets/", SOURCE_PUBLIC_BASE_URL).href;
function resolveSourcePublicBaseUrl(basePath, moduleUrl, development = false) {
  const value = String(basePath);
  if (!value || value.startsWith(".")) {
    return new URL(development ? "/" : "../", moduleUrl);
  }
  return new URL(value, moduleUrl);
}
async function fetchTetArrayBuffer(url, bytesPerElement) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Tet asset fetch failed for ${url}: HTTP ${response.status} ${response.statusText}`.trim());
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
    throw new Error(`Tet asset ${url} returned non-binary content type ${contentType}`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength % bytesPerElement !== 0) {
    throw new Error(
      `Tet asset ${url} byte length ${buffer.byteLength} must be a non-zero multiple of ${bytesPerElement}`
    );
  }
  return buffer;
}
async function loadTetData(basePath = DEFAULT_TET_BASE_PATH) {
  const normalizedBase = String(basePath).endsWith("/") ? String(basePath) : `${basePath}/`;
  const resolvedBase = new URL(normalizedBase, SOURCE_PUBLIC_BASE_URL);
  const gridUrl = new URL("_grid_vertices.bin", resolvedBase).href;
  const indicesUrl = new URL("indices.bin", resolvedBase).href;
  const [vertsBuf, indicesBuf] = await Promise.all([
    fetchTetArrayBuffer(gridUrl, Float32Array.BYTES_PER_ELEMENT),
    fetchTetArrayBuffer(indicesUrl, Int32Array.BYTES_PER_ELEMENT)
  ]);
  const gridVertices = new Float32Array(vertsBuf);
  const indices = new Int32Array(indicesBuf);
  if (gridVertices.length % 3 !== 0) {
    throw new Error(`Tet vertex asset ${gridUrl} has ${gridVertices.length} values; expected xyz triples`);
  }
  if (indices.length % 4 !== 0) {
    throw new Error(`Tet index asset ${indicesUrl} has ${indices.length} values; expected tetrahedra quads`);
  }
  return {
    gridVertices,
    numVertices: gridVertices.length / 3,
    indices,
    numTets: indices.length / 4
  };
}
function marchingTetrahedra(gridVertices, sdf, tetIndices, vertexOffsets = null, resolution = 160) {
  const N_v = gridVertices.length / 3;
  const N_t = tetIndices.length / 4;
  let positions;
  if (vertexOffsets) {
    const scale = 1.74 / resolution;
    positions = new Float32Array(N_v * 3);
    for (let i = 0; i < N_v * 3; i++) {
      positions[i] = gridVertices[i] + scale * Math.tanh(vertexOffsets[i]);
    }
  } else {
    positions = gridVertices;
  }
  const occ = new Uint8Array(N_v);
  for (let i = 0; i < N_v; i++) {
    occ[i] = sdf[i] > 0 ? 1 : 0;
  }
  const validTets = [];
  for (let t = 0; t < N_t; t++) {
    const base = t * 4;
    const sum = occ[tetIndices[base]] + occ[tetIndices[base + 1]] + occ[tetIndices[base + 2]] + occ[tetIndices[base + 3]];
    if (sum > 0 && sum < 4) {
      validTets.push(t);
    }
  }
  const edgeMap = /* @__PURE__ */ new Map();
  const edgeList = [];
  const tetEdgeIndices = new Int32Array(validTets.length * 6);
  for (let vi = 0; vi < validTets.length; vi++) {
    const t = validTets[vi];
    const tetBase = t * 4;
    for (let e = 0; e < 6; e++) {
      let v0 = tetIndices[tetBase + BASE_TET_EDGES[e * 2]];
      let v1 = tetIndices[tetBase + BASE_TET_EDGES[e * 2 + 1]];
      if (v0 > v1) {
        const tmp = v0;
        v0 = v1;
        v1 = tmp;
      }
      const key = `${v0},${v1}`;
      let edgeIdx;
      if (edgeMap.has(key)) {
        edgeIdx = edgeMap.get(key);
      } else {
        edgeIdx = edgeList.length;
        edgeMap.set(key, edgeIdx);
        edgeList.push([v0, v1]);
      }
      tetEdgeIndices[vi * 6 + e] = edgeIdx;
    }
  }
  const crossingEdges = [];
  const edgeToVertex = new Int32Array(edgeList.length).fill(-1);
  let vertexCount = 0;
  for (let i = 0; i < edgeList.length; i++) {
    const [v0, v1] = edgeList[i];
    if (occ[v0] !== occ[v1]) {
      edgeToVertex[i] = vertexCount++;
      crossingEdges.push(i);
    }
  }
  const vertices = new Float32Array(vertexCount * 3);
  for (const edgeIdx of crossingEdges) {
    const [v0, v1] = edgeList[edgeIdx];
    const s0 = sdf[v0];
    const s1 = sdf[v1];
    const denom = s0 - s1;
    const t = denom !== 0 ? s0 / denom : 0.5;
    const outIdx = edgeToVertex[edgeIdx] * 3;
    for (let d = 0; d < 3; d++) {
      vertices[outIdx + d] = positions[v0 * 3 + d] * (1 - t) + positions[v1 * 3 + d] * t;
    }
  }
  const faceList = [];
  for (let vi = 0; vi < validTets.length; vi++) {
    const t = validTets[vi];
    const tetBase = t * 4;
    let tetindex = 0;
    for (let j = 0; j < 4; j++) {
      if (occ[tetIndices[tetBase + j]]) {
        tetindex |= 1 << j;
      }
    }
    const numTri = NUM_TRIANGLES_TABLE[tetindex];
    const triRow = TRIANGLE_TABLE[tetindex];
    for (let tri = 0; tri < numTri; tri++) {
      const i0 = edgeToVertex[tetEdgeIndices[vi * 6 + triRow[tri * 3]]];
      const i1 = edgeToVertex[tetEdgeIndices[vi * 6 + triRow[tri * 3 + 1]]];
      const i2 = edgeToVertex[tetEdgeIndices[vi * 6 + triRow[tri * 3 + 2]]];
      if (i0 >= 0 && i1 >= 0 && i2 >= 0) {
        faceList.push(i0, i1, i2);
      }
    }
  }
  const faces = new Uint32Array(faceList);
  return {
    vertices,
    faces,
    numVertices: vertexCount,
    numFaces: faces.length / 3
  };
}
function scaleTensor(data, fromRange, toRange) {
  const [fromMin, fromMax] = fromRange;
  const [toMin, toMax] = toRange;
  const scale = (toRange[1] - toRange[0]) / (fromMax - fromMin);
  const offset = toRange[0] - fromMin * scale;
  const result = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] * scale + offset;
  }
  return result;
}

/**
 * marching_tet_worker.js — Web Worker running marching tetrahedra off the main
 * thread. The tet grid (535,882 vertices / 2.97M tets, ~47MB of indices) is
 * loaded ONCE by the worker at startup and stays resident, so a run only ships
 * the per-run SDF (2MB) and vertex offsets (6.4MB) in and the mesh out.
 *
 * Protocol (request/response by id, driven through worker_call.js):
 *   { id, sdf, vertexOffsets|null, bbox: [lo, hi], resolution }
 *     sdf / vertexOffsets: ArrayBuffers (transferred)
 *   → { id, ok: true, vertices, faces, numVertices, numFaces }  (transferred)
 * Uses the SAME marching_tet math and the same scaleTensor grid scaling as the
 * main-thread path, so the mesh is byte-identical.
 */

// Start loading the grid immediately; requests await it. A load failure is
// reported on every request rather than swallowed.
const tetReady = loadTetData();

self.onmessage = async (e) => {
  const { id, sdf, vertexOffsets, bbox, resolution } = e.data;
  try {
    const tet = await tetReady;
    if (!Array.isArray(bbox) || bbox.length !== 2 || !bbox.every(Number.isFinite)) {
      throw new Error('marching tet request requires a finite [lo, hi] bbox');
    }
    const gridPositions = scaleTensor(tet.gridVertices, [0, 1], bbox);
    const sdfArr = new Float32Array(sdf);
    if (sdfArr.length !== tet.numVertices) {
      throw new Error(`sdf length ${sdfArr.length} != tet grid vertices ${tet.numVertices}`);
    }
    const offsets = vertexOffsets ? new Float32Array(vertexOffsets) : null;
    if (offsets && offsets.length !== tet.numVertices * 3) {
      throw new Error(`vertexOffsets length ${offsets.length} != ${tet.numVertices * 3}`);
    }
    const mesh = marchingTetrahedra(gridPositions, sdfArr, tet.indices, offsets, resolution);
    self.postMessage({
      id, ok: true,
      vertices: mesh.vertices.buffer,
      faces: mesh.faces.buffer,
      numVertices: mesh.numVertices,
      numFaces: mesh.numFaces,
    }, [mesh.vertices.buffer, mesh.faces.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.stack || err) });
  }
};
//# sourceMappingURL=marching_tet_worker-UZQLtgqC.js.map
