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
  const requested = Number(controls.physicalMaterialLaw) === PHYSICS_MATERIAL_LAW;
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
// unused: no path to the pixels (they shape the carrier-built coverage, the
// boundary-fire, shell and pyro paintings, or the replaced Kelvin mapping).
// carriers-only: they drive the appearance carriers, which are not drawn; they
// can still move the flow when a carrier force toggle is on.
const unused = [
  'volume-physical-temperature', 'volume-physical-spread',
  'volume-radiance', 'volume-glow', 'volume-exposure',
  'volume-reaction-boundary-gradient', 'volume-reaction-boundary-support-thermal', 'volume-reaction-boundary-support-reaction',
  'volume-reaction-boundary-support-front', 'volume-reaction-boundary-support-interface', 'volume-reaction-boundary-cut',
  'volume-reaction-boundary-softness', 'volume-reaction-boundary-core-reject', 'volume-reaction-boundary-topology',
  'volume-reaction-boundary-curl', 'volume-reaction-boundary-divergence', 'volume-reaction-boundary-contrast',
  'volume-reaction-boundary-gamma', 'volume-reaction-boundary-opacity', 'volume-reaction-boundary-fire-ridge',
  'volume-reaction-boundary-fire-ridge-cut', 'volume-reaction-boundary-fire-tip', 'volume-reaction-boundary-fire-erosion',
  'volume-reaction-boundary-fire-clean-blue', 'volume-reaction-boundary-fire-soot', 'volume-reaction-boundary-fire-yellow',
  'volume-reaction-boundary-fire-warmth', 'volume-reaction-boundary-fire-luma', 'volume-reaction-boundary-fire-clean-color',
  'volume-reaction-boundary-fire-soot-color', 'volume-reaction-shell-gamma', 'volume-reaction-shell-contrast',
  'volume-shell-amount', 'volume-shell-width', 'volume-shell-thermal', 'volume-shell-reaction', 'volume-shell-front',
  'volume-shell-edge', 'volume-shell-curl', 'volume-shell-core-suppress', 'volume-shell-bite', 'volume-shell-heat',
  'volume-shell-divergence', 'volume-shell-luma', 'volume-shell-exposure', 'volume-shell-soft-clip', 'volume-shell-smoke',
  'volume-pyro-detail', 'volume-pyro-material-gain', 'volume-pyro-interface-focus', 'volume-pyro-edge-bite',
  'volume-pyro-bite-border', 'volume-pyro-bite-teeth', 'volume-pyro-bite-wake', 'volume-pyro-bite-height',
  'volume-pyro-bite-fire-lock', 'volume-pyro-bite-core', 'volume-pyro-bite-core-cut', 'volume-pyro-bite-rim',
  'volume-pyro-bite-rim-cut', 'volume-pyro-bite-after', 'volume-pyro-bite-after-cut', 'volume-pyro-fire-mode',
  'volume-pyro-flame-paint', 'volume-pyro-stock-mix', 'volume-pyro-flame-luma', 'volume-pyro-flame-core-color',
  'volume-pyro-flame-edge-color', 'volume-pyro-bite-heat', 'volume-pyro-bite-chroma', 'volume-pyro-bite-luma',
  'volume-pyro-bite-ember-color', 'volume-pyro-bite-hot-color', 'volume-pyro-smoke-fold', 'volume-pyro-fold-border',
  'volume-pyro-fold-wake', 'volume-pyro-wake-lift', 'volume-pyro-wake-warmth', 'volume-pyro-wake-luma',
  'volume-pyro-wake-shadow-color', 'volume-pyro-wake-ember-color', 'volume-pyro-radiance', 'volume-pyro-radiance-gate',
  'volume-pyro-radiance-spill', 'volume-pyro-radiance-warmth', 'volume-pyro-radiance-hue', 'volume-pyro-radiance-chroma',
  'volume-pyro-radiance-luma', 'volume-pyro-radiance-cool-color', 'volume-pyro-radiance-warm-color', 'volume-pyro-radiance-source',
  'volume-pyro-radiance-height', 'volume-pyro-radiance-border', 'volume-pyro-radiance-teeth', 'volume-pyro-radiance-rise',
  'volume-pyro-radiance-fire-lock', 'volume-pyro-flow-bite', 'volume-pyro-flow-border', 'volume-pyro-flow-teeth',
  'volume-pyro-flow-rise', 'volume-pyro-flow-fire-lock', 'volume-pyro-flow-luma', 'volume-pyro-flow-radiance',
  'volume-pyro-flow-spikes', 'volume-pyro-flow-cool-color', 'volume-pyro-flow-hot-color', 'volume-pyro-diagnostic-paint',
  'volume-pyro-overdrive',
];
const carriersOnly = ['volume-fire-licks', 'volume-interface-shred', 'volume-microdetail', 'volume-detail-scale'];
export const PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS = Object.freeze([
  ...unused.map(id => Object.freeze({ id, reason: 'unused' })),
  ...carriersOnly.map(id => Object.freeze({ id, reason: 'carriers-only' })),
]);
