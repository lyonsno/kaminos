export const CRUCIBLE_FLAME_CONTINUITY_COMPARISON_SCHEMA = 'kaminos.crucible-flame-continuity-comparison.v0';

const LIVE_MODE = 'live-every-frame';
const HOLDOVER_MODE = 'bounded-history-holdover';
const VISUAL_VERDICTS = new Set(['improved', 'stall-shifted', 'failed-closed']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function sameValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function continuityEvidence(report) {
  const route = report?.state?.fullRoute || {};
  const heartbeat = route.foregroundKilnHeartbeat || {};
  const candidates = [
    route.flameContinuityEvidence,
    heartbeat.effectiveFirePresentation?.flameContinuityEvidence,
    ...(Array.isArray(heartbeat.samples)
      ? heartbeat.samples.map(sample => sample?.firePresentation?.flameContinuityEvidence)
      : []),
  ].filter(value => value && typeof value === 'object');
  const counts = candidates.reduce((maximum, evidence) => ({
    live: Math.max(maximum.live, finiteOrNull(evidence.counts?.live) || 0),
    holdover: Math.max(maximum.holdover, finiteOrNull(evidence.counts?.holdover) || 0),
    fallback: Math.max(maximum.fallback, finiteOrNull(evidence.counts?.fallback) || 0),
  }), { live: 0, holdover: 0, fallback: 0 });
  return { latest: candidates.at(-1) || null, counts };
}

function summarizeRun(report, expectedMode) {
  const route = report?.state?.fullRoute || {};
  const heartbeat = route.foregroundKilnHeartbeat || {};
  const continuity = continuityEvidence(report);
  return {
    schema: report?.schema || null,
    ok: report?.ok === true,
    url: report?.url || null,
    sourceAssetId: report?.state?.sourceSelectionExercise?.effectiveAssetId || null,
    requestedSourceAssetId: report?.state?.sourceSelectionExercise?.requestedAssetId || null,
    requestedPipelineId: route.requestedPipelineId || null,
    effectiveRouteId: route.effectiveRouteId || null,
    requestedScheduler: route.requestedScheduler || null,
    effectiveScheduler: route.effectiveScheduler || null,
    requestedFireBudget: heartbeat.requestedFireBudget || null,
    effectiveFireBudget: heartbeat.effectiveFireBudget || null,
    webgpuInferenceKit: report?.state?.webgpuInferenceKit || null,
    requestedFlameContinuity: route.requestedFlameContinuity || null,
    selectedFlameContinuity: route.selectedFlameContinuity || null,
    effectiveFlameContinuity: route.effectiveFlameContinuity || null,
    expectedFlameContinuity: expectedMode,
    continuityEvidence: continuity.latest,
    counts: continuity.counts,
    firingId: heartbeat.firingId || null,
    output: route.output || null,
    cadence: {
      p95FrameGapMs: finiteOrNull(heartbeat.p95FrameGapMs),
      p99FrameGapMs: finiteOrNull(heartbeat.p99FrameGapMs),
      maxFrameGapMs: finiteOrNull(heartbeat.maxFrameGapMs),
    },
    inFlightScreenshot: report?.inFlightScreenshot || null,
    inFlightCaptureStatus: report?.inFlightCapture?.status || null,
  };
}

function addFailure(failures, failure) {
  if (!failures.includes(failure)) failures.push(failure);
}

function delta(holdover, live) {
  return Number.isFinite(holdover) && Number.isFinite(live) ? holdover - live : null;
}

export function createCrucibleFlameContinuityComparison({
  liveReport,
  holdoverReport,
  visualInspection = null,
} = {}) {
  const live = summarizeRun(liveReport, LIVE_MODE);
  const holdover = summarizeRun(holdoverReport, HOLDOVER_MODE);
  const failures = [];
  if (live.schema !== 'crucible-viewport-witness.v0' || !live.ok
    || liveReport?.state?.fullRoute?.status !== 'complete') addFailure(failures, 'live-witness-invalid');
  if (holdover.schema !== 'crucible-viewport-witness.v0' || !holdover.ok
    || holdoverReport?.state?.fullRoute?.status !== 'complete') addFailure(failures, 'holdover-witness-invalid');
  if (!live.sourceAssetId || !live.requestedSourceAssetId
    || live.sourceAssetId !== holdover.sourceAssetId
    || live.requestedSourceAssetId !== holdover.requestedSourceAssetId) {
    addFailure(failures, 'source-identity-mismatch');
  }
  if (!live.requestedPipelineId || live.requestedPipelineId !== holdover.requestedPipelineId
    || !live.effectiveRouteId || live.effectiveRouteId !== holdover.effectiveRouteId) {
    addFailure(failures, 'route-identity-mismatch');
  }
  if (!sameValue(live.requestedScheduler, holdover.requestedScheduler)
    || !sameValue(live.effectiveScheduler, holdover.effectiveScheduler)
    || !sameValue(live.requestedScheduler, live.effectiveScheduler)
    || !sameValue(holdover.requestedScheduler, holdover.effectiveScheduler)) {
    addFailure(failures, 'scheduler-identity-mismatch');
  }
  if (!sameValue(live.requestedFireBudget, holdover.requestedFireBudget)
    || !sameValue(live.effectiveFireBudget, holdover.effectiveFireBudget)
    || !sameValue(live.requestedFireBudget, live.effectiveFireBudget)
    || !sameValue(holdover.requestedFireBudget, holdover.effectiveFireBudget)) {
    addFailure(failures, 'fire-budget-mismatch');
  }
  if (!live.output?.sha256 || live.output.sha256 !== holdover.output?.sha256
    || live.output.status !== 'real' || holdover.output?.status !== 'real') {
    addFailure(failures, 'output-hash-mismatch');
  }
  const livePackage = live.webgpuInferenceKit;
  const holdoverPackage = holdover.webgpuInferenceKit;
  if (livePackage?.status !== 'matched' || holdoverPackage?.status !== 'matched'
    || !livePackage?.effectiveVersion
    || livePackage.effectiveVersion !== holdoverPackage?.effectiveVersion
    || livePackage.sourceLockedVersion !== livePackage.effectiveVersion
    || holdoverPackage.sourceLockedVersion !== holdoverPackage.effectiveVersion
    || livePackage.requestedVersion !== livePackage.effectiveVersion
    || holdoverPackage.requestedVersion !== holdoverPackage.effectiveVersion) {
    addFailure(failures, 'webgpu-kit-version-mismatch');
  }
  if (live.requestedFlameContinuity !== LIVE_MODE
    || live.selectedFlameContinuity !== LIVE_MODE
    || live.effectiveFlameContinuity !== LIVE_MODE) {
    addFailure(failures, 'live-effective-route-mismatch');
  }
  if (holdover.requestedFlameContinuity !== HOLDOVER_MODE
    || holdover.selectedFlameContinuity !== HOLDOVER_MODE
    || holdover.effectiveFlameContinuity !== HOLDOVER_MODE) {
    addFailure(failures, 'holdover-effective-route-mismatch');
  }
  if (live.continuityEvidence?.firingId !== live.firingId
    || live.continuityEvidence?.requested !== LIVE_MODE
    || live.continuityEvidence?.effective !== LIVE_MODE) {
    addFailure(failures, 'live-continuity-evidence-mismatch');
  }
  if (live.counts.holdover > 0) addFailure(failures, 'live-holdover-count-present');
  if (holdover.continuityEvidence?.firingId !== holdover.firingId
    || holdover.continuityEvidence?.requested !== HOLDOVER_MODE
    || holdover.continuityEvidence?.effective !== HOLDOVER_MODE) {
    addFailure(failures, 'holdover-continuity-evidence-mismatch');
  }
  if (holdover.counts.holdover <= 0) addFailure(failures, 'holdover-count-missing');

  const inspectedPaths = Array.isArray(visualInspection?.inspectedPaths)
    ? visualInspection.inspectedPaths
    : [];
  const visualVerdictInvalid = visualInspection != null && !VISUAL_VERDICTS.has(visualInspection?.verdict);
  if (visualVerdictInvalid) addFailure(failures, 'visual-verdict-invalid');
  const visualComplete = visualInspection?.status === 'inspected'
    && VISUAL_VERDICTS.has(visualInspection?.verdict)
    && typeof visualInspection?.notes === 'string'
    && visualInspection.notes.trim().length > 0
    && live.inFlightCaptureStatus === 'captured'
    && holdover.inFlightCaptureStatus === 'captured'
    && inspectedPaths.includes(live.inFlightScreenshot)
    && inspectedPaths.includes(holdover.inFlightScreenshot);
  if (!visualComplete) addFailure(failures, 'visual-inspection-missing');

  const agreement = {
    source: failures.includes('source-identity-mismatch') ? 'mismatch' : 'matched',
    route: failures.includes('route-identity-mismatch') ? 'mismatch' : 'matched',
    scheduler: failures.includes('scheduler-identity-mismatch') ? 'mismatch' : 'matched',
    fireBudget: failures.includes('fire-budget-mismatch') ? 'mismatch' : 'matched',
    outputHash: failures.includes('output-hash-mismatch') ? 'mismatch' : 'matched',
    webgpuInferenceKit: failures.includes('webgpu-kit-version-mismatch') ? 'mismatch' : 'matched',
  };
  const materialFailures = failures.filter(failure => failure !== 'visual-inspection-missing');
  const status = materialFailures.length
    ? 'invalid'
    : (visualComplete ? 'verified' : 'awaiting-visual-inspection');
  const failedClosed = failures.some(failure => [
    'holdover-effective-route-mismatch',
    'holdover-continuity-evidence-mismatch',
    'holdover-count-missing',
  ].includes(failure));
  const classification = failedClosed
    ? 'failed-closed'
    : (status === 'verified' ? visualInspection.verdict : 'unclassified');

  return {
    schema: CRUCIBLE_FLAME_CONTINUITY_COMPARISON_SCHEMA,
    ok: status === 'verified',
    status,
    classification,
    claimBoundary: 'single Friendly same-source pair; visual capture perturbs cadence and does not prove stable performance',
    agreement,
    runs: { live, holdover },
    cadenceDelta: {
      p95FrameGapMs: delta(holdover.cadence.p95FrameGapMs, live.cadence.p95FrameGapMs),
      p99FrameGapMs: delta(holdover.cadence.p99FrameGapMs, live.cadence.p99FrameGapMs),
      maxFrameGapMs: delta(holdover.cadence.maxFrameGapMs, live.cadence.maxFrameGapMs),
    },
    visualInspection: visualComplete ? { ...visualInspection, inspectedPaths: [...inspectedPaths] } : null,
    failures,
  };
}
