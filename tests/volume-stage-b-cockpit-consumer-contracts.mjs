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
const acceptanceBytes = new TextEncoder().encode('{"stage":"b","status":"accepted"}');
const acceptanceSha256 = sha(acceptanceBytes);
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
      path: 'captures/optical.mp4',
      bytes: 256,
      sha256: sha('optical'),
      mediaType: 'video/mp4',
      frameCount: 21,
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

const manifestUrl = 'http://127.0.0.1:18782/manifests/stage-b.json';
const resourceLoadReceipts = manifest.artifacts.map(artifact => ({
  id: artifact.id,
  requestedUrl: new URL(artifact.path, manifestUrl).href,
  effectiveUrl: new URL(artifact.path, manifestUrl).href,
  requestedSha256: artifact.sha256,
  effectiveSha256: artifact.sha256,
  requestedBytes: artifact.bytes,
  effectiveBytes: artifact.bytes,
  status: 'loaded',
  fallbackUsed: false,
}));

assert.equal(STAGE_B_COCKPIT_CONSUMER.identity, 'matched-optical-recurrence-v0');
assert.equal(STAGE_B_COCKPIT_CONSUMER.disabledReason, 'stage-b-resources-missing');
assert.equal(STAGE_B_COCKPIT_CONSUMER.provisionalAuthority, 'producer-evidence-unverified');
assert.equal(STAGE_B_COCKPIT_CONSUMER.provisionalScope, 'operator-exploration-only');

const unavailable = admitStageBCockpitManifest({
  requestedTreatment: 'matched-optical-recurrence-v0',
  requestedManifestUrl: null,
  requestedManifestSha256: null,
});
assert.equal(unavailable.status, 'disabled');
assert.equal(unavailable.disabledReason, 'stage-b-resources-missing');
assert.equal(unavailable.resourceState, 'missing');
assert.equal(unavailable.requestedTreatment, 'matched-optical-recurrence-v0');
assert.equal(unavailable.effectiveTreatment, null);
assert.equal(unavailable.fallbackUsed, false);
assert.deepEqual(unavailable.passes.applied, []);
assert.deepEqual(unavailable.resources, []);

const admitted = admitStageBCockpitManifest({
  requestedTreatment: 'matched-optical-recurrence-v0',
  requestedManifestUrl: manifestUrl,
  requestedManifestSha256: manifestSha256,
  effectiveManifestUrl: manifestUrl,
  effectiveManifestSha256: manifestSha256,
  manifest,
  resourceLoadReceipts,
});
assert.equal(admitted.status, 'effective');
assert.equal(admitted.effectiveTreatment, 'matched-optical-recurrence-v0');
assert.equal(admitted.resourceState, 'complete');
assert.equal(admitted.authority.evidenceAuthority, 'producer-evidence-unverified');
assert.equal(admitted.authority.operatorScope, 'operator-exploration-only');
assert.equal(admitted.authority.decisionBearing, false);
assert.equal(admitted.fallbackUsed, false);
assert.deepEqual(admitted.passes.applied, ['manifest-validation', 'resource-binding', 'resource-load-verification']);
assert.equal(admitted.passes.rendererApplied, false, 'manifest admission must not pretend the renderer pass already ran');
assert.equal(admitted.resources.length, 2);
assert.equal(admitted.resources[0].effectiveUrl, 'http://127.0.0.1:18782/manifests/captures/presentation.png');
assert.equal(admitted.resources[1].effectiveRoute, 'matched-optical-recurrence-v0');
assert.equal(admitted.authority.backend, 'WebGPU:apple');
assert.equal(admitted.authority.fallbackReason, null);
assert.equal(admitted.authoredFork.outputPath, manifest.authoredFork.outputPath);

const acceptanceReceipt = {
  schema: 'kaminos.pyro-cockpit-manifest-acceptance.v0',
  status: 'accepted',
  manifestSha256,
  manifestSourceCommit: manifest.source.commit,
  acceptedBy: 'pyro-radiance-transfer-bailiff',
  acceptanceHead: 'b'.repeat(40),
  acceptanceReportSha256: sha('accepted-report'),
  evidenceAuthority: 'producer-evidence-accepted',
  visualQuality: 'operator-unseen',
  operatorScope: 'operator-exploration-pending',
  decisionBearing: false,
  presentationAuthority: 'producer-capture-media-v0',
  producerCaptureArtifactId: 'matched-optical',
  sameStateCaptureId: 'filament-orbit-f96-s96',
};
const accepted = admitStageBCockpitManifest({
  requestedTreatment: 'matched-optical-recurrence-v0',
  requestedManifestUrl: manifestUrl,
  requestedManifestSha256: manifestSha256,
  effectiveManifestUrl: manifestUrl,
  effectiveManifestSha256: manifestSha256,
  manifest,
  resourceLoadReceipts,
  requestedAcceptanceUrl: 'http://127.0.0.1:18782/manifests/stage-b-acceptance.json',
  requestedAcceptanceSha256: acceptanceSha256,
  effectiveAcceptanceUrl: 'http://127.0.0.1:18782/manifests/stage-b-acceptance.json',
  effectiveAcceptanceSha256: acceptanceSha256,
  acceptanceReceipt,
});
assert.equal(accepted.status, 'effective');
assert.equal(accepted.authority.evidenceAuthority, 'producer-evidence-accepted');
assert.equal(accepted.authority.visualQuality, 'operator-unseen');
assert.equal(accepted.authority.operatorScope, 'operator-exploration-pending');
assert.equal(accepted.authority.decisionBearing, false);
assert.equal(accepted.authority.acceptanceHead, acceptanceReceipt.acceptanceHead);
assert.equal(accepted.authority.acceptanceReportSha256, acceptanceReceipt.acceptanceReportSha256);
assert.equal(accepted.effectiveAcceptanceSha256, acceptanceSha256);
assert.equal(accepted.presentationAuthority, 'producer-capture-media-v0');
assert.equal(accepted.producerCapture.id, 'matched-optical');
assert.equal(accepted.producerCapture.mediaType, 'video/mp4');
assert.equal(accepted.passes.rendererRequested, false, 'accepted producer media must not request the unrelated local renderer');
assert.equal(accepted.passes.producerMediaApplied, false, 'manifest admission must not pretend producer media is already presented');

for (const [label, mutate, expected] of [
  ['acceptance manifest hash substitution', receipt => { receipt.manifestSha256 = sha('wrong-manifest'); }, /acceptance-manifest-hash-substitution/],
  ['acceptance source commit substitution', receipt => { receipt.manifestSourceCommit = 'c'.repeat(40); }, /acceptance-source-commit-substitution/],
  ['acceptance state substitution', receipt => { receipt.sameStateCaptureId = 'filament-orbit-f120-s120'; }, /acceptance-state-identity-substitution/],
  ['acceptance visual overclaim', receipt => { receipt.visualQuality = 'operator-approved'; }, /acceptance-visual-quality-overclaim/],
  ['acceptance decision-bearing overclaim', receipt => { receipt.decisionBearing = true; }, /acceptance-decision-bearing-overclaim/],
]) {
  const receipt = structuredClone(acceptanceReceipt);
  mutate(receipt);
  const rejected = admitStageBCockpitManifest({
    requestedTreatment: 'matched-optical-recurrence-v0',
    requestedManifestUrl: manifestUrl,
    requestedManifestSha256: manifestSha256,
    effectiveManifestUrl: manifestUrl,
    effectiveManifestSha256: manifestSha256,
    manifest: structuredClone(manifest),
    resourceLoadReceipts: structuredClone(resourceLoadReceipts),
    requestedAcceptanceUrl: 'http://127.0.0.1:18782/manifests/stage-b-acceptance.json',
    requestedAcceptanceSha256: acceptanceSha256,
    effectiveAcceptanceUrl: 'http://127.0.0.1:18782/manifests/stage-b-acceptance.json',
    effectiveAcceptanceSha256: acceptanceSha256,
    acceptanceReceipt: receipt,
  });
  assert.notEqual(rejected.status, 'effective', label);
  assert.match(rejected.failures.join(','), expected, label);
}

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
    resourceLoadReceipts: structuredClone(resourceLoadReceipts),
  };
  mutate(input);
  const receipt = admitStageBCockpitManifest(input);
  assert.notEqual(receipt.status, 'effective', label);
  assert.match(receipt.failures.join(','), expected, label);
  assert.equal(receipt.effectiveTreatment, null, label);
  assert.deepEqual(receipt.passes.applied, [], label);
  assert.equal(receipt.fallbackUsed, false, label);
}

for (const [label, mutate, expected] of [
  ['missing loaded resource', loads => { loads.pop(); }, /stage-b-resource-load-incomplete/],
  ['loaded resource hash substitution', loads => { loads[0].effectiveSha256 = sha('wrong-resource'); }, /stage-b-resource-hash-substitution:original-presentation/],
  ['loaded resource route substitution', loads => { loads[1].effectiveUrl += '?fallback=1'; }, /stage-b-resource-route-substitution:matched-optical/],
  ['loaded resource fallback', loads => { loads[1].fallbackUsed = true; }, /stage-b-resource-fallback:matched-optical/],
]) {
  const loads = structuredClone(resourceLoadReceipts);
  mutate(loads);
  const receipt = admitStageBCockpitManifest({
    requestedTreatment: 'matched-optical-recurrence-v0',
    requestedManifestUrl: manifestUrl,
    requestedManifestSha256: manifestSha256,
    effectiveManifestUrl: manifestUrl,
    effectiveManifestSha256: manifestSha256,
    manifest: structuredClone(manifest),
    resourceLoadReceipts: loads,
  });
  assert.notEqual(receipt.status, 'effective', label);
  assert.match(receipt.failures.join(','), expected, label);
  assert.equal(receipt.effectiveTreatment, null, label);
  assert.equal(receipt.passes.rendererApplied, false, label);
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

const [index, session, selectiveLive, witness, core] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../volume-full-support-cockpit-session.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../volume-selective-head-live.html', import.meta.url), 'utf8'),
  readFile(new URL('../volume-full-support-cockpit-witness.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../volume-core.js', import.meta.url), 'utf8'),
]);
assert.match(index, /id="volume-stage-b-view"/, 'Stage B viewer must expose the producer-declared view sockets');
assert.match(index, /id="volume-stage-b-status"[^]*stage-b-resources-missing/, 'Stage B must visibly name its missing resource state before admission');
assert.match(index, /bootstrapStageBConsumer/, 'cockpit must bootstrap manifest validation and resource binding');
assert.match(index, /if \(receipt\.status === 'effective'\) return requestStageBTreatmentApply\(receipt\);[\s\S]*renderStageBReceipt\(receipt\)/, 'complete resources must publish only the serialized post-render receipt');
assert.match(index, /full_support_stage_b_manifest_sha256/, 'cockpit route must bind the requested producer manifest hash');
assert.doesNotMatch(index, /Matched optical recurrence:\s*awaiting source manifest/i, 'stale manifest-dependency language must be removed');
assert.match(session, /--stage-b-manifest/, 'session launcher must accept a caller-provided Stage B manifest');
assert.match(session, /--stage-b-manifest-sha256/, 'session launcher must accept the exact requested manifest identity');
assert.match(session, /--stage-b-acceptance-receipt/, 'session launcher must accept a distinct checksum-bound acceptance sidecar');
assert.match(index, /full_support_stage_b_acceptance_sha256/, 'cockpit route must bind the acceptance sidecar hash separately from the manifest');
assert.match(index, /producer-evidence-accepted/, 'cockpit must visibly distinguish accepted producer evidence from complete-unaccepted evidence');
assert.match(index, /producer-capture-media-v0/, 'accepted producer media must use its exact capture instead of the local analytical renderer');
assert.match(index, /volume-stage-b-producer-video/, 'accepted producer media needs an explicit Volume-viewer presentation surface');
assert.match(index, /#volume-stage-b-producer-media\s*\{[^}]*z-index:\s*[4-9]/, 'accepted producer media must stack above the active volume canvas');
assert.match(index, /producer-capture-media-play-failed/, 'producer media playback failure must remain a Stage B media failure');
assert.match(index, /catch[^]*stageBProducerMedia\.hidden\s*=\s*true/, 'failed producer media must not leave a blank overlay exposed');
assert.match(index, /let stageBTreatmentApplyPromise\s*=\s*null/, 'Stage B treatment application must have one explicit in-flight owner');
assert.match(index, /if \(stageBTreatmentApplyPromise\)[^]*joinedInFlightCount[^]*return stageBTreatmentApplyPromise/, 'concurrent Stage B treatment requests must join the active application');
assert.match(index, /sameProducerMediaAlreadyPresented[^]*reusedExistingMedia[^]*mediaSourceResetCount/, 'reapplying the same accepted producer must reuse its decoded media instead of resetting the source');
assert.match(index, /stageBApply\.disabled\s*=\s*true[^]*finally[^]*stageBApply\.disabled/, 'the Apply treatment control must remain disabled for the full application lifecycle');
assert.match(index, /finally[^]*stageBTreatmentLifecycle\.inFlight\s*=\s*false[^]*treatmentApplication\s*=\s*stageBTreatmentLifecycleReceipt[^]*renderStageBReceipt/, 'the published treatment receipt must record the completed post-finally lifecycle');
assert.match(index, /stageBApply\?\.addEventListener\('click'[^]*requestStageBTreatmentApply[^]*catch[^]*stage-b-treatment-apply-failed/, 'button-triggered treatment failures must publish a Stage B failure instead of becoming unhandled rejections');
assert.match(selectiveLive, /key\.startsWith\('full_support_'\)/, 'wrapper must preserve Stage B manifest custody parameters');
assert.match(witness, /__kaminosStageBCockpitReceipt/, 'browser witness must capture the effective Stage B consumer receipt');
assert.match(witness, /stage-b-resources-missing/, 'pre-resource witness must require the explicit missing-resource reason');
assert.match(witness, /routeReceipt\.artifacts\?\.stageBManifest/, 'browser witness must branch on the effective route receipt instead of assuming evidence absence');
assert.match(witness, /stageBReceipt\.status[^]*effective/, 'evidence-present route must admit an effective manifest and resource receipt');
assert.match(witness, /stageBReceipt\.effectiveManifestSha256[^]*stageBManifestArtifact\.sha256/, 'evidence-present witness must bind the effective manifest hash');
assert.match(witness, /full_support_stage_b_manifest[^]*stageBReceipt\.requestedManifestUrl[^]*routedStageBManifestUrl/, 'evidence-present witness must bind the requested manifest route');
assert.match(witness, /stageBReceipt\.effectiveManifestUrl[^]*routedStageBManifestUrl/, 'evidence-present witness must bind the effective manifest route');
assert.match(witness, /rendererApplied[^]*false/, 'pre-evidence witness must reject an unreported renderer application');
assert.match(witness, /producer-media-decoded-frame-admission/, 'accepted-media witness must use a distinct decoded-frame admission phase');
assert.match(witness, /videoWidth[^]*videoHeight[^]*readyState/, 'accepted-media witness must reject an undecoded or dimensionless video');
assert.match(witness, /10\s*\/\s*6[^]*currentTime/, 'accepted-media witness must advance past the producer frame-10 threshold before capture');
assert.match(witness, /requestVideoFrameCallback/, 'accepted-media witness must advance by decoded frames when the smoke server cannot seek by byte range');
assert.match(witness, /topmostElementId/, 'accepted-media witness must prove the producer layer is topmost in the viewer');
assert.match(witness, /getImageData[^]*litPixelCount[^]*lumaVariance/, 'accepted-media witness must reject decoded black frames with pixel statistics');
assert.match(witness, /occlusionProbeIds/, 'accepted-media witness must sample occlusion beyond a single center point');
assert.match(witness, /producerMediaVisualState/, 'accepted-media decoded state must survive in the durable witness report');
assert.match(witness, /sourceReceipts\.push[^]*producer-media-decoded-frame-admission[^]*Page\.captureScreenshot/, 'deterministic producer-media admission must run after source switches and immediately before capture');
assert.match(witness, /stage-b-treatment-reentry-survival[^]*Promise\.all[^]*__kaminosApplyStageBTreatment/, 'browser witness must exercise concurrent treatment requests through the public API');
assert.match(witness, /mediaSourceResetCount[^]*reusedExistingMedia[^]*joinedInFlightCount/, 'browser witness must reject repeated media resets and preserve treatment lifecycle receipts');
assert.match(witness, /browserProcessTelemetry[^]*rssKb[^]*alive/, 'browser witness must preserve process survival and memory telemetry around treatment re-entry');
assert.match(witness, /--source-sweep[^]*bootstrap-only[^]*bootstrap\.sourceReceipt/, 'treatment regression must support the already-admitted bootstrap source without redundant source reapplication');
assert.match(index, /operator-exploration-only/, 'complete unaccepted Stage B pixels must carry visible operator-only authority');
assert.match(index, /resourceLoadReceipts/, 'cockpit must verify every provisional resource load before enabling pixels');
assert.match(core, /BOUNDARY_SPLAT_OPTICAL_MODE\s*=\s*['"]matched-optical-recurrence-v0['"]/, 'exact analytical Stage B renderer mode is missing');
assert.match(core, /BOUNDARY_SPLAT_OPTICAL_DEPTH_BINS\s*=\s*16/, 'exact analytical Stage B depth-bin count is missing');
assert.match(core, /encodeBoundarySplatOpticalRecurrence/, 'exact analytical Stage B pass is not encoded');

console.log('volume Stage B cockpit consumer contracts passed');
