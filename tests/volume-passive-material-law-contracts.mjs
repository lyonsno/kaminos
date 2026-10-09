import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

// The passive material law (emitter report §30, return to Sexy Fireman):
// the fine kernel's plain cooling of transported smoke and heat, exported so
// an outer consumer continues the same material with the same numbers.
// Scene shaping (bonfire / tall-plume / canonical terms) and the fine box's
// ceiling and wall fades are not part of the material and are not exported.
test('the passive material law names the fine kernel\'s decay and heat-to-smoke constants', () => {
  assert.deepEqual(core.PASSIVE_MATERIAL_LAW, {
    identity: 'kaminos.volume.passive-material-law.v1',
    heatSurvivalPerStep: 0.982,
    smokeSurvivalPerStep: 0.990,
    heatToSmoke: { coolingBandRise: [0.16, 1.05], coolingBandFall: [1.18, 1.85], upperAir: [-0.55, 0.72], rate: 0.064, fuelGate: [0.06, 0.86], fuelRate: 0.072 },
    heightFrame: 'fine-normalised: -1 at the fine floor, +1 one fine edge above it; upper-air saturates at 1 above y = 0.72, so outside and above the fine box the law is height-independent',
  });
  // The fine kernel's own decay lines carry the same constants.
  assert.match(source, /var smoke = material\.x \* stepRate\(0\.990\);/);
  assert.match(source, /var heat = material\.y \* stepRate\(0\.982\);/);
});

test('the CPU law matches the WGSL conversion at hand-checked points and is fuel-free outside the box', () => {
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // Inside the cooling band, high in the box, no fuel: coolingBand × upperAir × rate.
  assert.ok(Math.abs(core.passiveHeatToSmokeRate(1.1, 1.0) - smooth(0.16, 1.05, 1.1) * (1 - smooth(1.18, 1.85, 1.1)) * 1 * 0.064) < 1e-12);
  assert.equal(core.passiveHeatToSmokeRate(1.1, 1.0), 0.064, 'heat 1.1 above the box: the full rate');
  assert.equal(core.passiveHeatToSmokeRate(0.1, 1.0), 0, 'below the cooling band nothing converts');
  assert.ok(core.passiveHeatToSmokeRate(2.0, 1.0) === 0, 'above the band (flame-hot) nothing converts');
  assert.equal(core.passiveHeatToSmokeRate(1.1, -1.0), 0, 'at the fine floor upper-air is zero');
  assert.equal(core.passiveHeatToSmokeRate(1.1, 5.0), 0.064, 'far above the box the height term stays saturated');
  // Fuel term, fine-only in practice (no fuel is transferred outside).
  assert.ok(Math.abs(core.passiveHeatToSmokeRate(0.5, 0.0, 0.3) - (smooth(0.16, 1.05, 0.5) * smooth(-0.55, 0.72, 0.0) * 0.064 + 0.3 * smooth(0.06, 0.86, 0.5) * 0.072)) < 1e-12);
  // Survival per step under the uniform time step is rate^dt.
  assert.ok(Math.abs(core.passiveMaterialSurvival(2).heat - 0.982 ** 2) < 1e-12);
  assert.ok(Math.abs(core.passiveMaterialSurvival(0.5).smoke - Math.sqrt(0.990)) < 1e-12);
  assert.deepEqual(core.passiveMaterialSurvival(1), { heat: 0.982, smoke: 0.990 });
  // World height → fine-normalised height.
  assert.equal(core.fineNormalisedHeight(0, { fineFloorWorld: 0, fineEdgeWorld: 2 }), -1);
  assert.equal(core.fineNormalisedHeight(2, { fineFloorWorld: 0, fineEdgeWorld: 2 }), 1);
  assert.equal(core.fineNormalisedHeight(5, { fineFloorWorld: 1, fineEdgeWorld: 2 }), 3);
});

test('the fine kernel compiles its heat-to-smoke conversion from the exported WGSL, so the two cannot drift', () => {
  assert.match(core.PASSIVE_MATERIAL_WGSL, /fn heatToSmokeConversion\(heat: f32, fuel: f32, y: f32\) -> f32 \{/);
  assert.match(core.PASSIVE_MATERIAL_WGSL, /smoothstep\(0\.16, 1\.05, heat\) \* \(1\.0 - smoothstep\(1\.18, 1\.85, heat\)\)/);
  assert.match(core.PASSIVE_MATERIAL_WGSL, /smoothstep\(-0\.55, 0\.72, y\)/);
  assert.match(core.PASSIVE_MATERIAL_WGSL, /fn passiveHeatToSmokeRate\(heat: f32, yFine: f32\) -> f32/, 'the fuel-free outer form');
  const kernel = source.slice(source.indexOf('const WGSL = /* wgsl */`'));
  assert.ok(!kernel.includes('fn heatToSmokeConversion('), 'no hand-written copy inside the kernel template');
  assert.match(kernel, /\$\{PASSIVE_MATERIAL_WGSL\}/, 'the kernel splices the exported block');
  assert.equal((source.match(/fn heatToSmokeConversion\(/g) || []).length, 1, 'exactly one definition: the generator');
  // The constants in the WGSL are generated from the same object.
  assert.ok(core.PASSIVE_MATERIAL_WGSL.includes(`${core.PASSIVE_MATERIAL_LAW.heatToSmoke.rate}`));
});
