import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VOLUME_SETTINGS_PRESET_VISUAL_VIEWS } from '../volume-settings-preset-contract.mjs';

const root = join(import.meta.dirname, '..');
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.deepEqual(Object.keys(VOLUME_SETTINGS_PRESET_VISUAL_VIEWS), ['raymarch-only']);
assert.equal(index.includes('id="settings-preset-inspect-fresh"'), false);
assert.equal(index.includes('id="settings-preset-view"'), false);
assert.equal(index.includes('id="settings-preset-load-here"'), true);
assert.equal(index.includes('id="settings-preset-open-fresh"'), true);

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
