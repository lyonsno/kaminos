import assert from 'node:assert/strict';

import {
  createStructuralBurnFaceEmitter,
  evaluateStructuralBurnAppearance,
} from '../structural-combustion-gpu.mjs';

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
assert.equal(virginTarget.dominantStage, 'virgin');

const preheated = evaluateStructuralBurnAppearance({
  temperature: 0.38,
  fuel: 1,
  char: 0,
  peakExposure: 0.28,
  liveExposure: 0.08,
  phase: 0,
  consumptionRate: 0,
});
assert.equal(preheated.dominantStage, 'preheat', 'exposed sub-ignition material needs a distinct preheat stage');
assert.equal(preheated.emissiveStrength, 0, 'preheat cannot masquerade as combustion');
assert.ok(preheated.semanticWeights.preheat > preheated.semanticWeights.virgin);
assert.notDeepEqual(preheated.materialColor, virginTarget.materialColor);

const activelyHot = evaluateStructuralBurnAppearance({
  temperature: 1.25,
  fuel: 0.72,
  char: 0.28,
  peakExposure: 2.4,
  liveExposure: 0.9,
  phase: 1,
  consumptionRate: 0.003,
  bondAlive: true,
  strengthRatio: 0.68,
});
assert.ok(activelyHot.emissiveStrength > 0.7, 'hot material must visibly emit');
assert.ok(activelyHot.materialColor[0] > activelyHot.materialColor[1] * 1.8, 'hot material must bias toward red-orange');
assert.ok(activelyHot.bondOpacity < virginTarget.bondOpacity, 'weakened bonds must lose visual confidence');
assert.equal(activelyHot.dominantStage, 'pyrolysis');
assert.ok(activelyHot.semanticWeights.pyrolysis > 0.8, 'active fuel consumption owns the emissive stage');

const activeAwayFromContact = evaluateStructuralBurnAppearance({
  temperature: 1.25,
  fuel: 0.72,
  char: 0.28,
  peakExposure: 2.4,
  liveExposure: 0,
  phase: 1,
  consumptionRate: 0.003,
});
assert.equal(activeAwayFromContact.dominantStage, 'pyrolysis');
assert.ok(
  activeAwayFromContact.emissiveStrength < activelyHot.emissiveStrength * 0.4,
  'active material away from current Pyro contact must not become the same saturated glow field',
);

const fractionalPhase = evaluateStructuralBurnAppearance({
  temperature: 1.25,
  fuel: 0.72,
  char: 0.28,
  peakExposure: 2.4,
  liveExposure: 0.9,
  phase: 0.5,
  consumptionRate: 0.003,
});
assert.equal(
  Number(fractionalPhase.semanticWeights.pyrolysis.toFixed(6)),
  0.5,
  'the JS oracle must mirror WGSL fractional phase interpolation',
);
assert.equal(Number(fractionalPhase.semanticWeights.ignition.toFixed(6)), 0.5);
assert.equal(
  Number(fractionalPhase.emissiveStrength.toFixed(6)),
  Number((activelyHot.emissiveStrength * 0.5).toFixed(6)),
  'fractional phase must scale active emission by the shared ignition weight',
);

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
assert.equal(cooledChar.dominantStage, 'char');

const exhaustedHotChar = evaluateStructuralBurnAppearance({
  temperature: 2.4,
  fuel: 0,
  char: 1,
  peakExposure: 2.4,
  bondAlive: true,
  strengthRatio: 0.12,
});
assert.equal(exhaustedHotChar.emissiveStrength, 0, 'fuel-exhausted char cannot glow as a uniformly red debug surface');
assert.ok(
  exhaustedHotChar.materialColor[0] < activelyHot.materialColor[0] * 0.25,
  'fuel-exhausted hot char must remain charcoal rather than saturated red',
);
assert.ok(
  luminance(exhaustedHotChar.materialColor) > 0.06,
  'non-emissive charcoal must retain enough reflectance to preserve fragment silhouette',
);
assert.equal(exhaustedHotChar.dominantStage, 'char');

const liveContactChar = evaluateStructuralBurnAppearance({
  temperature: 2.4,
  fuel: 0,
  char: 1,
  peakExposure: 2.4,
  liveExposure: 1.2,
  phase: 1,
  consumptionRate: 0,
});
assert.equal(liveContactChar.emissiveStrength, 0, 'live exposure cannot invent emission after fuel exhaustion');
assert.ok(liveContactChar.semanticWeights.contact > 0.8, 'live contact remains spatially legible on char');
assert.notDeepEqual(
  liveContactChar.materialColor,
  exhaustedHotChar.materialColor,
  'current contact must remain distinguishable from equally charred material outside contact',
);

const brokenBond = evaluateStructuralBurnAppearance({
  temperature: 0.08,
  fuel: 0.06,
  char: 0.94,
  peakExposure: 2.4,
  bondAlive: false,
  strengthRatio: 0,
});
assert.equal(brokenBond.bondOpacity, 0, 'fractured bonds cannot remain visibly load-bearing');

const contact = createStructuralBurnFaceEmitter({
  worldOffset: [-0.56, 0.08, -0.18],
  displayScale: [1.12, 0.42, 0.36],
});
assert.equal(contact.face, 'positive-x');
assert.ok(contact.overlapDepth > contact.radius * 0.6, 'visible Pyro must materially overlap the burn face');
assert.ok(contact.start[1] < contact.facePosition[1] + 0.21 && contact.end[1] > contact.facePosition[1] - 0.21);
assert.ok(Math.abs(contact.start[2] - contact.facePosition[2]) < contact.radius);
assert.ok(Math.abs(contact.end[2] - contact.facePosition[2]) < contact.radius);
assert.deepEqual(contact.start.map(value => Number(value.toFixed(3))), [-0.02, -0.28, -0.18]);
assert.deepEqual(contact.end.map(value => Number(value.toFixed(3))), [0.02, 0.03, -0.18]);
assert.equal(Number(contact.radius.toFixed(3)), 0.085, 'contact registration preserves the proven causal emitter radius');

console.log('structural burn appearance contracts: ok');
