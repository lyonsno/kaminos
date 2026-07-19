import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../structural-combustion-gpu.mjs', import.meta.url), 'utf8');

assert.match(
  source,
  /@location\(6\) materialPosition: vec3<f32>/,
  'surface fragments require resident object-space material coordinates',
);
assert.match(
  source,
  /@location\(7\) @interpolate\(flat\) faceFrame: vec4<f32>/,
  'surface fragments require a flat face orientation and fracture-face payload',
);
assert.match(
  source,
  /fn surfaceFaceFrame\(faceIndex: u32, fractureFace: bool\) -> vec4<f32>/,
  'authored face topology must distinguish side grain from end and fracture grain',
);
assert.match(
  source,
  /fn woodMaterialCharacter\([\s\S]*materialPosition: vec3<f32>[\s\S]*faceFrame: vec4<f32>[\s\S]*thermal: vec4<f32>[\s\S]*reaction: vec4<f32>/,
  'material character must compose stable geometry coordinates with semantic burn state',
);
assert.doesNotMatch(
  source.match(/fn woodMaterialCharacter\([\s\S]*?\n}/)?.[0] ?? '',
  /\b(time|frame|random|jitter)\b/i,
  'wood and char character cannot swim through time-driven or random jitter',
);
assert.match(
  source,
  /let character = woodMaterialCharacter\(in\.materialPosition, in\.faceFrame, in\.thermal, in\.reaction\)/,
  'mesostructure must be evaluated per fragment after material-state interpolation',
);
assert.match(
  source,
  /let localEmission = appearance\.a \* mix\(/,
  'active breakup may only modulate consumption-backed semantic emission',
);
assert.match(
  source,
  /var litColor = albedo[\s\S]*litColor \+=/,
  'the Apple WGSL path requires mutable lit color before applying the material sheen',
);

const { evaluateStructuralBurnMesostructure } = await import('../structural-combustion-gpu.mjs');
assert.equal(typeof evaluateStructuralBurnMesostructure, 'function');

const virginSide = evaluateStructuralBurnMesostructure({
  materialPosition: [0.41, 0.23, 0.67],
  faceAxis: [0, 1, 0],
  fractureFace: false,
  temperature: 0.08,
  fuel: 1,
  char: 0,
});
const sameVirginSide = evaluateStructuralBurnMesostructure({
  materialPosition: [0.41, 0.23, 0.67],
  faceAxis: [0, 1, 0],
  fractureFace: false,
  temperature: 0.08,
  fuel: 1,
  char: 0,
});
assert.deepEqual(sameVirginSide, virginSide, 'material-space character must be deterministic');

const alongBeam = evaluateStructuralBurnMesostructure({
  materialPosition: [0.71, 0.23, 0.67],
  faceAxis: [0, 1, 0],
});
const acrossGrain = evaluateStructuralBurnMesostructure({
  materialPosition: [0.41, 0.38, 0.67],
  faceAxis: [0, 1, 0],
});
assert.ok(
  Math.abs(virginSide.pattern - alongBeam.pattern) < Math.abs(virginSide.pattern - acrossGrain.pattern),
  'exterior grain must remain more coherent along the beam axis than across it',
);

const fractureFace = evaluateStructuralBurnMesostructure({
  materialPosition: [0.41, 0.23, 0.67],
  faceAxis: [1, 0, 0],
  fractureFace: true,
});
assert.ok(fractureFace.crossGrainWeight > 0.99);
assert.notEqual(fractureFace.pattern, virginSide.pattern, 'fracture faces require cross-grain character');

const active = evaluateStructuralBurnMesostructure({
  materialPosition: [0.41, 0.38, 0.67],
  faceAxis: [0, 1, 0],
  temperature: 1.25,
  fuel: 0.72,
  char: 0.28,
  peakExposure: 2.4,
  liveExposure: 0.9,
  phase: 1,
  consumptionRate: 0.003,
});
const exhaustedChar = evaluateStructuralBurnMesostructure({
  materialPosition: [0.41, 0.23, 0.67],
  faceAxis: [0, 1, 0],
  temperature: 2.4,
  fuel: 0,
  char: 1,
  peakExposure: 2.4,
  liveExposure: 1.2,
  phase: 1,
  consumptionRate: 0,
});
assert.ok(active.activeBreakup > 0, 'active consumption should reveal stable localized pockets');
assert.ok(exhaustedChar.roughness > virginSide.roughness, 'char must become rougher than virgin wood');
assert.ok(exhaustedChar.specular < virginSide.specular, 'char must lose the virgin satin response');
assert.equal(exhaustedChar.localEmission, 0, 'mesostructure cannot invent emission after fuel exhaustion');

console.log('structural burn mesostructure contracts: ok');
