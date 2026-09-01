import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function wgslFunctionBody(name) {
  const start = core.indexOf(`fn ${name}(`);
  assert.notEqual(start, -1, `missing WGSL function ${name}`);
  const open = core.indexOf('{', start);
  assert.notEqual(open, -1, `missing WGSL body for ${name}`);
  let depth = 0;
  for (let index = open; index < core.length; index += 1) {
    if (core[index] === '{') depth += 1;
    if (core[index] === '}') {
      depth -= 1;
      if (depth === 0) return core.slice(open + 1, index);
    }
  }
  throw new Error(`unterminated WGSL body for ${name}`);
}

for (const name of ['fireLickBreakup', 'bonfireRadialFireLickBreakup']) {
  const body = wgslFunctionBody(name);
  assert.doesNotMatch(
    body,
    /\b(?:sin|cos)\s*\(/,
    `${name} must not stamp an animated periodic comb into the transported fire-lick field`,
  );
  assert.doesNotMatch(
    body,
    /\bturbulentDetailForce\s*\(/,
    `${name} must not reintroduce periodicity indirectly through the analytic detail-force field`,
  );
  assert.doesNotMatch(
    body,
    /floor\s*\(\s*time\b/,
    `${name} must not replace the periodic comb with a synthetic temporal hash flicker`,
  );
  assert.match(body, /readSlot\(c, 2u\)/, `${name} derives breakup from transported fire state`);
  assert.match(body, /readSlot\(c, 3u\)/, `${name} derives breakup from transported microdetail state`);
  assert.match(body, /readFrontField\(c\)/, `${name} derives breakup from the transported combustion front`);
  assert.match(body, /curlAtCell\(c\)/, `${name} derives breakup from live flow structure`);
  assert.match(body, /hash31\(/, `${name} retains only low-amplitude irregular variation`);
}

assert.match(
  core,
  /if \(fireLickBreakupEnabled\) \{\s*columnLickBirth = fireLickBreakup\([\s\S]*?bonfireLickBirth = bonfireRadialFireLickBreakup\(/,
  'the existing Fire Licks zero setting remains a hard bypass for both breakup operators',
);
assert.match(
  core,
  /const fireLickBreakupEvaluationsPerCell = fireLickBreakupEnabled \? 2 : 0;/,
  'the cost ledger still records zero periodic-breakup work when Fire Licks are disabled',
);

console.log('volume fire-lick periodicity: transported-field breakup replaces animated combs and zero remains a hard bypass');
