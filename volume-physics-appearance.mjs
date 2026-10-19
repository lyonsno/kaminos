import { thermalRadianceRGB, REACTION_RGB } from './volume-emissive-transport.mjs';

// Physics appearance (operator, 2026-10-14): under the reactant law the flame is
// drawn from the simulated soot and temperature alone, as production volume
// renderers do (Nguyen, Fedkiw & Jensen 2002; Pegoraro & Parker 2006). Hot soot
// emits as a blackbody at the temperature the heat field implies; the same soot
// absorbs and scatters; fresh burning adds the reaction spectrum. No appearance
// carrier, and no carrier-built coverage, is read. Heat is dimensionless, so its
// Kelvin scale is a calibration the operator owns (Kelvin per heat unit).
//
// Soot burnout: soot is consumed where it is hot and meets oxygen, which is what
// ends a real luminous flame. A sim term, off at rate 0; v0 does not consume
// oxygen or release heat for it.

export const PHYSICS_APPEARANCE_IDENTITY = 'kaminos.volume.physics-appearance.v0';
export const PHYSICS_MATERIAL_LAW = 2;
export const PHYSICS_COLD_KELVIN = 300;
export const PHYSICS_BURNOUT_HALF_WIDTH_KELVIN = 150;
export const PHYSICS_APPEARANCE_DEFAULTS = Object.freeze({
  kelvinPerHeat: 1600,
  sootBurnoutRate: 0,
  sootBurnoutKelvin: 1300,
});
export const PHYSICS_APPEARANCE_RANGES = Object.freeze({
  kelvinPerHeat: [100, 6000],
  sootBurnoutRate: [0, 2],
  sootBurnoutKelvin: [600, 3000],
});

const clampTo = (value, [lo, hi], fallback) => {
  const v = Number(value);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

export function resolvePhysicsAppearance(controls = {}, { reactantAdmitted = false, emissiveRouteEffective = false } = {}) {
  // Physics is the material law; the law select is retired (operator,
  // 2026-10-18), so no saved field selects or deselects it.
  const requested = true;
  const kelvinPerHeat = clampTo(controls.physicalKelvinPerHeat, PHYSICS_APPEARANCE_RANGES.kelvinPerHeat, PHYSICS_APPEARANCE_DEFAULTS.kelvinPerHeat);
  const sootBurnoutRate = clampTo(controls.physicalSootBurnoutRate, PHYSICS_APPEARANCE_RANGES.sootBurnoutRate, PHYSICS_APPEARANCE_DEFAULTS.sootBurnoutRate);
  const sootBurnoutKelvin = clampTo(controls.physicalSootBurnoutKelvin, PHYSICS_APPEARANCE_RANGES.sootBurnoutKelvin, PHYSICS_APPEARANCE_DEFAULTS.sootBurnoutKelvin);
  const lawOk = requested && reactantAdmitted === true;
  const render = lawOk && emissiveRouteEffective === true;
  // The burnout is simulation: it follows the law, never the view drawing the frame.
  const sootBurnout = lawOk && sootBurnoutRate > 0;
  let reason = null;
  if (requested && !lawOk) reason = 'physics-appearance-requires-the-reactant-law';
  else if (requested && !render) reason = 'physics-appearance-draws-only-on-the-emissive-transport-route';
  return {
    identity: PHYSICS_APPEARANCE_IDENTITY,
    requested,
    effective: { render, sootBurnout },
    reason,
    kelvinPerHeat,
    sootBurnoutRate,
    sootBurnoutKelvin,
  };
}

// emissive_physics: x render flag, y Kelvin per heat, z effective burnout rate, w burnout Kelvin.
export function physicsAppearanceUniformValues(resolved) {
  return [
    resolved.effective.render ? 1 : 0,
    resolved.kelvinPerHeat,
    resolved.effective.sootBurnout ? resolved.sootBurnoutRate : 0,
    resolved.sootBurnoutKelvin,
  ];
}

export function physicsSootKelvin(heat, kelvinPerHeat) {
  return PHYSICS_COLD_KELVIN + Math.max(0, heat) * kelvinPerHeat;
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function sootBurnoutSurvival({ heat, oxidizerFraction, timeStep }, { sootBurnoutRate, sootBurnoutKelvin, kelvinPerHeat }) {
  if (!(sootBurnoutRate > 0)) return 1;
  const kelvin = physicsSootKelvin(heat, kelvinPerHeat);
  const gate = smoothstep(sootBurnoutKelvin - PHYSICS_BURNOUT_HALF_WIDTH_KELVIN, sootBurnoutKelvin + PHYSICS_BURNOUT_HALF_WIDTH_KELVIN, kelvin);
  const oxygen = Math.min(1, Math.max(0, oxidizerFraction));
  return Math.exp(-sootBurnoutRate * timeStep * oxygen * gate);
}

// JS reference of the WGSL physicsEmissiveMaterial (volume-emissive-transport.mjs).
// Blackbody power is normalised to 1 at 1900 K (the thermal LUT's reference).
export function physicsEmissiveMaterial({ soot, heat, freshBurn }, p) {
  const sootAmount = Math.max(0, soot) * Math.max(0, p.density);
  const extinction = sootAmount * p.extinction;
  const scattering = extinction * p.albedo * p.smokeVisible;
  const absorbing = extinction * (1 - p.albedo);
  // The WGSL thermal LUT spans 800-6000 K and clamps; below 800 K the power is
  // that of 800 K, already negligible against a flame (about 1e-5 of 1900 K).
  const planck = thermalRadianceRGB(Math.min(6000, Math.max(800, physicsSootKelvin(heat, p.kelvinPerHeat))));
  const burnLight = 1 - Math.exp(-Math.max(freshBurn, 0) / Math.max(p.burnReference, 1e-6));
  const clean = burnLight * Math.exp(-extinction * 2);
  const emission = planck.map((v, i) => absorbing * v * p.thermalGain + REACTION_RGB[i] * clean * p.cleanGain);
  return { emission, absorption: absorbing * p.smokeVisible, scattering };
}

// Kernel term (volume-core.js step kernel), the same law as sootBurnoutSurvival.
export const SOOT_BURNOUT_WGSL = /* wgsl */`
fn physicsSootKelvin(heat: f32, kelvinPerHeat: f32) -> f32 {
  return ${PHYSICS_COLD_KELVIN.toFixed(1)} + max(heat, 0.0) * kelvinPerHeat;
}
fn sootBurnoutSurvival(heat: f32, oxidizerFraction: f32, timeStep: f32) -> f32 {
  let rate = u.emissive_physics.z;
  if (rate <= 0.0) { return 1.0; }
  let kelvin = physicsSootKelvin(heat, u.emissive_physics.y);
  let gate = smoothstep(u.emissive_physics.w - ${PHYSICS_BURNOUT_HALF_WIDTH_KELVIN.toFixed(1)}, u.emissive_physics.w + ${PHYSICS_BURNOUT_HALF_WIDTH_KELVIN.toFixed(1)}, kelvin);
  return exp(-rate * timeStep * clamp(oxidizerFraction, 0.0, 1.0) * gate);
}
`;

// Cockpit controls that do not reach the frame under physics appearance.
// The paintings that used to be listed here (boundary-fire, shell and pyro
// controls, the replaced Kelvin mapping) were retired on 2026-10-18 with the
// legacy material laws; what remains are the appearance carriers' drivers,
// which are not drawn but can still move the flow when a carrier force
// toggle is on.
const carriersOnly = ['volume-fire-licks', 'volume-interface-shred', 'volume-microdetail', 'volume-detail-scale'];
export const PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS = Object.freeze(
  carriersOnly.map(id => Object.freeze({ id, reason: 'carriers-only' })),
);

