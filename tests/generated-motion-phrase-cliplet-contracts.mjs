import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildGeneratedPoseTemporalCliplets,
  buildGeneratedPoseClipletPlayback,
} from '../motion-core.js';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function poseSample(frame, phaseLabel, rootZ, compression = 0.1) {
  return {
    frame,
    sourceFrame: frame,
    time: Number((frame / 30).toFixed(5)),
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
  poseSample(0, 'enter', 0.00, 0.08),
  poseSample(1, 'enter', 0.04, 0.08),
  poseSample(2, 'enter', 0.09, 0.08),
  poseSample(3, 'notice', 0.12, 0.12),
  poseSample(4, 'notice', 0.13, 0.12),
  poseSample(5, 'commit', 0.20, 0.18),
  poseSample(6, 'brake', 0.225, 0.83),
  poseSample(7, 'commit', 0.29, 0.26),
  poseSample(8, 'brake', 0.305, 0.86),
  poseSample(9, 'commit', 0.37, 0.24),
  poseSample(10, 'brake', 0.38, 0.82),
  poseSample(11, 'escape', 0.23, 0.42),
  poseSample(12, 'escape', 0.05, 0.32),
  poseSample(13, 'escape', -0.13, 0.24),
  poseSample(14, 'settle', -0.17, 0.14),
  poseSample(15, 'settle', -0.18, 0.12),
  poseSample(16, 'settle', -0.18, 0.12),
];

const generatedClip = {
  schema: 'kaminos.generated-pose-temporal.v0',
  id: 'synthetic_phrase_coalescing_source',
  label: 'Synthetic Phrase Coalescing Source',
  intent: 'a man approaches, jitters through several small brake impacts, then escapes and settles',
  sourceKind: 'motion-panel-generated-pose-temporal',
  sourceStatus: 'test-fixture',
  sourceModel: 'contract-synthetic',
  sourceRoute: 'tests/generated-motion-phrase-cliplet-contracts.mjs',
  sourceFrameStride: 1,
  rawFrameCount: temporalSamples.length,
  fps: 30,
  duration: temporalSamples.at(-1).time,
  temporalSamples,
};

const cliplets = buildGeneratedPoseTemporalCliplets(generatedClip);

assert.equal(cliplets.schema, 'kaminos.generated-motion-cliplets.v0');
assert.equal(cliplets.segmentation.outputLayer, 'phrase', 'operator-facing cliplets default to the phrase layer');
assert.ok(Array.isArray(cliplets.rawSegments), 'raw cliplets remain exposed as source evidence');
assert.ok(Array.isArray(cliplets.segments), 'phrase cliplets remain exposed through the existing segments field');
assert.ok(cliplets.rawSegments.length > cliplets.segments.length, 'phrase coalescing reduces crumbly raw segmentation');
assert.ok(
  cliplets.rawSegments.some(segment => segment.labelGuess.includes('brake')),
  'raw evidence still exposes tiny brake/compress crumbs',
);

const coalesced = cliplets.segments.find(segment => (
  Array.isArray(segment.rawSegmentIds)
  && segment.rawSegmentIds.length >= 3
  && String(segment.labelGuess).includes('approach')
  && String(segment.labelGuess).includes('brake')
));
assert.ok(coalesced, 'rapid approach/brake alternation becomes one operator-facing phrase cliplet');
assert.equal(coalesced.schema, 'kaminos.generated-motion-phrase-cliplet-segment.v0');
assert.equal(coalesced.layer, 'phrase');
assert.ok(coalesced.rawSegmentRange.startIndex <= coalesced.rawSegmentRange.endIndex, 'merged phrase records raw child index range');
assert.deepEqual(
  coalesced.rawSegmentIds,
  cliplets.rawSegments
    .filter(raw => raw.index >= coalesced.rawSegmentRange.startIndex && raw.index <= coalesced.rawSegmentRange.endIndex)
    .map(raw => raw.id),
  'merged phrase raw child ids match the raw child range',
);
assert.ok(coalesced.coalescing.reasons.includes('short-compatible-phrase'), 'merged phrase records a coalescing reason');
assert.equal(coalesced.startSourceFrame, cliplets.rawSegments[coalesced.rawSegmentRange.startIndex].startSourceFrame);
assert.equal(coalesced.endSourceFrame, cliplets.rawSegments[coalesced.rawSegmentRange.endIndex].endSourceFrame);

const playback = buildGeneratedPoseClipletPlayback({
  cliplets,
  segmentIds: [coalesced.id],
  mode: 'loop',
});
assert.equal(playback.segments[0].sourceSegmentId, coalesced.id, 'playback accepts phrase cliplet ids');
assert.deepEqual(playback.segments[0].rawSegmentIds, coalesced.rawSegmentIds, 'playback preserves raw child evidence for phrase cliplets');

assert.match(index, /rawSegments/, 'browser debug/export state preserves raw cliplet evidence');
assert.match(index, /phrase/, 'browser names the phrase cliplet layer');
assert.match(index, /rawSegmentIds/, 'browser-visible/exported cliplets carry raw child ids');
