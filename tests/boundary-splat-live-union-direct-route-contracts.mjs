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
  'private-source-control-coordination-ref',
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
  /postLoadControlMutation:\s*initialControlSha256 !== finalControlSha256[\s\S]*postLoadCompositionMutation:\s*initialCompositionSha256 !== finalCompositionSha256/,
  'direct-route authority must measure hidden post-load control and composition mutation',
);
assert.match(
  witness,
  /directRouteAppliedPasses\?\.splatRasterRequested,\s*true[\s\S]*directRouteAppliedPasses\?\.rendererIdentity,\s*RENDERER[\s\S]*selectiveHeadLivePassReceipt\?\.raymarchApplied,\s*true[\s\S]*selectiveHeadLivePassReceipt\?\.splatApplied,\s*true/,
  'direct-route authority must require the exact union renderer and both requested passes',
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
