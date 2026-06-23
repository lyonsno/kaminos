import assert from 'node:assert/strict';

import {
  DEFAULT_DECISION_MOTION_PLAN,
  DEFAULT_MOTION_PHRASE_CONTROLS,
  DEFAULT_MOTION_PHRASE_CONTROL_PRESETS,
  MOTION_PHRASE_CONTROL_SCHEMA,
  applyMotionPhraseControls,
  buildMotionPhraseControlHarness,
  normalizeMotionPhraseControls,
  sampleMotionPlan,
  simulateMotionPlan,
} from '../motion-core.js';

assert.equal(MOTION_PHRASE_CONTROL_SCHEMA, 'kaminos.motion-phrase-controls.v0');

const defaultControls = normalizeMotionPhraseControls(DEFAULT_MOTION_PHRASE_CONTROLS);
assert.equal(defaultControls.schema, MOTION_PHRASE_CONTROL_SCHEMA);
assert.equal(defaultControls.source, 'default');
for (const key of ['mass', 'commitment', 'anticipation', 'hold', 'effort', 'overshoot', 'recovery', 'tempo']) {
  assert.equal(typeof defaultControls[key], 'number', `control ${key} must normalize to a number`);
}

const clippedControls = normalizeMotionPhraseControls({
  mass: 99,
  commitment: -2,
  anticipation: 4,
  hold: 0,
  effort: 9,
  overshoot: -1,
  recovery: 10,
  tempo: 0,
});
assert.equal(clippedControls.mass, 4, 'mass clips to an explicit high bound');
assert.equal(clippedControls.commitment, 0, 'commitment clips to zero');
assert.equal(clippedControls.anticipation, 2.5, 'anticipation clips to explicit high bound');
assert.equal(clippedControls.hold, 0.2, 'hold keeps a nonzero read window');
assert.equal(clippedControls.effort, 2.5, 'effort clips to explicit high bound');
assert.equal(clippedControls.overshoot, 0, 'overshoot clips to zero');
assert.equal(clippedControls.recovery, 2.5, 'recovery clips to explicit high bound');
assert.equal(clippedControls.tempo, 0.25, 'tempo keeps a nonzero clock scale');

assert.deepEqual(
  DEFAULT_MOTION_PHRASE_CONTROL_PRESETS.map(preset => preset.id),
  ['hesitant_curious', 'heavy_deliberate', 'sharp_aggressive'],
  'default presets should expose three distinct reachable reads',
);

const hesitant = applyMotionPhraseControls(DEFAULT_DECISION_MOTION_PLAN, DEFAULT_MOTION_PHRASE_CONTROL_PRESETS[0].controls);
const heavy = applyMotionPhraseControls(DEFAULT_DECISION_MOTION_PLAN, DEFAULT_MOTION_PHRASE_CONTROL_PRESETS[1].controls);
const sharp = applyMotionPhraseControls(DEFAULT_DECISION_MOTION_PLAN, DEFAULT_MOTION_PHRASE_CONTROL_PRESETS[2].controls);
assert.equal(hesitant.schema, 'kaminos.motion-controlled-plan.v0');
assert.equal(hesitant.basePlanId, DEFAULT_DECISION_MOTION_PLAN.id);
assert.equal(hesitant.effectiveControls.source, 'preset:hesitant_curious');
assert.ok(hesitant.plan.duration > sharp.plan.duration, 'hesitant read should take longer than sharp read');
assert.ok(heavy.plan.weight.mass > hesitant.plan.weight.mass, 'heavy read carries more mass');
assert.ok(sharp.plan.weight.effortScale > hesitant.plan.weight.effortScale, 'sharp read carries more effort scale');

const hesitantCommit = sampleMotionPlan(hesitant.plan, hesitant.phaseTimes.commit.mid);
const sharpCommit = sampleMotionPlan(sharp.plan, sharp.phaseTimes.commit.mid);
const heavyCommit = sampleMotionPlan(heavy.plan, heavy.phaseTimes.commit.mid);
assert.ok(sharpCommit.root[2] > hesitantCommit.root[2] + 0.1, 'commitment control pushes sharper read farther forward');
assert.ok(heavyCommit.root[2] < sharpCommit.root[2], 'mass damps heavy forward spacing');
assert.ok(heavyCommit.effort > hesitantCommit.effort, 'heavy read visibly raises effort against mass');

const hesitantSim = simulateMotionPlan(hesitant.plan, { duration: hesitant.plan.duration, fps: 12 });
const sharpSim = simulateMotionPlan(sharp.plan, { duration: sharp.plan.duration, fps: 12 });
assert.ok(hesitantSim.metrics.anticipationDepth > sharpSim.metrics.anticipationDepth, 'hesitant read gets deeper anticipation');
assert.ok(sharpSim.metrics.overshootDistance > hesitantSim.metrics.overshootDistance, 'sharp read gets more overshoot');

const harness = buildMotionPhraseControlHarness({ duration: 7.2, fps: 12 });
assert.equal(harness.schema, 'kaminos.motion-phrase-control-harness.v0');
assert.equal(harness.route, 'procedural-orb-motion-grammar-v0');
assert.equal(harness.basePlanId, DEFAULT_DECISION_MOTION_PLAN.id);
assert.equal(harness.variants.length, 3);
assert.ok(harness.variants.every(variant => variant.effectiveControls.schema === MOTION_PHRASE_CONTROL_SCHEMA), 'variants record effective controls');
assert.ok(harness.variants.every(variant => variant.metrics.phaseChanges >= 5), 'each variant still preserves phrase beats');
assert.ok(harness.filmstrip.length >= 7, 'harness exposes filmstrip-ready comparison frames');

const variantIds = harness.variants.map(variant => variant.id);
assert.deepEqual(variantIds, ['hesitant_curious', 'heavy_deliberate', 'sharp_aggressive']);
const harnessHesitant = harness.variants.find(variant => variant.id === 'hesitant_curious');
const harnessSharp = harness.variants.find(variant => variant.id === 'sharp_aggressive');
assert.ok(harnessHesitant.metrics.anticipationDepth > harnessSharp.metrics.anticipationDepth, 'harness preserves distinct hesitant-vs-sharp anticipation');
assert.ok(harnessSharp.metrics.overshootDistance > harnessHesitant.metrics.overshootDistance, 'harness preserves distinct sharp-vs-hesitant overshoot');
