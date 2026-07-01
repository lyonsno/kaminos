import {
  KAMINOS_HOST_SURFACE_STATE_SCHEMA,
  createHostSurfaceState,
  objectOrEmpty,
  arrayOrEmpty,
  finite,
  uniqueStrings,
  normalizeRejectedDebugSurface,
} from './host-surface-core.js';

export const KAMINOS_GLOVE_WELL_HOST_STATE_SCHEMA = 'kaminos.glove-well-host.state.v0';
export const KAMINOS_GLOVE_WELL_HOST_ROUTE = 'kaminos/glove-well-host';
export const LERMS_GLOVE_WELL_HOST_PACKET_SCHEMA = 'lerms.glove-well-host-packet.v0';
export const LERMS_GLOVE_WELL_HOST_PACKET_ROUTE = 'lerms/glove-well/host-packet';
export const LERMS_GLOVE_WELL_HOST_SURFACE_SCHEMA = 'lerms.glove-well-host-surface.v0';

export const GLOVE_WELL_HOST_ADAPTER = {
  hostId: 'glove-well',
  hostLabel: 'Glove Well',
  hostRoute: KAMINOS_GLOVE_WELL_HOST_ROUTE,
  hostStateSchema: KAMINOS_GLOVE_WELL_HOST_STATE_SCHEMA,
  packetSchema: LERMS_GLOVE_WELL_HOST_PACKET_SCHEMA,
  packetRoute: LERMS_GLOVE_WELL_HOST_PACKET_ROUTE,
  defaultProducerDiaulos: 'greedy-glove-fucker',
  defaultSourceAuthority: 'unknown',
  defaultSourceTruthAuthority: 'unknown',
  defaultDowngrades: ['local_browser_smoke_not_native_kaminos_host', 'visual_capture_not_source_truth'],
  defaultRejectedDebugSurfaces: [
    {
      surface: 'local_lerms_browser_smoke',
      label: 'Local LERMS browser smoke',
      acceptanceSurface: false,
      reason: 'debug surface, not native Kaminos host acceptance',
    },
    {
      surface: 'preview_bench_smoke_offer_card',
      label: 'Preview Bench smoke-offer card',
      acceptanceSurface: false,
      reason: 'evidence card, not operator scene host',
    },
  ],
};

function point2(value, fallback = { x: 0.5, y: 0.5 }) {
  const source = objectOrEmpty(value);
  return {
    x: Math.max(0, Math.min(1, finite(source.x, fallback.x))),
    y: Math.max(0, Math.min(1, finite(source.y, fallback.y))),
  };
}

function normalizePrimitive(primitive, index = 0) {
  const source = objectOrEmpty(primitive);
  const kind = source.kind || 'point';
  const normalized = {
    id: source.id || `glove-well-primitive-${index}`,
    layerId: source.layerId || 'glove-well',
    kind,
    role: source.role || kind,
    sourceRef: source.sourceRef || null,
    color: source.color || '#82e2be',
    alpha: Math.max(0, Math.min(1, finite(source.alpha, 1))),
    text: source.text || null,
  };
  if (source.center) normalized.center = point2(source.center);
  if (source.start) normalized.start = point2(source.start);
  if (source.end) normalized.end = point2(source.end);
  if (source.radius !== undefined) normalized.radius = Math.max(0.001, finite(source.radius, 0.01));
  if (source.radiusX !== undefined) normalized.radiusX = Math.max(0.001, finite(source.radiusX, 0.02));
  if (source.radiusY !== undefined) normalized.radiusY = Math.max(0.001, finite(source.radiusY, 0.02));
  if (kind === 'line' && (!normalized.start || !normalized.end)) {
    throw new Error(`Glove Well primitive ${normalized.id} line missing start/end`);
  }
  if (kind !== 'line' && !normalized.center && kind !== 'badge') {
    throw new Error(`Glove Well primitive ${normalized.id} missing center`);
  }
  if (kind === 'badge' && !normalized.center) normalized.center = point2(source.center, { x: 0.035, y: 0.04 + index * 0.03 });
  return normalized;
}

function normalizeSurface(surface) {
  const source = objectOrEmpty(surface);
  if (source.schema !== LERMS_GLOVE_WELL_HOST_SURFACE_SCHEMA) {
    throw new Error(`Glove Well host packet missing source-owned surface: expected ${LERMS_GLOVE_WELL_HOST_SURFACE_SCHEMA}`);
  }
  if (source.hostRouteExpectation && source.hostRouteExpectation !== KAMINOS_GLOVE_WELL_HOST_ROUTE) {
    throw new Error(`Glove Well host surface route mismatch: expected ${KAMINOS_GLOVE_WELL_HOST_ROUTE} but got ${source.hostRouteExpectation}`);
  }
  const primitives = arrayOrEmpty(source.primitives).map(normalizePrimitive);
  if (primitives.length === 0) {
    throw new Error('Glove Well host packet missing source-owned surface primitives');
  }
  const primitiveRoles = [...new Set(primitives.map(primitive => primitive.role).filter(Boolean))];
  return {
    schema: LERMS_GLOVE_WELL_HOST_SURFACE_SCHEMA,
    surfaceId: source.surfaceId || 'glove-well-native-smoke',
    hostRouteExpectation: source.hostRouteExpectation || KAMINOS_GLOVE_WELL_HOST_ROUTE,
    coordinateFrame: objectOrEmpty(source.coordinateFrame),
    layers: arrayOrEmpty(source.layers).map((layer, index) => {
      const item = objectOrEmpty(layer);
      return {
        id: item.id || `layer-${index}`,
        label: item.label || item.id || `Layer ${index + 1}`,
        sourceOwned: item.sourceOwned !== false,
      };
    }),
    primitives,
    primitiveCount: primitives.length,
    primitiveRoles,
    statusBadges: arrayOrEmpty(source.statusBadges).map((badge, index) => ({
      id: objectOrEmpty(badge).id || `badge-${index}`,
      label: objectOrEmpty(badge).label || objectOrEmpty(badge).id || `Badge ${index + 1}`,
      value: String(objectOrEmpty(badge).value ?? ''),
      authorityBearing: objectOrEmpty(badge).authorityBearing === true,
    })),
    controls: arrayOrEmpty(source.controls).map((control, index) => ({
      id: objectOrEmpty(control).id || `control-${index}`,
      label: objectOrEmpty(control).label || objectOrEmpty(control).id || `Control ${index + 1}`,
      sourceOwned: objectOrEmpty(control).sourceOwned === true,
      reason: objectOrEmpty(control).reason || null,
    })),
    witnessExpectations: objectOrEmpty(source.witnessExpectations),
  };
}

function sourceCustodyRows(custody) {
  const source = objectOrEmpty(custody);
  const rows = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'downgrades' || key === 'rejectedDebugSurfaces') continue;
    if (Array.isArray(value) && value.length > 0) rows[key] = [...value];
  }
  return rows;
}

export function normalizeGloveWellHostPacket(packet) {
  const source = objectOrEmpty(packet);
  if (source.schema !== LERMS_GLOVE_WELL_HOST_PACKET_SCHEMA) {
    throw new Error(`Glove Well host packet schema mismatch: expected ${LERMS_GLOVE_WELL_HOST_PACKET_SCHEMA} but got ${source.schema || 'missing'}`);
  }
  if (source.route !== LERMS_GLOVE_WELL_HOST_PACKET_ROUTE) {
    throw new Error(`Glove Well host packet route mismatch: expected ${LERMS_GLOVE_WELL_HOST_PACKET_ROUTE} but got ${source.route || 'missing'}`);
  }
  const surface = normalizeSurface(source.surface);
  const custody = objectOrEmpty(source.custody);
  const sourceDowngrades = uniqueStrings(source.downgrades, custody.downgrades);
  const downgrades = uniqueStrings(GLOVE_WELL_HOST_ADAPTER.defaultDowngrades, sourceDowngrades);
  const sourceCustody = sourceCustodyRows(custody);
  const rejectedDebugSurfaces = [
    ...GLOVE_WELL_HOST_ADAPTER.defaultRejectedDebugSurfaces,
    ...arrayOrEmpty(source.rejectedDebugSurfaces || custody.rejectedDebugSurfaces).map(normalizeRejectedDebugSurface),
  ];
  const uniqueRejected = [];
  for (const item of rejectedDebugSurfaces) {
    if (!uniqueRejected.some(existing => existing.surface === item.surface)) uniqueRejected.push(item);
  }
  return {
    ...source,
    schema: LERMS_GLOVE_WELL_HOST_PACKET_SCHEMA,
    route: LERMS_GLOVE_WELL_HOST_PACKET_ROUTE,
    packetUrl: source.packetUrl || null,
    source: {
      ...objectOrEmpty(source.source),
      producerDiaulos: source.source?.producerDiaulos || 'greedy-glove-fucker',
      route: source.source?.route || LERMS_GLOVE_WELL_HOST_PACKET_ROUTE,
      authority: source.source?.authority || 'unknown',
      sourceTruthAuthority: source.source?.sourceTruthAuthority || source.source?.authority || 'unknown',
    },
    freshness: {
      status: source.freshness?.status || 'unknown',
      budgetMs: finite(source.freshness?.budgetMs, 0),
      ageMs: source.freshness?.ageMs ?? null,
      cameraAgeMs: source.freshness?.cameraAgeMs ?? null,
      generatedAtMs: source.freshness?.generatedAtMs ?? null,
      ...objectOrEmpty(source.freshness),
    },
    coordinateFrame: {
      space: source.coordinateFrame?.space || 'operator_visible_webcam_mirrored_screen_normalized',
      origin: source.coordinateFrame?.origin || 'top_left',
      xRange: Array.isArray(source.coordinateFrame?.xRange) ? source.coordinateFrame.xRange : [0, 1],
      yRange: Array.isArray(source.coordinateFrame?.yRange) ? source.coordinateFrame.yRange : [0, 1],
      depthLoadBearing: source.coordinateFrame?.depthLoadBearing === true,
    },
    gloveWell: objectOrEmpty(source.gloveWell),
    handSkeleton: objectOrEmpty(source.handSkeleton),
    goins: arrayOrEmpty(source.goins),
    lermDesireHints: arrayOrEmpty(source.lermDesireHints),
    surface,
    capture: objectOrEmpty(source.capture),
    downgrades,
    sourceDowngrades,
    rejectedDebugSurfaces: uniqueRejected,
    custody: {
      ...custody,
      downgrades,
      rejectedDebugSurfaces: uniqueRejected,
    },
    sourceCustody,
  };
}

export function createGloveWellHostState(packet, options = {}) {
  const normalized = normalizeGloveWellHostPacket(packet);
  const hostSurface = createHostSurfaceState({
    adapter: GLOVE_WELL_HOST_ADAPTER,
    packetSchema: normalized.schema,
    packetRoute: normalized.route,
    packetUrl: normalized.packetUrl || null,
    source: normalized.source,
    freshness: normalized.freshness,
    downgrades: normalized.custody.downgrades,
    sourceDowngrades: normalized.sourceDowngrades,
    rejectedDebugSurfaces: normalized.rejectedDebugSurfaces,
    custody: normalized.custody,
    sourceCustody: normalized.sourceCustody,
    visual: {
      coordinateFrame: normalized.coordinateFrame,
      surfaceId: normalized.surface.surfaceId,
    },
    hostSpecific: {
      surfaceSchema: normalized.surface.schema,
      surfaceId: normalized.surface.surfaceId,
      primitiveCount: normalized.surface.primitiveCount,
      primitiveRoles: normalized.surface.primitiveRoles,
      goinCount: normalized.goins.length,
      lermDesireHintCount: normalized.lermDesireHints.length,
      captureState: normalized.capture.state || 'unknown',
    },
  }, options);
  return {
    schema: KAMINOS_GLOVE_WELL_HOST_STATE_SCHEMA,
    hostSurfaceSchema: KAMINOS_HOST_SURFACE_STATE_SCHEMA,
    route: KAMINOS_GLOVE_WELL_HOST_ROUTE,
    hostId: hostSurface.hostId,
    hostLabel: hostSurface.hostLabel,
    hostRoute: hostSurface.hostRoute,
    effectiveUrl: hostSurface.effectiveUrl || normalized.packetUrl || null,
    loadedAt: hostSurface.loadedAt,
    packetSchema: normalized.schema,
    packetRoute: normalized.route,
    packetUrl: normalized.packetUrl || null,
    source: normalized.source,
    sourceAuthority: normalized.source.authority,
    sourceTruthAuthority: normalized.source.sourceTruthAuthority,
    freshness: normalized.freshness,
    coordinateFrame: normalized.coordinateFrame,
    gloveWell: normalized.gloveWell,
    handSkeleton: normalized.handSkeleton,
    goins: normalized.goins,
    lermDesireHints: normalized.lermDesireHints,
    surface: normalized.surface,
    capture: normalized.capture,
    downgrades: hostSurface.downgrades,
    sourceDowngrades: hostSurface.sourceDowngrades,
    rejectedDebugSurfaces: hostSurface.rejectedDebugSurfaces,
    custody: hostSurface.custody,
    sourceCustody: hostSurface.sourceCustody,
    hostSpecific: hostSurface.hostSpecific,
    hostSurface,
  };
}
