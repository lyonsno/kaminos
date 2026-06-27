import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_GENERATED_POSE_OUTPUT_MAP_FIXTURE,
  buildGeneratedPoseOutputMapHarness,
} from '../motion-core.js';

const root = new URL('..', import.meta.url).pathname;
const indexPath = join(root, 'index.html');
const witnessPath = join(root, 'motion-witness.mjs');

assert.ok(existsSync(indexPath), 'index.html must host the motion output-map route');
assert.ok(existsSync(witnessPath), 'motion-witness.mjs must validate the motion output-map route');

const index = readFileSync(indexPath, 'utf8');
const witness = readFileSync(witnessPath, 'utf8');

assert.equal(DEFAULT_GENERATED_POSE_OUTPUT_MAP_FIXTURE.schema, 'kaminos.generated-pose-output-map.v0');
assert.equal(DEFAULT_GENERATED_POSE_OUTPUT_MAP_FIXTURE.ok, true);
assert.ok(
  DEFAULT_GENERATED_POSE_OUTPUT_MAP_FIXTURE.outputSockets.some(socket => socket.id === 'body.scalePulse'),
  'default fixture exposes the scale pulse output socket',
);
assert.ok(
  DEFAULT_GENERATED_POSE_OUTPUT_MAP_FIXTURE.mappingEdges.some(edge => edge.to === 'trail.accent'),
  'default fixture exposes event-to-trail mapping edge',
);

const harness = buildGeneratedPoseOutputMapHarness({
  outputMap: DEFAULT_GENERATED_POSE_OUTPUT_MAP_FIXTURE,
  fps: 12,
  filmstripFrames: 7,
});

assert.equal(harness.schema, 'kaminos.generated-pose-output-map-harness.v0');
assert.equal(harness.route, 'procedural-orb-motion-grammar-v0');
assert.equal(harness.outputMap.schema, 'kaminos.generated-pose-output-map.v0');
assert.equal(harness.outputSocketCount, 7);
assert.equal(harness.edgeCount, 7);
assert.equal(harness.strongestOutput, 'body.scalePulse');
assert.ok(harness.normalizedOutputs['body.scalePulse'].value > 0.95, 'body scale pulse stays visibly dominant');
assert.ok(harness.normalizedOutputs['aura.radius'].value > 0.9, 'aura radius survives as a high output');
assert.equal(harness.normalizedOutputs['trail.accent'].event.channel, 'leftHand');
assert.ok(harness.metrics.maxAuraRadius > 1.25, 'harness turns aura socket into visible radius');
assert.ok(harness.metrics.maxBodyScale > 1.2, 'harness turns scale pulse socket into visible body scale');
assert.ok(harness.metrics.maxTrailAccent > 0.65, 'harness turns event accent socket into visible trail accent');
assert.equal(harness.filmstrip.length, 7);
assert.ok(harness.filmstrip.every(frame => frame.actors.length === 1), 'filmstrip records one mapped orb actor');

assert.match(index, /DEFAULT_GENERATED_POSE_OUTPUT_MAP_FIXTURE/, 'browser imports default output-map fixture');
assert.match(index, /buildGeneratedPoseOutputMapHarness/, 'browser imports output-map runtime harness');
assert.match(index, /motion-output-map-enable/, 'motion tab exposes output-map route button');
assert.match(index, /kaminos_motion_output_map=1/, 'browser declares the output-map route param');
assert.match(index, /createGeneratedPoseOutputMapScene/, 'browser creates the output-map route scene');
assert.match(index, /updateGeneratedPoseOutputMapFrame/, 'render loop advances output-map actor');
assert.match(index, /window\.kaminosGeneratedPoseOutputMapDebugState/, 'browser exposes output-map debug state');

assert.match(witness, /isOutputMapRoute/, 'motion witness detects the output-map route');
assert.match(witness, /buildGeneratedPoseOutputMapHarness/, 'motion witness builds deterministic output-map filmstrip');
assert.match(witness, /window\.kaminosGeneratedPoseOutputMapDebugState/, 'motion witness reads output-map browser state');
assert.match(witness, /generatedPoseOutputMapHarness/, 'motion witness reports output-map harness evidence');
assert.match(witness, /body\.scalePulse/, 'motion witness validates dominant scale-pulse output');
assert.match(witness, /aura\.radius/, 'motion witness validates aura output');
assert.match(witness, /trail\.accent/, 'motion witness validates trail accent output');
