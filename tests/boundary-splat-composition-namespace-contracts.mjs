import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.doesNotMatch(core, /^<<<<<<<|^=======|^>>>>>>>/m, 'core must not retain merge markers');
assert.doesNotMatch(page, /^<<<<<<<|^=======|^>>>>>>>/m, 'page must not retain merge markers');

assert.equal(
  [...core.matchAll(/function normalizeBoundarySplatComposition\(/g)].length,
  1,
  'hybrid composition must have one unambiguous normalizer',
);
assert.match(core, /function normalizeBoundarySplatFieldLayout\(/, 'instance field layout needs an independent normalizer');
assert.match(core, /boundarySplatCompositionRequested/, 'hybrid composition requested identity remains explicit');
assert.match(core, /boundarySplatFieldLayoutIdentity/, 'field layout identity remains explicit');

assert.match(page, /volume_boundary_splat_composition/, 'hybrid composition keeps its route parameter');
assert.match(page, /volume_boundary_splat_layout/, 'field layout gets a distinct route parameter');
assert.match(
  page,
  /legacy[^\n]*volume_boundary_splat_composition|volume_boundary_splat_composition[^\n]*legacy/i,
  'legacy composition=field routes remain explicit compatibility input',
);

console.log('boundary splat composition namespace contracts passed');
