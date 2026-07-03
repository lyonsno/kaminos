import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(
  index,
  /kaminos\.generated-motion-path-world-steering-intent\.v0/,
  'path-world sampling must create explicit steering-intent evidence',
);
assert.match(index, /function createMotionPanelPathWorldSteeringIntent/, 'browser creates pre-contact steering intent');
assert.match(index, /applyMotionPanelPathWorldSteeringIntent/, 'browser applies route bias from steering intent before hard contact');
assert.match(index, /pathWorldSteeringIntent/, 'actor/debug evidence exposes path-world steering intent');
assert.match(index, /steeringIntent/, 'steering evidence names the selected steering intent');
assert.match(index, /precontact/, 'steering evidence distinguishes pre-contact steering');
assert.match(index, /hardContact/, 'steering evidence records whether hard contact still occurred');
assert.match(index, /routeBias/, 'steering evidence records the route/root bias');
assert.match(index, /attentionBias/, 'steering evidence records attention bias');
assert.match(index, /rawRoot/, 'steering evidence preserves raw route root before bias');
assert.match(index, /rawTrigger/, 'steering evidence preserves raw trigger evidence before bias');
assert.match(index, /routeAuthority = 'steering'/, 'pre-contact steering can own route authority before hard contact repair');

assert.match(liveWitness, /pathWorldSteeringIntent/, 'live witness records steering-intent evidence');
assert.match(liveWitness, /steeringIntent/, 'live witness labels expose steering intent');
assert.match(liveWitness, /precontact/, 'live witness labels expose pre-contact steering');
