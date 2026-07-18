import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const witness = await readFile(new URL('../volume-boundary-splat-motion-witness.mjs', import.meta.url), 'utf8');

assert.match(
  witness,
  /const PROJECTED_WORK_FLOOR_TARGETS = \[0, 3, 6, 9, 12, 24\];/,
  'the floor assay must preserve its exact canonical target list',
);
assert.match(
  witness,
  /projected-work sequence requires exact targets 0,12,24 or 0,3,6,9,12,24/,
  'stale, reordered, defaulted, or arbitrary target lists must fail loudly',
);
assert.match(
  witness,
  /projectedWorkAlignmentAuthority\(projectedWorkTargets\)/,
  'alignment authority must name the effective canonical arm set',
);
assert.match(
  witness,
  /frame\.captures\.length !== projectedWorkTargets\.length/,
  'partial floor frames must be rejected against the effective target count',
);
assert.match(
  witness,
  /targets\.every\(\(target, index\) => target === projectedWorkTargets\[index\]\)/,
  'captured target order must match the requested and effective canonical floor set',
);
assert.match(
  witness,
  /projectedWorkTargets\.slice\(1\)/,
  'quality comparisons must include every effective thinned floor arm',
);
assert.match(
  witness,
  /projectedWorkTargets\.map\(targetPixels =>/,
  'motion certification must include every effective floor arm',
);
assert.match(
  witness,
  /const thinnedSelected = selected\.slice\(1\);/,
  'selected-count monotonicity must cover every thinned floor arm',
);
assert.doesNotMatch(
  witness,
  /PROJECTED_WORK_TARGETS\.length - 1/,
  'quality row accounting must not retain a stale three-arm constant',
);

console.log('boundary splat projected-work floor motion witness contracts passed');
