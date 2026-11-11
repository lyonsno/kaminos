// Compatible uniform lanes; only the retained Shred term has authority.
export function detailForceContributionMask() {
  return [0, 0, 1, 0];
}

export function detailForceContributionReceipt() {
  return {
    terms: ['unused', 'unused', 'shred', 'unused'],
    effectiveMask: detailForceContributionMask(),
    scope: 'interface-localized-shred-only; gain zero removes force, transported memory persists',
  };
}
