import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessControlledStepSequence } from '../volume-controlled-step-sequence-contract.mjs';

const frame = (index, before, after, session = 'browser-a') => ({
  sameBrowserSessionId: session,
  controlledStepFrameIndex: index,
  controlledStepCapture: {
    ok: true,
    sampleAuthority: index === 0 ? 'controlled-step-initial-state' : 'controlled-step-sim-advance',
    beforeSimStepCount: before,
    afterSimStepCount: after,
  },
  captures: [{
    role: 'high',
    requestedRenderScale: 1,
    renderWidth: 48,
    renderHeight: 32,
    imageWidth: 48,
    imageHeight: 32,
    simStepCount: after,
    sameStateCaptureId: `${session}-frame-${index}`,
    image: {
      path: `/evidence/frame-${index}.png`,
      authority: 'gpu-presentation-texture-rgba8-readback-frozen-sim-state',
      sha256: String(index).padStart(64, '0'),
      sourceSimStepCount: after,
      sourceSameStateCaptureId: `${session}-frame-${index}`,
    },
  }],
});

const initialOnly = assessControlledStepSequence([frame(0, 12, 12)], 1, [1]);
assert.equal(initialOnly.sampleAuthority, 'controlled-step-initial-state');
assert.equal(initialOnly.frameEvidenceComplete, true);
assert.equal('movementSequenceSuitable' in initialOnly, false);
assert.equal(initialOnly.sameBrowserSequenceSuitable, true);

const advancing = assessControlledStepSequence([
  frame(0, 12, 12), frame(1, 12, 13), frame(2, 13, 14),
], 3, [1]);
assert.equal(advancing.sampleAuthority, 'controlled-step-sim-advance');
assert.equal(advancing.frameEvidenceComplete, true);
assert.equal(advancing.stepSequenceVerified, true);
assert.equal('movementSequenceSuitable' in advancing, false);
assert.deepEqual(advancing.simStepCounts, [12, 13, 14]);

const visuallyUnchanged = [frame(0, 12, 12), frame(1, 12, 13)];
visuallyUnchanged[1].captures[0].image.sha256 = visuallyUnchanged[0].captures[0].image.sha256;
assert.equal(assessControlledStepSequence(visuallyUnchanged, 2, [1]).frameEvidenceComplete, true,
  'identical image hashes must not be mistaken for a failed capture or a visual verdict');

for (const [name, frames] of [
  ['stalled second frame', [frame(0, 12, 12), frame(1, 12, 12)]],
  ['stale image after step', [frame(0, 12, 12), { ...frame(1, 12, 13), captures: [{ simStepCount: 12 }] }]],
  ['partial 1x1 readback', [frame(0, 12, 12), {
    ...frame(1, 12, 13),
    captures: [{ ...frame(1, 12, 13).captures[0], imageWidth: 1, imageHeight: 1 }],
  }]],
  ['missing GPU image', [frame(0, 12, 12), {
    ...frame(1, 12, 13),
    captures: [{ ...frame(1, 12, 13).captures[0], image: null }],
  }]],
  ['different browser', [frame(0, 12, 12), frame(1, 12, 13, 'browser-b')]],
  ['skipped recorded transition', [frame(0, 12, 12), frame(1, 11, 13)]],
]) {
  const assessment = assessControlledStepSequence(frames, 2, [1]);
  assert.equal(assessment.frameEvidenceComplete && assessment.stepSequenceVerified, false, name);
}

assert.equal(assessControlledStepSequence([frame(0, 12, 12), frame(1, 12, 13)], 2, [1, 0.5]).frameEvidenceComplete, false,
  'missing a requested render scale must not look like a complete frame set');

const witness = readFileSync(new URL('../volume-witness.mjs', import.meta.url), 'utf8');
assert.match(witness, /assessControlledStepSequence\(frames, controlledStepFrames, renderScaleSet\)/);
assert.match(witness, /sampleAuthority: sequenceAssessment\.sampleAuthority/);
assert.match(witness, /frameEvidenceComplete: sequenceAssessment\.frameEvidenceComplete/);
assert.match(witness, /if \(!controlledStepSequenceReport\.frameEvidenceComplete/);
assert.doesNotMatch(witness, /movementSequenceSuitable/);
assert.match(witness, /includeRgba: true/);
assert.match(witness, /sourceSameStateCaptureId: canvasCapture\.sameStateCaptureId/);
assert.match(witness, /partialControlledStepFrames/);
assert.match(witness, /phase = 'controlled-step-sequence'/);
assert.match(witness, /const requestedCameraPose =/);
assert.match(witness, /replayCaptureCamera\(ws, \{ camera: requestedCameraPose \}\)/);
assert.match(witness, /cameraPose: \{ requested: requestedCameraPose, applied: appliedCameraPose \}/);

console.log('volume controlled-step sequence contracts passed');
