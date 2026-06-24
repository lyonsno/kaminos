import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');
const witness = readFileSync(join(root, 'motion-witness.mjs'), 'utf8');

assert.match(index, /kaminos_motion_tracks/, 'URL route can enable the motion-track harness');
assert.match(index, /DEFAULT_MOTION_TRACK_FIXTURE/, 'browser imports the default motion-track fixture');
assert.match(index, /buildMotionTrackHarness/, 'browser can expose motion-track harness evidence');
assert.match(index, /sampleMotionTrack/, 'browser samples motion tracks directly');
assert.match(index, /createMotionTrackHarnessScene/, 'browser route creates the motion-track harness scene');
assert.match(index, /updateMotionTrackFrame/, 'render loop advances motion-track actors');
assert.match(index, /window\.kaminosMotionTrackDebugState/, 'browser exposes motion-track debug state');
assert.match(index, /attentionLeadDistance/, 'browser debug state records root/head attention separation metrics');
assert.match(index, /motionTrackActive/, 'render loop keeps rendering while motion tracks are active');

assert.match(witness, /kaminos_motion_tracks=1/, 'motion witness can target the motion-track route');
assert.match(witness, /buildMotionTrackHarness/, 'motion witness builds deterministic motion-track filmstrip');
assert.match(witness, /window\.kaminosMotionTrackDebugState/, 'motion witness reads motion-track browser state');
assert.match(witness, /motionTrackHarness/, 'motion witness reports motion-track harness evidence');
assert.match(witness, /track_root_head/, 'motion witness preserves root+head variant identity');
