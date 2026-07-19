import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const artifactRoot = join(root, 'artifacts/structural-bell-citadel-v0-2026-07-18');
const descriptorPath = join(artifactRoot, 'structuralAssetDescriptor.json');
const visualPath = join(artifactRoot, 'visual/citadel-bell-v0.glb');
const proxyPath = join(artifactRoot, 'proxy/citadel-bell-v0-proxy.glb');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readGlbJson(path) {
  const buffer = readFileSync(path);
  assert.equal(buffer.toString('utf8', 0, 4), 'glTF', `${path} is not a GLB`);
  assert.equal(buffer.readUInt32LE(4), 2, `${path} must be GLB/glTF 2.0`);
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.toString('utf8', 16, 20);
  assert.equal(jsonType, 'JSON', `${path} first GLB chunk must be JSON`);
  return JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).trim());
}

function nodeByName(gltf, name) {
  return (gltf.nodes || []).find(node => node.name === name) || null;
}

function trianglesForMesh(gltf, meshName) {
  const mesh = (gltf.meshes || []).find(mesh => mesh.name === meshName);
  assert.ok(mesh, `${meshName} mesh is missing`);
  return (mesh.primitives || []).reduce((sum, primitive) => {
    const accessor = gltf.accessors?.[primitive.indices];
    assert.ok(accessor, `${meshName} primitive missing index accessor`);
    assert.equal(accessor.type, 'SCALAR', `${meshName} indices must be scalar`);
    assert.equal(accessor.count % 3, 0, `${meshName} index count must form triangles`);
    return sum + accessor.count / 3;
  }, 0);
}

assert.ok(existsSync(descriptorPath), 'structural bell descriptor must exist');
assert.ok(existsSync(visualPath), 'structural bell visual GLB must exist');
assert.ok(existsSync(proxyPath), 'structural bell proxy GLB must exist');

const descriptor = readJson(descriptorPath);
const visual = readGlbJson(visualPath);
const proxy = readGlbJson(proxyPath);

for (const [label, gltf] of [['visual', visual], ['proxy', proxy]]) {
  for (const [index, bufferView] of (gltf.bufferViews || []).entries()) {
    assert.equal(bufferView.buffer, 0, `${label} bufferView ${index} must bind to GLB buffer 0`);
  }
}

assert.equal(descriptor.schema, 'kaminos.structural-material.asset-descriptor.v0');
assert.equal(descriptor.assetId, 'citadel-bell-v0');
assert.equal(descriptor.assetRole, 'bell-body');
assert.equal(descriptor.instancePolicy, 'single-authored-asset');
assert.equal(descriptor.structuralAuthority, false);
assert.equal(descriptor.collisionStatus, 'proxy-unverified');
assert.equal(descriptor.coordinateFrame?.handedness, 'right');
assert.equal(descriptor.coordinateFrame?.up, '+Y');
assert.equal(descriptor.coordinateFrame?.forward, '+Z');
assert.equal(descriptor.coordinateFrame?.unit, 'meter');
assert.deepEqual(descriptor.pivot?.translation, [0, 0, 0]);
assert.equal(descriptor.pivot?.socketId, 'bell-crown-v0');
assert.equal(descriptor.transformsBaked, true);
assert.equal(descriptor.visualRef, 'visual/citadel-bell-v0.glb');
assert.equal(descriptor.proxyRef, 'proxy/citadel-bell-v0-proxy.glb');
assert.ok(descriptor.localBounds?.min?.[1] < -1.1, 'bell body must extend down along -Y from the crown pivot');
assert.ok(descriptor.localBounds?.max?.[1] <= 0.05, 'crown pivot must stay near the top of local bounds');
assert.ok(descriptor.boundingSphere?.radius > 0.55, 'descriptor must report a measured bounding sphere');
assert.ok(descriptor.triangleCount?.visual > descriptor.triangleCount?.proxy, 'visual mesh must be richer than proxy mesh');
assert.ok(descriptor.materialSlots?.includes('weathered-cast-bronze-v0'), 'descriptor must name weathered bronze material');

const crown = nodeByName(visual, 'bell-crown-v0');
const visualNode = nodeByName(visual, 'BellVisual');
assert.ok(crown, 'visual GLB must include bell-crown-v0 socket node');
assert.ok(visualNode, 'visual GLB must include preferred BellVisual node');
assert.deepEqual(crown.translation || [0, 0, 0], [0, 0, 0], 'bell-crown-v0 socket must be at origin');
assert.deepEqual(crown.rotation || [0, 0, 0, 1], [0, 0, 0, 1], 'bell-crown-v0 socket must have identity rotation');

const proxyNode = nodeByName(proxy, 'BellProxy');
assert.ok(proxyNode, 'proxy GLB must include named BellProxy node');

const visualTriangles = trianglesForMesh(visual, 'BellVisualMesh');
const proxyTriangles = trianglesForMesh(proxy, 'BellProxyMesh');
assert.equal(visualTriangles, descriptor.triangleCount.visual, 'descriptor visual triangle count must match GLB');
assert.equal(proxyTriangles, descriptor.triangleCount.proxy, 'descriptor proxy triangle count must match GLB');
