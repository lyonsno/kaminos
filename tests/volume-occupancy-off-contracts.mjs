import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const start = core.indexOf('    let occupancySkipStrength = clamp(u.occupancy_controls.x, 0.0, 1.0);');
const end = core.indexOf('    if (!fullGridCapture && directSupport <= 0.0001)', start);
assert.ok(start >= 0 && end > start, 'support admission block is present');
// This scalar WGSL block is also valid JavaScript; exercise the production gate itself.
const admission = new Function('u', 'fullGridCapture', 'p', 'clamp', 'directCellOpticalSupport',
  `${core.slice(start, end)}\nreturn directSupport;`);
for (const fullGridCapture of [false, true]) {
  for (const strength of [0, 0.000001, 0.35, 1]) {
    let reads = 0;
    const support = admission({ occupancy_controls: { x: strength } }, fullGridCapture, {},
      (v, lo, hi) => Math.min(hi, Math.max(lo, v)), () => { reads++; return 0; });
    const enabled = !fullGridCapture && strength > 0;
    assert.equal(reads, enabled ? 1 : 0,
      `support reads: capture=${fullGridCapture}, strength=${strength}`);
    assert.equal(support <= 0.0001, enabled,
      `occupancy rejection: capture=${fullGridCapture}, strength=${strength}`);
  }
}
console.log('occupancy off bypasses both support reads and rejection; positive strengths retain admission');
