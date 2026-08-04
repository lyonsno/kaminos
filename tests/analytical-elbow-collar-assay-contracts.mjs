import assert from 'node:assert/strict';

import {
  COLLAR_ASSAY_SCHEMA,
  runShapeBearingCollarAssay,
} from '../analytical-elbow-collar-assay-core.mjs';
import {
  createAnalyticalElbowConsumerExport,
  createAnalyticalElbowDescriptor,
} from '../analytical-elbow-core.mjs';

const source = createAnalyticalElbowConsumerExport(
  createAnalyticalElbowDescriptor(),
  { flexionDegrees: [0, 35, 80] },
);

const report = runShapeBearingCollarAssay({
  source,
  collarHalfWidths: [0, 0.24, 0.48, 0.72],
});

assert.equal(report.schema, COLLAR_ASSAY_SCHEMA);
assert.equal(report.status, 'complete');
assert.equal(report.requestedRoute, 'analytical-elbow-graded-collar');
assert.equal(report.effectiveRoute, report.requestedRoute);
assert.equal(report.source.id, 'synthetic-mammalian-elbow-v0');
assert.equal(report.source.effectiveRoute, 'analytical-cage');
assert.equal(report.source.fallbackUsed, false);
assert.deepEqual(report.poseDegrees, [0, 35, 80]);
assert.deepEqual(report.collarHalfWidths, [0, 0.24, 0.48, 0.72]);
assert.equal(report.rows.length, 12);
assert.equal(report.thresholds.minimumRigidZoneSampleCount, 25);

for (const row of report.rows) {
  assert.ok(Number.isFinite(row.metrics.maximumAbsoluteLogEdgeStrain));
  assert.ok(Number.isFinite(row.metrics.maximumAbsoluteLogAreaStrain));
  assert.ok(Number.isFinite(row.metrics.relativeVolumeDrift));
  assert.ok(Number.isFinite(row.metrics.maximumParentRigidError));
  assert.ok(Number.isFinite(row.metrics.maximumChildRigidError));
  assert.ok(Number.isInteger(row.metrics.parentRigidSampleCount));
  assert.ok(Number.isInteger(row.metrics.childRigidSampleCount));
  assert.equal(row.metrics.openBoundaryEdgeCount, 0);
  assert.equal(row.metrics.nonFiniteVertexCount, 0);
}

const neutralRows = report.rows.filter(row => row.flexionDegrees === 0);
for (const row of neutralRows) {
  assert.equal(row.metrics.invertedTriangleCount, 0);
  assert.ok(row.metrics.maximumAbsoluteLogEdgeStrain < 1e-12);
  assert.ok(row.metrics.relativeVolumeDrift < 1e-12);
}

const hardSplit = report.rows.find(
  row => row.flexionDegrees === 80 && row.collarHalfWidth === 0,
);
const widest = report.rows.find(
  row => row.flexionDegrees === 80 && row.collarHalfWidth === 0.72,
);
assert.ok(hardSplit.metrics.maximumAbsoluteLogEdgeStrain > 0.2);
assert.ok(
  widest.metrics.maximumAbsoluteLogEdgeStrain <
    hardSplit.metrics.maximumAbsoluteLogEdgeStrain,
  'a graded collar must reduce the hard-split edge-strain concentration',
);
assert.ok(widest.metrics.maximumParentRigidError < 1e-12);
assert.ok(widest.metrics.maximumChildRigidError < 1e-12);

assert.throws(
  () => runShapeBearingCollarAssay({ source, collarHalfWidths: [Number.NaN] }),
  /collar half-width must be finite and nonnegative/,
);

const wrongRoute = structuredClone(source);
wrongRoute.effectiveRoute = 'fallback-cage';
assert.throws(
  () => runShapeBearingCollarAssay({ source: wrongRoute, collarHalfWidths: [0.2] }),
  /requires effective analytical-cage source route/,
);

const tooWide = runShapeBearingCollarAssay({
  source,
  collarHalfWidths: [10],
});
assert.deepEqual(tooWide.survivingWidths, []);
assert.equal(tooWide.disposition, 'PROMOTE_VOLUMETRIC_OR_CORRECTIVE_CAGE');
for (const row of tooWide.rows) {
  assert.equal(row.qualifies, false);
  assert.equal(row.metrics.parentRigidSampleCount, 0);
  assert.equal(row.metrics.childRigidSampleCount, 0);
}

for (const mutate of [
  candidate => { candidate.schema = 'bogus-export-schema'; },
  candidate => { candidate.sourceSchema = 'bogus-source-schema'; },
  candidate => { candidate.requestedRoute = 'fallback-cage'; },
  candidate => { candidate.fallbackUsed = true; },
  candidate => { candidate.sourceAuthority.kind = 'unreviewed'; },
  candidate => { candidate.poses[0].schema = 'bogus-pose-schema'; },
  candidate => { candidate.poses[0].sourceSchema = 'bogus-source-schema'; },
  candidate => { candidate.poses[0].sourceAuthority = 'unreviewed'; },
]) {
  const counterfeit = structuredClone(source);
  mutate(counterfeit);
  assert.throws(
    () => runShapeBearingCollarAssay({
      source: counterfeit,
      collarHalfWidths: [0.72],
    }),
    /reviewed analytical elbow source identity/,
  );
}

console.log('analytical elbow collar assay contracts passed');
