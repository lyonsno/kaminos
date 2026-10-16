// Verdicts the live witness reaches from what it observed, kept apart so that
// tests can show a verdict cannot pass for the wrong reason.

// Background tabs must hold no vantage link, and the page opened after them must
// hold its own. Pages are told apart by their vantage page ids, never by counts.
export function restingTabsVerdict({backgroundIds, freshId, connectedIds}) {
  const reasons = [];
  const linked = backgroundIds.filter(id => connectedIds.includes(id));
  if (linked.length) reasons.push(`background tabs still linked: ${linked.join(', ')}`);
  if (!freshId) reasons.push('the page opened after them never installed its vantage');
  else if (!connectedIds.includes(freshId)) reasons.push(`the page opened after them (${freshId}) is not linked`);
  return {ok: reasons.length === 0, reasons};
}
