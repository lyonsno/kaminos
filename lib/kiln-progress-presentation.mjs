const STAGE_WEIGHTED_PROJECTION = 'stage-weighted-work-projection';

function boundedProgress(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function phaseLabel(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().replace(/[-_]+/g, ' ');
}

function eventAgeLabel(event, nowMs) {
  const receivedAtMs = event?.receivedAtMs;
  if (!Number.isFinite(receivedAtMs) || !Number.isFinite(nowMs) || receivedAtMs < 0 || nowMs < receivedAtMs) {
    return 'update age unavailable';
  }
  const elapsedSeconds = Math.floor((nowMs - receivedAtMs) / 1000);
  if (elapsedSeconds < 1) return 'updated now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s since update`;
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}m ${seconds}s since update`;
}

export function kilnRouteBenchReceiveProgressEvent(event, receivedAtMs) {
  return {
    ...(event && typeof event === 'object' ? event : {}),
    receivedAtMs: Number.isFinite(receivedAtMs) && receivedAtMs >= 0 ? receivedAtMs : null,
  };
}

export function kilnRouteBenchProgressPresentation(event, nowMs) {
  const progress = boundedProgress(event?.progress);
  const percent = progress === null ? null : Math.round(progress * 100);
  const projected = event?.progressAuthority === STAGE_WEIGHTED_PROJECTION;
  const parts = [
    percent === null ? 'Progress unavailable' : `${percent}% ${projected ? 'projected' : 'progress'}`,
    phaseLabel(event?.phase),
    Number.isSafeInteger(event?.workOrdinal) && event.workOrdinal >= 0 ? `work ${event.workOrdinal}` : null,
    eventAgeLabel(event, nowMs),
  ].filter(Boolean);
  return {
    fillPercent: progress === null ? null : progress * 100,
    label: parts.join(' | '),
    percent,
    projected,
  };
}
