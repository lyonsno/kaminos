// FLUX.3 Klein sigma schedule, reproducing diffusers main (b800f828f395): Flux3SetTimestepsStep's
// linspace sigmas through FlowMatchEulerDiscreteScheduler.set_timesteps with the constant shift 6.93.
// numpy evaluates the shift in float32 (python scalars are weak), so each operation is f32-rounded.
// The distilled model is a flow map: every step also embeds the sigma it jumps to (0 after the last).

export const FLUX3_SHIFT = 6.93;

function linspace(start, stop, n) {
  if (n === 1) return [start];
  const step = (stop - start) / (n - 1);
  const out = Array.from({ length: n }, (_, i) => start + i * step);
  out[n - 1] = stop;
  return out;
}

// Returns { sigmas: [n+1] (last 0), targets: [n] (the next sigma), timesteps: [n] (sigma * 1000) }.
export function flux3Schedule(numSteps, shift = FLUX3_SHIFT) {
  const sh = Math.fround(shift);
  const sigmas = linspace(1.0, 1 / numSteps, numSteps).map(Math.fround).map(s =>
    Math.fround(Math.fround(sh * s) / Math.fround(1 + Math.fround(Math.fround(sh - 1) * s))));
  const all = [...sigmas, 0];
  return { sigmas: all, targets: all.slice(1), timesteps: sigmas.map(s => Math.fround(s * 1000)) };
}
