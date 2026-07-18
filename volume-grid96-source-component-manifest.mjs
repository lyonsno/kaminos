import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const GRID = 96;
const CELL_COUNT = GRID ** 3;
const ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const STATE_ID = 'coefficient-state-120';
const REPLAY_IDENTITY = 'deterministic-replay-same-route-controls-fixed-step-v0';
const PRODUCER_SCHEMA = 'kaminos.volume.grid96-coefficient-source-capture.v0';
const PRODUCER_AUTHORITY = 'exact-grid96-source-support-coefficient-descriptor-capture-v0';
const CAUSAL_QUESTION = 'source-lattice-subcell-vs-deposit-space-quadrature-v0';
const RECEIPT_IDENTITY = /^sha256:[0-9a-f]{64}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_HASH_KEYS = Object.freeze([
  'fluidSha256',
  'frontSha256',
  'boundarySidecarSha256',
  'majorantSha256',
]);

export function validateGrid96SourceComponentAuthority(authoritativeSource, equivalence) {
  assert.match(authoritativeSource?.identity || '', RECEIPT_IDENTITY, 'authoritative source identity is missing or invalid');
  assert.equal(equivalence?.schema, 'kaminos.volume.grid96-source-equivalence.v0', 'source equivalence schema drifted');
  assert.equal(equivalence.status, 'equivalent', 'source equivalence did not pass');
  assert.equal(equivalence.failurePhase, null, 'source equivalence carries a failure phase');
  assert.equal(equivalence.exactByteIdentity, true, 'source equivalence lacks exact byte identity');
  assert.equal(equivalence.grid, GRID, 'source equivalence is not native Grid96');
  assert.equal(equivalence.stateId, STATE_ID, 'source equivalence is not exact state 120');
  assert.equal(equivalence.simStepCount, 120, 'source equivalence simulator step is not state 120');
  assert.match(equivalence.identity || '', RECEIPT_IDENTITY, 'source equivalence identity is missing or invalid');
  assert.equal(equivalence.authoritativeSourceIdentity, authoritativeSource.identity, 'authoritative source identity differs from source equivalence');
  assert.equal(equivalence.reuseDecision?.directCoefficientCaptureMayProceed, true, 'source equivalence does not admit direct coefficient capture');
  assert.equal(equivalence.reuseDecision?.frozenFieldImportRequired, false, 'source equivalence still requires frozen-field import');
  assert.equal(equivalence.route?.candidateEffective, ROUTE, 'source-equivalent route is not native');
  assert.match(equivalence.route?.candidateBackend || '', /^WebGPU:/, 'source-equivalent backend is not WebGPU');
  assert.equal(equivalence.route?.fallbackUsed, false, 'source equivalence used a fallback');
  assert.equal(equivalence.controls?.candidateRequested, equivalence.controls?.candidateEffective, 'source-equivalent controls were substituted');
  assert.equal(equivalence.controls?.substitutionObserved, false, 'source equivalence observed control substitution');
  assert.equal(equivalence.claimBoundary?.causalQuestion, CAUSAL_QUESTION, 'source equivalence causal question drifted');
  assert.equal(equivalence.claimBoundary?.cheaperDemoClaim, false, 'source equivalence carries a cheaper-demo claim');
  assert.equal(equivalence.claimBoundary?.resizedGrid160Evidence, false, 'source equivalence resized Grid160 evidence');
  assert.equal(equivalence.claimBoundary?.learnerCampaign, false, 'source equivalence absorbed a learner campaign');
  assert.equal(equivalence.claimBoundary?.depositionAdjudication, false, 'source equivalence absorbed deposition adjudication');
  for (const key of SOURCE_HASH_KEYS) {
    assert.match(equivalence.sourceHashes?.[key] || '', HEX_SHA256, `source equivalence ${key} is missing or invalid`);
  }
  return true;
}

export function buildGrid96SourceComponentProducer({
  authoritativeSource,
  equivalence,
  requestedUrl,
  runtimeIdentity,
  replay,
  sourceHashes,
  rows,
  causalControlIdentity,
  producerProvenance,
}) {
  validateGrid96SourceComponentAuthority(authoritativeSource, equivalence);
  assert.equal(requestedUrl, equivalence.route?.candidateRequested, 'producer requested route differs from source equivalence');
  assert.equal(runtimeIdentity?.grid, GRID, 'producer runtime is not native Grid96');
  assert.equal(runtimeIdentity.effectiveRoute, ROUTE, 'producer runtime did not use the native route');
  assert.equal(runtimeIdentity.effectiveRoute, equivalence.route?.candidateEffective, 'producer effective route differs from source equivalence');
  assert.match(runtimeIdentity.backend || '', /^WebGPU:/, 'producer backend is not WebGPU');
  assert.equal(runtimeIdentity.backend, equivalence.route?.candidateBackend, 'producer backend differs from source equivalence');
  assert.equal(equivalence.route?.fallbackUsed, false, 'source equivalence used a fallback');
  assert.equal(equivalence.controls?.candidateRequested, equivalence.controls?.candidateEffective, 'source-equivalent controls were substituted');
  assert.equal(equivalence.controls?.substitutionObserved, false, 'source equivalence observed control substitution');

  assert.equal(replay?.completedSteps, 120, 'producer replay did not reach exact state 120');
  assert.equal(replay?.grid, GRID, 'producer replay is not native Grid96');
  assert.ok(Number.isInteger(rows?.count) && rows.count > 0, 'producer retained zero admitted rows');
  assert.equal(rows.sourceRowCount, CELL_COUNT, 'producer did not drain the full source grid');
  assert.equal(rows.sampleCap, null, 'producer installed a sample cap');
  assert.equal(rows.droppedRowCount, 0, 'producer dropped rows');
  assert.equal(rows.overflowCount ?? 0, 0, 'producer overflowed');

  for (const key of SOURCE_HASH_KEYS) {
    assert.match(sourceHashes?.[key] || '', HEX_SHA256, `producer ${key} is missing or invalid`);
    const label = key.replace(/Sha256$/, '').replace('boundarySidecar', 'boundary');
    assert.equal(sourceHashes[key], equivalence.sourceHashes?.[key], `${label} checksum differs from source equivalence`);
  }
  assert.match(causalControlIdentity || '', RECEIPT_IDENTITY, 'causal control subset identity is missing or invalid');
  assert.equal(producerProvenance?.targetCaptureStarted, false, 'source-only producer started target capture');
  assert.equal(producerProvenance?.trainingStarted, false, 'source-only producer started training');
  assert.equal(producerProvenance?.learnerInvoked, false, 'source-only producer invoked a learner');

  const payload = {
    schema: PRODUCER_SCHEMA,
    status: 'complete',
    failurePhase: null,
    authority: PRODUCER_AUTHORITY,
    route: {
      requested: requestedUrl,
      effective: runtimeIdentity.effectiveRoute,
      backend: runtimeIdentity.backend,
      fallbackReason: null,
    },
    sourceEquivalenceIdentity: equivalence.identity,
    authoritativeSourceIdentity: authoritativeSource.identity,
    requestedControlIdentity: equivalence.controls.candidateRequested,
    effectiveControlIdentity: equivalence.controls.candidateEffective,
    sampleCap: null,
    droppedRowCount: 0,
    overflowCount: 0,
    state: {
      id: STATE_ID,
      replay: {
        identity: REPLAY_IDENTITY,
        requestedSteps: 120,
        completedSteps: replay.completedSteps,
        grid: replay.grid,
        effectiveRoute: runtimeIdentity.effectiveRoute,
        backend: runtimeIdentity.backend,
      },
      sourceHashes: { ...sourceHashes },
      causalControlIdentity,
      rows,
    },
    claimBoundary: {
      causalQuestion: CAUSAL_QUESTION,
      cheaperDemoClaim: false,
      resizedGrid160Evidence: false,
      learnerCampaign: false,
      depositionAdjudication: false,
    },
    producerProvenance,
  };
  return { ...payload, identity: `sha256:${sha256(Buffer.from(stableJson(payload)))}` };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
