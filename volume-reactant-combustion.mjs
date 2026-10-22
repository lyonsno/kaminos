// Reactant-driven combustion (candidate v0, 2026-10-12).
//
// One local material process replaces the authored tall-plume reaction when
// the Reaction Law select asks for it: fuel and oxidizer that share a cell
// burn when the cell's thermal state is in or above the ignition band, at a
// rate set by one mixing time. The single burned amount b owns every
// consequence: fuel loses b, oxidizer loses s·b, the thermal state gains Q·b,
// soot (the smoke channel) gains its yield·b, and the expansion source is the
// existing Heat Release gain × b per unit time. Nothing here reads position,
// fine-box height, grid level, or any appearance/history field (flame, ember,
// detail, lick, shred, front, fleck): appearance is fed from b one way.
//
// Contact is a separate mechanism from burning. Fuel and oxidizer meet through
// the solver's transport (oxidizer rides the same scheme as fuel) plus one
// named, bounded neighbour exchange: an eddy diffusivity D in domain units,
// applied alike to fuel, oxidizer and the thermal state (unity Lewis number).
// The mixing time then says how fast colocated, ignited reactants burn.
//
// Units. Length: the fine kernel's normalised coordinate (the fine box spans 2
// on each axis, so a cell is h = 2 / GRID). Time: reference steps (dt =
// timeStep; dt = 1 at the reference Speed under the uniform step). Fuel: the
// existing fuel channel (the inflow stream carries Fuel Fraction). Oxidizer:
// normalised so ambient air is 1. Thermal state: the existing dimensionless
// heat channel (its Kelvin mapping drives emission AND soot burnout). Soot: the
// existing smoke channel's optical units.
//
// The existing solver stores velocity in cells per step, so a diffusivity fixed
// in domain units changes its balance against advection with GRID. The receipt
// reports both the domain value and the per-step cell weight.

export const REACTANT_COMBUSTION_IDENTITY = 'kaminos.volume.reactant-combustion.v0';
export const REACTION_LAW_AUTHORED = 'authored-tall-plume';
export const REACTION_LAW_REACTANT = 'reactant-v0';
export const REACTION_LAWS = Object.freeze([REACTION_LAW_AUTHORED, REACTION_LAW_REACTANT]);
export const REACTANT_COMBUSTION_UNIFORM_FLOATS = 16;
// Explicit 6-neighbour exchange is monotone while the per-neighbour weight is
// at most 1/6; the effective weight is capped just inside that and the receipt
// says when the cap acts.
export const REACTANT_EXCHANGE_STABLE_WEIGHT = 0.16;

export const REACTANT_MODEL = Object.freeze({
  units: Object.freeze({
    length: 'fine-normalised coordinate: the fine box spans 2 per axis, cell h = 2 / GRID',
    time: 'reference steps: dt = timeStep, 1 at the reference Speed under the uniform step',
    fuel: 'existing fuel channel; the inflow stream carries Fuel Fraction',
    oxidizer: 'normalised oxidizer: ambient air = 1',
    thermal: 'dimensionless heat channel; Kelvin mapping drives emission and soot burnout',
    soot: 'existing smoke channel optical units',
  }),
  ambientOxidizer: 1,
  // s: oxidizer consumed per unit fuel burned. A Fuel Fraction f jet into air
  // is stoichiometric at mixture fraction Z_st = 1 / (1 + s f). Provisional
  // calibration (2026-10-13 sweeps on the saved fine32 basin): s 3 burns the
  // jet out within the lower half of the fine box; s 4 carried ~5x more fuel
  // above it.
  oxidizerRequirement: 3,
  // Q: rise of the thermal state per unit fuel burned. A stoichiometric parcel
  // of an f = 1 jet burns Z_st = 0.25 of fuel and rises by Q Z_st = 1.5.
  // Provisional calibration: Q 6 puts the peak heat (1.44) in the authored
  // range (1.3-1.5); Q 5 ran cool (0.85) and Q 10 blew out.
  heatOfCombustion: 6,
  // Thermal state over which colocated reactants become able to burn
  // (smoothstep). The authored inlet temperature 0.264 sits inside it, so a
  // hot inlet still pilots where it meets air; cold ambient air does not burn.
  ignitionBand: Object.freeze([0.10, 0.30]),
  // Soot made per unit fuel burned, in smoke-channel units.
  sootYield: 2,
  // Soot retirement e-folding (deposition, oxidation and dilution below
  // visibility lumped): the existing smoke survival 0.990 per reference step.
  sootRetirementSteps: -1 / Math.log(0.990),
  // D: eddy diffusivity of the neighbour exchange, domain units² per
  // reference step (w = D dt / h² = 0.0384 per neighbour per step at GRID 32).
  exchangeDiffusivity: 1.5e-4,
  // Oxidizer carried by the inflow stream. 0: the remainder of a Fuel Fraction
  // < 1 stream is inert, so the inlet is a fuel jet into air. Oxygen is never
  // added to fuel cells implicitly; a premixed inlet must be authored.
  inletOxidizer: 0,
  // Burn per reference step at which the appearance births' reaction signal
  // reaches 1 - 1/e. Appearance normalisation only; it is not chemistry.
  appearanceBurnReference: 0.04,
});

export const REACTANT_CONTROL_DEFAULTS = Object.freeze({
  // How quickly colocated, ignited reactants burn (e-folding, reference steps).
  // Provisional calibration: 3 (1 is vigorous, 12 smoulders).
  mixingTimeSteps: 3,
  // How quickly the thermal state decays (e-folding, reference steps); the
  // default is the authored heat survival 0.982 per step.
  coolingTimeSteps: -1 / Math.log(0.982),
  // Soot made per unit fuel burned (operator, 2026-10-21: a real control, not a
  // hidden constant). The default is the model value.
  sootYield: REACTANT_MODEL.sootYield,
});
export const REACTANT_CONTROL_RANGES = Object.freeze({
  mixingTimeSteps: Object.freeze([0.25, 30]),
  coolingTimeSteps: Object.freeze([5, 300]),
  sootYield: Object.freeze([0, 6]),
});
export const REACTANT_DIAGNOSTIC_CLASSES = Object.freeze(['ambient', 'no-contact', 'air-starved', 'too-cold', 'mixing-limited', 'burning', 'depleted', 'products']);
// Burning means at least 1e-3 fuel per reference step (on the saved basin the cells
// above it hold about 90% of all burning); 'no contact' and 'too cold' use the same
// scale for fuel and for what oxidizer allows to burn.
export const REACTANT_DIAGNOSTIC_THRESHOLDS = Object.freeze({ fuel: 1e-3, available: 1e-3, burnRate: 1e-3 });
const MODEL_OVERRIDE_KEYS = Object.freeze(['oxidizerRequirement', 'heatOfCombustion', 'sootYield', 'sootRetirementSteps', 'exchangeDiffusivity', 'inletOxidizer', 'appearanceBurnReference', 'ignitionLow', 'ignitionHigh']);

function clamp(value, lo, hi) { return Math.min(hi, Math.max(lo, value)); }
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function modelOf(controls) {
  return controls?.model ?? REACTANT_MODEL;
}

// Calibrate a reduced model's complete-burn energy potential, not its ignition
// or rate law. The reference must account for its own initial sensible heat.
// This returns a candidate scale; it never changes a basin or model default.
export function calibrateReactantTemperature({ initialKelvin, finalKelvin, fuel, oxidizer, ambientKelvin = 300 }, model = REACTANT_MODEL) {
  for (const [key, value] of Object.entries({ initialKelvin, finalKelvin, fuel, oxidizer, ambientKelvin,
    heatOfCombustion: model.heatOfCombustion, oxidizerRequirement: model.oxidizerRequirement })) {
    if (!Number.isFinite(value)) throw new TypeError(`${key} must be finite`);
  }
  if (!(ambientKelvin > 0 && initialKelvin >= ambientKelvin && finalKelvin > initialKelvin)) {
    throw new RangeError('reference must have positive ambient, initial >= ambient, and final > initial temperature');
  }
  if (!(fuel > 0 && oxidizer > 0 && model.heatOfCombustion > 0 && model.oxidizerRequirement > 0)) {
    throw new RangeError('reference must have positive reactants and heat of combustion');
  }
  const burnableFuel = Math.min(fuel, oxidizer / model.oxidizerRequirement);
  const heatRise = model.heatOfCombustion * burnableFuel;
  const kelvinPerHeat = (finalKelvin - initialKelvin) / heatRise;
  if (!(Number.isFinite(kelvinPerHeat) && kelvinPerHeat > 0)) throw new RangeError('reference scale is not finite and positive');
  return { ambientKelvin, initialKelvin, finalKelvin, burnableFuel, heatRise, kelvinPerHeat,
    initialHeat: (initialKelvin - ambientKelvin) / kelvinPerHeat,
    kelvinPerFuelBurned: kelvinPerHeat * model.heatOfCombustion };
}

// The local burn: no position, grid level or appearance input.
export function reactantBurnStep(state, controls, dt) {
  const model = modelOf(controls);
  const s = model.oxidizerRequirement;
  const fuel = Math.max(0, state.fuel);
  const oxidizer = Math.max(0, state.oxidizer);
  const available = Math.max(0, Math.min(fuel, oxidizer / s));
  const ignition = smoothstep(model.ignitionBand[0], model.ignitionBand[1], state.heat);
  const mixingTime = Math.max(1e-9, controls.mixingTimeSteps);
  const burned = available * ignition * (1 - Math.exp(-dt / mixingTime));
  if (!(burned > 0)) {
    return { fuel: state.fuel, oxidizer: state.oxidizer, heat: state.heat, smoke: state.smoke, burned: 0, freshBurnRate: 0, expansionRate: 0 };
  }
  return {
    fuel: state.fuel - burned,
    oxidizer: state.oxidizer - s * burned,
    heat: state.heat + model.heatOfCombustion * burned,
    smoke: state.smoke + model.sootYield * burned,
    burned,
    freshBurnRate: burned / dt,
    expansionRate: burned / dt,
  };
}

// Cooling and soot retirement as rate laws (they compose over subdivision).
export function reactantMaterialSurvival(controls, dt) {
  const model = modelOf(controls);
  return {
    heat: Math.exp(-dt / Math.max(1e-9, controls.coolingTimeSteps)),
    smoke: Math.exp(-dt / Math.max(1e-9, model.sootRetirementSteps)),
    fuel: 1,
    oxidizer: 1,
  };
}

// Per-neighbour exchange weight w = D dt / h² for this grid, capped for the
// explicit step's monotonicity; requested and effective are both reported.
export function reactantExchangeWeight({ diffusivity, grid, dt = 1 }) {
  const h = 2 / grid;
  const requested = diffusivity * dt / (h * h);
  const capped = requested > REACTANT_EXCHANGE_STABLE_WEIGHT;
  return { requested, effective: capped ? REACTANT_EXCHANGE_STABLE_WEIGHT : requested, capped, h, diffusivity, grid, dt };
}

// CPU mirror of the kernel's exchange: c_i += w Σ_j (c_j - c_i) over the six
// face neighbours that are inside the grid and not solid (zero flux otherwise).
// Pairwise-symmetric fluxes conserve the total exactly.
export function reactantExchangeStep(field, { dims, weight, solid = null }) {
  const [nx, ny, nz] = dims;
  const out = Float64Array.from(field);
  const at = (x, y, z) => x + nx * (y + ny * z);
  const open = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && !(solid && solid[at(x, y, z)]);
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const i = at(x, y, z);
        if (solid && solid[i]) { out[i] = 0; continue; }
        let flux = 0;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          if (open(x + dx, y + dy, z + dz)) flux += field[at(x + dx, y + dy, z + dz)] - field[i];
        }
        out[i] = field[i] + weight * flux;
      }
    }
  }
  return out;
}

// CPU emulation of the kernel's order: exchange first (on the source field),
// then advect by sampling the exchanged field trilinearly at each cell's
// departure point (cell - shift). Because the sample is a convex blend of
// exchanged values, which are non-negative while weight <= 1/6, the result
// needs no zero clamp to stay non-negative. Departures outside the grid clamp
// to the edge, as the kernel's samplers do.
export function reactantExchangeThenAdvect(field, { dims, weight, shift, solid = null }) {
  const [nx, ny, nz] = dims;
  const exchanged = weight > 0 ? reactantExchangeStep(field, { dims, weight, solid }) : Float64Array.from(field);
  const at = (x, y, z) => x + nx * (y + ny * z);
  const out = new Float64Array(field.length);
  const clampTo = (v, hi) => Math.min(Math.max(v, 0), hi);
  for (let z = 0; z < nz; z += 1) for (let y = 0; y < ny; y += 1) for (let x = 0; x < nx; x += 1) {
    const px = clampTo(x - shift[0], nx - 1), py = clampTo(y - shift[1], ny - 1), pz = clampTo(z - shift[2], nz - 1);
    const x0 = Math.min(Math.floor(px), nx - 2), y0 = Math.min(Math.floor(py), ny - 2), z0 = Math.min(Math.floor(pz), nz - 2);
    const fx = px - x0, fy = py - y0, fz = pz - z0;
    let v = 0;
    for (let dz = 0; dz < 2; dz += 1) for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
      const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
      v += w * exchanged[at(x0 + dx, y0 + dy, z0 + dz)];
    }
    out[at(x, y, z)] = v;
  }
  return out;
}

// Mixture fraction Z: the share of a cell's material that came from the inlet
// stream (1) rather than ambient air (0). Burning removes fuel and oxidizer/s
// equally, and transport and the exchange act alike on both, so
// beta = fuel - oxidizer/s is untouched by burning; Z is beta normalised between
// air (beta = -ambient/s) and the stream (beta = streamFuel - inletOxidizer/s).
// Sponges relax the oxidizer deficit at the fuel's rate, so Z is diluted exactly
// there; a quench sink removes fuel without oxidizer and lowers Z without burning.
export function reactantMixtureFraction({ fuel, oxidizer }, model = REACTANT_MODEL, { streamFuel = 1 } = {}) {
  const s = model.oxidizerRequirement;
  const air = -model.ambientOxidizer / s;
  const stream = streamFuel - model.inletOxidizer / s;
  return (fuel - oxidizer / s - air) / Math.max(stream - air, 1e-12);
}

// A cell holding at least this share of inlet stream has not met air.
export const REACTANT_NO_CONTACT_STREAM_SHARE = 0.9;

// Why a cell is or is not burning: burning; colocated, would burn at the
// threshold rate if fully ignited but is not (too cold); colocated but limited by
// the mixing time and the amount available (mixing-limited);
// burned here, air used up, fuel left (air-starved: contact-limited); burned
// out and hot (depleted) or cooled (products); inlet stream that has not met
// air (no contact, however hot: a hot inlet does not make contact); or nothing
// to burn (ambient). "Burning but rendering poorly" is a render-side judgement
// made against these classes, not a material class.
export function reactantDiagnostic(state, controls, dt) {
  const burn = reactantBurnStep({ fuel: state.fuel, oxidizer: state.oxidizer, heat: state.heat, smoke: 0 }, controls, dt);
  return reactantDiagnosticFromField({ fuel: state.fuel, oxidizer: state.oxidizer, heat: state.heat, freshBurnRate: burn.freshBurnRate }, modelOf(controls), { streamFuel: controls?.streamFuel ?? 1, mixingTimeSteps: controls?.mixingTimeSteps, dt });
}

// The same classes for a stored cell, using its recorded fresh burn rate (the
// sidecar's second component) instead of recomputing a burn.
export function reactantDiagnosticFromField({ fuel, oxidizer, heat, freshBurnRate }, model = REACTANT_MODEL, { streamFuel = 1, mixingTimeSteps = REACTANT_CONTROL_DEFAULTS.mixingTimeSteps, dt = 1 } = {}) {
  const t = REACTANT_DIAGNOSTIC_THRESHOLDS;
  if (freshBurnRate > t.burnRate) return 'burning';
  const z = reactantMixtureFraction({ fuel, oxidizer }, model, { streamFuel });
  if (fuel > t.fuel && z >= REACTANT_NO_CONTACT_STREAM_SHARE) return 'no-contact';
  const available = Math.max(0, Math.min(fuel, oxidizer / model.oxidizerRequirement));
  // Colocated but not burning at the threshold rate. Too cold only if full
  // ignition would make it burn at that rate (the thermal state is what holds
  // it back); otherwise the mixing time and the amount available limit it.
  if (available > t.available) {
    const fullIgnitionRate = available * (1 - Math.exp(-dt / Math.max(1e-9, mixingTimeSteps))) / dt;
    return fullIgnitionRate > t.burnRate && heat < model.ignitionBand[1] ? 'too-cold' : 'mixing-limited';
  }
  // Fuel the stream would have brought at this Z, less what is left: burned here.
  const burnedHere = Math.max(0, z) * streamFuel - fuel;
  // Burned here and fuel is left: it met air and used it all (rich side,
  // contact-limited: more mixing would burn more). Burned out and still above
  // the ignition floor: depleted; cooled below it: products.
  if (burnedHere > t.fuel) {
    if (fuel > t.fuel) return 'air-starved';
    return heat >= model.ignitionBand[0] ? 'depleted' : 'products';
  }
  if (fuel > t.fuel) return 'no-contact';
  return 'ambient';
}

function resolveModel(overrides) {
  if (!overrides || typeof overrides !== 'object') return { model: REACTANT_MODEL, overridden: [] };
  const overridden = [];
  const next = { ...REACTANT_MODEL, ignitionBand: [...REACTANT_MODEL.ignitionBand] };
  for (const key of MODEL_OVERRIDE_KEYS) {
    if (!(key in overrides)) continue;
    const value = Number(overrides[key]);
    if (!Number.isFinite(value) || value < 0) continue;
    if (key === 'ignitionLow') next.ignitionBand[0] = value;
    else if (key === 'ignitionHigh') next.ignitionBand[1] = value;
    else next[key] = value;
    overridden.push(key);
  }
  if (!(next.ignitionBand[1] > next.ignitionBand[0])) next.ignitionBand = [...REACTANT_MODEL.ignitionBand];
  if (!(next.oxidizerRequirement > 0)) next.oxidizerRequirement = REACTANT_MODEL.oxidizerRequirement;
  if (!(next.sootRetirementSteps > 0)) next.sootRetirementSteps = REACTANT_MODEL.sootRetirementSteps;
  if (!(next.appearanceBurnReference > 0)) next.appearanceBurnReference = REACTANT_MODEL.appearanceBurnReference;
  return { model: Object.freeze({ ...next, ignitionBand: Object.freeze(next.ignitionBand) }), overridden };
}

export function resolveReactantCombustionConfig(controls = {}, options = {}) {
  const grid = Number.isFinite(options.grid) ? options.grid : 32;
  const lawRequested = REACTION_LAWS.includes(controls.reactionLaw) ? controls.reactionLaw : REACTION_LAW_AUTHORED;
  const [mixLo, mixHi] = REACTANT_CONTROL_RANGES.mixingTimeSteps;
  const [coolLo, coolHi] = REACTANT_CONTROL_RANGES.coolingTimeSteps;
  const mixingTimeSteps = clamp(finiteOr(controls.reactantMixingTime, REACTANT_CONTROL_DEFAULTS.mixingTimeSteps), mixLo, mixHi);
  const coolingTimeSteps = clamp(finiteOr(controls.reactantCoolingTime, REACTANT_CONTROL_DEFAULTS.coolingTimeSteps), coolLo, coolHi);
  const [yieldLo, yieldHi] = REACTANT_CONTROL_RANGES.sootYield;
  const sootYield = clamp(finiteOr(controls.reactantSootYield, REACTANT_CONTROL_DEFAULTS.sootYield), yieldLo, yieldHi);
  const resolved = resolveModel(controls.reactantModelOverrides);
  const overridden = resolved.overridden;
  // The control sets the yield; a debug model override still wins.
  const model = overridden.includes('sootYield') ? resolved.model : Object.freeze({ ...resolved.model, sootYield });
  const requested = {
    law: lawRequested,
    volumeScene: String(controls.volumeScene ?? ''),
    emitterSourceLaw: String(controls.emitterSourceLaw ?? 'legacy-volume'),
    mixingTimeSteps: finiteOr(controls.reactantMixingTime, REACTANT_CONTROL_DEFAULTS.mixingTimeSteps),
    coolingTimeSteps: finiteOr(controls.reactantCoolingTime, REACTANT_CONTROL_DEFAULTS.coolingTimeSteps),
    sootYield: finiteOr(controls.reactantSootYield, REACTANT_CONTROL_DEFAULTS.sootYield),
    modelOverrides: overridden.length ? Object.fromEntries(overridden.map(key => [key, Number(controls.reactantModelOverrides[key])])) : null,
  };
  const off = reason => ({ identity: REACTANT_COMBUSTION_IDENTITY, requested, effective: { admitted: false, reason, law: REACTION_LAW_AUTHORED } });
  if (lawRequested !== REACTION_LAW_REACTANT) return off('reaction-law-is-authored');
  if (!['inflow-boundary', 'immersed-source'].includes(requested.emitterSourceLaw)) return off('reactant-law-requires-inflow-or-immersed-source');
  // The oxidizer rides the fuel's characteristic, which exists only under the
  // common-gas (or MacCormack) transport; legacy per-layer lifts would carry
  // fuel and oxidizer apart and manufacture or destroy contact.
  if (options.transportCommonCharacteristic === false) return off('reactant-law-requires-common-gas-transport');
  // The source that carries the fuel must itself be admitted (the inflow
  // boundary refuses a non-analytic emitter family; the immersed source has its
  // own refusals): a requested-but-refused source admits no fuel.
  if (options.sourceAdmitted === false) return off('reactant-law-requires-an-admitted-source');
  // Receipt at the effective dt (the kernel applies min(weight x timeStep, cap)).
  const dt = Number.isFinite(options.dt) && options.dt > 0 ? options.dt : 1;
  const exchange = reactantExchangeWeight({ diffusivity: model.exchangeDiffusivity, grid, dt });
  const exchangeWeightPerUnitDt = model.exchangeDiffusivity / ((2 / grid) ** 2);
  return {
    identity: REACTANT_COMBUSTION_IDENTITY,
    requested,
    effective: { admitted: true, reason: null, law: REACTION_LAW_REACTANT, grid, mixingTimeSteps, coolingTimeSteps, model, modelOverridden: overridden, exchange, exchangeWeightPerUnitDt },
  };
}

export function reactantCombustionUniformValues(config) {
  const e = config?.effective;
  if (!e?.admitted) return new Array(REACTANT_COMBUSTION_UNIFORM_FLOATS).fill(0);
  const m = e.model;
  return [
    1, e.mixingTimeSteps, e.coolingTimeSteps, e.exchangeWeightPerUnitDt,
    m.oxidizerRequirement, m.heatOfCombustion, m.sootYield, m.sootRetirementSteps,
    m.ignitionBand[0], m.ignitionBand[1], m.ambientOxidizer, m.inletOxidizer,
    m.appearanceBurnReference, REACTANT_EXCHANGE_STABLE_WEIGHT, 0, 0,
  ];
}

// Kernel side. Uniform block (16 floats): a = enabled, mixing time, cooling
// time, exchange weight per reference step (D / h²); b = s, Q, soot yield,
// soot retirement steps; c = ignition low, ignition high, ambient oxidizer,
// inlet oxidizer; d = appearance burn reference, stable exchange weight,
// quench-spread flag (a lane borrowed by the host: 1 while a liquid is bound with
// transfer enabled; not this law's), -.
export const REACTANT_COMBUSTION_WGSL = `// Reactant combustion (kaminos.volume.reactant-combustion.v0; see volume-reactant-combustion.mjs).
fn reactantLawOn() -> bool {
  return u.reactant_combustion_a.x > 0.5;
}

// One local burn: returns (fuel, oxidizer, heat, burned) after it.
fn reactantBurn(fuel: f32, oxidizer: f32, heat: f32, dt: f32) -> vec4<f32> {
  let s = max(u.reactant_combustion_b.x, 1e-6);
  let q = u.reactant_combustion_b.y;
  let mixingTime = max(u.reactant_combustion_a.y, 1e-3);
  let available = max(0.0, min(fuel, oxidizer / s));
  let ignition = smoothstep(u.reactant_combustion_c.x, u.reactant_combustion_c.y, heat);
  let burned = available * ignition * (1.0 - exp(-dt / mixingTime));
  return vec4<f32>(fuel - burned, oxidizer - s * burned, heat + q * burned, burned);
}

fn reactantExchangeWeightFor(dt: f32) -> f32 {
  return min(u.reactant_combustion_a.w * dt, u.reactant_combustion_d.y);
}

fn reactantCoolingSurvival(dt: f32) -> f32 {
  return exp(-dt / max(u.reactant_combustion_a.z, 1e-3));
}

fn reactantSootSurvival(dt: f32) -> f32 {
  return exp(-dt / max(u.reactant_combustion_b.w, 1e-3));
}
`;
