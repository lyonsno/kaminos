import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const source = readFileSync(join(root, 'index.html'), 'utf8');
const mountContract = readFileSync(join(root, 'wake-volume-settings-preset-mount.mjs'), 'utf8');
const schema = JSON.parse(readFileSync(join(root, 'volume-settings-preset-schema-v2.json'), 'utf8'));

for (const entry of [...schema.controls, ...schema.rendererControls]) {
  assert.match(
    source,
    new RegExp(`id=["']${entry.key}["']`),
    `Wake host must expose canonical preset control ${entry.key}`,
  );
}

assert.match(
  mountContract,
  /wake_fire_preset/,
  'Wake must accept a stable caller-selected fire-preset handle',
);
assert.match(
  source + mountContract,
  /__kaminosWakeFirePresetMountReceipt/,
  'the product route must expose the exact requested/effective mount identity',
);
assert.match(
  source,
  /ensureKaminosVolumeRouteInitialized\(\)[\s\S]*mountWakeFirePreset[\s\S]*applyKilnContentionFireBudget\(\)/,
  'the authored basin must mount after the real engine initializes and before Wake reapplies its product budget',
);
assert.match(
  source,
  /mountWakeFirePreset[\s\S]*volume-boundary-splat-mode[\s\S]*['"]off['"]/,
  'the mounted product presentation must remove boundary splats instead of merely hiding them',
);
assert.match(
  source,
  /id="crucible-viewport-fire-preset"/,
  'the actual Crucible product surface must show which stable handle and immutable revision it mounted',
);
