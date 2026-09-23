import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildSavedMeshStructuralSurface, validateSavedMeshCombustionAssetIdentity } from '../saved-mesh-combustion.mjs';
import { createLayeredStructuralMaterial } from '../structural-material-3d-core.js';
import { createStructuralMeshSkinBinding } from '../structural-combustion-gpu.mjs';

const sceneHost = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(sceneHost, /async function syncSavedSceneCombustionBinding\(\)[\s\S]*?currently supports one bound object/);
assert.match(sceneHost, /createSavedMeshCombustionAssembly\(\{ THREE, entry, gpuContext \}\)/);
assert.match(sceneHost, /hasVolumePrimitiveScene \|\| hasSavedMeshCombustion/);

const promotedAsset = readFileSync(new URL('../artifacts/sinter-forked-timber-trestle-v0-2026-07-18/promoted/forked-timber-reliquary-trestle-v0.glb', import.meta.url));
const promotedIdentity = `sha256:${createHash('sha256').update(promotedAsset).digest('hex')}`;
assert.equal(promotedIdentity, 'sha256:1270054ee62bd3c5c688b13e7334f9ae99280f5868b2121fd317b4dffe5d2b84');
assert.equal(validateSavedMeshCombustionAssetIdentity({ assetIdentity: promotedIdentity }, promotedIdentity), promotedIdentity);
assert.throws(() => validateSavedMeshCombustionAssetIdentity({ assetIdentity: 'sha256:wrong' }, promotedIdentity), /asset identity mismatch/);
const assetJsonLength = promotedAsset.readUInt32LE(12);
const gltfDocument = JSON.parse(promotedAsset.toString('utf8', 20, 20 + assetJsonLength));
assert.deepEqual(gltfDocument.nodes.filter(node => node.mesh !== undefined).map(node => node.name), [
  'reliquary_trestle_body',
  'sacrificial_crossbrace',
]);
assert.ok(gltfDocument.nodes.some(node => node.name === 'support_loss_tenon_0'));
function verifyPromotedAssetSurface() {
const binHeader = 20 + assetJsonLength;
const binaryLength = promotedAsset.readUInt32LE(binHeader);
const binaryChunk = promotedAsset.subarray(binHeader + 8, binHeader + 8 + binaryLength);
const readAccessor = accessorIndex => {
  const accessor = gltfDocument.accessors[accessorIndex];
  const view = gltfDocument.bufferViews[accessor.bufferView];
  const componentBytes = 4;
  const tupleWidth = accessor.type === 'VEC3' ? 3 : 1;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const values = new Float32Array(accessor.count * tupleWidth);
  for (let index = 0; index < values.length; index += 1) {
    const offset = start + index * componentBytes;
    values[index] = accessor.componentType === 5125 ? binaryChunk.readUInt32LE(offset) : binaryChunk.readFloatLE(offset);
  }
  return values;
};
const surfaceMeshes = gltfDocument.nodes.filter(node => node.mesh !== undefined).map(node => {
  const primitive = gltfDocument.meshes[node.mesh].primitives[0];
  const indices = readAccessor(primitive.indices);
  return {
    isMesh: true,
    name: node.name,
    userData: node,
    matrixWorld: {},
    geometry: {
      attributes: {
        position: attribute(readAccessor(primitive.attributes.POSITION)),
        normal: attribute(readAccessor(primitive.attributes.NORMAL)),
      },
      index: { count: indices.length, getX(index) { return indices[index]; } },
    },
  };
});
const actualTrestleSurface = buildSavedMeshStructuralSurface({
  THREE: { Vector3, Box3, Matrix3: class { getNormalMatrix() { return this; } } },
  object: { updateWorldMatrix() {}, traverse(visitor) { surfaceMeshes.forEach(visitor); } },
  assetIdentity: promotedIdentity,
});
const trestleState = createLayeredStructuralMaterial({ columns: 11, rows: 11, layers: 11, notch: false });
const actualTrestleSkin = createStructuralMeshSkinBinding({ mesh: actualTrestleSurface.meshSurface, state: trestleState });
assert.equal(actualTrestleSkin.vertexCount, 448);
assert.equal(actualTrestleSkin.islandCount, 2);
assert.deepEqual(actualTrestleSurface.meshSurface.islands.map(island => island.sourceLabel), [
  'reliquary_trestle_body',
  'sacrificial_crossbrace',
]);
}

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  fromBufferAttribute(attribute, index) { return this.set(attribute.getX(index), attribute.getY(index), attribute.getZ(index)); }
  applyMatrix4() { return this; }
  applyMatrix3() { return this; }
  normalize() { return this; }
  getComponent(index) { return [this.x, this.y, this.z][index]; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  toArray() { return [this.x, this.y, this.z]; }
}

class Box3 {
  constructor() { this.makeEmpty(); }
  makeEmpty() {
    this.min = new Vector3(Infinity, Infinity, Infinity);
    this.max = new Vector3(-Infinity, -Infinity, -Infinity);
    return this;
  }
  expandByPoint(point) {
    this.min.set(Math.min(this.min.x, point.x), Math.min(this.min.y, point.y), Math.min(this.min.z, point.z));
    this.max.set(Math.max(this.max.x, point.x), Math.max(this.max.y, point.y), Math.max(this.max.z, point.z));
  }
  getCenter(target) { return target.set((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2, (this.min.z + this.max.z) / 2); }
  getSize(target) { return target.set(this.max.x - this.min.x, this.max.y - this.min.y, this.max.z - this.min.z); }
}

const attribute = values => ({
  count: values.length / 3,
  getX(index) { return values[index * 3]; },
  getY(index) { return values[index * 3 + 1]; },
  getZ(index) { return values[index * 3 + 2]; },
});
verifyPromotedAssetSurface();
const makeMesh = (name, vertices) => ({
  isMesh: true,
  name,
  matrixWorld: {},
  geometry: { attributes: { position: attribute(vertices), normal: attribute([0, 1, 0, 0, 1, 0, 0, 1, 0]) }, index: { count: 3, getX(index) { return index; } } },
});
const meshes = [
  makeMesh('root', [0, 0, 0, 0.5, 0, 0, 0, 1, 1]),
  makeMesh('free', [0.5, 0, 0, 1, 0, 0, 1, 1, 1]),
];
const object = { updateWorldMatrix() {}, traverse(visitor) { meshes.forEach(visitor); } };
const result = buildSavedMeshStructuralSurface({
  THREE: { Vector3, Box3, Matrix3: class { getNormalMatrix() { return this; } } },
  object,
  assetIdentity: `sha256:${'a'.repeat(64)}`,
});

assert.equal(result.meshSurface.schema, 'kaminos.structural-mesh-surface.v0');
assert.equal(result.meshSurface.vertexIslands.length, 6);
assert.deepEqual([...result.meshSurface.vertexIslands], [0, 0, 0, 1, 1, 1]);
assert.equal(result.meshSurface.islands.length, 2);
assert.equal(result.meshSurface.indices.length, 6);
assert.deepEqual(result.meshSurface.islands.map(island => island.nodeBounds), [
  { min: [0, 0, 0], max: [0.5, 1, 1] },
  { min: [0.5, 0, 0], max: [1, 1, 1] },
]);
assert.deepEqual(result.worldOffset, [0.5, 0.5, 0.5]);
assert.throws(() => buildSavedMeshStructuralSurface({
  THREE: { Vector3, Box3, Matrix3: class { getNormalMatrix() { return this; } } },
  object: { ...object, traverse(visitor) { visitor(meshes[0]); } },
  assetIdentity: 'sha256:test',
}), /requires two mesh islands/);

console.log('saved mesh combustion contracts: ok');
