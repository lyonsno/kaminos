// Frame-pacing statistics for a live scene sharing the GPU with inference.
// gaps: completed-frame intervals in ms. budgetMs: the display frame period.
// - budget.over60Hz / over30Hz: gaps over one / two periods (raw, jitter-sensitive)
// - budget.missedFrames: sum over gaps of round(gap / period) - 1 (dropped vsyncs)
// - budget.framesMissingVsync: gaps that dropped at least one vsync
// - hitches: clearly visible stalls (> 50 ms, > 100 ms)
// - nearWorst: gaps at >= 80% of the worst gap
// - histogram: counts per bucket (upToMs inclusive; null = above the last edge)
export const FRAME_BUCKETS_MS = Object.freeze([17, 20, 25, 34, 50, 75, 100, 150, 250, 500, 1000]);

export function frameStats(gaps, { budgetMs = 1000 / 60 } = {}) {
  if (!gaps?.length) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const max = sorted.at(-1);
  const missed = gaps.map(gap => Math.max(0, Math.round(gap / budgetMs) - 1));
  const histogram = [...FRAME_BUCKETS_MS, null].map((upToMs, index) => {
    const low = index ? FRAME_BUCKETS_MS[index - 1] : -Infinity;
    return { upToMs, count: gaps.filter(gap => gap > low && (upToMs === null || gap <= upToMs)).length };
  });
  return {
    frames: gaps.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), p999: at(0.999), max,
    over33ms: gaps.filter(gap => gap > 33.3).length, over100ms: gaps.filter(gap => gap > 100).length,
    budget: { periodMs: budgetMs, over60Hz: gaps.filter(gap => gap > budgetMs).length,
      over30Hz: gaps.filter(gap => gap > 2 * budgetMs).length,
      missedFrames: missed.reduce((sum, value) => sum + value, 0), framesMissingVsync: missed.filter(value => value > 0).length },
    hitches: { over50ms: gaps.filter(gap => gap > 50).length, over100ms: gaps.filter(gap => gap > 100).length },
    nearWorst: { fraction: 0.8, count: gaps.filter(gap => gap >= 0.8 * max).length },
    histogram,
  };
}
