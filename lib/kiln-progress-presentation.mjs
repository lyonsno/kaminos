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

function boundedOrdinalLabel(index, total, noun) {
  if (!Number.isSafeInteger(index) || index < 0
    || !Number.isSafeInteger(total) || total <= 0 || index >= total) return null;
  return `${noun} ${index + 1}/${total}`;
}

function exactWorkLabel(exactWork) {
  const completed = exactWork?.completed;
  const total = exactWork?.total;
  if (!Number.isSafeInteger(completed) || completed < 0
    || !Number.isSafeInteger(total) || total <= 0 || completed > total) return null;
  const unit = phaseLabel(exactWork?.unit);
  const unitLabel = unit ? ` ${unit}${total === 1 ? '' : 's'}` : '';
  return `${completed}/${total}${unitLabel}`;
}

function denominatorBearingWorkLabel(event) {
  const work = event?.work || {};
  return boundedOrdinalLabel(work.tileIndex, work.tileTotal, 'tile')
    || boundedOrdinalLabel(work.outputChunkIndex, work.outputChunkCount, 'chunk')
    || exactWorkLabel(event?.exactWork);
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
    denominatorBearingWorkLabel(event),
    eventAgeLabel(event, nowMs),
  ].filter(Boolean);
  return {
    fillPercent: progress === null ? null : progress * 100,
    label: parts.join(' | '),
    percent,
    projected,
  };
}
