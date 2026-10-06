import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { fitStoneGeometry, structuralFaceAt } from '../structural-material-arch-stones.js';
import { buildGpuArchFixture } from '../structural-material-arch-gpu-fixture.js';

const source = new THREE.BoxGeometry(2, 4, 6).translate(3, -2, 7);
source.computeBoundingBox();
const before = source.attributes.position.array.slice();
const fixture = buildGpuArchFixture({columns: 2, rows: 2, occupancy: [true, true, true, true], bounds: {min: [0, 0], max: [1, 1]}});
// Grid spacing is deliberately present: it must not override the body's envelope.
const body = {...fixture.dimensions, ...fixture.cells[0]};
const fitted = fitStoneGeometry(source, body);
fitted.computeBoundingBox();
const size = fitted.boundingBox.getSize(new THREE.Vector3());
for (const [axis, target] of Object.entries({ x: body.halfExtents[0]*2, y: body.halfExtents[1]*2, z: body.halfExtents[2]*2 })) {
  assert.ok(Math.abs(size[axis] - target) < 1e-7, `fitted ${axis} envelope must match physical body`);
  assert.ok(Math.abs(fitted.boundingBox.getCenter(new THREE.Vector3())[axis]) < 1e-7, 'center at body origin');
}
assert.deepEqual(source.attributes.position.array, before, 'shared source remains unchanged');
assert.deepEqual(structuralFaceAt({ x: -.139, y: .03, z: .02 }, { x: .14, y: .15288, z: .10617 }).toArray(), [-1, 0, 0]);
assert.deepEqual(structuralFaceAt({ x: .01, y: -.151, z: .02 }, { x: .14, y: .15288, z: .10617 }).toArray(), [0, -1, 0]);
assert.deepEqual(structuralFaceAt({ x: .04, y: .03, z: .1 }, { x: .14, y: .15288, z: .10617 }).toArray(), [0, 0, 1]);
assert.throws(() => fitStoneGeometry(source, {halfExtents: [1, 1, 0]}), /positive|finite/);
assert.throws(() => fitStoneGeometry(new THREE.PlaneGeometry(), body), /volume|extent/);
assert.throws(() => structuralFaceAt({ x: NaN, y: 0, z: 1 }, { x: 1, y: 1, z: 1 }), /finite/);
console.log('Stone fitting and structural face contracts pass');
