// kaminos-test: node
// The fire witness's verdicts must not pass for the wrong reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fireStripVerdict, proxyFreePickMapVerdict} from '../agent-vantage-witness-checks.mjs';

const frame = (writeTick, image) => ({proxies: {fire: 'drawn'}, proxySnapshots: {fire: {writeTick, fieldGeneration: 1}}, image});

test('a strip whose source identities advance but whose pictures are all the same does not pass', () => {
  const frozen = fireStripVerdict({frames: [1, 2, 3].map(i => frame(i * 16, 'same-bytes'))});
  assert.equal(frozen.ok, false);
  assert.match(frozen.reasons.join(' '), /identical/);
  const moving = fireStripVerdict({frames: [frame(16, 'a'), frame(32, 'b'), frame(48, 'c')]});
  assert.equal(moving.ok, true, moving.reasons.join('; '));
  assert.deepEqual([moving.identities, moving.distinctPictures], [3, 3]);
});

test('a strip that drew the flame from one source record does not pass however its pictures differ', () => {
  const held = fireStripVerdict({frames: [frame(16, 'a'), frame(16, 'b'), frame(16, 'c')]});
  assert.equal(held.ok, false);
  assert.match(held.reasons.join(' '), /one fire snapshot/);
});

test('a strip with a frame that did not draw the flame proxy does not pass', () => {
  const partial = fireStripVerdict({frames: [frame(16, 'a'), {...frame(32, 'b'), proxies: {fire: 'awaiting-snapshot'}}, frame(48, 'c')]});
  assert.equal(partial.ok, false);
});

test('an absent or failed pick map cannot stand for one that drew no proxy', () => {
  assert.equal(proxyFreePickMapVerdict({pickMap: null, pickMapError: 'readback failed', image: {width: 640, height: 360}}).ok, false);
  assert.equal(proxyFreePickMapVerdict({pickMap: {width: 320, height: 180, objects: []}, image: {width: 640, height: 360}}).ok, false, 'a map of another size is not this picture\'s');
  assert.equal(proxyFreePickMapVerdict({pickMap: {width: 640, height: 360}, image: {width: 640, height: 360}}).ok, false, 'a map without its object table');
  const withProxy = proxyFreePickMapVerdict({pickMap: {width: 640, height: 360, objects: [{n: 4, id: null, name: 'Fire proxy glow splats'}]}, image: {width: 640, height: 360}});
  assert.equal(withProxy.ok, false);
  assert.equal(proxyFreePickMapVerdict({pickMap: {width: 640, height: 360, objects: [{n: 1, id: 'box', name: 'Box'}]}, image: {width: 640, height: 360}}).ok, true);
});
