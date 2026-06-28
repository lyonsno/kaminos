import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildGeneratedPoseTemporalCliplets,
  buildGeneratedPoseClipletPathInterrupt,
  sampleGeneratedPoseClipletPathInterrupt,
} from '../motion-core.js';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

function poseSample(frame, phaseLabel, rootZ, compression = 0.1) {
  return {
    frame,
    sourceFrame: frame,
    time: Number((frame / 20).toFixed(5)),
    phaseLabel,
    root: [0, 0, rootZ],
    head: [0, 1.5 - compression * 0.1, rootZ + 0.08],
    chest: [0, 1.1 - compression * 0.06, rootZ + 0.03],
    leftHand: [-0.24, 1.0, rootZ + 0.02],
    rightHand: [0.24, 1.0, rootZ + 0.02],
    leftFoot: [-0.16, 0.05, rootZ - 0.03],
    rightFoot: [0.16, 0.05, rootZ - 0.03],
    headRoot: [0, 1.5 - compression * 0.1, 0.08],
    chestRoot: [0, 1.1 - compression * 0.06, 0.03],
    handSpan: 0.48,
    stanceWidth: 0.32,
    bboxVolume: 1.1,
    bowCompression: compression,
  };
}

const temporalSamples = [
  poseSample(0, 'enter', 0.0, 0.08),
  poseSample(1, 'enter', 0.08, 0.08),
  poseSample(2, 'commit', 0.18, 0.12),
  poseSample(3, 'commit', 0.32, 0.12),
  poseSample(4, 'brake', 0.35, 0.82),
  poseSample(5, 'brake', 0.34, 0.86),
  poseSample(6, 'escape', 0.18, 0.42),
  poseSample(7, 'escape', -0.02, 0.28),
  poseSample(8, 'settle', -0.04, 0.14),
  poseSample(9, 'settle', -0.04, 0.12),
];

const generatedClip = {
  schema: 'kaminos.generated-pose-temporal.v0',
  id: 'synthetic_cliplet_interrupt_source',
  label: 'Synthetic Cliplet Interrupt Source',
  intent: 'a man stops short then escapes',
  sourceKind: 'motion-panel-generated-pose-temporal',
  sourceStatus: 'test-fixture',
  sourceModel: 'contract-synthetic',
  sourceRoute: 'tests/generated-motion-cliplet-interrupt-contracts.mjs',
  sourceFrameStride: 1,
  rawFrameCount: temporalSamples.length,
  fps: 20,
  duration: temporalSamples.at(-1).time,
  temporalSamples,
};

const cliplets = buildGeneratedPoseTemporalCliplets(generatedClip);
const brake = cliplets.segments.find(segment => segment.labelGuess === 'approach-impact / compress');
assert.ok(brake, 'fixture includes an approach-impact phrase cliplet with raw brake children');
const triggerRawBrake = cliplets.rawSegments.find(segment => (
  brake.rawSegmentIds?.includes(segment.id)
  && segment.labelGuess.includes('brake')
));
assert.ok(triggerRawBrake, 'merged brake phrase exposes a raw brake trigger child');

const interrupt = buildGeneratedPoseClipletPathInterrupt({
  generatedInput: generatedClip,
  cliplets,
  segmentId: brake.id,
  radius: 0.12,
});

assert.equal(interrupt.schema, 'kaminos.generated-motion-cliplet-interrupt.v0');
assert.equal(interrupt.mode, 'path-trigger');
assert.equal(interrupt.state, 'armed');
assert.equal(interrupt.selectedSegmentId, brake.id);
assert.equal(interrupt.trigger.sourceFrame, triggerRawBrake.startSourceFrame);
assert.equal(interrupt.trigger.sourceTime, triggerRawBrake.startTime);
assert.equal(interrupt.trigger.triggerSegmentId, triggerRawBrake.id);
assert.equal(interrupt.trigger.triggerSegmentLayer, 'raw');
assert.deepEqual(interrupt.trigger.root, temporalSamples[triggerRawBrake.startIndex].root);
assert.equal(interrupt.playback.schema, 'kaminos.generated-motion-cliplet-playback.v0');
assert.equal(interrupt.playback.segments[0].sourceSegmentId, brake.id);

const armed = sampleGeneratedPoseClipletPathInterrupt(generatedClip, interrupt, 0);
assert.equal(armed.interrupt.schema, 'kaminos.generated-motion-cliplet-interrupt-sample.v0');
assert.equal(armed.interrupt.state, 'armed');
assert.equal(armed.interrupt.fired, false);
assert.equal(armed.interrupt.activeSource, 'full-source');
assert.equal(armed.motionSample.temporalSample.sourceFrame, 0);
assert.ok(armed.interrupt.distanceToTrigger > interrupt.trigger.radius);

const fired = sampleGeneratedPoseClipletPathInterrupt(generatedClip, interrupt, interrupt.trigger.sourceTime + 0.001);
assert.equal(fired.interrupt.state, 'fired');
assert.equal(fired.interrupt.fired, true);
assert.equal(fired.interrupt.activeSource, 'cliplet-playback');
assert.equal(fired.interrupt.selectedSegmentId, brake.id);
assert.ok(fired.interrupt.distanceToTrigger <= interrupt.trigger.radius || fired.interrupt.sourceTime >= interrupt.trigger.sourceTime);
assert.ok(fired.playbackSample.playback.sourceFrame >= brake.startSourceFrame);
assert.ok(fired.playbackSample.playback.sourceFrame <= brake.endSourceFrame);
assert.equal(fired.motionSample.temporalSample.sourceFrame, fired.playbackSample.playback.sourceFrame);

assert.match(index, /id="motion-panel-cliplet-interrupt"/, 'Motion panel exposes a cliplet interrupt mode selector');
assert.match(index, /motionPanelClipletInterruptFromInputs/, 'browser builds path-trigger interrupts from Motion panel inputs');
assert.match(index, /buildGeneratedPoseClipletPathInterrupt/, 'browser imports the path-trigger interrupt builder');
assert.match(index, /sampleGeneratedPoseClipletPathInterrupt/, 'browser samples through path-trigger interrupt state');
assert.match(index, /clipletInterrupt/, 'browser debug/export evidence exposes cliplet interrupt state');

assert.match(liveWitness, /--cliplet-interrupt/, 'live witness can drive path-trigger cliplet interrupts');
assert.match(liveWitness, /clipletInterrupt/, 'live witness records interrupt evidence');
