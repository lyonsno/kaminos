const FROZEN_SOURCE_SHA256 = '134136dd4086cfc1b887ab0a134c4a2b906223762a0d5959a8b90cc68f11f4f0';
const FROZEN_WEIGHTS_SHA256 = '98212168b105c4027aff54c635fe01f547974911deb0c1109d8c05df68a01caf';
const FROZEN_SHARP_BASE_REVISION = 'b689f485d5d6f6c8868f21ad3d56d17e81cba44a';
const FROZEN_EMBEDDED_KIT_VERSION = '0.1.38';

const COLLECTION_IDS = Object.freeze([
  'progress-events',
  'scheduler-events',
  'resource-snapshots',
  'raf-opportunity-snapshots',
  'host-stats',
  'runtime-errors',
]);

export const GATE_B_COLLECTIONS = Object.freeze(COLLECTION_IDS.map(id => Object.freeze({
  id,
  jsonPointer: `#/gateB/collections/${id}`,
  expectedCount: null,
  liveAppend: true,
  retention: 'uncapped',
  mediaType: 'application/x-ndjson',
})));

const EXPECTED_SCHEDULER = Object.freeze({
  decoderKernelChunkItems: 262_144,
  decoderKernelMinChunkItems: 65_536,
  decoderKernelMaxChunkItems: 8_388_608,
  decoderKernelTargetDurationMs: 12,
  decoderKernelAdjustmentGain: 0.375,
  waitForSubmittedWorkDone: true,
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeFinite(value) {
  return Number.isFinite(value) && value >= 0;
}

function sha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function gateBSourceAssetId(source) {
  return source?.assetId || source?.id || null;
}

export async function bindGateBSourceBlobIdentity(
  source,
  sourceBlob,
  { cryptoImpl = globalThis.crypto } = {},
) {
  if (!sha256(source?.sha256)) {
    throw new Error('Gate B registered source asset is missing a valid SHA-256');
  }
  if (!sourceBlob || typeof sourceBlob.arrayBuffer !== 'function') {
    throw new Error('Gate B fetched source body is not a readable Blob');
  }
  if (!cryptoImpl?.subtle || typeof cryptoImpl.subtle.digest !== 'function') {
    throw new Error('Gate B cannot authenticate fetched source bytes without Web Crypto');
  }
  const digest = await cryptoImpl.subtle.digest('SHA-256', await sourceBlob.arrayBuffer());
  const fetchedSha256 = [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  if (fetchedSha256 !== source.sha256) {
    throw new Error(
      `Gate B fetched source SHA-256 ${fetchedSha256} does not match registered asset SHA-256 ${source.sha256}`,
    );
  }
  return {
    ...source,
    sha256: fetchedSha256,
  };
}

export function validateGateBRouteIdentity(identity) {
  const failures = [];
  if (identity?.schema !== 'kaminos.sharp-gate-b-route-identity.v0') {
    failures.push('wrong Gate B route identity schema');
  }
  if (identity?.requestedRoute !== 'sharp-image-to-splat-live-v0') {
    failures.push('wrong requested SHARP route');
  }
  if (identity?.effectiveRoute !== 'same-browser-product-realm-shared-device') {
    failures.push('wrong or fallback effective SHARP route');
  }
  if (identity?.source?.sha256 !== FROZEN_SOURCE_SHA256) {
    failures.push('route does not match Wake’s frozen source hash');
  }
  if (identity?.weights?.sha256 !== FROZEN_WEIGHTS_SHA256) {
    failures.push('route does not match Wake’s frozen weights hash');
  }
  if (identity?.model?.baseRevision !== FROZEN_SHARP_BASE_REVISION) {
    failures.push('route does not match Wake’s frozen SHARP base revision');
  }
  if (typeof identity?.model?.instrumentationRevision !== 'string'
      || !identity.model.instrumentationRevision) {
    failures.push('SHARP instrumentation revision is missing');
  }
  const instrumentationBundle = identity?.model?.instrumentationBundle;
  if (!sha256(instrumentationBundle?.expectedSha256)
      || !sha256(instrumentationBundle?.effectiveSha256)
      || instrumentationBundle.expectedSha256 !== instrumentationBundle.effectiveSha256
      || instrumentationBundle.identityStatus !== 'matched') {
    failures.push('generated SHARP bundle identity is missing or does not match the requested bytes');
  }
  if (identity?.browser?.headed !== true) {
    failures.push('Gate B requires a headed browser');
  }
  if (!identity?.browser?.executable || !identity?.browser?.version) {
    failures.push('effective browser identity is incomplete');
  }
  if (!identity?.adapter?.vendor || !identity?.adapter?.architecture) {
    failures.push('effective adapter identity is incomplete');
  }
  if (!positiveSafeInteger(identity?.adapter?.deviceLimits?.maxBufferSize)
      || !positiveSafeInteger(identity?.adapter?.deviceLimits?.maxStorageBufferBindingSize)) {
    failures.push('effective WebGPU device limits are missing');
  }
  const embeddedKit = identity?.kitRuntime?.embedded;
  const hostKit = identity?.kitRuntime?.host;
  if (embeddedKit?.package !== '@kaminos/webgpu-inference-kit'
      || embeddedKit?.version !== FROZEN_EMBEDDED_KIT_VERSION
      || embeddedKit?.source !== 'sharp-runtime') {
    failures.push('embedded kit identity is missing or does not match SHARP 0.1.38');
  }
  if (hostKit?.package !== '@kaminos/webgpu-inference-kit'
      || typeof hostKit?.version !== 'string'
      || !hostKit.version
      || hostKit?.source !== 'kaminos-runtime') {
    failures.push('host kit identity is missing');
  }
  if (embeddedKit && hostKit && embeddedKit === hostKit) {
    failures.push('host and embedded kit identities must remain separate');
  }
  const scheduler = identity?.scheduler;
  if (scheduler?.profileId !== 'cooperative-spn-gaussian') {
    failures.push('wrong Gate B scheduler profile');
  }
  if (!isRecord(scheduler?.effective)
      || Object.entries(EXPECTED_SCHEDULER).some(
        ([field, expected]) => scheduler.effective[field] !== expected,
      )) {
    failures.push('stale or substituted adaptive scheduler');
  }
  const isolation = identity?.presentationIsolation;
  if (isolation?.mode !== 'foreground-opportunity-no-render') {
    failures.push('wrong presentation isolation mode');
  }
  if (isolation?.foregroundRafLease !== true) {
    failures.push('foreground rAF lease is not active');
  }
  if (isolation?.simulationQuiesced !== true) {
    failures.push('simulation is not quiesced');
  }
  if (isolation?.raymarchSubmissionQuiesced !== true) {
    failures.push('raymarch submission is not quiesced');
  }
  if (!positiveSafeInteger(identity?.processes?.witnessPid)
      || !positiveSafeInteger(identity?.processes?.browserPid)
      || !positiveSafeInteger(identity?.processes?.gpuProcessPid)
      || !Array.isArray(identity?.processes?.rendererPids)
      || identity.processes.rendererPids.length === 0
      || identity.processes.rendererPids.some(pid => !positiveSafeInteger(pid))) {
    failures.push('browser, renderer, GPU, and witness PID identity is incomplete');
  }
  return failures;
}

export function normalizeGateBAdaptiveRange(event) {
  if (!isRecord(event)) throw new TypeError('Gate B adaptive range must be an object');
  if (event.kind !== 'decoder-kernel-range-observed') {
    throw new TypeError('Gate B adaptive range must be a decoder-kernel-range-observed event');
  }
  if (typeof event.rangeId !== 'string' || !event.rangeId.includes(':range:')) {
    throw new TypeError('Gate B adaptive range requires a planner-scoped rangeId');
  }
  const plannerId = event.rangeId.slice(0, event.rangeId.lastIndexOf(':range:'));
  if (!plannerId) throw new TypeError('Gate B adaptive range plannerId is empty');
  for (const field of ['rangeIndex', 'outputStart', 'outputEnd', 'outputCount', 'totalOutputItems']) {
    if (!Number.isSafeInteger(event[field]) || event[field] < 0) {
      throw new TypeError(`Gate B adaptive range ${field} must be a non-negative safe integer`);
    }
  }
  if (event.outputCount <= 0
      || event.outputEnd <= event.outputStart
      || event.outputEnd - event.outputStart !== event.outputCount
      || event.outputEnd > event.totalOutputItems) {
    throw new RangeError('Gate B adaptive range has a discontinuous output range');
  }
  for (const field of [
    'plannedChunkItems',
    'observedChunkItems',
    'targetDurationMs',
    'requestedAdjustmentGain',
    'effectiveAdjustmentGain',
  ]) {
    if (!Number.isFinite(event[field]) || event[field] <= 0) {
      throw new TypeError(`Gate B adaptive range ${field} must be finite and positive`);
    }
  }
  for (const field of [
    'observedDurationMs',
    'fullGainCorrectionRatio',
    'effectiveCorrectionRatio',
  ]) {
    if (!nonNegativeFinite(event[field])) {
      throw new TypeError(`Gate B adaptive range ${field} must be finite and non-negative`);
    }
  }
  if (event.timingAuthority !== 'queue-work-done') {
    throw new Error('Gate B adaptive range timing authority must be queue-work-done');
  }
  if (!isRecord(event.bounds)
      || !positiveSafeInteger(event.bounds.minChunkItems)
      || !positiveSafeInteger(event.bounds.maxChunkItems)
      || event.bounds.minChunkItems > event.bounds.maxChunkItems) {
    throw new TypeError('Gate B adaptive range bounds are incomplete');
  }
  if (!event.queueWorkAttribution || !event.foregroundServiceStatus) {
    throw new TypeError('Gate B adaptive range lacks queue or foreground-service identity');
  }
  return Object.freeze({
    ...event,
    plannerId,
    retention: 'uncapped',
  });
}

function normalizedCount(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

export function createGateBBatchingState({
  flushIntervalMs,
  collectionCounts = {},
  flushOrdinal = 0,
  lastFlushedAt = null,
} = {}) {
  if (!Number.isFinite(flushIntervalMs) || flushIntervalMs <= 0) {
    throw new TypeError('flushIntervalMs must be finite and positive');
  }
  const collections = {};
  for (const [collectionId, counts] of Object.entries(collectionCounts)) {
    if (!COLLECTION_IDS.includes(collectionId)) {
      throw new RangeError(`unknown Gate B collection ${collectionId}`);
    }
    const queued = normalizedCount(counts?.queued, `${collectionId}.queued`);
    const flushed = normalizedCount(counts?.flushed, `${collectionId}.flushed`);
    const inFlight = normalizedCount(counts?.inFlight, `${collectionId}.inFlight`);
    if (flushed > queued) throw new RangeError('flushed count cannot exceed queued count');
    if (inFlight > queued - flushed) {
      throw new RangeError('in-flight count cannot exceed the unflushed count');
    }
    collections[collectionId] = {
      queued,
      flushed,
      inFlight,
      unflushed: queued - flushed,
    };
  }
  return {
    schema: 'kaminos.sharp-gate-b-batching.v0',
    retention: 'uncapped',
    overflowPolicy: 'none-all-rows-retained',
    flushIntervalMs,
    maxRowsPerFlush: null,
    flushOrdinal: normalizedCount(flushOrdinal, 'flushOrdinal'),
    lastFlushedAt,
    collections,
  };
}

export function validateGateBCompletion({
  status,
  routeIdentity,
  collections,
  artifact,
  browserExit,
} = {}) {
  const failures = validateGateBRouteIdentity(routeIdentity);
  if (status !== 'complete') failures.push('Gate B journal is not complete');
  for (const collection of GATE_B_COLLECTIONS) {
    const observed = collections?.[collection.id];
    if (!isRecord(observed)) {
      failures.push(`missing ${collection.id} collection`);
      continue;
    }
    if (observed.retention !== 'uncapped') {
      failures.push(`${collection.id} collection is capped`);
    }
    if (!Number.isSafeInteger(observed.receivedCount) || observed.receivedCount < 0
        || !Number.isSafeInteger(observed.expectedCount) || observed.expectedCount < 0
        || observed.receivedCount !== observed.expectedCount
        || observed.partialWrite === true) {
      failures.push(`partial ${collection.id} collection`);
    } else if (collection.id !== 'runtime-errors' && observed.receivedCount === 0) {
      failures.push(`empty ${collection.id} collection`);
    }
  }
  if (!artifact?.path || !sha256(artifact?.sha256) || !positiveSafeInteger(artifact?.bytes)) {
    failures.push('completion lacks a trustworthy PLY artifact');
  }
  if (browserExit?.beforePrimaryOutput === true) {
    const exitActor = browserExit.kind === 'renderer-exit' ? 'renderer' : 'browser';
    failures.push(`${exitActor} exited before primary output`);
  }
  return failures;
}
