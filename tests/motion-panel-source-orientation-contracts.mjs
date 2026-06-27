import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  adaptMotionServerResultToGeneratedPoseTemporalClip,
  normalizeMotionSourceOrientationRemap,
} from '../motion-core.js';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

function somaFrame(frameIndex) {
  const t = frameIndex / 11;
  return Array.from({ length: 77 }, (_, jointIndex) => {
    const height = jointIndex === 6 ? 1.62 : jointIndex === 3 ? 1.18 : jointIndex >= 69 ? 0.08 : 0.82;
    return [
      0.03 * Math.sin(t * Math.PI + jointIndex),
      t * 0.72 + height * 0.02,
      height,
    ];
  });
}

const yForwardServerResult = {
  prompt: 'a man crawls forward on his hands and knees',
  model: 'kimodo',
  skeleton_type: 'soma77',
  fps: 24,
  duration: 0.5,
  num_frames: 12,
  num_joints: 77,
  joints: Array.from({ length: 12 }, (_, frameIndex) => somaFrame(frameIndex)),
  root_positions: Array.from({ length: 12 }, (_, frameIndex) => [0, frameIndex / 11 * 0.72, 0]),
};

const remap = normalizeMotionSourceOrientationRemap({
  sourceUpAxis: '+z',
  sourceForwardAxis: '+y',
  source: 'test-y-forward',
});
assert.equal(remap.schema, 'kaminos.motion-source-orientation-remap.v0');
assert.equal(remap.mode, 'explicit');
assert.equal(remap.forwardAxisName, 'y');
assert.equal(remap.upAxisName, 'z');

const partialRemap = normalizeMotionSourceOrientationRemap({
  sourceUpAxis: 'auto',
  sourceForwardAxis: '+y',
  source: 'test-partial-forward',
});
assert.equal(partialRemap.mode, 'explicit', 'setting only forward axis is still an explicit operator remap');
assert.equal(partialRemap.forwardAxisName, 'y', 'partial auto/explicit remap preserves the explicit forward axis');

const clip = adaptMotionServerResultToGeneratedPoseTemporalClip(yForwardServerResult, {
  id: 'panel_crawl_y_forward_temporal_v0',
  label: 'Panel Crawl Y Forward',
  sourceOrientationRemap: remap,
});
assert.equal(clip.sourceOrientationRemap.mode, 'explicit', 'clip records effective source orientation remap');
assert.ok(clip.extractionAssumptions.some(line => line.includes('source orientation remap')), 'adapter names orientation remap in extraction assumptions');
assert.ok(clip.temporalSamples.at(-1).root[2] > 0.68, 'explicit +Y forward remap turns source Y root travel into Kaminos forward Z');
assert.ok(Math.abs(clip.temporalSamples.at(-1).root[1]) < 0.02, 'explicit +Z up remap prevents source Y travel from masquerading as vertical rise');

assert.match(index, /id="motion-panel-source-up-axis"/, 'Motion panel exposes a source up-axis selector');
assert.match(index, /id="motion-panel-source-forward-axis"/, 'Motion panel exposes a source forward-axis selector');
assert.match(index, /from '\.\/motion-core\.js\?v=source-orientation-remap-20260627-generated-motion-cliplets-20260627-cliplet-playback-20260627-path-interrupt-20260627'/, 'motion route preserves the source-orientation cache-bust marker while adding the cliplet and interrupt module markers');
assert.match(index, /function motionPanelSourceOrientationRemapFromInputs/, 'browser reads source orientation controls through a helper');
assert.match(index, /sourceOrientationRemap: motionPanelSourceOrientationRemapFromInputs\(\)/, 'preview bridge passes source orientation remap into the adapter');
assert.match(index, /sourceOrientationRemap: normalizeMotionSourceOrientationRemap/, 'source ghost normalizes source orientation remap evidence');
assert.match(index, /transformSourceGhostJoint[\s\S]*sourceGhost\.sourceOrientationRemap/, 'source ghost display transform consumes the same orientation remap');
assert.match(index, /sourceOrientationRemap: sourceGhost\.sourceOrientationRemap/, 'source ghost debug records effective orientation remap');
assert.match(index, /sourceOrientationRemap: state\?\.sourceOrientationRemap/, 'generated temporal debug exposes active orientation remap');
assert.match(index, /function updateMotionPhraseControlApplicability/, 'Motion panel has an explicit phrase-control applicability updater');
assert.match(index, /data-motion-controls-applicable/, 'phrase control panel exposes scriptable applicability state');
assert.match(index, /motionPhraseControlApplicabilityDebugState/, 'browser exposes phrase-control applicability debug evidence');
assert.match(index, /input\.disabled = !applicable/, 'inactive phrase controls are actually disabled, not only visually dimmed');
assert.match(index, /motionTemporalState\?\.active/, 'applicability logic detects generated temporal motion as a distinct current path');

assert.match(witness, /--source-up-axis/, 'live witness can drive source up-axis remap');
assert.match(witness, /--source-forward-axis/, 'live witness can drive source forward-axis remap');
assert.match(witness, /sourceOrientationRemap/, 'live witness records source orientation remap evidence');
assert.match(witness, /phraseControlApplicability/, 'live witness records phrase-control applicability evidence');
