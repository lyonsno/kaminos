import assert from 'node:assert/strict';
import { voxelizeTriangleSolid, solidFieldIndex, trianglesFromSceneObject, sceneSolidRevision, packSolidTextureRows } from '../volume-scene-solid.mjs';

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
console.log('volume scene solid contracts: PASS');
