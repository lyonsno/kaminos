import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const proposal = await import('../lirm-support-atlas-proposal-core.mjs');

const arrayHash = values => createHash('sha256')
  .update(JSON.stringify(Array.from(values)))
  .digest('hex');

const controlGlbPath = new URL('../artifacts/motion-ready-719024/creature.glb', import.meta.url);
const controlRegistrationPath = new URL('../artifacts/motion-ready-719024/registration.json', import.meta.url);
const admittedAtlasPath = new URL(
  '../artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/admitted-contact-atlas.json',
  import.meta.url,
);

const [controlMesh, registration, admittedAtlas] = await Promise.all([
  proposal.loadGlbPositionMesh(controlGlbPath),
  readFile(controlRegistrationPath, 'utf8').then(JSON.parse),
  readFile(admittedAtlasPath, 'utf8').then(JSON.parse),
]);

assert.equal(controlMesh.vertexCount, admittedAtlas.vertexCount);
assert.equal(
  controlMesh.sha256,
  `sha256:${admittedAtlas.castHash}`,
  'loaded control geometry must preserve exact cast identity',
);

const reproduced = proposal.deriveCrawlerContactAtlas(
  controlMesh.positions,
  registration,
  {
    castId: admittedAtlas.castId,
    castHash: admittedAtlas.castHash,
    registrationHash: admittedAtlas.registrationHash,
  },
);

assert.deepEqual(
  reproduced.patches.map(patch => patch.id),
  ['front-left', 'front-right', 'rear-left', 'rear-right'],
);
for (let index = 0; index < admittedAtlas.patches.length; index += 1) {
  const expected = admittedAtlas.patches[index];
  const actual = reproduced.patches[index];
  assert.equal(actual.vertexIndices.length, expected.vertexIndices.length, `${actual.id} contact count drifted`);
  assert.equal(
    actual.influenceVertexIndices.length,
    expected.influenceVertexIndices.length,
    `${actual.id} influence count drifted`,
  );
  assert.equal(arrayHash(actual.vertexIndices), arrayHash(expected.vertexIndices), `${actual.id} contacts drifted`);
  assert.equal(
    arrayHash(actual.influenceVertexIndices),
    arrayHash(expected.influenceVertexIndices),
    `${actual.id} influence membership drifted`,
  );
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(
      Math.abs(actual.restCentroid[axis] - expected.restCentroid[axis]) < 1e-12,
      `${actual.id} centroid axis ${axis} drifted`,
    );
  }
}

const admittedAssessment = proposal.assessCrawlerContactAtlas({
  atlas: reproduced,
  positions: controlMesh.positions,
  registration,
  expectedIdentity: {
    castId: admittedAtlas.castId,
    castHash: admittedAtlas.castHash,
    registrationHash: admittedAtlas.registrationHash,
  },
});
assert.equal(admittedAssessment.classification, 'admit');
assert.deepEqual(admittedAssessment.rejectionReasons, []);
assert.equal(admittedAssessment.patchDiagnostics.length, 4);

const pressureGlbPath = new URL(
  '../artifacts/lirm-support-atlas-admission-v0/heavy-seed720201/trellis-fast/output.glb',
  import.meta.url,
);
const pressureMesh = await proposal.loadGlbPositionMesh(pressureGlbPath);
const pressureInset = (pressureMesh.bounds.max[2] - pressureMesh.bounds.min[2]) * 0.03;
const pressureRegistration = {
  schema: 'kaminos.axial-crawler-registration.v0',
  bounds: pressureMesh.bounds,
  localForwardAxis: [0, 0, -1],
  localRightAxis: [1, 0, 0],
  localUpAxis: [0, 1, 0],
  headAnchor: [0, 0, pressureMesh.bounds.min[2] + pressureInset],
  tailAnchor: [0, 0, pressureMesh.bounds.max[2] - pressureInset],
};
const pressureIdentity = {
  castId: 'heavy-seed720201',
  castHash: pressureMesh.sha256.slice('sha256:'.length),
  registrationHash: createHash('sha256')
    .update(JSON.stringify(pressureRegistration))
    .digest('hex'),
};
const pressureDefault = proposal.deriveCrawlerContactAtlas(
  pressureMesh.positions,
  pressureRegistration,
  pressureIdentity,
);
const pressureDefaultAssessment = proposal.assessCrawlerContactAtlas({
  atlas: pressureDefault,
  positions: pressureMesh.positions,
  registration: pressureRegistration,
  expectedIdentity: pressureIdentity,
});
assert.equal(pressureDefaultAssessment.classification, 'needs-edit');
assert.deepEqual(
  pressureDefaultAssessment.rejectionReasons.map(reason => reason.code),
  ['contact-near-axial-window-edge', 'contact-near-axial-window-edge'],
);

const pressureRecentered = proposal.deriveCrawlerContactAtlas(
  pressureMesh.positions,
  pressureRegistration,
  pressureIdentity,
  { frontAxialCenterT: 0.62 },
);
const pressureRecenteredAssessment = proposal.assessCrawlerContactAtlas({
  atlas: pressureRecentered,
  positions: pressureMesh.positions,
  registration: pressureRegistration,
  expectedIdentity: pressureIdentity,
});
assert.equal(pressureRecenteredAssessment.classification, 'admit');
assert.deepEqual(pressureRecenteredAssessment.rejectionReasons, []);

assert.throws(
  () => proposal.assessCrawlerContactAtlas({
    atlas: reproduced,
    positions: controlMesh.positions,
    registration,
    expectedIdentity: {
      castId: admittedAtlas.castId,
      castHash: 'stale-cast-hash',
      registrationHash: admittedAtlas.registrationHash,
    },
  }),
  /cast hash mismatch/,
);

const overlapping = structuredClone(reproduced);
overlapping.patches[1].influenceVertexIndices = [...overlapping.patches[0].influenceVertexIndices];
overlapping.patches[1].influenceWeights = [...overlapping.patches[0].influenceWeights];
const overlapAssessment = proposal.assessCrawlerContactAtlas({
  atlas: overlapping,
  positions: controlMesh.positions,
  registration,
  expectedIdentity: {
    castId: admittedAtlas.castId,
    castHash: admittedAtlas.castHash,
    registrationHash: admittedAtlas.registrationHash,
  },
});
assert.equal(overlapAssessment.classification, 'reject');
assert.ok(
  overlapAssessment.rejectionReasons.some(reason => reason.code === 'rigid-carrier-core-overlap'),
  'overlapping rigid carrier cores must fail admission',
);

const malformedWeights = structuredClone(reproduced);
malformedWeights.patches[0].weights = [];
malformedWeights.patches[1].influenceWeights =
  malformedWeights.patches[1].influenceWeights.map(() => 'nan');
const malformedWeightsAssessment = proposal.assessCrawlerContactAtlas({
  atlas: malformedWeights,
  positions: controlMesh.positions,
  registration,
  expectedIdentity: {
    castId: admittedAtlas.castId,
    castHash: admittedAtlas.castHash,
    registrationHash: admittedAtlas.registrationHash,
  },
});
assert.equal(malformedWeightsAssessment.classification, 'reject');
assert.ok(
  malformedWeightsAssessment.rejectionReasons.some(reason => reason.code === 'invalid-contact-weights'),
  'missing contact weights must fail admission',
);
assert.ok(
  malformedWeightsAssessment.rejectionReasons.some(reason => reason.code === 'invalid-influence-weights'),
  'non-finite influence weights must fail admission',
);

const missingBoundary = structuredClone(reproduced);
delete missingBoundary.patches[0].derivation;
const missingBoundaryAssessment = proposal.assessCrawlerContactAtlas({
  atlas: missingBoundary,
  positions: controlMesh.positions,
  registration,
  expectedIdentity: {
    castId: admittedAtlas.castId,
    castHash: admittedAtlas.castHash,
    registrationHash: admittedAtlas.registrationHash,
  },
});
assert.equal(missingBoundaryAssessment.classification, 'reject');
assert.ok(
  missingBoundaryAssessment.rejectionReasons.some(reason => reason.code === 'invalid-carrier-derivation'),
  'missing carrier derivation must fail admission with a structured reason',
);

await assert.rejects(
  proposal.loadGlbPositionMesh(new URL('../artifacts/does-not-exist.glb', import.meta.url)),
  /ENOENT/,
);

console.log('lirm support-atlas proposal contracts passed');
