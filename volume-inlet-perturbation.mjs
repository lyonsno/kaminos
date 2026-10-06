// Inlet dynamics for the inflow-boundary source law: puffing (a slow stochastic
// modulation of the whole inlet's speed) and inlet turbulence (a slow
// stochastic field of speed perturbations across the floor aperture, with a
// spatial scale in cells). Both are properties of the prescribed inflow, so
// mass still enters only through the floor and the converged solve sees the
// same face flux the floor source and the ghost use.
//
// Signals are Ornstein–Uhlenbeck processes advanced per simulation step and
// seeded (xorshift32 + Irwin–Hall gaussian; no periodic math, no per-cell
// hash), so a replay at the same seed and step count is the same inlet. The
// correlation times are simulated seconds: under the uniform time step they
// scale with Speed through the time step's dtScale.
import { resolveTimeStepConfig } from './volume-core.js';

function clampFinite(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export const INLET_DYNAMICS_IDENTITY = 'kaminos.volume.inlet-dynamics.v1';
export const INLET_DYNAMICS_STEPS_PER_SECOND = 60;
// Turbulence is characterised by its spatial scale; its time correlation is a
// fixed half second so the field drifts rather than flickers.
export const INLET_TURBULENCE_CORRELATION_SECONDS = 0.5;
const STATIONARY_SIGMA = 0.45;

export class StochasticSignalSet {
  constructor(seed = 1, count = 1) {
    this.seed = Math.max(1, Math.floor(Number(seed) || 1)) >>> 0;
    this.count = Math.max(1, Math.floor(Number(count) || 1));
    this.reset();
  }
  reset() {
    this.rng = (this.seed * 2654435761 + 1013904223) >>> 0;
    this.step = 0;
    this.values = new Float32Array(this.count);
  }
  gaussian() {
    let sum = 0;
    for (let i = 0; i < 12; i += 1) {
      let x = this.rng;
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5; x >>>= 0;
      this.rng = x;
      sum += x / 4294967296;
    }
    return sum - 6;
  }
  // Advance incrementally to `step`; a step before the last restarts from the
  // seed. Returns the clamped signals in [-1, 1].
  sampleAt(step, tauSteps) {
    const target = Math.max(0, Math.floor(Number(step) || 0));
    const tau = Math.max(1, Number(tauSteps) || 1);
    if (target < this.step) this.reset();
    const decay = Math.exp(-1 / tau);
    const kick = STATIONARY_SIGMA * Math.sqrt(1 - decay * decay);
    while (this.step < target) {
      for (let i = 0; i < this.count; i += 1) this.values[i] = this.values[i] * decay + kick * this.gaussian();
      this.step += 1;
    }
    const out = new Float32Array(this.count);
    for (let i = 0; i < this.count; i += 1) out[i] = Math.max(-1, Math.min(1, this.values[i]));
    return out;
  }
}

// A floor field of perturbations: one signal per patch of `scaleCells` cells
// on a (patches + 1)² lattice, bilinearly interpolated to the cells. Changing
// the scale rebuilds the lattice (and restarts its signals from the seed).
export class InletPerturbationField {
  constructor({ grid = 64, seed = 1 } = {}) {
    this.grid = Math.max(4, Math.floor(Number(grid) || 64));
    this.seed = Math.max(1, Math.floor(Number(seed) || 1));
    this.cells = new Float32Array(this.grid * this.grid);
    this.lattice = null;
    this.scaleCells = null;
    this.rms = 0;
  }
  sampleAt({ step, tauSteps, scaleCells }) {
    const scale = Math.max(1, Math.min(this.grid, Math.round(Number(scaleCells) || 8)));
    const patches = Math.ceil(this.grid / scale);
    if (!this.lattice || this.scaleCells !== scale) {
      this.lattice = new StochasticSignalSet(this.seed * 7919 + scale, (patches + 1) * (patches + 1));
      this.scaleCells = scale;
    }
    const values = this.lattice.sampleAt(step, tauSteps);
    const stride = patches + 1;
    let sumSq = 0;
    for (let z = 0; z < this.grid; z += 1) {
      const pz = (z + 0.5) / scale; const z0 = Math.min(patches - 1, Math.floor(pz)); const fz = pz - z0;
      for (let x = 0; x < this.grid; x += 1) {
        const px = (x + 0.5) / scale; const x0 = Math.min(patches - 1, Math.floor(px)); const fx = px - x0;
        const v00 = values[z0 * stride + x0]; const v10 = values[z0 * stride + x0 + 1];
        const v01 = values[(z0 + 1) * stride + x0]; const v11 = values[(z0 + 1) * stride + x0 + 1];
        const v = (v00 * (1 - fx) + v10 * fx) * (1 - fz) + (v01 * (1 - fx) + v11 * fx) * fz;
        this.cells[z * this.grid + x] = v;
        sumSq += v * v;
      }
    }
    this.rms = Math.sqrt(sumSq / this.cells.length);
    return this.cells;
  }
}

// Simulated seconds → steps at the current time step (legacy: 60 per second).
export function inletDynamicsTauSteps(controls = {}, seconds) {
  const dtScale = resolveTimeStepConfig(controls).effective.dtScale;
  return Math.max(1, Number(seconds) || 1) * INLET_DYNAMICS_STEPS_PER_SECOND / Math.max(1e-3, Number.isFinite(dtScale) ? dtScale : 1);
}

// `signals` carries the current samples: { puff: Float32Array|number[], turbulence: { rms } | null }.
export function resolveInletDynamicsConfig(controls = {}, signals = {}) {
  const turbulence = clampFinite(controls.emitterInletTurbulence, 0, 1, 0);
  const turbulenceScaleCells = Math.round(clampFinite(controls.emitterInletTurbulenceScale, 1, 32, 6));
  const puff = clampFinite(controls.emitterPuff, 0, 1, 0);
  const puffPeriod = clampFinite(controls.emitterPuffPeriod, 0.5, 30, 3);
  const puffSignal = Number.isFinite(signals?.puff?.[0]) ? signals.puff[0] : 0;
  const puffFactor = puff > 0 ? Math.max(0, 1 + puff * puffSignal) : 1;
  return {
    identity: INLET_DYNAMICS_IDENTITY,
    requested: { turbulence, turbulenceScaleCells, puff, puffPeriod },
    effective: {
      turbulence,
      turbulenceScaleCells,
      turbulenceRms: turbulence > 0 && Number.isFinite(signals?.turbulence?.rms) ? signals.turbulence.rms : 0,
      puff,
      puffPeriod,
      puffSignal: puff > 0 ? puffSignal : 0,
      puffFactor,
      active: turbulence > 0 || puff > 0,
    },
  };
}
