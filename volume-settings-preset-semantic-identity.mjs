export const VOLUME_SETTINGS_PRESET_SEMANTIC_AUTHORITY = 'canonical-schema-and-control-values-sha256-v0';
export const VOLUME_SETTINGS_PRESET_TRANSPORT_AUTHORITY = 'transport-receipt-only-v0';

const SUPPORTED_ROUTE_AUTHORITY_BY_PRESET_ID = Object.freeze({
  'vsp-48617494d68e4f24bba358676733f2aaa5f03622b1747c45056de56884fe78d8': Object.freeze({
    identity: 'kaminos-volume-settings-preset-route-authority-v1',
    activationParam: Object.freeze({ key: 'kaminos_volume_smoke', value: '1' }),
    extraParams: Object.freeze({ volume_quality_reason: 'operator-settings-only-capture' }),
  }),
  'vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2': Object.freeze({
    identity: 'kaminos-volume-settings-preset-route-authority-v1',
    activationParam: Object.freeze({ key: 'kaminos_volume_smoke', value: '1' }),
    extraParams: Object.freeze({ volume_quality_reason: 'operator-settings-only-capture' }),
  }),
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export async function sha256HexFromBytes(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return sha256Hex(value);
}

export function volumeSettingsPresetSemanticPayload(artifact) {
  const domControls = artifact?.preset?.domControls;
  if (!domControls || typeof domControls !== 'object' || Array.isArray(domControls)) {
    throw new Error('preset.domControls must decode to an object');
  }
  const controls = {};
  for (const [key, descriptor] of Object.entries(domControls)) {
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
      throw new Error(`settings preset control descriptor is invalid: ${key}`);
    }
    controls[key] = Object.hasOwn(descriptor, 'rawValue') ? descriptor.rawValue : descriptor.value;
  }
  return {
    schemaIdentity: artifact.schemaIdentity,
    controls,
  };
}

export async function computeVolumeSettingsPresetSemanticIdentity(artifact) {
  const canonical = canonicalJson(volumeSettingsPresetSemanticPayload(artifact));
  const digest = await sha256Hex(new TextEncoder().encode(canonical));
  return Object.freeze({
    presetId: `vsp-${digest}`,
    contentHash: `sha256:${digest}`,
    semanticIdentityAuthority: VOLUME_SETTINGS_PRESET_SEMANTIC_AUTHORITY,
  });
}

export async function validateVolumeSettingsPresetSemanticIdentity(artifact, expectedPresetId, routeAuthority) {
  if (artifact?.identity !== 'kaminos-volume-settings-preset-artifact-v2') {
    throw new Error('settings preset artifact identity mismatch');
  }
  if (artifact?.schemaIdentity !== 'kaminos-volume-settings-preset-schema-v2') {
    throw new Error('settings preset schema identity mismatch');
  }
  const domControls = artifact?.preset?.domControls;
  const domControlCount = Object.keys(domControls || {}).length;
  if (artifact?.controlCount !== domControlCount || artifact?.preset?.controlCount !== domControlCount) {
    throw new Error('settings preset control count mismatch');
  }
  const computed = await computeVolumeSettingsPresetSemanticIdentity(artifact);
  if (computed.presetId !== artifact.presetId || computed.contentHash !== artifact.contentHash) {
    throw new Error('settings preset semantic content hash mismatch');
  }
  if (expectedPresetId && computed.presetId !== expectedPresetId) {
    throw new Error('settings preset requested semantic identity mismatch');
  }

  const sourceRoute = new URL(String(artifact?.preset?.route || ''));
  const supportedRouteAuthority = SUPPORTED_ROUTE_AUTHORITY_BY_PRESET_ID[computed.presetId];
  if (!supportedRouteAuthority || canonicalJson(routeAuthority) !== canonicalJson(supportedRouteAuthority)) {
    throw new Error('settings preset route authority does not match the supported semantic preset');
  }
  if (routeAuthority?.identity !== 'kaminos-volume-settings-preset-route-authority-v1') {
    throw new Error('settings preset route authority is missing or invalid');
  }
  const activationKey = String(routeAuthority?.activationParam?.key || '');
  const activationValue = String(routeAuthority?.activationParam?.value || '');
  if (!activationKey || sourceRoute.searchParams.getAll(activationKey).length !== 1
    || sourceRoute.searchParams.get(activationKey) !== activationValue) {
    throw new Error('settings preset route activation mismatch');
  }
  const descriptorParams = new Set();
  for (const [key, descriptor] of Object.entries(domControls)) {
    descriptorParams.add(String(descriptor.param || ''));
    const values = sourceRoute.searchParams.getAll(String(descriptor.param || ''));
    const expectedValue = String(Object.hasOwn(descriptor, 'rawValue') ? descriptor.rawValue : (descriptor.value ?? ''));
    if (!descriptor.param || values.length !== 1 || values[0] !== expectedValue) {
      throw new Error(`settings preset route/control mismatch for ${key}`);
    }
  }
  if (descriptorParams.size !== domControlCount) throw new Error('settings preset route control parameters are not unique');
  const extraParams = routeAuthority.extraParams;
  if (!extraParams || typeof extraParams !== 'object' || Array.isArray(extraParams)) {
    throw new Error('settings preset route extra authority is invalid');
  }
  for (const [key, expectedValue] of Object.entries(extraParams)) {
    const values = sourceRoute.searchParams.getAll(key);
    if (values.length !== 1 || values[0] !== String(expectedValue)) {
      throw new Error(`settings preset route extra mismatch for ${key}`);
    }
  }
  const allowedParams = new Set([...descriptorParams, activationKey, ...Object.keys(extraParams)]);
  for (const [key] of sourceRoute.searchParams) {
    if (!allowedParams.has(key)) throw new Error(`settings preset route parameter is not owned: ${key}`);
  }
  const routeControlCount = [...sourceRoute.searchParams].length;
  const expectedRouteControlCount = domControlCount + 1 + Object.keys(extraParams).length;
  if (routeControlCount !== expectedRouteControlCount) throw new Error('settings preset route parameter count mismatch');
  return Object.freeze({
    ...computed,
    domControlCount,
    routeControlCount,
    sourceRoute,
  });
}

export function validateVolumeSettingsPresetProvenance(provenance, semanticIdentity, expectedSourceCommit = null) {
  if (provenance?.identity !== 'kaminos-volume-settings-preset-provenance-v1') {
    throw new Error('settings preset provenance identity mismatch');
  }
  if (provenance.presetId !== semanticIdentity.presetId || provenance.contentHash !== semanticIdentity.contentHash) {
    throw new Error('settings preset provenance semantic identity mismatch');
  }
  if (!/^[0-9a-f]{40}$/.test(String(provenance.sourceCommit || ''))) {
    throw new Error('settings preset provenance source commit is invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(String(provenance.historicalArtifactFileSha256 || ''))) {
    throw new Error('settings preset provenance historical artifact hash is invalid');
  }
  if (provenance.routeAuthority?.identity !== 'kaminos-volume-settings-preset-route-authority-v1') {
    throw new Error('settings preset provenance route authority is invalid');
  }
  if (expectedSourceCommit && provenance.sourceCommit !== expectedSourceCommit) {
    throw new Error('settings preset provenance source commit mismatch');
  }
  return Object.freeze({ ...provenance });
}
