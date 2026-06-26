import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  adaptMotionServerResultToGeneratedPoseTemporalClip,
  buildGeneratedPoseTemporalHarness,
} from '../motion-core.js';

const root = new URL('..', import.meta.url).pathname;
const indexPath = join(root, 'index.html');
const witnessPath = join(root, 'motion-witness.mjs');

function somaFrame(frameIndex) {
  const t = frameIndex / 29;
  return Array.from({ length: 77 }, (_, jointIndex) => {
    const side = jointIndex % 2 === 0 ? -1 : 1;
    const height = jointIndex === 6 ? 1.62 : jointIndex === 3 ? 1.18 : jointIndex >= 69 ? 0.08 : 0.82;
    return [
      t * 0.55 + side * 0.015 * Math.sin(t * Math.PI * 2 + jointIndex),
      height + 0.08 * Math.sin(t * Math.PI * 3 + jointIndex * 0.13),
      0.18 * Math.sin(t * Math.PI * 1.5) + side * 0.04,
    ];
  });
}

const serverResult = {
  prompt: 'a little lerm creeps uphill and waves',
  model: 'kimodo',
  skeleton_type: 'soma77',
  fps: 30,
  duration: 1,
  num_frames: 30,
  num_joints: 77,
  gen_time: 7.3,
  parents: Array.from({ length: 77 }, (_, i) => (i === 0 ? -1 : Math.max(0, i - 1))),
  joints: Array.from({ length: 30 }, (_, frameIndex) => somaFrame(frameIndex)),
  root_positions: Array.from({ length: 30 }, (_, frameIndex) => [frameIndex / 29 * 0.55, 0, 0]),
};

const clip = adaptMotionServerResultToGeneratedPoseTemporalClip(serverResult, {
  id: 'panel_lerm_creep_temporal_v0',
  label: 'Panel Lerm Creep',
  sourceRoute: 'motion-server:http://localhost:8098/generate',
});

assert.equal(clip.schema, 'kaminos.generated-pose-temporal.v0');
assert.equal(clip.id, 'panel_lerm_creep_temporal_v0');
assert.equal(clip.intent, serverResult.prompt);
assert.equal(clip.sourceKind, 'motion-panel-generated-pose-temporal');
assert.equal(clip.sourceStatus, 'live-generated');
assert.equal(clip.sourceModel, 'kimodo');
assert.equal(clip.sourceFormat, 'motion-server-soma77-json');
assert.equal(clip.sourceRoute, 'motion-server:http://localhost:8098/generate');
assert.equal(clip.rawFrameCount, 30);
assert.equal(clip.fps, 30);
assert.equal(clip.temporalSamples.length, 30, 'adapter must not silently cap panel-generated frame evidence');
assert.deepEqual(clip.jointMapping, { Hips: 0, Chest: 3, Head: 6, LeftHand: 14, RightHand: 42, LeftFoot: 69, RightFoot: 74 });
assert.ok(clip.temporalSamples.every(sample => sample.sourceFrame === sample.frame), 'samples preserve source frame identity');
assert.ok(clip.temporalSamples.some(sample => sample.phaseLabel === 'enter'), 'adapter assigns early phase labels');
assert.ok(clip.temporalSamples.some(sample => sample.phaseLabel === 'commit'), 'adapter assigns commit phase labels');
assert.ok(clip.temporalSamples.some(sample => sample.phaseLabel === 'recover'), 'adapter assigns recover phase labels');
assert.ok(clip.temporalSamples.some(sample => sample.handSpan > 0), 'adapter preserves limb envelope signal');
assert.ok(clip.temporalSamples.some(sample => sample.bboxVolume > 0), 'adapter preserves body-envelope signal');
assert.ok(clip.extractionAssumptions.some(line => line.includes('motion server JSON')), 'adapter names the live panel JSON source');

const harness = buildGeneratedPoseTemporalHarness({ generatedInput: clip, fps: 12, filmstripFrames: 5 });
assert.equal(harness.track.id, 'panel_lerm_creep_temporal_v0');
assert.equal(harness.sourceStatus, 'live-generated');
assert.equal(harness.sourceFormat, 'motion-server-soma77-json');
assert.equal(harness.registrySource, 'motion-panel-memory');
assert.equal(harness.sampleCount, 30);
assert.notEqual(harness.registryClipId, 'kimodo_theatrical_bow_temporal_v0', 'panel bridge must not fall back to the bundled bow fixture');

const index = readFileSync(indexPath, 'utf8');
assert.match(index, /motion-panel-orb-preview/, 'Motion tab exposes a panel-generated orb preview command');
assert.match(index, /kaminosPreviewMotionServerResult/, 'browser exposes a callable motion server result preview bridge');
assert.match(index, /adaptMotionServerResultToGeneratedPoseTemporalClip/, 'browser imports the motion server temporal adapter');
assert.match(index, /kaminos_motion_panel_temporal_fixture/, 'browser has a deterministic panel-result fixture route for smoke');
assert.match(index, /motion-panel-source-ghost-mode/, 'Motion tab exposes source skeleton ghost mode control');
assert.match(index, /motion-panel-source-opacity/, 'Motion tab exposes source skeleton ghost opacity control');
assert.match(index, /motion-panel-speed/, 'Motion tab exposes temporal preview speed control');
assert.match(index, /motion-gen-btn/, 'Motion tab exposes the plain Generate Motion button on the source-ghost preview path');
assert.match(index, /window\.generateMotion\s*=\s*generateMotionPanelTemporalPreview/, 'plain Generate Motion path uses the source-ghost preview bridge');
assert.match(index, /motionPromptValueForPreview/, 'preview bridge reads both motion-panel and text-to-motion prompt controls');
assert.match(index, /createMotionSourceGhostVisual/, 'browser builds a phase-locked generated source skeleton visual');
assert.match(index, /updateMotionSourceGhostFrame/, 'browser updates source skeleton from the temporal source frame clock');
assert.match(index, /inferMotionSourceGhostAxes/, 'browser infers source skeleton display axes instead of assuming y-up');
assert.match(index, /motionSourceGhostReadableBones/, 'browser renders a readable source skeleton subset instead of dense SOMA finger clutter');
assert.match(index, /targetSourceGhostHeight/, 'browser scales the source ghost from inferred body height');
assert.match(index, /upAxis/, 'source ghost debug exposes the inferred up axis');
assert.match(index, /displayBasis/, 'source ghost debug exposes the raw-to-display basis');
assert.match(index, /renderedBoneCount/, 'source ghost debug exposes readable rendered bone count separately from raw joints');
assert.match(index, /sourceGhost/, 'browser temporal debug exposes source skeleton ghost evidence');
assert.match(index, /sourceFrameSharedWithOrb/, 'debug evidence states whether source skeleton and orb share the same source frame');

const witness = readFileSync(witnessPath, 'utf8');
assert.match(witness, /kaminos_motion_panel_temporal_fixture/, 'motion witness can smoke the panel temporal fixture route');
assert.match(witness, /motion-server-soma77-json/, 'motion witness validates panel-generated source format');
assert.match(witness, /sourceGhost/, 'motion witness validates source skeleton ghost evidence');
assert.match(witness, /sourceFrameSharedWithOrb/, 'motion witness rejects unpaired skeleton/orb phase clocks');
