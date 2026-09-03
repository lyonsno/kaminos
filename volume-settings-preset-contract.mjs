export const VOLUME_SETTINGS_PRESET_SCHEMA_IDENTITY = 'kaminos-volume-settings-preset-schema-v2';
export const VOLUME_SETTINGS_PRESET_VISUAL_VIEWS = Object.freeze({
  'splat-only': Object.freeze({ role: 'truthHigh', composition: 'splat-only-v0' }),
  'raymarch-only': Object.freeze({ role: 'truthHigh', composition: 'raymarch-only-v0' }),
  'smoke-hybrid': Object.freeze({ role: 'truthHigh', composition: 'smoke-raymarch-under-splats-v0' }),
  'full-hybrid-diagnostic': Object.freeze({ role: 'truthHigh', composition: 'full-raymarch-under-splats-diagnostic-v0' }),
});
const VOLUME_SETTINGS_PRESET_VIEW_BY_COMPOSITION = Object.freeze(Object.fromEntries(
  Object.entries(VOLUME_SETTINGS_PRESET_VISUAL_VIEWS).map(([view, definition]) => [definition.composition, view]),
));

export function resolveVolumeSettingsPresetVisualView(selectedView, rendererState = null) {
  const selected = String(selectedView || 'current');
  if (selected !== 'current') {
    if (!Object.hasOwn(VOLUME_SETTINGS_PRESET_VISUAL_VIEWS, selected)) {
      throw new Error(`unsupported settings preset visual view: ${selected}`);
    }
    return selected;
  }
  if (rendererState?.status !== 'running') {
    throw new Error('current renderer view is not running; select an explicit preset renderer view');
  }
  if (rendererState.compositionOverrideReason) {
    throw new Error(`current renderer view is overridden: ${rendererState.compositionOverrideReason}; select an explicit preset renderer view`);
  }
  if (rendererState.requestedComposition !== rendererState.effectiveComposition) {
    throw new Error(
      `current renderer requested/effective composition substitution: ${rendererState.requestedComposition || 'missing'} -> ${rendererState.effectiveComposition || 'missing'}`,
    );
  }
  const fallbackReason = rendererState.fallbackReason
    || rendererState.compositionFallbackReason
    || rendererState.boundarySplatFallbackReason;
  if (fallbackReason) throw new Error(`current renderer fallback: ${fallbackReason}`);
  const view = VOLUME_SETTINGS_PRESET_VIEW_BY_COMPOSITION[rendererState.effectiveComposition];
  if (!view) {
    throw new Error(`current renderer composition is unavailable: ${rendererState.effectiveComposition || 'missing'}`);
  }
  return view;
}
const VOLUME_APPEARANCE_DECOMPOSITION_MODES = Object.freeze([
  'off',
  'structural-a',
  'broad-carrier-b',
  'b-applied-to-fixed-a',
  'a-plus-b-recomposition',
  'smoke-off-beauty-control',
  'complete-flame-emission',
  'complete-flame-extinction',
  'ridge-owned-emission',
  'ridge-owned-extinction',
  'non-ridge-emission',
  'non-ridge-extinction',
  'positive-optical-recomposition',
  'ridge-emission-under-ridge-extinction',
  'ridge-emission-under-total-flame-extinction',
  'nonridge-emission-under-total-flame-extinction',
  'complete-flame-under-total-extinction',
]);
const VOLUME_APPEARANCE_DECOMPOSITION_SELECTIONS = Object.freeze(
  VOLUME_APPEARANCE_DECOMPOSITION_MODES.filter(mode => mode !== 'off'),
);
const VOLUME_COMPOSITION_REQUIRED_SMOKE_PRESENTATION = Object.freeze({
  'splat-only-v0': 'off',
  'smoke-raymarch-under-splats-v0': 'on',
});

function validateAppearanceDecompositionTarget(params, prefix = '') {
  const requestedAppearanceDecompositionModes = params.getAll('volume_appearance_decomposition');
  if (requestedAppearanceDecompositionModes.length > 1) {
    throw new Error(`${prefix}target duplicates appearance decomposition identity`);
  }
  if (requestedAppearanceDecompositionModes.length === 1
    && !VOLUME_APPEARANCE_DECOMPOSITION_MODES.includes(requestedAppearanceDecompositionModes[0])) {
    throw new Error(`unsupported ${prefix}target appearance decomposition: ${requestedAppearanceDecompositionModes[0]}`);
  }
  const requestedAppearanceSelections = params.getAll('volume_appearance_selection');
  if (requestedAppearanceSelections.length > 1) {
    throw new Error(`${prefix}target duplicates appearance decomposition selection`);
  }
  if (requestedAppearanceSelections.length === 1
    && !VOLUME_APPEARANCE_DECOMPOSITION_SELECTIONS.includes(requestedAppearanceSelections[0])) {
    throw new Error(`unsupported ${prefix}target appearance decomposition selection: ${requestedAppearanceSelections[0]}`);
  }
  if (requestedAppearanceDecompositionModes.length === 1
    && requestedAppearanceDecompositionModes[0] !== 'off'
    && requestedAppearanceSelections.length === 1
    && requestedAppearanceSelections[0] !== requestedAppearanceDecompositionModes[0]) {
    throw new Error(`${prefix}target active appearance decomposition conflicts with remembered selection`);
  }
}

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
  const rendererControls = schema.rendererControls || [];
  const presentationControls = schema.presentationControls || [];
  const allControls = [...schema.controls, ...rendererControls, ...presentationControls];
  if (!Array.isArray(rendererControls)
    || !Array.isArray(presentationControls)
    || new Set(rendererControls.map(entry => entry.key)).size !== rendererControls.length
    || new Set(rendererControls.map(entry => entry.param)).size !== rendererControls.length
    || new Set(presentationControls.map(entry => entry.key)).size !== presentationControls.length
    || new Set(presentationControls.map(entry => entry.param)).size !== presentationControls.length
    || new Set(allControls.map(entry => entry.key)).size !== allControls.length
    || new Set(allControls.map(entry => entry.param)).size !== allControls.length) {
    throw new Error('settings preset auxiliary control schema inventory is invalid');
  }
  return schema;
}

export function validateVolumeSettingsPresetIndex(index) {
  if (!index
    || index.identity !== 'kaminos-volume-settings-preset-index-v1'
    || index.schemaIdentity !== VOLUME_SETTINGS_PRESET_SCHEMA_IDENTITY
    || !Number.isSafeInteger(Number(index.controlCount))
    || Number(index.controlCount) < 0
    || !Number.isSafeInteger(Number(index.rendererControlCount))
    || Number(index.rendererControlCount) < 0
    || !Number.isSafeInteger(Number(index.presentationControlCount))
    || Number(index.presentationControlCount) < 0
    || !Array.isArray(index.entries)) {
    throw new Error('preset index identity or schema mismatch');
  }
  return true;
}

export function buildVolumeSettingsPresetIndex(rawSchema, storePath, entries = []) {
  const schema = validatePresetSchema(rawSchema);
  const index = {
    identity: 'kaminos-volume-settings-preset-index-v1',
    schemaIdentity: schema.identity,
    controlCount: schema.controls.length,
    rendererControlCount: (schema.rendererControls || []).length,
    presentationControlCount: (schema.presentationControls || []).length,
    storePath: String(storePath || ''),
    entries: [...entries],
  };
  validateVolumeSettingsPresetIndex(index);
  return index;
}

export function validateVolumeSettingsPresetSourceIdentity(requestedSource, effectiveSource) {
  if (!requestedSource
    || typeof requestedSource.repoRoot !== 'string'
    || !requestedSource.repoRoot
    || !/^[0-9a-f]{40}$/.test(String(requestedSource.commit || ''))) {
    throw new Error('requested settings preset source identity is invalid');
  }
  if (!effectiveSource || effectiveSource.repoRoot !== requestedSource.repoRoot) {
    throw new Error('saved preset came from the wrong server repo root');
  }
  if (effectiveSource.commit !== requestedSource.commit) {
    throw new Error('saved preset came from the wrong server commit');
  }
  return true;
}

export function validateVolumeSettingsPresetDocument(document, requestedPresetRef = null, rawSchema = null) {
  const schema = validatePresetSchema(rawSchema);
  if (!document || document.identity !== 'kaminos-volume-settings-preset-artifact-v2') {
    throw new Error('settings preset artifact identity mismatch');
  }
  if (requestedPresetRef
    && requestedPresetRef !== document.presetId
    && requestedPresetRef !== document.alias
    && requestedPresetRef !== document.requestedPresetRef) {
    throw new Error('settings preset requested/effective identity mismatch');
  }
  if (!/^vsp-[0-9a-f]{64}$/.test(String(document.presetId || ''))) {
    throw new Error('settings preset immutable content identity is invalid');
  }
  if (document.contentHash !== `sha256:${document.presetId.slice(4)}`) {
    throw new Error('settings preset content hash identity mismatch');
  }
  if (document.schemaIdentity !== schema.identity || Number(document.controlCount) !== Number(schema.controlCount)) {
    throw new Error('settings preset artifact schema identity mismatch');
  }
  const preset = document.preset;
  if (!preset || typeof preset !== 'object') throw new Error('settings preset payload is missing');

  const nativePreset = preset.identity === 'kaminos-volume-settings-preset-v2'
    && preset.kind === 'settings-preset';
  if (!nativePreset) {
    throw new Error('artifact is not an accepted volume settings preset');
  }
  for (const field of schema.forbiddenPresetFields || []) {
    if (Object.hasOwn(preset, field)) throw new Error(`settings preset contains forbidden runtime or replay state: ${field}`);
  }
  const allowedFields = schema.allowedNativePresetFields;
  const unexpectedPresetFields = Object.keys(preset).filter(field => !allowedFields?.includes(field));
  if (unexpectedPresetFields.length > 0) {
    throw new Error(`settings preset contains fields outside its canonical schema: ${unexpectedPresetFields.join(',')}`);
  }

  if (preset.schemaIdentity !== schema.identity) {
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
  const rendererControls = preset.rendererControls;
  const rendererEntries = rendererControls === undefined ? [] : Object.entries(rendererControls || {});
  const expectedRendererControls = schema.rendererControls || [];
  if (rendererControls !== undefined && (!rendererControls || typeof rendererControls !== 'object' || Array.isArray(rendererControls))) {
    throw new Error('settings preset renderer controls are invalid');
  }
  if (rendererControls === undefined && expectedRendererControls.length === 0) {
    if (preset.rendererControlCount !== undefined && Number(preset.rendererControlCount) !== 0) {
      throw new Error('settings preset renderer control count is invalid');
    }
  } else if (Number(preset.rendererControlCount) !== expectedRendererControls.length
    || rendererEntries.length !== expectedRendererControls.length) {
    throw new Error(`settings preset requires exactly ${expectedRendererControls.length} renderer controls`);
  }
  const expectedPresentationControls = schema.presentationControls || [];
  const presentationControls = preset.presentationControls;
  const presentationEntries = Object.entries(presentationControls || {});
  if (presentationControls === undefined && expectedPresentationControls.length === 0) {
    // Historical schemas without a presentation axis remain exact at zero controls.
  } else if (!presentationControls || typeof presentationControls !== 'object' || Array.isArray(presentationControls)) {
    throw new Error('settings preset presentation controls are missing or invalid');
  } else if (Number(preset.presentationControlCount) !== expectedPresentationControls.length
    || presentationEntries.length !== expectedPresentationControls.length) {
    throw new Error(`settings preset requires exactly ${expectedPresentationControls.length} presentation controls`);
  }
  if (!preset.route) throw new Error('settings preset route is missing');

  const exclusions = preset.stateExclusions;
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
  const legacyUnroutedParams = new Set();
  const expectedRoutedControlCount = schema.controls.length + rendererEntries.length + presentationEntries.length;
  const expectedRouteVolumeCount = expectedRoutedControlCount + (schema.routeExtraParams || []).length;
  if (routeVolumeEntries.length !== expectedRouteVolumeCount || routeVolumeKeys.size !== expectedRouteVolumeCount) {
    throw new Error(`settings preset route requires exactly ${expectedRouteVolumeCount} unique volume parameters`);
  }

  const routedControlParams = new Set();
  const schemaByKey = new Map(
    [...schema.controls, ...expectedRendererControls, ...expectedPresentationControls].map(entry => [entry.key, entry]),
  );
  for (const [key, entry] of [...domEntries, ...rendererEntries, ...presentationEntries]) {
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
    if (Array.isArray(expectedDescriptor.allowedValues)
      && !expectedDescriptor.allowedValues.includes(Object.hasOwn(entry, 'rawValue') ? entry.rawValue : entry.value)) {
      throw new Error(`settings preset control has unsupported value for ${key}`);
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
    requestedPresetRef: requestedPresetRef || document.requestedPresetRef || document.presetId,
    presetId: document.presetId,
    alias: document.alias || null,
    label: document.label || document.initialLabel || null,
    contentHash: document.contentHash,
    storePath: document.storePath || null,
    preset,
    presetRoute,
    sourcePresetAuthority: 'shared-volume-settings-preset-v2',
    schemaIdentity: schema.identity,
    rendererControlCount: rendererEntries.length,
    presentationControlCount: presentationEntries.length,
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

export function buildVolumeSettingsPresetVisualTarget(receipt, origin, view, { assayToolbar = false } = {}) {
  const viewSpec = VOLUME_SETTINGS_PRESET_VISUAL_VIEWS[view];
  if (!viewSpec) throw new Error(`unsupported settings preset visual view: ${view || 'missing'}`);
  const target = new URL('/volume-selective-head-live.html', origin);
  for (const [key, value] of receipt.routeVolumeEntries) target.searchParams.set(key, value);
  target.searchParams.set('role', viewSpec.role);
  target.searchParams.set('composition', viewSpec.composition);
  target.searchParams.set('warmup_steps', '0');
  target.searchParams.set('volume_presentation', 'beauty');
  target.searchParams.set('volume_raymarch_smoke', viewSpec.composition === 'splat-only-v0' ? 'off' : 'on');
  target.searchParams.set('settings_preset', receipt.presetId);
  target.searchParams.set('settings_preset_authority', receipt.sourcePresetAuthority);
  if (assayToolbar) target.searchParams.set('assay_toolbar', '1');
  return target;
}

export function validateVolumeSettingsPresetVisualTarget(receipt, params) {
  if (params.get('settings_preset') !== receipt.presetId) throw new Error('visual target settings preset id mismatch');
  if (params.get('settings_preset_authority') !== receipt.sourcePresetAuthority) {
    throw new Error('visual target settings preset authority mismatch');
  }
  const viewSpec = Object.values(VOLUME_SETTINGS_PRESET_VISUAL_VIEWS)
    .find(candidate => candidate.composition === params.get('composition'));
  if (!viewSpec
    || params.get('role') !== viewSpec.role
    || params.get('warmup_steps') !== '0') {
    throw new Error('visual target renderer view mismatch');
  }
  const requestedPresentationModes = params.getAll('volume_presentation');
  if (requestedPresentationModes.length > 1) throw new Error('visual target duplicates volume presentation identity');
  if (requestedPresentationModes.length === 1 && !['beauty', 'intrinsic'].includes(requestedPresentationModes[0])) {
    throw new Error(`unsupported visual target volume presentation: ${requestedPresentationModes[0]}`);
  }
  const requestedSmokePresentationModes = params.getAll('volume_raymarch_smoke');
  if (requestedSmokePresentationModes.length > 1) throw new Error('visual target duplicates raymarch smoke presentation identity');
  if (requestedSmokePresentationModes.length === 1 && !['on', 'off'].includes(requestedSmokePresentationModes[0])) {
    throw new Error(`unsupported visual target raymarch smoke presentation: ${requestedSmokePresentationModes[0]}`);
  }
  const expectedSmokeForComposition = VOLUME_COMPOSITION_REQUIRED_SMOKE_PRESENTATION[viewSpec.composition];
  if (requestedSmokePresentationModes.length === 1
    && expectedSmokeForComposition
    && requestedSmokePresentationModes[0] !== expectedSmokeForComposition) {
    throw new Error(`visual target composition/smoke identity mismatch: ${viewSpec.composition} requires ${expectedSmokeForComposition}`);
  }
  validateAppearanceDecompositionTarget(params, 'visual ');
  const requestedAssayToolbarModes = params.getAll('assay_toolbar');
  if (requestedAssayToolbarModes.length > 1) throw new Error('visual target duplicates diagnostic toolbar identity');
  if (requestedAssayToolbarModes.length === 1 && requestedAssayToolbarModes[0] !== '1') {
    throw new Error(`unsupported visual target diagnostic toolbar mode: ${requestedAssayToolbarModes[0]}`);
  }
  const allowed = new Set([
    ...receipt.routeVolumeEntries.map(([key]) => key),
    'role',
    'composition',
    'warmup_steps',
    'settings_preset',
    'settings_preset_authority',
    'volume_presentation',
    'volume_raymarch_smoke',
    'volume_appearance_decomposition',
    'volume_appearance_selection',
    'assay_toolbar',
  ]);
  const unexpected = [...params].map(([key]) => key).filter(key => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`visual target contains unexpected parameters: ${unexpected.join(',')}`);
  }
  for (const key of ['role', 'composition', 'warmup_steps', 'settings_preset', 'settings_preset_authority']) {
    if (params.getAll(key).length !== 1) throw new Error(`visual target duplicates parameter: ${key}`);
  }
  const visualOwnedVolumeParams = new Set([
    'volume_presentation',
    'volume_raymarch_smoke',
    'volume_appearance_decomposition',
    'volume_appearance_selection',
  ]);
  const requestedVolumeEntries = [...params].filter(([key]) => (
    key.startsWith('volume_') && !visualOwnedVolumeParams.has(key)
  ));
  const savedVolumeEntries = receipt.routeVolumeEntries.filter(([key]) => !visualOwnedVolumeParams.has(key));
  if (requestedVolumeEntries.length !== savedVolumeEntries.length) {
    throw new Error('visual target volume route is partial or contains extra settings');
  }
  const requested = new URLSearchParams(requestedVolumeEntries);
  for (const [key, value] of savedVolumeEntries) {
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
  const requestedPresentationModes = params.getAll('volume_presentation');
  if (requestedPresentationModes.length > 1) throw new Error('target duplicates volume presentation identity');
  if (requestedPresentationModes.length === 1 && !['beauty', 'intrinsic'].includes(requestedPresentationModes[0])) {
    throw new Error(`unsupported target volume presentation: ${requestedPresentationModes[0]}`);
  }
  const requestedSmokePresentationModes = params.getAll('volume_raymarch_smoke');
  if (requestedSmokePresentationModes.length > 1) throw new Error('target duplicates raymarch smoke presentation identity');
  if (requestedSmokePresentationModes.length === 1 && !['on', 'off'].includes(requestedSmokePresentationModes[0])) {
    throw new Error(`unsupported target raymarch smoke presentation: ${requestedSmokePresentationModes[0]}`);
  }
  validateAppearanceDecompositionTarget(params);
  const allowed = new Set([
    ...receipt.routeEntries.map(([key]) => key),
    'settings_preset',
    'settings_preset_authority',
    'volume_presentation',
    'volume_raymarch_smoke',
    'volume_appearance_decomposition',
    'volume_appearance_selection',
  ]);
  const unexpected = [...params].map(([key]) => key).filter(key => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(`target settings route contains unexpected parameters: ${unexpected.join(',')}`);
  return true;
}
