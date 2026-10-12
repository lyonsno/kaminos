/** Normalized isotropic poly6 averaging: M2 = 3h²/11, hence ν≈b h²/(22 dt).
 * Preserve nominal diffusion, anchored to the accepted h=.185, dt=1/60 river.
 * This is a moment scaling, not physical calibration at a truncated/free surface.
 * Scale the existing capped blend as a whole so the reference is identical.
 */
export function viscosityScale(mode,dt,h) {
  if(!['legacy','nominal_diffusion'].includes(mode))throw new RangeError('Unknown viscosity scaling mode');
  if(!Number.isFinite(dt)||dt<=0||!Number.isFinite(h)||h<=0)throw new RangeError('Positive finite timestep and support radius required');
  const factor=mode==='legacy'?1:(dt/(1/60))*(.185/h)**2;
  // The existing blend is at most .24. Extrapolation is not diffusion.
  if(!Number.isFinite(factor)||factor*.24>1)throw new RangeError('Viscosity scaling exceeds convex mixing; use a smaller timestep');
  return factor;
}
