import assert from 'node:assert/strict';
import { indexSharpForegroundGapOverlaps } from '../lib/sharp-foreground-gap-index.mjs';

function cartesianOracle(gaps, candidates) {
  return gaps.map(gap => candidates
    .filter(({ value }) => {
      if (Number.isFinite(value.intervalStartMs) && Number.isFinite(value.intervalEndMs)) {
        return value.intervalEndMs > gap.startMs && value.intervalStartMs < gap.endMs;
      }
      if (Number.isFinite(value.startMs) && Number.isFinite(value.endMs)) {
        return value.endMs > gap.startMs && value.startMs < gap.endMs;
      }
      return Number.isFinite(value.tMs) && value.tMs >= gap.startMs && value.tMs <= gap.endMs;
    })
    .sort((left, right) => left.sourceOrder - right.sourceOrder)
    .map(({ ref }) => ref));
}

const gaps = [
  { startMs: 0, endMs: 10 },
  { startMs: 10, endMs: 20 },
  { startMs: 20, endMs: 30 },
];
const candidates = [
  { ref: 'event:late', sourceOrder: 4, value: { tMs: 25 } },
  { ref: 'interval:touching', sourceOrder: 1, value: { intervalStartMs: 10, intervalEndMs: 20 } },
  { ref: 'event:boundary', sourceOrder: 0, value: { tMs: 10 } },
  { ref: 'event:duplicate', sourceOrder: 2, value: { tMs: 15 } },
  { ref: 'event:duplicate', sourceOrder: 3, value: { tMs: 15 } },
];
const indexed = indexSharpForegroundGapOverlaps({ gaps, candidates });
assert.deepEqual(
  indexed.overlapsByGap,
  cartesianOracle(gaps, candidates),
  'indexed overlap must preserve Cartesian interval, touching, point, duplicate-ref, and source-order behavior',
);

for (const malformed of [
  { ref: 'bad:nan', sourceOrder: 0, value: { tMs: Number.NaN } },
  { ref: 'bad:partial', sourceOrder: 0, value: { startMs: 1 } },
  { ref: 'bad:inverted', sourceOrder: 0, value: { intervalStartMs: 2, intervalEndMs: 1 } },
]) {
  assert.throws(
    () => indexSharpForegroundGapOverlaps({ gaps, candidates: [malformed] }),
    /finite|bound|inverted/i,
    `malformed candidate ${malformed.ref} must fail loud`,
  );
}
assert.throws(
  () => indexSharpForegroundGapOverlaps({
    gaps: [{ startMs: 5, endMs: 4 }],
    candidates: [],
  }),
  /gap.*inverted|gap.*bound/i,
  'malformed foreground gaps must fail loud',
);

const probeGapCount = 200;
const probeCandidateCount = 1_200;
const probe = indexSharpForegroundGapOverlaps({
  gaps: Array.from({ length: probeGapCount }, (_, index) => ({
    startMs: index * 10,
    endMs: (index + 1) * 10,
  })),
  candidates: Array.from({ length: probeCandidateCount }, (_, index) => ({
    ref: `probe:${index}`,
    sourceOrder: index,
    value: { tMs: (index % probeGapCount) * 10 + 5 },
  })),
});
assert.ok(
  probe.stats.overlapCheckCount < probeGapCount * 20,
  `indexed sweep must fail before the observed-scale witness if it still scans every candidate per gap; observed ${probe.stats.overlapCheckCount} checks`,
);

const scaleGapCount = 25_000;
const scaleCandidateCount = 120_000;
const scaleGaps = Array.from({ length: scaleGapCount }, (_, index) => ({
  startMs: index * 10,
  endMs: (index + 1) * 10,
}));
const scaleCandidates = Array.from({ length: scaleCandidateCount }, (_, index) => ({
  ref: `event:${index}`,
  sourceOrder: index,
  value: { tMs: (index % scaleGapCount) * 10 + 5 },
}));
const scale = indexSharpForegroundGapOverlaps({
  gaps: scaleGaps,
  candidates: scaleCandidates.reverse(),
});
assert.equal(scale.overlapsByGap.length, scaleGapCount, 'scale witness must retain every foreground gap');
assert.equal(
  scale.overlapsByGap.reduce((sum, refs) => sum + refs.length, 0),
  scaleCandidateCount,
  'scale witness must retain every exact point-event overlap',
);
assert.ok(
  scale.stats.overlapCheckCount < scaleGapCount * 20,
  `indexed sweep must avoid per-gap full-corpus scans; observed ${scale.stats.overlapCheckCount} checks`,
);
assert.equal(scale.stats.candidateCount, scaleCandidateCount);
assert.equal(scale.stats.gapCount, scaleGapCount);

const longLivedInterval = indexSharpForegroundGapOverlaps({
  gaps: Array.from({ length: 1_000 }, (_, index) => ({
    startMs: index * 10,
    endMs: (index + 1) * 10,
  })),
  candidates: [{
    ref: 'interval:whole-run',
    sourceOrder: 0,
    value: { intervalStartMs: 0, intervalEndMs: 10_000 },
  }],
});
assert.equal(
  longLivedInterval.overlapsByGap.filter(refs => refs[0] === 'interval:whole-run').length,
  1_000,
  'a long-lived interval must remain active across every overlapping gap',
);
assert.equal(
  longLivedInterval.stats.overlapCheckCount,
  1_000,
  'long-lived interval work must remain proportional to the exact overlap output',
);

console.log('SHARP foreground gap index contracts passed');
