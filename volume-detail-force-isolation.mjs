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

export function detailForceContributionMask(contributions = {}) {
  return [
    1,
    contributions.micro === false ? 0 : 1,
    contributions.shred === false ? 0 : 1,
    contributions.fine === false ? 0 : 1,
  ];
}

export function detailForceContributionReceipt(controls = {}) {
  const requested = {
    micro: controls.detailForceContributions?.micro !== false,
    shred: controls.detailForceContributions?.shred !== false,
    fine: controls.detailForceContributions?.fine !== false,
  };
  const requestedMask = detailForceContributionMask(requested);
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
