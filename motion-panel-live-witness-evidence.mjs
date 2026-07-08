export function assertHillRouteOverlayEvidence(evidence = {}, request = {}) {
  const requestedOverlay = String(request.hillTerrainOverlay || '').trim();
  const requestedProfile = String(request.hillRouteProfile || '').trim();
  const routeCostRequested = requestedOverlay === 'route-cost';
  const legend = evidence?.terrainOverlayLegend || evidence?.hillTerrainSurface?.overlayLegend || null;
  const effectiveProfile = evidence?.pathWorldRouteCostProfile?.id
    || evidence?.pathWorldRoutePlan?.cost?.profile?.id
    || evidence?.result?.routePlan?.cost?.profile?.id
    || null;
  const normalization = legend?.normalization || null;
  const fingerprint = evidence?.overlayColorFingerprint
    || legend?.overlayColorFingerprint
    || evidence?.hillTerrainSurface?.overlayColorFingerprint
    || null;

  if (routeCostRequested && !legend) {
    throw new Error('route-cost overlay evidence missing terrainOverlayLegend');
  }
  if (routeCostRequested && legend?.mode !== 'route-cost') {
    throw new Error(`requested route-cost overlay but effective overlay is ${legend?.mode || 'missing'}`);
  }
  if (routeCostRequested && legend?.profileSensitive !== true) {
    throw new Error('route-cost overlay evidence is not marked profileSensitive');
  }
  if (routeCostRequested && normalization?.method !== 'profile-quantile-range-v0') {
    throw new Error(`route-cost overlay normalization method is ${normalization?.method || 'missing'}`);
  }
  if (requestedProfile && effectiveProfile !== requestedProfile) {
    throw new Error(`requested Hill route profile ${requestedProfile} but effective route profile is ${effectiveProfile || 'missing'}`);
  }
  if (routeCostRequested && requestedProfile && normalization?.costProfile !== requestedProfile) {
    throw new Error(`requested Hill route profile ${requestedProfile} but route-cost normalization profile is ${normalization?.costProfile || 'missing'}`);
  }
  if (routeCostRequested && !fingerprint) {
    throw new Error('route-cost overlay evidence missing overlayColorFingerprint');
  }
  return {
    schema: 'kaminos.motion-panel-live-hill-overlay-evidence-gate.v0',
    ok: true,
    requestedOverlay: requestedOverlay || null,
    requestedProfile: requestedProfile || null,
    effectiveOverlay: legend?.mode || null,
    effectiveProfile,
    overlayColorFingerprint: fingerprint,
  };
}
