// Ordering matches Uniforms.detail_force_isolation. Transported detail remains
// enabled internally for compatibility, but is retired from the live cockpit.
const TERMS = ['detail', 'micro', 'shred', 'fine'];

export function normalizeFineBreakupLocalization(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

export function fineBreakupSupportReceipt(controls = {}) {
  const effectiveLocalization = normalizeFineBreakupLocalization(controls.fineBreakupLocalization);
  return {
    identity: 'fine-breakup-localized-support-v0',
    requestedLocalization: controls.fineBreakupLocalization === undefined ? 0 : controls.fineBreakupLocalization,
    effectiveLocalization,
    mode: effectiveLocalization === 0 ? 'legacy-broad' : 'reaction-front-interface-shear',
    legacyPathPreserved: effectiveLocalization === 0,
    localizedEvidence: ['reaction-front', 'material-interface', 'curl-shear'],
  };
}

// The force switches were retired 2026-10-22: micro-carrier and shred run
// whenever their sliders are above 0; the fine term carries Swirl jostle's
// strength (0-2, 1 = the force as it was).
export function normalizeSwirlJostle(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(2, numeric)) : 1;
}
export function detailForceContributionMask(controls = {}) {
  return [1, 1, 1, normalizeSwirlJostle(controls.swirlJostle)];
}

export function detailForceContributionReceipt(controls = {}) {
  const requested = { micro: true, shred: true, fine: normalizeSwirlJostle(controls.swirlJostle) };
  const requestedMask = detailForceContributionMask(controls);
  const masterEnabled = true;
  const detailSuppressedByScene = true;
  const sceneGain = 1;
  return {
    requested, terms: [...TERMS], requestedMask, masterEnabled, detailSuppressedByScene, sceneGain,
    effectiveMask: requestedMask.map((gain, i) => masterEnabled && !(i === 0 && detailSuppressedByScene) ? gain * sceneGain : 0),
    scope: 'force-injection-only; transported fields and prior velocity persist',
  };
}
