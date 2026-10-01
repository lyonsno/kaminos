import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildArchStructuralProxy, advanceArchStructuralForce } from '../structural-material-arch-core.js';
import { buildArchVolumeFrame } from '../structural-material-arch-volume-view.js';
import * as evidence from '../structural-material-arch-volume-evidence.mjs';

const profile = JSON.parse(fs.readFileSync(new URL('../artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/intact-profile.json', import.meta.url)));
const volume = buildArchStructuralProxy(profile, { construction: 'cell-volume-braced' });
assert.equal(volume.construction?.kind, 'cell-volume-braced', 'the requested volume construction must not silently use the sparse baseline');
const dx = (profile.bounds.max[0] - profile.bounds.min[0]) / profile.columns;
const dy = (profile.bounds.max[1] - profile.bounds.min[1]) / profile.rows;
const h = Math.sqrt(dx * dy);
assert.equal(volume.layers, Math.ceil(volume.depth / (2 * Math.min(dx, dy))) + 1);
const dz = volume.depth / (volume.layers - 1);
const perLayer = volume.nodes.length / volume.layers;
assert.ok(Math.abs(volume.nodes.reduce((sum, node) => sum + node.materialVolume, 0) - perLayer * dx * dy * volume.depth) < 1e-12);
assert.ok(volume.bonds.some(bond => bond.kind === 'depth-diagonal'));
for (const bond of volume.bonds) {
  const a = volume.nodes[bond.a], b = volume.nodes[bond.b];
  const weight = [a.column !== b.column, a.row !== b.row, a.layer !== b.layer].filter(Boolean).length === 1 ? 1 : 0.5;
  const expected = (a.materialVolume + b.materialVolume) / (2 * h * h * bond.rest) * weight;
  assert.ok(Math.abs(bond.stiffness - expected) < 1e-12, 'bond energy follows dual volume divided by squared length');
  assert.ok(Math.abs(a.layer - b.layer) <= 1);
}
const front = volume.nodes.find(node => node.layer === volume.layers - 1 && !node.pinned);
assert.ok(Math.abs(front.materialVolume - dx * dy * dz / 2) < 1e-15, 'boundary layers carry half a depth control volume');
const free = { ...volume, bonds: [] };
const loaded = advanceArchStructuralForce(free, { x: front.x, y: front.y, force: 0.2,
  contactDepthMode: 'camera-facing-surface', contactLayer: front.layer }, { timeStep: 0.1, damping: 8 });
const moved = loaded.nodes.find(node => node.id === front.id);
assert.ok(Math.abs(moved.displacement.y + 0.2 * 0.1 / (8 * front.materialVolume / h ** 3)) < 1e-12,
  'finite force damping scales with represented material volume, not node count');
assert.deepEqual(loaded.load.loadedNodeLayers, [front.layer]);
assert.ok(loaded.nodes.filter(node => node.layer !== front.layer).every(node => node.displacement.y === 0), 'front-only force must not load deeper disconnected nodes');
assert.throws(() => buildArchStructuralProxy(profile, { construction: 'unknown' }), /construction/);
assert.throws(() => buildArchStructuralProxy(profile, { construction: 'cell-volume-braced', depthCellAspect: 0 }), /aspect/);
const sparse = buildArchStructuralProxy(profile, { layers: 3 });
assert.equal(sparse.layers, 3);
assert.equal(sparse.bonds.filter(bond => bond.kind === 'depth-diagonal').length, 0);

const damage = { layers: 3, nodes: [
  { x: 0, y: 0, z: 0.18, layer: 2, displacement: { x: 0, y: -0.3, z: 0.1 } },
  { x: 0.1, y: 0, z: 0.18, layer: 2, displacement: { x: 0, y: 0, z: 0 } },
], bonds: [{ a: 0, b: 1, rest: 0.1, direction: [1, 0, 0], alive: false, lastStrain: 0.8 }] };
const frame = buildArchVolumeFrame(damage);
assert.equal(frame.brokenSegments.length, 2, 'each end has a local fracture-history mark; no severed bridge is drawn');
assert.ok(frame.nodes.every(node => node.strain === 0), 'dead bond strain must not pretend to be current carried stress');
for (const segment of frame.brokenSegments) {
  assert.ok(Math.hypot(segment[3] - segment[0], segment[4] - segment[1], segment[5] - segment[2]) <= 0.025 + 1e-12);
}
assert.equal(frame.brokenSegments[0][2], 0.28, 'history mark follows the displaced end in depth');
assert.equal(frame.brokenSegments[1][2], 0.18);
assert.equal(typeof evidence.findArchVolumeConstructionContradictions, 'function', 'evidence must reject requested braced geometry silently served as sparse');
const observed = { intact: { construction: { kind: 'cell-volume-braced' }, layers: 10,
  depthDiagonalBonds: 100, totalMaterialVolume: 1, loadedNodeLayers: [9],
  broken: 5, renderedHistoryMarks: 4, maxHistoryMarkLength: 0.004, historyMarkBound: 0.006 } };
assert.deepEqual(evidence.findArchVolumeConstructionContradictions('cell-volume-braced', observed), []);
for (const corrupt of [
  {},
  { intact: { ...observed.intact, construction: { kind: 'sparse-depth' } } },
  { intact: { ...observed.intact, depthDiagonalBonds: 0 } },
  { intact: { ...observed.intact, totalMaterialVolume: null } },
  { intact: { ...observed.intact, loadedNodeLayers: [0, 9] } },
  { intact: { ...observed.intact, renderedHistoryMarks: 0 } },
  { intact: { ...observed.intact, maxHistoryMarkLength: 0.3 } },
]) assert.ok(evidence.findArchVolumeConstructionContradictions('cell-volume-braced', corrupt).length > 0);
console.log('arch volume construction contracts passed');
