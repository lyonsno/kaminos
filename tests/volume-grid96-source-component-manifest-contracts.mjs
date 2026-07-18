import assert from 'node:assert/strict';
import {
  buildGrid96SourceComponentProducer,
  validateGrid96SourceComponentAuthority,
} from '../volume-grid96-source-component-manifest.mjs';

const sourceHashes = {
  fluidSha256: '1'.repeat(64),
  frontSha256: '2'.repeat(64),
  boundarySidecarSha256: '3'.repeat(64),
  majorantSha256: '4'.repeat(64),
};
const authoritativeSource = {
  identity: `sha256:${'a'.repeat(64)}`,
};
const equivalence = {
  schema: 'kaminos.volume.grid96-source-equivalence.v0',
  status: 'equivalent',
  failurePhase: null,
  exactByteIdentity: true,
  grid: 96,
  stateId: 'coefficient-state-120',
  simStepCount: 120,
  identity: `sha256:${'b'.repeat(64)}`,
  authoritativeSourceIdentity: authoritativeSource.identity,
  sourceHashes,
  route: {
    candidateRequested: 'http://127.0.0.1:19496/?volume_resolution=96',
    candidateEffective: 'native-3d-compute-fluid-raymarch-v0',
    candidateBackend: 'WebGPU:apple',
    fallbackUsed: false,
  },
  controls: {
    candidateRequested: `sha256:${'c'.repeat(64)}`,
    candidateEffective: `sha256:${'c'.repeat(64)}`,
    substitutionObserved: false,
  },
  reuseDecision: {
    directCoefficientCaptureMayProceed: true,
    frozenFieldImportRequired: false,
  },
  claimBoundary: {
    causalQuestion: 'source-lattice-subcell-vs-deposit-space-quadrature-v0',
    cheaperDemoClaim: false,
    resizedGrid160Evidence: false,
    learnerCampaign: false,
    depositionAdjudication: false,
  },
};
const rows = {
  count: 2,
  sourceRowCount: 96 ** 3,
  sampleCap: null,
  droppedRowCount: 0,
  nativeCellIndices: { sha256: '5'.repeat(64) },
  admission: { sha256: '6'.repeat(64) },
  features: { sha256: '7'.repeat(64) },
  coefficients: { sha256: '8'.repeat(64) },
  kernelDescriptors: { sha256: '9'.repeat(64) },
};
const input = {
  authoritativeSource,
  equivalence,
  requestedUrl: equivalence.route.candidateRequested,
  runtimeIdentity: {
    grid: 96,
    effectiveRoute: equivalence.route.candidateEffective,
    backend: equivalence.route.candidateBackend,
  },
  replay: { completedSteps: 120, grid: 96 },
  sourceHashes,
  rows,
  causalControlIdentity: `sha256:${'d'.repeat(64)}`,
  producerProvenance: {
    tigerRuntimeCommit: 'd'.repeat(40),
    importedModuleSha256: {
      sourceBasis: 'e'.repeat(64),
      analyticalAdmission: 'f'.repeat(64),
      descriptorSocket: '0'.repeat(64),
    },
    targetCaptureStarted: false,
    trainingStarted: false,
    learnerInvoked: false,
  },
};

assert.equal(validateGrid96SourceComponentAuthority(authoritativeSource, equivalence), true);
assert.throws(
  () => validateGrid96SourceComponentAuthority(authoritativeSource, { ...equivalence, exactByteIdentity: false }),
  /exact byte identity/,
);
assert.throws(
  () => validateGrid96SourceComponentAuthority(authoritativeSource, { ...equivalence, stateId: 'coefficient-state-121' }),
  /state 120/,
);
assert.throws(
  () => validateGrid96SourceComponentAuthority(authoritativeSource, {
    ...equivalence,
    claimBoundary: { ...equivalence.claimBoundary, learnerCampaign: true },
  }),
  /learner campaign/,
);

const producer = buildGrid96SourceComponentProducer(input);
assert.equal(producer.schema, 'kaminos.volume.grid96-coefficient-source-capture.v0');
assert.equal(producer.status, 'complete');
assert.equal(producer.failurePhase, null);
assert.equal(producer.state.id, 'coefficient-state-120');
assert.equal(producer.state.replay.completedSteps, 120);
assert.deepEqual(producer.state.sourceHashes, sourceHashes);
assert.equal(producer.state.rows, rows);
assert.equal(producer.sampleCap, null);
assert.equal(producer.droppedRowCount, 0);
assert.equal(producer.overflowCount, 0);
assert.equal(producer.claimBoundary.learnerCampaign, false);
assert.equal(producer.claimBoundary.depositionAdjudication, false);

const reject = (change, pattern) => assert.throws(
  () => buildGrid96SourceComponentProducer(change(input)),
  pattern,
);

reject(value => ({ ...value, requestedUrl: 'http://127.0.0.1:19497/?volume_resolution=96' }), /requested route differs/);
reject(value => ({ ...value, runtimeIdentity: { ...value.runtimeIdentity, grid: 160 } }), /native Grid96/);
reject(value => ({ ...value, sourceHashes: { ...value.sourceHashes, frontSha256: '0'.repeat(64) } }), /front checksum differs/);
reject(value => ({ ...value, replay: { ...value.replay, completedSteps: 119 } }), /state 120/);
reject(value => ({ ...value, rows: { ...value.rows, sourceRowCount: 95 ** 3 } }), /full source grid/);
reject(value => ({ ...value, rows: { ...value.rows, sampleCap: 100 } }), /sample cap/);
reject(value => ({ ...value, rows: { ...value.rows, droppedRowCount: 1 } }), /dropped rows/);
reject(value => ({ ...value, producerProvenance: { ...value.producerProvenance, targetCaptureStarted: true } }), /target capture/);
reject(value => ({ ...value, producerProvenance: { ...value.producerProvenance, trainingStarted: true } }), /training/);
reject(value => ({ ...value, producerProvenance: { ...value.producerProvenance, learnerInvoked: true } }), /learner/);
reject(value => ({ ...value, authoritativeSource: { identity: `sha256:${'1'.repeat(64)}` } }), /authoritative source identity/);

console.log('grid96 source component manifest contracts passed');
