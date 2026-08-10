import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNBodyRosetteFixture,
  runNBodyRosetteCounterfeitAssay,
} from '../nbody-packing-assay-core.mjs';
import { renderNBodyPackingAssayHtml } from '../nbody-packing-assay-witness.mjs';
import {
  compileNBodyUnifiedKktProblem,
  createNBodyUnifiedKktConfig,
  solveNBodyUnifiedKktCandidate,
} from '../nbody-packing-unified-kkt.mjs';

test('unified KKT compiler independently rejects mutually consistent forged fixture identity', () => {
  const fixture = createNBodyRosetteFixture({ stressTier:'frustrated-comparative-v0' });
  const forged = '0'.repeat(64);
  fixture.identity.sha256 = forged;
  fixture.input.requested.sha256 = forged;
  fixture.input.effective.sha256 = forged;
  assert.throws(() => compileNBodyUnifiedKktProblem(fixture), /fixture identity mismatch/);
});

test('unified KKT requires the full explicit solve contract', () => {
  const fixture = createNBodyRosetteFixture({ stressTier:'frustrated-comparative-v0' });
  const problem = compileNBodyUnifiedKktProblem(fixture);
  const requestedConfig = createNBodyUnifiedKktConfig();
  delete requestedConfig.ridge;
  assert.throws(
    () => solveNBodyUnifiedKktCandidate({ problem, requestedConfig }),
    /requires exact keys/,
  );
});

test('unified KKT closes the jointly feasible frustrated fixture without oracle or graph rows', () => {
  const fixture = createNBodyRosetteFixture({ stressTier:'frustrated-comparative-v0' });
  const problem = compileNBodyUnifiedKktProblem(fixture);
  const requestedConfig = createNBodyUnifiedKktConfig();
  const result = solveNBodyUnifiedKktCandidate({ problem, requestedConfig });
  assert.equal(result.status, 'converged-unified-kkt-candidate');
  assert.equal(result.route.fallbackUsed, false);
  assert.equal(result.mechanism.oracleTargetCoordinatesConsumed, false);
  assert.equal(result.mechanism.contactGraphRowsConsumed, false);
  assert.deepEqual(result.mechanism.constraintKinds, [
    'pairwise-clearance',
    'skeletal-clearance',
    'compartment-clearance',
  ]);
  assert.ok(result.selected.maximumPhysicalResidual <= requestedConfig.convergenceTolerance);
  assert.ok(result.selected.metrics.pairwisePenetration <= requestedConfig.convergenceTolerance);
  assert.ok(result.selected.metrics.skeletalPenetration <= requestedConfig.convergenceTolerance);
  assert.ok(result.selected.metrics.compartmentEscape <= requestedConfig.convergenceTolerance);
  assert.ok(result.selected.metrics.endpointDrift <= requestedConfig.convergenceTolerance);
  assert.ok(result.selected.metrics.maximumRelativeVolumeError <= requestedConfig.convergenceTolerance);
  assert.ok(result.selected.displacement.movedMemberCount >= 4);
  assert.ok(result.work.rows.length > 0);
  assert.ok(result.work.rows.every(row =>
    row.maximumPhysicalResidualAfter < row.maximumPhysicalResidualBefore));
  assert.equal(result.invariance.candidateEnumeration, 'passed');
  assert.ok(Object.values(result.invariance.comparison).every(Boolean));

  const html = renderNBodyPackingAssayHtml({
    fixture,
    result:runNBodyRosetteCounterfeitAssay({ fixture }),
    report:{ route:{ requested:'unified-test', effective:'unified-test', fallbackUsed:false } },
    unifiedKktCandidate:result,
  });
  assert.match(
    html,
    /<button data-state="unified-kkt-candidate">Unified global candidate<\/button>/,
  );
  assert.match(html, /payload\.unifiedKktCandidate\.selected/);
});
