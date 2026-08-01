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
  requested: 'exact-elbow-constitutive-coupling-orbitable-v1',
  effective: 'exact-elbow-constitutive-coupling-orbitable-v1',
  fallbackUsed: false,
});
assert.deepEqual(
  generated.report.cases.map(item => item.id),
  ['baseline', 'growth-inflation', 'fixed-skin-reshape', 'isovolumetric-reshape'],
);
assert.equal(generated.report.comparisons.growth.muscleCellDeficit, 268);
assert.equal(generated.report.comparisons.growth.addedActiveCellCount, 268);
assert.equal(generated.report.comparisons.growth.addedSourceCellCount, 268);
assert.equal(generated.report.comparisons.growth.residualCellDelta, 0);
assert.equal(generated.report.comparisons.growth.tricepsCellDelta, 0);
assert.equal(generated.report.comparisons.growth.displacedVolumeError, 0);
assert.ok(generated.report.comparisons.growth.localSurfaceDisplacement > 0.04);
assert.equal(generated.report.comparisons.growth.remoteSurfaceDisplacement, 0);
assert.equal(generated.report.comparisons.isovolumetric.activeCellDelta, 0);
assert.equal(generated.report.comparisons.isovolumetric.brachialisCellDelta, 0);
assert.equal(generated.report.comparisons.isovolumetric.exteriorVolumeDelta, 0);
assert.equal(generated.report.comparisons.isovolumetric.muscleVolumeDelta, 0);
assert.equal(
  generated.report.comparisons.isovolumetric.addedSourceCellCount,
  generated.report.comparisons.isovolumetric.lostSourceCellCount,
);
assert.ok(generated.report.comparisons.isovolumetric.outwardSurfaceDisplacement > 0.025);
assert.ok(generated.report.comparisons.isovolumetric.compensatingSurfaceDisplacement < -0.01);
assert.equal(generated.report.visualInspection.status, 'pending-agent-inspection');

const outputRoot = '/private/tmp/kaminos-molten-reciprocal-packing-0730/virtual-exact-elbow-envelope-coupling';
const validCapture = {
  routeAttribute:'exact-elbow-constitutive-coupling-orbitable-v1',
  settleMilliseconds:5000,
  agentPixelInspection:true,
};
const validBackend = {
  requested:'google-chrome-headless-webgl',
  effective:'google-chrome-headless-webgl',
  fallbackUsed:false,
};
for (const path of [
  'source.json',
  'baseline.json',
  'growth-inflation.json',
  'growth-pressure-ledger.json',
  'fixed-skin-reshape.json',
  'isovolumetric-reshape.json',
  'isovolumetric-ledger.json',
  'index.html',
  'report.json',
]) {
  assert.ok(success.files.has(`${outputRoot}/${path}`), `witness writes ${path}`);
}
const html = String(success.files.get(`${outputRoot}/index.html`));
assert.match(html, /Actual skin response/);
assert.match(html, /Baseline skin ghost/);
assert.match(html, /surfaceLobes/);
assert.match(html, /Add volume/);
assert.match(html, /Conserve volume/);
assert.match(html, /Net exterior cells/);
assert.match(html, /data-case="3"/);

success.files.set(`${outputRoot}/witness-baseline-desktop.png`, Buffer.from('baseline-frame'));
success.files.set(`${outputRoot}/witness-growth-desktop.png`, Buffer.from('growth-frame'));
success.files.set(`${outputRoot}/witness-fixed-reshape-desktop.png`, Buffer.from('fixed-reshape-frame'));
success.files.set(`${outputRoot}/witness-isovolumetric-desktop.png`, Buffer.from('isovolumetric-frame'));
success.files.set(`${outputRoot}/witness-isovolumetric-mobile.png`, Buffer.from('mobile-frame'));
const admitted = await packingWitness.admitExactElbowEnvelopeCouplingVisualInspection({
  outDir: 'virtual-exact-elbow-envelope-coupling',
  inspection: {
    observedAt: '2026-07-31T23:45:00Z',
    capture:validCapture,
    backend:validBackend,
    images: [
      { path:'witness-baseline-desktop.png', viewport:[1400, 900], case:'baseline' },
      { path:'witness-growth-desktop.png', viewport:[1400, 900], case:'growth-inflation' },
      { path:'witness-fixed-reshape-desktop.png', viewport:[1400, 900], case:'fixed-skin-reshape' },
      { path:'witness-isovolumetric-desktop.png', viewport:[1400, 900], case:'isovolumetric-reshape' },
      { path:'witness-isovolumetric-mobile.png', viewport:[390, 844], case:'isovolumetric-reshape' },
    ],
    verdict: {
      nonblank:true,
      orbitable:true,
      skinSurfaceLegible:true,
      growthInflationLegible:true,
      fixedSkinReshapeLegible:true,
      conservedRedistributionLegible:true,
      compensationRegionLegible:true,
      exactCountsLegible:true,
      baselineGhostLegible:true,
      rigidAndMuscleContextLegible:true,
      desktopTextContained:true,
      mobileTextContained:true,
    },
  },
  io: success.io,
});
assert.equal(admitted.report.visualInspection.status, 'passed-agent-inspection');
assert.equal(admitted.receipt.route.effective, 'exact-elbow-constitutive-coupling-orbitable-v1');
assert.equal(admitted.receipt.images.length, 5);
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
  growthInflationLegible:true,
  fixedSkinReshapeLegible:true,
  conservedRedistributionLegible:true,
  compensationRegionLegible:true,
  exactCountsLegible:true,
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
      capture:validCapture,
      backend:validBackend,
      images:[{ path:'baseline.png', viewport:[1400, 900], case:'baseline' }],
      verdict:completeVerdict,
    },
    io:dishonestAdmission.io,
  }),
  /required visual capture coverage/,
  'visual admission rejects a baseline-only false pass',
);

for (const path of ['growth.png', 'fixed.png', 'coupled.png', 'compact.png']) {
  dishonestAdmission.files.set(`${dishonestRoot}/${path}`, Buffer.from('duplicated-frame'));
}
await assert.rejects(
  () => packingWitness.admitExactElbowEnvelopeCouplingVisualInspection({
    outDir: 'virtual-dishonest-envelope-coupling',
    inspection: {
      observedAt:'2026-07-31T23:47:00Z',
      capture:validCapture,
      backend:validBackend,
      images:[
        { path:'baseline.png', viewport:[1400, 900], case:'baseline' },
        { path:'growth.png', viewport:[1400, 900], case:'growth-inflation' },
        { path:'fixed.png', viewport:[1400, 900], case:'fixed-skin-reshape' },
        { path:'coupled.png', viewport:[1400, 900], case:'isovolumetric-reshape' },
        { path:'compact.png', viewport:[500, 844], case:'isovolumetric-reshape' },
      ],
      verdict:completeVerdict,
    },
    io:dishonestAdmission.io,
  }),
  /distinct image content/,
  'visual admission rejects duplicated evidence under different filenames',
);

dishonestAdmission.files.set(`${dishonestRoot}/growth.png`, Buffer.from('growth'));
dishonestAdmission.files.set(`${dishonestRoot}/fixed.png`, Buffer.from('fixed'));
dishonestAdmission.files.set(`${dishonestRoot}/coupled.png`, Buffer.from('coupled'));
dishonestAdmission.files.set(`${dishonestRoot}/compact.png`, Buffer.from('compact'));
await assert.rejects(
  () => packingWitness.admitExactElbowEnvelopeCouplingVisualInspection({
    outDir: 'virtual-dishonest-envelope-coupling',
    inspection: {
      observedAt:'2026-07-31T23:48:00Z',
      capture:validCapture,
      backend:validBackend,
      images:[
        { path:'baseline.png', viewport:[1400, 900], case:'baseline' },
        { path:'growth.png', viewport:[1400, 900], case:'growth-inflation' },
        { path:'fixed.png', viewport:[1400, 900], case:'fixed-skin-reshape' },
        { path:'coupled.png', viewport:[1400, 900], case:'isovolumetric-reshape' },
        { path:'compact.png', viewport:[1400, 900], case:'isovolumetric-reshape' },
      ],
      verdict:completeVerdict,
    },
    io:dishonestAdmission.io,
  }),
  /required visual capture coverage/,
  'visual admission rejects a coupled state with no compact-layout evidence',
);

const incompleteVerdict = { ...completeVerdict };
delete incompleteVerdict.conservedRedistributionLegible;
await assert.rejects(
  () => packingWitness.admitExactElbowEnvelopeCouplingVisualInspection({
    outDir: 'virtual-dishonest-envelope-coupling',
    inspection: {
      observedAt:'2026-07-31T23:49:00Z',
      capture:validCapture,
      backend:validBackend,
      images:[
        { path:'baseline.png', viewport:[1400, 900], case:'baseline' },
        { path:'growth.png', viewport:[1400, 900], case:'growth-inflation' },
        { path:'fixed.png', viewport:[1400, 900], case:'fixed-skin-reshape' },
        { path:'coupled.png', viewport:[1400, 900], case:'isovolumetric-reshape' },
        { path:'compact.png', viewport:[500, 844], case:'isovolumetric-reshape' },
      ],
      verdict:incompleteVerdict,
    },
    io:dishonestAdmission.io,
  }),
  /complete all-positive inspected verdict/,
  'visual admission rejects an omitted load-bearing verdict',
);

async function routeBypassFixture() {
  const fixture = memoryIo();
  const root = '/private/tmp/kaminos-molten-reciprocal-packing-0730/virtual-route-bypass-envelope-coupling';
  for (const [path, body] of dishonestAdmission.files) {
    if (path.startsWith(`${dishonestRoot}/`)) {
      fixture.files.set(path.replace(dishonestRoot, root), body);
    }
  }
  const images = [
    { path:'baseline.png', viewport:[1400, 900], case:'baseline' },
    { path:'growth.png', viewport:[1400, 900], case:'growth-inflation' },
    { path:'fixed.png', viewport:[1400, 900], case:'fixed-skin-reshape' },
    { path:'coupled.png', viewport:[1400, 900], case:'isovolumetric-reshape' },
    { path:'compact.png', viewport:[500, 844], case:'isovolumetric-reshape' },
  ];
  for (const [index, image] of images.entries()) {
    fixture.files.set(`${root}/${image.path}`, Buffer.from(`route-frame-${index}`));
  }
  return { fixture, images };
}

{
  const { fixture, images } = await routeBypassFixture();
  await assert.rejects(
    () => packingWitness.admitExactElbowEnvelopeCouplingVisualInspection({
      outDir:'virtual-route-bypass-envelope-coupling',
      inspection: {
        observedAt:'2026-08-01T01:45:00Z',
        backend:validBackend,
        images,
        verdict:completeVerdict,
      },
      io:fixture.io,
    }),
    /capture route identity/,
    'visual admission rejects missing capture route identity',
  );
}

{
  const { fixture, images } = await routeBypassFixture();
  await assert.rejects(
    () => packingWitness.admitExactElbowEnvelopeCouplingVisualInspection({
      outDir:'virtual-route-bypass-envelope-coupling',
      inspection: {
        observedAt:'2026-08-01T01:46:00Z',
        capture:{ ...validCapture, routeAttribute:'stale-witness-route-v0' },
        backend:validBackend,
        images,
        verdict:completeVerdict,
      },
      io:fixture.io,
    }),
    /capture route identity/,
    'visual admission rejects a stale capture route attribute',
  );
}

{
  const { fixture, images } = await routeBypassFixture();
  await assert.rejects(
    () => packingWitness.admitExactElbowEnvelopeCouplingVisualInspection({
      outDir:'virtual-route-bypass-envelope-coupling',
      inspection: {
        observedAt:'2026-08-01T01:47:00Z',
        capture:validCapture,
        backend:{ ...validBackend, effective:'fallback-canvas', fallbackUsed:true },
        images,
        verdict:completeVerdict,
      },
      io:fixture.io,
    }),
    /effective backend identity/,
    'visual admission rejects a fallback or mismatched effective backend',
  );
}

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
