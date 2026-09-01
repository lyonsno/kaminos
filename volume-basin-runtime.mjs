export const KAMINOS_VOLUME_BASIN_STORAGE_KEY = 'kaminos.volume.lastBasin.v1';
export const KAMINOS_VOLUME_BASIN_SLOT_STORAGE_PREFIX = 'kaminos.volume.basinSlot.v1.';
export const VOLUME_BASIN_SNAPSHOT_IDENTITY = 'kaminos-volume-basin-snapshot-v1';

export function formatVolumeBasinRouteValue(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  return String(value ?? '');
}

export function buildVolumeBasinUrl({ href, controls, routeFields } = {}) {
  if (!controls || typeof controls !== 'object' || Array.isArray(controls)) {
    throw new Error('volume Basin controls must be an object');
  }
  if (!Array.isArray(routeFields)) throw new Error('volume Basin routeFields must be an array');
  const url = new URL(String(href || ''));
  url.search = '';
  url.searchParams.set('kaminos_volume_smoke', '1');
  for (const [key, param] of routeFields) {
    if (controls[key] === undefined || controls[key] === null) continue;
    url.searchParams.set(param, formatVolumeBasinRouteValue(controls[key]));
  }
  if (controls.emitterFamily !== undefined
      && controls.emitterFamily !== null
      && !url.searchParams.has('volume_emitter_family')) {
    throw new Error('volume_emitter_family is required for an emitter-bearing Basin');
  }
  url.searchParams.set('volume_quality_reason', 'pyro-contrast-basin-copied-0702');
  return url.toString();
}

export function createVolumeBasinSnapshot({ reason, controls, href, routeFields, now } = {}) {
  return {
    identity: VOLUME_BASIN_SNAPSHOT_IDENTITY,
    reason: String(reason || 'control-change'),
    savedAt: now || new Date().toISOString(),
    controls: structuredClone(controls),
    url: buildVolumeBasinUrl({ href, controls, routeFields }),
  };
}

export function persistVolumeBasinSnapshot({ storage, storageKey, ...snapshotOptions } = {}) {
  if (typeof storage?.setItem !== 'function') throw new Error('volume Basin storage.setItem is required');
  const snapshot = createVolumeBasinSnapshot(snapshotOptions);
  storage.setItem(storageKey, JSON.stringify(snapshot));
  return snapshot;
}

function validateRestoredEmitterReceipt(snapshot, restoredControls, receipt) {
  const family = String(snapshot.controls.emitterFamily || 'cluster');
  if (restoredControls.emitterFamily !== family) {
    throw new Error(`volume Basin DOM restore mismatch: saved ${family}, restored ${restoredControls.emitterFamily ?? 'missing'}`);
  }
  if (!receipt || typeof receipt !== 'object') {
    throw new Error('volume Basin runtime restore returned no receipt');
  }
  if (receipt.requested?.family !== family || receipt.effective?.family !== family) {
    throw new Error(`volume Basin runtime family mismatch: saved ${family}, requested ${receipt.requested?.family ?? 'missing'}, effective ${receipt.effective?.family ?? 'missing'}`);
  }
  if (receipt.routeReceipt?.requestedFamily !== family || receipt.routeReceipt?.effectiveFamily !== family) {
    throw new Error(`volume Basin route receipt mismatch for ${family}`);
  }
  if (receipt.fallbackUsed !== false || receipt.routeReceipt?.fallbackUsed !== false) {
    throw new Error(`volume Basin restore unexpectedly used fallback for ${family}`);
  }
  if (family !== 'cluster') {
    if (receipt.coreSourceReceipt?.effectiveOwner !== 'analytic-emitter'
        || receipt.coreSourceReceipt?.effectiveFlowRate !== 0) {
      throw new Error(`volume Basin analytic authority mismatch for ${family}`);
    }
    if (receipt.compilerReceipt?.descriptor?.family !== family) {
      throw new Error(`volume Basin analytic descriptor mismatch for ${family}`);
    }
  }
}

export function restoreVolumeBasinState({
  storage,
  storageKey,
  applyControls,
  afterApplyControls = null,
  readControls,
  applyRuntime,
} = {}) {
  if (typeof storage?.getItem !== 'function') throw new Error('volume Basin storage.getItem is required');
  let snapshot = null;
  try {
    snapshot = JSON.parse(storage.getItem(storageKey));
  } catch {}
  if (!snapshot || snapshot.identity !== VOLUME_BASIN_SNAPSHOT_IDENTITY || !snapshot.controls) {
    return { ok: false, snapshot: null, restoredControls: null, runtimeReceipt: null };
  }
  if (typeof applyControls !== 'function') throw new Error('volume Basin applyControls is required');
  if (typeof readControls !== 'function') throw new Error('volume Basin readControls is required');
  if (typeof applyRuntime !== 'function') throw new Error('volume Basin applyRuntime is required');
  applyControls(snapshot.controls);
  if (typeof afterApplyControls === 'function') afterApplyControls(snapshot.controls);
  const restoredControls = readControls();
  const runtimeReceipt = applyRuntime(restoredControls);
  validateRestoredEmitterReceipt(snapshot, restoredControls, runtimeReceipt);
  return { ok: true, snapshot, restoredControls, runtimeReceipt };
}
