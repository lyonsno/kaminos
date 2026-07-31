import assert from 'node:assert/strict';

import * as packingWitness from '../constructional-packing-witness.mjs';
import * as packingCore from '../constructional-packing-core.mjs';

assert.equal(
  typeof packingWitness.writeExactElbowPackingWitness,
  'function',
  'exact-elbow 3D packing witness contract requires writeExactElbowPackingWitness',
);
assert.equal(
  typeof packingWitness.admitExactElbowPackingVisualInspection,
  'function',
  'exact-elbow 3D packing witness requires a hash-bound visual admission phase',
);
assert.equal(
  typeof packingCore.createExactElbowPackingSource,
  'function',
  'exact-elbow 3D packing witness requires the source constructor',
);

function memoryIo() {
  const files = new Map();
  return {
    files,
    io: {
      async mkdir() {},
      async writeFile(path, body) { files.set(path, body); },
      async readFile(path) {
        assert.ok(files.has(path), `visual admission input exists: ${path}`);
        return files.get(path);
      },
      async rename(from, to) {
        assert.ok(files.has(from), `temporary witness artifact exists before rename: ${from}`);
        files.set(to, files.get(from));
        files.delete(from);
      },
    },
  };
}

const success = memoryIo();
const result = await packingWitness.writeExactElbowPackingWitness({
  outDir: 'virtual-exact-elbow-packing',
  io: success.io,
});
assert.equal(result.report.status, 'complete');
assert.deepEqual(result.report.route, {
  requested: 'exact-elbow-packing-orbitable-v0',
  effective: 'exact-elbow-packing-orbitable-v0',
  fallbackUsed: false,
});
assert.equal(result.report.claims.threeDimensionalPacking, 'supported-by-numerical-contract');
assert.equal(result.report.claims.anatomicalCorrectness, 'unassayed');
assert.ok(success.files.has('/private/tmp/kaminos-molten-reciprocal-packing-0730/virtual-exact-elbow-packing/index.html'));
assert.ok(success.files.has('/private/tmp/kaminos-molten-reciprocal-packing-0730/virtual-exact-elbow-packing/report.json'));
assert.ok(success.files.has('/private/tmp/kaminos-molten-reciprocal-packing-0730/virtual-exact-elbow-packing/baseline.json'));
assert.ok(success.files.has('/private/tmp/kaminos-molten-reciprocal-packing-0730/virtual-exact-elbow-packing/brachialis-swell.json'));
assert.equal(result.report.visualInspection.status, 'pending-agent-inspection');

const outputRoot = '/private/tmp/kaminos-molten-reciprocal-packing-0730/virtual-exact-elbow-packing';
success.files.set(`${outputRoot}/witness-baseline-desktop.png`, Buffer.from('baseline-frame'));
success.files.set(`${outputRoot}/witness-swell-desktop.png`, Buffer.from('swell-frame'));
success.files.set(`${outputRoot}/witness-swell-mobile.png`, Buffer.from('mobile-frame'));
const admission = await packingWitness.admitExactElbowPackingVisualInspection({
  outDir: 'virtual-exact-elbow-packing',
  inspection: {
    observedAt: '2026-07-31T19:30:35Z',
    images: [
      { path:'witness-baseline-desktop.png', viewport:[1400, 900], case:'baseline' },
      { path:'witness-swell-desktop.png', viewport:[1400, 900], case:'brachialis-swell' },
      { path:'witness-swell-mobile.png', viewport:[390, 844], case:'brachialis-swell' },
    ],
    verdict: {
      nonblank:true,
      orbitable:true,
      rigidExclusionsLegible:true,
      muscleTerritoriesLegible:true,
      changedOwnershipLegible:true,
      desktopTextContained:true,
      mobileTextContained:true,
    },
  },
  io: success.io,
});
assert.equal(admission.report.visualInspection.status, 'passed-agent-inspection');
assert.equal(admission.receipt.route.effective, 'exact-elbow-packing-orbitable-v0');
assert.match(admission.receipt.bindings.indexHtmlSha256, /^[a-f0-9]{64}$/);
assert.match(admission.receipt.bindings.pendingReportSha256, /^[a-f0-9]{64}$/);
assert.equal(admission.receipt.images.length, 3);
assert.ok(admission.receipt.images.every(image => /^[a-f0-9]{64}$/.test(image.sha256)));
assert.ok(success.files.has(`${outputRoot}/visual-inspection.json`));
const admittedReport = JSON.parse(success.files.get(`${outputRoot}/report.json`));
assert.equal(admittedReport.visualInspection.receipt, 'visual-inspection.json');
assert.equal(
  admittedReport.visualInspection.indexHtmlSha256,
  admission.receipt.bindings.indexHtmlSha256,
);

const failure = memoryIo();
const invalidSource = packingCore.createExactElbowPackingSource();
invalidSource.grid.width = 0;
await assert.rejects(
  () => packingWitness.writeExactElbowPackingWitness({
    outDir: 'virtual-invalid-exact-elbow-packing',
    source: invalidSource,
    io: failure.io,
  }),
  /grid dimensions/,
);
const failureReportPath = '/private/tmp/kaminos-molten-reciprocal-packing-0730/virtual-invalid-exact-elbow-packing/report.json';
assert.ok(failure.files.has(failureReportPath));
const failureReport = JSON.parse(failure.files.get(failureReportPath));
assert.equal(failureReport.status, 'failed');
assert.equal(failureReport.failurePhase, 'solve-baseline');
assert.equal(failureReport.route.effective, null);
assert.equal(failureReport.lastTrustworthyEvidence.phase, 'source-received');

console.log('analytical elbow 3D packing witness contracts passed');
