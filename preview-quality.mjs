// Viewport Preview quality: as close to the live view as is cheap. The fire's
// raymarch is capped (fewer ray steps, lower render scale; numerical adaptive
// stepping holds the look at low step counts) and the scene renders at device
// pixel ratio 1. Nothing here touches the simulation: pressure, speed and the
// authored basin controls are left as they are.
export const PREVIEW_QUALITY_CAPS = Object.freeze({raySteps: 12, renderScale: 0.5});

export function applyPreviewQualityCaps(controls = {}) {
 const next = {...controls}, changed = [];
 for (const [key, limit] of Object.entries(PREVIEW_QUALITY_CAPS)) {
  const current = Number(next[key]);
  if (Number.isFinite(current) && current > limit) { next[key] = limit; changed.push(key); }
 }
 return {controls: next, changed};
}

export function previewScenePixelRatio(quality, devicePixelRatio = 1) {
 return quality === 'preview' ? 1 : Math.min(Math.max(1, Number(devicePixelRatio) || 1), 2);
}
