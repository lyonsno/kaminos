export const WORLD_CHAMBER_REGISTRY_SCHEMA = 'kaminos.world-chambers.registry.v0';
export const WORLD_CHAMBER_DESCRIPTOR_SCHEMA = 'kaminos.world-chamber.descriptor.v0';
export const WORLD_CHAMBER_PREVIEW_BENCH_SCHEMA = 'kaminos.world-chamber.preview-bench.v0';
export const WORLD_CHAMBER_RECEIPT_SCHEMA = 'kaminos.world-chamber.receipt.v0';
export const LERMS_PREVIEW_ACTOR_MOTION_PAYLOAD_SCHEMA = 'lerms.preview-bench-actor-motion-payload.v0';
export const LERMS_PREVIEW_ACTOR_MOTION_STATE_SCHEMA = 'lerms.preview-bench-actor-motion-state.v0';
export const LERMS_PREVIEW_ACTOR_MOTION_PAYLOAD_ROUTE = 'lerms/preview-bench/actor-motion-payload-file';
export const LERMS_PREVIEW_WITNESS_SCHEMA = 'kaminos.lerms-preview-witness.v0';
export const LERMS_PREVIEW_ACTOR_VISUAL_SCHEMA = 'kaminos.lerms-preview-actor-visual.v0';
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
    actorMotion,
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
