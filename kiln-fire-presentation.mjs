import {
  HYBRID_SMOKE_LAYER_IDENTITY,
  HYBRID_SPLAT_LAYER_IDENTITY,
  HYBRID_SPLAT_SMOKE_APPROXIMATION,
  HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY,
} from './hybrid-splat-smoke-compositor.mjs';

export {
  HYBRID_SMOKE_LAYER_IDENTITY,
  HYBRID_SPLAT_LAYER_IDENTITY,
  HYBRID_SPLAT_SMOKE_APPROXIMATION,
  HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY,
};

export const KILN_FIRE_PRESENTATION_SCHEMA = 'kaminos.kiln-fire-presentation.v0';
export const HYBRID_KILN_FIRE_PRESENTATION_MODE = 'learned-splat-flame-raymarched-smoke';
export const RAYMARCHED_KILN_FIRE_PRESENTATION_MODE = 'raymarched-fire-smoke';
export const HYBRID_SPLAT_DEPTH_SPLIT = 'per-pixel-transformed-splat-depth-raymarch-split-v1';
export const HYBRID_SMOKE_PHASE_AUTHORITY = 'shared-current-single-simulator-no-instance-smoke-history';

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function exactFiringId(value) {
  const firingId = String(value || '').trim();
  if (!firingId) throw new Error('kiln fire presentation firingId must be a non-empty string');
  return firingId;
}

function hybridRequested(state) {
  return state?.boundarySplatMode === 'learned'
    && state?.boundarySplatCompositionRequested === 'hybrid-smoke';
}

function hybridEffective(state) {
  return hybridRequested(state)
    && state?.boundarySplatCompositionEffective === 'hybrid-smoke'
    && state?.boundarySplatRendererIdentity === 'live-boundary-sidecar-learned-attribute-splats-v0';
}

function timingEvidence(state) {
  const profile = state?.boundarySplatGpuProfile || null;
  const stages = profile?.stages || {};
  return {
    authority: profile?.identity || null,
    status: profile?.timestampStatus || 'missing',
    compactionMs: finiteOrNull(stages.compaction?.ms ?? profile?.compactionMs),
    decodeMs: finiteOrNull(stages.learnedDecode?.ms ?? profile?.learnedDecodeMs),
    decodeResolution: profile?.timestampStatus === 'available'
      ? (finiteOrNull(stages.learnedDecode?.ms ?? profile?.learnedDecodeMs) === null
          ? 'below-or-outside-timer-resolution'
          : 'timestamp-query')
      : 'not-sampled',
  };
}

function cloneLayer(value) {
  if (!value || typeof value !== 'object') return null;
  const clone = { ...value };
  if (Array.isArray(value.intervals)) clone.intervals = [...value.intervals];
  return clone;
}

function cloneFlameContinuityEvidence(value) {
  return value && typeof value === 'object' ? structuredClone(value) : null;
}

export function createKilnFirePresentation({ firingId, state } = {}) {
  const exactId = exactFiringId(firingId);
  const effectiveHybrid = hybridEffective(state);
  const requestedHybrid = hybridRequested(state);
  const fallbackReason = requestedHybrid && !effectiveHybrid
    ? state?.boundarySplatCompositionFallbackReason
      || state?.boundarySplatFallbackReason
      || 'requested-hybrid-not-effective'
    : null;
  return {
    schema: KILN_FIRE_PRESENTATION_SCHEMA,
    firingId: exactId,
    requestedMode: requestedHybrid
      ? HYBRID_KILN_FIRE_PRESENTATION_MODE
      : RAYMARCHED_KILN_FIRE_PRESENTATION_MODE,
    effectiveMode: effectiveHybrid
      ? HYBRID_KILN_FIRE_PRESENTATION_MODE
      : RAYMARCHED_KILN_FIRE_PRESENTATION_MODE,
    simulatorAuthority: 'live-fluid-simulation-v0',
    flameRendererIdentity: state?.boundarySplatRendererIdentity || state?.effectiveRoute || null,
    smokeRendererIdentity: state?.effectiveRoute || null,
    sourceSidecarIdentity: state?.boundarySidecarIdentity || null,
    sourceSidecarAuthority: state?.boundarySplatSourceAuthority || state?.boundarySidecarAuthority || null,
    learnedModelIdentity: state?.boundarySplatAttributeModelIdentity || null,
    candidateCount: finiteOrNull(state?.boundarySplatCandidateCount),
    candidateCapacity: finiteOrNull(state?.boundarySplatCapacity),
    candidateOverflow: finiteOrNull(state?.boundarySplatOverflowCount),
    candidateCopyBytes: finiteOrNull(state?.boundarySplatCopyBytesThisFrame),
    fallbackReason,
    flameContinuityRequested: state?.flameContinuityRequested || 'live-every-frame',
    flameContinuityEffective: state?.flameContinuityEffective || 'live-every-frame',
    flameContinuityEffectiveReason: state?.flameContinuityEffectiveReason || 'unspecified',
    flameContinuityEvidence: cloneFlameContinuityEvidence(state?.flameContinuityEvidence),
    hybridSplatSmokeCompositorIdentity: state?.hybridSplatSmokeCompositorIdentity || null,
    hybridSplatSmokeApproximation: state?.hybridSplatSmokeApproximation || null,
    splatDepthConditionedSmokeSplit: state?.splatDepthConditionedSmokeSplit || null,
    hybridSmokePhaseAuthority: state?.hybridSmokePhaseAuthority || null,
    hybridSplatLayer: cloneLayer(state?.hybridSplatLayer),
    hybridSmokeLayer: cloneLayer(state?.hybridSmokeLayer),
    raster: {
      radius: finiteOrNull(state?.boundarySplatRadius ?? state?.controls?.boundarySplatRadius),
      sharpness: finiteOrNull(state?.boundarySplatSharpness ?? state?.controls?.boundarySplatSharpness),
      energyCompensation: 'sqrt-integrated-energy-v0',
    },
    timing: timingEvidence(state),
    fireEpisodeHooks: state?.fireEpisodeHooks ? structuredClone(state.fireEpisodeHooks) : null,
  };
}

export function createExpectedHybridKilnFirePresentation({ firingId, learnedModelIdentity, flameContinuityRequested = null } = {}) {
  const expected = {
    firingId: exactFiringId(firingId),
    effectiveMode: HYBRID_KILN_FIRE_PRESENTATION_MODE,
    flameRendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
    smokeRendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
    learnedModelIdentity: learnedModelIdentity || null,
    sourceSidecarIdentity: 'baked-boundary-sidecar-v0',
    sourceSidecarAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
    hybridSplatSmokeCompositorIdentity: HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY,
    hybridSplatSmokeApproximation: HYBRID_SPLAT_SMOKE_APPROXIMATION,
    splatDepthConditionedSmokeSplit: HYBRID_SPLAT_DEPTH_SPLIT,
    hybridSmokePhaseAuthority: HYBRID_SMOKE_PHASE_AUTHORITY,
    hybridSplatLayer: {
      identity: HYBRID_SPLAT_LAYER_IDENTITY,
    },
    hybridSmokeLayer: {
      identity: HYBRID_SMOKE_LAYER_IDENTITY,
      intervals: ['front-of-splat-depth', 'back-of-splat-depth'],
      opticalComposition: 'front-smoke>splat>back-smoke',
    },
    requireNoFallback: true,
    requireZeroOverflow: true,
    requireCandidateEvidence: true,
    requireZeroCandidateCopy: true,
    requireNonEmptyCandidateSet: true,
    requireFireEpisodeHooks: true,
  };
  if (flameContinuityRequested) {
    expected.flameContinuityRequested = flameContinuityRequested;
    expected.requireFlameContinuityEvidence = true;
  }
  return expected;
}

function flameContinuityEvidenceReady(presentation, requested) {
  if (!requested) return true;
  const continuity = presentation?.flameContinuityEvidence;
  const counts = continuity?.counts;
  if (presentation?.flameContinuityRequested !== requested
    || continuity?.schema !== 'kaminos.single-flame-continuity-runtime.v0'
    || continuity?.firingId !== presentation?.firingId
    || continuity?.requested !== requested
    || continuity?.effective !== presentation?.flameContinuityEffective
    || !['live', 'holdover'].includes(continuity?.mode)
    || !Number.isFinite(counts?.live)
    || !Number.isFinite(counts?.holdover)
    || !Number.isFinite(counts?.fallback)) {
    return false;
  }
  if (continuity.mode === 'holdover') {
    return Number.isFinite(continuity.selectedHistorySlot?.slotIndex)
      && Number.isFinite(continuity.selectedHistorySlot?.historyAllocationGeneration)
      && Number.isFinite(continuity.selectedHistorySlot?.archiveWriteSequence)
      && Number.isFinite(continuity.selectedHistorySlot?.sourceCandidateGeneration)
      && continuity.renderFrameAdvanced === true
      && continuity.sourceRenderFrameAdvanced === false
      && continuity.simulatorStepAdvanced === false;
  }
  return continuity.renderFrameAdvanced === true
    && continuity.sourceRenderFrameAdvanced === true
    && continuity.simulatorStepAdvanced === true
    && (counts.fallback === 0 || Boolean(continuity.fallbackReason));
}

export async function waitForHybridKilnFirePresentation({
  firingId,
  flameContinuityRequested = null,
  readState,
  requestFrame = callback => requestAnimationFrame(callback),
  now = () => performance.now(),
  timeoutMs = 15000,
} = {}) {
  const exactId = exactFiringId(firingId);
  if (typeof readState !== 'function') throw new Error('hybrid presentation readiness requires a state reader');
  if (typeof requestFrame !== 'function') throw new Error('hybrid presentation readiness requires a frame scheduler');
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('hybrid presentation readiness timeoutMs must be finite and positive');
  }
  const startedAtMs = Number(now());
  while (true) {
    const state = readState() || {};
    const hardFallback = state.boundarySplatCompositionEffective === 'raymarch-fallback'
      ? state.boundarySplatCompositionFallbackReason || state.boundarySplatFallbackReason || 'raymarch-fallback'
      : state.boundarySplatFallbackReason;
    if (hardFallback) throw new Error(`Hybrid flame preview could not start: ${hardFallback}`);
    const presentation = createKilnFirePresentation({ firingId: exactId, state });
    const candidateEvidencePresent = Number.isFinite(presentation.candidateCount)
      && presentation.candidateCount > 0
      && Number.isFinite(presentation.candidateCapacity)
      && Number.isFinite(presentation.candidateOverflow)
      && Number.isFinite(presentation.candidateCopyBytes);
    if (presentation.candidateOverflow > 0) {
      throw new Error(`Hybrid flame preview overflowed ${presentation.candidateOverflow} candidates`);
    }
    if (presentation.candidateCopyBytes > 0) {
      throw new Error(`Hybrid flame preview copied ${presentation.candidateCopyBytes} candidate bytes to the CPU`);
    }
    const continuityEvidencePresent = flameContinuityEvidenceReady(presentation, flameContinuityRequested);
    if (presentation.effectiveMode === HYBRID_KILN_FIRE_PRESENTATION_MODE
      && candidateEvidencePresent
      && continuityEvidencePresent) {
      return presentation;
    }
    if (Number(now()) - startedAtMs >= timeout) {
      throw new Error(`Hybrid flame preview timed out waiting for candidate evidence and continuity evidence after ${timeout}ms`);
    }
    await new Promise(resolve => requestFrame(resolve));
  }
}
