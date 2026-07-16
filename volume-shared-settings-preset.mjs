import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export const DEFAULT_SHARED_VOLUME_SETTINGS_STORE = join(
  homedir(),
  '.local/share/kaminos/volume-settings-presets',
);

const PRESET_SCHEMA_IDENTITY = 'kaminos-volume-settings-preset-schema-v2';
const PRESET_ARTIFACT_IDENTITY = 'kaminos-volume-settings-preset-artifact-v2';
const PRESET_PAYLOAD_IDENTITY = 'kaminos-volume-settings-preset-v2';
const PRESET_ALIAS_IDENTITY = 'kaminos-volume-settings-preset-alias-v1';
const PRESET_AUTHORITY = 'shared-volume-settings-preset-v2';
const PRESET_SCHEMA = JSON.parse(readFileSync(
  new URL('./volume-settings-preset-schema-v2.json', import.meta.url),
  'utf8',
));
if (PRESET_SCHEMA.identity !== PRESET_SCHEMA_IDENTITY
    || !Array.isArray(PRESET_SCHEMA.controls)
    || PRESET_SCHEMA.controls.length !== Number(PRESET_SCHEMA.controlCount)) {
  throw new Error('shared volume settings preset canonical schema is invalid');
}
const EXPECTED_CONTROL_COUNT = Number(PRESET_SCHEMA.controlCount);
const CANONICAL_CONTROLS = new Map(PRESET_SCHEMA.controls.map(control => [control.key, control]));
const REQUIRED_EXCLUSIONS = Object.freeze([...(PRESET_SCHEMA.excludedStateFields || [])]);
const FORBIDDEN_PRESET_FIELDS = Object.freeze([...(PRESET_SCHEMA.forbiddenPresetFields || [])]);
const ALLOWED_PRESET_FIELDS = new Set(PRESET_SCHEMA.allowedNativePresetFields || []);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function readJsonObject(path, label) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`volume settings preset ${label} not found: ${path}`);
    throw new Error(`volume settings preset ${label} is unreadable at ${path}: ${error?.message || error}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`volume settings preset ${label} is not a JSON object: ${path}`);
  }
  return value;
}

function requirePresetId(value, label = 'content id') {
  const presetId = String(value || '');
  if (!/^vsp-[0-9a-f]{64}$/.test(presetId)) {
    throw new Error(`volume settings preset ${label} is invalid: ${presetId || 'missing'}`);
  }
  return presetId;
}

function resolveAlias(storePath, presetRef) {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(presetRef)) {
    throw new Error(`volume settings preset alias is invalid: ${presetRef || 'missing'}`);
  }
  const path = join(storePath, 'aliases', `${presetRef}.json`);
  const alias = readJsonObject(path, 'alias');
  if (alias.identity !== PRESET_ALIAS_IDENTITY
      || alias.alias !== presetRef
      || basename(path, '.json') !== alias.alias) {
    throw new Error('volume settings preset alias identity mismatch');
  }
  if (alias.schemaIdentity !== PRESET_SCHEMA_IDENTITY) {
    throw new Error('volume settings preset alias schema mismatch');
  }
  return alias;
}

function validatePresetPayload(preset) {
  if (preset?.identity !== PRESET_PAYLOAD_IDENTITY || preset.kind !== 'settings-preset') {
    throw new Error('volume settings preset payload identity mismatch');
  }
  if (preset.schemaIdentity !== PRESET_SCHEMA_IDENTITY) {
    throw new Error('volume settings preset payload schema mismatch');
  }
  const unexpectedFields = Object.keys(preset).filter(field => !ALLOWED_PRESET_FIELDS.has(field));
  if (unexpectedFields.length > 0) {
    throw new Error(`volume settings preset contains fields outside its schema: ${unexpectedFields.join(',')}`);
  }
  for (const field of FORBIDDEN_PRESET_FIELDS) {
    if (Object.hasOwn(preset, field)) {
      throw new Error(`volume settings preset contains forbidden runtime state: ${field}`);
    }
  }
  for (const field of REQUIRED_EXCLUSIONS) {
    if (preset.stateExclusions?.[field] !== true) {
      throw new Error(`volume settings preset did not exclude runtime state: ${field}`);
    }
  }
  const controls = preset.domControls;
  if (!controls || typeof controls !== 'object' || Array.isArray(controls)
      || Number(preset.controlCount) !== EXPECTED_CONTROL_COUNT
      || Object.keys(controls).length !== EXPECTED_CONTROL_COUNT) {
    throw new Error(`volume settings preset requires exactly ${EXPECTED_CONTROL_COUNT} controls`);
  }
  if (Object.keys(controls).some(key => !CANONICAL_CONTROLS.has(key))
      || [...CANONICAL_CONTROLS.keys()].some(key => !Object.hasOwn(controls, key))) {
    throw new Error('volume settings preset canonical control inventory mismatch');
  }
  const route = new URL(String(preset.route || ''));
  const routeEntries = [...route.searchParams];
  const routeKeys = new Set(routeEntries.map(([key]) => key));
  if (route.searchParams.getAll('kaminos_volume_smoke').length !== 1
      || route.searchParams.get('kaminos_volume_smoke') !== '1') {
    throw new Error('volume settings preset route omitted the native activation gate');
  }
  if (route.searchParams.getAll('volume_quality_reason').length !== 1) {
    throw new Error('volume settings preset route omitted its quality reason');
  }
  const routedControlParams = new Set();
  for (const [key, descriptor] of Object.entries(controls)) {
    if (!descriptor || typeof descriptor !== 'object') {
      throw new Error(`volume settings preset control descriptor is invalid: ${key}`);
    }
    const canonical = CANONICAL_CONTROLS.get(key);
    const param = String(descriptor.param || '');
    if (descriptor.id !== key
        || param !== canonical.param
        || String(descriptor.tagName || '').toUpperCase() !== String(canonical.tagName || '').toUpperCase()
        || String(descriptor.type || '').toLowerCase() !== String(canonical.type || '').toLowerCase()
        || routedControlParams.has(param)) {
      throw new Error(`volume settings preset canonical control inventory mismatch for ${key}`);
    }
    routedControlParams.add(param);
    const expected = String(Object.hasOwn(descriptor, 'rawValue')
      ? descriptor.rawValue
      : (descriptor.value ?? ''));
    const values = route.searchParams.getAll(param);
    if (values.length !== 1 || values[0] !== expected) {
      throw new Error(`volume settings preset route/control mismatch for ${param}`);
    }
  }
  const allowedRouteParams = new Set([
    PRESET_SCHEMA.activationParam.key,
    ...(PRESET_SCHEMA.routeExtraParams || []),
    ...routedControlParams,
  ]);
  const unexpectedRouteParams = [...routeKeys].filter(key => !allowedRouteParams.has(key));
  if (unexpectedRouteParams.length > 0 || routeEntries.length !== allowedRouteParams.size) {
    throw new Error(`volume settings preset route contains unexpected or duplicate parameters: ${unexpectedRouteParams.join(',')}`);
  }
  return { controls, route, routeEntries };
}

export function resolveSharedVolumeSettingsPreset({
  storePath = DEFAULT_SHARED_VOLUME_SETTINGS_STORE,
  presetRef,
} = {}) {
  const effectiveStorePath = resolve(String(storePath || DEFAULT_SHARED_VOLUME_SETTINGS_STORE));
  const requestedPresetRef = String(presetRef || '').trim();
  if (!requestedPresetRef) throw new Error('volume settings preset id or alias is required');
  const alias = requestedPresetRef.startsWith('vsp-')
    ? null
    : resolveAlias(effectiveStorePath, requestedPresetRef);
  const presetId = requirePresetId(alias?.presetId || requestedPresetRef, alias ? 'alias target' : 'content id');
  const artifactPath = join(effectiveStorePath, 'presets', `${presetId}.json`);
  const artifact = readJsonObject(artifactPath, 'artifact');
  if (artifact.identity !== PRESET_ARTIFACT_IDENTITY || artifact.presetId !== presetId) {
    throw new Error('volume settings preset artifact identity mismatch');
  }
  if (artifact.schemaIdentity !== PRESET_SCHEMA_IDENTITY
      || Number(artifact.controlCount) !== EXPECTED_CONTROL_COUNT) {
    throw new Error('volume settings preset artifact schema mismatch');
  }
  if (artifact.contentHash !== `sha256:${presetId.slice(4)}`) {
    throw new Error('volume settings preset artifact content hash identity mismatch');
  }
  if (alias?.contentHash !== artifact.contentHash) {
    throw new Error('volume settings preset alias content hash mismatch');
  }
  const { controls, route, routeEntries } = validatePresetPayload(artifact.preset);
  const canonicalControls = Object.fromEntries(
    PRESET_SCHEMA.controls.map(({ key }) => [
      key,
      Object.hasOwn(controls[key], 'rawValue') ? controls[key].rawValue : controls[key].value,
    ]),
  );
  const canonical = canonicalJson({
    schemaIdentity: PRESET_SCHEMA_IDENTITY,
    controls: canonicalControls,
  });
  const computedHash = createHash('sha256').update(canonical).digest('hex');
  if (presetId !== `vsp-${computedHash}` || artifact.contentHash !== `sha256:${computedHash}`) {
    throw new Error('volume settings preset artifact content hash mismatch');
  }
  return Object.freeze({
    requestedPresetRef,
    alias: alias?.alias || null,
    label: alias?.label || artifact.initialLabel || null,
    presetId,
    contentHash: artifact.contentHash,
    schemaIdentity: artifact.schemaIdentity,
    controlCount: artifact.controlCount,
    writtenAt: artifact.writtenAt || null,
    source: Object.freeze({ ...(artifact.source || {}) }),
    storePath: effectiveStorePath,
    artifactPath,
    authority: PRESET_AUTHORITY,
    controls: Object.freeze(PRESET_SCHEMA.controls.map(({ key, param, tagName, type }) => Object.freeze({
      key,
      id: controls[key].id,
      param,
      tagName,
      type,
      expectedValue: Object.hasOwn(controls[key], 'rawValue') ? controls[key].rawValue : controls[key].value,
    }))),
    route,
    routeEntries: Object.freeze(routeEntries.map(entry => Object.freeze([...entry]))),
  });
}

export function buildSharedVolumeSettingsTarget(receipt, origin) {
  if (!receipt || receipt.authority !== PRESET_AUTHORITY) {
    throw new Error('shared volume settings preset receipt is missing or invalid');
  }
  const target = new URL('/', origin);
  for (const [key, value] of receipt.routeEntries) target.searchParams.set(key, value);
  target.searchParams.set('settings_preset', receipt.presetId);
  target.searchParams.set('settings_preset_authority', receipt.authority);
  return target;
}

export function buildSharedVolumeSettingsReplayPlan(receipt) {
  if (!receipt || receipt.authority !== PRESET_AUTHORITY || !Array.isArray(receipt.controls)) {
    throw new Error('shared volume settings preset receipt is missing canonical controls');
  }
  return Object.freeze(receipt.controls.map(control => Object.freeze({ ...control })));
}

export function assessSharedVolumeSettingsApplication(receipt, observations) {
  if (!receipt || receipt.authority !== PRESET_AUTHORITY || !Array.isArray(receipt.controls)) {
    throw new Error('shared volume settings preset receipt is missing canonical controls');
  }
  if (!Array.isArray(observations) || observations.length !== receipt.controlCount) {
    throw new Error(`shared preset requires exactly ${receipt.controlCount} effective browser controls`);
  }
  const observedByKey = new Map();
  for (const observation of observations) {
    if (!observation?.key || observedByKey.has(observation.key)) {
      throw new Error('shared preset effective browser controls contain a missing or duplicate key');
    }
    observedByKey.set(observation.key, observation);
  }
  const mismatches = [];
  const expectedValues = {};
  const effectiveValues = {};
  for (const control of receipt.controls) {
    const observation = observedByKey.get(control.key);
    const checkbox = String(control.type).toLowerCase() === 'checkbox';
    const expectedValue = checkbox ? Boolean(control.expectedValue) : String(control.expectedValue ?? '');
    const actualValue = checkbox ? Boolean(observation?.actualValue) : String(observation?.actualValue ?? '');
    expectedValues[control.key] = expectedValue;
    effectiveValues[control.key] = actualValue;
    if (!observation?.found
        || observation.id !== control.id
        || observation.param !== control.param
        || String(observation.actualTagName || '').toUpperCase() !== String(control.tagName).toUpperCase()
        || String(observation.actualType || '').toLowerCase() !== String(control.type).toLowerCase()
        || actualValue !== expectedValue) {
      mismatches.push({
        key: control.key,
        id: control.id,
        param: control.param,
        found: observation?.found === true,
        expectedTagName: control.tagName,
        actualTagName: observation?.actualTagName ?? null,
        expectedType: control.type,
        actualType: observation?.actualType ?? null,
        expectedValue,
        actualValue,
      });
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`shared preset effective browser controls mismatch: ${JSON.stringify(mismatches)}`);
  }
  const expectedControlHash = createHash('sha256').update(canonicalJson(expectedValues)).digest('hex');
  const effectiveControlHash = createHash('sha256').update(canonicalJson(effectiveValues)).digest('hex');
  return Object.freeze({
    status: 'passed',
    authority: 'effective-browser-dom-controls-v1',
    presetId: receipt.presetId,
    matchedControlCount: receipt.controlCount,
    expectedControlHash: `sha256:${expectedControlHash}`,
    effectiveControlHash: `sha256:${effectiveControlHash}`,
    hashesMatch: expectedControlHash === effectiveControlHash,
  });
}
