import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const raymarchStart = core.indexOf('let expensiveSampleBudget = u32(ceil(steps));');
const raymarchEnd = core.indexOf('t = t + localDt;', raymarchStart);
assert.ok(raymarchStart >= 0 && raymarchEnd > raymarchStart, 'production raymarch loop is discoverable');
const raymarch = core.slice(raymarchStart, raymarchEnd + 't = t + localDt;'.length);

assert.match(
  raymarch,
  /let occupancySkipStrength = clamp\(u\.occupancy_controls\.x,[\s\S]*let directSupport = directCellOpticalSupport\(p\);/,
  'occupancy strength is available at the conservative empty-cell decision',
);
assert.match(
  raymarch,
  /if \(!fullGridCapture && directSupport <= 0\.0001\) \{[\s\S]*directCellExitDistance\(p, rd\)[\s\S]*occupancySkipStrength[\s\S]*continue;/,
  'occupancy acceleration acts only inside a conservatively proven-empty cell',
);
assert.doesNotMatch(
  raymarch,
  /emptySpanScale[\s\S]*continue;/,
  'a reconstructed low-occupancy sample cannot be discarded before compositing',
);
assert.doesNotMatch(
  core,
  /fn occupancySkipStepScale\(/,
  'the retired low-support discard operator cannot remain as a second occupancy authority',
);

console.log('volume occupancy skip: conservative empty cells accelerate without deleting supported ridge samples');
