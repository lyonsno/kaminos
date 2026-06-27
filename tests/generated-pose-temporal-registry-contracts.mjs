import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildGeneratedPoseTemporalHarness,
  generatedPoseTemporalClipById,
  normalizeGeneratedPoseTemporalRegistry,
} from '../motion-core.js';

const root = new URL('..', import.meta.url).pathname;
const registryPath = join(root, 'fixtures/generated-pose-temporal/kimodo-matrix.v0.json');
const indexPath = join(root, 'index.html');
const witnessPath = join(root, 'motion-witness.mjs');

assert.ok(existsSync(registryPath), 'Kaminos must ship a generated-pose temporal clip registry fixture');
const registry = normalizeGeneratedPoseTemporalRegistry(JSON.parse(readFileSync(registryPath, 'utf8')));

assert.equal(registry.schema, 'kaminos.generated-pose-temporal-registry.v0');
assert.equal(registry.sourceModel, 'Kimodo');
assert.ok(registry.clips.length >= 6, 'registry exposes the Kimodo matrix, not only the theatrical bow');
assert.deepEqual(
  registry.clips.map(clip => clip.id),
  [...new Set(registry.clips.map(clip => clip.id))],
  'registry clip ids are unique',
);
assert.ok(registry.clips.every(clip => clip.schema === 'kaminos.generated-pose-temporal.v0'), 'registry entries are temporal clip fixtures');
assert.ok(registry.clips.every(clip => clip.sourceFormat === 'kimodo-soma77-explicit-joints'), 'registry preserves SOMA77 source format per clip');
assert.ok(registry.clips.every(clip => clip.temporalSamples.length >= 16), 'each bundled clip preserves a useful temporal sample track');

const bow = generatedPoseTemporalClipById('kimodo_theatrical_bow_temporal_v0', registry);
const sneak = generatedPoseTemporalClipById('kimodo_cautious_sneak_temporal_v0', registry);
const dance = generatedPoseTemporalClipById('kimodo_energetic_dance_temporal_v0', registry);
assert.match(bow.sourceRoute, /03_a_person_performs_an_exaggerated_theatrical_bow_sw\.npz/);
assert.match(sneak.sourceRoute, /01_a_person_sneaks_forward_very_cautiously_crouching_\.npz/);
assert.match(dance.sourceRoute, /04_a_person_does_an_energetic_hip_hop_dance_with_big_\.npz/);
assert.notEqual(sneak.inputSha256, bow.inputSha256, 'clip selection changes source identity');

const harness = buildGeneratedPoseTemporalHarness({
  generatedInput: sneak,
  fps: 12,
  filmstripFrames: 7,
});
assert.equal(harness.track.id, 'kimodo_cautious_sneak_temporal_v0');
assert.equal(harness.registryClipId, 'kimodo_cautious_sneak_temporal_v0');
assert.equal(harness.registrySource, 'fixtures/generated-pose-temporal/kimodo-matrix.v0.json');
assert.match(harness.sourceRoute, /01_a_person_sneaks_forward_very_cautiously_crouching_\.npz/);
assert.notEqual(harness.sourceRoute, bow.sourceRoute, 'harness must consume the selected clip rather than falling back to bow');

const index = readFileSync(indexPath, 'utf8');
assert.match(index, /kaminos_generated_pose_temporal_clip/, 'browser route accepts a generated-pose temporal clip id');
assert.match(index, /loadGeneratedPoseTemporalRegistry/, 'browser loads the temporal clip registry seam');
assert.match(index, /generatedPoseTemporalClipById/, 'browser selects temporal clip by source-preserving id');
assert.match(index, /kimodo_cautious_sneak_temporal_v0/, 'browser exposes non-bow temporal clips for operator experimentation');
assert.match(index, /horizontalDisplayScale/, 'browser route auto-scales high-travel temporal clips for smokeable framing');

const witness = readFileSync(witnessPath, 'utf8');
assert.match(witness, /kaminos_generated_pose_temporal_clip/, 'motion witness preserves requested temporal clip id');
assert.match(witness, /kimodo_cautious_sneak_temporal_v0/, 'motion witness can validate a non-bow temporal clip route');
assert.match(witness, /registryClipId/, 'motion witness reports the effective temporal registry clip id');
