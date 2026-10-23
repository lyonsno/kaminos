// kaminos-test: node
// Operator 2026-10-21: the reactant law's soot yield (soot made per unit fuel
// burned) is a real simulation control, not a hidden model constant.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FLAME_PROPERTY_GROUPS } from '../flame-authoring.mjs';
import {
  REACTANT_MODEL, REACTANT_CONTROL_DEFAULTS, REACTANT_CONTROL_RANGES,
  resolveReactantCombustionConfig, reactantCombustionUniformValues, reactantBurnStep,
} from '../volume-reactant-combustion.mjs';

const admit = { volumeScene: 'tall_plume', emitterSourceLaw: 'immersed-source', reactionLaw: 'reactant-v0' };
assert.equal(REACTANT_CONTROL_DEFAULTS.sootYield, REACTANT_MODEL.sootYield, 'the default is the model value, so saved basins are unchanged');
const [lo, hi] = REACTANT_CONTROL_RANGES.sootYield;
assert.ok(lo === 0 && hi > REACTANT_MODEL.sootYield, 'the range reaches zero soot and above the default');
const base = resolveReactantCombustionConfig({ ...admit });
assert.equal(base.effective.model.sootYield, REACTANT_MODEL.sootYield, 'no control value: the model yield');
const sooty = resolveReactantCombustionConfig({ ...admit, reactantSootYield: 4 });
assert.equal(sooty.effective.model.sootYield, 4, 'the control sets the yield the simulation uses');
assert.equal(sooty.requested.sootYield, 4, 'the receipt names the requested yield');
assert.ok(reactantCombustionUniformValues(sooty).includes(4), 'the yield reaches the kernel uniforms');
assert.equal(resolveReactantCombustionConfig({ ...admit, reactantSootYield: 99 }).effective.model.sootYield, hi, 'clamped to its range');
const state = { fuel: 0.5, oxidizer: 3, heat: 0.4, smoke: 0 };
const step = config => reactantBurnStep(state, config.effective, 1);
assert.ok(step(sooty).smoke > 1.9 * step(base).smoke, 'the same burn makes twice the soot at twice the yield');
assert.equal(step(resolveReactantCombustionConfig({ ...admit, reactantSootYield: 0 })).smoke, 0, 'yield 0 makes no soot');
assert.equal(step(sooty).heat, step(base).heat, 'soot yield does not change the heat released');
// A debug model override still wins over the control.
assert.equal(resolveReactantCombustionConfig({ ...admit, reactantSootYield: 4, reactantModelOverrides: { sootYield: 1 } }).effective.model.sootYield, 1);

const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
const control = schema.controls.find(entry => entry.key === 'volume-reactant-soot-yield');
assert.ok(control, 'the schema declares the soot yield control');
assert.equal(control.param, 'volume_reactant_soot_yield');
assert.equal(Number(control.additiveDefault), REACTANT_MODEL.sootYield, 'older basins load at the model yield');
assert.ok(control.additiveSinceControlCount > Math.max(...schema.controls.filter(entry => entry !== control && Number.isSafeInteger(entry.additiveSinceControlCount)).map(entry => entry.additiveSinceControlCount)), 'it is the newest additive control');
assert.equal(schema.controls.length, schema.controlCount);
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(index, /<input[^>]+id="volume-reactant-soot-yield"[^>]+data-volume-settings-param="volume_reactant_soot_yield"/, 'the cockpit has the slider');
assert.match(index, /reactantSootYield: parseFloat\(document\.getElementById\('volume-reactant-soot-yield'\)\.value\)/, 'the snapshot carries it to the core');
assert.match(index, /'volume-reactant-cooling-time',\s*'volume-reactant-soot-yield',/, 'its changes reach the core like the other reactant controls');
assert.deepEqual(FLAME_PROPERTY_GROUPS.filter(group=>group.fields.some(([id])=>id==='volume-reactant-soot-yield')).map(group=>group.name),['Soot'], 'the flame inspector groups yield with soot removal and optics');
console.log('reactant soot yield contracts passed');
