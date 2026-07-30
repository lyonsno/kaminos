import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  applyRigidChain,
  assertRigidArticulationReport,
  classifyRigidPredecessorLocality,
  createIndexedOwnershipLocality,
  createSphereCollisionField,
  createTriangleCollisionField,
  evaluateSweptRigidCandidate,
  freezeRigidJointFrame,
  measureRigidSetClearance,
  RIGID_ARTICULATION_ANNOTATION_HASH,
  RIGID_ARTICULATION_ASSAY_ROUTE,
  RIGID_ARTICULATION_SOURCE_HASH,
} from '../lirm-rigid-articulation-predecessor-core.mjs';
import * as assayModule from '../lirm-rigid-articulation-predecessor-assay.mjs';

const approximately = (actual, expected, tolerance = 1e-10) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected}`,
  );
};

const rootFrame = freezeRigidJointFrame({
  id: 'rear-left-root',
  center: [0, 0, 0],
  axis: [0, 0, 2],
  positiveReference: [0, 1, 0],
  sourceVertexWitnesses: {
    center: 10,
    axisA: 11,
    axisB: 12,
  },
  authority: 'synthetic-test',
});
const distalFrame = freezeRigidJointFrame({
  id: 'rear-left-distal',
  center: [1, 0, 0],
  axis: [0, 0, 1],
  positiveReference: [0, 1, 0],
  sourceVertexWitnesses: {
    center: 20,
    axisA: 21,
    axisB: 22,
  },
  authority: 'synthetic-test',
});

assert.deepEqual(rootFrame.axis, [0, 0, 1]);
assert.equal(rootFrame.positiveSign, 1);
assert.match(rootFrame.identity, /^sha256:[a-f0-9]{64}$/);

const nestingSource = Float64Array.from([
  1.25, 0, 0,
  1.5, 0.25, 0,
  9, 9, 9,
]);
const oneJoint = applyRigidChain({
  positions: nestingSource,
  rigidVertexIndices: [0, 1],
  rootFrame,
  rootRadians: 0.61,
});
const twoJointZeroBend = applyRigidChain({
  positions: nestingSource,
  rigidVertexIndices: [0, 1],
  rootFrame,
  distalFrame,
  rootRadians: 0.61,
  distalRadians: 0,
});
assert.deepEqual(
  Array.from(twoJointZeroBend),
  Array.from(oneJoint),
  'J2(theta, 0) must be exactly J1(theta)',
);
assert.deepEqual(Array.from(oneJoint.slice(6)), [9, 9, 9]);

const clearance = measureRigidSetClearance({
  positions: Float64Array.from([
    0, -0.1, 0,
    0, 0.3, 0,
  ]),
  rigidVertexIndices: [0, 1],
  terrainPoint: [0, 0, 0],
  terrainNormal: [0, 1, 0],
  diameter: 2,
  numericTolerance: 1e-6,
});
approximately(clearance.centroid, 0.1);
approximately(clearance.minimum, -0.1);
assert.equal(clearance.passes, false, 'a clear centroid must not hide one penetrating vertex');
approximately(clearance.normalizedMinimum, -0.05);

const collisionField = createSphereCollisionField({
  identity: 'synthetic-body-sphere',
  center: [0, -2, 0],
  radius: 0.3,
});
const crossing = evaluateSweptRigidCandidate({
  positions: Float64Array.from([-2, 0, 0]),
  rigidVertexIndices: [0],
  rootFrame,
  rootRadians: Math.PI,
  terrainPoint: [0, 0, -3],
  terrainNormal: [0, 0, 1],
  diameter: 4,
  collisionField,
  numericTolerance: 1e-6,
  collisionTolerance: 1e-4,
  maximumWitnessTravel: 0.12,
});
assert.ok(crossing.endpoint.clearance.minimum > 0);
assert.ok(crossing.endpoint.collision.minimum > 0);
assert.equal(
  crossing.passes,
  false,
  'a clean endpoint must not admit a path that crosses body geometry',
);
assert.equal(crossing.sweep.collision.passes, false);
assert.ok(crossing.sweep.sampleCount > 2);
assert.ok(
  crossing.sweep.terminalFraction < 1,
  'conservative sweep must stop before entering an uncertifiable collision interval',
);

const triangleField = createTriangleCollisionField({
  identity: 'synthetic-body-triangle',
  positions: Float64Array.from([
    -0.5, -2, 0,
    0.5, -2, 0,
    0, -1.5, 0,
  ]),
  indices: Uint32Array.from([0, 1, 2]),
  excludedVertexIndices: [],
});
const tiedTriangleField = createTriangleCollisionField({
  identity: 'synthetic-tied-body-triangles',
  positions: Float64Array.from([
    -0.5, -2, 0,
    0.5, -2, 0,
    0, -1.5, 0,
  ]),
  indices: Uint32Array.from([0, 1, 2, 0, 1, 2]),
  excludedVertexIndices: [],
});
assert.deepEqual(
  tiedTriangleField.query([0, -1.75, 0]),
  {
    distance: 0,
    triangleOffset: 0,
    triangleVertexIndices: [0, 1, 2],
  },
  'nearest-triangle ties must resolve to the lower source triangle offset',
);
const triangleCrossing = evaluateSweptRigidCandidate({
  positions: Float64Array.from([-2, 0, 0]),
  rigidVertexIndices: [0],
  rootFrame,
  rootRadians: Math.PI,
  terrainPoint: [0, 0, -3],
  terrainNormal: [0, 0, 1],
  diameter: 4,
  collisionField: triangleField,
  numericTolerance: 1e-6,
  collisionTolerance: 1e-4,
  maximumWitnessTravel: 0.12,
});
assert.ok(triangleCrossing.endpoint.collision.minimum > 1);
assert.equal(
  triangleCrossing.sweep.collision.passes,
  false,
  'a source-mesh triangle crossing must fail between clean endpoints',
);
assert.ok(triangleCrossing.sweep.terminalFraction < 1);
assert.equal(
  triangleCrossing.sweep.limitingWitness.actualFailure,
  false,
  'a conservative stop must retain a bound witness rather than claim observed contact',
);
assert.equal(triangleCrossing.sweep.limitingWitness.movedVertexIndex, 0);
assert.equal(triangleCrossing.sweep.limitingWitness.retainedTriangleOffset, 0);
assert.deepEqual(
  triangleCrossing.sweep.limitingWitness.retainedTriangleVertexIndices,
  [0, 1, 2],
);
const observedCrossing = evaluateSweptRigidCandidate({
  positions: Float64Array.from([1, 0, 0]),
  rigidVertexIndices: [0],
  rootFrame,
  rootRadians: Math.PI,
  terrainPoint: [0, 0, -3],
  terrainNormal: [0, 0, 1],
  diameter: 4,
  collisionField: {
    identity: 'synthetic-discontinuous-observed-crossing',
    distance(value) {
      return value[0] > 0.9 ? 1 : -1;
    },
    query() {
      return {
        distance: -1,
        triangleOffset: 12,
        triangleVertexIndices: [4, 5, 6],
      };
    },
  },
  numericTolerance: 1e-6,
  collisionTolerance: 1e-4,
  maximumWitnessTravel: 0.12,
});
assert.equal(observedCrossing.sweep.limitingWitness.actualFailure, true);
assert.equal(
  observedCrossing.sweep.limitingWitness.boundKind,
  'observed-body-collision',
);
assert.equal(observedCrossing.sweep.limitingWitness.retainedTriangleOffset, 12);

const locality = createIndexedOwnershipLocality({
  positions: Float64Array.from([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    2, 0, 0,
    3, 0, 0,
    4, 0, 0,
  ]),
  indices: Uint32Array.from([
    0, 1, 2,
    1, 2, 3,
    2, 3, 4,
    3, 4, 5,
  ]),
  rigidVertexIndices: [0, 1, 2],
  priorCollarVertexIndices: [5],
});
assert.deepEqual(locality.ownershipBoundaryVertexIndices, [1, 2]);
assert.equal(locality.describeMovedVertex(0).ownershipBoundaryHops, 1);
approximately(locality.describeMovedVertex(0).ownershipBoundaryDistance, 1);
assert.equal(locality.describeRetainedVertex(5).priorCollarHops, 0);
assert.ok(
  locality.describeRetainedVertex(4).ownershipBoundaryDistance > 1.1,
  'source-index topology must expose retained deep-core distance',
);

const boundaryLocalSummary = classifyRigidPredecessorLocality({
  transitionRadius: 1.1,
  rows: [{
    sweep: {
      limitingWitness: {
        movedVertexIndex: 0,
        retainedTriangleOffset: 3,
        retainedTriangleVertexIndices: [1, 2, 3],
        locality: {
          movedVertex: locality.describeMovedVertex(0),
          retainedTriangleVertices: [1, 2, 3].map(
            vertex => locality.describeRetainedVertex(vertex),
          ),
        },
      },
    },
  }],
});
assert.equal(boundaryLocalSummary.classification, 'boundary-local');
const deepCoreSummary = classifyRigidPredecessorLocality({
  transitionRadius: 1.1,
  rows: [{
    sweep: {
      limitingWitness: {
        movedVertexIndex: 0,
        retainedTriangleOffset: 9,
        retainedTriangleVertexIndices: [3, 4, 5],
        locality: {
          movedVertex: locality.describeMovedVertex(0),
          retainedTriangleVertices: [3, 4, 5].map(
            vertex => locality.describeRetainedVertex(vertex),
          ),
        },
      },
    },
  }],
});
assert.equal(deepCoreSummary.classification, 'deep-core');
const underinstrumentedSummary = classifyRigidPredecessorLocality({
  transitionRadius: 1.1,
  rows: [{ sweep: { limitingWitness: null } }],
});
assert.equal(underinstrumentedSummary.classification, 'underinstrumented');
assert.equal(underinstrumentedSummary.missingWitnessCount, 1);

const validReport = {
  schema: 'kaminos.lirm-rigid-articulation-predecessor-report.v0',
  status: 'complete',
  requestedRoute: RIGID_ARTICULATION_ASSAY_ROUTE,
  effectiveRoute: RIGID_ARTICULATION_ASSAY_ROUTE,
  sourceHash: RIGID_ARTICULATION_SOURCE_HASH,
  actualSourceHash: RIGID_ARTICULATION_SOURCE_HASH,
  annotationHash: RIGID_ARTICULATION_ANNOTATION_HASH,
  actualAnnotationHash: RIGID_ARTICULATION_ANNOTATION_HASH,
  supportId: 'rear-left',
  collisionIdentity: 'triangle-field:test',
  jointFrames: [rootFrame, distalFrame],
  nesting: {
    checked: true,
    maximumAbsoluteDelta: 0,
  },
  searches: [
    { family: 'J1-bounded', status: 'failed' },
    { family: 'J2-bounded', status: 'passed' },
  ],
};
assert.equal(assertRigidArticulationReport(validReport), validReport);
const validLocalityReport = structuredClone(validReport);
validLocalityReport.locality = {
  classification: 'deep-core',
  rowCount: 1,
  instrumentedRowCount: 1,
  missingWitnessCount: 0,
  transitionRadius: 1.1,
};
validLocalityReport.searches[0].sweptRejections = [{
  sweep: {
    limitingWitness: {
      movedVertexIndex: 0,
      retainedTriangleOffset: 9,
      retainedTriangleVertexIndices: [3, 4, 5],
      locality: {
        movedVertex: locality.describeMovedVertex(0),
        retainedTriangleVertices: [3, 4, 5].map(
          vertex => locality.describeRetainedVertex(vertex),
        ),
      },
    },
  },
}];
assert.equal(assertRigidArticulationReport(validLocalityReport), validLocalityReport);
const falseBoundaryLocalReport = structuredClone(validLocalityReport);
falseBoundaryLocalReport.locality.classification = 'boundary-local';
falseBoundaryLocalReport.locality.missingWitnessCount = 1;
assert.throws(
  () => assertRigidArticulationReport(falseBoundaryLocalReport),
  /locality instrumentation/,
  'missing witness identity must not masquerade as boundary-local evidence',
);
for (const [name, mutate, pattern] of [
  ['fallback route', report => { report.effectiveRoute = 'fallback'; }, /route identity/],
  ['stale cast', report => { report.actualSourceHash = 'stale'; }, /source identity/],
  ['stale annotation', report => { report.actualAnnotationHash = 'stale'; }, /annotation identity/],
  ['missing collision identity', report => { report.collisionIdentity = ''; }, /collision identity/],
  ['broken nesting', report => { report.nesting.maximumAbsoluteDelta = 1e-5; }, /nesting/],
]) {
  const report = structuredClone(validReport);
  mutate(report);
  assert.throws(() => assertRigidArticulationReport(report), pattern, name);
}

assert.equal(
  typeof assayModule.clearRigidArticulationDerivedOutputs,
  'function',
  'the assay must expose idempotent stale derived-output cleanup',
);
const cleanupDirectory = await mkdtemp(resolve(tmpdir(), 'kaminos-rigid-articulation-cleanup-'));
try {
  const staleAccepted = resolve(cleanupDirectory, 'accepted-rigid-K-positions.f32');
  const retainedInput = resolve(cleanupDirectory, 'oracle-stencil.json');
  await writeFile(staleAccepted, Buffer.from('stale-positive'));
  await writeFile(retainedInput, Buffer.from('operator-input'));
  await assayModule.clearRigidArticulationDerivedOutputs(cleanupDirectory);
  await assert.rejects(readFile(staleAccepted), error => error?.code === 'ENOENT');
  assert.equal((await readFile(retainedInput)).toString(), 'operator-input');
} finally {
  await rm(cleanupDirectory, { recursive: true, force: true });
}

const failureDirectory = await mkdtemp(resolve(tmpdir(), 'kaminos-rigid-articulation-failure-'));
try {
  const missingInputs = Object.fromEntries([
    'source',
    'registration',
    'contactAtlas',
    'phaseReport',
    'handshake',
    'axialRegistration',
    'constraints',
    'annotation',
  ].map(key => [key, `missing-${key}`]));
  await assert.rejects(
    assayModule.runRigidArticulationPredecessorAssay({
      root: failureDirectory,
      outDir: 'failed-output',
      inputs: missingInputs,
    }),
    /ENOENT/,
  );
  const failureReport = JSON.parse(await readFile(
    resolve(failureDirectory, 'failed-output', 'report.json'),
    'utf8',
  ));
  assert.equal(failureReport.status, 'failed');
  assert.equal(failureReport.failurePhase, 'input-admission');
  assert.equal(failureReport.lastTrustworthyEvidence, null);
  assert.equal(failureReport.effectiveRoute, null);
} finally {
  await rm(failureDirectory, { recursive: true, force: true });
}

process.stdout.write('lirm rigid articulation predecessor contracts passed\n');
