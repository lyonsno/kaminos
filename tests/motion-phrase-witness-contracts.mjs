import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const indexPath = join(root, 'index.html');
const witnessPath = join(root, 'motion-witness.mjs');

assert.ok(existsSync(witnessPath), 'motion-witness.mjs must remain the reusable motion witness');

const witness = readFileSync(witnessPath, 'utf8');
assert.match(witness, /kaminos_motion_phrase=1/, 'motion witness can target the phrase-decision route');
assert.match(witness, /buildMotionDecisionComparison/, 'motion witness builds deterministic decision-comparison filmstrip evidence');
assert.match(witness, /window\.kaminosMotionDecisionDebugState/, 'motion witness reads explicit phrase-decision browser state');
assert.match(witness, /decisionComparison/, 'motion witness report records decision-comparison metrics');
assert.match(witness, /anticipationDepth/, 'motion witness preserves anticipation evidence');
assert.match(witness, /overshootDistance/, 'motion witness preserves overshoot evidence');

const index = readFileSync(indexPath, 'utf8');
assert.match(index, /DEFAULT_DECISION_MOTION_PLAN/, 'browser imports the authored decision phrase plan');
assert.match(index, /buildMotionDecisionComparison/, 'browser imports the comparison builder');
assert.match(index, /sampleMotionPlan/, 'browser samples phrase plans directly');
assert.match(index, /kaminos_motion_phrase/, 'URL route can enable the phrase-decision scene');
assert.match(index, /createMotionDecisionComparisonScene/, 'browser route creates a naive-vs-phrased comparison scene');
assert.match(index, /updateMotionDecisionFrame/, 'render loop advances phrase-decision actors');
assert.match(index, /window\.kaminosMotionDecisionDebugState/, 'browser witnesses can inspect phrase-decision state');
assert.match(index, /motionDecisionActive/, 'render loop keeps rendering while the phrase-decision route is active');
