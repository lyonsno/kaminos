// The cooperative duty budget must adapt on a duty's own GPU time. Foreground
// frames admitted ahead of a duty finish before it starts executing; counting
// them collapsed the budget to its floor whenever frames were expensive
// (observed: 500-600 tiny duties at a 12 ms target under a slow scene).
import assert from 'node:assert/strict';
import { dutyExecutionMs, adaptDutyFlops } from '../supermat-ops.js';

// Duty submitted at 100 behind a 30 ms frame that completes at 130; done at 142.
assert.equal(dutyExecutionMs({ submittedAt: 100, precedingDoneAt: 130, doneAt: 142 }), 12);
// Nothing ahead of it (preceding work already done at submit).
assert.equal(dutyExecutionMs({ submittedAt: 100, precedingDoneAt: 95, doneAt: 110 }), 10);

// A steady 1 ms/GFLOP duty converges to ~12 GFLOP at a 12 ms target even with
// a 30 ms frame queued ahead of every duty.
let budget = 4e9;
for (let i = 0; i < 40; i++) {
  const ownMs = budget / 1e9;
  budget = adaptDutyFlops({ current: budget, flops: budget, ownMs, targetMs: 12, bounds: [5e8, 6.4e10] });
}
assert.ok(Math.abs(budget - 12e9) < 0.2e9, `budget ${budget}`);
assert.equal(adaptDutyFlops({ current: 4e9, flops: 4e9, ownMs: 0, targetMs: 12, bounds: [5e8, 6.4e10] }), 4e9);
console.log('duty timing contracts: 4 passed');
