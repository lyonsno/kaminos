import assert from 'node:assert/strict';

import {
  ANALYTICAL_ELBOW_W_TO_P0_BUNDLE_SCHEMA,
  ANALYTICAL_ELBOW_W_TO_P0_INPUT_SCHEMA,
  ANALYTICAL_ELBOW_W_TO_P0_REPORT_SCHEMA,
  createAnalyticalElbowWToP0Bundle,
  createAnalyticalElbowWToP0Input,
  evaluateAnalyticalElbowWToP0,
} from '../analytical-elbow-positive-volume-w-to-p0-core.mjs';

const input = createAnalyticalElbowWToP0Input();
assert.equal(input.schema, ANALYTICAL_ELBOW_W_TO_P0_INPUT_SCHEMA);
assert.equal(input.requestedRoute, 'analytical-elbow-positive-volume-w-to-p0');
assert.equal(input.effectiveRoute, input.requestedRoute);
assert.equal(input.fallbackUsed, false);
assert.equal(input.parameterization, 'P0');
assert.equal(input.projection.method, 'row-w-map-at-cage-nodes/fixed-rest-embedding');
assert.equal(input.projection.posedNodes.length, 63);

const report = evaluateAnalyticalElbowWToP0(input);
assert.equal(report.schema, ANALYTICAL_ELBOW_W_TO_P0_REPORT_SCHEMA);
assert.equal(report.status, 'W_P0_ADMITTED');
assert.equal(report.failurePhase, null);
assert.equal(report.primaryOutput, 'analytical-elbow-w-to-p0-v0');
assert.equal(report.predecessor.rowWStatus, 'W_VALID');
assert.match(report.identities.source, /^[0-9a-f]{64}$/);
assert.match(report.identities.topology, /^[0-9a-f]{64}$/);
assert.match(report.identities.embedding, /^[0-9a-f]{64}$/);
assert.match(report.identities.projection, /^[0-9a-f]{64}$/);
assert.ok(report.projection.maximumSurfaceProjectionError > 0);
assert.ok(report.projection.maximumRestReconstructionError <= 1e-12);
assert.ok(report.projection.maximumRigidBoundaryResidual <= 1e-12);
assert.ok(report.cellOrientation.minimumSignedVolumeRatio > 1e-6);
assert.equal(report.surface.invertedTriangleCount, 0);
assert.equal(report.surface.globalIntersectionCount, 0);
assert.equal(report.surface.transitionIntersectionCount, 0);
assert.ok(report.surface.minimumCrossSectionAreaRatio >= 0.10);
assert.ok(report.surface.totalSignedVolumeRatio >= 0.50);
assert.ok(report.surface.totalSignedVolumeRatio <= 1.50);
assert.ok(Object.values(report.hardVetoes).every(veto => veto.pass === true));

const replay = evaluateAnalyticalElbowWToP0(createAnalyticalElbowWToP0Input());
assert.deepEqual(replay, report);

const forgedProjection = createAnalyticalElbowWToP0Input();
forgedProjection.projection.posedNodes[10].position[0] += 0.01;
const forgedReport = evaluateAnalyticalElbowWToP0(forgedProjection);
assert.equal(forgedReport.status, 'W_P0_INVALID');
assert.equal(forgedReport.failurePhase, 'projection-identity-validation');
assert.equal(forgedReport.error.code, 'projection-record-invalid');
assert.equal(forgedReport.primaryOutput, null);

const invalidPredecessor = createAnalyticalElbowWToP0Input();
invalidPredecessor.rowWInput.construction.posedVertices[100].position[0] = NaN;
const invalidPredecessorReport = evaluateAnalyticalElbowWToP0(invalidPredecessor);
assert.equal(invalidPredecessorReport.status, 'W_P0_INVALID');
assert.equal(invalidPredecessorReport.failurePhase, 'predecessor-validation');
assert.equal(invalidPredecessorReport.error.code, 'row-w-predecessor-invalid');
assert.equal(invalidPredecessorReport.primaryOutput, null);

const fallback = createAnalyticalElbowWToP0Input();
fallback.effectiveRoute = 'silent-fallback';
const fallbackReport = evaluateAnalyticalElbowWToP0(fallback);
assert.equal(fallbackReport.status, 'W_P0_INVALID');
assert.equal(fallbackReport.failurePhase, 'identity-validation');
assert.equal(fallbackReport.error.code, 'admission-identity-invalid');

const bundle = createAnalyticalElbowWToP0Bundle();
assert.equal(bundle.schema, ANALYTICAL_ELBOW_W_TO_P0_BUNDLE_SCHEMA);
assert.equal(bundle.status, 'complete');
assert.equal(bundle.case, 'w-to-p0');
assert.deepEqual(bundle.report, report);

console.log('analytical elbow positive-volume W-to-P0 contracts passed');
