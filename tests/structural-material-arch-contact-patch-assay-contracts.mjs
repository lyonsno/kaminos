import assert from 'node:assert/strict';
import { runArchDepthAssay } from '../structural-material-arch-depth-assay.mjs';

const glbPath = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb';
const point = runArchDepthAssay(glbPath, { contactPatchRadius: 0 });
const patch = runArchDepthAssay(glbPath, { contactPatchRadius: 0.032 });

assert.equal(point.route.effective, 'local Node.js CPU / shear-regularized linear-spring PCG');
assert.equal(point.route.fallback, false);
assert.equal(point.source.sha256, patch.source.sha256);
assert.equal(point.configuration.contactPatchRadius, 0);
assert.equal(patch.configuration.contactPatchRadius, 0.032);

const surfaceRuns = report => ({
  intact: report.proxy.cases.intact['surface-envelope'].runs[3],
  notched: report.proxy.cases['controlled-notch']['surface-envelope'].runs[3],
});
const pointRuns = surfaceRuns(point);
const patchRuns = surfaceRuns(patch);

for (const [run, expectedCells, expectedNodes] of [
  [pointRuns.intact, 1, 3],
  [patchRuns.intact, 9, 27],
]) {
  assert.equal(run.history[0].contactCells.length, expectedCells);
  assert.equal(run.history[0].loadedNodeCount, expectedNodes);
  assert.ok(Math.abs(run.history[0].effectiveForce - 2) < 1e-6);
}

assert.equal(pointRuns.intact.history.length, 2);
assert.equal(pointRuns.intact.history.at(-1).fracture.loadedContactComponents
  .every(component => !component.hasPinnedSupport), true);
for (const run of [patchRuns.intact, patchRuns.notched]) {
  assert.equal(run.history.length, 4);
  for (const epoch of run.history.slice(0, 3)) {
    assert.equal(epoch.fracture.loadedContactComponents.every(component => component.hasPinnedSupport), true);
    assert.ok(Math.abs(epoch.effectiveForce - epoch.requestedForce) < 1e-6);
  }
  assert.equal(run.history.at(-1).fracture.loadedContactComponents
    .every(component => !component.hasPinnedSupport), true);
}

for (const [run, graph] of [
  [patchRuns.intact, patch.proxy.cases.intact['surface-envelope']],
  [patchRuns.notched, patch.proxy.cases['controlled-notch']['surface-envelope']],
]) {
  for (const epoch of run.history) {
    assert.equal(epoch.fracture.components.reduce((sum, component) => sum + component.componentSize, 0), graph.nodes);
    assert.equal(epoch.fracture.failedBonds.length, epoch.fracture.newBrokenBonds);
    assert.ok(epoch.fracture.failedBonds.every(event => event.bondId && event.midpoint && event.strain > 0.04));
  }
}

const intactShoulderCracks = patchRuns.intact.history.reduce((sum, epoch) =>
  sum + epoch.fracture.notchZone.newCrackEvents, 0);
const notchedShoulderCracks = patchRuns.notched.history.reduce((sum, epoch) =>
  sum + epoch.fracture.notchZone.newCrackEvents, 0);
assert.ok(notchedShoulderCracks > intactShoulderCracks,
  'the controlled shoulder removal should retain a localized crack contrast under distributed crown contact');

console.log('structural arch contact patch assay contracts passed');
