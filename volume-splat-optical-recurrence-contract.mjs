import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const REPORT_SCHEMA = 'kaminos.volume.splat-optical-recurrence.v0';
const MANIFEST_SCHEMA = 'kaminos.pyro-cockpit-manifest.v0';
const PRESENTATION_BASELINE = '0859abf8d5b06359e4d2708f5b597c327b43c4af';
const WRAPPER_ROUTE = 'exact-basin-selective-head-live-v0';
const RENDERER_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const CAMERA_COUNT = 21;
const DEPTH_BINS = 16;
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const SOURCE_HASH_FIELDS = Object.freeze([
  'controlsSha256',
  'candidatePayloadSha256',
  'supportSha256',
  'coefficientSha256',
  'covarianceSha256',
]);
const LOCKED_AXES = Object.freeze([
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
]);
const REQUIRED_VIEW_SOCKETS = Object.freeze([
  'target',
  'treatment',
  'difference',
  'ridge',
  'nonRidge',
  'combined',
  'debug',
]);

function validateSource(source) {
  assert.ok(source && typeof source === 'object', 'source identity is missing');
  assert.match(source.commit || '', GIT_COMMIT, 'source commit is missing or invalid');
  assert.equal(source.presentationBaselineCommit, PRESENTATION_BASELINE, 'immutable presentation baseline changed');
  assert.match(source.sameStateCaptureId || '', /^filament-orbit-f\d+-s\d+$/, 'frozen source state identity is invalid');
  for (const field of [...SOURCE_HASH_FIELDS, 'fluidSha256', 'frontSha256']) {
    assert.match(source[field] || '', SHA256, `${field} is missing or invalid`);
  }
  assert.ok(Number.isInteger(source.candidateCount) && source.candidateCount > 0, 'candidate count is missing or invalid');
}

function validateCaptures(arm, source) {
  assert.equal(arm.captures?.length, CAMERA_COUNT, `partial orbit cannot close ${arm.id}`);
  const seen = new Set();
  for (const capture of arm.captures) {
    assert.ok(Number.isInteger(capture.cameraIndex) && capture.cameraIndex >= 0 && capture.cameraIndex < CAMERA_COUNT, `invalid camera index in ${arm.id}`);
    assert.ok(!seen.has(capture.cameraIndex), `duplicate camera index in ${arm.id}`);
    seen.add(capture.cameraIndex);
    assert.equal(capture.nonblank, true, `blank or missing capture in ${arm.id}`);
    assert.match(capture.pixelHash || '', SHA256, `capture pixel hash is missing or invalid in ${arm.id}`);
    assert.match(capture.cameraPoseHash || '', SHA256, `camera pose hash is missing or invalid in ${arm.id}`);
    for (const field of SOURCE_HASH_FIELDS) {
      assert.equal(capture[field], source[field], `${field} drift in ${arm.id}`);
    }
    assert.equal(capture.candidateCount, source.candidateCount, `candidate count changed in ${arm.id}`);
  }
}

function validatePresentationArm(arm, source) {
  assert.equal(arm.id, 'matched-presentation-v0', 'presentation control arm is missing');
  assert.equal(arm.requestedRoute, arm.id, 'presentation requested route changed');
  assert.equal(arm.effectiveRoute, arm.id, 'presentation effective route substituted');
  assert.equal(arm.targetFormat, 'rgba16float', 'presentation control target changed');
  assert.equal(arm.accumulationIdentity, 'additive-rgb-gaussian-alpha-v0', 'presentation control accumulation changed');
  assert.equal(arm.transportIdentity, 'none-additive-control-v0', 'presentation control invented optical transport');
  assert.equal(arm.presentationIdentity, 'raymarch-matched-exponential-power-grade-v0', 'presentation control grade changed');
  assert.equal(arm.fallbackReason, null, 'presentation fallback evidence cannot close');
  assert.equal(arm.intermediateClamped, false, 'clamped presentation control cannot close');
  validateCaptures(arm, source);
}

function validateOpticalArm(arm, source) {
  assert.equal(arm.id, 'matched-optical-recurrence-v0', 'matched optical arm is missing');
  assert.equal(arm.requestedRoute, arm.id, 'optical requested route changed');
  assert.equal(arm.effectiveRoute, arm.id, 'optical effective route substituted');
  assert.equal(arm.targetFormat, 'rgba16float-array', 'optical array target changed');
  assert.equal(arm.layerFormat, 'rgba16float', 'optical layer format changed');
  assert.equal(arm.accumulationIdentity, 'depth-binned-emission-optical-depth-v0', 'optical accumulation identity changed');
  assert.equal(arm.transportIdentity, 'depth-binned-exponential-self-transmittance-v0', 'optical recurrence identity changed');
  assert.equal(arm.presentationIdentity, 'raymarch-matched-exponential-power-grade-v0', 'optical presentation grade changed');
  assert.equal(arm.depthBins?.requested, DEPTH_BINS, 'requested depth-bin count changed');
  assert.equal(arm.depthBins?.effective, DEPTH_BINS, 'effective depth-bin count changed');
  assert.equal(arm.depthBins?.intervalIdentity, 'projected-ndc-zero-to-one-depth-interval-v0', 'depth interval identity changed');
  assert.equal(arm.depthBins?.orderingIdentity, 'far-to-near-alpha-over-v0', 'depth ordering identity changed');
  assert.equal(arm.depthBins?.alphaIdentity, 'one-minus-exp-negative-summed-optical-depth-v0', 'optical alpha identity changed');
  assert.equal(arm.fallbackReason, null, 'optical fallback evidence cannot close');
  assert.equal(arm.intermediateClamped, false, 'clamped optical intermediate cannot close');
  assert.equal(arm.intermediateReadbackStatus, 'complete', 'optical intermediate readback is incomplete');
  assert.equal(arm.telemetry?.status, 'complete', 'optical telemetry is partial');
  assert.equal(arm.telemetry?.depthBins, DEPTH_BINS, 'optical telemetry depth-bin configuration changed');
  assert.ok(
    Number.isInteger(arm.telemetry?.activeDepthBins)
      && arm.telemetry.activeDepthBins > 0
      && arm.telemetry.activeDepthBins <= DEPTH_BINS,
    'optical telemetry has no lawful occupied depth bins',
  );
  assert.equal(arm.telemetry?.nonFiniteChannels, 0, 'optical intermediate contains non-finite channels');
  assert.equal(arm.telemetry?.overflowCount, 0, 'optical route overflowed');
  validateCaptures(arm, source);
}

export function validateSplatOpticalRecurrenceReport(report) {
  assert.equal(report?.schema, REPORT_SCHEMA, 'optical recurrence report schema mismatch');
  assert.equal(report.status, 'completed', 'partial report cannot claim optical recurrence evidence');
  assert.equal(report.failurePhase, null, 'completed optical report retains a failure phase');
  assert.equal(report.requestedRoute, '/volume-selective-head-live.html', 'requested wrapper route changed');
  assert.equal(report.effectiveWrapperRoute, WRAPPER_ROUTE, 'effective wrapper route changed');
  assert.equal(report.effectiveRendererRoute, RENDERER_ROUTE, 'effective renderer route changed');
  assert.match(report.backend || '', /^WebGPU/, 'renderer backend substituted away from WebGPU');
  assert.equal(report.cameraCount, CAMERA_COUNT, 'optical recurrence requires the exact 21-camera orbit');
  validateSource(report.source);
  assert.equal(report.arms?.length, 2, 'optical evidence requires exactly presentation and recurrence arms');
  const armMap = new Map(report.arms.map(arm => [arm.id, arm]));
  assert.equal(armMap.size, 2, 'duplicate or missing optical evidence arm');
  const presentation = armMap.get('matched-presentation-v0');
  const optical = armMap.get('matched-optical-recurrence-v0');
  validatePresentationArm(presentation, report.source);
  validateOpticalArm(optical, report.source);
  for (let index = 0; index < CAMERA_COUNT; index += 1) {
    const presentationCapture = presentation.captures.find(capture => capture.cameraIndex === index);
    const opticalCapture = optical.captures.find(capture => capture.cameraIndex === index);
    assert.equal(opticalCapture.cameraPoseHash, presentationCapture.cameraPoseHash, `camera pose changed between optical arms at ${index}`);
  }
  return report;
}

function validateArtifact(artifact) {
  assert.ok(artifact?.id && artifact.path && artifact.mediaType && artifact.loadRoute, 'cockpit artifact identity is incomplete');
  assert.ok(Number.isInteger(artifact.bytes) && artifact.bytes > 0, `cockpit artifact ${artifact.id || 'unknown'} byte length is invalid`);
  assert.match(artifact.sha256 || '', SHA256, `cockpit artifact ${artifact.id || 'unknown'} hash is missing or invalid`);
}

export function validateSplatOpticalCockpitManifest(manifest) {
  assert.equal(manifest?.schema, MANIFEST_SCHEMA, 'cockpit manifest schema mismatch');
  assert.equal(manifest.status, 'complete', 'partial cockpit manifest cannot claim loadability');
  assert.equal(manifest.evidenceState, 'produced', 'producer cannot skip directly to operator-explored evidence');
  assert.equal(manifest.visualQuality, 'operator-unseen', 'producer cannot claim authored visual quality before exploration');
  assert.equal(manifest.experiment?.identity, 'matched-splat-optical-recurrence-parity-v0', 'experiment identity changed');
  assert.equal(manifest.producer?.identity, 'radiance-transfer-producer-v0', 'producer identity changed');
  validateSource(manifest.source);
  assert.equal(manifest.identities?.accumulation, 'depth-binned-emission-optical-depth-v0', 'manifest accumulation identity changed');
  assert.equal(manifest.identities?.transport, 'depth-binned-exponential-self-transmittance-v0', 'manifest transport identity changed');
  assert.equal(manifest.identities?.presentation, 'raymarch-matched-exponential-power-grade-v0', 'manifest presentation identity changed');
  assert.ok(Array.isArray(manifest.artifacts) && manifest.artifacts.length >= 2, 'cockpit manifest requires original and treatment artifacts');
  manifest.artifacts.forEach(validateArtifact);
  const artifactMap = new Map(manifest.artifacts.map(artifact => [artifact.id, artifact]));
  assert.equal(artifactMap.size, manifest.artifacts.length, 'cockpit artifact ids must be unique');
  assert.equal(artifactMap.size, 4, 'cockpit manifest requires two exact orbit videos and two contact sheets');
  const presentationVideo = artifactMap.get('original-presentation');
  const presentationSheet = artifactMap.get('presentation-contact-sheet');
  const opticalVideo = artifactMap.get('matched-optical');
  const opticalSheet = artifactMap.get('optical-contact-sheet');
  assert.equal(presentationVideo?.loadRoute, 'matched-presentation-v0', 'immutable presentation artifact or route is missing');
  assert.equal(presentationVideo?.mediaType, 'video/mp4', 'immutable presentation artifact is not the dynamic orbit');
  assert.equal(presentationVideo?.frameCount, CAMERA_COUNT, 'immutable presentation dynamic orbit is partial');
  assert.equal(presentationSheet?.loadRoute, 'matched-presentation-v0', 'presentation contact sheet or route is missing');
  assert.equal(presentationSheet?.mediaType, 'image/png', 'presentation contact sheet media type changed');
  assert.equal(opticalVideo?.loadRoute, 'matched-optical-recurrence-v0', 'matched optical artifact or route is missing');
  assert.equal(opticalVideo?.mediaType, 'video/mp4', 'matched optical artifact is not the dynamic orbit');
  assert.equal(opticalVideo?.frameCount, CAMERA_COUNT, 'matched optical dynamic orbit is partial');
  assert.equal(opticalSheet?.loadRoute, 'matched-optical-recurrence-v0', 'optical contact sheet or route is missing');
  assert.equal(opticalSheet?.mediaType, 'image/png', 'optical contact sheet media type changed');
  assert.equal(manifest.routes?.requested, '/volume-selective-head-live.html', 'manifest requested route changed');
  assert.equal(manifest.routes?.effectiveWrapper, WRAPPER_ROUTE, 'manifest effective wrapper changed');
  assert.equal(manifest.routes?.effectiveRenderer, RENDERER_ROUTE, 'manifest effective renderer changed');
  assert.equal(manifest.renderer?.fallbackReason, null, 'fallback manifest cannot claim cockpit loadability');
  assert.match(manifest.renderer?.backend || '', /^WebGPU/, 'manifest backend substituted away from WebGPU');
  assert.equal(manifest.renderer?.composition, 'splat-only-v0', 'optical treatment must preserve splat-only composition');
  assert.equal(manifest.capacity?.candidateCount, manifest.source.candidateCount, 'manifest candidate count changed');
  assert.equal(manifest.capacity?.overflowCount, 0, 'manifest route overflowed');
  assert.ok(manifest.controls?.requestedSha256 && manifest.controls?.requestedSha256 === manifest.controls?.effectiveSha256, 'requested/effective controls disagree');
  for (const axis of LOCKED_AXES) assert.ok(manifest.controls.locked?.includes(axis), `predicate-locked axis is missing: ${axis}`);
  assert.ok(Array.isArray(manifest.controls?.mutable), 'mutable control axes are missing');
  assert.equal(manifest.camera?.orbitIdentity, 'filament-orbit-21-camera-v0', 'cockpit camera orbit changed');
  assert.equal(manifest.camera?.cameraCount, CAMERA_COUNT, 'cockpit camera cohort is partial');
  assert.equal(manifest.camera?.poseHashes?.length, CAMERA_COUNT, 'cockpit camera pose hashes are partial');
  assert.equal(manifest.state?.sameStateCaptureId, manifest.source.sameStateCaptureId, 'cockpit source state changed');
  assert.equal(manifest.state?.historyIdentity, 'frozen-no-history-advance-v0', 'cockpit history authority changed');
  assert.ok(manifest.timing?.authority && manifest.timing?.status, 'timing authority is missing');
  for (const socket of REQUIRED_VIEW_SOCKETS) assert.ok(manifest.viewSockets?.[socket], `cockpit view socket is missing: ${socket}`);
  assert.equal(manifest.authoredFork?.originalWitnessImmutable, true, 'authored exploration may not overwrite original evidence');
  assert.equal(manifest.authoredFork?.writeMode, 'create-new', 'authored fork must use create-new semantics');
  assert.ok(manifest.authoredFork?.outputPath, 'caller-provided authored fork output path is missing');
  return manifest;
}

export function buildSplatOpticalCockpitManifest({ report, artifacts, authoredForkOutputPath }) {
  validateSplatOpticalRecurrenceReport(report);
  const opticalArm = report.arms.find(arm => arm.id === 'matched-optical-recurrence-v0');
  const manifest = {
    schema: MANIFEST_SCHEMA,
    status: 'complete',
    evidenceState: 'produced',
    visualQuality: 'operator-unseen',
    experiment: {
      identity: 'matched-splat-optical-recurrence-parity-v0',
      originalWitnessImmutable: true,
    },
    producer: {
      identity: 'radiance-transfer-producer-v0',
    },
    source: { ...report.source },
    checkpoint: {
      identity: 'analytic-live-splat-attributes-v0',
      model: 'no-new-training-v0',
    },
    identities: {
      target: 'smoke-off-complete-flame-local-emission-extinction-v0',
      treatment: opticalArm.id,
      support: `sha256:${report.source.supportSha256}`,
      coefficient: `sha256:${report.source.coefficientSha256}`,
      covariance: `sha256:${report.source.covarianceSha256}`,
      accumulation: opticalArm.accumulationIdentity,
      transport: opticalArm.transportIdentity,
      presentation: opticalArm.presentationIdentity,
    },
    artifacts: structuredClone(artifacts || []),
    routes: {
      requested: report.requestedRoute,
      effectiveWrapper: report.effectiveWrapperRoute,
      effectiveRenderer: report.effectiveRendererRoute,
      loadAction: 'load-cockpit-manifest-v0',
    },
    controls: {
      requestedSha256: report.source.controlsSha256,
      effectiveSha256: report.source.controlsSha256,
      locked: [...LOCKED_AXES],
      mutable: ['presentation-view', 'difference-gain', 'debug-view'],
    },
    camera: {
      orbitIdentity: 'filament-orbit-21-camera-v0',
      cameraCount: CAMERA_COUNT,
      poseHashes: opticalArm.captures.map(capture => capture.cameraPoseHash),
    },
    state: {
      sameStateCaptureId: report.source.sameStateCaptureId,
      fluidSha256: report.source.fluidSha256,
      frontSha256: report.source.frontSha256,
      historyIdentity: 'frozen-no-history-advance-v0',
    },
    renderer: {
      composition: 'splat-only-v0',
      backend: report.backend,
      fallbackReason: opticalArm.fallbackReason,
      targetFormat: opticalArm.targetFormat,
      layerFormat: opticalArm.layerFormat,
      depthBins: structuredClone(opticalArm.depthBins),
    },
    capacity: {
      candidateCount: report.source.candidateCount,
      capacity: opticalArm.telemetry.capacity ?? report.source.candidateCount,
      overflowCount: opticalArm.telemetry.overflowCount,
    },
    timing: {
      authority: opticalArm.telemetry.timingAuthority || 'boundary-splat-stage-gpu-timestamp-profile-v0',
      status: opticalArm.telemetry.timingStatus || 'not-sampled',
    },
    viewSockets: {
      target: 'raymarch-target-v0',
      treatment: opticalArm.id,
      difference: 'target-minus-treatment-v0',
      ridge: 'ridge-layer-isolation-v0',
      nonRidge: 'non-ridge-layer-isolation-v0',
      combined: 'ridge-plus-non-ridge-v0',
      debug: 'depth-bin-optical-debug-v0',
    },
    authoredFork: {
      outputPath: authoredForkOutputPath,
      originalWitnessImmutable: true,
      writeMode: 'create-new',
      writes: ['authored-controls', 'route-state-identities', 'visual-notes', 'artifact-pointers', 'original-to-authored-control-delta'],
    },
  };
  return validateSplatOpticalCockpitManifest(manifest);
}

export function writeSplatOpticalRecurrenceFailureReport(reportPath, failureReport) {
  mkdirSync(dirname(reportPath), { recursive: true });
  const priorBytes = existsSync(reportPath) ? readFileSync(reportPath) : null;
  let priorPayload = null;
  if (priorBytes) {
    try {
      priorPayload = JSON.parse(priorBytes.toString('utf8'));
    } catch {
      priorPayload = null;
    }
  }
  const payload = {
    ...failureReport,
    lastTrustworthyEvidence: {
      ...(failureReport.lastTrustworthyEvidence || {}),
      ...(priorBytes ? {
        displacedPrimaryReport: {
          path: reportPath,
          byteLength: priorBytes.byteLength,
          sha256: createHash('sha256').update(priorBytes).digest('hex'),
          schema: priorPayload?.schema || null,
          status: priorPayload?.status || 'unparseable',
        },
      } : {}),
    },
  };
  const temporaryPath = `${reportPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, JSON.stringify(payload, null, 2));
  renameSync(temporaryPath, reportPath);
  return payload;
}

export const SPLAT_OPTICAL_RECURRENCE_CONTRACT = Object.freeze({
  reportSchema: REPORT_SCHEMA,
  manifestSchema: MANIFEST_SCHEMA,
  presentationBaseline: PRESENTATION_BASELINE,
  wrapperRoute: WRAPPER_ROUTE,
  rendererRoute: RENDERER_ROUTE,
  cameraCount: CAMERA_COUNT,
  depthBins: DEPTH_BINS,
  lockedAxes: LOCKED_AXES,
});
