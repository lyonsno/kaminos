// Passive material law (emitter report §30; the return to Sexy Fireman's
// outer grid). The fine kernel's plain cooling of the two transported
// scalars it shares with any outer consumer: heat survives
// heatSurvivalPerStep^dt, smoke survives smokeSurvivalPerStep^dt, and smoke
// is born from cooling heat at heatToSmokeConversion per step. These are the
// material; the bonfire / tall-plume / canonical scene shaping and the fine
// box's wall and ceiling fades are authored fine-only terms and are not part
// of it. Height frame: the fine kernel's normalised y (−1 at the fine floor,
// +1 one fine edge above it, 3 at the top of the tall grid); the upper-air
// term saturates at 1 above y = 0.72, so outside and above the fine box the
// law no longer depends on height. The kernel compiles its own
// heatToSmokeConversion from this block, so producer and consumer cannot
// drift apart.
export const PASSIVE_MATERIAL_LAW = Object.freeze({
  identity: 'kaminos.volume.passive-material-law.v1',
  heatSurvivalPerStep: 0.982,
  smokeSurvivalPerStep: 0.990,
  heatToSmoke: Object.freeze({ coolingBandRise: [0.16, 1.05], coolingBandFall: [1.18, 1.85], upperAir: [-0.55, 0.72], rate: 0.064, fuelGate: [0.06, 0.86], fuelRate: 0.072 }),
  heightFrame: 'fine-normalised: -1 at the fine floor, +1 one fine edge above it; upper-air saturates at 1 above y = 0.72, so outside and above the fine box the law is height-independent',
});
const passiveSmoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Smoke born per step from heat at fine-normalised height yFine; fuel is the
// fine-only term (no fuel is transferred outside, so an outer consumer passes 0).
export function passiveHeatToSmokeRate(heat, yFine, fuel = 0) {
  const h = PASSIVE_MATERIAL_LAW.heatToSmoke;
  const coolingBand = passiveSmoothstep(h.coolingBandRise[0], h.coolingBandRise[1], heat) * (1 - passiveSmoothstep(h.coolingBandFall[0], h.coolingBandFall[1], heat));
  const upperAir = passiveSmoothstep(h.upperAir[0], h.upperAir[1], yFine);
  return coolingBand * upperAir * h.rate + fuel * passiveSmoothstep(h.fuelGate[0], h.fuelGate[1], heat) * h.fuelRate;
}
// Survival of heat and smoke over a step of dt reference steps (rate^dt, the
// uniform-step law; legacy is dt = 1).
export function passiveMaterialSurvival(dt = 1) {
  return { heat: Math.pow(PASSIVE_MATERIAL_LAW.heatSurvivalPerStep, dt), smoke: Math.pow(PASSIVE_MATERIAL_LAW.smokeSurvivalPerStep, dt) };
}
// World height → the fine kernel's normalised height, given where the fine
// box's floor sits in world units and the world length of one fine edge.
export function fineNormalisedHeight(yWorld, { fineFloorWorld, fineEdgeWorld }) {
  return -1 + 2 * (yWorld - fineFloorWorld) / fineEdgeWorld;
}
const passiveWgslNumber = v => (Number.isInteger(v) ? `${v}.0` : `${v}`);
export const PASSIVE_MATERIAL_WGSL = (() => {
  const h = PASSIVE_MATERIAL_LAW.heatToSmoke, n = passiveWgslNumber;
  return `// Passive material law (shared with any outer consumer; see PASSIVE_MATERIAL_LAW).
fn heatToSmokeConversion(heat: f32, fuel: f32, y: f32) -> f32 {
  let coolingBand = smoothstep(${n(h.coolingBandRise[0])}, ${n(h.coolingBandRise[1])}, heat) * (1.0 - smoothstep(${n(h.coolingBandFall[0])}, ${n(h.coolingBandFall[1])}, heat));
  let upperAir = smoothstep(${n(h.upperAir[0])}, ${n(h.upperAir[1])}, y);
  let fuelSmoke = fuel * smoothstep(${n(h.fuelGate[0])}, ${n(h.fuelGate[1])}, heat) * ${n(h.fuelRate)};
  return coolingBand * upperAir * ${n(h.rate)} + fuelSmoke;
}
// The fuel-free outer form: yFine is the fine-normalised height of the cell.
fn passiveHeatToSmokeRate(heat: f32, yFine: f32) -> f32 {
  return heatToSmokeConversion(heat, 0.0, yFine);
}
`;
})();
