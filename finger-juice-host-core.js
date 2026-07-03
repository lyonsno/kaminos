import {
  KAMINOS_HOST_SURFACE_STATE_SCHEMA,
  createHostSurfaceState,
} from './host-surface-core.js';

export const KAMINOS_FINGER_JUICE_HOST_STATE_SCHEMA = 'kaminos.finger-juice-host.state.v0';
export const KAMINOS_FINGER_JUICE_HOST_ROUTE = 'kaminos/finger-juice-host';
export const BIG_PAPA_FINGER_JUICE_HOST_PACKET_SCHEMA = 'big-papa-finger-juice.host-packet.v0';
export const BIG_PAPA_FINGER_JUICE_HOST_PACKET_ROUTE = 'big-papa/finger-juice/host-packet';
export const BIG_PAPA_FINGER_JUICE_RENDER_PAYLOAD_PREVIEW_SCHEMA = 'big-papa-finger-juice.render-payload.preview.v0';
export const FINGER_JUICE_HOST_LIVE_FRAME_DOWNGRADE = 'host_live_solver_iframe_until_native_render_buffer';

export const FINGER_JUICE_HOST_ADAPTER = {
  hostId: 'finger-juice',
  hostLabel: 'Finger Juice Preview',
  hostRoute: KAMINOS_FINGER_JUICE_HOST_ROUTE,
  hostStateSchema: KAMINOS_FINGER_JUICE_HOST_STATE_SCHEMA,
  packetSchema: BIG_PAPA_FINGER_JUICE_HOST_PACKET_SCHEMA,
  packetRoute: BIG_PAPA_FINGER_JUICE_HOST_PACKET_ROUTE,
  defaultProducerDiaulos: 'big-papa-finger-juice-fucker',
  defaultSourceAuthority: 'unknown',
  defaultSourceTruthAuthority: 'unknown',
  defaultDowngrades: [
    'host_packet_preview_payload_not_native_render_buffer',
    FINGER_JUICE_HOST_LIVE_FRAME_DOWNGRADE,
  ],
  defaultRejectedDebugSurfaces: [
    {
      surface: 'direct_lerms_finger_juice_debug_route',
      acceptanceSurface: false,
      reason: 'direct debug route remains rejected evidence, not the operator-facing native host surface',
    },
  ],
};

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vec3(value, fallback = [0, 0, 0]) {
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

function color4(value, fallback = [0.9, 0.55, 0.2, 0.85]) {
  const raw = Array.isArray(value) ? value : fallback;
  return [
    Math.max(0, Math.min(1, finite(raw[0], fallback[0]))),
    Math.max(0, Math.min(1, finite(raw[1], fallback[1]))),
    Math.max(0, Math.min(1, finite(raw[2], fallback[2]))),
    Math.max(0, Math.min(1, finite(raw[3], fallback[3]))),
  ];
}

function uniqueStrings(...groups) {
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

function normalizePreviewParticle(particle, index = 0) {
  const source = objectOrEmpty(particle);
  const chemistry = source.chemistry || source.material || 'finger-juice';
  const fallbackColor = chemistry === 'pooling'
    ? [0.28, 0.74, 1, 0.78]
    : chemistry === 'weird'
      ? [0.82, 0.38, 1, 0.78]
      : [1, 0.32, 0.08, 0.86];
  return {
    id: source.id || `preview-particle-${index}`,
    position: vec3(source.position || source.positionWorld || source.world),
    velocity: vec3(source.velocity || source.velocityWorld, [0, 0, 0]),
    radius: Math.max(0.004, finite(source.radius ?? source.size, 0.03)),
    chemistry,
    color: color4(source.color || source.rgba, fallbackColor),
  };
}

function normalizePreviewTrail(trail, index = 0) {
  const source = objectOrEmpty(trail);
  return {
    id: source.id || `preview-trail-${index}`,
    samples: arrayOrEmpty(source.samples).map(sample => vec3(sample?.position || sample)),
    color: color4(source.color || source.rgba, [1, 0.42, 0.08, 0.6]),
  };
}

function normalizeRenderPayload(render) {
  const payload = objectOrEmpty(render?.payload);
  const downgrades = uniqueStrings(payload.downgrades, render?.downgrades);
  if (payload.downgraded && !downgrades.includes('preview_particle_samples_not_full_render_buffer')) {
    downgrades.push('preview_particle_samples_not_full_render_buffer');
  }
  return {
    schema: payload.schema || BIG_PAPA_FINGER_JUICE_RENDER_PAYLOAD_PREVIEW_SCHEMA,
    downgraded: payload.downgraded !== false,
    downgrades,
    particles: arrayOrEmpty(payload.particles || payload.previewParticles || payload.particleSamples)
      .map(normalizePreviewParticle),
    trails: arrayOrEmpty(payload.trails || payload.previewTrails || payload.trailSamples)
      .map(normalizePreviewTrail),
  };
}

function normalizeRejectedDebugSurface(surface, index = 0) {
  const source = objectOrEmpty(surface);
  return {
    surface: source.surface || source.id || `debug-surface-${index}`,
    label: source.label || source.surface || source.id || `Debug surface ${index + 1}`,
    acceptanceSurface: source.acceptanceSurface === true ? true : false,
    reason: source.reason || 'debug route is evidence, not host acceptance',
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

export function normalizeFingerJuiceHostPacket(packet) {
  const source = objectOrEmpty(packet);
  if (source.schema !== BIG_PAPA_FINGER_JUICE_HOST_PACKET_SCHEMA) {
    throw new Error(`Finger Juice host packet schema mismatch: expected ${BIG_PAPA_FINGER_JUICE_HOST_PACKET_SCHEMA} but got ${source.schema || 'missing'}`);
  }
  if (source.route !== BIG_PAPA_FINGER_JUICE_HOST_PACKET_ROUTE) {
    throw new Error(`Finger Juice host packet route mismatch: expected ${BIG_PAPA_FINGER_JUICE_HOST_PACKET_ROUTE} but got ${source.route || 'missing'}`);
  }

  const renderPayload = normalizeRenderPayload(source.render);
  const custody = objectOrEmpty(source.custody);
  const sourceDowngrades = uniqueStrings(
    custody.downgrades,
    source.downgrades,
    source.render?.downgrades,
    source.render?.payload?.downgrades,
  );
  const sourceCustody = sourceCustodyRows(custody);
  const downgrades = uniqueStrings(
    custody.downgrades,
    source.downgrades,
    renderPayload.downgrades,
    renderPayload.downgraded ? ['host_packet_preview_payload_not_native_render_buffer'] : [],
    [FINGER_JUICE_HOST_LIVE_FRAME_DOWNGRADE],
  );
  const rejectedDebugSurfaces = arrayOrEmpty(custody.rejectedDebugSurfaces)
    .map(normalizeRejectedDebugSurface);
  if (!rejectedDebugSurfaces.some(surface => surface.surface === 'direct_lerms_finger_juice_debug_route')) {
    rejectedDebugSurfaces.push(normalizeRejectedDebugSurface({
      surface: 'direct_lerms_finger_juice_debug_route',
      acceptanceSurface: false,
      reason: 'direct debug route remains rejected evidence, not the operator-facing native host surface',
    }, rejectedDebugSurfaces.length));
  }

  return {
    ...source,
    schema: BIG_PAPA_FINGER_JUICE_HOST_PACKET_SCHEMA,
    route: BIG_PAPA_FINGER_JUICE_HOST_PACKET_ROUTE,
    packetUrl: source.packetUrl || null,
    source: {
      ...objectOrEmpty(source.source),
      producerDiaulos: source.source?.producerDiaulos || 'big-papa-finger-juice-fucker',
      route: source.source?.route || BIG_PAPA_FINGER_JUICE_HOST_PACKET_ROUTE,
      authority: source.source?.authority || 'unknown',
      sourceTruthAuthority: source.source?.sourceTruthAuthority || source.source?.authority || 'unknown',
    },
    freshness: {
      status: source.freshness?.status || 'unknown',
      budgetMs: finite(source.freshness?.budgetMs, 0),
      observedAt: source.freshness?.observedAt || null,
      generatedAt: source.freshness?.generatedAt || null,
      sampleAgeMs: source.freshness?.sampleAgeMs ?? null,
    },
    terrain: {
      ...objectOrEmpty(source.terrain),
      couplingMode: source.terrain?.couplingMode || 'unknown',
      supportFrameChecksum: source.terrain?.supportFrameChecksum || null,
      sampleChecksum: source.terrain?.sampleChecksum || null,
      channelChecksum: source.terrain?.channelChecksum || null,
    },
    solver: {
      ...objectOrEmpty(source.solver),
      particleCount: Math.max(0, Math.floor(finite(source.solver?.particleCount, renderPayload.particles.length))),
      chemistryCounts: objectOrEmpty(source.solver?.chemistryCounts),
    },
    render: {
      ...objectOrEmpty(source.render),
      payload: renderPayload,
    },
    hitRefs: {
      ...objectOrEmpty(source.hitRefs),
      events: arrayOrEmpty(source.hitRefs?.events),
    },
    visual: {
      ...objectOrEmpty(source.visual),
      bounds: objectOrEmpty(source.visual?.bounds),
      cameraHints: objectOrEmpty(source.visual?.cameraHints),
      chemistryMaterials: objectOrEmpty(source.visual?.chemistryMaterials),
    },
    custody: {
      ...custody,
      downgrades,
      rejectedDebugSurfaces,
    },
    sourceDowngrades,
    sourceCustody,
  };
}

export function createFingerJuiceHostState(packet, options = {}) {
  const normalized = normalizeFingerJuiceHostPacket(packet);
  const renderPayload = normalized.render.payload;
  const hostSurface = createHostSurfaceState({
    adapter: FINGER_JUICE_HOST_ADAPTER,
    packetSchema: normalized.schema,
    packetRoute: normalized.route,
    packetUrl: normalized.packetUrl || null,
    source: normalized.source,
    freshness: normalized.freshness,
    downgrades: normalized.custody.downgrades,
    sourceDowngrades: normalized.sourceDowngrades,
    rejectedDebugSurfaces: normalized.custody.rejectedDebugSurfaces,
    custody: normalized.custody,
    sourceCustody: normalized.sourceCustody,
    visual: normalized.visual,
    hostSpecific: {
      renderPayloadSchema: renderPayload.schema,
      renderDowngraded: renderPayload.downgraded,
      previewParticleCount: renderPayload.particles.length,
      previewTrailCount: renderPayload.trails.length,
      hitEventCount: normalized.hitRefs.events.length,
    },
  }, options);
  return {
    schema: KAMINOS_FINGER_JUICE_HOST_STATE_SCHEMA,
    hostSurfaceSchema: KAMINOS_HOST_SURFACE_STATE_SCHEMA,
    route: KAMINOS_FINGER_JUICE_HOST_ROUTE,
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
    terrain: normalized.terrain,
    solver: normalized.solver,
    renderRoute: normalized.render.route || null,
    renderBackend: normalized.render.backend || null,
    renderPayloadSchema: renderPayload.schema,
    renderDowngraded: renderPayload.downgraded,
    previewParticleCount: renderPayload.particles.length,
    previewTrailCount: renderPayload.trails.length,
    hitEventCount: normalized.hitRefs.events.length,
    previewParticles: renderPayload.particles,
    previewTrails: renderPayload.trails,
    visual: normalized.visual,
    downgrades: normalized.custody.downgrades,
    sourceDowngrades: hostSurface.sourceDowngrades,
    rejectedDebugSurfaces: normalized.custody.rejectedDebugSurfaces,
    custody: normalized.custody,
    sourceCustody: hostSurface.sourceCustody,
    hostSurface,
  };
}
