export const SHARP_BREATHING_ROOM_COMPARISON_SCHEMA = 'kaminos.sharp-breathing-room-comparison.v0';
export const SHARP_BREATHING_ROOM_COMPARISON_PROFILES_SCHEMA = 'kaminos.sharp-breathing-room-comparison-profiles.v0';
export const SHARP_SPN_LOWRES_BLOCK_LABELS = [
  'upsample-lowres',
  'readback-x2-upsampled',
  'readback-lowres',
  'cpu-concat-lowres',
  'concat-upload',
  'fuse-lowres',
];
export const SHARP_MONODEPTH_PHASE_LABELS = [
  'project-feature',
  'fusion-resnet1',
  'fusion-skip-add',
  'fusion-resnet2',
  'fusion-out-conv',
  'head-conv0',
  'head-final',
];

import { validateSharpBreathingRoomComparisonEvidence } from './sharp-breathing-room-validation.mjs';

const SINGLE_PAIR_BOUNDARY = 'single-pair smoke only; no optimization, speedup, slowdown, or stable throughput claim';
const SHARP_BREATHING_ROOM_MODE_ALIASES = new Map([
  ['default', 'baseline-default'],
  ['baseline', 'baseline-default'],
  ['baseline-default', 'baseline-default'],
  ['friendly', 'cooperative-spn-gaussian'],
  ['cooperative', 'cooperative-spn-gaussian'],
  ['cooperative-spn', 'cooperative-spn-gaussian'],
  ['cooperative-spn-gaussian', 'cooperative-spn-gaussian'],
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstStage(report = {}) {
  return Array.isArray(report.stages) ? report.stages[0] || null : null;
}

function schedulerEvidenceFromRun(run = {}) {
  const report = run.witnessReport || {};
  const stage = firstStage(report) || {};
  const route = stage.effectiveRoute || {};
  const scheduler = route.pipelineScheduler || route.adapterReport?.pipelineScheduler || {};
  const verification = scheduler.schedulerVerification
    || route.adapterReport?.schedulerVerification
    || route.adapterReport?.pipelineScheduler?.schedulerVerification
    || null;
  return {
    scheduler,
    verification,
    requestedScheduler: scheduler.requestedScheduler
      || route.adapterReport?.breathingRoom?.requestedScheduler
      || null,
    effectiveScheduler: scheduler.effectiveScheduler
      || route.adapterReport?.breathingRoom?.effectiveScheduler
      || null,
    unsupportedFields: [
      ...(Array.isArray(scheduler.unsupportedFields) ? scheduler.unsupportedFields : []),
      ...(Array.isArray(verification?.unsupportedFields) ? verification.unsupportedFields : []),
    ].filter((value, index, values) => value && values.indexOf(value) === index),
  };
}

function schedulerEventsFromRun(run = {}) {
  const scheduler = schedulerEvidenceFromRun(run);
  const adapterReport = firstStage(run.witnessReport)?.effectiveRoute?.adapterReport || null;
  const candidates = [
    scheduler.verification?.eventTrace?.events,
    scheduler.scheduler?.eventTrace?.events,
    scheduler.scheduler?.schedulerVerification?.eventTrace?.events,
    adapterReport?.pipelineScheduler?.schedulerVerification?.eventTrace?.events,
    adapterReport?.breathingRoom?.schedulerVerification?.eventTrace?.events,
    adapterReport?.breathingRoom?.telemetry?.events,
  ];
  const events = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const event of candidate) if (event && typeof event === 'object') events.push(event);
  }
  return events;
}

function spnFusionCoverageFromRun(run = {}) {
  const observedBlocks = [];
  for (const event of schedulerEventsFromRun(run)) {
    const block = event.details?.block || event.block || event.label || event.name || null;
    const phaseText = [
      event.phase,
      event.boundary,
      event.stage,
      event.routePhase,
      event.kind,
    ].filter(Boolean).join(' ').toLowerCase();
    if (!block) continue;
    if (!phaseText.includes('spn-fusion') && !SHARP_SPN_LOWRES_BLOCK_LABELS.includes(block)) continue;
    if (!observedBlocks.includes(block)) observedBlocks.push(block);
  }
  const missingSpnFusionBlocks = SHARP_SPN_LOWRES_BLOCK_LABELS.filter(block => !observedBlocks.includes(block));
  return {
    schema: 'kaminos.sharp-spn-lowres-fusion-coverage.v0',
    requiredBlocks: [...SHARP_SPN_LOWRES_BLOCK_LABELS],
    observedBlocks,
    missingSpnFusionBlocks,
    status: missingSpnFusionBlocks.length ? 'missing-labels' : 'complete',
  };
}

function monodepthPhaseCoverageFromRun(run = {}) {
  const observedLabels = [];
  for (const event of schedulerEventsFromRun(run)) {
    const boundary = event.boundary || event.phase || null;
    const label = (boundary === 'monodepth-phase' && SHARP_MONODEPTH_PHASE_LABELS.includes(event.phase)
      ? event.phase
      : event.details?.phase)
      || event.details?.label
      || event.phaseLabel
      || event.label
      || event.name
      || null;
    const phaseText = [
      event.phase,
      event.boundary,
      event.stage,
      event.routePhase,
      event.kind,
    ].filter(Boolean).join(' ').toLowerCase();
    if (!label) continue;
    if (!phaseText.includes('monodepth-phase') && !SHARP_MONODEPTH_PHASE_LABELS.includes(label)) continue;
    if (!observedLabels.includes(label)) observedLabels.push(label);
  }
  const missingMonodepthPhaseLabels = SHARP_MONODEPTH_PHASE_LABELS.filter(label => !observedLabels.includes(label));
  return {
    schema: 'kaminos.sharp-monodepth-phase-coverage.v0',
    requiredLabels: [...SHARP_MONODEPTH_PHASE_LABELS],
    observedLabels,
    missingMonodepthPhaseLabels,
    status: missingMonodepthPhaseLabels.length ? 'missing-labels' : 'complete',
  };
}

function artifactEvidenceFromRun(run = {}) {
  const artifact = run.witnessReport?.artifacts?.splat || {};
  const adapterOutput = firstStage(run.witnessReport)?.effectiveRoute?.adapterReport;
  return {
    path: artifact.path || adapterOutput?.output?.path || null,
    bytes: artifact.bytes ?? adapterOutput?.outputBytes ?? adapterOutput?.output?.bytes ?? null,
    sha256: artifact.sha256 || adapterOutput?.output?.sha256 || null,
    status: artifact.status || null,
  };
}

function timingFromRun(run = {}) {
  const contentionTiming = run.contentionReport?.timing || run.contentionReport?.frameTail || null;
  const schedulerFrameTail = schedulerEvidenceFromRun(run).verification?.frameTail || null;
  const frameTail = run.contentionReport ? contentionTiming : schedulerFrameTail;
  const stage = firstStage(run.witnessReport) || {};
  return {
    adapterInferenceDurationMs: finiteOrNull(stage.durationMs ?? run.witnessReport?.durationMs ?? run.durationMs),
    routeDurationMs: finiteOrNull(run.witnessReport?.durationMs ?? stage.durationMs ?? run.durationMs),
    rafFps: finiteOrNull(frameTail?.rafFps),
    frameP95Ms: finiteOrNull(frameTail?.frameP95Ms),
    frameP99Ms: finiteOrNull(frameTail?.frameP99Ms),
    queueDoneP95Ms: finiteOrNull(frameTail?.queueDoneP95Ms),
    queueDoneP99Ms: finiteOrNull(frameTail?.queueDoneP99Ms),
    evidenceSource: frameTail?.evidenceSource || null,
    disclaimer: frameTail?.disclaimer || null,
  };
}

function runSummary(run = {}) {
  const scheduler = schedulerEvidenceFromRun(run);
  const artifact = artifactEvidenceFromRun(run);
  const timing = timingFromRun(run);
  const report = run.witnessReport || {};
  const profile = sharpBreathingRoomComparisonProfiles().profiles.find(item => item.id === run.profileId) || {};
  const unsupportedFields = [
    ...scheduler.unsupportedFields,
    ...(Array.isArray(profile.unsupportedFields) ? profile.unsupportedFields : []),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  return {
    profileId: run.profileId || null,
    profileLabel: run.profileLabel || null,
    witnessReportPath: run.witnessReportPath || null,
    contentionReportPath: run.contentionReportPath || null,
    requestedPipelineId: report.requestedPipelineId || null,
    effectiveRouteId: report.effectiveRouteConfig?.routeId || null,
    stageStatus: firstStage(report)?.status || null,
    artifact,
    schedulerVerification: clone(scheduler.verification),
    requestedScheduler: clone(scheduler.requestedScheduler),
    effectiveScheduler: clone(scheduler.effectiveScheduler),
    unsupportedFields,
    schedulerEventCount: schedulerEventsFromRun(run).length,
    spnFusionCoverage: spnFusionCoverageFromRun(run),
    monodepthPhaseCoverage: monodepthPhaseCoverageFromRun(run),
    routePhaseTimeline: clone(run.contentionReport?.routePhaseTimeline || report.routePhaseTimeline || []),
    currentRoutePhase: clone(report.currentRoutePhase || null),
    timing,
  };
}

function hasObservedSchedulerProof(verification) {
  return Array.isArray(verification?.eventTrace?.events)
    && verification.eventTrace.events.length > 0
    && Array.isArray(verification?.boundaryAssertions)
    && verification.boundaryAssertions.some(assertion => assertion?.status === 'verified');
}

function timingAuthorityIsProxyOnly(verification) {
  return verification?.status === 'verified'
    && verification?.eventTrace?.timingAuthority === 'raf-and-queue-proxy';
}

function hasFrameQueueEvidence(summary) {
  return Number.isFinite(summary?.timing?.frameP95Ms)
    && Number.isFinite(summary?.timing?.queueDoneP95Ms);
}

function routeIdentityFromRuns(runs, requestedPipelineId, routeId) {
  const first = runs[0] || {};
  return {
    requestedPipelineId: requestedPipelineId || first.requestedPipelineId || 'sharp-image-to-splat-live-v0',
    requestedRouteId: routeId || first.effectiveRouteId || 'adapter.sharp-image-to-splat-live.v0',
    effectiveRouteId: routeId || first.effectiveRouteId || 'adapter.sharp-image-to-splat-live.v0',
  };
}

function outputEquivalenceForRuns(baseline, cooperative) {
  const baselineArtifact = baseline?.artifact || {};
  const cooperativeArtifact = cooperative?.artifact || {};
  const bothHashesPresent = Boolean(baselineArtifact.sha256 && cooperativeArtifact.sha256);
  const sameHash = baselineArtifact.sha256 && cooperativeArtifact.sha256
    && baselineArtifact.sha256 === cooperativeArtifact.sha256;
  const sameBytes = baselineArtifact.bytes != null && cooperativeArtifact.bytes != null
    && baselineArtifact.bytes === cooperativeArtifact.bytes;
  const status = sameHash || (!bothHashesPresent && sameBytes) ? 'same-output' : 'mismatch';
  return {
    status,
    sha256: sameHash ? baselineArtifact.sha256 : null,
    baseline: baselineArtifact,
    cooperative: cooperativeArtifact,
  };
}

function addDowngrade(state, downgrade) {
  if (!state.downgrades.includes(downgrade)) state.downgrades.push(downgrade);
}

export function sharpBreathingRoomComparisonProfiles() {
  return {
    schema: SHARP_BREATHING_ROOM_COMPARISON_PROFILES_SCHEMA,
    pairingKind: 'default-vs-cooperative',
    profiles: [
      {
        id: 'baseline-default',
        schedulerMode: 'default',
        label: 'Baseline default SHARP route',
        scheduler: { mode: 'default' },
        env: {
          KAMINOS_SHARP_WEBGPU_SCHEDULER_MODE: 'default',
          KAMINOS_SHARP_WEBGPU_SCHEDULER: JSON.stringify({ mode: 'default' }),
        },
        proofExpectation: {
          schedulerVerification: 'not-verified-without-observed-events',
          comparisonRole: 'baseline-throughput-and-frame-tail-only',
        },
      },
      {
        id: 'cooperative-spn-gaussian',
        schedulerMode: 'friendly',
        label: 'Cooperative SHARP SPN plus Gaussian phase',
        scheduler: {
          mode: 'cooperative',
          spnPatchChunkSize: 1,
          yieldMs: 3,
          waitForSubmittedWorkDone: true,
          gaussianPhaseYieldMs: 4,
          vitBlockChunkSize: 2,
          cpuChunkItems: 65536,
          routeTailYieldMs: 3,
        },
        env: {
          KAMINOS_SHARP_WEBGPU_SCHEDULER_MODE: 'friendly',
          KAMINOS_SHARP_WEBGPU_SCHEDULER: JSON.stringify({
            mode: 'cooperative',
            spnPatchChunkSize: 1,
            yieldMs: 3,
            waitForSubmittedWorkDone: true,
            gaussianPhaseYieldMs: 4,
            vitBlockChunkSize: 2,
            cpuChunkItems: 65536,
            routeTailYieldMs: 3,
          }),
        },
        unsupportedFields: ['vitBlockChunkSize'],
        proofExpectation: {
          schedulerVerification: 'observed-events-plus-boundary-assertions',
          comparisonRole: 'field-level-spn-gaussian-proof-only',
          unsupported: ['phaseChunkSize.vitBlock'],
        },
      },
    ],
  };
}

export function sharpBreathingRoomSchedulerProfileForMode(mode = 'default') {
  const requested = String(mode || 'default').trim();
  const normalized = requested.toLowerCase();
  const profileId = SHARP_BREATHING_ROOM_MODE_ALIASES.get(normalized);
  const knownModes = [...SHARP_BREATHING_ROOM_MODE_ALIASES.keys()].sort();
  if (!profileId) {
    throw new Error(`unknown SHARP breathing-room scheduler mode "${requested}"; known modes: ${knownModes.join(', ')}`);
  }
  const profile = sharpBreathingRoomComparisonProfiles().profiles.find(item => item.id === profileId);
  if (!profile) throw new Error(`SHARP breathing-room scheduler profile missing for mode "${requested}"`);
  return {
    ...clone(profile),
    requestedMode: requested,
    knownModes,
  };
}

export function createSharpBreathingRoomComparison({
  requestedPipelineId = null,
  routeId = null,
  input = null,
  flameBudget = null,
  runs = [],
  notes = [],
} = {}) {
  const summaries = runs.map(runSummary);
  const baseline = summaries.find(run => run.profileId === 'baseline-default') || summaries[0] || null;
  const cooperative = summaries.find(run => run.profileId === 'cooperative-spn-gaussian') || summaries[1] || null;
  const state = {
    downgrades: [],
    falseClosureChecks: {
      singlePairOptimizationClaimRejected: true,
      sameInputOutputMismatch: false,
      verifiedWithoutObservedBoundary: false,
      proxyOnlySchedulerProof: false,
      missingFrameQueueEvidence: false,
      spnLowresLabelsMissing: false,
      visibleUiContradiction: false,
      fallbackOrFixtureRoute: false,
      monodepthPhaseLabelsMissing: false,
    },
  };

  if (!baseline || !cooperative) addDowngrade(state, 'baseline-cooperative-pair-missing');
  addDowngrade(state, 'single-pair-smoke-not-optimization-proof');

  const outputEquivalence = outputEquivalenceForRuns(baseline, cooperative);
  if (outputEquivalence.status !== 'same-output') {
    state.falseClosureChecks.sameInputOutputMismatch = true;
    addDowngrade(state, 'same-input-output-mismatch');
  }

  const cooperativeVerification = cooperative?.schedulerVerification || null;
  if (cooperativeVerification?.status === 'verified' && !hasObservedSchedulerProof(cooperativeVerification)) {
    state.falseClosureChecks.verifiedWithoutObservedBoundary = true;
    addDowngrade(state, 'cooperative-verified-without-boundary-proof');
  }
  if (timingAuthorityIsProxyOnly(cooperativeVerification)) {
    state.falseClosureChecks.proxyOnlySchedulerProof = true;
    addDowngrade(state, 'cooperative-scheduler-proof-proxy-only');
  }
  if (cooperative?.unsupportedFields?.includes('vitBlockChunkSize')
    || cooperative?.unsupportedFields?.includes('phaseChunkSize.vitBlock')) {
    if (!cooperative.unsupportedFields.includes('vitBlockChunkSize')) cooperative.unsupportedFields.push('vitBlockChunkSize');
  }
  if (cooperative?.schedulerVerification?.status === 'verified'
    && cooperative?.spnFusionCoverage?.missingSpnFusionBlocks?.length) {
    state.falseClosureChecks.spnLowresLabelsMissing = true;
    addDowngrade(state, 'cooperative-spn-lowres-labels-missing');
  }
  if (cooperative?.schedulerVerification?.status === 'verified'
    && cooperative?.monodepthPhaseCoverage?.missingMonodepthPhaseLabels?.length) {
    state.falseClosureChecks.monodepthPhaseLabelsMissing = true;
    addDowngrade(state, 'cooperative-monodepth-phase-labels-missing');
  }

  const hasAnyContentionReport = Boolean(runs.some(run => run.contentionReport));
  if (!hasAnyContentionReport) {
    addDowngrade(state, 'flame-contention-evidence-not-provided');
  } else {
    if (!hasFrameQueueEvidence(baseline)) {
      state.falseClosureChecks.missingFrameQueueEvidence = true;
      addDowngrade(state, 'baseline-frame-queue-evidence-missing');
    }
    if (!hasFrameQueueEvidence(cooperative)) {
      state.falseClosureChecks.missingFrameQueueEvidence = true;
      addDowngrade(state, 'cooperative-frame-queue-evidence-missing');
    }
  }

  for (const summary of summaries) {
    if (summary.stageStatus === 'fixture' || summary.artifact?.status === 'fixture') {
      state.falseClosureChecks.fallbackOrFixtureRoute = true;
      addDowngrade(state, `${summary.profileId || 'run'}-fixture-route`);
    }
  }

  const invalidDowngrades = new Set([
    'baseline-cooperative-pair-missing',
    'same-input-output-mismatch',
    'cooperative-verified-without-boundary-proof',
    'cooperative-scheduler-proof-proxy-only',
    'baseline-frame-queue-evidence-missing',
    'cooperative-frame-queue-evidence-missing',
    'cooperative-spn-lowres-labels-missing',
    'cooperative-monodepth-phase-labels-missing',
  ]);
  const hasInvalidDowngrade = state.downgrades.some(downgrade => invalidDowngrades.has(downgrade));
  const status = hasInvalidDowngrade
    ? 'invalid'
    : (hasAnyContentionReport ? 'valid-smoke' : 'route-bridge');
  const evidenceClass = hasAnyContentionReport ? 'single-pair-smoke' : 'route-bridge';

  const report = {
    schema: SHARP_BREATHING_ROOM_COMPARISON_SCHEMA,
    status,
    evidenceClass,
    claimBoundary: SINGLE_PAIR_BOUNDARY,
    routeIdentity: routeIdentityFromRuns(summaries, requestedPipelineId, routeId),
    input: clone(input),
    flameBudget: clone(flameBudget),
    profiles: sharpBreathingRoomComparisonProfiles(),
    runs: summaries,
    outputEquivalence,
    schedulerComparison: {
      baseline: {
        status: baseline?.schedulerVerification?.status || null,
        classification: baseline?.schedulerVerification?.classification || null,
        unsupportedFields: baseline?.unsupportedFields || [],
      },
      cooperative: {
        status: cooperative?.schedulerVerification?.status || null,
        classification: cooperative?.schedulerVerification?.classification || null,
        unsupportedFields: cooperative?.unsupportedFields || [],
        boundaryAssertions: cooperative?.schedulerVerification?.boundaryAssertions || [],
        timingAuthority: cooperative?.schedulerVerification?.eventTrace?.timingAuthority || null,
        spnFusionCoverage: cooperative?.spnFusionCoverage || null,
        monodepthPhaseCoverage: cooperative?.monodepthPhaseCoverage || null,
      },
    },
    timingComparison: {
      adapterInferenceDurationMs: {
        baseline: baseline?.timing?.adapterInferenceDurationMs ?? null,
        cooperative: cooperative?.timing?.adapterInferenceDurationMs ?? null,
      },
      routeDurationMs: {
        baseline: baseline?.timing?.routeDurationMs ?? null,
        cooperative: cooperative?.timing?.routeDurationMs ?? null,
      },
      frameP95Ms: {
        baseline: baseline?.timing?.frameP95Ms ?? null,
        cooperative: cooperative?.timing?.frameP95Ms ?? null,
      },
      frameP99Ms: {
        baseline: baseline?.timing?.frameP99Ms ?? null,
        cooperative: cooperative?.timing?.frameP99Ms ?? null,
      },
      queueDoneP95Ms: {
        baseline: baseline?.timing?.queueDoneP95Ms ?? null,
        cooperative: cooperative?.timing?.queueDoneP95Ms ?? null,
      },
      queueDoneP99Ms: {
        baseline: baseline?.timing?.queueDoneP99Ms ?? null,
        cooperative: cooperative?.timing?.queueDoneP99Ms ?? null,
      },
    },
    falseClosureChecks: state.falseClosureChecks,
    downgrades: state.downgrades,
    notes,
  };
  const validation = validateSharpBreathingRoomComparisonEvidence(report);
  return {
    ...report,
    status: validation.status,
    evidenceClass: validation.evidenceClass,
    canClaim: validation.canClaim,
    claimBoundary: validation.claimBoundary,
    falseClosureChecks: {
      ...report.falseClosureChecks,
      ...validation.falseClosureChecks,
    },
    downgrades: validation.downgrades,
    validation,
  };
}
