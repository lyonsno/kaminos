import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as motionCore from '../motion-core.js';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.equal(
  typeof motionCore.buildGeneratedPoseTemporalCliplets,
  'function',
  'motion core exports the generated-pose source cliplet slicer',
);

function sample(frame, z, phaseLabel, bowCompression = 0.05) {
  const y = 0.9 - bowCompression * 0.18;
  return {
    frame,
    sourceFrame: frame,
    time: Number((frame / 32).toFixed(5)),
    phaseLabel,
    root: [0, 0, z],
    head: [0, y + 0.62, z + 0.06],
    chest: [0, y + 0.2, z + 0.02],
    leftHand: [-0.28, y + 0.05, z + 0.08],
    rightHand: [0.28, y + 0.05, z + 0.08],
    leftFoot: [-0.16, 0.04, z - 0.03],
    rightFoot: [0.16, 0.04, z - 0.03],
    headRoot: [0, y + 0.62, 0.06],
    chestRoot: [0, y + 0.2, 0.02],
    handSpan: 0.56,
    stanceWidth: 0.32,
    bboxVolume: 1.2 + bowCompression,
    bowCompression,
  };
}

const temporalSamples = Array.from({ length: 64 }, (_, frame) => {
  if (frame < 16) return sample(frame, frame / 15 * 1.15, frame < 6 ? 'enter' : 'commit', 0.08);
  if (frame < 23) return sample(frame, 1.15 - (frame - 16) * 0.015, 'brake', 0.82);
  if (frame < 46) return sample(frame, 1.04 - (frame - 23) / 22 * 1.6, 'escape', frame < 30 ? 0.62 : 0.24);
  return sample(frame, -0.58 + Math.sin((frame - 46) / 17 * Math.PI) * 0.04, 'settle', 0.12);
});

const generatedClip = {
  schema: 'kaminos.generated-pose-temporal.v0',
  id: 'synthetic_stop_reverse_source_truth',
  label: 'Synthetic Stop Reverse Source Truth',
  intent: 'a man stops short startles and sprints in the opposite direction',
  sourceKind: 'motion-panel-generated-pose-temporal',
  sourceStatus: 'test-fixture',
  sourceModel: 'contract-synthetic',
  sourceRoute: 'tests/generated-motion-cliplet-contracts.mjs',
  sourceFrameStride: 1,
  rawFrameCount: temporalSamples.length,
  fps: 32,
  duration: temporalSamples.at(-1).time,
  temporalSamples,
};

const cliplets = motionCore.buildGeneratedPoseTemporalCliplets(generatedClip);

assert.equal(cliplets.schema, 'kaminos.generated-motion-cliplets.v0');
assert.equal(cliplets.sourceClipId, generatedClip.id);
assert.equal(cliplets.sourceFrameCount, temporalSamples.length);
assert.equal(cliplets.sampleCount, temporalSamples.length, 'cliplet analysis must not silently cap source frames');
assert.equal(cliplets.segmentation.outputLayer, 'phrase', 'operator-facing cliplets use the phrase layer');
assert.ok(cliplets.rawSegments.length >= 4, 'raw source evidence should split into at least approach, brake, escape, and settle');
assert.ok(cliplets.segments.length <= cliplets.rawSegments.length, 'phrase cliplets must not be more crumbly than raw source evidence');
assert.equal(cliplets.segments[0].startFrame, 0);
assert.equal(cliplets.segments.at(-1).endFrame, temporalSamples.at(-1).frame);
assert.equal(cliplets.segments[0].startSourceFrame, 0);
assert.equal(cliplets.segments.at(-1).endSourceFrame, temporalSamples.at(-1).sourceFrame);
assert.ok(
  cliplets.rawSegments.some(segment => segment.metrics.directionChangePeak > 0.45),
  'cliplets preserve direction-change evidence for source-truth interruption slicing',
);
assert.ok(
  cliplets.rawSegments.some(segment => segment.labelGuess.includes('brake') || segment.labelGuess.includes('compress')),
  'cliplets expose a readable brake/compression label guess',
);
assert.ok(
  cliplets.rawSegments.some(segment => segment.labelGuess.includes('escape') || segment.labelGuess.includes('sprint')),
  'cliplets expose a readable reverse/sprint label guess',
);

const brakeSegment = motionCore.generatedPoseClipletForSourceFrame(cliplets, 18);
assert.ok(brakeSegment, 'cliplet lookup finds the segment containing a source frame');
assert.ok(brakeSegment.startSourceFrame <= 18 && brakeSegment.endSourceFrame >= 18);

const harness = motionCore.buildGeneratedPoseTemporalHarness({
  generatedInput: generatedClip,
  fps: 12,
  filmstripFrames: 8,
});
assert.equal(harness.cliplets.schema, 'kaminos.generated-motion-cliplets.v0');
assert.equal(harness.cliplets.sampleCount, temporalSamples.length);
assert.ok(harness.cliplets.rawSegments.length >= harness.cliplets.segments.length, 'harness keeps raw cliplet evidence alongside phrase cliplets');
assert.ok(harness.filmstrip.every(frame => frame.cliplet?.id), 'harness filmstrip frames carry cliplet evidence');

assert.match(index, /buildGeneratedPoseTemporalCliplets/, 'browser imports or calls the source cliplet slicer');
assert.match(index, /generatedMotionCliplets/, 'browser debug exposes generated motion cliplet evidence');
assert.match(index, /clipletLabel/, 'contact-sheet export records a source cliplet label per frame');
assert.match(index, /generatedPoseClipletForSourceFrame/, 'browser resolves active cliplet by source frame');

assert.match(liveWitness, /clipletLabel/, 'live witness contact-sheet labels expose source cliplet labels');
assert.match(liveWitness, /generatedMotionCliplets/, 'live witness report carries generated motion cliplet evidence');
