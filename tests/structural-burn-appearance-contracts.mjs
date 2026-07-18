import assert from 'node:assert/strict';

import { evaluateStructuralBurnAppearance } from '../structural-combustion-gpu.mjs';

function luminance(color) {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

const virginTarget = evaluateStructuralBurnAppearance({
  temperature: 0.08,
  fuel: 1,
  char: 0,
  peakExposure: 0,
  control: false,
  bondAlive: true,
  strengthRatio: 1,
});
const virginControl = evaluateStructuralBurnAppearance({
  temperature: 0.08,
  fuel: 1,
  char: 0,
  peakExposure: 0,
  control: true,
  bondAlive: true,
  strengthRatio: 1,
});
assert.deepEqual(
  virginTarget.materialColor,
  virginControl.materialColor,
  'matched virgin material cannot carry target/control debug color',
);
assert.deepEqual(virginTarget.materialColor.map(value => Number(value.toFixed(4))), [0.44, 0.29, 0.14]);
assert.equal(virginTarget.emissiveStrength, 0);

const activelyHot = evaluateStructuralBurnAppearance({
  temperature: 1.25,
  fuel: 0.72,
  char: 0.28,
  peakExposure: 2.4,
  bondAlive: true,
  strengthRatio: 0.68,
});
assert.ok(activelyHot.emissiveStrength > 0.7, 'hot material must visibly emit');
assert.ok(activelyHot.materialColor[0] > activelyHot.materialColor[1] * 1.8, 'hot material must bias toward red-orange');
assert.ok(activelyHot.bondOpacity < virginTarget.bondOpacity, 'weakened bonds must lose visual confidence');

const cooledChar = evaluateStructuralBurnAppearance({
  temperature: 0.08,
  fuel: 0.06,
  char: 0.94,
  peakExposure: 2.4,
  bondAlive: true,
  strengthRatio: 0.18,
});
assert.equal(cooledChar.emissiveStrength, 0, 'cooled char cannot retain decorative glow');
assert.ok(luminance(cooledChar.materialColor) < luminance(virginTarget.materialColor) * 0.32);
assert.ok(cooledChar.charPersistence > 0.9, 'cooled material must preserve its burn history');

const brokenBond = evaluateStructuralBurnAppearance({
  temperature: 0.08,
  fuel: 0.06,
  char: 0.94,
  peakExposure: 2.4,
  bondAlive: false,
  strengthRatio: 0,
});
assert.equal(brokenBond.bondOpacity, 0, 'fractured bonds cannot remain visibly load-bearing');

console.log('structural burn appearance contracts: ok');
