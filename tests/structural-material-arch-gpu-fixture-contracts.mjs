import assert from 'node:assert/strict';
import { buildGpuArchFixture } from '../structural-material-arch-gpu-fixture.js';
import { createArchCollapse } from '../structural-material-arch-collapse.js';

const profile = { columns: 5, rows: 4, bounds: { min: [-1, 0], max: [1, 1.6] },
  occupancy: Array.from({ length: 20 }, (_, i) => i % 5 === 0 || i % 5 === 4 || i >= 15) };
const options = { layers: 3, depth: 0.65, strength: 80 };
const cpu = createArchCollapse(profile, options);
const fixture = buildGpuArchFixture(profile, options);
assert.equal(fixture.cells.length, cpu.cells.length);
assert.equal(fixture.bonds.length, cpu.bonds.length);
assert.equal(fixture.floorY, cpu.snapshot().floorY);
for (const cell of fixture.cells) {
  const reference = cpu.cells[cell.index];
  assert.equal(cell.id, reference.id);
  assert.equal(cell.pinned, reference.pinned);
  assert.deepEqual(cell.position, reference.body.position.toArray());
  assert.deepEqual(cell.halfExtents, reference.half.toArray());
  assert.equal(cell.mass, reference.body.mass);
}
for (const [i, bond] of fixture.bonds.entries()) {
  const reference = cpu.bonds[i];
  assert.deepEqual([bond.a, bond.b, bond.area], [reference.a, reference.b, reference.area]);
  assert.deepEqual(bond.anchorA, reference.anchorA.toArray());
  assert.deepEqual(bond.anchorB, reference.anchorB.toArray());
  assert.deepEqual(bond.normal, reference.normal.toArray());
}
assert.throws(() => buildGpuArchFixture({ ...profile, occupancy: [] }), /occupancy/);
assert.throws(() => buildGpuArchFixture(profile, { layers: 1 }), /layers/);
assert.throws(() => buildGpuArchFixture(profile, { strength: NaN }), /strength/);
assert.equal(buildGpuArchFixture(profile, { initialJointPenalty: 1000 }).config.initialJointPenalty, 1000);
for (const initialJointPenalty of [0, -1, NaN, Infinity, 1e7]) {
  assert.throws(() => buildGpuArchFixture(profile, { initialJointPenalty }), /initialJointPenalty/);
}
assert.equal(buildGpuArchFixture(profile, { gravityRampSeconds: 1 }).config.gravityRampSeconds, 1);
assert.equal(fixture.config.gravityRampSeconds, .5);
for (const gravityRampSeconds of [-1, NaN, Infinity]) {
  assert.throws(() => buildGpuArchFixture(profile, { gravityRampSeconds }), /gravityRampSeconds/);
}
assert.throws(() => buildGpuArchFixture(profile, { preventPenetratingNormalDropout: 'true' }), /preventPenetratingNormalDropout/);
for (const substeps of [0, 1.5, 9, NaN]) assert.throws(() => buildGpuArchFixture(profile, { substeps }), /substeps/);
assert.equal(buildGpuArchFixture(profile, { substeps: 2, preventPenetratingNormalDropout: true }).config.substeps, 2);
cpu.dispose();
console.log('GPU arch fixture matches unchanged CPU construction');
