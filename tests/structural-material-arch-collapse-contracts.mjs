import assert from 'node:assert/strict';
import { createArchCollapse } from '../structural-material-arch-collapse.js';
import * as CANNON from 'cannon-es';

const profile = {
  columns: 5, rows: 4, bounds: { min: [-1, 0], max: [1, 1.6] },
  occupancy: Array.from({ length: 20 }, (_, index) => index % 5 === 0 || index % 5 === 4 || index >= 15),
};
const model = createArchCollapse(profile, { layers: 2, depth: 0.6, gravity: 9.81 });
const initial = model.snapshot();
const point = { x: initial.bodies[0].position.x + 0.1, y: initial.bodies[0].position.y, z: initial.bodies[0].position.z };
const local = model.worldToLocalPoint(0, point);
assert(Math.abs(local.x - 0.1) < 1e-12);
assert.throws(() => model.worldToLocalPoint(0, { x: NaN, y: 0, z: 0 }), /finite/);
assert.equal(initial.route, 'kaminos.structural-material.arch-gravity-collapse.cannon.v0');
assert.equal(initial.backend, 'cannon-es-cpu');
assert(initial.bodies.every(body => body.pinned || body.mass > 0));
assert(initial.bonds.every(bond => bond.alive));
for (let i = 0; i < 120; i++) model.step();
const settled = model.snapshot();
assert.equal(settled.broken, 0, 'intact fixture must carry its own weight');
assert(settled.bonds.some(bond => bond.reaction > 0.01), 'weight must create measured connection force');
for (const body of settled.bodies.filter(body => body.pinned)) {
  assert.deepEqual(body.position, initial.bodies[body.index].position);
}
const front = settled.bodies.find(body => !body.pinned && body.layer === 1);
model.setHand(front.index, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
assert.deepEqual(model.snapshot().hand.layers, [1]);
assert.throws(() => model.setHand(0, { x: 1, y: 0, z: 0 }), /front/);
model.step();
model.release();
assert.equal(model.snapshot().hand, null);
assert.notDeepEqual(model.snapshot().bodies[front.index].position, initial.bodies[front.index].position,
  'release must not reset pose');
model.dispose();

const repair = createArchCollapse(profile, { layers: 2, depth: 0.6, gravity: 0 });
const connection = repair.bonds.find(bond => !repair.cells[bond.a].pinned && !repair.cells[bond.b].pinned);
repair.world.removeConstraint(connection.joint);
connection.joint = null; connection.alive = false;
const a = repair.cells[connection.a], b = repair.cells[connection.b];
const offset = b.rest.vsub(a.rest);
b.body.position.copy(a.body.position.vsub(offset));
assert.equal(repair.bind(a.index).length, 0,
  'equal center distance is not enough: the original opposing connection faces must meet');
for (const option of [{ solverIterations: 0 }, { friction: NaN }, { gripDamping: -1 }]) {
  assert.throws(() => createArchCollapse(profile, option), /finite|positive|nonnegative/);
}
repair.dispose();
const loose = createArchCollapse(profile, { layers: 2, depth: 0.6, scale: 1, gravity: 0 });
const looseCell = loose.cells.find(cell => !cell.pinned && cell.layer === 1);
for (const bond of loose.bonds) if (bond.a === looseCell.index || bond.b === looseCell.index) {
  loose.world.removeConstraint(bond.joint); bond.joint = null; bond.alive = false;
}
for (let i = 0; i < 120; i++) {
  loose.setHand(looseCell.index, { x: looseCell.rest.x - 1.5, y: looseCell.rest.y, z: looseCell.rest.z });
  loose.step();
}
assert(looseCell.body.position.distanceTo(looseCell.rest) < 5,
  'a disconnected light block must not turn a finite hand target into explosive motion');
loose.dispose();

// Observed engine conformance: a locked hanging mass reports its weight, and removal releases it.
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
world.solver.iterations = 30;
const support = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(0, 1, 0) });
const mass = new CANNON.Body({ mass: 2, position: new CANNON.Vec3(0, 0, 0) });
world.addBody(support); world.addBody(mass);
const joint = new CANNON.LockConstraint(support, mass); world.addConstraint(joint);
for (let i = 0; i < 120; i++) world.step(1 / 60);
const reaction = new CANNON.Vec3();
for (const equation of joint.equations) reaction.vadd(equation.jacobianElementB.spatial.scale(equation.multiplier), reaction);
assert(Math.abs(reaction.y - 19.62) < 0.02, 'effective engine multiplier must resolve to the hanging mass weight');
assert(Math.abs(mass.position.y) < 0.001);
world.removeConstraint(joint);
for (let i = 0; i < 30; i++) world.step(1 / 60);
assert(mass.position.y < -1, 'joint removal must actually stop carrying the mass');
console.log('arch collapse contracts passed');
