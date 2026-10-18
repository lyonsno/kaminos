// Verdicts the live witness reaches from what it observed, kept apart so that
// tests can show a verdict cannot pass for the wrong reason.

// Every tab, shown or hidden, and the page opened after them must be linked by
// its own page id, all on one shared hub stream (not each on a stream of its own).
export function sharedTabsVerdict({tabIds, freshId, pages}) {
  const reasons = [], byId = new Map(pages.map(page => [page.id, page]));
  if (tabIds.some(id => !id)) reasons.push('a tab never installed its vantage');
  if (!freshId) reasons.push('the page opened after the tabs never installed its vantage');
  const ids = [...tabIds, freshId].filter(Boolean);
  const unlinked = ids.filter(id => !byId.get(id)?.connected);
  if (unlinked.length) reasons.push(`not linked: ${unlinked.join(', ')}`);
  const hubs = new Set(ids.map(id => byId.get(id)?.hub ?? null));
  if (hubs.has(null)) reasons.push('a page holds a stream of its own instead of the shared hub');
  else if (hubs.size > 1) reasons.push(`the pages are on ${hubs.size} hubs, not one`);
  return {ok: reasons.length === 0, reasons};
}
