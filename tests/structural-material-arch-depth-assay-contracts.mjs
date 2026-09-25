import assert from 'node:assert/strict';
import { runArchDepthAssay } from '../structural-material-arch-depth-assay.mjs';

const glbPath = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb';
const report = runArchDepthAssay(glbPath);

assert.equal(report.status, 'passed');
assert.equal(report.route.effective, 'local Node.js CPU / shear-regularized linear-spring PCG');
assert.equal(report.route.fallback, false);
assert.equal(report.source.sha256, 'c65a3cf3dc3b5a053a9a5f25c1f652d7ccd94c13236077220ce42400b765cad5');
assert.equal(report.source.sameSource, true);
assert.deepEqual(report.source.controlledNotchProfile.controlledNotch.removedCells,
  [1301, 1302, 1303, 1350, 1351, 1399]);

for (const depthMode of ['uniform', 'surface-envelope']) {
  const intact = report.proxy.cases.intact[depthMode];
  const notched = report.proxy.cases['controlled-notch'][depthMode];
  assert.equal(intact.componentsAtRest, 1);
  assert.equal(notched.componentsAtRest, 1);
  assert.equal(intact.nodes - notched.nodes, 18);
  for (const runs of [intact.runs, notched.runs]) {
    assert.deepEqual(runs.map(run => run.history[0]?.requestedForce ?? run.force), [0.25, 0.5, 0.75, 2]);
    for (const run of runs) {
      assert.ok(['stable', 'load-path-separated'].includes(run.status));
      assert.ok(run.history.length >= 1);
      for (const [index, epoch] of run.history.entries()) {
        assert.deepEqual(epoch.contact, { column: 21, row: 31 });
        assert.ok(epoch.solve.relativeResidual <= 1e-6);
        assert.equal(epoch.fracture.maxPinnedDisplacement, 0);
        if (index > 0) {
          assert.equal(epoch.liveBondsAtStart,
            (runs === intact.runs ? intact.bonds : notched.bonds) - run.history[index - 1].fracture.totalBrokenBonds);
        }
      }
      if (run.status === 'load-path-separated') {
        assert.equal(run.terminal.reason, 'loaded-contact-component-has-no-pinned-support');
        assert.match(run.postBreakReequilibration, /stopped|same-force/);
      }
    }
  }
}

const depthNotch = report.proxy.cases['controlled-notch']['surface-envelope'].runs;
const depthIntact = report.proxy.cases.intact['surface-envelope'].runs;
assert.equal(depthNotch[0].totalBrokenBonds, 0);
assert.equal(depthNotch[1].totalBrokenBonds, 0);
assert.equal(depthNotch[2].status, 'load-path-separated');
assert.equal(depthNotch[2].totalBrokenBonds, 24);
assert.equal(depthIntact[2].totalBrokenBonds, 24);
assert.equal(depthNotch[2].history.length, 2);
assert.equal(depthIntact[2].history.length, 2);
assert.equal(depthNotch[3].totalBrokenBonds, 343);
assert.equal(depthIntact[3].totalBrokenBonds, 333);
assert.equal(depthNotch[3].history.reduce((sum, epoch) => sum + epoch.fracture.notchZone.newCrackEvents, 0), 5);
assert.equal(depthIntact[3].history.reduce((sum, epoch) => sum + epoch.fracture.notchZone.newCrackEvents, 0), 0);

console.log('structural arch depth assay contracts passed');
