export const KAMINOS_SMOKE_BENCH_OFFER_SCHEMA = 'kaminos.smoke-bench.offer.v0';
export const KAMINOS_SMOKE_BENCH_PRIMARY_TARGET_SCHEMA = 'kaminos.smoke-bench.primary-target.v0';
export const KAMINOS_SMOKE_BENCH_ROUTE_SCHEMA = 'kaminos.smoke-bench.route.v0';
export const KAMINOS_SMOKE_BENCH_SHELL_SCHEMA = 'kaminos.smoke-bench.shell.v0';

const NON_LIVE_AUTHORITIES = new Set([
  'fixture',
  'fallback',
  'seeded',
  'stale',
  'replay',
  'synthetic',
]);

const TARGET_KINDS = new Set(['browser', 'native-host', 'asset', 'stateStream']);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function targetIdFromOfferId(offerId) {
  return `target:${String(offerId || 'smoke-offer').replace(/^offer:/, '').replace(/:/g, '-')}`;
}

function hasLiveDisplayLie(authority, displayState) {
  return NON_LIVE_AUTHORITIES.has(authority) && displayState === 'live';
}

function normalizeAdapter(adapter, targetKind, targetId) {
  const source = objectOrNull(adapter);
  if (!source) throw new Error(`${targetId}: Smoke Bench primaryTarget missing adapter`);
  if (!source.id) throw new Error(`${targetId}: Smoke Bench adapter missing id`);
  if (!source.kind) throw new Error(`${targetId}: Smoke Bench adapter missing kind`);
  if (!source.acceptancePredicate) {
    throw new Error(`${targetId}: Smoke Bench adapter missing acceptancePredicate`);
  }
  if (source.kind === 'link_out') {
    throw new Error(`${targetId}: link-out is not Smoke Bench acceptance for ${targetKind}`);
  }
  if (targetKind === 'browser' && source.kind !== 'browser_iframe') {
    throw new Error(`${targetId}: browser Smoke Bench target requires browser_iframe adapter`);
  }
  return {
    id: String(source.id),
    kind: String(source.kind),
    acceptancePredicate: String(source.acceptancePredicate),
    ...cloneJson(source),
  };
}

function normalizePrimaryTarget(primaryTarget, offerId) {
  const source = objectOrNull(primaryTarget);
  if (!source) throw new Error(`${offerId || 'unknown offer'}: Smoke Bench offer missing primaryTarget`);
  const id = source.id || targetIdFromOfferId(offerId);
  const kind = source.kind || 'browser';
  if (!TARGET_KINDS.has(kind)) throw new Error(`${id}: unsupported Smoke Bench primaryTarget kind ${kind}`);
  const adapter = normalizeAdapter(source.adapter, kind, id);
  if (kind === 'browser' && !source.url) throw new Error(`${id}: browser Smoke Bench target missing url`);
  if (kind === 'native-host' && !source.hostPayload) {
    throw new Error(`${id}: native Smoke Bench target missing hostPayload`);
  }
  if (kind === 'stateStream' && !source.stateStream) {
    throw new Error(`${id}: stateStream Smoke Bench target missing stateStream`);
  }
  return {
    schema: KAMINOS_SMOKE_BENCH_PRIMARY_TARGET_SCHEMA,
    id,
    kind,
    surface: source.surface || kind,
    url: source.url || null,
    adapter,
    hostPayload: source.hostPayload ? cloneJson(source.hostPayload) : null,
    stateStream: source.stateStream ? cloneJson(source.stateStream) : null,
    asset: source.asset ? cloneJson(source.asset) : null,
  };
}

export function createSmokeBenchOffer({
  id,
  producerDiaulos,
  title,
  sourceRef,
  authority = 'unknown',
  displayState = authority === 'live' ? 'live' : 'available',
  freshness = 'unknown',
  primaryTarget,
  artifacts = [],
  bundle = null,
  hostPayload = null,
  stateStream = null,
  downgrades = [],
  legacyForgeHostOffer = null,
} = {}) {
  if (!id) throw new Error('Smoke Bench offer missing id');
  if (!producerDiaulos) throw new Error(`${id}: Smoke Bench offer missing producerDiaulos`);
  if (!sourceRef) throw new Error(`${id}: Smoke Bench offer missing sourceRef`);
  if (hasLiveDisplayLie(authority, displayState)) {
    throw new Error(`${authority} Smoke Bench offer claimed live display authority for ${id}`);
  }
  const target = normalizePrimaryTarget(primaryTarget, id);
  return {
    schema: KAMINOS_SMOKE_BENCH_OFFER_SCHEMA,
    id,
    producerDiaulos,
    title: title || id,
    sourceRef,
    authority,
    displayState,
    freshness,
    primaryTarget: target,
    artifacts: arrayOrEmpty(artifacts).map(item => cloneJson(item)),
    bundle: bundle ? cloneJson(bundle) : null,
    hostPayload: hostPayload ? cloneJson(hostPayload) : target.hostPayload,
    stateStream: stateStream ? cloneJson(stateStream) : target.stateStream,
    downgrades: arrayOrEmpty(downgrades).map(String),
    legacyForgeHostOffer: legacyForgeHostOffer ? cloneJson(legacyForgeHostOffer) : null,
  };
}

function inferForgeAdapter(offerRecord) {
  const targetUrl = String(offerRecord.targetUrl || '').trim();
  if (targetUrl && !targetUrl.startsWith('codex ') && !targetUrl.startsWith('claude ')) {
    return {
      kind: 'browser',
      adapter: {
        id: 'browser-iframe',
        kind: 'browser_iframe',
        acceptancePredicate: 'iframe_loaded_same_origin_target',
      },
    };
  }
  return {
    kind: 'asset',
    adapter: {
      id: 'asset-inspector',
      kind: 'asset_inspector',
      acceptancePredicate: 'declared_asset_loaded_in_kaminos',
    },
  };
}

export function normalizeForgeHostOfferForSmokeBench(offerRecord, station = {}) {
  if (!offerRecord || typeof offerRecord !== 'object') throw new Error('Smoke Bench Forge Host normalization expected offer record');
  const inferred = inferForgeAdapter(offerRecord);
  return createSmokeBenchOffer({
    id: `smoke-bench:${offerRecord.id}`,
    producerDiaulos: offerRecord.producerDiaulos || station.diaulos,
    title: offerRecord.title,
    sourceRef: offerRecord.sourceRef,
    authority: offerRecord.authority || 'unknown',
    displayState: offerRecord.displayState || 'unknown',
    freshness: offerRecord.freshness || 'unknown',
    primaryTarget: {
      id: targetIdFromOfferId(offerRecord.id),
      kind: inferred.kind,
      surface: offerRecord.targetSurface,
      url: offerRecord.targetUrl || null,
      adapter: inferred.adapter,
      asset: inferred.kind === 'asset'
        ? { ref: offerRecord.targetUrl || offerRecord.sourceRef, surface: offerRecord.targetSurface }
        : null,
    },
    artifacts: [
      offerRecord.reportSource ? { id: 'report', kind: 'report', ref: offerRecord.reportSource } : null,
      offerRecord.screenshotSource ? { id: 'screenshot', kind: 'screenshot', ref: offerRecord.screenshotSource } : null,
    ].filter(Boolean),
    downgrades: offerRecord.downgrades || [],
    legacyForgeHostOffer: offerRecord,
  });
}

export function routeSmokeBenchOfferToTarget(offerRecord, {
  openedAt = new Date().toISOString(),
} = {}) {
  if (!offerRecord || offerRecord.schema !== KAMINOS_SMOKE_BENCH_OFFER_SCHEMA) {
    throw new Error(`Smoke Bench route expected ${KAMINOS_SMOKE_BENCH_OFFER_SCHEMA}`);
  }
  if (hasLiveDisplayLie(offerRecord.authority, offerRecord.displayState)) {
    throw new Error(`${offerRecord.authority} Smoke Bench route claimed live display authority for ${offerRecord.id}`);
  }
  const target = normalizePrimaryTarget(offerRecord.primaryTarget, offerRecord.id);
  const adapter = cloneJson(target.adapter);
  return {
    schema: KAMINOS_SMOKE_BENCH_ROUTE_SCHEMA,
    shellSchema: KAMINOS_SMOKE_BENCH_SHELL_SCHEMA,
    id: `smoke-bench-route:${offerRecord.id}`,
    openedAt,
    offerId: offerRecord.id,
    producerDiaulos: offerRecord.producerDiaulos,
    sourceRef: offerRecord.sourceRef,
    sourceAuthority: offerRecord.authority,
    displayState: offerRecord.displayState,
    freshness: offerRecord.freshness,
    primaryTarget: target,
    adapter,
    targetUrl: target.url || null,
    hostPayload: target.hostPayload,
    stateStream: target.stateStream,
    artifacts: cloneJson(offerRecord.artifacts || []),
    downgrades: cloneJson(offerRecord.downgrades || []),
    operatorInspectionStatus: 'pending',
    routeWarnings: ['pop_out_escape_not_acceptance', 'not_chat_bridge', 'not_command_execution'],
  };
}
