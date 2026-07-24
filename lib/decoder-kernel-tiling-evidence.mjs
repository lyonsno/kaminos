export function decoderKernelTileEventsFromSchedulerEvents(events = []) {
  return events
    .filter(event => (event?.boundary === 'monodepth-phase' || event?.boundary === 'gaussian-phase')
      && ((event?.kind === 'chunk-start' && event?.role === 'decoder-kernel-output-tile')
        || (event?.kind === 'decoder-kernel-range-observed'
          && (String(event?.role || '').endsWith('-observation')
            || String(event?.role || '').endsWith('-failed')))))
    .map(event => ({ ...event }));
}

function adaptivePlannerId(event) {
  if (typeof event?.rangeId !== 'string' || !Number.isSafeInteger(event?.rangeIndex) || event.rangeIndex < 0) {
    return null;
  }
  const suffix = `:${event.rangeIndex}`;
  return event.rangeId.endsWith(suffix) ? event.rangeId.slice(0, -suffix.length) : null;
}

function completeAdaptiveDecoderGroup(group, maxChunkItems) {
  const ordered = [...group].sort((a, b) => a.rangeIndex - b.rangeIndex);
  const terminal = ordered.find(event => Number.isSafeInteger(event.actualRangeCount) && event.actualRangeCount > 0);
  if (!terminal || terminal !== ordered.at(-1) || terminal.actualRangeCount !== ordered.length) return null;
  const first = ordered[0];
  let cursor = 0;
  for (let rangeIndex = 0; rangeIndex < ordered.length; rangeIndex += 1) {
    const event = ordered[rangeIndex];
    if (event.rangeIndex !== rangeIndex
      || event.boundary !== first.boundary
      || event.phase !== first.phase
      || event.totalOutputItems !== first.totalOutputItems
      || event.outputStart !== cursor
      || !Number.isSafeInteger(event.outputCount)
      || event.outputCount <= 0
      || event.outputCount > maxChunkItems
      || event.outputEnd !== event.outputStart + event.outputCount
      || event.outputEnd > event.totalOutputItems) return null;
    cursor = event.outputEnd;
  }
  if (cursor !== first.totalOutputItems) return null;
  return {
    boundary: first.boundary,
    phase: first.phase,
    tileTotal: ordered.length,
    totalOutputItems: first.totalOutputItems,
  };
}

function completeDecoderKernelGroup(group, expectedChunkItems) {
  const ordered = [...group].sort((a, b) => a.tileIndex - b.tileIndex);
  const first = ordered[0];
  const tileTotal = first?.tileTotal;
  const totalOutputItems = first?.totalOutputItems;
  if (ordered.length !== tileTotal || tileTotal < 2) return null;
  let cursor = 0;
  for (let tileIndex = 0; tileIndex < ordered.length; tileIndex += 1) {
    const event = ordered[tileIndex];
    if (event.tileIndex !== tileIndex
      || event.tileTotal !== tileTotal
      || event.totalOutputItems !== totalOutputItems
      || event.outputStart !== cursor
      || event.outputEnd - event.outputStart !== event.outputCount
      || event.outputCount > expectedChunkItems) return null;
    cursor = event.outputEnd;
  }
  if (cursor !== totalOutputItems) return null;
  return {
    boundary: first.boundary,
    phase: first.phase,
    tileTotal,
    totalOutputItems,
  };
}

export function validateDecoderKernelTileEvidence({
  expectedChunkItems,
  expectedAdaptivePolicy = null,
  boundaryAssertions = [],
  tileEvents = [],
} = {}) {
  if (!Number.isInteger(expectedChunkItems) || expectedChunkItems <= 0) return [];
  const failures = [];
  const assertion = boundaryAssertions.find(candidate => candidate?.field === 'decoderKernelChunkItems');
  const observedKernel = assertion?.observedKernel;
  const observedKernelIdentityValid = (observedKernel?.boundary === 'monodepth-phase'
      || observedKernel?.boundary === 'gaussian-phase')
    && typeof observedKernel.phase === 'string'
    && observedKernel.phase.length > 0
    && Number.isInteger(observedKernel.tileTotal)
    && observedKernel.tileTotal > 1
    && Number.isInteger(observedKernel.totalOutputItems)
    && observedKernel.totalOutputItems > 0
    && assertion?.observedBoundary === observedKernel.boundary
    && assertion?.observedCount === observedKernel.tileTotal;
  if (!assertion) {
    failures.push('boundary-assertion-missing');
  } else {
    if (assertion.status !== 'verified') failures.push('boundary-assertion-unverified');
    if (assertion.requested !== expectedChunkItems || assertion.effective !== expectedChunkItems) {
      failures.push('boundary-assertion-config-mismatch');
    }
    if (!Number.isInteger(assertion.observedCount) || assertion.observedCount < 2
      || !Number.isInteger(assertion.observedKernel?.tileTotal) || assertion.observedKernel.tileTotal < 2) {
      failures.push('boundary-assertion-multi-range-count-missing');
    }
    if (!observedKernelIdentityValid) failures.push('assertion-event-mismatch');
  }

  const adaptive = Boolean(expectedAdaptivePolicy?.targetDurationMs > 0 || assertion?.adaptive);
  if (adaptive) {
    if (!assertion?.adaptive
      || assertion.adaptiveTargetDurationMs !== expectedAdaptivePolicy?.targetDurationMs
      || assertion.adaptiveMinChunkItems !== expectedAdaptivePolicy?.minChunkItems
      || assertion.adaptiveMaxChunkItems !== expectedAdaptivePolicy?.maxChunkItems) {
      failures.push('adaptive-policy-mismatch');
    }
    const adaptiveEvents = tileEvents.filter(event => (
      event?.kind === 'decoder-kernel-range-observed'
      && adaptivePlannerId(event)
    ));
    const failedEvents = adaptiveEvents.filter(event => String(event?.role || '').endsWith('-failed'));
    const events = adaptiveEvents.filter(event => String(event?.role || '').endsWith('-observation'));
    if (failedEvents.length) failures.push('adaptive-range-failure-observed');
    if (events.length < 2) {
      failures.push('multi-range-events-missing');
      return [...new Set(failures)];
    }
    if (!events.some(event => Number.isSafeInteger(event.actualRangeCount) && event.actualRangeCount > 0)) {
      failures.push('adaptive-terminal-count-missing');
    }
    if (events.some(event => event.timingAuthority !== 'queue-work-done'
      || event.queueWorkAttribution !== 'submitted-range-plus-shared-queue-work'
      || !Number.isFinite(event.observedDurationMs)
      || event.observedDurationMs < 0)) {
      failures.push('adaptive-timing-authority-invalid');
    }
    const expectedAdjustmentGain = expectedAdaptivePolicy?.adjustmentGain;
    if (!Number.isFinite(expectedAdjustmentGain)
      || expectedAdjustmentGain <= 0
      || expectedAdjustmentGain > 1) {
      failures.push('adaptive-policy-mismatch');
    } else {
      if (events.some(event => !Object.hasOwn(event, 'requestedAdjustmentGain')
        || !Object.hasOwn(event, 'effectiveAdjustmentGain')
        || !Number.isFinite(event.requestedAdjustmentGain)
        || !Number.isFinite(event.effectiveAdjustmentGain))) {
        failures.push('adaptive-adjustment-gain-missing');
      }
      if (events.some(event => Number.isFinite(event.requestedAdjustmentGain)
        && Number.isFinite(event.effectiveAdjustmentGain)
        && (event.requestedAdjustmentGain !== expectedAdjustmentGain
          || event.effectiveAdjustmentGain !== expectedAdjustmentGain))) {
        failures.push('adaptive-adjustment-gain-mismatch');
      }
    }
    const groups = new Map();
    for (const event of events) {
      const plannerId = adaptivePlannerId(event);
      if (!groups.has(plannerId)) groups.set(plannerId, []);
      groups.get(plannerId).push(event);
    }
    const completeGroups = [...groups.values()]
      .map(group => completeAdaptiveDecoderGroup(group, expectedAdaptivePolicy?.maxChunkItems))
      .filter(Boolean);
    if (!completeGroups.length) {
      failures.push('range-coverage-invalid');
    } else if (!observedKernelIdentityValid || !completeGroups.some(group => (
      group.boundary === observedKernel.boundary
      && group.phase === observedKernel.phase
      && group.tileTotal === observedKernel.tileTotal
      && group.totalOutputItems === observedKernel.totalOutputItems
    ))) {
      failures.push('assertion-event-mismatch');
    }
    return [...new Set(failures)];
  }

  const events = tileEvents.filter(event =>
    (event?.boundary === 'monodepth-phase' || event?.boundary === 'gaussian-phase')
    && event?.role === 'decoder-kernel-output-tile'
    && event.configuredChunkItems === expectedChunkItems
    && Number.isInteger(event.tileIndex)
    && Number.isInteger(event.tileTotal)
    && event.tileTotal > 1
    && Number.isInteger(event.outputStart)
    && Number.isInteger(event.outputEnd)
    && Number.isInteger(event.outputCount)
    && Number.isInteger(event.totalOutputItems)
  );
  if (events.length < 2) {
    failures.push('multi-range-events-missing');
    return [...new Set(failures)];
  }

  const groups = new Map();
  for (const event of events) {
    const key = `${event.boundary}\u0000${event.phase}\u0000${event.tileTotal}\u0000${event.totalOutputItems}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  const completeGroups = [...groups.values()]
    .map(group => completeDecoderKernelGroup(group, expectedChunkItems))
    .filter(Boolean);
  if (!completeGroups.length) {
    failures.push('range-coverage-invalid');
  } else if (!observedKernelIdentityValid || !completeGroups.some(group => (
    group.boundary === observedKernel.boundary
    && group.phase === observedKernel.phase
    && group.tileTotal === observedKernel.tileTotal
    && group.totalOutputItems === observedKernel.totalOutputItems
  ))) {
    failures.push('assertion-event-mismatch');
  }
  return [...new Set(failures)];
}
