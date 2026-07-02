export const SCHEDULER_VERIFICATION_RECEIPT_SCHEMA = 'kaminos.webgpu-scheduler-verification-receipt.v0';
export const SCHEDULER_EVENT_TRACE_SCHEMA = 'kaminos.webgpu-scheduler-event-trace.v0';

const PHASE_FIELD_ALIASES = {
  spnPatch: ['phaseChunkSize.spnPatch', 'spnPatchChunkSize'],
  vitBlock: ['phaseChunkSize.vitBlock', 'vitBlockChunkSize'],
};

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function phaseValue(scheduler = {}, key) {
  const phaseChunkSize = asObject(scheduler.phaseChunkSize);
  if (Number.isFinite(phaseChunkSize[key])) return phaseChunkSize[key];
  const directKey = key === 'spnPatch' ? 'spnPatchChunkSize' : 'vitBlockChunkSize';
  return Number.isFinite(scheduler[directKey]) ? scheduler[directKey] : undefined;
}

function requestedPhaseFields(requestedScheduler = {}) {
  return Object.keys(PHASE_FIELD_ALIASES)
    .map(key => {
      const value = phaseValue(requestedScheduler, key);
      return Number.isFinite(value) && value > 0 ? { key, value } : null;
    })
    .filter(Boolean);
}

function unsupportedFieldsFrom(input = {}) {
  const scheduler = asObject(input.scheduler);
  const effectiveScheduler = asObject(scheduler.effectiveScheduler);
  return uniq([
    ...(Array.isArray(input.unsupportedFields) ? input.unsupportedFields : []),
    ...(Array.isArray(scheduler.unsupportedFields) ? scheduler.unsupportedFields : []),
    ...(Array.isArray(effectiveScheduler.unsupportedFields) ? effectiveScheduler.unsupportedFields : []),
  ]);
}

function unsupportedCovers(fieldKey, unsupportedFields = []) {
  const aliases = PHASE_FIELD_ALIASES[fieldKey] || [];
  return unsupportedFields.some(field => aliases.includes(field) || field === 'phaseChunkSize');
}

function eventKindCounts(events = []) {
  return {
    eventCount: events.length,
    queueStartCount: events.filter(event => event?.kind === 'queue-work-done-start').length,
    queueEndCount: events.filter(event => event?.kind === 'queue-work-done-end').length,
    yieldStartCount: events.filter(event => event?.kind === 'js-yield-start').length,
    yieldEndCount: events.filter(event => event?.kind === 'js-yield-end').length,
    chunkCount: events.filter(event => event?.kind === 'chunk-start' || event?.boundary || event?.phase).length,
  };
}

function normalizeEventTrace(eventTrace = {}) {
  const events = Array.isArray(eventTrace.events) ? cloneJson(eventTrace.events) : [];
  return {
    schema: eventTrace.schema || SCHEDULER_EVENT_TRACE_SCHEMA,
    clock: eventTrace.clock || 'performance.now',
    timingAuthority: eventTrace.timingAuthority || 'not-observed',
    events,
  };
}

function normalizeFrameTail(frameTail = {}, eventTrace = {}) {
  const evidenceSource = eventTrace.timingAuthority === 'raf-and-queue-proxy'
    ? 'raf-and-queue-proxy'
    : (frameTail.evidenceSource || eventTrace.timingAuthority || 'not-observed');
  return {
    evidenceSource,
    disclaimer: frameTail.disclaimer || 'not-gpu-exclusive-or-present-latency',
    rafFps: frameTail.rafFps ?? null,
    frameP95Ms: frameTail.frameP95Ms ?? null,
    queueDoneP95Ms: frameTail.queueDoneP95Ms ?? null,
  };
}

function deriveBoundaryAssertions({
  boundaryAssertions,
  requestedScheduler,
  effectiveScheduler,
  unsupportedFields,
  events,
}) {
  if (Array.isArray(boundaryAssertions) && boundaryAssertions.length) return cloneJson(boundaryAssertions);
  const counts = eventKindCounts(events);
  return requestedPhaseFields(requestedScheduler).map(({ key, value }) => {
    const effective = phaseValue(effectiveScheduler, key);
    const unsupported = unsupportedCovers(key, unsupportedFields);
    const observedBoundary = key === 'spnPatch' ? 'spn-patch-chunk' : 'vit-block-chunk';
    const observedCount = events.filter(event => event?.boundary === observedBoundary || event?.phase === observedBoundary).length;
    return {
      field: PHASE_FIELD_ALIASES[key][0],
      requested: value,
      effective: Number.isFinite(effective) ? effective : null,
      status: unsupported ? 'unsupported' : (observedCount > 0 ? 'verified' : 'unverified'),
      observedBoundary,
      observedCount,
      expectedMinimumCount: 1,
      observedQueueWaitCount: Math.min(counts.queueStartCount, counts.queueEndCount),
      observedYieldCount: Math.min(counts.yieldStartCount, counts.yieldEndCount),
      unsupportedReason: unsupported ? 'effective scheduler declared this field unsupported' : null,
    };
  });
}

function routeIsPresent(route = {}) {
  return Boolean(route.pipelineId || route.requestedRouteId || route.effectiveRouteId || route.adapterReport?.path);
}

function waitRequested(scheduler = {}) {
  return Boolean(scheduler.waitForSubmittedWorkDone);
}

function yieldRequested(scheduler = {}) {
  return Number(scheduler.yieldMs || 0) > 0 || Number(scheduler.gaussianPhaseYieldMs || 0) > 0;
}

function droppedRequestedFields(requestedScheduler = {}, effectiveScheduler = {}, unsupportedFields = []) {
  return requestedPhaseFields(requestedScheduler)
    .filter(({ key }) => !Number.isFinite(phaseValue(effectiveScheduler, key)) && !unsupportedCovers(key, unsupportedFields))
    .map(({ key }) => PHASE_FIELD_ALIASES[key][0]);
}

function normalizeDowngrades(values) {
  return uniq(values);
}

export function createSchedulerVerificationReceipt(input = {}) {
  const route = cloneJson(asObject(input.route));
  const scheduler = cloneJson(asObject(input.scheduler));
  const backpressure = cloneJson(asObject(input.backpressure));
  const requestedScheduler = asObject(scheduler.requestedScheduler);
  const effectiveScheduler = asObject(scheduler.effectiveScheduler);
  const unsupportedFields = unsupportedFieldsFrom({ ...input, scheduler });
  const eventTrace = normalizeEventTrace(input.eventTrace);
  const frameTail = normalizeFrameTail(input.frameTail || {}, eventTrace);
  const events = eventTrace.events;
  const counts = eventKindCounts(events);
  const boundaryAssertions = deriveBoundaryAssertions({
    boundaryAssertions: input.boundaryAssertions,
    requestedScheduler,
    effectiveScheduler,
    unsupportedFields,
    events,
  });
  const downgrades = Array.isArray(input.downgrades) ? [...input.downgrades] : [];
  const falseAuthorityChecks = {
    eventTraceMissing: false,
    verifiedWithoutObservedBoundary: false,
    timingProxyOnly: false,
    queueWaitEventsMissing: false,
    requestedFieldDroppedWithoutUnsupported: false,
    ...(asObject(input.falseAuthorityChecks)),
  };

  if (!routeIsPresent(route)) downgrades.push('route-identity-missing');
  if (!scheduler.schema && !scheduler.requestedScheduler && !scheduler.effectiveScheduler) downgrades.push('scheduler-envelope-missing');
  if (!backpressure.schema && Object.keys(backpressure).length === 0) downgrades.push('backpressure-envelope-missing');

  const droppedFields = droppedRequestedFields(requestedScheduler, effectiveScheduler, unsupportedFields);
  if (droppedFields.length) {
    downgrades.push('requested-field-dropped-without-unsupported');
    falseAuthorityChecks.requestedFieldDroppedWithoutUnsupported = true;
  }

  if (!events.length) {
    downgrades.push('event-trace-missing');
    falseAuthorityChecks.eventTraceMissing = true;
  }

  const verifiedAssertions = boundaryAssertions.filter(assertion => assertion?.status === 'verified');
  if (scheduler.verificationState === 'verified' && !verifiedAssertions.length) {
    downgrades.push('boundary-assertions-missing');
    falseAuthorityChecks.verifiedWithoutObservedBoundary = true;
  }

  if (eventTrace.timingAuthority === 'raf-and-queue-proxy') {
    downgrades.push('timing-proxy-only');
    falseAuthorityChecks.timingProxyOnly = true;
  }

  if (waitRequested(requestedScheduler) || waitRequested(effectiveScheduler)) {
    const hasQueuePair = counts.queueStartCount > 0 && counts.queueEndCount > 0;
    if (!hasQueuePair) {
      downgrades.push('queue-wait-events-missing');
      falseAuthorityChecks.queueWaitEventsMissing = true;
    }
  }

  if (yieldRequested(requestedScheduler) || yieldRequested(effectiveScheduler)) {
    const hasYieldPair = counts.yieldStartCount > 0 && counts.yieldEndCount > 0;
    if (!hasYieldPair) downgrades.push('yield-events-missing');
  }

  const invalid = droppedFields.length > 0 || !routeIsPresent(route);
  const unsupported = unsupportedFields.length > 0 || boundaryAssertions.some(assertion => assertion?.status === 'unsupported');
  const verified = events.length > 0
    && verifiedAssertions.length > 0
    && !falseAuthorityChecks.timingProxyOnly
    && !falseAuthorityChecks.queueWaitEventsMissing
    && !falseAuthorityChecks.requestedFieldDroppedWithoutUnsupported
    && !downgrades.includes('yield-events-missing');

  let status = input.status || 'scheduler-unverified';
  if (invalid) status = 'invalid';
  else if (unsupported) status = 'unsupported';
  else if (verified) status = 'verified';
  else status = 'scheduler-unverified';

  const classification = status === 'verified'
    ? 'observed-boundary'
    : (status === 'unsupported'
        ? 'unsupported'
        : (status === 'invalid'
            ? 'invalid'
            : (falseAuthorityChecks.timingProxyOnly ? 'damage-only' : 'config-only')));

  return {
    schema: SCHEDULER_VERIFICATION_RECEIPT_SCHEMA,
    status,
    classification,
    route,
    scheduler: {
      ...scheduler,
      unsupportedFields,
    },
    backpressure,
    eventTrace,
    boundaryAssertions,
    frameTail,
    downgrades: normalizeDowngrades(downgrades),
    falseAuthorityChecks,
  };
}

export function validateSchedulerVerificationReceipt(receipt = {}) {
  const errors = [];
  if (receipt.schema !== SCHEDULER_VERIFICATION_RECEIPT_SCHEMA) errors.push('schema-mismatch');
  if (!routeIsPresent(receipt.route || {})) errors.push('route-identity-missing');
  if (!receipt.scheduler || typeof receipt.scheduler !== 'object') errors.push('scheduler-envelope-missing');
  if (!receipt.backpressure || typeof receipt.backpressure !== 'object') errors.push('backpressure-envelope-missing');
  if (receipt.status === 'verified') {
    if (!Array.isArray(receipt.eventTrace?.events) || !receipt.eventTrace.events.length) errors.push('verified-without-event-trace');
    if (!Array.isArray(receipt.boundaryAssertions) || !receipt.boundaryAssertions.some(assertion => assertion?.status === 'verified')) {
      errors.push('verified-without-boundary-assertion');
    }
    if (receipt.falseAuthorityChecks?.timingProxyOnly) errors.push('verified-from-proxy-timing');
    if (receipt.falseAuthorityChecks?.queueWaitEventsMissing) errors.push('verified-without-queue-wait-events');
    if (receipt.falseAuthorityChecks?.requestedFieldDroppedWithoutUnsupported) errors.push('verified-with-dropped-requested-field');
  }
  if (receipt.status === 'invalid') errors.push('receipt-invalid');
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function classifySchedulerVerificationReceipt(receipt = {}) {
  return {
    status: receipt.status || 'unknown',
    classification: receipt.classification || 'unknown',
    downgrades: Array.isArray(receipt.downgrades) ? receipt.downgrades : [],
  };
}
