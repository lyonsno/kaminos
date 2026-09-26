import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { voxelizeTriangleSolid, solidFieldIndex, trianglesFromSceneObject, sceneSolidRevision, packSolidTextureRows, countEmitterChemicalSupport, assertEffectiveSceneCollision } from '../volume-scene-solid.mjs';

const box = [
  [[-.25, -.25, -.25], [-.25, .25, -.25], [-.25, .25, .25]],
  [[-.25, -.25, -.25], [-.25, .25, .25], [-.25, -.25, .25]],
  [[.25, -.25, -.25], [.25, .25, .25], [.25, .25, -.25]],
  [[.25, -.25, -.25], [.25, -.25, .25], [.25, .25, .25]],
  [[-.25, -.25, -.25], [.25, -.25, .25], [.25, -.25, -.25]],
  [[-.25, -.25, -.25], [-.25, -.25, .25], [.25, -.25, .25]],
  [[-.25, .25, -.25], [.25, .25, -.25], [.25, .25, .25]],
  [[-.25, .25, -.25], [.25, .25, .25], [-.25, .25, .25]],
  [[-.25, -.25, -.25], [.25, -.25, -.25], [.25, .25, -.25]],
  [[-.25, -.25, -.25], [.25, .25, -.25], [-.25, .25, -.25]],
  [[-.25, -.25, .25], [-.25, .25, .25], [.25, .25, .25]],
  [[-.25, -.25, .25], [.25, .25, .25], [.25, -.25, .25]],
];

const grid = 24;
const solid = voxelizeTriangleSolid(box, grid);
assert.equal(solid.cells.length, grid * grid * 2 * grid);
assert.equal(solid.cells[solidFieldIndex(grid, 12, 12, 12)], 1, 'closed box interior is solid');
assert.equal(solid.cells[solidFieldIndex(grid, 12, 12, 19)], 0, 'outside is fluid');
assert.ok(solid.surfaceCellCount > 0);
assert.ok(solid.interiorCellCount > 0);
assert.ok(solid.blockedFaceCount > 0);
const packed = packSolidTextureRows(solid.cells, grid);
assert.equal(packed.bytesPerRow, 256);
assert.equal(packed.data[256 * (12 + grid * 2 * 12) + 12], 1, 'GPU texture row preserves XYZ cell address');

const open = voxelizeTriangleSolid(box.slice(0, 10), grid);
assert.equal(open.cells[solidFieldIndex(grid, 12, 12, 12)], 0, 'open shell does not claim a filled interior');
assert.ok(open.surfaceCellCount > 0, 'open triangle shell remains an obstacle');

const offDomain = voxelizeTriangleSolid([[[4, 4, 4], [5, 4, 4], [4, 5, 4]]], grid);
assert.equal(offDomain.surfaceCellCount, 0);
assert.equal(offDomain.interiorCellCount, 0);

assert.throws(() => voxelizeTriangleSolid([], grid), /triangles/i);

const position = {
  count: 3,
  getX: i => [0, 1, 0][i],
  getY: i => [0, 0, 1][i],
  getZ: () => 0,
};
const mesh = {
  isMesh: true,
  visible: true,
  geometry: { uuid: 'authored-triangle', getAttribute: name => name === 'position' ? position : null, getIndex: () => null },
  matrixWorld: { elements: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 0, 0, 1] },
};
const object = { updateWorldMatrix() {}, traverse: callback => callback(mesh) };
const extraction = trianglesFromSceneObject(object, { translate: [1, 0, 0], scale: 2 });
assert.deepEqual(extraction.triangles, [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]],
  'mesh world transform and inverse volume transform both affect collision geometry');
assert.match(extraction.revision, /authored-triangle/);
const oldRevision = sceneSolidRevision(object);
mesh.matrixWorld.elements[12] += .25;
assert.notEqual(sceneSolidRevision(object), oldRevision, 'transform changes invalidate the field');
mesh.parent = {visible: false, parent: null};
assert.throws(() => trianglesFromSceneObject(object), /no visible mesh triangles/,
  'a scene-hidden kiln cannot silently remain an active collider');
delete mesh.parent;
assert.throws(() => trianglesFromSceneObject({ updateWorldMatrix() {}, traverse: callback => callback({isMesh: true, geometry: {getAttribute: () => null}}) }), /position/i);

const shader = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
function shaderFunction(name) {
  const start = shader.indexOf(`fn ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  return shader.slice(start, shader.indexOf('\n}', start) + 2);
}
for (const name of ['sampleFrontField', 'sampleFluidSlot', 'samplePredictSlot']) {
  const body = shaderFunction(name);
  assert.match(body, /sceneSolidAt\(sampleCell\)/, `${name} must exclude solid interpolation corners`);
  assert.match(body, /weightSum/, `${name} must renormalize fluid-side sample weights`);
}
assert.match(shaderFunction('slotExtrema'), /sceneSolidAt\(sampleCell\)/,
  'MacCormack limiter must exclude masked solid corners from its source envelope');
const selectiveRoles = shader.slice(shader.indexOf('function rebuildSelectiveHeadLiveBindGroups()'),
  shader.indexOf('function ', shader.indexOf('function rebuildSelectiveHeadLiveBindGroups()') + 10));
assert.match(selectiveRoles, /fluidFrontRead:[\s\S]*?binding: 16,[\s\S]*?sidecar:/,
  'selective-head fluid/front read must bind the solid texture');
assert.match(selectiveRoles, /sidecar:[\s\S]*?binding: 16,[\s\S]*?splat:/,
  'selective-head sidecar read must bind the solid texture');

const ring = {family: 'ring', sourceLaw: 'shallow-primary', origin: [0, -0.5, 0],
  axis: [0, 1, 0], supportAxis: [1, 0, 0], radius: .08, extent: .45,
  sourceDepth: .035, strength: 1};
const emitterBox = {active: true, cellMin: [4, 3, 4], cellExtent: [16, 12, 16]};
const clearCells = new Uint8Array(grid * grid * 2 * grid);
const clearSupport = countEmitterChemicalSupport(ring, emitterBox, clearCells, grid);
assert.ok(clearSupport.fluidSupportCells > 0, 'shallow ring has actual source support');
const pluggedCells = new Uint8Array(clearCells.length).fill(1);
pluggedCells[solidFieldIndex(grid, 12, 12, 12)] = 0;
const pluggedSupport = countEmitterChemicalSupport(ring, emitterBox, pluggedCells, grid);
assert.ok(pluggedSupport.boundsFluidCells > 0, 'conservative emitter bounds can have an open cell');
assert.equal(pluggedSupport.fluidSupportCells, 0, 'open AABB alone cannot pass a masked SDF source');
const effectiveCollision = {requested: true, effective: 'mesh-voxel-solid', sourceId: 'kiln',
  geometryRevision: 'authored-kiln-transform', triangleCount: 12, solidCellCount: 16,
  blockedFaceCount: 20, sourceSupport: {fluidSupportCells: 8}};
assert.doesNotThrow(() => assertEffectiveSceneCollision(effectiveCollision, 'kiln'));
for (const falseReceipt of [
  {...effectiveCollision, requested: false},
  {...effectiveCollision, effective: 'off'},
  {...effectiveCollision, sourceId: 'other'},
  {...effectiveCollision, geometryRevision: null},
  {...effectiveCollision, sourceSupport: {fluidSupportCells: 0}},
]) assert.throws(() => assertEffectiveSceneCollision(falseReceipt, 'kiln'));
console.log('volume scene solid contracts: PASS');
