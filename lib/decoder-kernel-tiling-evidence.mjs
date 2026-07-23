export function decoderKernelTileEventsFromSchedulerEvents(events = []) {
  return events
    .filter(event => event?.kind === 'chunk-start'
      && (event?.boundary === 'monodepth-phase' || event?.boundary === 'gaussian-phase')
      && event?.role === 'decoder-kernel-output-tile')
    .map(event => ({
      phase: event.phase,
      boundary: event.boundary,
      role: event.role,
      configuredChunkItems: event.configuredChunkItems,
      tileIndex: event.tileIndex,
      tileTotal: event.tileTotal,
      outputStart: event.outputStart,
      outputEnd: event.outputEnd,
      outputCount: event.outputCount,
      totalOutputItems: event.totalOutputItems,
    }));
}

export function validateDecoderKernelTileEvidence({
  expectedChunkItems,
  boundaryAssertions = [],
  tileEvents = [],
} = {}) {
  if (!Number.isInteger(expectedChunkItems) || expectedChunkItems <= 0) return [];
  const failures = [];
  const assertion = boundaryAssertions.find(candidate => candidate?.field === 'decoderKernelChunkItems');
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
  const completeGroup = [...groups.values()].some(group => {
    const ordered = [...group].sort((a, b) => a.tileIndex - b.tileIndex);
    const tileTotal = ordered[0]?.tileTotal;
    const totalOutputItems = ordered[0]?.totalOutputItems;
    if (ordered.length !== tileTotal || tileTotal < 2) return false;
    let cursor = 0;
    for (let tileIndex = 0; tileIndex < ordered.length; tileIndex += 1) {
      const event = ordered[tileIndex];
      if (event.tileIndex !== tileIndex
        || event.tileTotal !== tileTotal
        || event.totalOutputItems !== totalOutputItems
        || event.outputStart !== cursor
        || event.outputEnd - event.outputStart !== event.outputCount
        || event.outputCount > expectedChunkItems) return false;
      cursor = event.outputEnd;
    }
    return cursor === totalOutputItems;
  });
  if (!completeGroup) failures.push('range-coverage-invalid');
  return [...new Set(failures)];
}
