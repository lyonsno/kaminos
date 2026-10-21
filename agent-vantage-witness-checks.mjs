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

// A watch strip of the flame passes only when every frame drew the fire proxy,
// its frames came from more than one fire snapshot, and its pictures are not
// all the same. `image` is each frame's picture (any comparable value, such as
// its bytes as base64). This shows the drawn flame changed during the strip;
// it does not show how a plume develops after a drive pulse.
export function fireStripVerdict({frames}) {
  const reasons = [];
  if (frames.length < 3) reasons.push(`only ${frames.length} frames`);
  const undrawn = frames.filter(frame => frame.proxies?.fire !== 'drawn').length;
  if (undrawn) reasons.push(`${undrawn} frames did not draw the fire proxy`);
  const identities = new Set(frames.map(frame => frame.proxySnapshots?.fire).filter(Boolean).map(s => `${s.fieldGeneration ?? ''}:${s.writeTick}`)).size;
  if (identities < 2) reasons.push(`the strip drew one fire snapshot (${identities} distinct)`);
  const distinctPictures = new Set(frames.map(frame => frame.image)).size;
  if (distinctPictures < 2) reasons.push('every picture in the strip is identical');
  return {ok: reasons.length === 0, reasons, identities, distinctPictures};
}

// A sub picture's pick map drew no proxy: it must exist at the picture's size,
// with its object table, and name no proxy drawing. Missing or failed maps fail.
export function proxyFreePickMapVerdict({pickMap, pickMapError = null, image}) {
  const reasons = [];
  if (!pickMap) reasons.push(`no pick map${pickMapError ? ` (${pickMapError})` : ''}`);
  else {
    if (pickMap.width !== image?.width || pickMap.height !== image?.height) reasons.push(`pick map ${pickMap.width}×${pickMap.height} is not the picture's ${image?.width}×${image?.height}`);
    if (!Array.isArray(pickMap.objects)) reasons.push('pick map has no object table');
    else {
      const proxies = pickMap.objects.filter(row => row.id == null && /proxy/i.test(`${row.name ?? ''}`));
      if (proxies.length) reasons.push(`pick map drew proxies: ${proxies.map(row => row.name).join(', ')}`);
    }
  }
  return {ok: reasons.length === 0, reasons};
}
