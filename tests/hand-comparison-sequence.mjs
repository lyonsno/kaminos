// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparisonSequence} from '../experiments/hand-comparison-sequence.mjs';

const fixture = () => ({
  status: 'rendered', authority: 'recorded_diagnostic_not_live', interactionAuthority: false,
  errors: [], decodedVideoFrames: 3,
  frames: [100, 260, 510].map((captureOffsetMs, i) => ({
    file: `frames/${String(i).padStart(4,'0')}.png`, captureOffsetMs, sourceSequence: i + 1,
  })),
});

test('retains every frame and uses source timestamps without interpolation', () => {
  const r = fixture(), s = comparisonSequence(r);
  assert.equal(s.length, 3);
  assert.equal(s.durationMs, 410);
  assert.equal(s.atTime(0), 0);
  assert.equal(s.atTime(159), 0);
  assert.equal(s.atTime(160), 1);
  assert.equal(s.atTime(410), 2);
  assert.equal(s.frame(1).captureOffsetMs, 260);
  assert.throws(() => s.frame(3), /frame/);
  assert.throws(() => s.atTime(NaN), /time/);
});

test('rejects live, partial, unordered, unsafe and failed evidence', () => {
  for (const change of [
    r => {r.authority = 'live';},
    r => {r.interactionAuthority = true;},
    r => {r.status = 'failed';},
    r => {r.errors.push('browser failure');},
    r => {r.frames.pop();},
    r => {r.frames[1].captureOffsetMs = 100;},
    r => {r.frames[1].sourceSequence = 1;},
    r => {r.frames[1].file = '../wrong.png';},
  ]) {
    const r = fixture(); change(r);
    assert.throws(() => comparisonSequence(r));
  }
});
