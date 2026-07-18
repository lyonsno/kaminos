import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const contractUrl = new URL('../volume-boundary-splat-extinction-common-ledger-report.mjs', import.meta.url);
assert.ok(
  existsSync(contractUrl),
  'Census must own a durable extinction-correct common-ledger validator before sparse transport evidence can close',
);

const {
  EXTINCTION_COMMON_LEDGER_SCHEMA,
  validateExtinctionCommonLedgerReport,
} = await import(contractUrl.href);

const EXPECTED = {
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:apple',
  rendererIdentity: 'shared-linear-hdr-sparse-splat-positive-residual-v0',
  modelIdentity: 'analytical-exact-local-layer-coefficients-v0',
  recurrenceIdentity: 'ordered-emission-extinction-shared-transmittance-v0',
  depthAuthority: 'camera-depth-far-to-near-v0',
  cohortSchema: 'persistent-sparse-cohort-export-v0',
  cohortManifestSha256: '4a93aeefe7eebec06f039dd35bd2947e4e76f292eadd7b7719e02235d062ac20',
  cohortAuthority: 'accepted-report-replayed-native-membership-consumer-arrays-v0',
  coefficientAuthority: 'exact-local-layer-emission-extinction',
  implementationBundleSha256: '603398858e2c8dac638f82a43a13f45d5e8f72c88ae1d2eb0d96f761e5e0853f',
  ownershipAuthority: 'complementary-local-optical-coefficient-ownership-v0',
  fullCandidateCount: 1_925_788,
  sparseCandidateCount: 481_447,
  stateIds: ['coefficient-state-114', 'coefficient-state-116', 'coefficient-state-118', 'coefficient-state-120'],
  armIds: ['full-correct', 'sparse-drop', 'sparse-conservative', 'sparse-positive-complement'],
  residualGridScale: 0.10,
  residualRaySteps: 64,
  width: 900,
  height: 960,
  cameraSha256: '9'.repeat(64),
  fullMembershipSha256ByState: {
    'coefficient-state-114': '72d7974613d4a89e84d28745aad7c7a4438a69d2cd2150e27c58444a836ba93e',
    'coefficient-state-116': '8e828abb093e7aacfb4c312bc1f1fa966d85237f27d556e4e24f7fc0397c7f19',
    'coefficient-state-118': 'd427f7ed8809bf6ad950b8755a9a0d1160359e80a91bee5bdac448ba6133ed01',
    'coefficient-state-120': '515ef62abd28769004da1737fd724f7e04e20c5a01796943b4b160cc858691bd',
  },
  sparseMembershipSha256ByState: {
    'coefficient-state-114': '68fc1ca471bdd6f2e2a65441309992250b31c2afc282912f5d76470715ac2cd3',
    'coefficient-state-116': 'b44bba4f365dd0fb60f42a13c4b6326c3b1cbbf7cbe8e9d6b9016dbc854134e4',
    'coefficient-state-118': 'd42fdf2e8694abf525e764a17da08507f747f4caf216cac23b35970b14f47cb3',
    'coefficient-state-120': 'd6a3aa9cb8515fdc050efd0a44111ece272109768793a83cdc63ca03918b3296',
  },
};

function coefficientLedger(armId) {
  const sourceEmission = 1000;
  const sourceExtinction = 800;
  if (armId === 'full-correct') {
    return {
      emission: { source: sourceEmission, splat: sourceEmission, residual: 0, dropped: 0 },
      extinction: { source: sourceExtinction, splat: sourceExtinction, residual: 0, dropped: 0 },
    };
  }
  if (armId === 'sparse-drop') {
    return {
      emission: { source: sourceEmission, splat: 320, residual: 0, dropped: 680 },
      extinction: { source: sourceExtinction, splat: 260, residual: 0, dropped: 540 },
    };
  }
  if (armId === 'sparse-conservative') {
    return {
      emission: { source: sourceEmission, splat: sourceEmission, residual: 0, dropped: 0 },
      extinction: { source: sourceExtinction, splat: sourceExtinction, residual: 0, dropped: 0 },
    };
  }
  return {
    emission: { source: sourceEmission, splat: 320, residual: 680, dropped: 0 },
    extinction: { source: sourceExtinction, splat: 260, residual: 540, dropped: 0 },
  };
}

function validArm(armId, stateId) {
  const full = armId === 'full-correct';
  const residual = armId === 'sparse-positive-complement';
  const stages = {
    selection: { status: 'sampled', ms: 0 },
    compaction: { status: 'sampled', ms: full ? 0 : 4.7 },
    deposition: { status: 'sampled', ms: residual ? 1.1 : 0 },
    splatRaster: { status: 'sampled', ms: full ? 20.6 : 3.8 },
    residualMarch: { status: 'sampled', ms: residual ? 2.4 : 0 },
    reconstruction: { status: 'sampled', ms: residual ? 0.7 : 0 },
    composition: { status: 'sampled', ms: 0.3 },
  };
  const charged = Object.values(stages).reduce((sum, stage) => sum + stage.ms, 0);
  return {
    armId,
    stateId,
    role: full ? 'reference' : 'comparison',
    requestedCandidateCount: full ? EXPECTED.fullCandidateCount : EXPECTED.sparseCandidateCount,
    effectiveCandidateCount: full ? EXPECTED.fullCandidateCount : EXPECTED.sparseCandidateCount,
    membershipSha256: full
      ? EXPECTED.fullMembershipSha256ByState[stateId]
      : EXPECTED.sparseMembershipSha256ByState[stateId],
    recurrenceIdentity: EXPECTED.recurrenceIdentity,
    depthAuthority: EXPECTED.depthAuthority,
    coefficientAuthority: EXPECTED.coefficientAuthority,
    coefficientDisposition: {
      'full-correct': 'all-source-coefficients-in-splats-v0',
      'sparse-drop': 'omitted-coefficients-dropped-ablation-v0',
      'sparse-conservative': 'omitted-coefficients-redistributed-to-splats-v0',
      'sparse-positive-complement': 'complementary-coefficients-in-positive-residual-v0',
    }[armId],
    coefficientLedger: coefficientLedger(armId),
    residual: {
      enabled: residual,
      requestedGridScale: EXPECTED.residualGridScale,
      effectiveGridScale: EXPECTED.residualGridScale,
      requestedRaySteps: EXPECTED.residualRaySteps,
      effectiveRaySteps: EXPECTED.residualRaySteps,
      imageResidualUsed: false,
      independentlyToneMapped: false,
      postToneMapAddition: false,
    },
    accounting: {
      hiddenCapInstalled: false,
      hiddenTimeoutInstalled: false,
      candidateCopyBytes: 0,
      finalOverflowCount: 0,
      fallbackReason: null,
    },
    timing: {
      timestampStatus: 'available',
      timeUnit: 'ms',
      stages: {
        ...stages,
        chargedTotal: { status: 'sampled', ms: charged },
      },
    },
    metrics: {
      authority: 'linear-hdr-pre-tonemap-matched-reference-v0',
      radianceMae: full ? 0 : 0.04,
      opticalDepthMae: full ? 0 : 0.03,
      transmittanceMae: full ? 0 : 0.02,
      silhouetteIou: full ? 1 : 0.97,
      temporalDeltaMae: full ? 0 : 0.01,
    },
    capture: {
      authority: 'gpu-linear-hdr-readback-live-held-state-v0',
      freshnessStatus: 'live-controlled-capture',
      captureNonce: `${stateId}-${armId}-r1`,
      width: EXPECTED.width,
      height: EXPECTED.height,
      finitePixelCount: EXPECTED.width * EXPECTED.height,
      litPixels: 180_000,
      rgbaFloatCount: EXPECTED.width * EXPECTED.height * 4,
      linearHdrSha256: `${stateId.at(-1)}${({
        'full-correct': 'f',
        'sparse-drop': 'd',
        'sparse-conservative': 'c',
        'sparse-positive-complement': 'e',
      })[armId]}`.repeat(32),
    },
  };
}

function validReport() {
  return {
    schema: EXTINCTION_COMMON_LEDGER_SCHEMA,
    status: 'captured',
    failurePhase: null,
    lastTrustworthyEvidence: 'all route, source, ownership, timing, metric, and capture gates passed',
    durableReportPath: '/durable/extinction-common-ledger-report.json',
    route: {
      requestedRoute: EXPECTED.effectiveRoute,
      effectiveRoute: EXPECTED.effectiveRoute,
      backend: EXPECTED.backend,
      rendererIdentity: EXPECTED.rendererIdentity,
      modelIdentity: EXPECTED.modelIdentity,
      recurrenceIdentity: EXPECTED.recurrenceIdentity,
      depthAuthority: EXPECTED.depthAuthority,
      fallbackReason: null,
    },
    source: {
      cohortSchema: EXPECTED.cohortSchema,
      cohortManifestSha256: EXPECTED.cohortManifestSha256,
      cohortAuthority: EXPECTED.cohortAuthority,
      coefficientAuthority: EXPECTED.coefficientAuthority,
      implementationBundleSha256: EXPECTED.implementationBundleSha256,
      ownershipAuthority: EXPECTED.ownershipAuthority,
      selectionRerun: false,
      residualAwareRetargeting: false,
      supportRedefined: false,
      coefficientsRedefined: false,
      covarianceRedefined: false,
      radianceRetuned: false,
      cameraRedefined: false,
    },
    request: {
      stateIds: [...EXPECTED.stateIds],
      armIds: [...EXPECTED.armIds],
      fullCandidateCount: EXPECTED.fullCandidateCount,
      sparseCandidateCount: EXPECTED.sparseCandidateCount,
      residualGridScale: EXPECTED.residualGridScale,
      residualRaySteps: EXPECTED.residualRaySteps,
      width: EXPECTED.width,
      height: EXPECTED.height,
    },
    effective: {
      stateIds: [...EXPECTED.stateIds],
      armIds: [...EXPECTED.armIds],
      fullCandidateCount: EXPECTED.fullCandidateCount,
      sparseCandidateCount: EXPECTED.sparseCandidateCount,
      residualGridScale: EXPECTED.residualGridScale,
      residualRaySteps: EXPECTED.residualRaySteps,
      width: EXPECTED.width,
      height: EXPECTED.height,
    },
    states: EXPECTED.stateIds.map(stateId => ({
      stateId,
      cameraSha256: EXPECTED.cameraSha256,
      arms: EXPECTED.armIds.map(armId => validArm(armId, stateId)),
    })),
  };
}

function validate(report) {
  return validateExtinctionCommonLedgerReport(report, EXPECTED);
}

function expectRejected(label, mutate, expectedError) {
  const report = structuredClone(validReport());
  mutate(report);
  const result = validate(report);
  assert.equal(result.ok, false, `${label} must be rejected`);
  assert.ok(result.errors.includes(expectedError), `${label} must report ${expectedError}; got ${result.errors.join(', ')}`);
}

const valid = validate(validReport());
assert.equal(valid.ok, true, valid.errors.join(', '));
assert.equal(valid.accounting.stateCount, 4);
assert.equal(valid.accounting.armCount, 16);

expectRejected('wrong effective route', report => { report.route.effectiveRoute = 'fallback-canvas-v0'; }, 'wrong-effective-route');
expectRejected('wrong backend', report => { report.route.backend = 'WebGL2'; }, 'wrong-backend');
expectRejected('wrong renderer', report => { report.route.rendererIdentity = 'additive-splats-v0'; }, 'wrong-renderer-identity');
expectRejected('wrong model', report => { report.route.modelIdentity = 'learned-residual-v0'; }, 'wrong-model-identity');
expectRejected('wrong recurrence', report => { report.route.recurrenceIdentity = 'additive-radiance-v0'; }, 'wrong-recurrence-identity');
expectRejected('wrong depth authority', report => { report.route.depthAuthority = 'unordered-v0'; }, 'wrong-depth-authority');
expectRejected('fallback', report => { report.route.fallbackReason = 'webgpu-unavailable'; }, 'fallback-present');
expectRejected('wrong cohort schema', report => { report.source.cohortSchema = 'ad-hoc-selection-v0'; }, 'cohort-schema-mismatch');
expectRejected('stale cohort digest', report => { report.source.cohortManifestSha256 = '0'.repeat(64); }, 'cohort-manifest-mismatch');
expectRejected('wrong cohort authority', report => { report.source.cohortAuthority = 'self-consistent-cache-v0'; }, 'cohort-authority-mismatch');
expectRejected('wrong producer bundle', report => { report.source.implementationBundleSha256 = '0'.repeat(64); }, 'implementation-bundle-mismatch');
expectRejected('selection rerun', report => { report.source.selectionRerun = true; }, 'selection-rerun');
expectRejected('residual retargeting', report => { report.source.residualAwareRetargeting = true; }, 'residual-aware-retargeting');
expectRejected('support redefinition', report => { report.source.supportRedefined = true; }, 'support-redefined');
expectRejected('coefficient redefinition', report => { report.source.coefficientsRedefined = true; }, 'coefficients-redefined');
expectRejected('covariance redefinition', report => { report.source.covarianceRedefined = true; }, 'covariance-redefined');
expectRejected('radiance retune', report => { report.source.radianceRetuned = true; }, 'radiance-retuned');
expectRejected('camera redefinition', report => { report.source.cameraRedefined = true; }, 'camera-redefined');
expectRejected('stale effective states', report => { report.effective.stateIds.pop(); }, 'effective-state-set-mismatch');
expectRejected('stale effective arms', report => { report.effective.armIds.pop(); }, 'effective-arm-set-mismatch');
expectRejected('stale effective sparse budget', report => { report.effective.sparseCandidateCount -= 1; }, 'requested-effective-sparse-count-mismatch');
expectRejected('hidden resolution substitution', report => { report.effective.width = 450; }, 'requested-effective-resolution-mismatch');
expectRejected('hidden residual grid substitution', report => { report.effective.residualGridScale = 0.2; }, 'requested-effective-grid-scale-mismatch');
expectRejected('hidden residual step substitution', report => { report.effective.residualRaySteps = 32; }, 'requested-effective-ray-steps-mismatch');
expectRejected('partial state set', report => { report.states.pop(); }, 'state-set-mismatch');
expectRejected('wrong camera', report => { report.states[1].cameraSha256 = 'a'.repeat(64); }, 'camera-hash-mismatch');
expectRejected('partial arm set', report => { report.states[0].arms.pop(); }, 'state-arm-set-mismatch');
expectRejected('stale arm state', report => { report.states[0].arms[0].stateId = EXPECTED.stateIds[1]; }, 'arm-state-mismatch');
expectRejected('stale sparse count', report => { report.states[0].arms[1].effectiveCandidateCount -= 1; }, 'arm-requested-effective-count-mismatch');
expectRejected('wrong membership', report => { report.states[1].arms[2].membershipSha256 = 'a'.repeat(64); }, 'sparse-membership-mismatch-within-state');
expectRejected('state-swapped sparse membership', report => {
  for (const arm of report.states[0].arms.slice(1)) {
    arm.membershipSha256 = EXPECTED.sparseMembershipSha256ByState['coefficient-state-116'];
  }
}, 'sparse-membership-state-binding-mismatch');
expectRejected('state-swapped full membership', report => {
  report.states[0].arms[0].membershipSha256 = EXPECTED.fullMembershipSha256ByState['coefficient-state-116'];
}, 'full-membership-state-binding-mismatch');
expectRejected('full and sparse membership alias', report => {
  report.states[0].arms[0].membershipSha256 = report.states[0].arms[1].membershipSha256;
}, 'full-sparse-membership-alias');
expectRejected('arm recurrence drift', report => { report.states[0].arms[3].recurrenceIdentity = 'additive-radiance-v0'; }, 'arm-recurrence-mismatch');
expectRejected('arm coefficient drift', report => { report.states[0].arms[3].coefficientAuthority = 'learned-residual-v0'; }, 'arm-coefficient-authority-mismatch');
expectRejected('duplicated emission', report => { report.states[0].arms[3].coefficientLedger.emission.residual += 10; }, 'emission-ledger-not-conservative');
expectRejected('duplicated extinction', report => { report.states[0].arms[3].coefficientLedger.extinction.residual += 10; }, 'extinction-ledger-not-conservative');
expectRejected('cross-arm source emission drift', report => {
  const ledger = report.states[0].arms[1].coefficientLedger.emission;
  ledger.source += 10;
  ledger.dropped += 10;
}, 'cross-arm-source-emission-mismatch');
expectRejected('cross-arm source extinction drift', report => {
  const ledger = report.states[0].arms[1].coefficientLedger.extinction;
  ledger.source += 10;
  ledger.dropped += 10;
}, 'cross-arm-source-extinction-mismatch');
expectRejected('complement does not restore dropped emission', report => {
  const ledger = report.states[0].arms[3].coefficientLedger.emission;
  ledger.splat += 10;
  ledger.residual -= 10;
}, 'drop-complement-emission-mismatch');
expectRejected('complement does not restore dropped extinction', report => {
  const ledger = report.states[0].arms[3].coefficientLedger.extinction;
  ledger.splat += 10;
  ledger.residual -= 10;
}, 'drop-complement-extinction-mismatch');
expectRejected('positive complement drops coefficients', report => { report.states[0].arms[3].coefficientLedger.emission.dropped = 1; }, 'positive-complement-drops-coefficients');
expectRejected('drop arm breaks conservation', report => { report.states[0].arms[1].coefficientLedger.emission.dropped = 0; }, 'emission-ledger-not-conservative');
expectRejected('drop arm routes emission through residual', report => {
  const ledger = report.states[0].arms[1].coefficientLedger.emission;
  ledger.residual += 10;
  ledger.dropped -= 10;
}, 'drop-emission-policy-mismatch');
expectRejected('drop arm routes extinction through residual', report => {
  const ledger = report.states[0].arms[1].coefficientLedger.extinction;
  ledger.residual += 10;
  ledger.dropped -= 10;
}, 'drop-extinction-policy-mismatch');
expectRejected('image residual', report => { report.states[0].arms[3].residual.imageResidualUsed = true; }, 'image-residual-used');
expectRejected('independent tone mapping', report => { report.states[0].arms[3].residual.independentlyToneMapped = true; }, 'independent-tone-map-used');
expectRejected('post tone-map addition', report => { report.states[0].arms[3].residual.postToneMapAddition = true; }, 'post-tonemap-addition-used');
expectRejected('stale arm grid scale', report => { report.states[0].arms[3].residual.effectiveGridScale = 0.2; }, 'arm-grid-scale-mismatch');
expectRejected('stale arm ray steps', report => { report.states[0].arms[3].residual.effectiveRaySteps = 32; }, 'arm-ray-steps-mismatch');
expectRejected('hidden cap', report => { report.states[0].arms[1].accounting.hiddenCapInstalled = true; }, 'hidden-cap-installed');
expectRejected('hidden timeout', report => { report.states[0].arms[1].accounting.hiddenTimeoutInstalled = true; }, 'hidden-timeout-installed');
expectRejected('copy', report => { report.states[0].arms[1].accounting.candidateCopyBytes = 64; }, 'candidate-copy-present');
expectRejected('final overflow', report => { report.states[0].arms[1].accounting.finalOverflowCount = 1; }, 'final-overflow-present');
expectRejected('arm fallback', report => { report.states[0].arms[1].accounting.fallbackReason = 'capacity'; }, 'arm-fallback-present');
expectRejected('partial timestamps', report => { report.states[0].arms[3].timing.stages.residualMarch.ms = null; }, 'partial-stage-timestamps');
expectRejected('dishonest charged total', report => { report.states[0].arms[3].timing.stages.chargedTotal.ms -= 1; }, 'charged-total-mismatch');
expectRejected('post-tonemap metrics', report => { report.states[0].arms[1].metrics.authority = 'srgb-post-tonemap-v0'; }, 'metric-authority-mismatch');
expectRejected('invalid transmittance metric', report => { report.states[0].arms[1].metrics.transmittanceMae = null; }, 'transport-metrics-invalid');
expectRejected('invalid silhouette metric', report => { report.states[0].arms[1].metrics.silhouetteIou = 1.1; }, 'silhouette-metric-invalid');
expectRejected('cached output', report => { report.states[0].arms[1].capture.freshnessStatus = 'cached'; }, 'capture-not-live');
expectRejected('reused HDR payload', report => {
  report.states[1].arms[1].capture.linearHdrSha256 = report.states[0].arms[1].capture.linearHdrSha256;
}, 'capture-sha256-reused-across-states');
expectRejected('blank output', report => { report.states[0].arms[1].capture.litPixels = 0; }, 'blank-capture');
expectRejected('partial HDR output', report => { report.states[0].arms[1].capture.rgbaFloatCount -= 4; }, 'capture-payload-partial');
expectRejected('missing capture nonce', report => { report.states[0].arms[1].capture.captureNonce = ''; }, 'capture-nonce-missing');
expectRejected('missing durable report', report => { report.durableReportPath = ''; }, 'durable-report-path-missing');

const durableFailure = validReport();
durableFailure.status = 'failed';
durableFailure.failurePhase = 'hybrid-composition';
durableFailure.lastTrustworthyEvidence = 'cohort and ownership ledgers authenticated before GPU dispatch';
durableFailure.durableReportPath = '/durable/failed-extinction-common-ledger-report.json';
const acceptedFailure = validate(durableFailure);
assert.equal(acceptedFailure.ok, true, acceptedFailure.errors.join(', '));
assert.equal(acceptedFailure.status, 'failed');

expectRejected('failure without phase', report => {
  report.status = 'failed';
  report.failurePhase = null;
}, 'failure-phase-missing');
expectRejected('failure without last evidence', report => {
  report.status = 'failed';
  report.failurePhase = 'hybrid-composition';
  report.lastTrustworthyEvidence = '';
}, 'last-trustworthy-evidence-missing');

console.log('boundary splat extinction common-ledger report contracts passed');
