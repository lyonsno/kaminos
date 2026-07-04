import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(witness, /--take-source/, 'live witness exposes an explicit take source selector');
assert.match(witness, /takeSource/, 'live witness report records the effective take source');
assert.match(witness, /loadWitnessMotionSource/, 'live witness has one motion-source loader instead of always regenerating');
assert.match(witness, /previewDurableMotionPanelTake/, 'live witness can load a saved durable take without the generator sidecar');
assert.match(witness, /motion-panel-live-motion-source\.v0/, 'live witness records stable motion-source evidence');
assert.match(
  witness,
  /if\s*\(takeSource === 'generate'\)[\s\S]*generateMotion/,
  'live witness may call generateMotion only for explicit generate take source',
);
assert.doesNotMatch(
  witness,
  /phase = 'generating-motion';\s*const generated = await generateMotion\(ws\);/,
  'live witness must not unconditionally regenerate before every visual smoke',
);
assert.match(index, /window\.previewMotionPanelTemporalFixture/, 'fixture preview is scriptable for no-sidecar witness smokes');
assert.match(index, /window\.resetGeneratedPoseTemporalClock/, 'generated temporal motion exposes a scriptable clock reset for phase-authoritative visual smokes');
assert.match(witness, /resetWitnessMotionClock/, 'live witness resets the temporal motion clock before capturing dynamic frames');
assert.match(witness, /phase = 'resetting-motion-clock'/, 'live witness reports the clock-reset phase instead of hiding phase drift');
assert.match(witness, /motionClockReset/, 'live witness report preserves clock-reset evidence');
assert.match(witness, /const tileWidth = positiveInt\(args\.get\('--tile-width'\), 560, '--tile-width'\)/, 'current-view export smoke defaults to a tile width that exists in the operator UI');
