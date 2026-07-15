export const VOLUME_SETTINGS_PRESET_SCHEMA_IDENTITY = 'kaminos-volume-settings-preset-schema-v1';

function validatePresetSchema(schema) {
  if (!schema || schema.identity !== VOLUME_SETTINGS_PRESET_SCHEMA_IDENTITY) {
    throw new Error('settings preset canonical control schema is missing or invalid');
  }
  if (!Array.isArray(schema.controls)
    || schema.controls.length !== Number(schema.controlCount)
    || new Set(schema.controls.map(entry => entry.key)).size !== schema.controls.length
    || new Set(schema.controls.map(entry => entry.param)).size !== schema.controls.length) {
    throw new Error('settings preset canonical control schema inventory is invalid');
  }
  return schema;
}

export function validateVolumeSettingsPresetDocument(document, requestedPresetId = null, rawSchema = null) {
  const schema = validatePresetSchema(rawSchema);
  if (!document || document.identity !== 'kaminos-volume-agent-capture-artifact-v1') {
    throw new Error('settings preset artifact identity mismatch');
  }
  if (requestedPresetId && document.captureId !== requestedPresetId) {
    throw new Error('settings preset artifact id mismatch');
  }
  const preset = document.capture;
  if (!preset || typeof preset !== 'object') throw new Error('settings preset payload is missing');

  const nativePreset = preset.identity === 'kaminos-volume-settings-preset-v1'
    && preset.kind === 'settings-preset';
  const legacyDomPreset = preset.identity === 'kaminos-volume-basin-dom-settings-capture-v1'
    && preset.kind === 'basin-settings'
    && preset.status === 'captured';
  if (!nativePreset && !legacyDomPreset) {
    throw new Error('artifact is not an accepted volume settings preset');
  }
  for (const field of schema.forbiddenPresetFields || []) {
    if (Object.hasOwn(preset, field)) throw new Error(`settings preset contains forbidden runtime or replay state: ${field}`);
  }
  const allowedFields = nativePreset ? schema.allowedNativePresetFields : schema.allowedLegacyDomPresetFields;
  const unexpectedPresetFields = Object.keys(preset).filter(field => !allowedFields?.includes(field));
  if (unexpectedPresetFields.length > 0) {
    throw new Error(`settings preset contains fields outside its canonical schema: ${unexpectedPresetFields.join(',')}`);
  }

  if (nativePreset && preset.schemaIdentity !== schema.identity) {
    throw new Error('native settings preset schema identity mismatch');
  }

  const domControls = preset.domControls;
  if (!domControls || typeof domControls !== 'object' || Array.isArray(domControls)) {
    throw new Error('settings preset DOM controls are missing');
  }
  const domEntries = Object.entries(domControls);
  if (Number(preset.controlCount) !== Number(schema.controlCount)
    || domEntries.length !== Number(schema.controlCount)) {
    throw new Error(`settings preset requires exactly ${schema.controlCount} canonical controls`);
  }
  if (!preset.route) throw new Error('settings preset route is missing');

  const exclusions = legacyDomPreset ? preset.exclusions : preset.stateExclusions;
  for (const field of schema.excludedStateFields || []) {
    if (exclusions?.[field] !== true) throw new Error(`settings preset did not exclude ${field}`);
  }

  const presetRoute = new URL(preset.route, 'http://kaminos.invalid/');
  if (presetRoute.searchParams.get(schema.activationParam?.key) !== schema.activationParam?.value) {
    throw new Error('settings preset route omitted the native volume activation gate');
  }
  const unexpectedRouteParams = [...presetRoute.searchParams]
    .map(([key]) => key)
    .filter(key => key !== schema.activationParam?.key && !key.startsWith('volume_'));
  if (unexpectedRouteParams.length > 0) {
    throw new Error(`settings preset route contains unexpected parameters: ${unexpectedRouteParams.join(',')}`);
  }

  const routeVolumeEntries = [...presetRoute.searchParams].filter(([key]) => key.startsWith('volume_'));
  const routeVolumeKeys = new Set(routeVolumeEntries.map(([key]) => key));
  const legacyUnroutedParams = new Set(legacyDomPreset ? schema.legacyUnroutedParams : []);
  const expectedRoutedControlCount = schema.controls.length - legacyUnroutedParams.size;
  const expectedRouteVolumeCount = expectedRoutedControlCount + (schema.routeExtraParams || []).length;
  if (routeVolumeEntries.length !== expectedRouteVolumeCount || routeVolumeKeys.size !== expectedRouteVolumeCount) {
    throw new Error(`settings preset route requires exactly ${expectedRouteVolumeCount} unique volume parameters`);
  }

  const routedControlParams = new Set();
  const schemaByKey = new Map(schema.controls.map(entry => [entry.key, entry]));
  for (const [key, entry] of domEntries) {
    const expectedDescriptor = schemaByKey.get(key);
    if (!entry || typeof entry !== 'object' || !String(entry.param || '').startsWith('volume_')) {
      throw new Error('settings preset contains an invalid DOM control descriptor');
    }
    if (!expectedDescriptor
      || entry.param !== expectedDescriptor.param
      || String(entry.tagName || '').toUpperCase() !== String(expectedDescriptor.tagName || '').toUpperCase()
      || String(entry.type || '').toLowerCase() !== String(expectedDescriptor.type || '').toLowerCase()) {
      throw new Error(`settings preset control inventory mismatch for ${key}`);
    }
    if (legacyUnroutedParams.has(entry.param)) {
      if (presetRoute.searchParams.has(entry.param)) throw new Error(`legacy settings preset unexpectedly routed ${entry.param}`);
      continue;
    }
    if (routedControlParams.has(entry.param)) throw new Error(`settings preset duplicates DOM control parameter ${entry.param}`);
    routedControlParams.add(entry.param);
    const values = presetRoute.searchParams.getAll(entry.param);
    const expected = String(Object.hasOwn(entry, 'rawValue') ? entry.rawValue : (entry.value ?? ''));
    if (values.length !== 1 || values[0] !== expected) {
      throw new Error(`settings preset route/control mismatch for ${entry.param}`);
    }
  }

  const extraVolumeParams = [...routeVolumeKeys].filter(key => !routedControlParams.has(key));
  const expectedExtraParams = [...(schema.routeExtraParams || [])].sort();
  if (extraVolumeParams.sort().join('\n') !== expectedExtraParams.join('\n')) {
    throw new Error(`settings preset route has unexpected volume parameters: ${extraVolumeParams.join(',') || 'none'}`);
  }

  return Object.freeze({
    presetId: document.captureId,
    preset,
    presetRoute,
    sourcePresetAuthority: nativePreset
      ? 'native-volume-settings-preset-v1'
      : 'legacy-dom-settings-promoted-v0',
    schemaIdentity: schema.identity,
    routeEntries: Object.freeze([...presetRoute.searchParams].map(entry => Object.freeze([...entry]))),
    routeVolumeEntries: Object.freeze(routeVolumeEntries.map(entry => Object.freeze([...entry]))),
  });
}

export function buildVolumeSettingsPresetTarget(receipt, origin) {
  const target = new URL('/', origin);
  for (const [key, value] of receipt.routeEntries) target.searchParams.set(key, value);
  target.searchParams.set('settings_preset', receipt.presetId);
  target.searchParams.set('settings_preset_authority', receipt.sourcePresetAuthority);
  return target;
}

export function buildVolumeSettingsPresetVisualTarget(receipt, origin, view) {
  if (view !== 'splat-only') throw new Error(`unsupported settings preset visual view: ${view || 'missing'}`);
  const target = new URL('/volume-selective-head-live.html', origin);
  for (const [key, value] of receipt.routeVolumeEntries) target.searchParams.set(key, value);
  target.searchParams.set('role', 'truthHigh');
  target.searchParams.set('composition', 'splat-only-v0');
  target.searchParams.set('warmup_steps', '0');
  target.searchParams.set('settings_preset', receipt.presetId);
  target.searchParams.set('settings_preset_authority', receipt.sourcePresetAuthority);
  return target;
}

export function validateVolumeSettingsPresetVisualTarget(receipt, params) {
  if (params.get('settings_preset') !== receipt.presetId) throw new Error('visual target settings preset id mismatch');
  if (params.get('settings_preset_authority') !== receipt.sourcePresetAuthority) {
    throw new Error('visual target settings preset authority mismatch');
  }
  if (params.get('role') !== 'truthHigh'
    || params.get('composition') !== 'splat-only-v0'
    || params.get('warmup_steps') !== '0') {
    throw new Error('visual target renderer view mismatch');
  }
  const requestedVolumeEntries = [...params].filter(([key]) => key.startsWith('volume_'));
  if (requestedVolumeEntries.length !== receipt.routeVolumeEntries.length) {
    throw new Error('visual target volume route is partial or contains extra settings');
  }
  const requested = new URLSearchParams(requestedVolumeEntries);
  for (const [key, value] of receipt.routeVolumeEntries) {
    const values = requested.getAll(key);
    if (values.length !== 1 || values[0] !== value) throw new Error(`visual target settings route mismatch for ${key}`);
  }
  return true;
}

export function validateVolumeSettingsPresetTarget(receipt, params) {
  if (params.get('settings_preset') !== receipt.presetId) throw new Error('target settings preset id mismatch');
  if (params.get('settings_preset_authority') !== receipt.sourcePresetAuthority) {
    throw new Error('target settings preset authority mismatch');
  }
  for (const [key, value] of receipt.routeEntries) {
    const values = params.getAll(key);
    if (values.length !== 1 || values[0] !== value) throw new Error(`target settings route mismatch for ${key}`);
  }
  const allowed = new Set([
    ...receipt.routeEntries.map(([key]) => key),
    'settings_preset',
    'settings_preset_authority',
  ]);
  const unexpected = [...params].map(([key]) => key).filter(key => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(`target settings route contains unexpected parameters: ${unexpected.join(',')}`);
  return true;
}
