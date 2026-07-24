function finiteBound(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function normalizeGap(gap, index) {
  const startMs = finiteBound(gap?.startMs, `gap ${index} start bound`);
  const endMs = finiteBound(gap?.endMs, `gap ${index} end bound`);
  if (endMs <= startMs) throw new Error(`gap ${index} has inverted bounds`);
  return { startMs, endMs, inputIndex: index };
}

function normalizeCandidate(entry, index) {
  const value = entry?.value;
  if (!value || typeof value !== 'object') throw new Error(`candidate ${index} must have finite bounds`);
  const hasIntervalBound = 'intervalStartMs' in value || 'intervalEndMs' in value;
  const hasGenericBound = 'startMs' in value || 'endMs' in value;
  if (hasIntervalBound) {
    const startMs = finiteBound(value.intervalStartMs, `candidate ${index} start bound`);
    const endMs = finiteBound(value.intervalEndMs, `candidate ${index} end bound`);
    if (endMs < startMs) throw new Error(`candidate ${index} has inverted bounds`);
    return { ...entry, startMs, endMs, point: false, inputIndex: index };
  }
  if (hasGenericBound) {
    const startMs = finiteBound(value.startMs, `candidate ${index} start bound`);
    const endMs = finiteBound(value.endMs, `candidate ${index} end bound`);
    if (endMs < startMs) throw new Error(`candidate ${index} has inverted bounds`);
    return { ...entry, startMs, endMs, point: false, inputIndex: index };
  }
  const tMs = finiteBound(value.tMs, `candidate ${index} point bound`);
  return { ...entry, startMs: tMs, endMs: tMs, point: true, inputIndex: index };
}

export function indexSharpForegroundGapOverlaps({ gaps = [], candidates = [] } = {}) {
  const normalizedGaps = gaps.map(normalizeGap).sort((left, right) => (
    left.startMs - right.startMs
    || left.endMs - right.endMs
    || left.inputIndex - right.inputIndex
  ));
  const normalizedCandidates = candidates.map(normalizeCandidate).sort((left, right) => (
    left.startMs - right.startMs
    || left.sourceOrder - right.sourceOrder
    || left.inputIndex - right.inputIndex
  ));
  const overlapsByGap = Array.from({ length: normalizedGaps.length }, () => []);
  let candidateIndex = 0;
  let active = [];
  let overlapCheckCount = 0;
  let admittedCandidateCount = 0;
  let retiredCandidateCount = 0;
  for (const gap of normalizedGaps) {
    while (
      candidateIndex < normalizedCandidates.length
      && normalizedCandidates[candidateIndex].startMs <= gap.endMs
    ) {
      active.push(normalizedCandidates[candidateIndex]);
      candidateIndex += 1;
      admittedCandidateCount += 1;
    }
    const retained = [];
    const overlaps = [];
    for (const candidate of active) {
      const retired = candidate.point
        ? candidate.endMs < gap.startMs
        : candidate.endMs <= gap.startMs;
      if (retired) {
        retiredCandidateCount += 1;
        continue;
      }
      retained.push(candidate);
      overlapCheckCount += 1;
      const overlapsGap = candidate.point
        ? candidate.startMs >= gap.startMs && candidate.startMs <= gap.endMs
        : candidate.endMs > gap.startMs && candidate.startMs < gap.endMs;
      if (overlapsGap) overlaps.push(candidate);
    }
    active = retained;
    overlaps.sort((left, right) => (
      left.sourceOrder - right.sourceOrder
      || left.inputIndex - right.inputIndex
    ));
    overlapsByGap[gap.inputIndex] = overlaps.map(candidate => candidate.ref);
  }
  return {
    overlapsByGap,
    stats: {
      gapCount: normalizedGaps.length,
      candidateCount: normalizedCandidates.length,
      overlapCheckCount,
      admittedCandidateCount,
      retiredCandidateCount,
      remainingCandidateCount: normalizedCandidates.length - candidateIndex,
      activeCandidateCount: active.length,
    },
  };
}
