import assert from 'node:assert/strict';

import {
  ANALYTICAL_ELBOW_C_P0_BUNDLE_SCHEMA,
  createAnalyticalElbowCP0Bundle,
  createAnalyticalElbowCP0Input,
  evaluateAnalyticalElbowCP0,
} from '../analytical-elbow-positive-volume-c-p0-core.mjs';
import {
  ANALYTICAL_ELBOW_P0_GEOMETRY_STATE_REPORT_SCHEMA,
  evaluateAnalyticalElbowP0GeometryState,
} from '../analytical-elbow-positive-volume-w-to-p0-core.mjs';

const input = createAnalyticalElbowCP0Input();
assert.equal(input.requestedRoute, 'analytical-elbow-positive-volume-c-p0');
assert.equal(input.effectiveRoute, input.requestedRoute);
assert.equal(input.fallbackUsed, false);
assert.equal(input.requestedConfig.parameterization, 'P0');
assert.equal(input.requestedConfig.objective,
  'rest-edge-log-strain-plus-signed-cell-volume-barrier');
assert.equal(input.requestedConfig.solver,
  'deterministic-central-difference-backtracking-v0');
assert.deepEqual(input.initializations.map(record => record.id), [
  'w-derived',
  'neutral-boundary-applied',
]);

const report = evaluateAnalyticalElbowCP0(input);
assert.equal(report.status, 'C_P0_COMPLETE');
assert.equal(report.runs.length, 2);
assert.deepEqual(report.runs.map(run => run.initialization), [
  'w-derived',
  'neutral-boundary-applied',
]);
assert.ok(report.runs.every(run => run.requestedConfigHash === report.configHash));
assert.ok(report.runs.every(run => run.effectiveConfigHash === report.configHash));
assert.ok(report.runs.every(run => run.iterationHistory.length > 1));
assert.ok(report.runs.every(run => run.iterationHistory.length <=
  input.effectiveConfig.budget + 1));
assert.ok(report.runs.every(run => run.finalGeometry !== null));
assert.ok(report.runs.every(run => Object.values(run.hardVetoes)
  .every(veto => veto.pass === true)));
assert.equal(report.runs[0].initialHardVetoes.positiveCellOrientation.pass, true);
assert.equal(report.runs[1].initialHardVetoes.positiveCellOrientation.pass, false);
assert.equal(report.runs[1].initialCellOrientation.negativeOrCollapsedCellCount, 2);
assert.ok(report.runs.every(run => run.finalObjective < run.initialObjective));
assert.equal(report.controlComparison.status, 'NUMERICAL_CANDIDATE');
assert.ok(report.controlComparison.candidateRuns.includes('w-derived'));
assert.ok(report.runs.every(run =>
  Number.isFinite(run.comparison.q95AbsoluteLogEdgeStrain)
));
assert.equal(report.primaryOutput, 'analytical-elbow-c-p0-v0');

const stateEvidence = evaluateAnalyticalElbowP0GeometryState(
  report.runs[0].finalGeometry.posedNodes,
);
assert.equal(
  stateEvidence.schema,
  ANALYTICAL_ELBOW_P0_GEOMETRY_STATE_REPORT_SCHEMA,
);
assert.equal(stateEvidence.evidenceClass, 'p0-geometry-state-evaluation');
assert.equal(stateEvidence.canonicalWToP0Admission, false);
assert.equal(stateEvidence.evaluationValid, true);
assert.equal(stateEvidence.allHardVetoesPass, true);
assert.equal('status' in stateEvidence, false);
assert.equal('primaryOutput' in stateEvidence, false);
assert.equal('requestedRoute' in stateEvidence, false);
assert.equal('effectiveRoute' in stateEvidence, false);
assert.equal('requestedConfig' in stateEvidence, false);
assert.equal('effectiveConfig' in stateEvidence, false);
assert.match(stateEvidence.claimCeiling, /not canonical W-to-P0 admission/);

const invalidStateEvidence = evaluateAnalyticalElbowP0GeometryState([
  { id: 'not-a-canonical-p0-node', position: [0, 0, 0] },
]);
assert.equal(
  invalidStateEvidence.schema,
  ANALYTICAL_ELBOW_P0_GEOMETRY_STATE_REPORT_SCHEMA,
);
assert.equal(invalidStateEvidence.evaluationValid, false);
assert.equal(invalidStateEvidence.allHardVetoesPass, false);
assert.equal(invalidStateEvidence.failurePhase, 'state-identity-validation');
assert.equal(invalidStateEvidence.error.code, 'p0-state-invalid');
assert.equal(invalidStateEvidence.hardVetoes, null);
assert.equal(invalidStateEvidence.projection, null);

const replay = evaluateAnalyticalElbowCP0(createAnalyticalElbowCP0Input());
assert.deepEqual(replay, report);

const forged = createAnalyticalElbowCP0Input();
forged.effectiveConfig.budget += 1;
const rejected = evaluateAnalyticalElbowCP0(forged);
assert.equal(rejected.status, 'C_P0_INVALID');
assert.equal(rejected.failurePhase, 'identity-validation');
assert.equal(rejected.primaryOutput, null);

const bundle = createAnalyticalElbowCP0Bundle();
assert.equal(bundle.schema, ANALYTICAL_ELBOW_C_P0_BUNDLE_SCHEMA);
assert.deepEqual(bundle.report, report);

console.log('analytical elbow positive-volume C(P0) contracts passed');
