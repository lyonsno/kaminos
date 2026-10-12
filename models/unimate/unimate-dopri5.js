// Dormand-Prince 5(4) with the semantics of torchdiffeq 0.2.5 `odeint(method='dopri5')`,
// which the UniMate sampler uses (Sampler.sample_ode: rtol 1e-3, atol 1e-6, 50 output times).
//
// Reproduced details that change which steps are taken or what the drift sees:
// - the state, stage sums and interpolation are float32 (emulated with Math.fround),
//   with torch's own summation order over the stage axis;
// - times, step sizes and error ratios are float64, except inside a step, where
//   t0, dt and t1 are cast to float32 before the stage times are formed;
// - stages with alpha == 1 evaluate at the float32 value just below t1 (Perturb.PREV);
// - the initial step follows Hairer, Norsett and Wanner II.4 with two evaluations;
// - every output time is read from the step's quartic dense-output polynomial.
// The drift is async (t: float32 value, y: Float32Array) => Float32Array.

const f32 = Math.fround;
const f32arr = a => a.map(f32);

export const DOPRI5_TABLEAU = {
  alpha: f32arr([1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1]),
  beta: [
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
  ].map(f32arr),
  cError: f32arr([35 / 384 - 1951 / 21600, 0, 500 / 1113 - 22642 / 50085, 125 / 192 - 451 / 720,
    -2187 / 6784 - -12231 / 42400, 11 / 84 - 649 / 6300, -1 / 60]),
  mid: f32arr([6025192743 / 30085553152 / 2, 0, 51252292925 / 65400821598 / 2, -2691868925 / 45128329728 / 2,
    187940372067 / 1594534317056 / 2, -1776094331 / 19743644256 / 2, 11237099 / 235043384 / 2]),
};

const ORDER = 5, SAFETY = 0.9, IFACTOR = 10, DFACTOR = 0.2;

// Largest float32 strictly below x (torch.nextafter(x, x - 1) on a float32 value).
export function prevFloat32(x) {
  const b = new Float32Array([x]), u = new Uint32Array(b.buffer);
  if (x === 0) { u[0] = 0x80000001; return b[0]; }
  if (x > 0) u[0] -= 1; else u[0] += 1;
  return b[0];
}

function rmsScaled(v, scaleOf) {
  let s = 0;
  for (let i = 0; i < v.length; i++) { const q = v[i] / scaleOf(i); s += q * q; }
  return Math.sqrt(s / v.length);
}

// torch 2.5 CPU float32 sum over a short contiguous last dimension (row_sum with a
// 4-way ILP split): terms 0..3 start four partials, later terms join partial 0,
// then partials 1..3 are added in order. Verified against torch for lengths 1..7
// (probe recorded in the port report). Valid for n < 8 only.
function torchRowSum(x, n) {
  if (n < 4) { let s = 0; for (let j = 0; j < n; j++) s = f32(s + x[j]); return s; }
  let p0 = x[0];
  for (let j = 4; j < n; j++) p0 = f32(p0 + x[j]);
  return f32(f32(f32(p0 + x[1]) + x[2]) + x[3]);
}

// y0 + sum_s k[s] * coef[s] in float32, with torch's reduction order.
function stageSum(y0, ks, coefs) {
  const n = coefs.length, out = new Float32Array(y0.length), terms = new Float32Array(n);
  for (let i = 0; i < y0.length; i++) {
    for (let j = 0; j < n; j++) terms[j] = f32(ks[j][i] * coefs[j]);
    out[i] = f32(y0[i] + torchRowSum(terms, n));
  }
  return out;
}

function interpFit(y0, y1, ks, dt64) {
  const dt = f32(dt64), n = y0.length;
  const ymid = stageSum(y0, ks, DOPRI5_TABLEAU.mid.map(m => f32(dt * m)));
  const f0 = ks[0], f1 = ks[ks.length - 1];
  const a = new Float32Array(n), b = new Float32Array(n), c = new Float32Array(n), d = new Float32Array(n);
  const dt2 = f32(2 * dt);
  for (let i = 0; i < n; i++) {
    a[i] = f32(f32(f32(dt2 * f32(f1[i] - f0[i])) - f32(8 * f32(y1[i] + y0[i]))) + f32(16 * ymid[i]));
    b[i] = f32(f32(f32(f32(dt * f32(f32(5 * f0[i]) - f32(3 * f1[i]))) + f32(18 * y0[i])) + f32(14 * y1[i])) - f32(32 * ymid[i]));
    c[i] = f32(f32(f32(f32(dt * f32(f1[i] - f32(4 * f0[i]))) - f32(11 * y0[i])) - f32(5 * y1[i])) + f32(16 * ymid[i]));
    d[i] = f32(dt * f0[i]);
  }
  return [Float32Array.from(y0), d, c, b, a];
}

function interpEvaluate(coeff, t0, t1, t) {
  if (!(t0 <= t && t <= t1)) throw new RangeError(`invalid interpolation ${t0} <= ${t} <= ${t1}`);
  const x = f32((t - t0) / (t1 - t0)), n = coeff[0].length, out = new Float32Array(n);
  const xp2 = f32(x * x), xp3 = f32(xp2 * x), xp4 = f32(xp3 * x);
  for (let i = 0; i < n; i++) {
    let total = f32(coeff[0][i] + f32(x * coeff[1][i]));
    total = f32(total + f32(xp2 * coeff[2][i]));
    total = f32(total + f32(xp3 * coeff[3][i]));
    out[i] = f32(total + f32(xp4 * coeff[4][i]));
  }
  return out;
}

function optimalStep(dt, ratio) {
  if (ratio === 0) return dt * IFACTOR;
  const dfactor = ratio < 1 ? 1 : DFACTOR;
  const factor = Math.min(IFACTOR, Math.max(SAFETY / ratio ** (1 / ORDER), dfactor));
  return dt * factor;
}

async function selectInitialStep(drift, t0, y0, f0, rtol, atol, onEval) {
  const scale = i => atol + Math.abs(y0[i]) * rtol;
  const d0 = rmsScaled(y0, scale), d1 = rmsScaled(f0, scale);
  const h0 = d0 < 1e-5 || d1 < 1e-5 ? f32(1e-6) : 0.01 * d0 / d1;
  const h0f = f32(h0), y1 = new Float32Array(y0.length);
  for (let i = 0; i < y0.length; i++) y1[i] = f32(y0[i] + f32(h0f * f0[i]));
  const t = f32(t0 + h0);
  const f1 = await drift(t, y1);
  onEval?.({ t, kind: 'initial-step' });
  const diff = new Float32Array(y0.length);
  for (let i = 0; i < y0.length; i++) diff[i] = f32(f1[i] - f0[i]);
  const d2 = Math.abs(rmsScaled(diff, scale) / h0);
  const h1 = d1 <= 1e-15 && d2 <= 1e-15 ? Math.max(1e-6, h0 * 1e-3) : (0.01 / Math.max(d1, d2)) ** (1 / (ORDER - 1 + 1));
  return Math.min(100 * h0, h1);
}

// One adaptive step from state st. forced: {dt, accepted} replays a reference
// step: dt replaces the controller's size and, when given, accepted replaces its
// decision (the error ratio is still computed and reported).
async function adaptiveStep(st, drift, rtol, atol, onEval, forced) {
  const { y1: y0, f1: f0, t1: t0 } = st;
  let dt = forced?.dt ?? st.dt;
  if (!Number.isFinite(dt)) dt = 0;
  dt = Math.max(0, dt);
  const t1 = t0 + dt;
  const t0f = f32(t0), dtf = f32(dt), t1f = f32(t1);
  const ks = [f0];
  let yi = null;
  for (let s = 0; s < 6; s++) {
    const alpha = DOPRI5_TABLEAU.alpha[s];
    const ti = alpha === 1 ? prevFloat32(t1f) : f32(t0f + f32(alpha * dtf));
    yi = stageSum(y0, ks, DOPRI5_TABLEAU.beta[s].map(b => f32(b * dtf)));
    const f = await drift(ti, yi);
    onEval?.({ t: ti, kind: `stage${s + 2}` });
    ks.push(f);
  }
  const y1 = yi, f1 = ks[6];
  const errCoef = DOPRI5_TABLEAU.cError.map(c => f32(dtf * c));
  const err = new Float32Array(y0.length), terms = new Float32Array(7);
  for (let i = 0; i < y0.length; i++) {
    for (let j = 0; j < 7; j++) terms[j] = f32(ks[j][i] * errCoef[j]);
    err[i] = torchRowSum(terms, 7);
  }
  const ratio = rmsScaled(err, i => atol + rtol * Math.max(Math.abs(y0[i]), Math.abs(y1[i])));
  const accepted = typeof forced?.accepted === 'boolean' ? forced.accepted : (dt <= 0 ? true : ratio <= 1);
  const dtNext = optimalStep(dt, ratio);
  const step = { t0, dt, accepted, errorRatio: ratio, dtNext };
  if (accepted) {
    return { step, state: { y1, f1, t0, t1, dt: dtNext, interp: interpFit(y0, y1, ks, dt) } };
  }
  return { step, state: { y1: y0, f1: f0, t0, t1: t0, dt: dtNext, interp: st.interp } };
}

// outputTimes: float64 values (the float32 linspace the sampler builds).
// forcedSteps: optional reference step list [{dt, accepted}] to replay instead of the
// controller; forcedFirstStep replaces the selected first step (its two evaluations still run).
export async function dopri5Solve({ y0, drift, outputTimes, rtol = 1e-3, atol = 1e-6, forcedSteps = null, forcedFirstStep = null,
  onEval = null, onStep = null }) {
  const t0 = outputTimes[0];
  const f0 = await drift(f32(t0), y0);
  onEval?.({ t: f32(t0), kind: 'initial' });
  const selectedFirstStep = await selectInitialStep(drift, t0, y0, f0, rtol, atol, onEval);
  const firstStep = forcedFirstStep ?? selectedFirstStep;
  let st = { y1: y0, f1: f0, t0, t1: t0, dt: firstStep, interp: [y0, y0, y0, y0, y0] };
  const steps = [], solution = [Float32Array.from(y0)];
  for (let k = 1; k < outputTimes.length; k++) {
    const next = outputTimes[k];
    while (next > st.t1) {
      const forced = forcedSteps ? forcedSteps[steps.length] : null;
      if (forcedSteps && !forced) throw new Error(`forced step list exhausted at step ${steps.length}`);
      const r = await adaptiveStep(st, drift, rtol, atol, onEval, forced);
      steps.push(r.step);
      onStep?.(r.step, steps.length - 1);
      st = r.state;
    }
    solution.push(interpEvaluate(st.interp, st.t0, st.t1, next));
  }
  return { solution, steps, firstStep, selectedFirstStep };
}
