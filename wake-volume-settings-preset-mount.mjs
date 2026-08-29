import { validateVolumeSettingsPresetDocument } from './volume-settings-preset-contract.mjs';


export const WAKE_FIRE_PRESET_ROUTE_PARAM = 'wake_fire_preset';
export const WAKE_FIRE_PRESET_MOUNT_IDENTITY = 'kaminos.wake-fire-preset-mount.v1';
export const WAKE_FIRE_PRESET_PRESENTATION = 'raymarch-only';


function controlValue(descriptor) {
  return Object.hasOwn(descriptor, 'rawValue') ? descriptor.rawValue : descriptor.value;
}


export function wakeFirePresetControlEntries(receipt) {
  const basinEntries = Object.entries(receipt.preset.domControls).map(([id, descriptor]) => ({
    id,
    param: descriptor.param,
    role: 'basin',
    requestedValue: controlValue(descriptor),
  }));
  const rendererEntries = Object.entries(receipt.preset.rendererControls || {}).map(([id, descriptor]) => ({
    id,
    param: descriptor.param,
    role: 'renderer',
    requestedValue: controlValue(descriptor),
  }));
  return Object.freeze([...basinEntries, ...rendererEntries].map(Object.freeze));
}


export async function loadWakeFirePreset(presetRef, options = {}) {
  const requestedPresetRef = String(presetRef || '').trim();
  if (!requestedPresetRef) throw new Error('Wake fire preset handle or revision is required');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Wake fire preset fetch implementation is unavailable');
  const [artifactResponse, schemaResponse] = await Promise.all([
    fetchImpl(`/api/volume-settings-preset?id=${encodeURIComponent(requestedPresetRef)}`, { cache: 'no-store' }),
    fetchImpl('/volume-settings-preset-schema-v2.json', { cache: 'no-store' }),
  ]);
  const [artifact, schema] = await Promise.all([artifactResponse.json(), schemaResponse.json()]);
  if (!artifactResponse.ok) {
    throw new Error(artifact.error || `Wake fire preset lookup failed: ${artifactResponse.status}`);
  }
  if (!schemaResponse.ok) throw new Error(`Wake fire preset schema lookup failed: ${schemaResponse.status}`);
  return validateVolumeSettingsPresetDocument(artifact, requestedPresetRef, schema);
}


function comparableControlValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value ?? '');
}


export function createWakeFirePresetMountReceipt({
  requestedPresetRef,
  sourceReceipt,
  effectiveControlValues,
  productBudget,
  presentation,
}) {
  const entries = wakeFirePresetControlEntries(sourceReceipt);
  const effective = effectiveControlValues || {};
  const mismatches = entries.flatMap(entry => {
    if (!Object.hasOwn(effective, entry.id)) return [{ id: entry.id, reason: 'missing-effective-control' }];
    const requestedValue = comparableControlValue(entry.requestedValue);
    const effectiveValue = comparableControlValue(effective[entry.id]);
    return requestedValue === effectiveValue
      ? []
      : [{ id: entry.id, reason: 'requested-effective-mismatch', requestedValue, effectiveValue }];
  });
  if (mismatches.length > 0) {
    throw new Error(`Wake fire preset mount is partial or substituted: ${mismatches[0].id}:${mismatches[0].reason}`);
  }
  if (presentation?.boundarySplatMode !== 'off' || presentation?.effective !== WAKE_FIRE_PRESET_PRESENTATION) {
    throw new Error('Wake fire preset presentation is not raymarch-only');
  }
  if (
    Number(productBudget?.effectiveFireBudget?.resolution) !== Number(productBudget?.requestedFireBudget?.resolution)
    || Number(productBudget?.effectiveFireBudget?.renderScale) !== Number(productBudget?.requestedFireBudget?.renderScale)
    || Number(productBudget?.effectiveFireBudget?.adaptiveRays) !== Number(productBudget?.requestedFireBudget?.adaptiveRays)
  ) {
    throw new Error('Wake product fire budget did not become effective after preset mounting');
  }
  return Object.freeze({
    identity: WAKE_FIRE_PRESET_MOUNT_IDENTITY,
    requested: Object.freeze({
      presetRef: requestedPresetRef,
      presentation: WAKE_FIRE_PRESET_PRESENTATION,
      sourceAuthority: sourceReceipt.sourcePresetAuthority,
    }),
    effective: Object.freeze({
      alias: sourceReceipt.alias,
      label: sourceReceipt.label,
      presetId: sourceReceipt.presetId,
      contentHash: sourceReceipt.contentHash,
      schemaIdentity: sourceReceipt.schemaIdentity,
      sourceAuthority: sourceReceipt.sourcePresetAuthority,
      storePath: sourceReceipt.storePath,
      basinControlCount: sourceReceipt.preset.controlCount,
      rendererControlCount: sourceReceipt.rendererControlCount,
      mountedControlCount: entries.length,
      presentation: WAKE_FIRE_PRESET_PRESENTATION,
      boundarySplatMode: 'off',
      productBudget: Object.freeze({ ...productBudget.effectiveFireBudget }),
    }),
  });
}
