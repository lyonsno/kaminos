export const FORGE_HOST_ACTOR_SCHEMA = 'kaminos.forge-host.actors.v0';
export const FORGE_HOST_FIXTURE_SOURCE_ID = 'fixture:kaminos-inhabited-agent-forge-2026-06-23/minion-spawnfucker-v0';

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

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function statusRecord(state) {
  if (!FORGE_HOST_STATUS_COLORS[state]) throw new Error(`Unknown forge-host status state: ${state}`);
  return { state, color: FORGE_HOST_STATUS_COLORS[state], light: STATUS_LIGHT[state] };
}

function actorRecord(raw, sourceActorRecord) {
  const actorId = `forge-actor:${raw.diaulosId}`;
  return {
    actorId,
    diaulosId: raw.diaulosId,
    callSign: raw.callSign,
    sets: [...raw.sets],
    status: statusRecord(raw.status),
    body: {
      phenotype: 'lamellar-orb-placeholder',
      shellOwner: 'lamellar-edgefucker',
      lightOwner: 'molten-heartfucker',
      motionOwner: 'mushfinger-clayfucker',
      avatarContinuity: 'body-is-durable-diaulos-light-is-current-inhabitant',
    },
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
  };
  for (const actor of registry.actors || []) {
    if (actor.sets?.includes('promoted')) counts.promoted += 1;
    if (actor.sets?.includes('current')) counts.current += 1;
    if (actor.sets?.includes('recent')) counts.recent += 1;
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
  };
}
