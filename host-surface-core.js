export const KAMINOS_HOST_SURFACE_STATE_SCHEMA = 'kaminos.host-surface.state.v0';
export const KAMINOS_HOST_SURFACE_ROUTE = 'kaminos/host-surface';

export function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

export function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function vec3(value, fallback = [0, 0, 0]) {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? [value.x, value.y, value.z]
      : fallback;
  return [
    finite(raw[0], fallback[0] || 0),
    finite(raw[1], fallback[1] || 0),
    finite(raw[2], fallback[2] || 0),
  ];
}

export function color4(value, fallback = [0.9, 0.55, 0.2, 0.85]) {
  const raw = Array.isArray(value) ? value : fallback;
  return [
    Math.max(0, Math.min(1, finite(raw[0], fallback[0]))),
    Math.max(0, Math.min(1, finite(raw[1], fallback[1]))),
    Math.max(0, Math.min(1, finite(raw[2], fallback[2]))),
    Math.max(0, Math.min(1, finite(raw[3], fallback[3]))),
  ];
}

export function uniqueStrings(...groups) {
  const out = [];
  for (const group of groups) {
    for (const value of arrayOrEmpty(group)) {
      if (value === undefined || value === null || value === '') continue;
      const text = String(value);
      if (!out.includes(text)) out.push(text);
    }
  }
  return out;
}

export function normalizeRejectedDebugSurface(surface, index = 0) {
  const source = objectOrEmpty(surface);
  return {
    surface: source.surface || source.id || `debug-surface-${index}`,
    label: source.label || source.surface || source.id || `Debug surface ${index + 1}`,
    acceptanceSurface: source.acceptanceSurface === true ? true : false,
    reason: source.reason || 'debug route is evidence, not host acceptance',
  };
}

function normalizeHostSurfaceAdapter(adapter) {
  const source = objectOrEmpty(adapter);
  if (!source.hostId) throw new Error('host surface adapter missing hostId');
  if (!source.hostRoute) throw new Error(`host surface adapter ${source.hostId} missing hostRoute`);
  if (!source.hostStateSchema) throw new Error(`host surface adapter ${source.hostId} missing hostStateSchema`);
  return {
    hostId: source.hostId,
    hostLabel: source.hostLabel || source.hostId,
    hostRoute: source.hostRoute,
    hostStateSchema: source.hostStateSchema,
    packetSchema: source.packetSchema || null,
    packetRoute: source.packetRoute || null,
    defaultProducerDiaulos: source.defaultProducerDiaulos || null,
    defaultSourceAuthority: source.defaultSourceAuthority || 'unknown',
    defaultSourceTruthAuthority: source.defaultSourceTruthAuthority || source.defaultSourceAuthority || 'unknown',
    defaultDowngrades: uniqueStrings(source.defaultDowngrades),
    defaultRejectedDebugSurfaces: arrayOrEmpty(source.defaultRejectedDebugSurfaces).map(normalizeRejectedDebugSurface),
  };
}

export function createHostSurfaceState(input, options = {}) {
  const source = objectOrEmpty(input);
  const adapter = normalizeHostSurfaceAdapter(source.adapter);
  const packetSchema = source.packetSchema || adapter.packetSchema || null;
  const packetRoute = source.packetRoute || adapter.packetRoute || null;
  const sourceInfo = {
    producerDiaulos: source.source?.producerDiaulos || adapter.defaultProducerDiaulos,
    route: source.source?.route || packetRoute,
    sourceRef: source.source?.sourceRef || null,
    authority: source.source?.authority || adapter.defaultSourceAuthority,
    sourceTruthAuthority: source.source?.sourceTruthAuthority || adapter.defaultSourceTruthAuthority,
    ...objectOrEmpty(source.source),
  };
  const downgrades = uniqueStrings(adapter.defaultDowngrades, source.downgrades);
  const rejectedDebugSurfaces = [
    ...adapter.defaultRejectedDebugSurfaces,
    ...arrayOrEmpty(source.rejectedDebugSurfaces).map(normalizeRejectedDebugSurface),
  ];
  const uniqueRejected = [];
  for (const surface of rejectedDebugSurfaces) {
    if (!uniqueRejected.some(existing => existing.surface === surface.surface)) {
      uniqueRejected.push(surface);
    }
  }

  return {
    schema: KAMINOS_HOST_SURFACE_STATE_SCHEMA,
    route: KAMINOS_HOST_SURFACE_ROUTE,
    hostId: adapter.hostId,
    hostLabel: adapter.hostLabel,
    hostRoute: adapter.hostRoute,
    hostStateSchema: adapter.hostStateSchema,
    effectiveUrl: options.effectiveUrl || source.effectiveUrl || null,
    loadedAt: options.loadedAt || source.loadedAt || new Date().toISOString(),
    packetSchema,
    packetRoute,
    packetUrl: source.packetUrl || null,
    source: sourceInfo,
    sourceAuthority: sourceInfo.authority,
    sourceTruthAuthority: sourceInfo.sourceTruthAuthority,
    freshness: {
      status: source.freshness?.status || 'unknown',
      budgetMs: finite(source.freshness?.budgetMs, 0),
      observedAt: source.freshness?.observedAt || null,
      generatedAt: source.freshness?.generatedAt || null,
      sampleAgeMs: source.freshness?.sampleAgeMs ?? null,
      ...objectOrEmpty(source.freshness),
    },
    visual: objectOrEmpty(source.visual),
    downgrades,
    sourceDowngrades: uniqueStrings(source.sourceDowngrades),
    rejectedDebugSurfaces: uniqueRejected,
    custody: objectOrEmpty(source.custody),
    sourceCustody: objectOrEmpty(source.sourceCustody),
    hostSpecific: objectOrEmpty(source.hostSpecific),
  };
}
