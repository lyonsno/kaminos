import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { REACTANT_MODEL, REACTANT_CONTROL_DEFAULTS, reactantBurnStep, calibrateReactantTemperature } from '../volume-reactant-combustion.mjs';
import { PHYSICS_COLD_KELVIN, physicsSootKelvin } from '../volume-physics-appearance.mjs';

// Historical pre-adoption baseline, deliberately independent of today's default.
const LEGACY_KELVIN_PER_HEAT = 1600;

const check = (condition, message) => { if (!condition) throw new Error(message); };
const close = (a, b, tolerance) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;

function validateReference(reference) {
  check(reference.identity === 'kaminos.flame-temperature-reference.v1' && reference.status === 'complete', 'reference is not complete');
  const e = reference.effective;
  check(e?.backend === 'cantera' && e.constraint === 'HP' && e.mechanism === 'gri30.yaml'
    && e.version === '3.2.0' && /^[a-f0-9]{64}$/.test(e.mechanismSha256), 'reference route is not Cantera 3.2.0 / GRI30 / HP');
  const q = reference.requested;
  check(q?.fuel === 'CH4' && q.oxidizer === 'O2:1, N2:3.76', 'this comparison supports methane/air reference only');
  check(Number.isFinite(q.pressurePa) && q.pressurePa > 0, 'reference pressure is invalid');
  check(Array.isArray(reference.rows) && reference.rows.length > 0 && reference.rows.length === q.cases?.length, 'reference cases are missing or partial');
  reference.rows.forEach((r, i) => {
    const requested = q.cases[i];
    check(r.initialKelvin === requested.initialKelvin && r.equivalenceRatio === requested.equivalenceRatio, 'reference case differs from request');
    check(Number.isFinite(r.equivalenceRatio) && r.equivalenceRatio > 0 && Number.isFinite(r.initialKelvin)
      && r.initialKelvin >= PHYSICS_COLD_KELVIN && Number.isFinite(r.finalKelvin) && r.finalKelvin > r.initialKelvin, 'reference temperatures or mixture are invalid');
    check(close(r.initial?.temperatureKelvin, r.initialKelvin, 1e-6), 'effective initial temperature differs');
    check(close(r.initial?.pressurePa, q.pressurePa, q.pressurePa * 1e-7)
      && close(r.final?.pressurePa, q.pressurePa, q.pressurePa * 1e-7), 'reference did not preserve pressure');
    check(close(r.initial?.enthalpyMass, r.final?.enthalpyMass, Math.max(1, Math.abs(r.initial?.enthalpyMass)) * 1e-6), 'reference did not conserve enthalpy');
    for (const state of [r.initial, r.final]) {
      const fractions = Object.values(state.massFractions ?? {});
      check(fractions.length === e.speciesCount && fractions.length === 53 && fractions.every(v => Number.isFinite(v) && v >= -1e-12)
        && close(fractions.reduce((a, b) => a + b, 0), 1, 1e-8), 'reference species output is incomplete or invalid');
    }
  });
}

// Equivalence ratio is matched, not mass fraction: current s=3 has no claim to
// the physical methane/air mass ratio. The comparison exposes that limitation.
function parcel(phi, model) {
  check(model.inletOxidizer === 0, 'reference parcel requires the current fuel-only stream');
  const z = phi * model.ambientOxidizer / (model.oxidizerRequirement + phi * model.ambientOxidizer);
  return { fuel: z, oxidizer: model.ambientOxidizer * (1 - z) };
}

function localBurn(initial, model, kelvinPerHeat, dt) {
  let state = { ...initial, smoke: 0 };
  const available = () => Math.min(state.fuel, state.oxidizer / model.oxidizerRequirement);
  const initialAvailable = available();
  const steps = [];
  let status = 'depleted';
  // Relative 1e-10 reactant residue bounds the omitted heat, not run duration.
  while (available() > initialAvailable * 1e-10) {
    const next = reactantBurnStep(state, { ...REACTANT_CONTROL_DEFAULTS, model }, dt);
    steps.push({ ...next, step: steps.length + 1 });
    if (next.burned === 0) { status = 'not-ignited'; break; }
    if (next.fuel === state.fuel && next.oxidizer === state.oxidizer) { status = 'stalled'; break; }
    state = next;
  }
  const burned = initial.fuel - state.fuel;
  return { status, dt, burned, remainingFuel: state.fuel, remainingOxidizer: state.oxidizer,
    finalKelvin: physicsSootKelvin(state.heat, kelvinPerHeat),
    energyResidual: Math.abs(state.heat - initial.heat - model.heatOfCombustion * burned), steps };
}

export function compareTemperatureReference(reference) {
  validateReference(reference);
  const model = REACTANT_MODEL;
  const anchors = reference.rows.filter(r => r.equivalenceRatio === 1 && r.initialKelvin === PHYSICS_COLD_KELVIN);
  check(anchors.length === 1, 'exactly one 300 K stoichiometric anchor is required');
  const calibration = calibrateReactantTemperature({ ...anchors[0], ...parcel(1, model), ambientKelvin: PHYSICS_COLD_KELVIN }, model);
  const rows = reference.rows.map(r => {
    const material = parcel(r.equivalenceRatio, model);
    const heatRise = model.heatOfCombustion * Math.min(material.fuel, material.oxidizer / model.oxidizerRequirement);
    const initialHeat = (r.initialKelvin - PHYSICS_COLD_KELVIN) / calibration.kelvinPerHeat;
    const potentialKelvin = physicsSootKelvin(initialHeat + heatRise, calibration.kelvinPerHeat);
    const coarse = localBurn({ ...material, heat: initialHeat }, model, calibration.kelvinPerHeat, 1);
    const subdivided = localBurn({ ...material, heat: initialHeat }, model, calibration.kelvinPerHeat, 0.25);
    return { initialKelvin: r.initialKelvin, equivalenceRatio: r.equivalenceRatio, material, referenceKelvin: r.finalKelvin,
      potentialKelvin, potentialErrorKelvin: potentialKelvin - r.finalKelvin,
      legacyPotentialKelvin: r.initialKelvin + heatRise * LEGACY_KELVIN_PER_HEAT,
      localBurn: { ...coarse, subdivisionDifferenceKelvin: Math.abs(coarse.finalKelvin - subdivided.finalKelvin) }, subdividedBurn: subdivided };
  });
  return { identity: 'kaminos.flame-temperature-calibration.v1', status: 'complete',
    scope: 'offline reference fit and CPU local-burn validation; not a GPU trajectory or named-fuel simulation',
    calibration, model, legacyKelvinPerHeat: LEGACY_KELVIN_PER_HEAT,
    ignitionKelvin: model.ignitionBand.map(h => physicsSootKelvin(h, calibration.kelvinPerHeat)),
    reference: { requested: reference.requested, effective: reference.effective }, rows,
    limits: ['Calibration fits only the 300 K stoichiometric methane-air equilibrium temperature.',
      'Model fuel/oxidizer units are normalized, not physical species mass fractions.',
      'Potential temperatures assume complete consumption of the limiting reactant; cold parcels need ignition.',
      'No cooling, transport, expansion work, radiative loss, solids, or soot oxidation heat is included.',
      'One linear scale does not model temperature-dependent heat capacity or equilibrium dissociation.',
      'Running this comparison does not mutate production defaults or saved basins.'] };
}

function main() {
  const { values } = parseArgs({ options: { reference: { type: 'string' }, out: { type: 'string' } } });
  if (!values.out) throw new Error('--out is required');
  const out = resolve(values.out);
  mkdirSync(dirname(out), { recursive: true });
  let report = { status: 'failed', phase: 'reference-read', requestedReference: values.reference ?? null };
  try {
    check(values.reference, '--reference is required');
    const raw = readFileSync(resolve(values.reference));
    report.phase = 'reference-validation-and-calibration';
    const result = compareTemperatureReference(JSON.parse(raw));
    report.phase = 'source-identity';
    const root = fileURLToPath(new URL('../', import.meta.url));
    const files = ['volume-reactant-combustion.mjs', 'volume-physics-appearance.mjs', 'tools/flame-temperature-calibration.mjs'];
    report = { ...result, referencePath: resolve(values.reference), referenceSha256: createHash('sha256').update(raw).digest('hex'),
      source: { root, revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
        hashes: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(resolve(root, f))).digest('hex')])) } };
  } catch (error) { report.error = String(error.stack ?? error); }
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, out, kelvinPerHeat: report.calibration?.kelvinPerHeat }));
  if (report.status !== 'complete') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
