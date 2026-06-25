import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildGeneratedPoseTemporalBehaviorState,
  buildGeneratedPoseTemporalHarness,
  generatedPoseTemporalClipById,
  normalizeGeneratedPoseTemporalRegistry,
  sampleGeneratedPoseTemporalMotion,
} from '../motion-core.js';

const root = new URL('..', import.meta.url).pathname;
const registryPath = join(root, 'fixtures/generated-pose-temporal/kimodo-matrix.v0.json');
const indexPath = join(root, 'index.html');
const witnessPath = join(root, 'motion-witness.mjs');

const registry = normalizeGeneratedPoseTemporalRegistry(JSON.parse(readFileSync(registryPath, 'utf8')));
const sneak = generatedPoseTemporalClipById('kimodo_cautious_sneak_temporal_v0', registry);
const harness = buildGeneratedPoseTemporalHarness({ generatedInput: sneak, fps: 12, filmstripFrames: 7 });

for (const t of [0.1, 1.2, 2.4, 4.8]) {
  const sample = sampleGeneratedPoseTemporalMotion(harness.track, t);
  const state = buildGeneratedPoseTemporalBehaviorState({
    track: harness.track,
    sample,
    temporalSample: sample.temporalSample,
    target: { id: 'target', kind: 'attention-anchor' },
    anchor: { id: 'anchor', kind: 'spawn-anchor' },
  });
  assert.notEqual(state.state, 'wandering', `cautious-sneak must not fall back to wandering at ${t}s`);
}

const index = readFileSync(indexPath, 'utf8');
assert.match(index, /createWorldSpaceBehaviorReadout/, 'browser creates a world-space behavior readout visual');
assert.match(index, /generated-pose-temporal-behavior-ground-ring/, 'readout includes a named ground ring');
assert.match(index, /generated-pose-temporal-behavior-ground-label/, 'readout includes a named ground label');
assert.match(index, /floor-facing-world-space/, 'readout debug exposes floor-facing world-space orientation');
assert.match(index, /partial-ground-ring/, 'readout debug exposes the partial ring style');
assert.match(index, /updateWorldSpaceBehaviorReadout/, 'temporal route updates readout from behavior state');
assert.match(index, /behaviorReadout/, 'browser debug reports the behavior readout payload');

const witness = readFileSync(witnessPath, 'utf8');
assert.match(witness, /behaviorReadout/, 'motion witness records the world-space behavior readout');
assert.match(witness, /floor-facing-world-space/, 'motion witness validates floor-facing readout orientation');
assert.match(witness, /partial-ground-ring/, 'motion witness validates readout ring style');
