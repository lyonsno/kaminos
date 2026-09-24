import assert from 'node:assert/strict';
import {
  rasterizeArchTriangles,
  buildArchStructuralProxy,
  solveArchStructuralProxy,
  fractureArchStructuralProxy,
  bindArchStructuralProxy,
} from '../structural-material-arch-core.js';

const unitSquare = [
  [[0, 0], [1, 0], [1, 1]],
  [[0, 0], [1, 1], [0, 1]],
];
const filled = rasterizeArchTriangles(unitSquare, { min: [0, 0], max: [1, 1] }, 5, 5);
assert.equal(filled.occupancy.filter(Boolean).length, 25, 'projected surface must occupy the whole square');

const rows = [
  '.##...##.',
  '.##...##.',
  '.##...##.',
  '.##...##.',
  '.##...##.',
  '..#####..',
  '...###...',
];
const profile = {
  columns: 9,
  rows: 7,
  occupancy: rows.flatMap(row => [...row].map(char => char === '#')),
  bounds: { min: [-1, -1], max: [1, 1] },
};
const proxy = buildArchStructuralProxy(profile, { layers: 3 });
assert.equal(proxy.layers, 3);
assert.ok(proxy.nodes.some(node => node.pinned && node.x < 0));
assert.ok(proxy.nodes.some(node => node.pinned && node.x > 0));
assert.ok(proxy.nodes.every(node => profile.occupancy[node.row * 9 + node.column]));
assert.ok(proxy.bonds.every(bond => proxy.nodes[bond.a] && proxy.nodes[bond.b]));

const solved = solveArchStructuralProxy(proxy, { x: 0, y: 1, travel: 0.15, iterations: 240 });
assert.ok(solved.maxStrain > 0);
assert.ok(solved.maxStrain < 2, 'bounded displacement cannot create runaway strain');
assert.ok(Math.max(...solved.nodes.map(node => Math.hypot(...Object.values(node.displacement)))) < 0.2);
assert.ok(solved.nodes.some(node => !node.pinned && Math.abs(node.displacement.y) > 0.001));
assert.ok(solved.nodes.filter(node => node.pinned).every(node => node.displacement.y === 0));
const cracked = fractureArchStructuralProxy(solved, { threshold: 0.01 });
assert.ok(cracked.events.length > 0);
assert.ok(cracked.bonds.some(bond => !bond.alive));
assert.ok(cracked.connectivityEpoch > solved.connectivityEpoch);
const rebound = bindArchStructuralProxy(cracked, { bondIds: cracked.events.map(event => event.bondId) });
assert.equal(rebound.bonds.filter(bond => !bond.alive).length, 0);
assert.ok(rebound.connectivityEpoch > cracked.connectivityEpoch);

console.log('structural arch contracts passed');
