const REPORT_SCHEMA = 'kaminos.volume.raymarch-filament-orbit-witness.v0';
const WRAPPER_ROUTE = 'exact-basin-selective-head-live-v0';
const RENDERER_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const SOURCE_ROUTE_AUTHORITY = 'checksum-anchor-bridge-explicit-controls-hash-v0';

function invariant(condition, message) {
  if (!condition) throw new Error(`ridge topology cockpit admission failed: ${message}`);
}

function equalNumber(actual, expected, label, tolerance = 1e-6) {
  invariant(Number.isFinite(actual), `${label} is missing or non-finite`);
  invariant(Math.abs(actual - expected) <= tolerance, `${label} requested/effective mismatch (${expected} != ${actual})`);
}

function validateSourceReport(report) {
  invariant(report && typeof report === 'object', 'source report is missing');
  invariant(report.schema === REPORT_SCHEMA, 'source report schema mismatch');
  invariant(report.status === 'completed', 'source report is incomplete');
  invariant(report.requestedRoute === '/volume-selective-head-live.html', 'source requested route mismatch');
  invariant(report.effectiveWrapperRoute === WRAPPER_ROUTE, 'source wrapper route mismatch');
  invariant(report.effectiveRendererRoute === RENDERER_ROUTE, 'source renderer route mismatch');
  invariant(report.sourceRouteAuthority === SOURCE_ROUTE_AUTHORITY, 'source route authority mismatch');
  invariant(typeof report.requestedUrl === 'string' && report.requestedUrl.length > 0, 'source requested URL is missing');
  const capture = report.captureConfig || {};
  invariant(capture.simulatorAdvance === false, 'source capture advanced the simulator');
  invariant(capture.expectedFrameCount === 96 && capture.expectedSimStepCount === 96, 'source frozen counters mismatch');
  invariant(capture.expectedWarmupTarget === 96, 'source warmup target mismatch');
  invariant(capture.expectedWarmupAuthority === 'checksum-bound-exact-basin-step96-field-anchor-v0', 'source warmup authority mismatch');
  invariant(/^[a-f0-9]{64}$/.test(capture.expectedControlsHash || ''), 'source controls hash is missing');
  invariant(/^[a-f0-9]{64}$/.test(capture.expectedAnchorFluidSha256 || ''), 'source fluid anchor hash is missing');
  invariant(/^[a-f0-9]{64}$/.test(capture.expectedAnchorFrontSha256 || ''), 'source front anchor hash is missing');
  return capture;
}

export function buildRidgeTopologyCockpitRoute(report, servingBaseUrl, anchorBaseUrl) {
  validateSourceReport(report);
  const servingBase = new URL(servingBaseUrl);
  const requested = new URL(report.requestedUrl);
  requested.protocol = servingBase.protocol;
  requested.host = servingBase.host;
  requested.pathname = '/volume-selective-head-live.html';
  requested.searchParams.set('anchor_base', String(anchorBaseUrl).replace(/\/$/, ''));
  return requested;
}

export function validateRidgeTopologyCockpitAdmission({ report, wrapper, renderer, controlsHash, output }) {
  const capture = validateSourceReport(report);
  invariant(wrapper && renderer, 'live wrapper or renderer state is missing');
  invariant(wrapper.routeIdentity === WRAPPER_ROUTE, 'effective wrapper route mismatch');
  invariant(renderer.effectiveRoute === RENDERER_ROUTE, 'effective renderer route mismatch');
  invariant(wrapper.status === 'running', `wrapper status is ${wrapper.status || 'missing'}`);
  invariant(wrapper.requestedRole === 'truthHigh' && wrapper.effectiveRole === 'truthHigh', 'truth-high role mismatch');
  invariant(wrapper.requestedComposition === 'raymarch-only-v0' && wrapper.effectiveComposition === 'raymarch-only-v0', 'initial composition mismatch');
  invariant(String(wrapper.backend || '').startsWith('WebGPU'), 'effective backend is not WebGPU');
  invariant(!wrapper.error, `wrapper error: ${wrapper.error}`);
  invariant(!wrapper.fallbackReason && !wrapper.boundarySplatFallbackReason && !renderer.boundarySplatFallbackReason, 'live fallback is active');
  invariant(wrapper.warmupComplete === true && wrapper.warmupTarget === capture.expectedWarmupTarget, 'warmup is partial');
  invariant(wrapper.warmupAuthority === capture.expectedWarmupAuthority, 'warmup authority mismatch');
  invariant(wrapper.warmupReceipt?.ok === true, 'anchor receipt is missing or failed');
  invariant(wrapper.warmupReceipt?.authority === capture.expectedWarmupAuthority, 'anchor authority mismatch');
  invariant(wrapper.warmupReceipt?.completedSteps === capture.expectedWarmupTarget, 'anchor completed-step mismatch');
  invariant(wrapper.warmupReceipt?.fluidSha256 === capture.expectedAnchorFluidSha256, 'fluid anchor hash mismatch');
  invariant(wrapper.warmupReceipt?.frontSha256 === capture.expectedAnchorFrontSha256, 'front anchor hash mismatch');
  invariant(wrapper.freezeAfterWarmupRequested === true && wrapper.postWarmupFreezeReceipt?.paused === true, 'post-anchor freeze is missing');
  invariant(wrapper.frameCount === capture.expectedFrameCount + 1, 'presentation probe frame mismatch');
  invariant(wrapper.simStepCount === capture.expectedSimStepCount, 'frozen simulation counter mismatch');
  invariant(wrapper.postWarmupFreezeReceipt?.frameCount === capture.expectedFrameCount, 'freeze receipt frame mismatch');
  invariant(wrapper.postWarmupFreezeReceipt?.simStepCount === capture.expectedSimStepCount, 'freeze receipt simulation-step mismatch');
  invariant(wrapper.simGrid === 160, 'effective simulation grid mismatch');
  invariant(controlsHash === capture.expectedControlsHash, 'effective controls hash mismatch');
  invariant(renderer.boundarySplatCandidateCount > 0, 'candidate rows are missing');
  invariant(renderer.boundarySplatInstanceCount === renderer.boundarySplatCandidateCount, 'candidate rows are partial');
  invariant(renderer.boundarySplatOverflowCount === 0, 'candidate rows overflowed');
  equalNumber(renderer.controls?.reactionBoundaryTopology, 0.96, 'topology break');
  invariant(renderer.controls?.reactionLiveView === 'boundary_fire', 'boundary-fire live view mismatch');
  invariant(renderer.controls?.fireRenderMode === 'inspect', 'fire render mode mismatch');
  invariant(renderer.controls?.shellInspectMode === 'boundary_fire', 'boundary-fire inspect mode mismatch');
  invariant(output?.nonBlankPixelCount > 0 && output?.distinctColorCountLowerBound > 1, 'blank or static output');
  return {
    ok: true,
    authority: 'checksum-bound-ridge-topology-cockpit-admission-v0',
    controlsHash,
    candidateCount: renderer.boundarySplatCandidateCount,
    sourceFrameCount: capture.expectedFrameCount,
    frameCount: wrapper.frameCount,
    simStepCount: wrapper.simStepCount,
    fluidSha256: wrapper.warmupReceipt.fluidSha256,
    frontSha256: wrapper.warmupReceipt.frontSha256,
  };
}

export function validateRidgeTopologyCockpitControls(requested, effective) {
  invariant(requested && effective, 'requested or effective controls are missing');
  invariant(!effective.fallbackReason, `control fallback is active: ${effective.fallbackReason}`);
  invariant(effective.boundarySplatMode === 'world_covariance', 'world covariance mode is not effective');
  equalNumber(effective.boundarySplatRadius, requested.boundarySplatRadius, 'radius');
  equalNumber(effective.boundarySplatSharpness, requested.boundarySplatSharpness, 'sharpness');
  equalNumber(effective.boundarySplatRadianceGain, requested.boundarySplatRadianceGain, 'radiance gain');
  equalNumber(effective.boundarySplatOpacityGain, requested.boundarySplatOpacityGain, 'opacity gain');
  equalNumber(effective.reactionBoundaryTopology, requested.reactionBoundaryTopology, 'topology break');
  invariant(effective.boundarySplatCandidateCount > 0, 'candidate rows are missing');
  invariant(effective.boundarySplatInstanceCount === effective.boundarySplatCandidateCount, 'candidate rows are partial');
  invariant(effective.boundarySplatOverflowCount === 0, 'candidate rows overflowed');
  return {
    ok: true,
    authority: 'requested-effective-ridge-topology-cockpit-controls-v0',
    requested: { ...requested },
    effective: {
      boundarySplatMode: effective.boundarySplatMode,
      boundarySplatRadius: effective.boundarySplatRadius,
      boundarySplatSharpness: effective.boundarySplatSharpness,
      boundarySplatRadianceGain: effective.boundarySplatRadianceGain,
      boundarySplatOpacityGain: effective.boundarySplatOpacityGain,
      reactionBoundaryTopology: effective.reactionBoundaryTopology,
    },
  };
}
