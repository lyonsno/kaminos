import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');
const witness = readFileSync(join(root, 'motion-witness.mjs'), 'utf8');

assert.match(index, /kaminos_motion_phrase_controls/, 'URL route can enable the phrase-control harness');
assert.match(index, /DEFAULT_MOTION_PHRASE_CONTROL_PRESETS/, 'browser imports phrase-control presets');
assert.match(index, /applyMotionPhraseControls/, 'browser applies live phrase controls');
assert.match(index, /buildMotionPhraseControlHarness/, 'browser can expose phrase-control harness evidence');
assert.match(index, /motion-control-mass/, 'browser exposes mass control');
assert.match(index, /motion-control-commitment/, 'browser exposes commitment control');
assert.match(index, /motion-control-anticipation/, 'browser exposes anticipation control');
assert.match(index, /motion-control-hold/, 'browser exposes hold/read-time control');
assert.match(index, /motion-control-effort/, 'browser exposes effort control');
assert.match(index, /motion-control-overshoot/, 'browser exposes overshoot control');
assert.match(index, /motion-control-recovery/, 'browser exposes recovery control');
assert.match(index, /motion-control-tempo/, 'browser exposes tempo control');
assert.match(index, /createMotionPhraseControlHarnessScene/, 'browser route creates the phrase-control harness scene');
assert.match(index, /updateMotionPhraseControlFrame/, 'render loop advances phrase-control actors');
assert.match(index, /window\.kaminosMotionPhraseControlDebugState/, 'browser exposes phrase-control debug state');
assert.match(index, /effectiveControls/, 'browser debug state records effective controls');
assert.match(index, /motionPhraseControlActive/, 'render loop keeps rendering while phrase controls are active');

assert.match(witness, /kaminos_motion_phrase_controls=1/, 'motion witness can target the phrase-control harness route');
assert.match(witness, /buildMotionPhraseControlHarness/, 'motion witness builds deterministic phrase-control harness filmstrip');
assert.match(witness, /window\.kaminosMotionPhraseControlDebugState/, 'motion witness reads phrase-control browser state');
assert.match(witness, /phraseControlHarness/, 'motion witness reports phrase-control harness evidence');
assert.match(witness, /effectiveControls/, 'motion witness records effective controls');
