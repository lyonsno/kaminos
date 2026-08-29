import { validateVolumeSettingsPresetDocument } from './volume-settings-preset-contract.mjs';


export const WAKE_FIRE_PRESET_ROUTE_PARAM = 'wake_fire_preset';
export const WAKE_FIRE_PRESET_MOUNT_IDENTITY = 'kaminos.wake-fire-preset-mount.v1';
export const WAKE_FIRE_PRESET_PRESENTATION = 'raymarch-only';
export const WAKE_FIRE_PRESET_PROJECTION_IDENTITY = 'kaminos.wake-raymarch-preset-projection.v1';

export const WAKE_FIRE_PRESET_CONSUMER_OVERRIDE_IDS = Object.freeze([
  'volume-resolution',
  'volume-render-scale',
  'volume-adaptive-rays',
  'volume-boundary-splat-mode',
]);


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


function wakeFirePresetConsumerOverrides(sourceReceipt, productBudget) {
  const entriesById = new Map(wakeFirePresetControlEntries(sourceReceipt).map(entry => [entry.id, entry]));
  const requestedBudget = productBudget?.requestedFireBudget || {};
  const overrides = [
    {
      id: 'volume-resolution',
      authority: 'wake-product-compute-policy',
      effectiveValue: requestedBudget.resolution,
    },
    {
      id: 'volume-render-scale',
      authority: 'wake-product-compute-policy',
      effectiveValue: requestedBudget.renderScale,
    },
    {
      id: 'volume-adaptive-rays',
      authority: 'wake-product-compute-policy',
      effectiveValue: requestedBudget.adaptiveRays,
    },
    {
      id: 'volume-boundary-splat-mode',
      authority: 'wake-raymarch-only-presentation',
      effectiveValue: 'off',
    },
  ];
  return Object.freeze(overrides.map(override => Object.freeze({
    ...override,
    sourceValue: entriesById.get(override.id)?.requestedValue,
  })));
}


function valuesNearlyEqual(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return Math.abs(leftNumber - rightNumber) <= 1e-6;
  }
  return comparableControlValue(left) === comparableControlValue(right);
}


function assertRendererState(rendererState, productBudget, sourceReceipt) {
  if (rendererState?.prototypeIdentity !== 'kaminos-volume-prototype-v0'
    || rendererState?.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0'
    || rendererState?.active !== true
    || !rendererState?.backend
    || rendererState.backend === 'unavailable') {
    throw new Error('Wake renderer did not consume the mounted preset on the native active route');
  }
  const expectedBudget = productBudget?.requestedFireBudget || {};
  if (Number(rendererState.simGrid) !== Number(expectedBudget.resolution)
    || Number(rendererState.renderScale) !== Number(expectedBudget.renderScale)
    || Number(rendererState.adaptiveRaymarch) !== Number(expectedBudget.adaptiveRays)) {
    throw new Error('Wake renderer did not consume the product fire budget after preset mounting');
  }
  if (rendererState.boundarySplatMode !== 'off') {
    throw new Error('Wake renderer did not consume the raymarch-only presentation');
  }
  const authoredRendererControls = sourceReceipt?.preset?.rendererControls || {};
  const flowExpectations = [
    ['volume-flow-kernel-strength', rendererState.flowKernelEffective?.strength],
    ['volume-flow-kernel-radius', rendererState.flowKernelEffective?.radiusWorld],
    ['volume-flow-kernel-coherence', rendererState.flowKernelEffective?.coherence],
  ];
  for (const [id, effectiveValue] of flowExpectations) {
    const descriptor = authoredRendererControls[id];
    if (!descriptor || !valuesNearlyEqual(controlValue(descriptor), effectiveValue)) {
      throw new Error(`Wake renderer did not consume authored renderer control ${id}`);
    }
  }
}


export function createWakeFirePresetMountReceipt({
  requestedPresetRef,
  sourceReceipt,
  effectiveControlValues,
  productBudget,
  rendererState,
}) {
  const entries = wakeFirePresetControlEntries(sourceReceipt);
  const consumerOverrides = wakeFirePresetConsumerOverrides(sourceReceipt, productBudget);
  const overridesById = new Map(consumerOverrides.map(entry => [entry.id, entry]));
  const effective = effectiveControlValues || {};
  const mismatches = entries.flatMap(entry => {
    if (!Object.hasOwn(effective, entry.id)) return [{ id: entry.id, reason: 'missing-effective-control' }];
    const requestedValue = comparableControlValue(
      overridesById.has(entry.id) ? overridesById.get(entry.id).effectiveValue : entry.requestedValue,
    );
    const effectiveValue = comparableControlValue(effective[entry.id]);
    return requestedValue === effectiveValue
      ? []
      : [{ id: entry.id, reason: 'requested-effective-mismatch', requestedValue, effectiveValue }];
  });
  if (mismatches.length > 0) {
    throw new Error(`Wake fire preset mount is partial or substituted: ${mismatches[0].id}:${mismatches[0].reason}`);
  }
  assertRendererState(rendererState, productBudget, sourceReceipt);
  if (
    Number(productBudget?.effectiveFireBudget?.resolution) !== Number(productBudget?.requestedFireBudget?.resolution)
    || Number(productBudget?.effectiveFireBudget?.renderScale) !== Number(productBudget?.requestedFireBudget?.renderScale)
    || Number(productBudget?.effectiveFireBudget?.adaptiveRays) !== Number(productBudget?.requestedFireBudget?.adaptiveRays)
  ) {
    throw new Error('Wake product fire budget did not become effective after preset mounting');
  }
  return Object.freeze({
    identity: WAKE_FIRE_PRESET_MOUNT_IDENTITY,
    projection: Object.freeze({
      identity: WAKE_FIRE_PRESET_PROJECTION_IDENTITY,
      exactAuthoredControlIds: Object.freeze(entries.filter(entry => !overridesById.has(entry.id)).map(entry => entry.id)),
      consumerOverrides,
    }),
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
      sourceControlCount: entries.length,
      exactAuthoredControlCount: entries.length - consumerOverrides.length,
      consumerOverrideCount: consumerOverrides.length,
      effectiveControlCount: entries.length,
      presentation: WAKE_FIRE_PRESET_PRESENTATION,
      boundarySplatMode: 'off',
      productBudget: Object.freeze({ ...productBudget.effectiveFireBudget }),
      renderer: Object.freeze({
        prototypeIdentity: rendererState.prototypeIdentity,
        effectiveRoute: rendererState.effectiveRoute,
        backend: rendererState.backend,
        active: rendererState.active,
        frameCount: rendererState.frameCount,
        simGrid: rendererState.simGrid,
        renderScale: rendererState.renderScale,
        adaptiveRaymarch: rendererState.adaptiveRaymarch,
        boundarySplatMode: rendererState.boundarySplatMode,
        flowKernelIdentity: rendererState.flowKernelIdentity,
        flowKernelEffective: rendererState.flowKernelEffective,
      }),
    }),
  });
}
