import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildArchStructuralProxy, solveArchStructuralForce } from '../structural-material-arch-core.js';
import { buildArchDamageHistory, ARCH_HISTORY_RECIPE } from '../structural-material-arch-history-consumer.mjs';

const root = resolve(import.meta.dirname, '..');
const evidenceRoot = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness';
const profile = JSON.parse(readFileSync(resolve(root, evidenceRoot, 'arch-history-surface-depth-profile.json'), 'utf8'));
const assay = JSON.parse(readFileSync(resolve(root, evidenceRoot, 'matched-history-continuous-2026-09-26.json'), 'utf8'));
const base = buildArchStructuralProxy(profile, {
  layers: 3,
  depthMode: 'surface-envelope',
  interiorMode: 'continuous',
});
const history = buildArchDamageHistory(base);

assert.deepEqual(ARCH_HISTORY_RECIPE.priorForces, [0.25, 0.5, 0.75, 1, 1.25, 1.5]);
assert.deepEqual(ARCH_HISTORY_RECIPE.contact, assay.proxy.contact && {
  x: assay.proxy.contact.x,
  y: assay.proxy.contact.y,
  patchRadius: assay.proxy.contact.patchRadius,
});
assert.equal(history.events.length, assay.priorTransition.eventCount);
assert.equal(history.events.length, 40);
assert.equal(history.state.components.length, 1);
assert.equal(history.state.bonds.filter(bond => !bond.alive).length, 40);
assert.equal(history.state.connectivityEpoch, assay.priorTransition.connectivityEpoch);

const force = assay.matchedLaterLoad.requestedForce;
const laterLoad = { ...ARCH_HISTORY_RECIPE.contact, force, ...ARCH_HISTORY_RECIPE.solverLoad };
const intact = solveArchStructuralForce(base, laterLoad);
const damaged = solveArchStructuralForce(history.state, laterLoad);
assert.deepEqual(intact.load.contactCells, damaged.load.contactCells);
assert.equal(intact.load.requestedForce, damaged.load.requestedForce);
assert.ok(Math.abs(damaged.load.travel - assay.matchedLaterLoad.damaged.contactTravel) < 1e-10);
assert.ok(Math.abs(intact.load.travel - assay.matchedLaterLoad.intact.contactTravel) < 1e-10);

const unloaded = solveArchStructuralForce(history.state, { ...laterLoad, force: 0 });
assert.equal(unloaded.bonds.filter(bond => !bond.alive).length, 40,
  'unloading must preserve the prior structural connectivity change');
assert.equal(Math.max(...unloaded.nodes.map(node => Math.hypot(node.displacement.x, node.displacement.y, node.displacement.z))), 0);
console.log('structural arch matched-history geometry-consumer contracts passed');
