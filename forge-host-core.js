export const FORGE_HOST_ACTOR_SCHEMA = 'kaminos.forge-host.actors.v0';
export const FORGE_HOST_LAYOUT_SCHEMA = 'kaminos.forge-host.layout.v0';
export const FORGE_HOST_FIXTURE_SOURCE_ID = 'fixture:kaminos-inhabited-agent-forge-2026-06-23/minion-spawnfucker-v0';
export const FORGE_HOST_DIAULOS_REGISTRY_SCHEMA = 'epistaxis.diaulos-registry.v0';
export const FORGE_HOST_HERO_SPLAT_SOURCE = '/api/read?root=splat-inbox&path=evil_orb_final_composite.ply';
export const FORGE_HOST_STATIC_LAYOUT_AUTHORITY = 'static-host-owned-station-anchors';
export const FORGE_HOST_STATIC_ANCHOR_AUTHORITY = 'static-host-owned-station-anchor';

export const FORGE_HOST_STATUS_COLORS = Object.freeze({
  idle: '#6f7d8f',
  listening: '#48a8ff',
  working: '#f0b642',
  'awaiting-input': '#d86cff',
  reporting: '#55d17a',
  blocked: '#f25f5c',
  complete: '#9adf8f',
  stale: '#8b8178',
  're-inhabited': '#ff8f5a',
});

const STATUS_LIGHT = Object.freeze({
  idle: 'low-cool-core',
  listening: 'forward-blue-aperture',
  working: 'steady-amber-pulse',
  'awaiting-input': 'held-violet-aperture',
  reporting: 'open-green-reporting-flare',
  blocked: 'red-held-loop',
  complete: 'settled-green-glow',
  stale: 'dimmed-amber-residue',
  're-inhabited': 'shifted-orange-inner-light',
});

const SOURCE_REFS = Object.freeze([
  'metadosis/kaminos-inhabited-agent-forge-lane-allocation_2026-06-23.md',
  'projects/kaminos/topoi/codex-minion-spawnfucker-0623.md',
  'docs/kaminos-as-inhabited-agent-forge.md',
]);

const STATIC_LAYOUT_SOURCE_REFS = Object.freeze([
  ...SOURCE_REFS,
  'metadosis/upstream-directives/mushfinger-answers-minion-motion-adapter-boundary_2026-06-23T233535Z.md',
]);

const FIXTURE_ACTORS = Object.freeze([
  {
    diaulosId: 'minion-spawnfucker',
    callSign: 'Minion Spawnfucker',
    sets: ['promoted', 'current'],
    status: 'working',
    stationId: 'forge-host',
    stationLabel: 'Forge Host',
    custodyScope: 'actor spawning, station placement, labels, selection, bridge placeholder',
    position: [0, 0.6, -1.4],
    rotation: [0, 0.2, 0],
    scale: 1.08,
    currentInhabitant: 'Codex',
  },
  {
    diaulosId: 'mushfinger-clayfucker',
    callSign: 'Mushfinger Clayfucker',
    sets: ['current'],
    status: 'working',
    stationId: 'worldbody-dynamics',
    stationLabel: 'Worldbody Dynamics',
    custodyScope: 'motion grammar and state-to-body behavior',
    position: [-1.8, 0.52, -0.35],
    rotation: [0, 0.65, 0],
    scale: 0.96,
    currentInhabitant: 'Codex',
  },
  {
    diaulosId: 'lamellar-edgefucker',
    callSign: 'Lamellar Edgefucker',
    sets: ['promoted', 'recent'],
    status: 'stale',
    stationId: 'avatar-phenotype',
    stationLabel: 'Avatar Phenotype',
    custodyScope: 'lamellar vessel body, shell geometry, aperture handles',
    position: [1.7, 0.5, -0.6],
    rotation: [0, -0.75, 0],
    scale: 0.94,
    currentInhabitant: 'existing Lamellar lane',
  },
  {
    diaulosId: 'molten-heartfucker',
    callSign: 'Molten Heartfucker',
    sets: ['promoted', 'recent'],
    status: 'idle',
    stationId: 'inhabitant-light',
    stationLabel: 'Inhabitant Light',
    custodyScope: 'status vocabulary and inner-light semantics',
    position: [1.05, 0.48, 1.05],
    rotation: [0, -1.35, 0],
    scale: 0.9,
    currentInhabitant: 'existing Molten lane',
  },
  {
    diaulosId: 'pipeline-gutfucker',
    callSign: 'Pipeline Gutfucker',
    sets: ['promoted'],
    status: 'awaiting-input',
    stationId: 'model-pipeline-composition',
    stationLabel: 'Pipeline Composition',
    custodyScope: 'asset-generation chain manifests and witnesses',
    position: [-0.9, 0.46, 1.45],
    rotation: [0, 1.1, 0],
    scale: 0.9,
    currentInhabitant: 'Codex launch pending',
  },
  {
    diaulosId: 'gutterglass-pornographers',
    callSign: 'Gutterglass Pornographers',
    sets: ['recent'],
    status: 'complete',
    stationId: 'renderer-asset-handoff',
    stationLabel: 'Renderer Handoff',
    custodyScope: 'splat loading, sidecar semantics, renderer route identity',
    position: [-2.5, 0.42, 1.25],
    rotation: [0, 0.45, 0],
    scale: 0.82,
    currentInhabitant: 'renderer stakeholder',
  },
]);

const FILTERED_DIAULOI = Object.freeze([
  { diaulosId: 'historical-greenroom-picker-lane', reason: 'not-promoted-current-or-recent' },
  { diaulosId: 'archived-volume-smoke-lane', reason: 'not-promoted-current-or-recent' },
]);

const DEFAULT_REQUESTED_HANDLES = Object.freeze(FIXTURE_ACTORS.map(actor => actor.diaulosId));
const DEFAULT_SET_BY_HANDLE = Object.freeze(Object.fromEntries(
  FIXTURE_ACTORS.map(actor => [actor.diaulosId, actor.sets])
));
const DEFAULT_ACTOR_BY_HANDLE = Object.freeze(Object.fromEntries(
  FIXTURE_ACTORS.map(actor => [actor.diaulosId, actor])
));

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function statusRecord(state) {
  if (!FORGE_HOST_STATUS_COLORS[state]) throw new Error(`Unknown forge-host status state: ${state}`);
  return { state, color: FORGE_HOST_STATUS_COLORS[state], light: STATUS_LIGHT[state] };
}

function bodyPlan() {
  return {
    phenotype: 'lamellar-orb-placeholder',
    shellOwner: 'lamellar-edgefucker',
    lightOwner: 'molten-heartfucker',
    motionOwner: 'mushfinger-clayfucker',
    avatarContinuity: 'body-is-durable-diaulos-light-is-current-inhabitant',
    lodPlan: {
      primary: {
        kind: 'sphere-placeholder',
        reason: 'cheap host-owned actor proxy until procedural/splat bodies can scale',
      },
      heroSplat: {
        kind: 'front-biased-splat-impostor',
        source: FORGE_HOST_HERO_SPLAT_SOURCE,
        sidecar: '/api/splat-correction?root=splat-inbox&path=evil_orb_final_composite.ply',
        usefulArcDegrees: 10,
        degradeArcDegrees: 30,
        ownership: 'Forge Host owns actor asset slot and LOD choice; renderer lanes own splat truth',
      },
      procedural: {
        kind: 'future-procedural-lamellar-vessel',
        owner: 'lamellar-edgefucker',
        conceptRefs: [
          'assets/evil_orb_SHARP_splat_render.png',
          'assets/evil_orb_original_generated_source_image.png',
          'assets/evil_orb_outer_shell_source_image.png',
          'assets/evil_orb_inner_core_source_image.png',
        ],
      },
    },
  };
}

function actorRecord(raw, sourceActorRecord) {
  const actorId = `forge-actor:${raw.diaulosId}`;
  return {
    actorId,
    diaulosId: raw.diaulosId,
    callSign: raw.callSign,
    sets: [...raw.sets],
    status: statusRecord(raw.status),
    registryId: raw.registryId || null,
    body: bodyPlan(),
    station: { id: raw.stationId, label: raw.stationLabel, custodyScope: raw.custodyScope },
    spatial: {
      anchorId: `station:${raw.stationId}`,
      position: [...raw.position],
      rotation: [...raw.rotation],
      scale: raw.scale,
    },
    selection: {
      selectable: true,
      defaultSelected: raw.diaulosId === 'minion-spawnfucker',
      focusTarget: actorId,
      bridge: {
        kind: 'chat-terminal-placeholder',
        implemented: false,
        label: `Open ${raw.callSign}`,
        route: null,
      },
    },
    inhabitant: {
      current: raw.currentInhabitant,
      continuity: 'replaceable-context-in-durable-diaulos-body',
    },
    provenance: { sourceActorRecord, sourceRefs: [...SOURCE_REFS] },
  };
}

function staticAnchorFromActor(actor) {
  return {
    actorId: actor.actorId,
    diaulosId: actor.diaulosId,
    stationId: actor.station?.id || null,
    anchorId: actor.spatial?.anchorId || `station:${actor.station?.id || actor.diaulosId}`,
    authority: FORGE_HOST_STATIC_ANCHOR_AUTHORITY,
    dynamic: false,
    motionState: null,
    position: [...(actor.spatial?.position || [0, 0.42, 0])],
    rotation: [...(actor.spatial?.rotation || [0, 0, 0])],
    scale: actor.spatial?.scale ?? 1,
    provenance: {
      actorSource: actor.provenance?.sourceActorRecord || null,
      sourceRefs: [...STATIC_LAYOUT_SOURCE_REFS],
    },
  };
}

export function createForgeHostStaticLayoutFromRegistry(registry, {
  sourceKind = 'route-local-default',
  sourceId = 'route:forge-host-derived-static-layout',
  persisted = sourceKind !== 'route-local-default',
  layoutId = 'forge-host-static-layout',
} = {}) {
  if (!registry || registry.schema !== FORGE_HOST_ACTOR_SCHEMA) {
    throw new Error('Forge Host static layout requires a kaminos.forge-host.actors.v0 registry');
  }
  return {
    schema: FORGE_HOST_LAYOUT_SCHEMA,
    layoutId,
    truthLevel: 'static-placement-not-motion-truth',
    source: {
      kind: sourceKind,
      id: sourceId,
      persisted: !!persisted,
      fallback: false,
    },
    authority: {
      kind: FORGE_HOST_STATIC_LAYOUT_AUTHORITY,
      ownerDiaulos: 'minion-spawnfucker',
      static: true,
      dynamicsAuthority: false,
      motionAuthority: false,
      custodyBoundary: 'Mushfinger owns worldbody dynamics; this layout owns only static station anchors',
    },
    provenance: {
      source: 'Mushfinger static-anchor direction consumed by Forge Host',
      refs: [...STATIC_LAYOUT_SOURCE_REFS],
    },
    anchors: (registry.actors || []).map(staticAnchorFromActor),
  };
}

export function validateForgeHostStaticLayout(layout, { claimedAuthority = FORGE_HOST_STATIC_LAYOUT_AUTHORITY } = {}) {
  if (!layout || layout.schema !== FORGE_HOST_LAYOUT_SCHEMA) {
    throw new Error('Forge Host static layout requires kaminos.forge-host.layout.v0');
  }
  if (claimedAuthority === 'persisted-static-layout'
    && (layout.source?.kind === 'route-local-default' || layout.source?.persisted === false)) {
    throw new Error('route-local default layout cannot satisfy a persisted layout claim');
  }
  if (layout.authority?.kind !== FORGE_HOST_STATIC_LAYOUT_AUTHORITY) {
    throw new Error(`Forge Host static layout requires ${FORGE_HOST_STATIC_LAYOUT_AUTHORITY} authority`);
  }
  if (layout.authority?.dynamicsAuthority === true) {
    throw new Error('Forge Host static layout cannot claim dynamics authority');
  }
  if (layout.authority?.motionAuthority === true) {
    throw new Error('Forge Host static layout cannot claim motion authority');
  }
  if (!Array.isArray(layout.anchors)) throw new Error('Forge Host static layout requires an anchors array');
  const actorIds = new Set();
  for (const anchor of layout.anchors) {
    if (!anchor?.actorId) throw new Error('Forge Host static layout anchor missing actorId');
    if (actorIds.has(anchor.actorId)) throw new Error(`Forge Host static layout duplicates anchor for ${anchor.actorId}`);
    actorIds.add(anchor.actorId);
    if (anchor.authority !== FORGE_HOST_STATIC_ANCHOR_AUTHORITY) {
      throw new Error(`Forge Host static anchor ${anchor.actorId} must use ${FORGE_HOST_STATIC_ANCHOR_AUTHORITY}`);
    }
    if (anchor.dynamic === true || anchor.dynamicsAuthority === true) {
      throw new Error(`Forge Host static anchor ${anchor.actorId} cannot claim dynamics authority`);
    }
    if (anchor.motionState !== null && anchor.motionState !== undefined) {
      throw new Error(`Forge Host static anchor ${anchor.actorId} cannot embed motion state`);
    }
    if (!Array.isArray(anchor.position) || anchor.position.length !== 3 || !anchor.position.every(Number.isFinite)) {
      throw new Error(`Forge Host static anchor ${anchor.actorId} requires finite [x,y,z] position`);
    }
    if (!Array.isArray(anchor.rotation) || anchor.rotation.length !== 3 || !anchor.rotation.every(Number.isFinite)) {
      throw new Error(`Forge Host static anchor ${anchor.actorId} requires finite [x,y,z] rotation`);
    }
    if (!Number.isFinite(anchor.scale) || anchor.scale <= 0) {
      throw new Error(`Forge Host static anchor ${anchor.actorId} requires positive finite scale`);
    }
  }
  return cloneJson(layout);
}

export function buildForgeHostLayoutWitnessSummary(layout, { claimedAuthority = FORGE_HOST_STATIC_LAYOUT_AUTHORITY } = {}) {
  const validated = validateForgeHostStaticLayout(layout, { claimedAuthority });
  return {
    ok: true,
    schema: validated.schema,
    truthLevel: validated.truthLevel,
    claimedAuthority,
    layoutAuthority: validated.authority?.kind,
    source: cloneJson(validated.source),
    layoutSourceIdentity: validated.source?.id || null,
    anchorCount: validated.anchors.length,
    anchorIds: validated.anchors.map(anchor => anchor.anchorId),
    actorIds: validated.anchors.map(anchor => anchor.actorId),
    dynamicsAuthority: validated.authority?.dynamicsAuthority === true,
    motionAuthority: validated.authority?.motionAuthority === true,
    static: validated.authority?.static === true,
  };
}

export function applyForgeHostLayoutToRegistry(registry, layout) {
  if (!registry || registry.schema !== FORGE_HOST_ACTOR_SCHEMA) {
    throw new Error('Forge Host layout application requires a kaminos.forge-host.actors.v0 registry');
  }
  const validated = validateForgeHostStaticLayout(layout);
  const anchors = new Map(validated.anchors.map(anchor => [anchor.actorId, anchor]));
  const next = cloneJson(registry);
  next.layout = {
    schema: validated.schema,
    layoutId: validated.layoutId,
    source: cloneJson(validated.source),
    authority: cloneJson(validated.authority),
  };
  next.actors = next.actors.map(actor => {
    const anchor = anchors.get(actor.actorId);
    if (!anchor) return actor;
    return {
      ...actor,
      spatial: {
        ...actor.spatial,
        anchorId: anchor.anchorId,
        position: [...anchor.position],
        rotation: [...anchor.rotation],
        scale: anchor.scale,
        layoutAuthority: anchor.authority,
        layoutSourceIdentity: validated.source?.id || null,
      },
    };
  });
  return next;
}

function titleFromHandle(handle) {
  return String(handle || '')
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Unnamed Diaulos';
}

function normalizeRegistryRows(data) {
  if (!data || !Array.isArray(data.diauloi)) throw new Error('Diaulos registry payload must contain a diauloi array');
  return data.diauloi
    .filter(row => row && typeof row === 'object' && row.handle)
    .map(row => ({
      handle: String(row.handle),
      id: row.id ? String(row.id) : null,
      aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
      sourceTopoi: Array.isArray(row.source_topoi) ? row.source_topoi.map(String) : [],
      status: row.status ? String(row.status) : 'unknown',
      updatedAt: row.updated_at || row.created_at || null,
      raw: row,
    }));
}

function registryStatusToForgeStatus(status) {
  if (status === 'katastatic') return 'complete';
  if (status === 'active') return 'idle';
  return 'stale';
}

function shouldIncludeRegistryRow(row, requestedHandles) {
  if (requestedHandles.has(row.handle)) return true;
  if (row.aliases.some(alias => requestedHandles.has(alias))) return true;
  return row.sourceTopoi.some(path => path.startsWith('projects/kaminos/'));
}

export function createForgeHostRegistryFromDiaulosRegistry(data, {
  sourceKind = 'live',
  sourceId = 'diaulos-registry:unknown',
  requestedHandles = DEFAULT_REQUESTED_HANDLES,
} = {}) {
  const requested = new Set(requestedHandles);
  const rows = normalizeRegistryRows(data);
  const consumedHandles = new Set();
  const actors = [];
  const filteredDiauloi = [];

  for (const row of rows) {
    if (!shouldIncludeRegistryRow(row, requested)) {
      filteredDiauloi.push({ diaulosId: row.handle, registryId: row.id, reason: 'outside-forge-focus-filter' });
      continue;
    }
    consumedHandles.add(row.handle);
    const fixture = DEFAULT_ACTOR_BY_HANDLE[row.handle];
    const raw = {
      diaulosId: row.handle,
      registryId: row.id,
      callSign: fixture?.callSign || titleFromHandle(row.handle),
      sets: [...(DEFAULT_SET_BY_HANDLE[row.handle] || ['registry'])],
      status: fixture?.status || registryStatusToForgeStatus(row.status),
      stationId: fixture?.stationId || 'registry-intake',
      stationLabel: fixture?.stationLabel || 'Registry Intake',
      custodyScope: fixture?.custodyScope || 'registry-backed Diaulos identity; runtime status not proven',
      position: fixture?.position || [0, 0.42, 0],
      rotation: fixture?.rotation || [0, 0, 0],
      scale: fixture?.scale || 0.78,
      currentInhabitant: fixture?.currentInhabitant || 'unknown from registry',
    };
    actors.push(actorRecord(raw, {
      registrySchema: FORGE_HOST_DIAULOS_REGISTRY_SCHEMA,
      registryId: row.id,
      handle: row.handle,
      aliases: row.aliases,
      sourceTopoi: row.sourceTopoi,
      registryStatus: row.status,
      updatedAt: row.updatedAt,
    }));
  }

  const missingRequestedDiauloi = [...requested]
    .filter(handle => !consumedHandles.has(handle))
    .map(handle => ({ diaulosId: handle, reason: 'missing-from-diaulos-registry' }));

  return {
    schema: FORGE_HOST_ACTOR_SCHEMA,
    truthLevel: 'peripheral-hud-not-ground-truth',
    source: {
      kind: sourceKind,
      id: sourceId,
      claimedLive: sourceKind === 'live',
      fallback: false,
      registryAuthority: 'identity-binding-not-runtime-presence',
    },
    provenance: {
      source: 'Epistaxis Diaulos registry ingestion',
      refs: [
        'metadosis/diaulos-registry/diauloi.json',
        'metadosis/diaulos-registry/README.md',
        ...SOURCE_REFS,
      ],
    },
    actors,
    filteredDiauloi,
    missingRequestedDiauloi,
  };
}

export function createForgeHostFixtureRegistry({
  sourceKind = 'fixture',
  sourceId = FORGE_HOST_FIXTURE_SOURCE_ID,
  fallback = false,
} = {}) {
  return {
    schema: FORGE_HOST_ACTOR_SCHEMA,
    truthLevel: 'peripheral-hud-not-ground-truth',
    source: { kind: sourceKind, id: sourceId, claimedLive: false, fallback: !!fallback },
    provenance: {
      source: 'operator lane allocation and Minion Spawnfucker launch topos',
      refs: [...SOURCE_REFS],
    },
    actors: FIXTURE_ACTORS.map(raw => actorRecord(raw, {
      fixtureSourceId: sourceId,
      diaulosId: raw.diaulosId,
      sets: [...raw.sets],
    })),
    filteredDiauloi: cloneJson(FILTERED_DIAULOI),
  };
}

function actorBuckets(registry) {
  const counts = {
    promoted: 0,
    current: 0,
    recent: 0,
    filtered: registry.filteredDiauloi?.length || 0,
    registryBacked: 0,
    missingRequested: registry.missingRequestedDiauloi?.length || 0,
  };
  for (const actor of registry.actors || []) {
    if (actor.sets?.includes('promoted')) counts.promoted += 1;
    if (actor.sets?.includes('current')) counts.current += 1;
    if (actor.sets?.includes('recent')) counts.recent += 1;
    if (actor.provenance?.sourceActorRecord?.registryId) counts.registryBacked += 1;
  }
  return counts;
}

export function buildForgeHostWitnessSummary(registry, { claimedSourceKind = 'fixture' } = {}) {
  if (!registry || registry.schema !== FORGE_HOST_ACTOR_SCHEMA) {
    throw new Error('forge-host witness requires a kaminos.forge-host.actors.v0 registry');
  }
  const effectiveKind = registry.source?.kind || 'unknown';
  const effectiveFallback = registry.source?.fallback === true || effectiveKind === 'demo-fallback';
  if (effectiveFallback && ['seeded', 'live'].includes(claimedSourceKind)) {
    throw new Error('demo fallback data cannot satisfy a seeded or live forge-host witness');
  }
  if (claimedSourceKind === 'live' && effectiveKind !== 'live') {
    throw new Error(`forge-host witness claimed live data but effective source is ${effectiveKind}`);
  }
  if (claimedSourceKind === 'seeded' && !['seeded', 'fixture'].includes(effectiveKind)) {
    throw new Error(`forge-host witness claimed seeded data but effective source is ${effectiveKind}`);
  }
  const selectedActor = registry.actors.find(actor => actor.selection?.defaultSelected) || registry.actors[0] || null;
  return {
    ok: true,
    schema: registry.schema,
    truthLevel: registry.truthLevel,
    claimedSourceKind,
    source: cloneJson(registry.source),
    sourceIdentity: registry.source?.id || null,
    actorBuckets: actorBuckets(registry),
    counts: actorBuckets(registry),
    actorIds: registry.actors.map(actor => actor.actorId),
    selectedActor: cloneJson(selectedActor),
    defaultSelection: cloneJson(selectedActor),
    filteredDiauloi: cloneJson(registry.filteredDiauloi || []),
    missingRequestedDiauloi: cloneJson(registry.missingRequestedDiauloi || []),
  };
}
