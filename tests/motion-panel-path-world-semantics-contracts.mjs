import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(
  index,
  /kaminos\.generated-motion-path-world-encounter-semantics\.v0/,
  'path-world encounters must create explicit encounter semantics evidence',
);
assert.match(index, /function createMotionPanelPathWorldEncounterSemantics/, 'browser creates episode-owned encounter semantics');
assert.match(index, /pathWorldEncounterSemantics/, 'actor/debug evidence exposes encounter semantics');
assert.match(index, /encounterArchetype/, 'encounter semantics reports a bounded archetype');
assert.match(index, /encounterIntent/, 'encounter semantics reports an operator-readable intent');
assert.match(index, /trajectoryProfile/, 'encounter semantics selects a trajectory profile');
assert.match(index, /attentionMode/, 'encounter semantics selects an attention mode');
assert.match(index, /exitBias/, 'encounter semantics records exit-side bias');
assert.match(index, /'avoid'/, 'encounter archetypes include avoid');
assert.match(index, /'inspect'/, 'encounter archetypes include inspect');
assert.match(index, /'bump'/, 'encounter archetypes include bump');
assert.match(index, /'recoil'/, 'encounter archetypes include recoil');
assert.match(index, /semanticsId/, 'encounter semantics has stable episode-local identity');
assert.match(index, /profileTuning/, 'trajectory construction consumes semantic profile tuning');

assert.match(liveWitness, /pathWorldEncounterSemantics/, 'live witness records encounter semantics');
assert.match(liveWitness, /encounterArchetype/, 'live witness labels expose encounter archetype');
assert.match(liveWitness, /trajectoryProfile/, 'live witness labels expose trajectory profile');
