import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');
const witness = readFileSync(join(root, 'motion-witness.mjs'), 'utf8');

assert.match(index, /kaminos_motion_tracks/, 'URL route can enable the motion-track harness');
assert.match(index, /kaminos_generated_motion_track/, 'URL route can enable the generated motion-track harness');
assert.match(index, /DEFAULT_MOTION_TRACK_FIXTURE/, 'browser imports the default motion-track fixture');
assert.match(index, /DEFAULT_DIP_WAVE_GENERATED_MOTION_FIXTURE/, 'browser imports the default generated DiP wave fixture');
assert.match(index, /buildMotionTrackHarness/, 'browser can expose motion-track harness evidence');
assert.match(index, /buildGeneratedMotionTrackHarness/, 'browser can expose generated motion-track harness evidence');
assert.match(index, /sampleMotionTrack/, 'browser samples motion tracks directly');
assert.match(index, /createMotionTrackHarnessScene/, 'browser route creates the motion-track harness scene');
assert.match(index, /createGeneratedMotionTrackHarnessScene/, 'browser route creates the generated motion-track harness scene');
assert.match(index, /updateMotionTrackFrame/, 'render loop advances motion-track actors');
assert.match(index, /window\.kaminosMotionTrackDebugState/, 'browser exposes motion-track debug state');
assert.match(index, /window\.kaminosGeneratedMotionTrackDebugState/, 'browser exposes generated motion-track debug state');
assert.match(index, /attentionLeadDistance/, 'browser debug state records root/head attention separation metrics');
assert.match(index, /sourceStatus/, 'browser debug state records fixture/live source status');
assert.match(index, /verticalDisplayScale/, 'browser debug state records visual-only vertical display scale');
assert.match(index, /faceCueWorld/, 'browser places the face cue from display-space facing instead of raw local-space facing');
assert.match(index, /motionTrackActive/, 'render loop keeps rendering while motion tracks are active');

assert.match(witness, /kaminos_motion_tracks=1/, 'motion witness can target the motion-track route');
assert.match(witness, /kaminos_generated_motion_track=1/, 'motion witness can target the generated motion-track route');
assert.match(witness, /buildMotionTrackHarness/, 'motion witness builds deterministic motion-track filmstrip');
assert.match(witness, /buildGeneratedMotionTrackHarness/, 'motion witness builds deterministic generated motion-track filmstrip');
assert.match(witness, /window\.kaminosMotionTrackDebugState/, 'motion witness reads motion-track browser state');
assert.match(witness, /window\.kaminosGeneratedMotionTrackDebugState/, 'motion witness reads generated motion-track browser state');
assert.match(witness, /motionTrackHarness/, 'motion witness reports motion-track harness evidence');
assert.match(witness, /generatedMotionTrackHarness/, 'motion witness reports generated motion-track harness evidence');
assert.match(witness, /rootVerticalRange/, 'motion witness preserves raw vertical range evidence');
assert.match(witness, /track_mass_only/, 'motion witness preserves mass-only variant identity');
assert.match(witness, /track_mass_attention/, 'motion witness preserves mass+attention variant identity');
assert.match(witness, /generated_dip_wave/, 'motion witness preserves generated DiP wave variant identity');
assert.match(witness, /attentionMassContrast/, 'motion witness preserves mass/attention contrast evidence');
