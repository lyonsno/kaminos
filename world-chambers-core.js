export const WORLD_CHAMBER_REGISTRY_SCHEMA = 'kaminos.world-chambers.registry.v0';
export const WORLD_CHAMBER_DESCRIPTOR_SCHEMA = 'kaminos.world-chamber.descriptor.v0';
export const WORLD_CHAMBER_RECEIPT_SCHEMA = 'kaminos.world-chamber.receipt.v0';
export const LERMS_UNDERHILL_CHAMBER_ID = 'lerms-underhill';

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
    forgeRail: active?.forgeRail || null,
    falseLiveClaim: receipt?.falseLiveClaim ?? null,
  };
}
