import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  mapGeneratedPoseTemporalGroundedDisplaySample,
} from '../motion-core.js';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');

const displayOptions = {
  horizontalDisplayScale: 2.2,
  verticalDisplayScale: 5,
  attentionVerticalScale: 2.2,
  baseY: 0.24,
  floorY: 0,
  minCenterY: 0.18,
};

const buriedSource = {
  root: [0.12, -0.22, -0.04],
  attention: [0.2, -0.18, 0.32],
  head: [0.2, -0.18, 0.32],
};
const grounded = mapGeneratedPoseTemporalGroundedDisplaySample(buriedSource, displayOptions);

assert.equal(grounded.schema, 'kaminos.generated-pose-temporal-grounded-display.v0');
assert.equal(grounded.mode, 'grounded-default');
assert.equal(grounded.sourceVerticalPolicy, 'ground-negative-preserve-positive');
assert.ok(grounded.unclampedRootY < 0, 'fixture must represent a source pose that would have buried the orb pre-fix');
assert.ok(grounded.root[1] >= displayOptions.minCenterY, 'default display mapper must not drive the visible orb center below the floor guard');
assert.ok(grounded.attention[1] >= displayOptions.floorY + 0.08, 'grounded attention target must not make a low pose look underground');
assert.ok(grounded.belowFloorDepth > 0, 'grounding evidence records how much source display would have gone below floor');
assert.ok(grounded.groundedCompression > 0, 'below-floor source energy is converted into compression evidence');
assert.deepEqual(grounded.rawRoot, buriedSource.root, 'grounded mapper preserves raw source root evidence');
assert.deepEqual(grounded.rawAttention, buriedSource.attention, 'grounded mapper preserves raw source attention evidence');

const neutral = mapGeneratedPoseTemporalGroundedDisplaySample({
  root: [0, 0, 0],
  attention: [0, 0.16, 0.2],
}, displayOptions);
const lifted = mapGeneratedPoseTemporalGroundedDisplaySample({
  root: [0, 0.12, 0],
  attention: [0, 0.28, 0.2],
}, displayOptions);

assert.equal(neutral.belowFloorDepth, 0, 'neutral source root should not manufacture grounding compression');
assert.ok(lifted.root[1] > neutral.root[1], 'positive source vertical motion remains visible as lift');
assert.equal(lifted.groundedCompression, 0, 'positive lift should not be treated as floor collision compression');

assert.match(index, /mapGeneratedPoseTemporalGroundedDisplaySample/, 'browser temporal route must use the same grounded display mapper as the contract');
assert.match(index, /sourceVerticalPolicy/, 'browser debug evidence must name the grounding policy');
assert.match(index, /displayCompression/, 'browser actor evidence must distinguish visible compression from raw source compression');
assert.match(index, /rawRoot/, 'browser actor evidence must preserve raw root beside grounded display root');
