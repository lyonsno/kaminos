import assert from 'node:assert/strict';

import {
  ANALYTICAL_ELBOW_ROW_W_BUNDLE_SCHEMA,
  ANALYTICAL_ELBOW_ROW_W_INPUT_SCHEMA,
  createAnalyticalElbowRowWBundle,
  createAnalyticalElbowRowWInput,
  evaluateAnalyticalElbowRowW,
  trianglesIntersect,
} from '../analytical-elbow-positive-volume-row-w-core.mjs';

function expectIdentityInvalid(mutator) {
  const mutated = structuredClone(input);
  mutator(mutated);
  const mutatedReport = evaluateAnalyticalElbowRowW(mutated);
  assert.equal(mutatedReport.status, 'W_INVALID');
  assert.equal(mutatedReport.failurePhase, 'identity-validation');
  assert.equal(mutatedReport.error.code, 'identity-invalid');
  assert.equal(mutatedReport.primaryOutput, null);
}

const input = createAnalyticalElbowRowWInput();
assert.equal(input.schema, ANALYTICAL_ELBOW_ROW_W_INPUT_SCHEMA);
assert.equal(input.requestedRoute, 'analytical-elbow-positive-volume-row-w');
assert.equal(input.effectiveRoute, input.requestedRoute);
assert.equal(input.fallbackUsed, false);
assert.equal(input.source.id, 'synthetic-mammalian-elbow-v0:sleeve-40x24');
assert.equal(input.source.vertices.length, 986);
assert.equal(input.source.triangles.length, 1968);
assert.equal(input.construction.kind, 'cubic-hermite-transported-cross-section');
assert.equal(input.construction.centerlineSamples.length, 257);
assert.equal(input.construction.posedVertices.length, input.source.vertices.length);

const report = evaluateAnalyticalElbowRowW(input);
assert.equal(report.status, 'W_VALID');
assert.equal(report.failurePhase, null);
assert.equal(report.primaryOutput, 'analytical-elbow-row-w-v0');
assert.equal(report.hardVetoes.finiteGeometry.pass, true);
assert.equal(report.hardVetoes.rigidBoundaryResidual.pass, true);
assert.equal(report.hardVetoes.rigidZoneLeakage.pass, true);
assert.equal(report.hardVetoes.collarRecruitment.pass, true);
assert.equal(report.hardVetoes.frameOrientation.pass, true);
assert.equal(report.hardVetoes.surfaceOrientation.pass, true);
assert.equal(report.hardVetoes.transitionSelfIntersection.pass, true);
assert.equal(report.hardVetoes.crossSectionAreaRatio.pass, true);
assert.equal(report.hardVetoes.totalVolumeRatio.pass, true);
assert.ok(report.metrics.minimumCrossSectionAreaRatio >= 0.10);
assert.ok(report.metrics.totalSignedVolumeRatio >= 0.50);
assert.ok(report.metrics.totalSignedVolumeRatio <= 1.50);
assert.equal(
  Math.sign(report.metrics.restSignedVolume),
  Math.sign(report.metrics.posedSignedVolume),
);

const bundle = createAnalyticalElbowRowWBundle();
assert.equal(bundle.schema, ANALYTICAL_ELBOW_ROW_W_BUNDLE_SCHEMA);
assert.equal(bundle.status, 'complete');
assert.equal(bundle.case, 'row-w');
assert.deepEqual(bundle.input, input);
assert.deepEqual(bundle.report, report);

const nonfinite = structuredClone(input);
nonfinite.construction.posedVertices[100].position[0] = Number.NaN;
const nonfiniteReport = evaluateAnalyticalElbowRowW(nonfinite);
assert.equal(nonfiniteReport.status, 'W_INVALID');
assert.equal(nonfiniteReport.failurePhase, 'hard-veto-evaluation');
assert.equal(nonfiniteReport.hardVetoes.finiteGeometry.pass, false);
assert.equal(nonfiniteReport.primaryOutput, null);

const leaking = structuredClone(input);
const parentVertex = leaking.source.vertices.find(vertex => vertex.axial >= 0.72);
leaking.construction.posedVertices[parentVertex.index].position[0] += 0.01;
const leakingReport = evaluateAnalyticalElbowRowW(leaking);
assert.equal(leakingReport.status, 'W_INVALID');
assert.equal(leakingReport.hardVetoes.rigidZoneLeakage.pass, false);
assert.equal(leakingReport.primaryOutput, null);

expectIdentityInvalid(mutated => {
  mutated.source.semanticHash = 'forged-source-hash';
});
expectIdentityInvalid(mutated => {
  mutated.source.vertices[100].id = 'forged-vertex';
  mutated.construction.posedVertices[100].id = 'forged-vertex';
});
expectIdentityInvalid(mutated => {
  const triangle = mutated.source.triangles[100];
  triangle.vertexIndices = [
    triangle.vertexIndices[0],
    triangle.vertexIndices[2],
    triangle.vertexIndices[1],
  ];
  triangle.vertexIds = [
    triangle.vertexIds[0],
    triangle.vertexIds[2],
    triangle.vertexIds[1],
  ];
});
expectIdentityInvalid(mutated => {
  mutated.requestedConfig.collarHalfWidth = 0.5;
  mutated.effectiveConfig.collarHalfWidth = 0.5;
});
const forgedConstructionHash = structuredClone(input);
forgedConstructionHash.construction.semanticHash = 'forged-construction-hash';
const forgedConstructionHashReport = evaluateAnalyticalElbowRowW(
  forgedConstructionHash,
);
assert.equal(forgedConstructionHashReport.status, 'W_INVALID');
assert.equal(
  forgedConstructionHashReport.hardVetoes.constructionRecordConsistency.pass,
  false,
);
expectIdentityInvalid(mutated => {
  mutated.construction.centerlineControl.start = [99, 99, 99];
});
expectIdentityInvalid(mutated => {
  mutated.construction.centerlineSamples[128].t = 999;
  mutated.construction.centerlineSamples[128].sourceAxial = 999;
});
expectIdentityInvalid(mutated => {
  mutated.construction.centerlineSamples[128].radial =
    mutated.construction.centerlineSamples[128].radial.map(value => -value);
});
expectIdentityInvalid(mutated => {
  mutated.construction.crossSectionMap = 'forged-cross-section-map';
});
expectIdentityInvalid(mutated => {
  mutated.construction.scaleField = 'radial=0; binormal=0';
});

const reflected = structuredClone(input);
for (const vertex of reflected.construction.posedVertices) {
  vertex.position[0] *= -1;
}
const reflectedReport = evaluateAnalyticalElbowRowW(reflected);
assert.equal(reflectedReport.status, 'W_INVALID');
assert.equal(reflectedReport.hardVetoes.totalVolumeRatio.pass, false);

const coplanarLeft = {
  points: [[0, 0, 0], [2, 0, 0], [0, 2, 0]],
};
const coplanarRight = {
  points: [[0.25, 0.25, 0], [1.25, 0.25, 0], [0.25, 1.25, 0]],
};
assert.equal(trianglesIntersect(coplanarLeft, coplanarRight), true);

console.log('analytical elbow positive-volume Row W contracts passed');
