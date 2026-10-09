// FLUX.2 Klein sigma schedule, reproducing diffusers 0.41.0:
// Flux2KleinPipeline (compute_empirical_mu, linspace sigmas) and
// FlowMatchEulerDiscreteScheduler.set_timesteps with exponential dynamic
// shifting. numpy evaluates the shift in float32 (python scalars are weak),
// so each operation is rounded with Math.fround.

export function computeEmpiricalMu(imageSeqLen, numSteps) {
  const a1 = 8.73809524e-05, b1 = 1.89833333, a2 = 0.00016927, b2 = 0.45666666;
  if (imageSeqLen > 4300) return a2 * imageSeqLen + b2;
  const m200 = a2 * imageSeqLen + b2, m10 = a1 * imageSeqLen + b1;
  const a = (m200 - m10) / 190.0, b = m200 - 200.0 * a;
  return a * numSteps + b;
}

function linspace(start, stop, n) {
  if (n === 1) return [start];
  const step = (stop - start) / (n - 1);
  const out = Array.from({ length: n }, (_, i) => start + i * step);
  out[n - 1] = stop;
  return out;
}

// Returns { sigmas: [n+1] (last 0), timesteps: [n], mu }, all f32-rounded.
export function kleinSchedule(imageSeqLen, numSteps) {
  const mu = computeEmpiricalMu(imageSeqLen, numSteps);
  const em = Math.fround(Math.exp(mu));
  const sigmas = linspace(1.0, 1 / numSteps, numSteps).map(Math.fround).map(t => {
    const d = Math.fround(Math.fround(1 / t) - 1);
    return Math.fround(em / Math.fround(em + d));
  });
  const timesteps = sigmas.map(s => Math.fround(s * 1000));
  return { mu, sigmas: [...sigmas, 0], timesteps };
}

// The pipeline passes timestep / 1000 and the transformer multiplies by 1000, both in f32.
export function transformerTime(timestep) {
  return Math.fround(Math.fround(timestep / 1000) * 1000);
}
