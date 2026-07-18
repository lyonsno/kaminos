#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const consumerUrl = new URL('../volume-stage-b-cockpit-consumer.mjs', import.meta.url);
const {
  STAGE_B_COCKPIT_CONSUMER,
  admitStageBCockpitManifest,
  buildStageBAuthoredFork,
} = await import(consumerUrl);

const sha = value => createHash('sha256').update(value).digest('hex');
const manifestBytes = new TextEncoder().encode('{"stage":"b"}');
const manifestSha256 = sha(manifestBytes);
const locked = [
  'support',
  'candidate-membership',
  'candidate-count',
  'positions',
  'covariance',
  'radius',
  'sharpness',
  'coefficients',
  'learned-attributes',
  'authored-layers',
  'simulator-state',
  'raymarch-target',
  'camera-orbit',
];
const poseHashes = Array.from({ length: 21 }, (_, index) => sha(`pose-${index}`));
const manifest = {
  schema: 'kaminos.pyro-cockpit-manifest.v0',
  status: 'complete',
  evidenceState: 'produced',
  visualQuality: 'operator-unseen',
  experiment: { identity: 'matched-splat-optical-recurrence-parity-v0', originalWitnessImmutable: true },
  producer: { identity: 'radiance-transfer-producer-v0' },
  source: {
    commit: 'a'.repeat(40),
    presentationBaselineCommit: '0859abf8d5b06359e4d2708f5b597c327b43c4af',
    sameStateCaptureId: 'filament-orbit-f96-s96',
    controlsSha256: sha('controls'),
    candidatePayloadSha256: sha('candidates'),
    supportSha256: sha('support'),
    coefficientSha256: sha('coefficients'),
    covarianceSha256: sha('covariance'),
    fluidSha256: sha('fluid'),
    frontSha256: sha('front'),
    candidateCount: 147389,
  },
  identities: {
    target: 'smoke-off-complete-flame-local-emission-extinction-v0',
    treatment: 'matched-optical-recurrence-v0',
    support: `sha256:${sha('support')}`,
    coefficient: `sha256:${sha('coefficients')}`,
    covariance: `sha256:${sha('covariance')}`,
    accumulation: 'depth-binned-emission-optical-depth-v0',
    transport: 'depth-binned-exponential-self-transmittance-v0',
    presentation: 'raymarch-matched-exponential-power-grade-v0',
  },
  artifacts: [
    {
      id: 'original-presentation',
      path: 'captures/presentation.png',
      bytes: 128,
      sha256: sha('presentation'),
      mediaType: 'image/png',
      loadRoute: 'matched-presentation-v0',
    },
    {
      id: 'matched-optical',
      path: 'captures/optical.png',
      bytes: 256,
      sha256: sha('optical'),
      mediaType: 'image/png',
      loadRoute: 'matched-optical-recurrence-v0',
    },
  ],
  routes: {
    requested: '/volume-selective-head-live.html',
    effectiveWrapper: 'exact-basin-selective-head-live-v0',
    effectiveRenderer: 'native-3d-compute-fluid-raymarch-v0',
    loadAction: 'load-cockpit-manifest-v0',
  },
  controls: {
    requestedSha256: sha('controls'),
    effectiveSha256: sha('controls'),
    locked,
    mutable: ['presentation-view', 'difference-gain', 'debug-view'],
  },
  camera: {
    orbitIdentity: 'filament-orbit-21-camera-v0',
    cameraCount: 21,
    poseHashes,
  },
  state: {
    sameStateCaptureId: 'filament-orbit-f96-s96',
    fluidSha256: sha('fluid'),
    frontSha256: sha('front'),
    historyIdentity: 'frozen-no-history-advance-v0',
  },
  renderer: {
    composition: 'splat-only-v0',
    backend: 'WebGPU:apple',
    fallbackReason: null,
    targetFormat: 'rgba16float-array',
    layerFormat: 'rgba16float',
    depthBins: {
      requested: 16,
      effective: 16,
      intervalIdentity: 'projected-ndc-zero-to-one-depth-interval-v0',
      orderingIdentity: 'far-to-near-alpha-over-v0',
      alphaIdentity: 'one-minus-exp-negative-summed-optical-depth-v0',
    },
  },
  capacity: { candidateCount: 147389, capacity: 147389, overflowCount: 0 },
  timing: { authority: 'boundary-splat-stage-gpu-timestamp-profile-v0', status: 'complete' },
  viewSockets: {
    target: 'raymarch-target-v0',
    treatment: 'matched-optical-recurrence-v0',
    difference: 'target-minus-treatment-v0',
    ridge: 'ridge-layer-isolation-v0',
    nonRidge: 'non-ridge-layer-isolation-v0',
    combined: 'ridge-plus-non-ridge-v0',
    debug: 'depth-bin-optical-debug-v0',
  },
  authoredFork: {
    outputPath: 'artifacts/authored-forks/radiance-transfer.json',
    originalWitnessImmutable: true,
    writeMode: 'create-new',
    writes: ['authored-controls', 'route-state-identities'],
  },
};

assert.equal(STAGE_B_COCKPIT_CONSUMER.identity, 'matched-optical-recurrence-v0');
assert.equal(STAGE_B_COCKPIT_CONSUMER.disabledReason, 'producer-evidence-unverified');

const unavailable = admitStageBCockpitManifest({
  requestedTreatment: 'matched-optical-recurrence-v0',
  requestedManifestUrl: null,
  requestedManifestSha256: null,
});
assert.equal(unavailable.status, 'disabled');
assert.equal(unavailable.disabledReason, 'producer-evidence-unverified');
assert.equal(unavailable.requestedTreatment, 'matched-optical-recurrence-v0');
assert.equal(unavailable.effectiveTreatment, null);
assert.equal(unavailable.fallbackUsed, false);
assert.deepEqual(unavailable.passes.applied, []);
assert.deepEqual(unavailable.resources, []);

const admitted = admitStageBCockpitManifest({
  requestedTreatment: 'matched-optical-recurrence-v0',
  requestedManifestUrl: 'http://127.0.0.1:18782/manifests/stage-b.json',
  requestedManifestSha256: manifestSha256,
  effectiveManifestUrl: 'http://127.0.0.1:18782/manifests/stage-b.json',
  effectiveManifestSha256: manifestSha256,
  manifest,
});
assert.equal(admitted.status, 'effective');
assert.equal(admitted.effectiveTreatment, 'matched-optical-recurrence-v0');
assert.equal(admitted.fallbackUsed, false);
assert.deepEqual(admitted.passes.applied, ['manifest-validation', 'resource-binding']);
assert.equal(admitted.passes.rendererApplied, false, 'manifest admission must not pretend the renderer pass already ran');
assert.equal(admitted.resources.length, 2);
assert.equal(admitted.resources[0].effectiveUrl, 'http://127.0.0.1:18782/manifests/captures/presentation.png');
assert.equal(admitted.resources[1].effectiveRoute, 'matched-optical-recurrence-v0');
assert.equal(admitted.authority.backend, 'WebGPU:apple');
assert.equal(admitted.authority.fallbackReason, null);
assert.equal(admitted.authoredFork.outputPath, manifest.authoredFork.outputPath);

for (const [label, mutate, expected] of [
  ['manifest hash substitution', input => { input.effectiveManifestSha256 = sha('wrong'); }, /manifest-hash-substitution/],
  ['manifest route substitution', input => { input.effectiveManifestUrl += '?fallback=1'; }, /manifest-route-substitution/],
  ['hidden renderer fallback', input => { input.manifest.renderer.fallbackReason = 'additive-control'; }, /renderer-fallback/],
  ['partial capacity', input => { input.manifest.capacity.overflowCount = 1; }, /capacity-overflow/],
  ['locked covariance missing', input => { input.manifest.controls.locked = input.manifest.controls.locked.filter(axis => axis !== 'covariance'); }, /locked-axis-missing:covariance/],
  ['treatment socket missing', input => { delete input.manifest.viewSockets.treatment; }, /view-socket-missing:treatment/],
  ['original overwrite admitted', input => { input.manifest.authoredFork.originalWitnessImmutable = false; }, /original-witness-mutable/],
  ['artifact role missing', input => { input.manifest.artifacts[0].id = 'debug'; }, /artifact-role-missing:original-presentation/],
  ['controls substituted', input => { input.manifest.controls.effectiveSha256 = sha('other-controls'); }, /controls-substitution/],
  ['controls drifted from source', input => {
    input.manifest.controls.requestedSha256 = sha('other-controls');
    input.manifest.controls.effectiveSha256 = sha('other-controls');
  }, /source-controls-substitution/],
  ['locked axes malformed as text', input => { input.manifest.controls.locked = input.manifest.controls.locked.join(','); }, /locked-axes-invalid/],
]) {
  const input = {
    requestedTreatment: 'matched-optical-recurrence-v0',
    requestedManifestUrl: 'http://127.0.0.1:18782/manifests/stage-b.json',
    requestedManifestSha256: manifestSha256,
    effectiveManifestUrl: 'http://127.0.0.1:18782/manifests/stage-b.json',
    effectiveManifestSha256: manifestSha256,
    manifest: structuredClone(manifest),
  };
  mutate(input);
  const receipt = admitStageBCockpitManifest(input);
  assert.equal(receipt.status, 'failed', label);
  assert.match(receipt.failures.join(','), expected, label);
  assert.equal(receipt.effectiveTreatment, null, label);
  assert.deepEqual(receipt.passes.applied, [], label);
  assert.equal(receipt.fallbackUsed, false, label);
}

const fork = buildStageBAuthoredFork({
  name: 'operator-stage-b-01',
  sourceReceipt: admitted,
  outputPath: manifest.authoredFork.outputPath,
  controls: { differenceGain: 1.25 },
  activeView: 'difference',
});
assert.equal(fork.schema, 'kaminos.pyro.stage-b-authored-fork.v0');
assert.equal(fork.originalEvidenceImmutable, true);
assert.equal(fork.sourceManifestSha256, manifestSha256);
assert.throws(
  () => buildStageBAuthoredFork({
    name: 'overwrite-source',
    sourceReceipt: admitted,
    outputPath: admitted.resources[0].path,
    controls: {},
    activeView: 'target',
  }),
  /producer artifact cannot be overwritten/,
);

const [index, session, selectiveLive, witness] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../volume-full-support-cockpit-session.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../volume-selective-head-live.html', import.meta.url), 'utf8'),
  readFile(new URL('../volume-full-support-cockpit-witness.mjs', import.meta.url), 'utf8'),
]);
assert.match(index, /id="volume-stage-b-view"/, 'Stage B viewer must expose the producer-declared view sockets');
assert.match(index, /id="volume-stage-b-status"[^]*producer-evidence-unverified/, 'Stage B must be visibly disabled before producer evidence validates');
assert.match(index, /bootstrapStageBConsumer/, 'cockpit must bootstrap manifest validation and resource binding');
assert.match(index, /full_support_stage_b_manifest_sha256/, 'cockpit route must bind the requested producer manifest hash');
assert.doesNotMatch(index, /Matched optical recurrence:\s*awaiting source manifest/i, 'stale manifest-dependency language must be removed');
assert.match(session, /--stage-b-manifest/, 'session launcher must accept a caller-provided Stage B manifest');
assert.match(session, /--stage-b-manifest-sha256/, 'session launcher must accept the exact requested manifest identity');
assert.match(selectiveLive, /key\.startsWith\('full_support_'\)/, 'wrapper must preserve Stage B manifest custody parameters');
assert.match(witness, /__kaminosStageBCockpitReceipt/, 'browser witness must capture the effective Stage B consumer receipt');
assert.match(witness, /producer-evidence-unverified/, 'pre-evidence witness must require the explicit disabled reason');
assert.match(witness, /routeReceipt\.artifacts\?\.stageBManifest/, 'browser witness must branch on the effective route receipt instead of assuming evidence absence');
assert.match(witness, /stageBReceipt\.status[^]*effective/, 'evidence-present route must admit an effective manifest and resource receipt');
assert.match(witness, /stageBReceipt\.effectiveManifestSha256[^]*stageBManifestArtifact\.sha256/, 'evidence-present witness must bind the effective manifest hash');
assert.match(witness, /full_support_stage_b_manifest[^]*stageBReceipt\.requestedManifestUrl[^]*routedStageBManifestUrl/, 'evidence-present witness must bind the requested manifest route');
assert.match(witness, /stageBReceipt\.effectiveManifestUrl[^]*routedStageBManifestUrl/, 'evidence-present witness must bind the effective manifest route');
assert.match(witness, /rendererApplied[^]*false/, 'pre-evidence witness must reject an unreported renderer application');

console.log('volume Stage B cockpit consumer contracts passed');
