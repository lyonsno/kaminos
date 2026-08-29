const COLLECTION_REFERENCE_SCHEMA = 'kaminos.ndjson-collection-reference.v0';
const DEFAULT_CHUNK_ROWS = 512;
const CANONICAL_SCHEDULER_TRANSPORT = 'base64-canonical-utf8-ndjson-v1';
const JSON_ROW_TRANSPORT = 'json-rows-v1';
const SHARP_SPN_LOWRES_BLOCK_LABELS = new Set([
  'upsample-lowres',
  'readback-x2-upsampled',
  'readback-lowres',
  'cpu-concat-lowres',
  'concat-upload',
  'fuse-lowres',
]);
const SHARP_MONODEPTH_PHASE_LABELS = new Set([
  'project-feature',
  'fusion-resnet1',
  'fusion-skip-add',
  'fusion-resnet2',
  'fusion-out-conv',
  'head-conv0',
  'head-final',
]);

export function compactSharpInlineReportDocument(document, {
  schedulerTelemetryArchive = null,
} = {}) {
  if (!isRecord(document)) {
    throw new TypeError('SHARP inline report document must be an object');
  }
  const archiveEvents = schedulerTelemetryArchiveEvents(schedulerTelemetryArchive);

  const collections = [];
  const collectionByValues = new WeakMap();
  const externalize = (id, jsonPointer, values) => {
    if (!Array.isArray(values)) return null;
    const existing = collectionByValues.get(values);
    if (existing) return existing.ref;
    const ref = {
      schema: COLLECTION_REFERENCE_SCHEMA,
      collectionId: id,
      count: values.length,
      retention: 'uncapped',
      traceArtifactRef: `#/traceArtifacts/${escapeJsonPointer(id)}`,
    };
    collections.push({
      id,
      jsonPointer,
      values,
      ref,
      transport: id === 'scheduler-events' && values === archiveEvents
        ? CANONICAL_SCHEDULER_TRANSPORT
        : JSON_ROW_TRANSPORT,
    });
    collectionByValues.set(values, { ref });
    return ref;
  };

  const compactDocument = { ...document };
  if (isRecord(document.authoritativeTrace)) {
    compactDocument.authoritativeTrace = { ...document.authoritativeTrace };
    if (isRecord(document.authoritativeTrace.sharpRunDebug)) {
      compactDocument.authoritativeTrace.sharpRunDebug = compactRunDebug(
        document.authoritativeTrace.sharpRunDebug,
        '#/authoritativeTrace/sharpRunDebug',
        externalize,
        archiveEvents,
        schedulerTelemetryArchive,
      );
    }
    if (isRecord(document.authoritativeTrace.backgroundHeartbeat)) {
      compactDocument.authoritativeTrace.backgroundHeartbeat = compactBackgroundHeartbeat(
        document.authoritativeTrace.backgroundHeartbeat,
        '#/authoritativeTrace/backgroundHeartbeat',
        externalize,
      );
    }
  }
  if (isRecord(document.sharpRunDebug)) {
    compactDocument.sharpRunDebug = compactRunDebug(
      document.sharpRunDebug,
      '#/sharpRunDebug',
      externalize,
      archiveEvents,
      schedulerTelemetryArchive,
    );
  }
  if (isRecord(document.backgroundHeartbeat)) {
    compactDocument.backgroundHeartbeat = compactBackgroundHeartbeat(
      document.backgroundHeartbeat,
      '#/backgroundHeartbeat',
      externalize,
    );
  }

  return { document: compactDocument, collections };
}

export async function persistSharpInlineReportSession({
  fetchImpl = globalThis.fetch,
  pipelineId = 'sharp-image-to-splat-live-v0',
  firingId,
  document,
  traceCollections,
  schedulerTelemetryArchive = null,
  lastTrustworthyOutput = null,
  chunkRows = DEFAULT_CHUNK_ROWS,
  taskYield = yieldBrowserTask,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (!Number.isSafeInteger(chunkRows) || chunkRows <= 0) {
    throw new TypeError('chunkRows must be a positive safe integer');
  }
  const compacted = traceCollections
    ? { document, collections: traceCollections }
    : compactSharpInlineReportDocument(document, { schedulerTelemetryArchive });
  const collections = compacted.collections || [];
  const schedulerArchiveIdentity = collections.some(
    collection => collection.transport === CANONICAL_SCHEDULER_TRANSPORT,
  ) ? sourceSchedulerArchiveIdentity(compacted.document) : null;
  const lastTrustworthyCounts = Object.fromEntries(
    collections.map(collection => [collection.id, 0]),
  );
  let sessionId = null;
  let phase = 'report-session-start';

  try {
    const startReceipt = await postJson(fetchImpl, '/api/sharp-inline-run-report/start', {
      pipelineId,
      firingId,
      document: compacted.document,
      lastTrustworthyOutput,
      collections: collections.map(collection => ({
        id: collection.id,
        jsonPointer: collection.jsonPointer,
        expectedCount: collection.values.length,
        retention: 'uncapped',
        mediaType: 'application/x-ndjson',
        transport: collection.transport || JSON_ROW_TRANSPORT,
        ...(collection.transport === CANONICAL_SCHEDULER_TRANSPORT
          ? { sourceArchiveIdentity: schedulerArchiveIdentity }
          : {}),
      })),
    });
    sessionId = startReceipt.sessionId;
    if (!sessionId) throw new Error('SHARP inline report start omitted sessionId');

    phase = 'trace-chunk-upload';
    for (const collection of collections) {
      for (let start = 0; start < collection.values.length; start += chunkRows) {
        const rows = collection.values.slice(start, start + chunkRows);
        const canonicalSchedulerChunk = collection.transport === CANONICAL_SCHEDULER_TRANSPORT
          ? `${rows.map(row => JSON.stringify(row)).join('\n')}\n`
          : null;
        const chunkReceipt = await postJson(fetchImpl, '/api/sharp-inline-run-report/chunk', {
          sessionId,
          collectionId: collection.id,
          expectedStart: start,
          ...(canonicalSchedulerChunk === null
            ? { rows }
            : {
              rowCount: rows.length,
              base64Ndjson: utf8Base64(canonicalSchedulerChunk),
            }),
        });
        const expectedReceived = start + rows.length;
        if (
          chunkReceipt.collectionId !== collection.id
          || chunkReceipt.receivedCount !== expectedReceived
        ) {
          throw new Error(
            `SHARP inline trace receipt mismatch for ${collection.id}: `
            + `expected ${expectedReceived}, received ${chunkReceipt.receivedCount}`,
          );
        }
        lastTrustworthyCounts[collection.id] = expectedReceived;
        await taskYield();
      }
    }

    phase = 'report-session-finish';
    const receipt = await postJson(fetchImpl, '/api/sharp-inline-run-report/finish', {
      sessionId,
    });
    if (!receipt.path || !receipt.outputRoot || !receipt.readUrl) {
      throw new Error('SHARP inline report finish omitted its durable identity');
    }
    return completeReportReceipt(receipt, compacted.document, pipelineId);
  } catch (error) {
    if (sessionId && phase === 'report-session-finish') {
      try {
        const recoveredReceipt = await postJson(
          fetchImpl,
          '/api/sharp-inline-run-report/finish',
          { sessionId },
        );
        if (recoveredReceipt.path && recoveredReceipt.outputRoot && recoveredReceipt.readUrl) {
          return completeReportReceipt(recoveredReceipt, compacted.document, pipelineId);
        }
      } catch {
        // Abort below only when the idempotent finish retry cannot recover completion truth.
      }
    }
    if (sessionId) {
      try {
        await postJson(fetchImpl, '/api/sharp-inline-run-report/abort', {
          sessionId,
          phase,
          error: error?.message || String(error),
          lastTrustworthyCounts,
          lastTrustworthyOutput,
        });
      } catch {
        // The original transport failure remains authoritative.
      }
    }
    throw error;
  }
}

function sourceSchedulerArchiveIdentity(document) {
  const identities = [
    document?.authoritativeTrace?.sharpRunDebug?.route?.receipt?.metadataPayload
      ?.schedulerTrace?.archiveIdentity,
    document?.sharpRunDebug?.route?.receipt?.metadataPayload?.schedulerTrace?.archiveIdentity,
  ].filter(Boolean);
  if (identities.length === 0) {
    throw new Error('SHARP scheduler byte transport requires a producer archive identity');
  }
  const identity = identities[0];
  if (identities.some(candidate => JSON.stringify(candidate) !== JSON.stringify(identity))) {
    throw new Error('SHARP scheduler producer archive identities are contradictory');
  }
  if (identity.schema !== 'sharp.webgpu.scheduler-event-archive-identity.v0'
    || identity.canonicalization !== 'json-stringify-rows-utf8-ndjson-v1'
    || identity.encoding !== 'utf-8'
    || !Number.isSafeInteger(identity.eventCount)
    || !Number.isSafeInteger(identity.bytes)
    || identity.bytes <= 0
    || !/^[0-9a-f]{64}$/.test(identity.sha256 || '')) {
    throw new Error('SHARP scheduler producer archive identity is invalid');
  }
  return identity;
}

function utf8Base64(value) {
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('base64 encoding is unavailable for SHARP scheduler byte transport');
  }
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

function completeReportReceipt(receipt, document, pipelineId) {
  return {
    ...receipt,
    document: {
      ...document,
      pipelineId: document.pipelineId || pipelineId,
      outputRoot: receipt.outputRoot,
      reportPath: receipt.path,
      writtenAt: receipt.writtenAt || null,
      traceArtifacts: receipt.traceArtifacts || {},
    },
  };
}

function compactRunDebug(
  runDebug,
  basePointer,
  externalize,
  archiveEvents = null,
  schedulerTelemetryArchive = null,
) {
  const compact = { ...runDebug };
  replaceArray(compact, runDebug, 'progressEvents', 'progress-events', `${basePointer}/progressEvents`, externalize);

  if (isRecord(runDebug.schedulerTelemetry)) {
    const telemetry = { ...runDebug.schedulerTelemetry };
    const telemetryPointer = `${basePointer}/schedulerTelemetry`;
    const eventTrace = isRecord(runDebug.schedulerTelemetry.eventTrace)
      ? { ...runDebug.schedulerTelemetry.eventTrace }
      : null;
    const eventTraceEvents = runDebug.schedulerTelemetry.eventTrace?.events;
    const compatibilityEvents = runDebug.schedulerTelemetry.events;
    for (const inlineEvents of [eventTraceEvents, compatibilityEvents]) {
      if (archiveEvents && Array.isArray(inlineEvents) && inlineEvents !== archiveEvents) {
        throw new Error('SHARP sealed archive must retain the exact scheduler telemetry source array');
      }
    }
    const eventValues = archiveEvents
      || (Array.isArray(eventTraceEvents) ? eventTraceEvents : compatibilityEvents);
    const eventRef = externalize(
      'scheduler-events',
      `${telemetryPointer}/eventTrace/events`,
      eventValues,
    );
    if (Array.isArray(eventValues)) {
      telemetry.eventSummary = summarizeSchedulerEvents(eventValues);
    }
    if (schedulerTelemetryArchive) {
      telemetry.eventArchive = {
        schema: 'sharp-webgpu.scheduler-event-archive-ref.v0',
        status: schedulerTelemetryArchive.status,
        retention: schedulerTelemetryArchive.retention,
        runId: schedulerTelemetryArchive.runId || null,
        clockId: schedulerTelemetryArchive.clockId || null,
        eventCount: schedulerTelemetryArchive.eventCount,
        traceArtifactRef: '#/traceArtifacts/scheduler-events',
      };
    }
    if (eventTrace) {
      delete eventTrace.events;
      if (eventRef) eventTrace.eventsRef = eventRef;
      telemetry.eventTrace = eventTrace;
    }
    delete telemetry.events;
    if (eventRef) telemetry.eventsRef = eventRef;
    if (
      Array.isArray(compatibilityEvents)
      && Array.isArray(eventTraceEvents)
      && compatibilityEvents !== eventTraceEvents
    ) {
      telemetry.compatibilityEventsRef = externalize(
        'scheduler-compatibility-events',
        `${telemetryPointer}/events`,
        compatibilityEvents,
      );
    }

    compact.schedulerTelemetry = telemetry;
  }
  compactNestedArray(
    compact,
    runDebug,
    'schedulerApplication',
    'boundaries',
    'scheduler-application-boundaries',
    `${basePointer}/schedulerApplication/boundaries`,
    externalize,
  );
  compactNestedArray(
    compact,
    runDebug,
    'commandDutyReport',
    'submissions',
    'command-duty-submissions',
    `${basePointer}/commandDutyReport/submissions`,
    externalize,
  );
  compactNestedArray(
    compact,
    runDebug,
    'hostPhaseReport',
    'intervals',
    'host-phase-intervals',
    `${basePointer}/hostPhaseReport/intervals`,
    externalize,
  );
  compactNestedArray(
    compact,
    runDebug,
    'foregroundOpportunityReport',
    'receipts',
    'foreground-opportunity-receipts',
    `${basePointer}/foregroundOpportunityReport/receipts`,
    externalize,
  );
  compactNestedArray(
    compact,
    runDebug,
    'foregroundOpportunityReport',
    'services',
    'foreground-opportunity-services',
    `${basePointer}/foregroundOpportunityReport/services`,
    externalize,
  );
  return compact;
}

function schedulerTelemetryArchiveEvents(archive) {
  if (archive === null || archive === undefined) return null;
  if (!isRecord(archive)) {
    throw new TypeError('SHARP scheduler telemetry archive must be an object');
  }
  if (
    archive.schema !== 'sharp-webgpu.scheduler-event-archive.v0'
    || archive.status !== 'sealed'
    || archive.retention !== 'uncapped'
    || !Array.isArray(archive.events)
    || !Number.isSafeInteger(archive.eventCount)
    || archive.eventCount !== archive.events.length
  ) {
    throw new Error('SHARP scheduler telemetry archive is not a sealed uncapped exact-count archive');
  }
  return archive.events;
}

function compactBackgroundHeartbeat(heartbeat, basePointer, externalize) {
  const compact = { ...heartbeat };
  compactNestedArray(
    compact,
    heartbeat,
    'gpuDutyIntervals',
    'intervals',
    'gpu-duty-intervals',
    `${basePointer}/gpuDutyIntervals/intervals`,
    externalize,
  );
  replaceArray(
    compact,
    heartbeat,
    'worstFrameGaps',
    'foreground-frame-gaps',
    `${basePointer}/worstFrameGaps`,
    externalize,
  );
  if (Array.isArray(heartbeat.worstFrameGaps)) {
    compact.worstFrameGapSummary = summarizeWorstFrameGap(heartbeat.worstFrameGaps[0]);
  }
  if (isRecord(heartbeat.overlapReferenceSpace)) {
    compact.overlapReferenceSpace = {
      ...heartbeat.overlapReferenceSpace,
      eventSource: '#/traceArtifacts/scheduler-events',
      intervalSource: '#/traceArtifacts/gpu-duty-intervals',
    };
  }
  return compact;
}

function summarizeWorstFrameGap(gap) {
  if (!isRecord(gap)) return null;
  return {
    schema: 'kaminos.foreground-frame-gap-summary.v0',
    startMs: Number.isFinite(gap.startMs) ? gap.startMs : null,
    endMs: Number.isFinite(gap.endMs) ? gap.endMs : null,
    durationMs: Number.isFinite(gap.durationMs) ? gap.durationMs : null,
    overlapClassification: gap.overlapClassification || null,
    overlappedEventCount: Array.isArray(gap.overlappedEventRefs)
      ? gap.overlappedEventRefs.length
      : 0,
  };
}

function summarizeSchedulerEvents(events) {
  let firstTMs = null;
  let lastTMs = null;
  const spnFusionBlocks = [];
  const monodepthPhaseLabels = [];
  for (const event of events) {
    if (!isRecord(event)) continue;
    if (Number.isFinite(event.tMs)) {
      firstTMs = firstTMs === null ? event.tMs : Math.min(firstTMs, event.tMs);
      lastTMs = lastTMs === null ? event.tMs : Math.max(lastTMs, event.tMs);
    }

    const phaseText = [
      event.phase,
      event.boundary,
      event.stage,
      event.routePhase,
      event.kind,
    ].filter(Boolean).join(' ').toLowerCase();
    const block = event.details?.block || event.block || event.label || event.name || null;
    if (
      block
      && (phaseText.includes('spn-fusion') || SHARP_SPN_LOWRES_BLOCK_LABELS.has(block))
      && !spnFusionBlocks.includes(block)
    ) {
      spnFusionBlocks.push(block);
    }

    const boundary = event.boundary || event.phase || null;
    const label = (boundary === 'monodepth-phase' && SHARP_MONODEPTH_PHASE_LABELS.has(event.phase)
      ? event.phase
      : event.details?.phase)
      || event.details?.label
      || event.phaseLabel
      || event.label
      || event.name
      || null;
    if (
      label
      && (phaseText.includes('monodepth-phase') || SHARP_MONODEPTH_PHASE_LABELS.has(label))
      && !monodepthPhaseLabels.includes(label)
    ) {
      monodepthPhaseLabels.push(label);
    }
  }
  return {
    schema: 'kaminos.scheduler-event-summary.v0',
    count: events.length,
    firstTMs,
    lastTMs,
    spnFusionBlocks,
    monodepthPhaseLabels,
  };
}

function compactNestedArray(target, source, objectKey, arrayKey, id, jsonPointer, externalize) {
  if (!isRecord(source[objectKey])) return;
  const nested = isRecord(target[objectKey])
    ? { ...target[objectKey] }
    : { ...source[objectKey] };
  replaceArray(nested, source[objectKey], arrayKey, id, jsonPointer, externalize);
  target[objectKey] = nested;
}

function replaceArray(target, source, key, id, jsonPointer, externalize) {
  if (!Array.isArray(source[key])) return;
  const ref = externalize(id, jsonPointer, source[key]);
  delete target[key];
  target[`${key}Ref`] = ref;
}

async function postJson(fetchImpl, url, payload) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) {
    const failurePath = result.failureReportPath ? ` Failure report: ${result.failureReportPath}` : '';
    throw new Error(`${result.error || `SHARP inline report request failed: ${response.status}`}${failurePath}`);
  }
  return result;
}

function yieldBrowserTask() {
  return new Promise(resolve => {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeJsonPointer(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}
