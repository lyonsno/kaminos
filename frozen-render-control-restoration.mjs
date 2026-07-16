const FROZEN_RENDER_LIVE_STATE_KEYS = Object.freeze([
  'volumeReconstructionStyle',
  'boundarySplatMode',
  'boundarySplatFallbackReason',
  'boundarySplatCompositionRequested',
  'boundarySplatCompositionEffective',
  'boundarySplatCompositionFallbackReason',
  'boundarySplatRendererIdentity',
  'boundarySplatAttributeModelIdentity',
  'boundarySplatSourceAuthority',
  'hybridSplatSmokeCompositorIdentity',
  'hybridSplatSmokeApproximation',
  'hybridSmokeLayer',
  'hybridSmokeRepresentationRequested',
  'hybridSmokeRepresentationEffective',
  'hybridSmokeSourceRequested',
  'hybridSmokeSourceEffective',
  'spatialStrataHybridSmokeSourceStatus',
  'spatialStrataHybridSmokeFailureReason',
  'spatialStrataHybridSmokeSourceLifecycle',
  'spatialStrataHybridSmokeConfigRequestedIdentity',
  'spatialStrataHybridSmokeConfigEffectiveIdentity',
  'spatialStrataHybridSmokeRendererIdentity',
  'spatialStrataHybridSmokeDebug',
]);

function copyValue(value) {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === 'object') return { ...value };
  return value;
}

export function snapshotFrozenRenderLiveState(state = {}) {
  const snapshot = {};
  for (const key of FROZEN_RENDER_LIVE_STATE_KEYS) {
    if (Object.hasOwn(state, key)) snapshot[key] = copyValue(state[key]);
  }
  return snapshot;
}

export function restoreFrozenRenderLiveState(state, snapshot = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('live renderer state must be an object');
  for (const key of FROZEN_RENDER_LIVE_STATE_KEYS) {
    if (Object.hasOwn(snapshot, key)) state[key] = copyValue(snapshot[key]);
    else delete state[key];
  }
  return state;
}
