// Session diagnostic only. Ordering matches Uniforms.detail_force_isolation.
const TERMS = ['detail', 'micro', 'shred', 'fine'];
export function detailForceIsolationMask(mode = 'all') {
  if (mode === 'all') return [1, 1, 1, 1];
  const match = /^(without|only)-(detail|micro|shred|fine)$/.exec(mode);
  if (!match) throw new Error(`Unknown detail force isolation: ${mode}`);
  return TERMS.map(term => +(match[1] === 'only' ? term === match[2] : term !== match[2]));
}

export function detailForceIsolationReceipt(controls = {}) {
  const requested = controls.detailForceIsolation ?? 'all';
  const requestedMask = detailForceIsolationMask(requested);
  const masterEnabled = controls.proceduralDetailForces !== false;
  const detailSuppressedByScene = controls.volumeScene === 'tall_plume';
  const sceneGain = controls.volumeScene === 'bonfire_plume'
    ? Math.max(0, Math.min(1.5, controls.bonfireDetailForces ?? 1)) : 1;
  return {
    requested, terms: [...TERMS], requestedMask, masterEnabled, detailSuppressedByScene, sceneGain,
    effectiveMask: requestedMask.map((gain, i) => masterEnabled && !(i === 0 && detailSuppressedByScene) ? gain * sceneGain : 0),
    scope: 'force-injection-only; transported fields and prior velocity persist',
  };
}
