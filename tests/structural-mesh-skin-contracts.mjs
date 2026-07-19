import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createLayeredStructuralMaterial } from '../structural-material-3d-core.js';

const gpuModule = await import('../structural-combustion-gpu.mjs');
const source = readFileSync(new URL('../structural-combustion-gpu.mjs', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../structural-combustion.html', import.meta.url), 'utf8');

assert.equal(
  typeof gpuModule.createStructuralMeshSkinBinding,
  'function',
  'the structural assembly must expose deterministic initialization-time mesh binding',
);

const state = createLayeredStructuralMaterial({ columns: 5, rows: 4, layers: 3, notch: true });
const mesh = {
  schema: 'kaminos.structural-mesh-surface.v0',
  assetIdentity: 'fixture:irregular-timber:sha256-test',
  positions: new Float32Array([
    0.00, 0.12, 0.18,
    0.48, 0.06, 0.14,
    0.48, 0.94, 0.20,
    0.52, 0.08, 0.16,
    1.00, 0.16, 0.22,
    0.52, 0.92, 0.18,
  ]),
  normals: new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]),
  indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
  vertexIslands: new Uint32Array([0, 0, 0, 1, 1, 1]),
  islands: [
    { id: 'root', motionAnchor: [0, 0.5, 0.5], nodeBounds: { min: [0, 0, 0], max: [0.5, 1, 1] } },
    { id: 'free', motionAnchor: [1, 0.5, 0.5], nodeBounds: { min: [0.5, 0, 0], max: [1, 1, 1] } },
  ],
};

const binding = gpuModule.createStructuralMeshSkinBinding({ mesh, state });
const repeated = gpuModule.createStructuralMeshSkinBinding({ mesh, state });
assert.equal(binding.schema, 'kaminos.structural-mesh-skin-binding.v0');
assert.equal(binding.assetIdentity, mesh.assetIdentity);
assert.equal(binding.vertexCount, 6);
assert.equal(binding.indexCount, 6);
assert.equal(binding.triangleCount, 2);
assert.equal(binding.nodesPerVertex, 4);
assert.deepEqual(binding.nodeIndices, repeated.nodeIndices, 'mesh binding must be deterministic');
assert.deepEqual(binding.nodeWeights, repeated.nodeWeights, 'mesh weights must be deterministic');
assert.deepEqual(binding.motionNodeIndices, repeated.motionNodeIndices, 'motion ownership must be deterministic');

for (let vertex = 0; vertex < binding.vertexCount; vertex += 1) {
  const offset = vertex * binding.nodesPerVertex;
  const weights = Array.from(binding.nodeWeights.slice(offset, offset + binding.nodesPerVertex));
  const nodeIndices = Array.from(binding.nodeIndices.slice(offset, offset + binding.nodesPerVertex));
  assert.ok(weights.every(Number.isFinite), `vertex ${vertex} weights must be finite`);
  assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-6, `vertex ${vertex} weights must normalize`);
  assert.ok(nodeIndices.every(index => index >= 0 && index < state.nodes.length), `vertex ${vertex} nodes must be in range`);
  const island = mesh.islands[mesh.vertexIslands[vertex]];
  for (const nodeIndex of nodeIndices) {
    const node = state.nodes[nodeIndex];
    assert.ok(node.x >= island.nodeBounds.min[0] && node.x <= island.nodeBounds.max[0]);
    assert.ok(node.y >= island.nodeBounds.min[1] && node.y <= island.nodeBounds.max[1]);
    assert.ok(node.z >= island.nodeBounds.min[2] && node.z <= island.nodeBounds.max[2]);
  }
}
for (let islandIndex = 0; islandIndex < mesh.islands.length; islandIndex += 1) {
  const owners = Array.from(binding.motionNodeIndices).filter((_, vertex) => mesh.vertexIslands[vertex] === islandIndex);
  assert.equal(new Set(owners).size, 1, `island ${islandIndex} must move as one authored surface piece`);
}

assert.throws(
  () => gpuModule.createStructuralMeshSkinBinding({ mesh: { ...mesh, assetIdentity: '' }, state }),
  /asset identity/i,
  'missing asset identity cannot silently become a procedural surface',
);
assert.throws(
  () => gpuModule.createStructuralMeshSkinBinding({ mesh: { ...mesh, indices: null }, state }),
  /indices/i,
  'non-indexed input is outside the first mesh-carrier contract',
);
assert.throws(
  () => gpuModule.createStructuralMeshSkinBinding({ mesh: { ...mesh, normals: new Float32Array(0) }, state }),
  /normals/i,
  'missing authored normals must fail instead of shading a fallback box',
);
assert.throws(
  () => gpuModule.createStructuralMeshSkinBinding({
    mesh: { ...mesh, vertexIslands: new Uint32Array([0, 1, 0, 1, 1, 1]) },
    state,
  }),
  /triangle.*island/i,
  'a triangle spanning authored separation islands would hide component separation',
);

assert.match(source, /struct MeshVertex[\s\S]*position: vec4<f32>[\s\S]*normal: vec4<f32>/);
assert.match(source, /struct MeshBinding[\s\S]*nodeIndices: vec4<u32>[\s\S]*nodeWeights: vec4<f32>[\s\S]*motion: vec4<u32>/);
assert.match(source, /fn meshSurfaceVertex\(/, 'mesh vertices require a dedicated structural presentation stage');
assert.match(source, /materials\[binding\.nodeIndices\.x\]/, 'mesh shading must consume resident node material state');
assert.match(source, /componentMotions\[binding\.motion\.x\]/, 'mesh displacement must consume resident component motion');
assert.match(source, /pass\.draw\(socket\.meshSkin\.indexCount\)/, 'the mesh surface must render its authored index stream');
assert.match(
  source,
  /showStructuralOverlay:\s*structure\.showStructuralOverlay === true \|\| !meshSkin/,
  'the structural lattice must be hidden by default behind an imported mesh skin',
);
assert.match(
  source,
  /if \(socket\.showStructuralOverlay\)[\s\S]*pass\.draw\(2, socket\.descriptor\.bondCount\)/,
  'bond and node overlays require the explicit structural debug switch',
);
assert.match(
  source,
  /meshRequested && structure\.meshSurface == null[\s\S]*throw new Error\(`structural combustion mesh surface missing/,
  'a requested mesh skin must fail before any procedural surface can be selected',
);
assert.match(pageSource, /GLTFLoader/, 'the browser witness must ingest an actual GLTF mesh asset');
assert.match(pageSource, /assetIdentity/, 'the effective mesh asset identity must reach the witness receipt');

console.log('structural mesh skin contracts: ok');
