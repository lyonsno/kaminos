// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCreatureSetup} from '../experiments/creature-motion/setup-projection.mjs';
const transform = x => ({position: [x, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1]});
test('keep chosen behavior while leaving start placement, frame and source intact', () => {
  const baseline = {case: '/original', mode: 'source', rate: 1, sample: 0, cycle: 0, transform: transform(0), play: true};
  const observed = {recipe: {...baseline, case: '/other', rate: 2, sample: 120, cycle: 3, transform: transform(7)}};
  const {document} = projectCreatureSetup({baseline, observed, choices: {rate: true, placement: false, startHere: false}});
  assert.equal(document.rate, 2); assert.equal(document.sample, 0); assert.equal(document.cycle, 0);
  assert.equal(document.case, '/original'); assert.equal(document.play, true); assert.deepEqual(document.transform, transform(0));
});
test('starting here uses an owner-rebased transform and fresh phase, not elapsed journey', () => {
  const baseline = {mode: 'source', rate: 1, sample: 5, cycle: 2, transform: transform(0)};
  const observed = {recipe: {...baseline, sample: 120, transform: transform(7)}, currentPosition: [13, 0, 0], startLocalPositions: {source: [1, 0, 0]}};
  const {document} = projectCreatureSetup({baseline, observed, choices: {startHere: true, placement: false}});
  assert.deepEqual(document.transform, transform(12)); assert.equal(document.sample, 0); assert.equal(document.cycle, 0);
  assert.equal(observed.recipe.sample, 120);
});
test('a different motion requires a matching start anchor before adopting current location', () => {
  const baseline = {mode: 'source', motion_sha256: 'old', transform: transform(0)};
  const observed = {recipe: {...baseline, motion_sha256: 'new'}, startTransforms: {source: transform(12)}};
  assert.throws(() => projectCreatureSetup({baseline, observed, choices: {startHere: true}}), /motion/i);
});
test('keep speed independently of attention and playback mode', () => {
  const baseline={mode:'source',rate:1,sample:5,transform:transform(0),attention:{enabled:true,interests:[]}};
  const observed={recipe:{...baseline,rate:2,mode:'path',attention:{enabled:false,interests:[]}}};
  const {document,groups}=projectCreatureSetup({baseline,observed,choices:{rate:true,mode:false,attention:false}});
  assert.equal(document.rate,2);assert.equal(document.mode,'source');assert.equal(document.sample,5);
  assert.deepEqual(document.attention,baseline.attention);
  assert.ok(groups.some(g=>g.id==='attention'&&g.detail.includes('false')));
});
