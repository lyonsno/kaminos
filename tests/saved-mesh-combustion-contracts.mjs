import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildSavedMeshStructuralSurface, validateSavedMeshCombustionAssetIdentity } from '../saved-mesh-combustion.mjs';
import { createLayeredStructuralMaterial } from '../structural-material-3d-core.js';
import { createStructuralMeshSkinBinding } from '../structural-combustion-gpu.mjs';
import { getSceneObjectRecords } from '../scene-persistence-core.js';

const sceneHost = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const volumeCore = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const syncSource = sceneHost.match(/async function syncSavedSceneCombustionBinding\(\) \{[\s\S]*?\n\}/)[0];
const boundObjects = [{id: 'first', combustionBinding: {}}, {id: 'second', combustionBinding: {}}];
const assemblyCalls = [];
const syncContext = {
  sceneObjects: boundObjects,
  savedMeshCombustionRuntime: null,
  THREE: {}, URLSearchParams,
  window: {location: {search: '?volume_structural_combustion_view=material'}},
  volumePrototype: {
    borrowStructuralCombustionGpuContext: async () => ({device: 'same-device'}),
    setGpuStructuralCombustionAssembly: async () => {},
    clearGpuStructuralCombustionAssembly() {},
  },
  createSavedMeshCombustionAssembly: async args => {
    assemblyCalls.push(args);
    return {assembly: {}, dispose() {}};
  },
};
assert.equal(await runInNewContext(`(async () => { ${syncSource}; return syncSavedSceneCombustionBinding(); })()`, syncContext), true);
assert.deepEqual(assemblyCalls[0].entries, boundObjects, 'every bound saved object reaches the one shared GPU assembly');
assert.equal(assemblyCalls[0].presentationDebugMode, 'material');
assert.equal(await runInNewContext(`(async () => { ${syncSource}; return syncSavedSceneCombustionBinding(); })()`, syncContext), true);
assert.equal(assemblyCalls.length, 1, 'unchanged object identities retain their resident assembly and material history');
assert.match(
  readFileSync(new URL('../saved-mesh-combustion.mjs', import.meta.url), 'utf8'),
  /presentationDebugMode,\s*structures[, :]/,
  'the saved trestle route must carry its requested GPU diagnostic view into the assembly',
);
assert.match(sceneHost, /hasVolumePrimitiveScene \|\| activeSceneComposition \|\| hasSavedMeshCombustion/,
  'saved mesh scenes activate the shared volume consumer without regressing composed scenes');
const activationBranch = sceneHost.match(/if \(hasVolumePrimitiveScene \|\| activeSceneComposition \|\| hasSavedMeshCombustion(?: \|\| [^\n]+)?\) \{[\s\S]*?\n  \}/)[0];
for (const activeSceneComposition of [false, true]) {
  const selectedTabs = [];
  const activations = [];
  await runInNewContext(`(async () => { ${activationBranch} })()`, {
    hasVolumePrimitiveScene: false,
    activeSceneComposition,
    hasSavedMeshCombustion: true,
    setActiveTab: tab => selectedTabs.push(tab),
    volumePrototype: { setActive: active => activations.push(active) },
  });
  assert.deepEqual(selectedTabs, [activeSceneComposition ? 'assets' : 'volume'],
    'authored compositions retain their object-editing tab while saved meshes activate volume');
  assert.deepEqual(activations, [true]);
}
assert.ok(!/\bencodeHistoryCopy\s*\(/.test(volumeCore) || /\b(?:function|const|let|var)\s+encodeHistoryCopy\b/.test(volumeCore),
  'the rebased render loop must not call a retired, undefined history-copy helper');

const promotedAsset = readFileSync(new URL('../artifacts/sinter-forked-timber-trestle-v0-2026-07-18/promoted/forked-timber-reliquary-trestle-v0.glb', import.meta.url));
const promotedIdentity = `sha256:${createHash('sha256').update(promotedAsset).digest('hex')}`;
const bindingFixture = {
  schema: 'kaminos.object-combustion-binding.v0', objectId: 'first',
  assetIdentity: promotedIdentity, structuralProfile: 'timber-two-island.v0', burnRate: 0.003,
};
assert.equal(getSceneObjectRecords({objects: [{id: 'first', combustionBinding: {...bindingFixture, emissionEnabled: false}}]})[0].combustionBinding.emissionEnabled, false);
assert.throws(() => getSceneObjectRecords({objects: [{id: 'first', combustionBinding: {...bindingFixture, emissionEnabled: 'false'}}]}), /emissionEnabled must be a boolean/,
  'a string-valued emission-off control must not silently emit');
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
const ignitionScene = JSON.parse(readFileSync(new URL('../scenes/sinter-timber-ignition-pair.kaminos.json', import.meta.url), 'utf8'));
for (const sceneObject of ignitionScene.objects) {
  for (const [axis, domainMin, domainMax] of [[0, -1, 1], [1, -1, 3], [2, -1, 1]]) {
    const endpoints = [-0.5, 0.5].map(sign =>
      (actualTrestleSurface.worldOffset[axis] + sign * actualTrestleSurface.displayScale[axis]) * sceneObject.transform.scale[axis] + sceneObject.transform.position[axis]);
    assert.ok(endpoints.every(value => value >= domainMin && value < domainMax),
      `${sceneObject.id} default material support must lie inside the actual tall Pyro domain`);
  }
}
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
