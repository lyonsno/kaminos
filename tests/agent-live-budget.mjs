// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {AGENT_LIVE_BUDGET, createAgentLiveBudget} from '../agent-live-budget.mjs';

test('the live budget is the operator\'s: 40 ray steps at most', () => {
 assert.equal(AGENT_LIVE_BUDGET.fireRaySteps, 40);
});

test('a sustained over-budget raymarch stops an agent run unless it opted in', () => {
 const budget = createAgentLiveBudget({allowed: false});
 budget.observe({fireRaySteps: 8}); budget.check();
 budget.observe({fireRaySteps: 160}); budget.check();
 budget.observe({fireRaySteps: 160});
 assert.throws(() => budget.check(), /over-live-budget.*160.*--allow-over-live-budget/);
 assert.deepEqual(budget.report(), {budget: {fireRaySteps: 40}, allowed: false, maxFireRaySteps: 160, violation: budget.report().violation});
 assert.match(budget.report().violation, /160/);
});

test('a heavy basin lowered before the run goes on is not punished, and an opted-in run records what it spent', () => {
 const quick = createAgentLiveBudget({allowed: false});
 quick.observe({fireRaySteps: 160}); quick.observe({fireRaySteps: 160}); quick.observe({fireRaySteps: 160});
 quick.observe({fireRaySteps: 8});
 quick.check();
 assert.equal(quick.report().violation, null, 'lowering the steps clears it (a slow basin load is not the run)');
 assert.equal(quick.report().maxFireRaySteps, 160, 'the peak is still recorded');
 const allowed = createAgentLiveBudget({allowed: true});
 for (let i = 0; i < 4; i++) allowed.observe({fireRaySteps: 160});
 allowed.check();
 assert.equal(allowed.report().allowed, true);
 assert.equal(allowed.report().maxFireRaySteps, 160);
});

test('pages without a fire are within budget', () => {
 const budget = createAgentLiveBudget({allowed: false});
 for (let i = 0; i < 3; i++) budget.observe({fireRaySteps: null});
 budget.check();
 assert.equal(budget.report().maxFireRaySteps, null);
});
