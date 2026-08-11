import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ROW_DISTINCT_FIELD_ASSAY_SCHEMA,
  buildRowDistinctScalarAnisotropicAssay,
} from '../row-distinct-field-assay-core.mjs';

const assayCard = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/row-distinct-scalar-anisotropic-assay.v0.json', import.meta.url),
  'utf8',
));
const target = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/row-distinct-hindquarter-target.v0.json', import.meta.url),
  'utf8',
));

function build(card = assayCard) {
  return buildRowDistinctScalarAnisotropicAssay({
    assayCard: structuredClone(card),
    target: structuredClone(target),
  });
}

function edgeUseCounts(mesh) {
  const counts = new Map();
  for (const face of mesh.faces) {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index];
      const b = face[(index + 1) % face.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

test('assay card freezes a neutral target and two distinct effective compilers', () => {
  assert.equal(assayCard.rows.length, 2);
  assert.equal(new Set(assayCard.rows.map((row) => row.compilerId)).size, 2);
  assert.equal(assayCard.promotion, 'none');
  assert.equal(target.authority.sourceKind, 'independently-authored-synthetic-observation');
  assert.doesNotMatch(target.authority.construction, /metaball|anisotropic|compilerId/);
  assert.equal(assayCard.camera.id, 'right-sagittal-boundary-observation-v0');
  assert.equal(target.frame.cameraId, assayCard.camera.id);
  assert.deepEqual(assayCard.camera.bounds, assayCard.grid.bounds);

  const assay = build();
  assert.equal(assay.schema, ROW_DISTINCT_FIELD_ASSAY_SCHEMA);
  assert.deepEqual(assay.rows.map((row) => row.id), assayCard.rows.map((row) => row.id));
  assert.equal(new Set(assay.rows.map((row) => row.effectiveCompilerId)).size, 2);
});

test('both rows clear the same frozen baseline-fit gate before response evidence counts', () => {
  const assay = build();
  for (const row of assay.rows) {
    assert.equal(row.baselineFit.observedStationFraction, 1, row.id);
    assert.ok(
      row.baselineFit.normalizedRmse <= assayCard.baselineFit.maximumNormalizedRmse,
      `${row.id} baseline RMSE ${row.baselineFit.normalizedRmse}`,
    );
    assert.equal(row.baselineFit.passed, true, row.id);
  }
  assert.ok(
    assay.comparison.baselineRmseGap
      <= assayCard.baselineFit.maximumBetweenRowNormalizedRmseGap,
    `between-row baseline RMSE gap ${assay.comparison.baselineRmseGap}`,
  );
  assert.equal(assay.comparison.baselineParityPassed, true);
});

test('field extraction emits closed nonblank baseline and perturbed surfaces', () => {
  const assay = build();
  for (const row of assay.rows) {
    for (const state of [row.baseline, row.perturbed]) {
      assert.ok(state.mesh.vertices.length > 100, `${row.id} blank surface`);
      assert.ok(state.mesh.faces.length > 100, `${row.id} trivial surface`);
      assert.ok(
        [...edgeUseCounts(state.mesh).values()].every((count) => count === 2),
        `${row.id} surface is open or nonmanifold`,
      );
    }
  }
});

test('response ledger preserves target comparison, locality, smoothness, and direction', () => {
  const assay = build();
  for (const row of assay.rows) {
    assert.equal(Object.keys(row.response.stationComparisons).length, target.stations.length);
    assert.ok(Number.isFinite(row.response.normalizedRmse));
    assert.ok(row.response.directionAgreement >= 0 && row.response.directionAgreement <= 1);
    assert.ok(Number.isFinite(row.response.localityRatio));
    assert.ok(Number.isFinite(row.response.maxSecondDifference));
  }
});

test('scalar control stays observable but nonadmitted while anisotropic attribution is consumed-surface evidence', () => {
  const assay = build();
  const scalar = assay.rows.find((row) => row.id === 'scalar-metaball-control');
  const anisotropic = assay.rows.find((row) => row.id === 'anisotropic-identity-challenger');
  assert.deepEqual(
    new Set(target.stations.map((station) => station.targetComponentId)),
    new Set(assayCard.surface.requiredComponentIds),
    'the neutral target must author every required contributor identity',
  );
  assert.equal(scalar.surface.identityMode, 'none');
  assert.equal(scalar.verdict.passed, false);
  assert.ok(scalar.verdict.failures.some((failure) => failure.code === 'control-row-only'));
  assert.equal(anisotropic.surface.identityMode, 'mixture-weights');
  assert.ok(anisotropic.surface.sampledVertexCount > 0);
  assert.ok(anisotropic.surface.componentFractions['gluteal-carrier'] > 0);
  assert.equal(anisotropic.verdict.passed, true, JSON.stringify(anisotropic.verdict.failures));
  assert.deepEqual(anisotropic.verdict.failures, []);
});

test('compiler identity substitution fails loud instead of reusing another row implementation', () => {
  const substituted = structuredClone(assayCard);
  substituted.rows[1].compilerId = substituted.rows[0].compilerId;
  assert.throws(
    () => build(substituted),
    /row compiler identity does not match the closed assay card/,
  );
});

test('assay result is deterministic and binds target, card, grid, and effective routes', () => {
  const first = build();
  const second = build();
  assert.equal(first.assayHash, second.assayHash);
  assert.match(first.targetHash, /^[0-9a-f]{64}$/);
  assert.match(first.assayCardHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(first.grid, assayCard.grid);
  assert.deepEqual(first.camera, assayCard.camera);
  assert.ok(first.rows.every((row) => row.requestedCompilerId === row.effectiveCompilerId));
  assert.ok(first.rows.every((row) => row.requestedExtractorId === row.effectiveExtractorId));
});
