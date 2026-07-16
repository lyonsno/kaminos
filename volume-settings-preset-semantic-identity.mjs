export const VOLUME_SETTINGS_PRESET_SEMANTIC_AUTHORITY = 'canonical-schema-and-control-values-sha256-v0';
export const VOLUME_SETTINGS_PRESET_TRANSPORT_AUTHORITY = 'transport-receipt-only-v0';

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

export async function validateVolumeSettingsPresetSemanticIdentity(artifact, expectedPresetId) {
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
  for (const [key, descriptor] of Object.entries(domControls)) {
    const values = sourceRoute.searchParams.getAll(String(descriptor.param || ''));
    const expectedValue = String(Object.hasOwn(descriptor, 'rawValue') ? descriptor.rawValue : (descriptor.value ?? ''));
    if (!descriptor.param || values.length !== 1 || values[0] !== expectedValue) {
      throw new Error(`settings preset route/control mismatch for ${key}`);
    }
  }
  const routeControlCount = [...sourceRoute.searchParams].length;
  if (routeControlCount < domControlCount) throw new Error('settings preset route is partial');
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
  if (expectedSourceCommit && provenance.sourceCommit !== expectedSourceCommit) {
    throw new Error('settings preset provenance source commit mismatch');
  }
  return Object.freeze({ ...provenance });
}
