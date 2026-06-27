import assert from 'node:assert/strict';

import {
  DEFAULT_DECISION_MOTION_PLAN,
  MOTION_PLAN_SCHEMA,
  buildMotionDecisionComparison,
  normalizeMotionPlan,
  sampleMotionPlan,
  simulateMotionPlan,
} from '../motion-core.js';

assert.equal(MOTION_PLAN_SCHEMA, 'kaminos.motion-plan.v0');

const plan = normalizeMotionPlan(DEFAULT_DECISION_MOTION_PLAN);
assert.equal(plan.schema, MOTION_PLAN_SCHEMA);
assert.equal(plan.id, 'orb_decision_bad_intent_v1');
assert.equal(plan.intent, 'notice-prepare-commit-recover');
assert.ok(plan.duration > 6, 'decision plan has enough time for a readable phrase');
assert.ok(plan.phrases.length >= 5, 'decision plan is a sequence of phrases, not one clip');
assert.deepEqual(
  plan.phrases.map(phrase => phrase.phase),
  ['idle', 'notice', 'anticipate', 'commit', 'overshoot', 'recover'],
  'decision plan names the animation beats in order',
);
assert.ok(plan.weight.mass > 1, 'decision plan carries mass/weight above a default unit object');
assert.ok(plan.weight.anticipation > 0, 'decision plan carries anticipation');
assert.ok(plan.weight.settle > 0, 'decision plan carries settle/recovery');
assert.ok(plan.weight.effortScale > 1, 'decision plan can accent effort');

const idle = sampleMotionPlan(plan, 0.2);
const notice = sampleMotionPlan(plan, 1.4);
const anticipate = sampleMotionPlan(plan, 2.0);
const commit = sampleMotionPlan(plan, 3.2);
const overshoot = sampleMotionPlan(plan, 4.3);
const recover = sampleMotionPlan(plan, 6.4);

assert.equal(idle.phase, 'idle');
assert.equal(notice.phase, 'notice');
assert.equal(anticipate.phase, 'anticipate');
assert.equal(commit.phase, 'commit');
assert.equal(overshoot.phase, 'overshoot');
assert.equal(recover.phase, 'recover');
assert.ok(anticipate.root[2] < notice.root[2] - 0.08, 'anticipation pulls opposite the upcoming commit');
assert.ok(commit.root[2] > anticipate.root[2] + 0.9, 'commit phrase makes a decisive forward move');
assert.ok(overshoot.root[2] > commit.root[2], 'overshoot goes past the commit target before recovery');
assert.ok(recover.root[2] < overshoot.root[2], 'recover settles back from overshoot');
assert.ok(commit.effort > notice.effort + 0.35, 'commit carries a visible effort accent');
assert.ok(commit.scale > idle.scale, 'commit effort affects scale/weight read');
assert.ok(Math.abs(commit.facing[2]) > 0.95, 'commit keeps facing locked toward intent');

const heavyPlan = normalizeMotionPlan({
  ...DEFAULT_DECISION_MOTION_PLAN,
  id: 'heavy_decision',
  weight: {
    ...DEFAULT_DECISION_MOTION_PLAN.weight,
    mass: 3.0,
    settle: 0.45,
  },
});
const lightPlan = normalizeMotionPlan({
  ...DEFAULT_DECISION_MOTION_PLAN,
  id: 'light_decision',
  weight: {
    ...DEFAULT_DECISION_MOTION_PLAN.weight,
    mass: 0.6,
    settle: 0.05,
  },
});
const heavyCommit = sampleMotionPlan(heavyPlan, 3.2);
const lightCommit = sampleMotionPlan(lightPlan, 3.2);
assert.ok(heavyCommit.root[2] < lightCommit.root[2], 'higher mass damps commit spacing at the same phrase time');
assert.ok(heavyCommit.effort > lightCommit.effort, 'higher mass increases effort read during commitment');

const simulation = simulateMotionPlan(plan, { duration: plan.duration, fps: 12 });
assert.equal(simulation.schema, 'kaminos.motion-plan-simulation.v0');
assert.equal(simulation.planId, plan.id);
assert.equal(simulation.frames.length, Math.floor(plan.duration * 12) + 1);
assert.ok(simulation.metrics.maxEffort > 1.0, 'plan simulation captures accented effort');
assert.ok(simulation.metrics.anticipationDepth > 0.08, 'plan simulation measures anticipation depth');
assert.ok(simulation.metrics.overshootDistance > 0.08, 'plan simulation measures overshoot distance');
assert.ok(simulation.metrics.phaseChanges >= 5, 'plan simulation records multiple intention phase changes');

const comparison = buildMotionDecisionComparison({ duration: 7.2, fps: 12 });
assert.equal(comparison.schema, 'kaminos.motion-decision-comparison.v0');
assert.equal(comparison.route, 'procedural-orb-motion-grammar-v0');
assert.equal(comparison.naive.actor.label, 'Naive Loop');
assert.equal(comparison.phrased.actor.label, 'Phrased Decision');
assert.ok(comparison.phrased.metrics.anticipationDepth > comparison.naive.metrics.anticipationDepth + 0.05, 'phrased plan adds readable anticipation beyond naive loop playback');
assert.ok(comparison.phrased.metrics.overshootDistance > comparison.naive.metrics.overshootDistance + 0.05, 'phrased plan adds readable overshoot beyond naive loop playback');
assert.ok(comparison.phrased.metrics.phaseChanges > comparison.naive.metrics.phaseChanges, 'phrased plan changes intention more clearly than the naive loop');
assert.ok(comparison.filmstrip.length >= 6, 'comparison exposes a filmstrip-ready set of frames');
