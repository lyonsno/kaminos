import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveVolumeSettingsPresetVisualView } from '../volume-settings-preset-contract.mjs';

const root = join(import.meta.dirname, '..');
const index = readFileSync(join(root, 'index.html'), 'utf8');

const cleanOrdinaryState = {
  status: 'running',
  source: 'ordinary-live-prototype',
  requestedComposition: 'smoke-raymarch-under-splats-v0',
  effectiveComposition: 'smoke-raymarch-under-splats-v0',
  fallbackReason: null,
  compositionFallbackReason: null,
  boundarySplatFallbackReason: null,
};

assert.equal(
  resolveVolumeSettingsPresetVisualView('current', cleanOrdinaryState),
  'smoke-hybrid',
  'the ordinary live viewer resolves its clean effective composition instead of requiring a selective wrapper',
);
assert.equal(
  resolveVolumeSettingsPresetVisualView('splat-only', null),
  'splat-only',
  'an explicit invocation-scoped view does not depend on current renderer state',
);
assert.throws(
  () => resolveVolumeSettingsPresetVisualView('current', {
    ...cleanOrdinaryState,
    effectiveComposition: 'splat-only-v0',
  }),
  /requested.*effective|substitut/i,
  'ordinary current-view resolution rejects silent composition substitution',
);
assert.throws(
  () => resolveVolumeSettingsPresetVisualView('current', {
    ...cleanOrdinaryState,
    boundarySplatFallbackReason: 'boundary-splat-route-unavailable',
  }),
  /boundary-splat-route-unavailable/,
  'ordinary current-view resolution reports the exact renderer fallback',
);

assert.match(
  index,
  /function currentVolumeSettingsPresetRendererState\(\)[\s\S]*__kaminosSelectiveHeadLive[\s\S]*__kaminosVolumePrototype[\s\S]*selectiveHeadLiveCompositionRequested[\s\S]*selectiveHeadLiveCompositionEffective/,
  'current-view loading reads both selective-wrapper and ordinary-live requested/effective composition receipts',
);
assert.match(
  index,
  /id="volume-settings-preset-state"[^>]*role="status"[^>]*aria-live="polite"/,
  'preset diagnostics are announced as live operator status',
);
assert.match(
  index,
  /#volume-settings-preset-state\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere[^}]*user-select:\s*text[^}]*\}/,
  'preset diagnostics wrap and remain selectable instead of inheriting the compact readout ellipsis',
);

console.log('volume settings preset view resolution contracts passed');
