// Nearest-surface coverage rejects Gaussian weights below this threshold.
// Grazing attenuation narrows the accepted contour; this sigma is front-facing.
export const SURFACE_SPLAT_SUPPORT_CUTOFF=.08;
export const SURFACE_SPLAT_FRONT_SUPPORT_SIGMA=Math.sqrt(-2*Math.log(SURFACE_SPLAT_SUPPORT_CUTOFF));
