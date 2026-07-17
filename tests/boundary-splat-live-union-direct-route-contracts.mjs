#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../volume-live-nonridge-union-witness.mjs', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

for (const token of [
  "args.has('--direct-route')",
  "identity: 'live-union-direct-route-pre-mutation-v0'",
  'directRouteReceipt',
  'directRouteRequestedControls',
  'directRouteEffectiveControls',
  'directRouteControlSubstitutions',
  'directRouteCandidateCounts',
  'directRouteAppliedPasses',
  'selectiveHeadLivePassReceipt',
  'splatApplied',
  'directRouteSourceMaturity',
]) {
  assert.match(witness, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `direct-route witness must preserve ${token}`);
}

assert.match(
  witness,
  /if \(directRoute\)[\s\S]*sampleBoundarySplatFootprintAudit[\s\S]*direct-route-union-candidate-population-is-zero/,
  'direct-route mode must audit the URL-applied renderer before accepting candidate population',
);
assert.match(
  witness,
  /if \(directRoute\)[\s\S]*postLoadControlMutation: false[\s\S]*postLoadCompositionMutation: false/,
  'direct-route authority must reject hidden post-load control or composition mutation',
);
const compositionState = core.match(
  /function updateSelectiveHeadLiveCompositionState\(\) \{[\s\S]*?(?=\n  function recordSelectiveHeadLivePassReceipt)/,
)?.[0] || '';
assert.match(
  compositionState,
  /state\.selectiveHeadLiveEffectiveRole === 'off'[\s\S]*boundarySplatRequested\(\)\s*\?\s*request\.requested\s*:\s*'off'/,
  'an explicit boundary-splat route must not be suppressed merely because selective state role is off',
);

console.log('boundary splat live union direct-route contracts passed');
