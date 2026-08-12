import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as shellCore from '../explicit-response-shell-assay-core.mjs';

const assayCard = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/explicit-response-shell-assay.v0.json', import.meta.url),
  'utf8',
));
const target = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/overlapping-hindquarter-tissue-target.v0.json', import.meta.url),
  'utf8',
));

function build(evaluationTarget = target, evaluationMode = 'authoritative') {
  assert.equal(
    typeof shellCore.buildExplicitResponseShellAssay,
    'function',
    'the held-out-combined explicit response-shell builder is required',
  );
  return shellCore.buildExplicitResponseShellAssay({
    assayCard: structuredClone(assayCard),
    target: structuredClone(target),
    evaluationTarget: structuredClone(evaluationTarget),
    evaluationMode,
  });
}

test('explicit response shell keeps combined target out of construction', () => {
  const assay = build();
  assert.deepEqual(assay.construction.sourceFields, [
    'baseline',
    'muscleTension',
    'fatDistribution',
  ]);
  assert.deepEqual(assay.evaluation.heldOutFields, ['combined']);
  assert.equal(assay.construction.combinedTargetReadCount, 0);

  const counterfeit = structuredClone(target);
  counterfeit.stations[4].combined.top += 0.08;
  counterfeit.stations[4].combined.halfWidth += 0.06;
  const changedEvaluation = build(counterfeit, 'counterfactual');
  assert.equal(
    changedEvaluation.construction.projectionHash,
    assay.construction.projectionHash,
  );
  assert.deepEqual(changedEvaluation.candidate.compiledStates, assay.candidate.compiledStates);
  assert.notEqual(changedEvaluation.evaluation.targetHash, assay.evaluation.targetHash);
  assert.ok(
    changedEvaluation.verdict.combined.fullSurfaceNormalizedRmse
      > assay.verdict.combined.fullSurfaceNormalizedRmse,
  );
});

test('explicit response shell preserves one closed stable topology across every state', () => {
  const assay = build();
  assert.equal(assay.candidate.vertexBindings.length, 530);
  assert.equal(assay.candidate.topology.faceCount, 1056);
  assert.equal(assay.candidate.topology.closed, true);
  assert.equal(assay.candidate.topology.componentCount, 1);

  const baselineIds = assay.candidate.vertexBindings.map((entry) => entry.vertexId);
  const baselineFaces = assay.candidate.compiledStates.baseline.mesh.faces;
  for (const state of Object.values(assay.candidate.compiledStates)) {
    assert.deepEqual(state.vertexIds, baselineIds);
    assert.deepEqual(state.mesh.faces, baselineFaces);
    assert.equal(state.topology.closed, true);
    assert.equal(state.topology.componentCount, 1);
  }
  assert.ok(assay.candidate.vertexBindings.every((binding) => (
    binding.sources.muscle.sourceField === 'muscleTension'
      && binding.sources.fat.sourceField === 'fatDistribution'
      && binding.sources.muscle.targetTissueId === 'muscle'
      && binding.sources.fat.targetTissueId === 'fat'
  )));
});

test('independent response rows and held-out additive combination pass in full 3D', () => {
  const assay = build();
  assert.deepEqual(Object.keys(assay.verdict.independent), [
    'muscle-tension',
    'fat-distribution',
  ]);
  for (const control of Object.values(assay.verdict.independent)) {
    assert.equal(control.passed, true);
    assert.ok(control.amplitudes.every((entry) => (
      entry.fullSurfaceNormalizedRmse
        <= assayCard.evaluation.maximumIndependentFullSurfaceNormalizedRmse
      && entry.topology.closed
      && entry.topology.componentCount === 1
    )));
  }
  assert.equal(assay.verdict.combined.passed, true);
  assert.ok(
    assay.verdict.combined.fullSurfaceNormalizedRmse
      <= assayCard.evaluation.maximumCombinedFullSurfaceNormalizedRmse,
  );
  assert.equal(assay.verdict.passed, true);
  assert.equal(assay.promotion, 'none');
});

test('source-row response null cannot counterfeit independently named response', () => {
  const assay = build();
  assert.equal(assay.candidate.id, 'source-row-attributable-explicit-response-shell');
  assert.deepEqual(assay.candidate.carrierCoupling, {
    status: 'not-exercised',
    provenanceOnlyCarrierId: 'labeled-anisotropic-components-v0',
  });
  assert.equal(assay.candidate.interiorCarrierId, undefined);
  assert.equal(assay.causalNull.id, 'source-row-response-null');
  assert.equal(assay.causalNull.verdict.scope, 'missing-response-only');
  assert.equal(assay.causalNull.topology.closed, true);
  assert.equal(assay.causalNull.topology.componentCount, 1);
  assert.equal(assay.causalNull.verdict.passed, false);
  assert.ok(assay.causalNull.verdict.failures.some(
    (failure) => failure.code === 'independent-response-missing',
  ));
  assert.equal(assay.verdict.passed, true);
  assert.equal(
    assay.verdict.inference,
    'source-row-attributable-explicit-shell-supported-on-additive-fixture',
  );
});

test('coordinated assay-card threshold substitution cannot retain route authority', () => {
  const counterfeit = structuredClone(assayCard);
  counterfeit.evaluation.maximumCombinedFullSurfaceNormalizedRmse = 0.5;
  assert.throws(
    () => shellCore.buildExplicitResponseShellAssay({
      assayCard: counterfeit,
      target: structuredClone(target),
    }),
    /assay card identity|authoritative/,
  );
});
