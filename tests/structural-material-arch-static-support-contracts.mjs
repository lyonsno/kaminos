import assert from 'node:assert/strict';
import { buildArchStructuralProxy, solveArchStructuralForce } from '../structural-material-arch-core.js';
import { buildArchProfileFromGlb } from '../structural-material-arch-profile.mjs';

const glbPath = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb';
const profile = buildArchProfileFromGlb(glbPath, 48, 36, {
  min: [-0.5, -0.39],
  max: [0.5, 0.39],
});
const state = buildArchStructuralProxy(profile, { layers: 3, depth: 0.36 });
const requested = { x: -0.05, y: 0.29 };
const candidates = state.nodes.filter(node => node.layer === Math.floor(state.layers / 2) && !node.pinned);
const contact = candidates.reduce((best, node) =>
  (node.x - requested.x) ** 2 + (node.y - requested.y) ** 2 < (best.x - requested.x) ** 2 + (best.y - requested.y) ** 2
    ? node : best);
const contactIds = new Set(state.nodes.flatMap((node, index) =>
  node.column === contact.column && node.row === contact.row ? [index] : []));
const separated = {
  ...state,
  bonds: state.bonds.map(bond => contactIds.has(bond.a) || contactIds.has(bond.b)
    ? { ...bond, alive: false }
    : bond),
};

assert.throws(() => solveArchStructuralForce(separated, { ...requested, force: 0.25 }), error =>
  error.code === 'ARCH_LOAD_PATH_SEPARATED',
'a force applied to an unsupported component must have a typed terminal reason');
assert.doesNotThrow(() => solveArchStructuralForce(separated, { ...requested, force: 0 }),
  'an unloaded disconnected state has no unsupported external force');

console.log('structural arch static support contracts passed');
