import assert from 'node:assert/strict';
import { adapterFixture, profile } from './helpers/arch-gpu-adapter-fixture.mjs';

const test = await adapterFixture();
const model = await test.module.createGpuArchCollapse(profile, test.renderer, { gravityRampSeconds: 0 });
const cell = model.cells.find(body => !body.pinned && body.layer === 2);
const point = { x: 0, y: 0, z: cell.half.z }, target = { x: .1, y: .2, z: .3 }, normal = { x: 0, y: 0, z: 1 };
model.setSurfaceHand(cell.index, target, point, normal);
const accepted = model.snapshot().hand;
for (const invalid of [{}, { x: 1 }, { x: 0, y: 0 }, { x: 0, y: 0, z: NaN }, { x: 0, y: Infinity, z: 0 }, null]) {
  assert.throws(() => model.moveHand(invalid), /finite/);
  assert.throws(() => model.worldToLocalPoint(cell.index, invalid), /finite/);
  assert.throws(() => model.setSurfaceHand(cell.index, invalid, point, normal), /finite/);
  assert.throws(() => model.setSurfaceHand(cell.index, target, invalid, normal), /finite/);
  assert.throws(() => model.setSurfaceHand(cell.index, target, point, invalid), /finite/);
  assert.deepEqual(model.snapshot().hand, accepted, 'invalid coordinates cannot replace or release the prior accepted grip');
}
model.moveHand({ ...target, diagnostic: 'additive metadata' });
assert.deepEqual(model.snapshot().hand.target, { ...target, diagnostic: 'additive metadata' });
const embedded = { ...point, z: point.z * .94 };
assert.throws(() => model.setSurfaceHand(cell.index, target, embedded, normal), /selected face/);
model.setSurfaceHand(cell.index, target, embedded, normal, 'embedded-visual');
assert.equal(model.snapshot().hand.contactSurface, 'embedded-visual');
assert.deepEqual(model.snapshot().hand.localPoint, embedded);
assert.throws(() => model.setSurfaceHand(cell.index, target, { ...point, z: point.z * 1.1 }, normal, 'embedded-visual'), /envelope/);
assert.throws(() => model.setSurfaceHand(cell.index, target, embedded, normal, 'unknown'), /contact surface/);
assert.deepEqual(model.snapshot().hand.localPoint, embedded, 'invalid replacement retains embedded grip');
model.dispose();
console.log('Hand and point contracts require x/y/z and retain accepted contact on rejection');
