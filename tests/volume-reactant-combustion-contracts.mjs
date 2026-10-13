// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rc from '../volume-reactant-combustion.mjs';

const M = rc.REACTANT_MODEL;
const controls = { mixingTimeSteps: 4, coolingTimeSteps: 55 };
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test('the model names its units and fixes its parameters, and the cooling default is the existing heat survival', () => {
  assert.equal(M.ambientOxidizer, 1, 'oxidizer is normalised so ambient air is 1');
  for (const key of ['oxidizerRequirement', 'heatOfCombustion', 'sootYield', 'sootRetirementSteps', 'exchangeDiffusivity', 'appearanceBurnReference']) {
    assert.ok(Number.isFinite(M[key]) && M[key] > 0, `${key} is a positive documented parameter`);
  }
  assert.equal(M.inletOxidizer, 0, 'the inflow brings no oxidizer unless a premixed inlet is authored explicitly');
  assert.equal(M.ignitionBand.length, 2);
  assert.ok(M.ignitionBand[0] < M.ignitionBand[1]);
  for (const key of ['length', 'time', 'fuel', 'oxidizer', 'thermal', 'soot']) assert.equal(typeof M.units[key], 'string', `units.${key} is documented`);
  close(rc.REACTANT_CONTROL_DEFAULTS.coolingTimeSteps, -1 / Math.log(0.982), 1e-9, 'cooling default reproduces heat x0.982 per reference step');
  close(M.sootRetirementSteps, -1 / Math.log(0.990), 1e-9, 'soot retirement reproduces smoke x0.990 per reference step');
  assert.ok(rc.REACTANT_CONTROL_DEFAULTS.mixingTimeSteps > 0);
});

test('without oxidizer, without fuel, or too cold, nothing burns', () => {
  const cases = [
    { fuel: 0.8, oxidizer: 0, heat: 1.0, smoke: 0.1 },
    { fuel: 0, oxidizer: 1, heat: 1.0, smoke: 0.1 },
    { fuel: 0.8, oxidizer: 1, heat: 0, smoke: 0.1 },
  ];
  for (const state of cases) {
    const r = rc.reactantBurnStep(state, controls, 1);
    assert.equal(r.burned, 0, JSON.stringify(state));
    assert.equal(r.fuel, state.fuel);
    assert.equal(r.oxidizer, state.oxidizer);
    assert.equal(r.heat, state.heat);
    assert.equal(r.smoke, state.smoke);
    assert.equal(r.expansionRate, 0);
  }
});

test('one burned amount owns fuel, oxidizer, heat, soot and expansion', () => {
  const state = { fuel: 0.5, oxidizer: 0.6, heat: 1.0, smoke: 0.1 };
  for (const dt of [1, 0.5, 2]) {
    const r = rc.reactantBurnStep(state, controls, dt);
    const b = r.burned;
    assert.ok(b > 0, 'a hot, colocated cell burns');
    close(state.fuel - r.fuel, b, 1e-12, 'fuel loses exactly the burned amount');
    close(state.oxidizer - r.oxidizer, M.oxidizerRequirement * b, 1e-12, 'oxidizer loses s x burned');
    close(r.heat - state.heat, M.heatOfCombustion * b, 1e-12, 'heat gains Q x burned');
    close(r.smoke - state.smoke, M.sootYield * b, 1e-12, 'soot gains its yield x burned');
    close(r.freshBurnRate, b / dt, 1e-12, 'fresh burn rate is burned per unit time');
    close(r.expansionRate, b / dt, 1e-12, 'the expansion source is the same burned amount per unit time');
  }
});

test('the limiting reactant bounds the burn and the mixing time sets the fraction burned per step', () => {
  const s = M.oxidizerRequirement;
  const lean = rc.reactantBurnStep({ fuel: 0.1, oxidizer: 1, heat: 2, smoke: 0 }, { mixingTimeSteps: 4, coolingTimeSteps: 55 }, 1);
  close(lean.burned, 0.1 * (1 - Math.exp(-1 / 4)), 1e-12, 'fuel-lean: fuel limits');
  const rich = rc.reactantBurnStep({ fuel: 1, oxidizer: 0.2, heat: 2, smoke: 0 }, { mixingTimeSteps: 4, coolingTimeSteps: 55 }, 1);
  close(rich.burned, (0.2 / s) * (1 - Math.exp(-1 / 4)), 1e-12, 'fuel-rich: oxidizer limits');
  const fast = rc.reactantBurnStep({ fuel: 0.3, oxidizer: 0.9, heat: 2, smoke: 0 }, { mixingTimeSteps: 1e-6, coolingTimeSteps: 55 }, 1);
  close(fast.burned, Math.min(0.3, 0.9 / s), 1e-9, 'a vanishing mixing time burns the available amount and no more');
  assert.ok(fast.fuel >= 0 && fast.oxidizer >= -1e-12, 'no reactant goes negative');
  const slow = rc.reactantBurnStep({ fuel: 0.3, oxidizer: 0.9, heat: 2, smoke: 0 }, { mixingTimeSteps: 40, coolingTimeSteps: 55 }, 1);
  assert.ok(slow.burned < lean.burned * 10 && slow.burned < fast.burned, 'a longer mixing time burns less per step');
});

test('ignition depends only on the local thermal state', () => {
  const [lo, hi] = M.ignitionBand;
  const at = heat => rc.reactantBurnStep({ fuel: 0.2, oxidizer: 1, heat, smoke: 0 }, controls, 1).burned;
  assert.equal(at(lo * 0.99), 0, 'below the band nothing burns');
  const full = 0.2 * (1 - Math.exp(-1 / controls.mixingTimeSteps));
  close(at(hi), full, 1e-12, 'at the top of the band the burn is complete');
  close(at(hi * 3), full, 1e-12, 'hotter does not burn more than the reactants allow');
  const mid = at((lo + hi) / 2);
  assert.ok(mid > 0 && mid < full, 'inside the band ignition is partial');
  assert.equal(rc.reactantBurnStep.length, 3, 'the local law takes (state, controls, dt): no position, grid level or appearance argument');
});

test('subdividing the step burns the same amount once ignited, and converges inside the ignition band', () => {
  const ignited = { fuel: 0.4, oxidizer: 0.8, heat: 1.2, smoke: 0 };
  const one = rc.reactantBurnStep(ignited, controls, 1);
  let quarters = ignited;
  for (let i = 0; i < 4; i += 1) quarters = rc.reactantBurnStep(quarters, controls, 0.25);
  for (const key of ['fuel', 'oxidizer', 'heat', 'smoke']) close(quarters[key], one[key], 1e-12, `quarter steps reproduce one step: ${key}`);
  const [lo, hi] = M.ignitionBand;
  const ramp = { fuel: 0.4, oxidizer: 0.8, heat: (lo + hi) / 2, smoke: 0 };
  const burnedOver = dt => { let s = ramp; for (let t = 0; t < 1 - 1e-9; t += dt) s = rc.reactantBurnStep(s, controls, dt); return ramp.fuel - s.fuel; };
  const errors = [1, 0.5, 0.25, 0.125].map(dt => Math.abs(burnedOver(dt) - burnedOver(dt / 2)));
  for (let i = 1; i < errors.length; i += 1) assert.ok(errors[i] < errors[i - 1] * 0.62, `first-order convergence under subdivision: ${errors}`);
});

test('material survival is a rate law: cooling and soot retirement compose over subdivided steps', () => {
  const one = rc.reactantMaterialSurvival(controls, 1);
  const half = rc.reactantMaterialSurvival(controls, 0.5);
  close(half.heat * half.heat, one.heat, 1e-15, 'heat survival composes');
  close(half.smoke * half.smoke, one.smoke, 1e-15, 'soot survival composes');
  close(one.heat, Math.exp(-1 / controls.coolingTimeSteps), 1e-15, 'cooling time is the e-folding of the thermal state');
  close(one.smoke, Math.exp(-1 / M.sootRetirementSteps), 1e-15, 'soot retirement is its documented e-folding');
  assert.equal(one.fuel, 1, 'fuel leaves only by burning, transport and boundaries');
  assert.equal(one.oxidizer, 1, 'oxidizer leaves only by burning, transport and boundaries');
});

test('the exchange coefficient is a diffusivity in domain units with the cell spacing in it', () => {
  const D = 1.5e-4;
  const w32 = rc.reactantExchangeWeight({ diffusivity: D, grid: 32, dt: 1 });
  close(w32.requested, D / (2 / 32) ** 2, 1e-15, 'w = D dt / h^2 with h = 2 / GRID');
  assert.equal(w32.capped, false);
  assert.equal(w32.effective, w32.requested);
  const w24 = rc.reactantExchangeWeight({ diffusivity: D, grid: 24, dt: 1 });
  close(w24.requested / w32.requested, (24 / 32) ** 2, 1e-12, 'a coarser grid exchanges a smaller fraction per step for the same diffusivity');
  close(rc.reactantExchangeWeight({ diffusivity: D, grid: 32, dt: 0.5 }).requested, w32.requested / 2, 1e-15, 'proportional to dt');
  const big = rc.reactantExchangeWeight({ diffusivity: 1e-2, grid: 64, dt: 1 });
  assert.equal(big.capped, true, 'an explicit step past stability is capped and says so');
  assert.equal(big.effective, rc.REACTANT_EXCHANGE_STABLE_WEIGHT);
  assert.ok(rc.REACTANT_EXCHANGE_STABLE_WEIGHT <= 1 / 6);
});

test('the exchange conserves material and spreads it at the documented rate on any grid', () => {
  const D = 1.5e-4;
  for (const grid of [24, 32, 48]) {
    const dims = [grid, 1, 1];
    const field = new Float64Array(grid);
    const mid = grid / 2;
    field[mid] = 1;
    const w = rc.reactantExchangeWeight({ diffusivity: D, grid, dt: 1 }).effective;
    let f = field;
    const steps = 6;
    for (let i = 0; i < steps; i += 1) f = rc.reactantExchangeStep(f, { dims, weight: w });
    const sum = f.reduce((a, b) => a + b, 0);
    close(sum, 1, 1e-12, `grid ${grid}: mass conserved`);
    const h = 2 / grid;
    let variance = 0;
    for (let i = 0; i < grid; i += 1) variance += f[i] * ((i - mid) * h) ** 2;
    close(variance, 2 * D * steps, 1e-12, `grid ${grid}: variance grows 2 D t in domain units`);
  }
});

test('kernel order: exchange then advect, sampling the exchanged field at the departure point, stays non-negative and conserves', () => {
  const dims = [24, 8, 8];
  const n = dims[0] * dims[1] * dims[2];
  const at = (x, y, z) => x + dims[0] * (y + dims[1] * z);
  const step = new Float64Array(n);
  for (let z = 2; z < 6; z += 1) for (let y = 2; y < 6; y += 1) for (let x = 8; x < 12; x += 1) step[at(x, y, z)] = 1;
  const weight = 0.16;
  for (const shift of [[2, 0, 0], [3, 1, 0], [1.6, 0.4, 0.3]]) {
    const out = rc.reactantExchangeThenAdvect(step, { dims, weight, shift });
    let total = 0;
    for (let i = 0; i < n; i += 1) { assert.ok(out[i] >= -1e-12, `non-negative before any clamp, shift ${shift}`); total += out[i]; }
    close(total, 64, 1e-9, `material is conserved away from the edges, shift ${shift}`);
  }
  // The rejected lagged order (advected value + w x Laplacian of the source at the arrival cell) goes negative:
  const advected = rc.reactantExchangeThenAdvect(step, { dims, weight: 0, shift: [2, 0, 0] });
  const lagLap = rc.reactantExchangeStep(step, { dims, weight: 1 });
  let lagMin = Infinity;
  for (let i = 0; i < n; i += 1) lagMin = Math.min(lagMin, advected[i] + weight * (lagLap[i] - step[i]));
  assert.ok(lagMin < -0.1, `the lagged order creates negative material (${lagMin}) that a zero clamp would turn into new material`);
  const exact = rc.reactantExchangeThenAdvect(step, { dims, weight, shift: [2, 0, 0] });
  const exchanged = rc.reactantExchangeStep(step, { dims, weight });
  close(exact[at(12, 3, 3)], exchanged[at(10, 3, 3)], 1e-12, 'a whole-cell shift carries the exchanged field exactly');
});

test('the exchange moves nothing into solid cells or across them', () => {
  const dims = [5, 1, 1];
  const solid = new Uint8Array([0, 0, 1, 0, 0]);
  const field = Float64Array.from([1, 0, 0, 0, 0]);
  let f = field;
  for (let i = 0; i < 20; i += 1) f = rc.reactantExchangeStep(f, { dims, weight: 0.15, solid });
  assert.equal(f[2], 0, 'the solid cell holds nothing');
  assert.equal(f[3] + f[4], 0, 'nothing crosses the solid');
  close(f[0] + f[1], 1, 1e-12, 'mass is conserved on the fluid side');
});

test('the diagnostic separates burning, too cold, no contact, depleted and ambient', () => {
  const [lo, hi] = M.ignitionBand;
  const d = s => rc.reactantDiagnostic(s, controls, 1);
  assert.equal(d({ fuel: 0.3, oxidizer: 0.8, heat: hi * 2 }), 'burning');
  assert.equal(d({ fuel: 0.3, oxidizer: 0.8, heat: lo * 0.5 }), 'too-cold', 'colocated reactants below ignition');
  assert.equal(d({ fuel: 1, oxidizer: 0, heat: lo * 0.5 }), 'no-contact', 'cold inlet stream that has not met oxidizer');
  assert.equal(d({ fuel: 0.97, oxidizer: 0, heat: hi * 2 }), 'no-contact', 'a HOT inlet stream that has not met air is no-contact, not depleted (the hot-inlet basin)');
  assert.equal(d({ fuel: 0.6, oxidizer: 0, heat: hi * 2 }), 'air-starved', 'a rich mixture that met air and burned it all: fuel left, contact-limited');
  assert.equal(d({ fuel: 0, oxidizer: 0.4, heat: hi * 2 }), 'depleted', 'hot products whose fuel is used up');
  assert.equal(d({ fuel: 0.0005, oxidizer: 0, heat: hi * 2 }), 'depleted', 'stoichiometric products: both reactants used up');
  assert.equal(d({ fuel: 0, oxidizer: 1, heat: 0 }), 'ambient');
  assert.equal(d({ fuel: 0, oxidizer: 1, heat: hi * 2 }), 'ambient', 'air warmed by its neighbours has burned nothing');
  // The mixture fraction comes from fuel - oxidizer/s, which burning does not change.
  const s = M.oxidizerRequirement;
  const unburned = { fuel: 0.2, oxidizer: 0.8, heat: hi * 2, smoke: 0 };
  const after = rc.reactantBurnStep(unburned, controls, 1);
  close(rc.reactantMixtureFraction(after), rc.reactantMixtureFraction(unburned), 1e-12, 'burning conserves the mixture fraction');
  close(rc.reactantMixtureFraction({ fuel: 1, oxidizer: 0 }), 1, 1e-12, 'the inlet stream is Z = 1');
  close(rc.reactantMixtureFraction({ fuel: 0, oxidizer: 1 }), 0, 1e-12, 'ambient air is Z = 0');
  close(rc.reactantMixtureFraction({ fuel: 0.5, oxidizer: 0 }, M, { streamFuel: 0.5 }), 1, 1e-12, 'a Fuel Fraction 0.5 stream is Z = 1 for its own stream');
  assert.ok(s > 0);
  assert.deepEqual(rc.REACTANT_DIAGNOSTIC_CLASSES, ['ambient', 'no-contact', 'air-starved', 'too-cold', 'mixing-limited', 'burning', 'depleted', 'products']);
  // Too cold means the thermal state is below full ignition, not merely "burning slower than the threshold".
  assert.equal(rc.reactantDiagnosticFromField({ fuel: 0.003, oxidizer: 0.5, heat: 1.0, freshBurnRate: 0.0008 }), 'mixing-limited', 'hot colocated reactants burning slowly are mixing-limited, not too cold');
  assert.equal(rc.reactantDiagnosticFromField({ fuel: 0.05, oxidizer: 0.5, heat: 0.05, freshBurnRate: 0 }), 'too-cold', 'would burn at full ignition, does not because it is cold');
  // Counterfactual: too cold only if full ignition would make it burn at the threshold rate.
  assert.equal(rc.reactantDiagnosticFromField({ fuel: 0.003, oxidizer: 0.5, heat: 0.29, freshBurnRate: 0 }, M, { mixingTimeSteps: 3, dt: 1 }), 'mixing-limited', 'nearly ignited but too little to burn at the threshold rate is not too cold');
  assert.equal(rc.reactantDiagnosticFromField({ fuel: 0.003, oxidizer: 0.5, heat: 0.05, freshBurnRate: 0 }, M, { mixingTimeSteps: 3, dt: 1 }), 'mixing-limited', 'even when cold: heating it would not make it burn at the threshold rate');
  assert.equal(rc.reactantDiagnosticFromField({ fuel: 0.05, oxidizer: 0.5, heat: 0.29, freshBurnRate: 0 }, M, { mixingTimeSteps: 3, dt: 1 }), 'too-cold', 'enough to burn, held back by the last of the ignition band');
  // Burned out and still hot is depleted; burned out and cooled is products.
  assert.equal(rc.reactantDiagnosticFromField({ fuel: 0, oxidizer: 0.4, heat: 0.02, freshBurnRate: 0 }), 'products', 'cooled products are not a depleted flame');
  assert.equal(rc.reactantDiagnosticFromField({ fuel: 0.3, oxidizer: 0.8, heat: lo * 0.5, freshBurnRate: 0.01 }), 'burning', 'a stored cell that burned this step is burning whatever its post-burn state');
  assert.equal(rc.reactantDiagnosticFromField({ fuel: 0.3, oxidizer: 0.8, heat: lo * 0.5, freshBurnRate: 0 }), 'too-cold');
});

test('the reactant law is admitted only for the tall plume with an inflow or immersed source', () => {
  const off = rc.resolveReactantCombustionConfig({});
  assert.equal(off.requested.law, rc.REACTION_LAW_AUTHORED);
  assert.equal(off.effective.admitted, false);
  assert.equal(off.effective.reason, 'reaction-law-is-authored');
  const base = { reactionLaw: rc.REACTION_LAW_REACTANT, volumeScene: 'tall_plume', emitterSourceLaw: 'inflow-boundary' };
  const on = rc.resolveReactantCombustionConfig(base, { grid: 32 });
  assert.equal(on.effective.admitted, true);
  assert.equal(on.effective.mixingTimeSteps, rc.REACTANT_CONTROL_DEFAULTS.mixingTimeSteps);
  assert.equal(on.effective.coolingTimeSteps, rc.REACTANT_CONTROL_DEFAULTS.coolingTimeSteps);
  close(on.effective.exchange.requested, M.exchangeDiffusivity / (2 / 32) ** 2, 1e-15, 'exchange weight per reference step for this grid');
  assert.equal(rc.resolveReactantCombustionConfig({ ...base, emitterSourceLaw: 'immersed-source' }, { grid: 32 }).effective.admitted, true);
  assert.equal(rc.resolveReactantCombustionConfig({ ...base, volumeScene: 'bonfire' }, { grid: 32 }).effective.reason, 'reactant-law-requires-tall-plume-scene');
  assert.equal(rc.resolveReactantCombustionConfig({ ...base, emitterSourceLaw: 'legacy-volume' }, { grid: 32 }).effective.reason, 'reactant-law-requires-inflow-or-immersed-source');
  assert.equal(rc.resolveReactantCombustionConfig(base, { grid: 32, transportCommonCharacteristic: false }).effective.reason, 'reactant-law-requires-common-gas-transport', 'the oxidizer must ride the fuel characteristic');
  assert.equal(rc.resolveReactantCombustionConfig(base, { grid: 32, transportCommonCharacteristic: true }).effective.admitted, true);
  assert.equal(rc.resolveReactantCombustionConfig(base, { grid: 32, sourceAdmitted: false }).effective.reason, 'reactant-law-requires-an-admitted-source', 'a requested but refused source (e.g. a Cluster emitter family under inflow-boundary) admits no fuel, so the law is not admitted either');
  assert.equal(rc.resolveReactantCombustionConfig(base, { grid: 32, sourceAdmitted: true }).effective.admitted, true);
  const tuned = rc.resolveReactantCombustionConfig({ ...base, reactantMixingTime: 9, reactantCoolingTime: 120 }, { grid: 32 });
  assert.equal(tuned.effective.mixingTimeSteps, 9);
  assert.equal(tuned.effective.coolingTimeSteps, 120);
  const clamped = rc.resolveReactantCombustionConfig({ ...base, reactantMixingTime: 1e6, reactantCoolingTime: -3 }, { grid: 32 });
  assert.equal(clamped.effective.mixingTimeSteps, rc.REACTANT_CONTROL_RANGES.mixingTimeSteps[1]);
  assert.equal(clamped.effective.coolingTimeSteps, rc.REACTANT_CONTROL_RANGES.coolingTimeSteps[0]);
  assert.equal(rc.resolveReactantCombustionConfig({ ...base, reactionLaw: 'nonsense' }).requested.law, rc.REACTION_LAW_AUTHORED, 'an unknown law request reads as the authored law');
});

test('the uniform block packs the admitted law and zeros otherwise', () => {
  assert.equal(rc.REACTANT_COMBUSTION_UNIFORM_FLOATS, 16);
  const on = rc.resolveReactantCombustionConfig({ reactionLaw: rc.REACTION_LAW_REACTANT, volumeScene: 'tall_plume', emitterSourceLaw: 'inflow-boundary' }, { grid: 32 });
  const values = rc.reactantCombustionUniformValues(on);
  assert.equal(values.length, 16);
  assert.deepEqual(values, [
    1, on.effective.mixingTimeSteps, on.effective.coolingTimeSteps, M.exchangeDiffusivity / (2 / 32) ** 2,
    M.oxidizerRequirement, M.heatOfCombustion, M.sootYield, M.sootRetirementSteps,
    M.ignitionBand[0], M.ignitionBand[1], M.ambientOxidizer, M.inletOxidizer,
    M.appearanceBurnReference, rc.REACTANT_EXCHANGE_STABLE_WEIGHT, 0, 0,
  ]);
  assert.deepEqual(rc.reactantCombustionUniformValues(rc.resolveReactantCombustionConfig({})), new Array(16).fill(0));
  // The kernel multiplies the packed per-unit-dt weight by its own timeStep; the receipt reports the weight at the effective dt.
  const half = rc.resolveReactantCombustionConfig({ reactionLaw: rc.REACTION_LAW_REACTANT, volumeScene: 'tall_plume', emitterSourceLaw: 'inflow-boundary' }, { grid: 32, dt: 0.5 });
  assert.equal(rc.reactantCombustionUniformValues(half)[3], values[3], 'the packed weight does not depend on dt');
  close(half.effective.exchange.requested, values[3] * 0.5, 1e-15, 'the receipt weight is at the effective dt');
  assert.equal(half.effective.exchange.dt, 0.5);
  const big = rc.resolveReactantCombustionConfig({ reactionLaw: rc.REACTION_LAW_REACTANT, volumeScene: 'tall_plume', emitterSourceLaw: 'inflow-boundary', reactantModelOverrides: { exchangeDiffusivity: 1e-2 } }, { grid: 32, dt: 2 });
  assert.equal(big.effective.exchange.capped, true, 'the cap is judged at the effective dt, as the kernel applies it');
});

test('the WGSL burn reads only local material, thermal state, dt and the mixing time', () => {
  const wgsl = rc.REACTANT_COMBUSTION_WGSL;
  const fnText = name => { const start = wgsl.indexOf(`fn ${name}(`); assert.ok(start >= 0, `${name} present`); return wgsl.slice(start, wgsl.indexOf('\n}\n', start)); };
  const burn = fnText('reactantBurn');
  assert.match(burn, /^fn reactantBurn\(fuel: f32, oxidizer: f32, heat: f32, dt: f32\) -> vec4<f32>/);
  assert.doesNotMatch(burn, /flame|ember|lick|Lick|shred|Shred|front|Front|detail|Detail|micro|fleck|memory|Memory/, 'no appearance field enters the reaction');
  assert.doesNotMatch(burn, /\bp\.|cell|GRID|Height|height|primitive_source|inflow/, 'no position, grid or emitter geometry enters the reaction');
  assert.match(burn, /min\(fuel, oxidizer \/ s\)/, 'the available amount is the limiting reactant');
  assert.match(burn, /1\.0 - exp\(-dt \/ mixingTime\)/, 'the mixing time is a rate');
  fnText('reactantExchangeWeightFor');
  fnText('reactantCoolingSurvival');
  fnText('reactantSootSurvival');
});
