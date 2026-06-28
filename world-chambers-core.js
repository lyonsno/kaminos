export const WORLD_CHAMBER_REGISTRY_SCHEMA = 'kaminos.world-chambers.registry.v0';
export const WORLD_CHAMBER_DESCRIPTOR_SCHEMA = 'kaminos.world-chamber.descriptor.v0';
export const WORLD_CHAMBER_PREVIEW_BENCH_SCHEMA = 'kaminos.world-chamber.preview-bench.v0';
export const WORLD_CHAMBER_RECEIPT_SCHEMA = 'kaminos.world-chamber.receipt.v0';
export const KAMINOS_PREVIEW_BENCH_PAYLOAD_REPORT_SCHEMA = 'kaminos.preview-bench.payload-report.v0';
export const KAMINOS_PREVIEW_BENCH_PAYLOAD_STATE_SCHEMA = 'kaminos.preview-bench.payload-state.v0';
export const KAMINOS_PREVIEW_BENCH_PAYLOAD_ROUTE = 'kaminos/preview-bench/payload-file';
export const LERMS_PREVIEW_ACTOR_MOTION_PAYLOAD_SCHEMA = 'lerms.preview-bench-actor-motion-payload.v0';
export const LERMS_PREVIEW_ACTOR_MOTION_STATE_SCHEMA = 'lerms.preview-bench-actor-motion-state.v0';
export const LERMS_PREVIEW_ACTOR_MOTION_PAYLOAD_ROUTE = 'lerms/preview-bench/actor-motion-payload-file';
export const LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_SCHEMA = 'lerms.preview-bench-actor-motion-timeline.v0';
export const LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_STATE_SCHEMA = 'lerms.preview-bench-actor-motion-timeline-state.v0';
export const LERMS_PREVIEW_ACTOR_CONTINUITY_SCHEMA = 'lerms.preview-bench-actor-continuity.v0';
export const LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_ROUTE = 'lerms/preview-bench/actor-motion-timeline-file';
export const LERMS_PREVIEW_WITNESS_SCHEMA = 'kaminos.lerms-preview-witness.v0';
export const LERMS_PREVIEW_ACTOR_VISUAL_SCHEMA = 'kaminos.lerms-preview-actor-visual.v0';
export const LERMS_PREVIEW_GOIN_VISUAL_SCHEMA = 'kaminos.lerms-preview-goin-visual.v0';
export const LERMS_UNDERHILL_CHAMBER_ID = 'lerms-underhill';
export const LERMS_TERRAIN_PREVIEW_BENCH_ID = 'terrain-preview';

const LERMS_ACCEPTED_SCHEMAS = [
  'lerms.source-truth.v0',
  'lerms.terrain-sample.v0',
  'lerms.lerm-state.v0',
  'lerms.goin-state.v0',
  'lerms.juice-hit-event.v0',
  'lerms.carrier-drop-event.v0',
  'lerms.first-vertical-frame.v0',
  'lerms.first-vertical-summary.v0',
];

const REQUIRED_INTENTIONAL_ABSENCES = [
  'liveFingerJuicePackets',
  'liveGoinPhysics',
  'liveCrowdAi',
  'generatedLermMotion',
];

export const LERMS_PREVIEW_CAMERA_PRESETS = [
  {
    id: 'overview-oblique',
    label: 'Overview Oblique',
    position: [7.5, 5.5, 7.5],
    target: [0, 0.4, 0],
    fov: 45,
  },
  {
    id: 'topographic-top',
    label: 'Topographic Top',
    position: [0, 9, 0.01],
    target: [0, 0, 0],
    fov: 38,
  },
  {
    id: 'route-follow',
    label: 'Route Follow',
    position: [-5.5, 2.1, 4.5],
    target: [0.9, 0.3, -0.8],
    fov: 42,
  },
  {
    id: 'actor-close',
    label: 'Actor Close',
    position: [2.2, 1.6, 2.8],
    target: [0.25, 0.35, 0.1],
    fov: 36,
  },
  {
    id: 'terrain-cross-section',
    label: 'Terrain Cross Section',
    position: [5.8, 1.2, 0],
    target: [0, 0.15, 0],
    fov: 32,
  },
  {
    id: 'operator-free-camera',
    label: 'Operator Free Camera',
    position: [4.5, 3.2, 5.5],
    target: [0, 0.35, 0],
    fov: 45,
    operatorControlled: true,
  },
];

const LERMS_TERRAIN_PREVIEW_BENCH = {
  schema: WORLD_CHAMBER_PREVIEW_BENCH_SCHEMA,
  id: LERMS_TERRAIN_PREVIEW_BENCH_ID,
  operatorLabel: 'LERMS Preview Bench',
  label: 'Terrain Preview',
  posture: 'inspect',
  routeParams: {
    world_chamber: LERMS_UNDERHILL_CHAMBER_ID,
    posture: 'inspect',
    bench: LERMS_TERRAIN_PREVIEW_BENCH_ID,
  },
  hostDescriptor: WORLD_CHAMBER_PREVIEW_BENCH_SCHEMA,
  witnessSchema: LERMS_PREVIEW_WITNESS_SCHEMA,
  cameraPresets: LERMS_PREVIEW_CAMERA_PRESETS.map(preset => preset.id),
  authority: {
    sourceBadge: 'synthetic_fixture',
    freshnessBadge: 'fixture',
    fallbackBadge: 'embedded_fixture',
  },
};

export const LERMS_UNDERHILL_DESCRIPTOR = {
  schema: WORLD_CHAMBER_DESCRIPTOR_SCHEMA,
  id: LERMS_UNDERHILL_CHAMBER_ID,
  title: 'LERMS / Underhill',
  route: 'first-vertical-composer/witness-file',
  command: 'npm run witness:composer -- --out /tmp/lerms-first-vertical-composer-witness.json',
  expectedAuthority: 'synthetic_fixture',
  evidenceStatus: 'integrated_fixture_only',
  authorityNote: 'integrated fixture evidence; not a live first vertical',
  frameSchema: 'lerms.first-vertical-frame.v0',
  summarySchema: 'lerms.first-vertical-summary.v0',
  acceptedSchemas: LERMS_ACCEPTED_SCHEMAS,
  source: {
    repo: 'lerms',
    branch: 'cc/palm-daddy-first-vertical-composer-0627@98a100f',
    handoff: 'metadosis/lerms-kaminos-underhill-chamber-handoff_2026-06-27.md',
    sourceDiaulos: 'palm-daddy',
  },
  spatialAnchor: {
    id: 'forge-rail-underhill-dock-01',
    rail: 'forge-rail',
    role: 'world-chamber-dock',
    position: [-2.4, 0.15, -1.1],
    facing: [0, 0, 1],
  },
  selection: {
    tab: 'worlds',
    urlParam: 'world_chamber',
    selectedByDefault: true,
    metadataFields: ['route', 'authority', 'source', 'intentionallyAbsent'],
  },
  postures: ['inspect', 'stage', 'inhabit', 'forge'],
  previewBenches: [LERMS_TERRAIN_PREVIEW_BENCH],
  forgeRail: {
    id: 'forge-rail',
    label: 'Forge Rail',
    status: 'fixture-dock',
    affordances: ['inspect-frame', 'stage-live-route', 'inhabit-world', 'forge-orb-stations'],
  },
  intentionallyAbsent: {
    liveFingerJuicePackets: 'No live finger-juice packet stream is present in this fixture witness.',
    liveGoinPhysics: 'No live goin physics loop is present in this fixture witness.',
    liveCrowdAi: 'No live red-lerm crowd AI is present in this fixture witness.',
    generatedLermMotion: 'No generated lerm motion is present in this fixture witness.',
  },
};

export const LERMS_UNDERHILL_COMPOSER_FIXTURE_RECEIPT = {
  ok: true,
  schema: WORLD_CHAMBER_RECEIPT_SCHEMA,
  phase: 'composing-first-vertical-frame',
  route: 'first-vertical-composer/witness-file',
  chamberId: LERMS_UNDERHILL_CHAMBER_ID,
  authorityNote: 'integrated fixture evidence; not a live first vertical',
  intentionallyEmpty: {
    liveFingerJuicePackets: true,
    liveGoinPhysics: true,
    liveCrowdAi: true,
    generatedLermMotion: true,
  },
  frame: {
    schema: 'lerms.first-vertical-frame.v0',
    source: {
      schema: 'lerms.source-truth.v0',
      authority: 'synthetic_fixture',
      route: 'first-vertical-composer',
      branch: 'cc/palm-daddy-first-vertical-composer-0627@98a100f',
      witnessRoute: 'first-vertical-composer/witness-file',
    },
    terrain: {
      schema: 'lerms.terrain-sample.v0',
      source: 'synthetic_fixture',
      sampleCount: 16,
      underhillBand: 'worked-example',
    },
    lerms: Array.from({ length: 8 }, (_, index) => ({
      schema: 'lerms.lerm-state.v0',
      id: `red-lerm-${String(index + 1).padStart(2, '0')}`,
      source: 'synthetic_fixture',
      posture: index % 2 === 0 ? 'carrier' : 'scrambler',
    })),
    goins: Array.from({ length: 2 }, (_, index) => ({
      schema: 'lerms.goin-state.v0',
      id: `goin-${String(index + 1).padStart(2, '0')}`,
      source: 'synthetic_fixture',
      role: index === 0 ? 'visible-landmark' : 'underhill-pocket',
    })),
    juiceHits: [{
      schema: 'lerms.juice-hit-event.v0',
      id: 'juice-hit-01',
      source: 'synthetic_fixture',
    }],
    carrierDrops: [{
      schema: 'lerms.carrier-drop-event.v0',
      id: 'carrier-drop-01',
      source: 'synthetic_fixture',
    }],
  },
  summary: {
    schema: 'lerms.first-vertical-summary.v0',
    lerms: 8,
    goins: 2,
    juiceHits: 1,
    carrierDrops: 1,
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function normalizeReceiptSource(source) {
  const fallback = {
    mode: 'embedded_fixture',
    label: 'embedded Kaminos fixture receipt',
  };
  if (!source || typeof source !== 'object') return fallback;
  const normalized = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;
    normalized[key] = typeof value === 'string' ? value : clone(value);
  }
  if (!normalized.mode) normalized.mode = fallback.mode;
  if (!normalized.label && normalized.mode === 'embedded_fixture') normalized.label = fallback.label;
  return normalized;
}

function terrainSamplesFromFrame(frame) {
  if (Array.isArray(frame?.terrainSamples)) return frame.terrainSamples;
  if (frame?.terrain) return [frame.terrain];
  return [];
}

function carrierDropsFromFrame(frame) {
  if (Array.isArray(frame?.carrierDropEvents)) return frame.carrierDropEvents;
  if (Array.isArray(frame?.carrierDrops)) return frame.carrierDrops;
  return [];
}

function assertSchemaList(descriptor, receipt) {
  const terrainSamples = terrainSamplesFromFrame(receipt.frame);
  const carrierDrops = carrierDropsFromFrame(receipt.frame);
  const presentSchemas = new Set([
    receipt.frame?.source?.schema,
    receipt.frame?.schema,
    receipt.summary?.schema,
    ...terrainSamples.map(item => item?.schema),
    ...((receipt.frame?.lerms || []).map(item => item?.schema)),
    ...((receipt.frame?.goins || []).map(item => item?.schema)),
    ...((receipt.frame?.juiceHits || []).map(item => item?.schema)),
    ...carrierDrops.map(item => item?.schema),
  ].filter(Boolean));
  for (const schema of descriptor.acceptedSchemas) {
    if (!presentSchemas.has(schema)) {
      throw new Error(`missing LERMS schema in chamber receipt: ${schema}`);
    }
  }
}

export function normalizeWorldChamberReceipt(descriptor, receipt, options = {}) {
  assertObject(descriptor, 'world chamber descriptor');
  assertObject(receipt, 'world chamber receipt');
  if (receipt.ok !== true) throw new Error(`world chamber receipt is not ok: ${receipt.phase || 'unknown phase'}`);
  if (receipt.chamberId !== descriptor.id) {
    throw new Error(`world chamber chamber mismatch: expected ${descriptor.id} but got ${receipt.chamberId || 'missing'}`);
  }
  if (receipt.route !== descriptor.route) {
    throw new Error(`world chamber route mismatch: expected ${descriptor.route} but got ${receipt.route || 'missing'}`);
  }
  assertObject(receipt.frame, 'world chamber frame');
  assertObject(receipt.frame.source, 'world chamber frame source');
  if (receipt.frame.schema !== descriptor.frameSchema) {
    throw new Error(`world chamber frame schema mismatch: expected ${descriptor.frameSchema} but got ${receipt.frame.schema || 'missing'}`);
  }
  if (receipt.summary?.schema !== descriptor.summarySchema) {
    throw new Error(`world chamber summary schema mismatch: expected ${descriptor.summarySchema} but got ${receipt.summary?.schema || 'missing'}`);
  }
  if (receipt.frame.source.authority !== descriptor.expectedAuthority) {
    if (descriptor.evidenceStatus === 'integrated_fixture_only' && ['live_simulation', 'seeded_data'].includes(receipt.frame.source.authority)) {
      throw new Error(`${descriptor.id} fixture evidence cannot claim live first vertical authority`);
    }
    throw new Error(`world chamber authority mismatch: expected ${descriptor.expectedAuthority} but got ${receipt.frame.source.authority || 'missing'}`);
  }
  if (receipt.frame.source.authority === 'demo_fallback') {
    throw new Error(`${descriptor.id} demo fallback data cannot be displayed as chamber evidence`);
  }
  if (descriptor.evidenceStatus === 'integrated_fixture_only') {
    for (const key of REQUIRED_INTENTIONAL_ABSENCES) {
      if (receipt.intentionallyEmpty?.[key] !== true) {
        throw new Error(`${descriptor.id} fixture receipt must mark ${key} as intentionally empty`);
      }
    }
  }
  assertSchemaList(descriptor, receipt);

  const terrainSamples = terrainSamplesFromFrame(receipt.frame);
  const carrierDrops = carrierDropsFromFrame(receipt.frame);
  const summary = {
    schema: receipt.summary.schema,
    frameId: receipt.summary.frameId ?? receipt.frame.source.frameId ?? null,
    authority: receipt.summary.authority ?? receipt.frame.source.authority,
    lerms: Number(receipt.summary.lerms ?? receipt.summary.lermCount ?? countArray(receipt.frame.lerms)),
    goins: Number(receipt.summary.goins ?? receipt.summary.goinCount ?? countArray(receipt.frame.goins)),
    juiceHits: Number(receipt.summary.juiceHits ?? receipt.summary.juiceHitCount ?? countArray(receipt.frame.juiceHits)),
    carrierDrops: Number(receipt.summary.carrierDrops ?? receipt.summary.carrierDropCount ?? countArray(carrierDrops)),
    terrainSamples: Number(receipt.summary.terrainSamples ?? receipt.summary.terrainSampleCount ?? countArray(terrainSamples)),
    lermStateCounts: clone(receipt.summary.lermStateCounts || {}),
    goinStateCounts: clone(receipt.summary.goinStateCounts || {}),
  };

  return {
    schema: WORLD_CHAMBER_RECEIPT_SCHEMA,
    ok: true,
    chamberId: receipt.chamberId,
    route: receipt.route,
    authority: receipt.frame.source.authority,
    authorityNote: receipt.authorityNote || descriptor.authorityNote,
    receiptSource: normalizeReceiptSource(options.receiptSource),
    source: clone(receipt.frame.source),
    summary,
    intentionallyAbsent: clone(receipt.intentionallyEmpty || {}),
    falseLiveClaim: false,
    frame: clone(receipt.frame),
  };
}

export function createDefaultWorldChambersRegistry(options = {}) {
  const descriptor = clone(LERMS_UNDERHILL_DESCRIPTOR);
  const loadError = options.lermsUnderhillReceiptLoadError || null;
  if (loadError) {
    return {
      schema: WORLD_CHAMBER_REGISTRY_SCHEMA,
      activeChamberId: descriptor.id,
      chambers: [descriptor],
      receipts: {},
      receiptLoadErrors: {
        [descriptor.id]: clone(loadError),
      },
      usingFixtureFallback: false,
    };
  }
  const usingFixtureFallback = !options.lermsUnderhillReceipt;
  const receipt = options.lermsUnderhillReceipt || LERMS_UNDERHILL_COMPOSER_FIXTURE_RECEIPT;
  const receiptSource = usingFixtureFallback
    ? { mode: 'embedded_fixture', label: 'embedded Kaminos fixture receipt' }
    : options.lermsUnderhillReceiptSource || { mode: 'external_unknown', label: 'external composer receipt' };
  const normalized = normalizeWorldChamberReceipt(descriptor, receipt, { receiptSource });
  return {
    schema: WORLD_CHAMBER_REGISTRY_SCHEMA,
    activeChamberId: descriptor.id,
    chambers: [descriptor],
    receipts: {
      [descriptor.id]: normalized,
    },
    receiptLoadErrors: {},
    usingFixtureFallback,
  };
}

function routeStringForPreviewBench(chamberId, posture, benchId) {
  return `world_chamber=${chamberId}&posture=${posture}&bench=${benchId}`;
}

function assertPreviewBenchAcceptanceSurface(surface, label, target = {}) {
  assertObject(surface, `${label} acceptance surface`);
  const chamberId = target.chamberId || LERMS_UNDERHILL_CHAMBER_ID;
  const posture = target.posture || 'inspect';
  const benchId = target.benchId || LERMS_TERRAIN_PREVIEW_BENCH_ID;
  const expectedRoute = routeStringForPreviewBench(chamberId, posture, benchId);
  if (surface.kind !== 'kaminos_preview_bench_payload') {
    throw new Error(`${label} acceptance surface kind mismatch: ${surface.kind || 'missing'}`);
  }
  if (surface.worldChamberId !== chamberId || surface.posture !== posture || surface.bench !== benchId) {
    throw new Error(`${label} does not target the active Preview Bench: ${JSON.stringify(surface)}`);
  }
  if (surface.routeQuery !== expectedRoute) {
    throw new Error(`${label} route query mismatch: ${surface.routeQuery || 'missing'}`);
  }
}

function findPreviewBench(chamber, benchId) {
  const benches = Array.isArray(chamber?.previewBenches) ? chamber.previewBenches : [];
  return benches.find(bench => bench.id === benchId) || benches[0] || null;
}

function previewCameraPreset(cameraId) {
  return LERMS_PREVIEW_CAMERA_PRESETS.find(preset => preset.id === cameraId) || LERMS_PREVIEW_CAMERA_PRESETS[0];
}

function countFrameArray(frame, key, fallbackKey = null) {
  if (Array.isArray(frame?.[key])) return frame[key].length;
  if (fallbackKey && Array.isArray(frame?.[fallbackKey])) return frame[fallbackKey].length;
  return 0;
}

function normalizePreviewPayloadFields(payload) {
  if (Array.isArray(payload.fields)) {
    return payload.fields.map((field) => {
      assertObject(field, 'Preview Bench payload field');
      return {
        label: String(field.label || field.key || 'Field'),
        value: field.value === undefined || field.value === null ? '' : String(field.value),
      };
    });
  }
  if (payload.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)) {
    return Object.entries(payload.summary).map(([key, value]) => ({
      label: key,
      value: value === undefined || value === null ? '' : String(value),
    }));
  }
  return [];
}

export function normalizePreviewBenchPayloadReport(report, payloadSource = null, target = {}) {
  assertObject(report, 'Preview Bench payload report');
  const payload = report.payload || report;
  assertObject(payload, 'Preview Bench payload');
  if (report.payload) {
    if (report.schema !== KAMINOS_PREVIEW_BENCH_PAYLOAD_REPORT_SCHEMA) {
      throw new Error(`Preview Bench payload report schema mismatch: expected ${KAMINOS_PREVIEW_BENCH_PAYLOAD_REPORT_SCHEMA} but got ${report.schema || 'missing'}`);
    }
    if (report.route !== KAMINOS_PREVIEW_BENCH_PAYLOAD_ROUTE) {
      throw new Error(`Preview Bench payload report route mismatch: expected ${KAMINOS_PREVIEW_BENCH_PAYLOAD_ROUTE} but got ${report.route || 'missing'}`);
    }
  }
  if (!payload.schema) throw new Error('Preview Bench payload must preserve a source-owned schema');
  if (!payload.route) throw new Error('Preview Bench payload must preserve a source-owned route');
  assertPreviewBenchAcceptanceSurface(payload.acceptanceSurface, 'Preview Bench payload', target);
  assertObject(payload.source, 'Preview Bench payload source');
  if (!payload.source.authority) {
    throw new Error('Preview Bench payload source must include authority');
  }
  return {
    schema: KAMINOS_PREVIEW_BENCH_PAYLOAD_STATE_SCHEMA,
    reportSchema: report.schema || null,
    reportRoute: report.route || null,
    reportPath: report.reportPath || null,
    payloadSchema: payload.schema,
    route: payload.route,
    label: payload.label || payload.title || payload.route,
    acceptanceSurface: clone(payload.acceptanceSurface),
    payloadSource: normalizeReceiptSource(payloadSource),
    source: clone(payload.source),
    fields: normalizePreviewPayloadFields(payload),
    summary: payload.summary ? clone(payload.summary) : null,
    downgrades: clone(Array.isArray(payload.downgrades) ? payload.downgrades : []),
    rejectedSurfaces: clone(Array.isArray(payload.rejectedSurfaces) ? payload.rejectedSurfaces : []),
    custody: payload.custody ? clone(payload.custody) : null,
    rawPayload: clone(payload),
  };
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function roundBenchNumber(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function vector3(value, fallback = [0, 0, 0]) {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  return [
    Number.isFinite(Number(value[0])) ? Number(value[0]) : fallback[0],
    Number.isFinite(Number(value[1])) ? Number(value[1]) : fallback[1],
    Number.isFinite(Number(value[2])) ? Number(value[2]) : fallback[2],
  ];
}

function normalizeHorizontalHeading(value) {
  const heading = vector3(value, [1, 0, 0]);
  const length = Math.hypot(heading[0], heading[2]) || 1;
  return [roundBenchNumber(heading[0] / length), 0, roundBenchNumber(heading[2] / length)];
}

function stateColor(actor) {
  if (actor?.state === 'hit_reacting' || actor?.state === 'tumbling') return '#ff6b5e';
  if (actor?.state === 'carrying_goin' || actor?.state === 'fleeing_with_goin') return '#e34b3f';
  if (actor?.state === 'rerouting_to_goin') return '#f08a4b';
  return '#d83d37';
}

export function createLermsPreviewActorVisualPrimitives(actorMotionState) {
  const actors = Array.isArray(actorMotionState?.actors)
    ? actorMotionState.actors
    : Array.isArray(actorMotionState)
      ? actorMotionState
      : [];
  return actors.map((actor, index) => {
    const channels = actor?.benchChannels || actor?.motionAdapter?.channels || {};
    const world = vector3(actor?.world, [index * 0.35, 0.35, 0]);
    const rootOffset = vector3(channels.rootOffset, [0, 0, 0]);
    const position = [
      roundBenchNumber(world[0] + rootOffset[0]),
      roundBenchNumber(world[1] + rootOffset[1]),
      roundBenchNumber(world[2] + rootOffset[2]),
    ];
    const heading = normalizeHorizontalHeading(channels.heading || actor?.heading);
    const hitCompression = clampNumber(channels.hitCompression || 0, 0, 1);
    const radius = roundBenchNumber(clampNumber(0.18 * (channels.envelopeRadius || 1) * (1 - hitCompression * 0.28), 0.11, 0.28));
    const noseReach = roundBenchNumber(radius * 1.45);
    return {
      schema: LERMS_PREVIEW_ACTOR_VISUAL_SCHEMA,
      actorId: actor?.actorId || actor?.id || `lerms-preview-actor-${index}`,
      state: actor?.state || 'unknown',
      species: actor?.species || 'red',
      kind: 'proxy_schnoz_sphere',
      downgrade: 'proxy_body_visual_only',
      position,
      heading,
      radius,
      squash: roundBenchNumber(clampNumber(channels.bodySquash || 1, 0.55, 1.35)),
      stretch: roundBenchNumber(clampNumber(channels.bodyStretch || 1, 0.75, 1.55)),
      color: stateColor(actor),
      statusCue: actor?.statusCue ? clone(actor.statusCue) : null,
      nosePosition: [
        roundBenchNumber(position[0] + heading[0] * noseReach),
        position[1],
        roundBenchNumber(position[2] + heading[2] * noseReach),
      ],
      source: {
        payloadSchema: actorMotionState?.payloadSchema || LERMS_PREVIEW_ACTOR_MOTION_PAYLOAD_SCHEMA,
        motionAdapterSchema: actor?.motionAdapter?.schema || actorMotionState?.motionAdapterSchema || null,
        selectedCliplet: actor?.selectedCliplet ? clone(actor.selectedCliplet) : null,
      },
    };
  });
}

function goinColor(goin) {
  if (goin?.custodyRole === 'reroute_target') return '#baff6a';
  if (goin?.custodyRole === 'dropped_marker' || goin?.custodyRole === 'rolling_drop') return '#ffd45a';
  if (goin?.state === 'carried' || goin?.custodyRole === 'carried_attachment') return '#7ee7ff';
  return '#f5c542';
}

function possessionCueForGoin(goin, possessionEvents) {
  const events = (possessionEvents || []).filter(event => event?.goinId === goin?.id);
  const event = events.find(candidate => candidate.event === 'possession-released')
    || events.find(candidate => candidate.event === 'possession-gained')
    || events.find(candidate => candidate.event === 'loose-target-noticed')
    || events[0];
  if (!event) return null;
  return {
    schema: 'kaminos.lerms-preview-possession-cue.v0',
    event: event.event || null,
    actorId: event.actorId || event.carrierActorId || event.droppedByActorId || null,
    label: event.label || null,
    visibleMarker: event.visibleMarker === true,
    world: Array.isArray(event.world) ? vector3(event.world) : null,
  };
}

export function createLermsPreviewGoinVisualPrimitives(frameOrGoins, possessionEvents = null) {
  const goins = Array.isArray(frameOrGoins?.goins)
    ? frameOrGoins.goins
    : Array.isArray(frameOrGoins)
      ? frameOrGoins
      : [];
  const framePossessionEvents = possessionEvents || frameOrGoins?.possessionEvents || [];
  return goins.map((goin, index) => {
    const position = vector3(goin?.world, [index * 0.24, 0.45, 0]);
    const custodyRole = goin?.custodyRole || (goin?.state === 'carried' ? 'carried_attachment' : 'hoard_source');
    return {
      schema: LERMS_PREVIEW_GOIN_VISUAL_SCHEMA,
      goinId: goin?.id || `lerms-preview-goin-${index}`,
      state: goin?.state || 'unknown',
      custodyRole,
      carrierActorId: goin?.carrierLermId || null,
      droppedByActorId: goin?.droppedByActorId || null,
      targetedByActorIds: Array.isArray(goin?.targetedByActorIds) ? [...goin.targetedByActorIds] : [],
      kind: 'proxy_goin_marker',
      downgrade: 'proxy_goin_visual_only',
      possessionCue: possessionCueForGoin(goin, framePossessionEvents),
      position: [
        roundBenchNumber(position[0]),
        roundBenchNumber(position[1]),
        roundBenchNumber(position[2]),
      ],
      radius: roundBenchNumber(custodyRole === 'reroute_target' ? 0.13 : 0.11),
      color: goinColor({ ...goin, custodyRole }),
      source: {
        payloadSchema: frameOrGoins?.payloadSchema || LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_SCHEMA,
        custodyRole,
      },
    };
  });
}

function actorVisualMapById(frame) {
  return new Map((frame?.visualPrimitives || []).map(primitive => [primitive.actorId, primitive]));
}

function goinVisualMapById(frame) {
  return new Map((frame?.goinVisualPrimitives || []).map(primitive => [primitive.goinId, primitive]));
}

function interpolateNumber(a, b, blend) {
  return roundBenchNumber(Number(a) + (Number(b) - Number(a)) * blend);
}

function interpolateVec3(a, b, blend) {
  const from = vector3(a);
  const to = vector3(b, from);
  return [
    interpolateNumber(from[0], to[0], blend),
    interpolateNumber(from[1], to[1], blend),
    interpolateNumber(from[2], to[2], blend),
  ];
}

function interpolateActorVisualPrimitives(currentFrame, nextFrame, blend) {
  const nextById = actorVisualMapById(nextFrame);
  return (currentFrame?.visualPrimitives || []).map((primitive) => {
    const next = nextById.get(primitive.actorId);
    if (!next) return clone(primitive);
    return {
      ...clone(primitive),
      state: blend >= 0.5 ? next.state : primitive.state,
      statusCue: blend >= 0.5 ? clone(next.statusCue || null) : clone(primitive.statusCue || null),
      position: interpolateVec3(primitive.position, next.position, blend),
      heading: interpolateVec3(primitive.heading, next.heading, blend),
      radius: interpolateNumber(primitive.radius, next.radius, blend),
      squash: interpolateNumber(primitive.squash, next.squash, blend),
      stretch: interpolateNumber(primitive.stretch, next.stretch, blend),
      nosePosition: interpolateVec3(primitive.nosePosition, next.nosePosition, blend),
    };
  });
}

function interpolateGoinVisualPrimitives(currentFrame, nextFrame, blend) {
  const current = currentFrame?.goinVisualPrimitives || [];
  const nextById = goinVisualMapById(nextFrame);
  const seen = new Set();
  const interpolated = current.map((primitive) => {
    seen.add(primitive.goinId);
    const next = nextById.get(primitive.goinId);
    if (!next) return clone(primitive);
    return {
      ...clone(primitive),
      state: blend >= 0.5 ? next.state : primitive.state,
      custodyRole: blend >= 0.5 ? next.custodyRole : primitive.custodyRole,
      carrierActorId: blend >= 0.5 ? next.carrierActorId : primitive.carrierActorId,
      droppedByActorId: blend >= 0.5 ? next.droppedByActorId : primitive.droppedByActorId,
      targetedByActorIds: blend >= 0.5 ? clone(next.targetedByActorIds || []) : clone(primitive.targetedByActorIds || []),
      possessionCue: blend >= 0.5 ? clone(next.possessionCue || null) : clone(primitive.possessionCue || null),
      position: interpolateVec3(primitive.position, next.position, blend),
      radius: interpolateNumber(primitive.radius, next.radius, blend),
      color: blend >= 0.5 ? next.color : primitive.color,
    };
  });
  if (blend >= 0.5) {
    for (const next of nextById.values()) {
      if (!seen.has(next.goinId)) interpolated.push(clone(next));
    }
  }
  return interpolated;
}

function movementProof(frames) {
  const positionsByActor = new Map();
  const statesByActor = new Map();
  for (const frame of frames) {
    for (const actor of frame.actors || []) {
      if (!positionsByActor.has(actor.actorId)) positionsByActor.set(actor.actorId, new Set());
      positionsByActor.get(actor.actorId).add((actor.world || []).join(','));
      if (!statesByActor.has(actor.actorId)) statesByActor.set(actor.actorId, []);
      const states = statesByActor.get(actor.actorId);
      if (states[states.length - 1] !== actor.state) states.push(actor.state);
    }
  }
  const movingActorIds = [...positionsByActor.entries()]
    .filter(([, positions]) => positions.size > 1)
    .map(([actorId]) => actorId);
  const stateTransitions = [];
  for (const [actorId, states] of statesByActor.entries()) {
    for (let index = 1; index < states.length; index += 1) {
      stateTransitions.push({ actorId, from: states[index - 1], to: states[index] });
    }
  }
  return { movingActorIds, stateTransitions };
}

function actorContinuityProof(frames, sourceContinuity = null) {
  const actorIds = (frames[0]?.actors || []).map(actor => actor.actorId).filter(Boolean);
  const framesWithCompleteActorSet = frames.filter((frame) => {
    const frameActorIds = frame.actors.map(actor => actor.actorId).filter(Boolean);
    return frameActorIds.length === actorIds.length && frameActorIds.every((actorId, index) => actorId === actorIds[index]);
  }).length;
  const computed = {
    schema: LERMS_PREVIEW_ACTOR_CONTINUITY_SCHEMA,
    stableActorIdentities: framesWithCompleteActorSet === frames.length,
    actorIds,
    framesWithCompleteActorSet,
    discontinuityCount: frames.length - framesWithCompleteActorSet,
    identityPolicy: 'persistent_actor_id_across_preview_bench_timeline',
    evidence: 'computed_from_normalized_timeline_frames',
  };
  if (!sourceContinuity) return computed;
  assertObject(sourceContinuity, 'actor-motion timeline continuity');
  if (sourceContinuity.schema !== LERMS_PREVIEW_ACTOR_CONTINUITY_SCHEMA) {
    throw new Error(`actor-motion timeline continuity schema mismatch: expected ${LERMS_PREVIEW_ACTOR_CONTINUITY_SCHEMA} but got ${sourceContinuity.schema || 'missing'}`);
  }
  const sourceActorIds = Array.isArray(sourceContinuity.actorIds) ? sourceContinuity.actorIds : [];
  if (JSON.stringify(sourceActorIds) !== JSON.stringify(actorIds)) {
    throw new Error(`actor-motion timeline continuity actor IDs disagree with frames: ${JSON.stringify({ sourceActorIds, actorIds })}`);
  }
  if (Number(sourceContinuity.framesWithCompleteActorSet) !== framesWithCompleteActorSet) {
    throw new Error(`actor-motion timeline continuity frame count disagrees with frames: ${JSON.stringify({ source: sourceContinuity.framesWithCompleteActorSet, computed: framesWithCompleteActorSet })}`);
  }
  if (Boolean(sourceContinuity.stableActorIdentities) !== computed.stableActorIdentities) {
    throw new Error(`actor-motion timeline continuity stability disagrees with frames: ${JSON.stringify({ source: sourceContinuity.stableActorIdentities, computed: computed.stableActorIdentities })}`);
  }
  return {
    ...computed,
    discontinuityCount: Number(sourceContinuity.discontinuityCount ?? computed.discontinuityCount),
    identityPolicy: sourceContinuity.identityPolicy || computed.identityPolicy,
    evidence: 'source_continuity_cross_checked_against_normalized_frames',
  };
}

function goinCustodyProof(frames, sourceCustody = null) {
  const fallback = {
    schema: 'lerms.preview-bench-goin-custody.v0',
    visibleGoinPlayback: false,
    evidence: 'computed_absent_source_goin_custody',
    goinIds: [...new Set(frames.flatMap(frame => frame.goins.map(goin => goin.id).filter(Boolean)))],
    attachments: [],
    drops: [],
    rerouteTargets: [],
    primaryCustodyChain: [],
  };
  if (!sourceCustody) return fallback;
  assertObject(sourceCustody, 'actor-motion timeline goin custody');
  if (sourceCustody.schema !== 'lerms.preview-bench-goin-custody.v0') {
    throw new Error(`actor-motion timeline goin custody schema mismatch: expected lerms.preview-bench-goin-custody.v0 but got ${sourceCustody.schema || 'missing'}`);
  }
  if (sourceCustody.visibleGoinPlayback !== true) {
    throw new Error(`actor-motion timeline goin custody does not declare visible playback: ${JSON.stringify(sourceCustody)}`);
  }
  return {
    ...clone(sourceCustody),
    evidence: 'source_goin_custody_normalized_for_preview_playback',
  };
}

function possessionEventIdentity(event) {
  return [
    event?.frameIndex ?? '',
    event?.event ?? '',
    event?.goinId ?? '',
    event?.actorId ?? event?.carrierActorId ?? event?.droppedByActorId ?? '',
  ].join(':');
}

function latestPossessionEventForGoin(sourcePossessionEvents, frameIndex, goinId, eventName) {
  return [...sourcePossessionEvents]
    .filter(event => event?.goinId === goinId && event?.event === eventName && Number(event?.frameIndex) <= Number(frameIndex))
    .sort((a, b) => Number(b.frameIndex) - Number(a.frameIndex))[0] || null;
}

function possessionEventsForTimelineFrame(frame, sourcePossessionEvents) {
  const frameEvents = [
    ...sourcePossessionEvents.filter(event => Number(event?.frameIndex) === Number(frame.frameIndex)),
    ...(Array.isArray(frame.possessionEvents) ? frame.possessionEvents : []),
  ];
  const byIdentity = new Map(frameEvents.map(event => [possessionEventIdentity(event), event]));
  for (const goin of frame.goins || []) {
    const custodyRole = goin?.custodyRole || '';
    const eventName = custodyRole === 'reroute_target'
      ? 'loose-target-noticed'
      : ['dropped_marker', 'rolling_drop'].includes(custodyRole)
        ? 'possession-released'
        : custodyRole === 'carried_attachment'
          ? 'possession-gained'
          : null;
    if (!eventName) continue;
    const event = latestPossessionEventForGoin(sourcePossessionEvents, frame.frameIndex, goin.id, eventName);
    if (!event) continue;
    byIdentity.set(possessionEventIdentity(event), event);
  }
  return [...byIdentity.values()];
}

export function normalizeLermsPreviewActorMotionTimelineReport(report, payloadSource = null) {
  assertObject(report, 'LERMS Preview Bench actor-motion timeline report');
  const timeline = report.timeline || report;
  assertObject(timeline, 'LERMS Preview Bench actor-motion timeline');
  if (timeline.schema !== LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_SCHEMA) {
    throw new Error(`actor-motion timeline schema mismatch: expected ${LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_SCHEMA} but got ${timeline.schema || 'missing'}`);
  }
  if (timeline.route !== LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_ROUTE) {
    throw new Error(`actor-motion timeline route mismatch: expected ${LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_ROUTE} but got ${timeline.route || 'missing'}`);
  }
  const surface = timeline.acceptanceSurface;
  assertObject(surface, 'actor-motion timeline acceptance surface');
  if (surface.worldChamberId !== LERMS_UNDERHILL_CHAMBER_ID || surface.posture !== 'inspect' || surface.bench !== LERMS_TERRAIN_PREVIEW_BENCH_ID) {
    throw new Error(`actor-motion timeline does not target the LERMS Preview Bench: ${JSON.stringify(surface)}`);
  }
  if (surface.routeQuery !== routeStringForPreviewBench(LERMS_UNDERHILL_CHAMBER_ID, 'inspect', LERMS_TERRAIN_PREVIEW_BENCH_ID)) {
    throw new Error(`actor-motion timeline route query mismatch: ${surface.routeQuery || 'missing'}`);
  }
  if (timeline.witnessState?.schema !== LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_STATE_SCHEMA) {
    throw new Error(`actor-motion timeline witness state schema mismatch: ${timeline.witnessState?.schema || 'missing'}`);
  }
  if (!Array.isArray(timeline.timeline) || timeline.timeline.length < 2) {
    throw new Error('actor-motion timeline needs at least two frames for motion playback');
  }
  for (let index = 1; index < timeline.timeline.length; index += 1) {
    if (!(Number(timeline.timeline[index].timeMs) > Number(timeline.timeline[index - 1].timeMs))) {
      throw new Error('actor-motion timeline frame times must strictly increase');
    }
  }
  const sourcePossessionEvents = Array.isArray(timeline.goinCustody?.possessionEvents) ? timeline.goinCustody.possessionEvents : [];
  const frames = timeline.timeline.map((frame) => {
    if (!Array.isArray(frame.actorMotion) || frame.actorMotion.length === 0) {
      throw new Error(`actor-motion timeline frame ${frame.label || frame.frameIndex} has no actors`);
    }
    const actorState = {
      schema: LERMS_PREVIEW_ACTOR_MOTION_STATE_SCHEMA,
      payloadSchema: LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_SCHEMA,
      motionAdapterSchema: 'lerms.schnoz-motion-adapter.v0',
      actors: clone(frame.actorMotion),
    };
    const framePossessionEvents = possessionEventsForTimelineFrame(frame, sourcePossessionEvents);
    return {
      schema: frame.schema || 'lerms.preview-bench-actor-motion-timeline-frame.v0',
      frameIndex: frame.frameIndex,
      label: frame.label,
      timeMs: Number(frame.timeMs),
      events: clone(frame.events || []),
      possessionEvents: clone(framePossessionEvents),
      actors: clone(frame.actorMotion),
      goins: clone(frame.goins || []),
      hitFlash: frame.hitFlash ? clone(frame.hitFlash) : null,
      reroute: frame.reroute ? clone(frame.reroute) : null,
      visualPrimitives: createLermsPreviewActorVisualPrimitives(actorState),
      goinVisualPrimitives: createLermsPreviewGoinVisualPrimitives(frame, framePossessionEvents),
    };
  });
  const proof = movementProof(frames);
  const continuity = actorContinuityProof(frames, timeline.continuity || null);
  const goinCustody = goinCustodyProof(frames, timeline.goinCustody || null);
  if (!continuity.stableActorIdentities) {
    throw new Error(`actor-motion timeline actor identities are not stable across frames: ${JSON.stringify(continuity)}`);
  }
  const states = [...new Set(frames.flatMap(frame => frame.actors.map(actor => actor.state).filter(Boolean)))];
  const actorIds = continuity.actorIds;
  return {
    schema: LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_STATE_SCHEMA,
    payloadSchema: timeline.schema,
    route: timeline.route,
    reportSchema: report.schema || null,
    reportPath: report.reportPath || null,
    payloadSource: normalizeReceiptSource(payloadSource),
    frameCount: frames.length,
    durationMs: Number(timeline.durationMs ?? frames[frames.length - 1].timeMs),
    playback: clone(timeline.playback || {}),
    requiresMotionWitness: timeline.witnessState.requiresMotionWitness === true,
    staticActorPayloadAcceptedAsLoop: timeline.witnessState.staticActorPayloadAcceptedAsLoop === true,
    states,
    actorIds,
    continuity,
    goinCustody,
    movingActorIds: proof.movingActorIds,
    stateTransitions: proof.stateTransitions,
    frames,
    downgrades: clone(timeline.downgrades || []),
    custody: timeline.custody ? clone(timeline.custody) : null,
  };
}

export function selectLermsPreviewTimelineFrame(timelineState, elapsedMs) {
  assertObject(timelineState, 'LERMS Preview Bench timeline state');
  const frames = Array.isArray(timelineState.frames) ? timelineState.frames : [];
  if (frames.length === 0) throw new Error('cannot select a timeline frame without frames');
  const durationMs = Math.max(Number(timelineState.durationMs || frames[frames.length - 1].timeMs || 0), 1);
  const localMs = ((Number(elapsedMs) % durationMs) + durationMs) % durationMs;
  let current = frames[0];
  let next = frames[1] || frames[0];
  for (let index = 0; index < frames.length; index += 1) {
    const candidate = frames[index];
    const candidateNext = frames[index + 1] || frames[0];
    const nextTime = index + 1 < frames.length ? candidateNext.timeMs : durationMs;
    if (localMs >= candidate.timeMs && localMs <= nextTime) {
      current = candidate;
      next = candidateNext;
      break;
    }
  }
  const segmentDuration = Math.max((next.timeMs > current.timeMs ? next.timeMs : durationMs) - current.timeMs, 1);
  const blend = clampNumber((localMs - current.timeMs) / segmentDuration, 0, 1);
  return {
    schema: 'kaminos.lerms-preview-timeline-playback-frame.v0',
    elapsedMs: roundBenchNumber(localMs),
    blend: roundBenchNumber(blend),
    current: clone(current),
    next: clone(next),
    visualPrimitives: interpolateActorVisualPrimitives(current, next, blend),
    goinVisualPrimitives: interpolateGoinVisualPrimitives(current, next, blend),
  };
}

export function normalizeLermsPreviewActorMotionPayloadReport(report, payloadSource = null) {
  assertObject(report, 'LERMS Preview Bench actor-motion report');
  const payload = report.payload || report;
  assertObject(payload, 'LERMS Preview Bench actor-motion payload');
  if (payload.schema !== LERMS_PREVIEW_ACTOR_MOTION_PAYLOAD_SCHEMA) {
    throw new Error(`actor-motion payload schema mismatch: expected ${LERMS_PREVIEW_ACTOR_MOTION_PAYLOAD_SCHEMA} but got ${payload.schema || 'missing'}`);
  }
  if (payload.route !== LERMS_PREVIEW_ACTOR_MOTION_PAYLOAD_ROUTE) {
    throw new Error(`actor-motion payload route mismatch: expected ${LERMS_PREVIEW_ACTOR_MOTION_PAYLOAD_ROUTE} but got ${payload.route || 'missing'}`);
  }
  const surface = payload.acceptanceSurface;
  assertObject(surface, 'actor-motion acceptance surface');
  if (surface.worldChamberId !== LERMS_UNDERHILL_CHAMBER_ID || surface.posture !== 'inspect' || surface.bench !== LERMS_TERRAIN_PREVIEW_BENCH_ID) {
    throw new Error(`actor-motion payload does not target the LERMS Preview Bench: ${JSON.stringify(surface)}`);
  }
  if (surface.routeQuery !== routeStringForPreviewBench(LERMS_UNDERHILL_CHAMBER_ID, 'inspect', LERMS_TERRAIN_PREVIEW_BENCH_ID)) {
    throw new Error(`actor-motion payload route query mismatch: ${surface.routeQuery || 'missing'}`);
  }
  if (payload.witnessState?.schema !== LERMS_PREVIEW_ACTOR_MOTION_STATE_SCHEMA) {
    throw new Error(`actor-motion witness state schema mismatch: ${payload.witnessState?.schema || 'missing'}`);
  }
  if (!Array.isArray(payload.actorMotion) || payload.actorMotion.length === 0) {
    throw new Error('actor-motion payload must include actorMotion records');
  }
  if (payload.frame?.schema !== 'lerms.first-vertical-frame.v0') {
    throw new Error(`actor-motion frame schema mismatch: ${payload.frame?.schema || 'missing'}`);
  }
  if (payload.sourceTruthUpgrade?.schema !== 'lerms.first-vertical-source-truth-upgrade.v0') {
    throw new Error(`actor-motion source-truth upgrade schema mismatch: ${payload.sourceTruthUpgrade?.schema || 'missing'}`);
  }
  const selectedCliplets = payload.actorMotion.map(actor => actor?.selectedCliplet).filter(Boolean);
  const firstCliplet = selectedCliplets[0] || {};
  const states = [...new Set(payload.actorMotion.map(actor => actor?.state).filter(Boolean))];
  const downgrades = Array.isArray(payload.downgrades) ? payload.downgrades : [];
  const rejectedSurfaces = Array.isArray(payload.rejectedSurfaces) ? payload.rejectedSurfaces : [];
  const normalized = {
    schema: LERMS_PREVIEW_ACTOR_MOTION_STATE_SCHEMA,
    payloadSchema: payload.schema,
    route: payload.route,
    reportSchema: report.schema || null,
    reportPath: report.reportPath || null,
    payloadSource: normalizeReceiptSource(payloadSource),
    source: clone(payload.frame.source || {}),
    sourceTruthUpgrade: clone(payload.sourceTruthUpgrade),
    actorCount: payload.actorMotion.length,
    frameCounts: {
      terrain: countFrameArray(payload.frame, 'terrainSamples'),
      lerms: countFrameArray(payload.frame, 'lerms'),
      goins: countFrameArray(payload.frame, 'goins'),
      juiceHits: countFrameArray(payload.frame, 'juiceHits'),
      carrierDrops: countFrameArray(payload.frame, 'carrierDrops', 'carrierDropEvents'),
    },
    motionAdapterSchema: payload.witnessState.motionAdapterSchema || payload.actorMotion[0]?.motionAdapter?.schema || null,
    selectedClipletSource: {
      schema: firstCliplet.schema || null,
      route: firstCliplet.sourceRoute || null,
      model: firstCliplet.sourceModel || null,
      status: firstCliplet.sourceStatus || null,
    },
    states,
    actors: clone(payload.actorMotion),
    downgrades: clone(downgrades),
    rejectedSurfaces: clone(rejectedSurfaces),
    custody: payload.custody ? clone(payload.custody) : null,
    outputsVisualPreview: payload.witnessState.outputsVisualPreview === true,
  };
  normalized.visualPrimitives = createLermsPreviewActorVisualPrimitives(normalized);
  return normalized;
}

export function createLermsPreviewBenchState(registry = createDefaultWorldChambersRegistry(), options = {}) {
  const debug = worldChamberDebugState(registry);
  const chamber = debug.activeChamber;
  if (!chamber || chamber.id !== LERMS_UNDERHILL_CHAMBER_ID) {
    throw new Error(`LERMS Preview Bench requires active chamber ${LERMS_UNDERHILL_CHAMBER_ID}`);
  }
  const benchId = options.benchId || options.bench || LERMS_TERRAIN_PREVIEW_BENCH_ID;
  const bench = findPreviewBench(chamber, benchId);
  if (!bench || bench.id !== LERMS_TERRAIN_PREVIEW_BENCH_ID) {
    throw new Error(`unknown LERMS preview bench: ${benchId || 'missing'}`);
  }
  const posture = options.posture || bench.posture || 'inspect';
  const activeCamera = previewCameraPreset(options.cameraId || options.camera || 'overview-oblique');
  const frame = debug.receipt?.frame || null;
  const terrainSamples = terrainSamplesFromFrame(frame);
  const primaryTerrain = terrainSamples[0] || null;
  const receiptMode = debug.receiptSource?.mode || (debug.usingFixtureFallback ? 'embedded_fixture' : 'unknown');
  const freshness = debug.usingFixtureFallback || receiptMode === 'embedded_fixture' ? 'fixture' : 'external';
  const actorMotion = options.actorMotionPayloadReport
    ? normalizeLermsPreviewActorMotionPayloadReport(options.actorMotionPayloadReport, options.actorMotionPayloadSource)
    : null;
  const actorMotionTimeline = options.actorMotionTimelineReport
    ? normalizeLermsPreviewActorMotionTimelineReport(options.actorMotionTimelineReport, options.actorMotionTimelineSource)
    : null;
  const previewPayloadReports = [
    ...(Array.isArray(options.previewPayloadReports) ? options.previewPayloadReports : []),
    ...(options.previewPayloadReport ? [options.previewPayloadReport] : []),
  ];
  const previewPayloadSources = [
    ...(Array.isArray(options.previewPayloadSources) ? options.previewPayloadSources : []),
    ...(options.previewPayloadSource ? [options.previewPayloadSource] : []),
  ];
  const previewPayloads = previewPayloadReports.map((report, index) => normalizePreviewBenchPayloadReport(report, previewPayloadSources[index] || null, {
    chamberId: chamber.id,
    posture,
    benchId: bench.id,
  }));
  return {
    schema: LERMS_PREVIEW_WITNESS_SCHEMA,
    hostDescriptor: WORLD_CHAMBER_PREVIEW_BENCH_SCHEMA,
    chamberId: chamber.id,
    benchId: bench.id,
    posture,
    route: routeStringForPreviewBench(chamber.id, posture, bench.id),
    operatorLabel: bench.operatorLabel,
    source: {
      authority: debug.authority,
      fallbackMode: receiptMode,
      evidenceStatus: chamber.evidenceStatus,
      receiptSource: debug.receiptSource,
      branch: chamber.source?.branch || null,
    },
    badges: {
      source: debug.authority || 'authority unavailable',
      freshness,
      fallback: receiptMode,
      actorMotion: actorMotion?.source?.authority || null,
      actorMotionTimeline: actorMotionTimeline ? `timeline:${actorMotionTimeline.frameCount}` : null,
      previewPayloads: previewPayloads.length ? `${previewPayloads.length} payload${previewPayloads.length === 1 ? '' : 's'}` : null,
    },
    activeCamera: clone(activeCamera),
    cameraPresets: clone(LERMS_PREVIEW_CAMERA_PRESETS),
    terrain: {
      schema: 'lerms.terrain-sample.v0',
      source: primaryTerrain?.source || debug.authority || null,
      sampleCount: Number(primaryTerrain?.sampleCount ?? debug.summary?.terrainSamples ?? terrainSamples.length),
      underhillBand: primaryTerrain?.underhillBand || null,
      samples: clone(terrainSamples),
    },
    summary: debug.summary ? clone(debug.summary) : null,
    schemaPreservation: {
      source: 'lerms.source-truth.v0',
      terrain: 'lerms.terrain-sample.v0',
      lerm: 'lerms.lerm-state.v0',
      goin: 'lerms.goin-state.v0',
      juiceHit: 'lerms.juice-hit-event.v0',
      carrierDrop: 'lerms.carrier-drop-event.v0',
      frame: chamber.frameSchema,
      summary: chamber.summarySchema,
    },
    forgeRail: chamber.forgeRail ? clone(chamber.forgeRail) : null,
    intentionallyAbsent: debug.intentionallyAbsent ? clone(debug.intentionallyAbsent) : null,
    receiptLoadError: debug.receiptLoadError ? clone(debug.receiptLoadError) : null,
    previewPayloads,
    actorMotion,
    actorMotionTimeline,
  };
}

export function worldChamberDebugState(registry = createDefaultWorldChambersRegistry()) {
  const active = registry.chambers.find(chamber => chamber.id === registry.activeChamberId) || registry.chambers[0] || null;
  const receipt = active ? registry.receipts?.[active.id] || null : null;
  const receiptLoadError = active ? registry.receiptLoadErrors?.[active.id] || null : null;
  return {
    schema: registry.schema,
    activeChamberId: registry.activeChamberId,
    chamberCount: registry.chambers.length,
    chambers: clone(registry.chambers),
    activeChamber: active ? clone(active) : null,
    receipt: receipt ? clone(receipt) : null,
    receiptSource: receipt?.receiptSource || null,
    receiptLoadError: receiptLoadError ? clone(receiptLoadError) : null,
    usingFixtureFallback: !!registry.usingFixtureFallback,
    route: receipt?.route || active?.route || null,
    authority: receipt?.authority || active?.expectedAuthority || null,
    authorityNote: receipt?.authorityNote || active?.authorityNote || null,
    sourceTruth: receipt?.source || null,
    summary: receipt?.summary || null,
    intentionallyAbsent: receipt?.intentionallyAbsent || null,
    previewBenches: active?.previewBenches || [],
    forgeRail: active?.forgeRail || null,
    falseLiveClaim: receipt?.falseLiveClaim ?? null,
  };
}
