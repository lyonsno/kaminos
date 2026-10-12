// Frame-pacing statistics for runs beside a live scene: percentiles through
// p99.9, budget breaks, missed vsyncs, a bucketed histogram and hitch counts.
import assert from 'node:assert/strict';
import { frameStats, FRAME_BUCKETS_MS } from '../frame-stats.js';

assert.equal(frameStats([]), null);
const gaps = [...Array(990).fill(16.7), 17.5, 25, 34, 40, 51, 60, 99, 101, 180, 1200];
const s = frameStats(gaps, { budgetMs: 1000 / 60 });
assert.equal(s.frames, 1000);
assert.equal(s.max, 1200);
// Budget breaks at 60 Hz: strictly over 16.67 ms (the 990 steady frames of 16.7 ms break by 0.03 ms,
// so the missed-vsync count, not the raw count, is the jitter-tolerant measure).
assert.equal(s.budget.periodMs.toFixed(3), '16.667');
assert.equal(s.budget.over30Hz, 8);                        // > 33.33 ms
// round(gap / period) - 1 per gap: 17.5:0 25:1 34:1 40:1 51:2 60:3 99:5 101:5 180:10 1200:71
assert.equal(s.budget.missedFrames, 99);
assert.equal(s.budget.framesMissingVsync, 9);
assert.equal(s.hitches.over50ms, 6);
assert.equal(s.hitches.over100ms, 3);
assert.equal(s.nearWorst.count, 1);                         // >= 0.8 * max
assert.equal(s.p999, 1200);
assert.equal(s.p99, 17.5);
const total = s.histogram.reduce((sum, row) => sum + row.count, 0);
assert.equal(total, 1000);
assert.deepEqual(s.histogram.map(row => row.upToMs), [...FRAME_BUCKETS_MS, null]);
assert.equal(s.histogram.find(row => row.upToMs === 1000).count, 0);
assert.equal(s.histogram.at(-1).count, 1);                  // > last edge
console.log('frame stats contracts: passed');
