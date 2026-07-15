import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const builderPath = new URL(
  '../artifacts/lirm-trellis-guidance-pressure-assay-v1/build-assay.mjs',
  import.meta.url,
);
const source = readFileSync(builderPath, 'utf8');
const parserStart = source.indexOf('const routeFlagMatches =');
const parserEnd = source.indexOf('const parseWitnessRoute =');
assert.ok(parserStart >= 0 && parserEnd > parserStart, 'builder route parser must remain discoverable');

const runner = '/Users/noahlyons/dev/trellis2mlx/.venv/bin/python -u generate.py';
const context = { runner };
vm.createContext(context);
vm.runInContext(
  `${source.slice(parserStart, parserEnd)}\nglobalThis.parser = parseGenerationRoute;`,
  context,
);

const valid = `${runner} --image source.png --output result.glb --seed 42 --resolution 512 --steps 6 --no-cascade --target-faces 200000 --texture-size 1024 --simplify-first --shape-guidance-strength 7.5 --shape-guidance-rescale 0.5 --shape-guidance-low 0.6 --shape-guidance-high 1.0`;
assert.equal(context.parser(valid, 'dense-shape').seed, 42);

for (const poisoned of [
  `${valid} --seed 99`,
  `${valid} --output wrong.glb`,
  `${valid} --shape-guidance-strength 12.0`,
  `${valid} --cascade`,
  `${valid} --simplify-first`,
]) {
  assert.throws(
    () => context.parser(poisoned, 'dense-shape'),
    /exactly once|exactly one/,
    `duplicate or contradictory route flag must fail: ${poisoned}`,
  );
}

console.log('lirm Trellis guidance route parser contracts passed');
