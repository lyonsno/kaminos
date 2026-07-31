import assert from 'node:assert/strict';

import * as packingWitness from '../constructional-packing-witness.mjs';
import * as packingCore from '../constructional-packing-core.mjs';

assert.equal(
  typeof packingWitness.writeExactElbowEnvelopeCouplingWitness,
  'function',
  'exact-elbow envelope coupling witness requires writeExactElbowEnvelopeCouplingWitness',
);
assert.equal(
  typeof packingWitness.admitExactElbowEnvelopeCouplingVisualInspection,
  'function',
  'exact-elbow envelope coupling witness requires hash-bound visual admission',
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
const generated = await packingWitness.writeExactElbowEnvelopeCouplingWitness({
  outDir: 'virtual-exact-elbow-envelope-coupling',
  io: success.io,
});

assert.equal(generated.report.status, 'complete');
assert.deepEqual(generated.report.route, {
  requested: 'exact-elbow-envelope-coupling-orbitable-v0',
  effective: 'exact-elbow-envelope-coupling-orbitable-v0',
  fallbackUsed: false,
});
assert.deepEqual(
  generated.report.cases.map(item => item.id),
  ['baseline', 'fixed-envelope-control', 'coupled-envelope'],
);
assert.equal(generated.report.comparison.muscleCellDeficit, 268);
assert.equal(generated.report.comparison.addedActiveCellCount, 268);
assert.equal(generated.report.comparison.addedSourceCellCount, 268);
assert.equal(generated.report.comparison.residualCellDelta, 0);
assert.equal(generated.report.comparison.tricepsCellDelta, 0);
assert.equal(generated.report.comparison.displacedVolumeError, 0);
assert.ok(generated.report.comparison.localSurfaceDisplacement > 0.04);
assert.equal(generated.report.comparison.remoteSurfaceDisplacement, 0);
assert.equal(generated.report.visualInspection.status, 'pending-agent-inspection');

const outputRoot = '/private/tmp/kaminos-molten-reciprocal-packing-0730/virtual-exact-elbow-envelope-coupling';
for (const path of [
  'source.json',
  'baseline.json',
  'fixed-envelope-control.json',
  'coupled-envelope.json',
  'pressure-ledger.json',
  'index.html',
  'report.json',
]) {
  assert.ok(success.files.has(`${outputRoot}/${path}`), `witness writes ${path}`);
}
const html = String(success.files.get(`${outputRoot}/index.html`));
assert.match(html, /Actual skin response/);
assert.match(html, /Baseline skin ghost/);
assert.match(html, /surfaceLobes/);
assert.match(html, /data-case="2"/);

success.files.set(`${outputRoot}/witness-baseline-desktop.png`, Buffer.from('baseline-frame'));
success.files.set(`${outputRoot}/witness-control-desktop.png`, Buffer.from('control-frame'));
success.files.set(`${outputRoot}/witness-coupled-desktop.png`, Buffer.from('coupled-frame'));
success.files.set(`${outputRoot}/witness-coupled-mobile.png`, Buffer.from('mobile-frame'));
const admitted = await packingWitness.admitExactElbowEnvelopeCouplingVisualInspection({
  outDir: 'virtual-exact-elbow-envelope-coupling',
  inspection: {
    observedAt: '2026-07-31T23:45:00Z',
    images: [
      { path:'witness-baseline-desktop.png', viewport:[1400, 900], case:'baseline' },
      { path:'witness-control-desktop.png', viewport:[1400, 900], case:'fixed-envelope-control' },
      { path:'witness-coupled-desktop.png', viewport:[1400, 900], case:'coupled-envelope' },
      { path:'witness-coupled-mobile.png', viewport:[390, 844], case:'coupled-envelope' },
    ],
    verdict: {
      nonblank:true,
      orbitable:true,
      skinSurfaceLegible:true,
      fixedEnvelopeControlLegible:true,
      coupledBulgeLegible:true,
      baselineGhostLegible:true,
      rigidAndMuscleContextLegible:true,
      desktopTextContained:true,
      mobileTextContained:true,
    },
  },
  io: success.io,
});
assert.equal(admitted.report.visualInspection.status, 'passed-agent-inspection');
assert.equal(admitted.receipt.route.effective, 'exact-elbow-envelope-coupling-orbitable-v0');
assert.equal(admitted.receipt.images.length, 4);
assert.ok(admitted.receipt.images.every(image => /^[a-f0-9]{64}$/.test(image.sha256)));

const dishonestAdmission = memoryIo();
await packingWitness.writeExactElbowEnvelopeCouplingWitness({
  outDir: 'virtual-dishonest-envelope-coupling',
  io: dishonestAdmission.io,
});
const dishonestRoot = '/private/tmp/kaminos-molten-reciprocal-packing-0730/virtual-dishonest-envelope-coupling';
const completeVerdict = {
  nonblank:true,
  orbitable:true,
  skinSurfaceLegible:true,
  fixedEnvelopeControlLegible:true,
  coupledBulgeLegible:true,
  baselineGhostLegible:true,
  rigidAndMuscleContextLegible:true,
  desktopTextContained:true,
  mobileTextContained:true,
};
dishonestAdmission.files.set(`${dishonestRoot}/baseline.png`, Buffer.from('baseline'));
await assert.rejects(
  () => packingWitness.admitExactElbowEnvelopeCouplingVisualInspection({
    outDir: 'virtual-dishonest-envelope-coupling',
    inspection: {
      observedAt:'2026-07-31T23:46:00Z',
      images:[{ path:'baseline.png', viewport:[1400, 900], case:'baseline' }],
      verdict:completeVerdict,
    },
    io:dishonestAdmission.io,
  }),
  /required visual capture coverage/,
  'visual admission rejects a baseline-only false pass',
);

for (const path of ['control.png', 'coupled.png', 'compact.png']) {
  dishonestAdmission.files.set(`${dishonestRoot}/${path}`, Buffer.from('duplicated-frame'));
}
await assert.rejects(
  () => packingWitness.admitExactElbowEnvelopeCouplingVisualInspection({
    outDir: 'virtual-dishonest-envelope-coupling',
    inspection: {
      observedAt:'2026-07-31T23:47:00Z',
      images:[
        { path:'baseline.png', viewport:[1400, 900], case:'baseline' },
        { path:'control.png', viewport:[1400, 900], case:'fixed-envelope-control' },
        { path:'coupled.png', viewport:[1400, 900], case:'coupled-envelope' },
        { path:'compact.png', viewport:[500, 844], case:'coupled-envelope' },
      ],
      verdict:completeVerdict,
    },
    io:dishonestAdmission.io,
  }),
  /distinct image content/,
  'visual admission rejects duplicated evidence under different filenames',
);

dishonestAdmission.files.set(`${dishonestRoot}/control.png`, Buffer.from('control'));
dishonestAdmission.files.set(`${dishonestRoot}/coupled.png`, Buffer.from('coupled'));
dishonestAdmission.files.set(`${dishonestRoot}/compact.png`, Buffer.from('compact'));
await assert.rejects(
  () => packingWitness.admitExactElbowEnvelopeCouplingVisualInspection({
    outDir: 'virtual-dishonest-envelope-coupling',
    inspection: {
      observedAt:'2026-07-31T23:48:00Z',
      images:[
        { path:'baseline.png', viewport:[1400, 900], case:'baseline' },
        { path:'control.png', viewport:[1400, 900], case:'fixed-envelope-control' },
        { path:'coupled.png', viewport:[1400, 900], case:'coupled-envelope' },
        { path:'compact.png', viewport:[1400, 900], case:'coupled-envelope' },
      ],
      verdict:completeVerdict,
    },
    io:dishonestAdmission.io,
  }),
  /required visual capture coverage/,
  'visual admission rejects a coupled state with no compact-layout evidence',
);

const incompleteVerdict = { ...completeVerdict };
delete incompleteVerdict.coupledBulgeLegible;
await assert.rejects(
  () => packingWitness.admitExactElbowEnvelopeCouplingVisualInspection({
    outDir: 'virtual-dishonest-envelope-coupling',
    inspection: {
      observedAt:'2026-07-31T23:49:00Z',
      images:[
        { path:'baseline.png', viewport:[1400, 900], case:'baseline' },
        { path:'control.png', viewport:[1400, 900], case:'fixed-envelope-control' },
        { path:'coupled.png', viewport:[1400, 900], case:'coupled-envelope' },
        { path:'compact.png', viewport:[500, 844], case:'coupled-envelope' },
      ],
      verdict:incompleteVerdict,
    },
    io:dishonestAdmission.io,
  }),
  /complete all-positive inspected verdict/,
  'visual admission rejects an omitted load-bearing verdict',
);

const failure = memoryIo();
const invalidSource = packingCore.createExactElbowPackingSource();
invalidSource.grid.width = 0;
await assert.rejects(
  () => packingWitness.writeExactElbowEnvelopeCouplingWitness({
    outDir: 'virtual-invalid-envelope-coupling',
    source: invalidSource,
    io: failure.io,
  }),
  /grid dimensions/,
);
const failureReportPath = '/private/tmp/kaminos-molten-reciprocal-packing-0730/virtual-invalid-envelope-coupling/report.json';
assert.ok(failure.files.has(failureReportPath));
const failureReport = JSON.parse(failure.files.get(failureReportPath));
assert.equal(failureReport.status, 'failed');
assert.equal(failureReport.failurePhase, 'prepare-coupling-source');
assert.equal(failureReport.route.effective, null);

console.log('analytical elbow envelope coupling witness contracts passed');
