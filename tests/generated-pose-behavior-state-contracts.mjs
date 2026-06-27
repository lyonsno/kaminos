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
const sample = sampleGeneratedPoseTemporalMotion(harness.track, 2.4);
const state = buildGeneratedPoseTemporalBehaviorState({
  track: harness.track,
  sample,
  temporalSample: sample.temporalSample,
  target: { id: 'stage-attention-target', kind: 'attention-anchor' },
  anchor: { id: 'stage-home-anchor', kind: 'spawn-anchor' },
});

assert.equal(state.schema, 'kaminos.generated-motion-behavior-state.v0');
assert.equal(state.clipId, 'kimodo_cautious_sneak_temporal_v0');
assert.equal(state.sourceKind, 'generated-pose-temporal');
assert.equal(state.sourceModel, 'Kimodo');
assert.match(state.sourceRoute, /01_a_person_sneaks_forward_very_cautiously_crouching_\.npz/);
assert.ok(['approaching', 'hesitating', 'performing-flourish', 'returning-to-anchor', 'noticed-target'].includes(state.state), 'state uses the visible behavior grammar');
assert.ok(state.target?.id, 'behavior state preserves target context for inspection');
assert.ok(state.anchor?.id, 'behavior state preserves anchor context for inspection');
assert.ok(state.reason && state.reason.includes(state.phase), 'behavior state carries a compact reason tied to phase evidence');
assert.ok(state.evidence?.sourceFrame >= 0, 'behavior state exposes source-frame evidence');
assert.ok(state.evidence?.sampler === 'catmull-rom-continuous-velocity', 'behavior state preserves temporal sampler evidence');
assert.ok(state.evidence?.effort >= 0, 'behavior state exposes effort evidence');
assert.equal(state.visibility, 'inspectable-not-canvas-label', 'state labels are inspection/debug scaffolding, not mandatory canvas text');

const index = readFileSync(indexPath, 'utf8');
assert.match(index, /buildGeneratedPoseTemporalBehaviorState/, 'browser imports generated temporal behavior-state builder');
assert.match(index, /behaviorState/, 'browser temporal actor debug exposes behavior state');
assert.match(index, /inspectable-not-canvas-label/, 'browser preserves the no-main-canvas-label visibility contract');

const witness = readFileSync(witnessPath, 'utf8');
assert.match(witness, /behaviorState/, 'motion witness records generated temporal behavior state');
assert.match(witness, /kaminos.generated-motion-behavior-state.v0/, 'motion witness validates behavior-state schema');
assert.match(witness, /inspectable-not-canvas-label/, 'motion witness rejects label-as-primary-surface drift');
